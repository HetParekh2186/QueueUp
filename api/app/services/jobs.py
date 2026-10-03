"""Background jobs. Every one of them must be safe to run twice (schedulers double-fire,
workers restart mid-run), which each achieves with a guarded write."""

import logging
from datetime import timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app import notifications as notify
from app.db import transaction
from app.emails import send_email
from app.models import Event, Order, Ticket, TicketType, User
from app.notifications import Notification
from app.services.inventory import ACTIVE_TICKET_STATUSES, _lock_ticket_type, expire_due_holds

log = logging.getLogger("queueup.jobs")


async def sweep_expired_holds(session: AsyncSession) -> list[Notification]:
    """Return abandoned-cart seats to inventory.

    One short transaction per ticket type, taking the type lock first (the global lock
    order), then reusing the exact expiry routine reserve uses inline.
    """
    due_types = (
        await session.execute(
            sa.select(Order.ticket_type_id)
            .where(Order.status == "pending", Order.expires_at <= sa.func.now())
            .distinct()
        )
    ).scalars().all()
    await session.rollback()

    out: list[Notification] = []
    for type_id in due_types:
        async with transaction(session):
            tt = await _lock_ticket_type(session, type_id)
            if tt is None:
                continue
            freed = await expire_due_holds(session, type_id)
        if freed:
            out.append(notify.seats(tt.event_id, type_id, tt.capacity, tt.sold - freed))
            out.append(notify.order_changed(tt.event_id))
    return out


async def auto_close_events(session: AsyncSession) -> int:
    async with transaction(session):
        closed = (
            await session.execute(
                sa.update(Event)
                .where(
                    Event.status == "published",
                    sa.func.coalesce(Event.ends_at, Event.starts_at + timedelta(hours=6)) < sa.func.now(),
                )
                .values(status="ended")
                .returning(Event.id)
                .execution_options(synchronize_session=False)
            )
        ).scalars().all()
    if closed:
        log.info("events ended", extra={"ctx": {"count": len(closed)}})
    return len(closed)


async def send_reminders(session: AsyncSession) -> int:
    """Email paid attendees ~24h before their event, exactly once per order."""
    due = (
        await session.execute(
            sa.select(Order.id)
            .join(Event, Event.id == Order.event_id)
            .where(
                Order.status == "paid",
                Order.reminder_sent_at.is_(None),
                Event.status == "published",
                Event.starts_at > sa.func.now(),
                Event.starts_at <= sa.func.now() + timedelta(hours=24),
            )
        )
    ).scalars().all()
    await session.rollback()

    sent = 0
    for order_id in due:
        async with transaction(session):
            # Claim the reminder before sending: a second worker running the same job
            # matches zero rows here and skips. (At-most-once beats double emails.)
            claimed = await session.scalar(
                sa.update(Order)
                .where(Order.id == order_id, Order.reminder_sent_at.is_(None))
                .values(reminder_sent_at=sa.func.now())
                .returning(Order.id)
                .execution_options(synchronize_session=False)
            )
            if claimed is None:
                continue
            info = (
                await session.execute(
                    sa.select(User.email, User.display_name, Event.title, Event.venue, Event.starts_at, Event.timezone)
                    .select_from(Order)
                    .join(User, User.id == Order.user_id)
                    .join(Event, Event.id == Order.event_id)
                    .where(Order.id == order_id)
                )
            ).one()
        send_email(
            info.email,
            f"Reminder: {info.title} is tomorrow",
            f"Hi {info.display_name},\n\n{info.title} starts at {info.starts_at.isoformat()} "
            f"({info.timezone}){' at ' + info.venue if info.venue else ''}.\n"
            "Your QR tickets are in My Tickets.\n",
        )
        sent += 1
    return sent


async def reconcile_inventory(session: AsyncSession) -> int:
    """Recount each type's ``sold`` from its ticket rows and fix any drift.

    Should always find zero drift; it exists to *prove* that, and to repair state if a
    bug or manual DB edit ever breaks the invariant. Returns the number of types fixed.
    """
    type_ids = (
        await session.execute(
            sa.select(TicketType.id)
            .join(Event, Event.id == TicketType.event_id)
            .where(Event.status.in_(("published", "draft")))
        )
    ).scalars().all()
    await session.rollback()

    fixed = 0
    for type_id in type_ids:
        async with transaction(session):
            tt = await _lock_ticket_type(session, type_id)
            if tt is None:
                continue
            await expire_due_holds(session, type_id)
            stored = await session.scalar(sa.select(TicketType.sold).where(TicketType.id == type_id))
            actual = await session.scalar(
                sa.select(sa.func.count())
                .select_from(Ticket)
                .where(Ticket.ticket_type_id == type_id, Ticket.status.in_(ACTIVE_TICKET_STATUSES))
            )
            if stored != actual:
                log.error(
                    "inventory drift repaired",
                    extra={"ctx": {"ticket_type_id": str(type_id), "stored": stored, "actual": actual}},
                )
                await session.execute(
                    sa.update(TicketType)
                    .where(TicketType.id == type_id)
                    .values(sold=actual)
                    .execution_options(synchronize_session=False)
                )
                fixed += 1
    return fixed

"""Concurrent inventory: the part that must never oversell.

Two rules carry every function in this module:

1. **Check and write in one guarded step.** Reserving locks the ticket type row
   (``SELECT ... FOR UPDATE``) so concurrent buyers queue behind each other; every
   state transition is an ``UPDATE ... WHERE <expected state> RETURNING``, and
   "zero rows affected" is the losing path.

2. **One lock order everywhere:** ticket_types -> orders -> tickets. Every writer that
   needs more than one of these takes them in that order, so two writers can never
   wait on each other in a cycle (no deadlocks). Confirm and check-in never lock a
   ticket type at all.

All time comparisons use the database's ``now()``; app-server and browser clocks are
never trusted for expiry.
"""

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import notifications as notify
from app import payments
from app.config import settings
from app.db import transaction
from app.errors import DomainError
from app.models import Event, Order, Ticket, TicketType
from app.notifications import Notification

log = logging.getLogger("queueup.inventory")

ACTIVE_TICKET_STATUSES = ("held", "confirmed", "checked_in")
NO_SYNC = {"synchronize_session": False}


@dataclass
class Result:
    order_id: uuid.UUID
    notifications: list[Notification] = field(default_factory=list)
    expires_at: datetime | None = None


async def _lock_ticket_type(session: AsyncSession, ticket_type_id: uuid.UUID):
    """Row-lock a ticket type. Concurrent callers block here until we commit."""
    return (
        await session.execute(
            sa.select(TicketType.id, TicketType.event_id, TicketType.capacity, TicketType.sold)
            .where(TicketType.id == ticket_type_id)
            .with_for_update()
        )
    ).first()


async def _adjust_sold(session: AsyncSession, ticket_type_id: uuid.UUID, delta: int):
    return (
        await session.execute(
            sa.update(TicketType)
            .where(TicketType.id == ticket_type_id)
            .values(sold=TicketType.sold + delta)
            .returning(TicketType.capacity, TicketType.sold)
            .execution_options(**NO_SYNC)
        )
    ).one()


async def expire_due_holds(session: AsyncSession, ticket_type_id: uuid.UUID) -> int:
    """Release every hold on this type whose deadline has passed. Returns seats freed.

    Caller must hold the ticket type lock. Used by the background sweeper *and* inline
    by reserve, so a hold that expired a few seconds ago — before the sweeper got
    there — never blocks a real buyer.

    The guard (``status = 'pending' AND expires_at <= now()``) is the mirror image of
    confirm's guard (``status = 'pending' AND expires_at > now()``). The order row
    lock serializes the two, so a hold is never both confirmed and expired.
    """
    expired_orders = (
        await session.execute(
            sa.update(Order)
            .where(
                Order.ticket_type_id == ticket_type_id,
                Order.status == "pending",
                Order.expires_at <= sa.func.now(),
            )
            .values(status="expired")
            .returning(Order.id)
            .execution_options(**NO_SYNC)
        )
    ).scalars().all()
    if not expired_orders:
        return 0
    freed = (
        await session.execute(
            sa.update(Ticket)
            .where(Ticket.order_id.in_(expired_orders), Ticket.status == "held")
            .values(status="expired", expires_at=None)
            .returning(Ticket.id)
            .execution_options(**NO_SYNC)
        )
    ).scalars().all()
    if freed:
        await _adjust_sold(session, ticket_type_id, -len(freed))
    log.info(
        "holds expired",
        extra={"ctx": {"ticket_type_id": str(ticket_type_id), "orders": len(expired_orders), "seats": len(freed)}},
    )
    return len(freed)


async def _duplicate(session: AsyncSession, idempotency_key: uuid.UUID, user_id: uuid.UUID) -> DomainError:
    row = (
        await session.execute(
            sa.select(Order.id, Order.user_id).where(Order.idempotency_key == idempotency_key)
        )
    ).first()
    # Only reveal the original order to the user who made it.
    order_id = row.id if row is not None and row.user_id == user_id else None
    return DomainError(409, "duplicate_request", order_id=order_id)


async def reserve(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    event_id: uuid.UUID,
    ticket_type_id: uuid.UUID,
    quantity: int,
    idempotency_key: uuid.UUID,
) -> Result:
    """Claim ``quantity`` seats as a time-boxed hold — all of them or none."""
    if not 1 <= quantity <= settings.max_tickets_per_order:
        raise DomainError(422, "invalid_quantity", max=settings.max_tickets_per_order)

    try:
        async with transaction(session):
            replay = await session.scalar(
                sa.select(Order.id).where(Order.idempotency_key == idempotency_key)
            )
            if replay is not None:
                raise await _duplicate(session, idempotency_key, user_id)

            # --- the critical section: every other buyer of this type waits here ---
            tt = await _lock_ticket_type(session, ticket_type_id)
            if tt is None or tt.event_id != event_id:
                raise DomainError(404, "ticket_type_not_found")

            # Read event status *after* taking the lock: cancelling an event locks all
            # its ticket types first, so we can't sell into an event mid-cancellation.
            event_status = await session.scalar(sa.select(Event.status).where(Event.id == event_id))
            if event_status != "published":
                raise DomainError(409, "event_not_on_sale", event_status=event_status)

            sold = tt.sold - await expire_due_holds(session, tt.id)
            remaining = tt.capacity - sold
            if remaining < quantity:
                raise DomainError(409, "sold_out", remaining=remaining)

            already_active = await session.scalar(
                sa.select(sa.func.count())
                .select_from(Ticket)
                .where(
                    Ticket.ticket_type_id == tt.id,
                    Ticket.user_id == user_id,
                    Ticket.status.in_(ACTIVE_TICKET_STATUSES),
                )
            )
            if already_active + quantity > settings.max_active_tickets_per_type:
                raise DomainError(
                    409,
                    "per_user_limit",
                    limit=settings.max_active_tickets_per_type,
                    active=already_active,
                )

            order = (
                await session.execute(
                    sa.insert(Order)
                    .values(
                        user_id=user_id,
                        event_id=event_id,
                        ticket_type_id=tt.id,
                        quantity=quantity,
                        status="pending",
                        idempotency_key=idempotency_key,
                        expires_at=sa.func.now() + timedelta(seconds=settings.hold_seconds),
                    )
                    .returning(Order.id, Order.expires_at)
                )
            ).one()
            await session.execute(
                sa.insert(Ticket).values(
                    [
                        {
                            "ticket_type_id": tt.id,
                            "order_id": order.id,
                            "user_id": user_id,
                            "status": "held",
                            "expires_at": order.expires_at,
                        }
                        for _ in range(quantity)
                    ]
                )
            )
            capacity, new_sold = await _adjust_sold(session, tt.id, quantity)
    except IntegrityError as exc:
        message = str(exc.orig)
        if "idempotency_key" in message:
            # Same key submitted concurrently: the other request inserted first.
            raise await _duplicate(session, idempotency_key, user_id) from None
        if "ticket_types_sold_le_capacity" in message:
            # Defense in depth: the CHECK constraint caught what locking should have.
            log.error("oversell blocked by CHECK constraint", extra={"ctx": {"ticket_type_id": str(ticket_type_id)}})
            raise DomainError(409, "sold_out", remaining=0) from None
        raise

    log.info(
        "reservation held",
        extra={"ctx": {"order_id": str(order.id), "ticket_type_id": str(ticket_type_id), "quantity": quantity, "remaining": capacity - new_sold}},
    )
    return Result(
        order_id=order.id,
        expires_at=order.expires_at,
        notifications=[notify.seats(event_id, ticket_type_id, capacity, new_sold), notify.order_changed(event_id)],
    )


async def _owned_order(session: AsyncSession, order_id: uuid.UUID, user_id: uuid.UUID):
    row = (
        await session.execute(
            sa.select(
                Order.id,
                Order.user_id,
                Order.event_id,
                Order.ticket_type_id,
                Order.quantity,
                Order.status,
                Order.payment_ref,
                TicketType.price_cents,
            )
            .join(TicketType, TicketType.id == Order.ticket_type_id)
            .where(Order.id == order_id)
        )
    ).first()
    if row is None or row.user_id != user_id:
        raise DomainError(404, "order_not_found")
    return row


async def confirm(
    session: AsyncSession, *, order_id: uuid.UUID, user_id: uuid.UUID, payment_token: str
) -> Result:
    """Pay for a hold. Safe to retry: confirming an already-paid order is a no-op."""
    order = await _owned_order(session, order_id, user_id)
    # End the read transaction: never sit "idle in transaction" while talking to the
    # payment provider. The guarded UPDATE below re-checks everything that matters.
    await session.rollback()
    if order.status == "paid":
        return Result(order_id=order.id)
    if order.status in ("expired", "cancelled"):
        raise DomainError(410, "hold_expired", status=order.status)
    if order.status != "pending":
        raise DomainError(409, "order_not_pending", status=order.status)

    auth = payments.authorize(order.price_cents * order.quantity, payment_token)
    try:
        async with transaction(session):
            # The guarded write. If the sweeper (or the clock) got here first, this
            # matches zero rows and the confirm loses — no matter what the browser's
            # countdown said.
            won = await session.scalar(
                sa.update(Order)
                .where(
                    Order.id == order.id,
                    Order.status == "pending",
                    Order.expires_at > sa.func.now(),
                )
                .values(status="paid", paid_at=sa.func.now(), payment_ref=auth)
                .returning(Order.id)
                .execution_options(**NO_SYNC)
            )
            if won is None:
                raise DomainError(410, "hold_expired")
            await session.execute(
                sa.update(Ticket)
                .where(Ticket.order_id == order.id, Ticket.status == "held")
                .values(status="confirmed", confirmed_at=sa.func.now(), expires_at=None)
                .execution_options(**NO_SYNC)
            )
    except BaseException:
        payments.void(auth)
        raise
    payments.capture(auth)
    log.info("order confirmed", extra={"ctx": {"order_id": str(order.id)}})
    return Result(order_id=order.id, notifications=[notify.order_changed(order.event_id)])


async def release(session: AsyncSession, *, order_id: uuid.UUID, user_id: uuid.UUID) -> Result:
    """Give a hold back early (the attendee changed their mind)."""
    order = await _owned_order(session, order_id, user_id)
    async with transaction(session):
        await _lock_ticket_type(session, order.ticket_type_id)
        won = await session.scalar(
            sa.update(Order)
            .where(Order.id == order.id, Order.status == "pending")
            .values(status="cancelled")
            .returning(Order.id)
            .execution_options(**NO_SYNC)
        )
        if won is None:
            raise DomainError(409, "order_not_pending")
        freed = (
            await session.execute(
                sa.update(Ticket)
                .where(Ticket.order_id == order.id, Ticket.status == "held")
                .values(status="cancelled", expires_at=None)
                .returning(Ticket.id)
                .execution_options(**NO_SYNC)
            )
        ).scalars().all()
        capacity, sold = await _adjust_sold(session, order.ticket_type_id, -len(freed))
    log.info("hold released", extra={"ctx": {"order_id": str(order.id), "seats": len(freed)}})
    return Result(
        order_id=order.id,
        notifications=[
            notify.seats(order.event_id, order.ticket_type_id, capacity, sold),
            notify.order_changed(order.event_id),
        ],
    )


async def refund(session: AsyncSession, *, order_id: uuid.UUID, user_id: uuid.UUID) -> Result:
    """Cancel a paid order and return its seats — unless anyone already got in."""
    order = await _owned_order(session, order_id, user_id)
    async with transaction(session):
        await _lock_ticket_type(session, order.ticket_type_id)
        won = await session.scalar(
            sa.update(Order)
            .where(Order.id == order.id, Order.status == "paid")
            .values(status="refunded")
            .returning(Order.id)
            .execution_options(**NO_SYNC)
        )
        if won is None:
            raise DomainError(409, "order_not_paid")
        cancelled = (
            await session.execute(
                sa.update(Ticket)
                .where(Ticket.order_id == order.id, Ticket.status == "confirmed")
                .values(status="cancelled")
                .returning(Ticket.id)
                .execution_options(**NO_SYNC)
            )
        ).scalars().all()
        # Guarded against a concurrent door scan: if any ticket was checked in (before
        # or racing with us), it no longer matched status='confirmed'. Refunding
        # someone who attended is not allowed, so roll the whole refund back.
        if len(cancelled) != order.quantity:
            raise DomainError(409, "already_checked_in")
        capacity, sold = await _adjust_sold(session, order.ticket_type_id, -len(cancelled))
    payments.refund(order.payment_ref)
    log.info("order refunded", extra={"ctx": {"order_id": str(order.id)}})
    return Result(
        order_id=order.id,
        notifications=[
            notify.seats(order.event_id, order.ticket_type_id, capacity, sold),
            notify.order_changed(order.event_id),
        ],
    )


async def set_capacity(
    session: AsyncSession, *, ticket_type_id: uuid.UUID, capacity: int
) -> list[Notification]:
    """Raise capacity freely; lowering it below what's already claimed is rejected."""
    async with transaction(session):
        tt = await _lock_ticket_type(session, ticket_type_id)
        if tt is None:
            raise DomainError(404, "ticket_type_not_found")
        sold = tt.sold - await expire_due_holds(session, tt.id)
        if capacity < sold:
            raise DomainError(409, "capacity_below_sold", sold=sold)
        await session.execute(
            sa.update(TicketType)
            .where(TicketType.id == tt.id)
            .values(capacity=capacity)
            .execution_options(**NO_SYNC)
        )
    return [notify.seats(tt.event_id, tt.id, capacity, sold)]


async def cancel_event(session: AsyncSession, *, event_id: uuid.UUID) -> list[Notification]:
    """Cancel an event: release holds, refund paid orders, return every seat.

    Orders where someone was already checked in are left paid (not refunded).
    """
    async with transaction(session):
        type_rows = (
            await session.execute(
                sa.select(TicketType.id)
                .where(TicketType.event_id == event_id)
                .order_by(TicketType.id)  # consistent lock order across types
                .with_for_update()
            )
        ).scalars().all()
        won = await session.scalar(
            sa.update(Event)
            .where(Event.id == event_id, Event.status.in_(("draft", "published")))
            .values(status="cancelled")
            .returning(Event.id)
            .execution_options(**NO_SYNC)
        )
        if won is None:
            raise DomainError(409, "event_not_cancellable")
        refunds = (
            await session.execute(
                sa.update(Order)
                .where(
                    Order.event_id == event_id,
                    Order.status == "paid",
                    ~sa.exists().where(Ticket.order_id == Order.id, Ticket.status == "checked_in"),
                )
                .values(status="refunded")
                .returning(Order.payment_ref)
                .execution_options(**NO_SYNC)
            )
        ).scalars().all()
        await session.execute(
            sa.update(Order)
            .where(Order.event_id == event_id, Order.status == "pending")
            .values(status="cancelled")
            .execution_options(**NO_SYNC)
        )
        if type_rows:
            await session.execute(
                sa.update(Ticket)
                .where(Ticket.ticket_type_id.in_(type_rows), Ticket.status.in_(("held", "confirmed")))
                .values(status="cancelled", expires_at=None)
                .execution_options(**NO_SYNC)
            )
            active = (
                sa.select(sa.func.count())
                .select_from(Ticket)
                .where(Ticket.ticket_type_id == TicketType.id, Ticket.status.in_(ACTIVE_TICKET_STATUSES))
                .scalar_subquery()
            )
            await session.execute(
                sa.update(TicketType)
                .where(TicketType.event_id == event_id)
                .values(sold=active)
                .execution_options(**NO_SYNC)
            )
    for ref in refunds:
        payments.refund(ref)
    log.info("event cancelled", extra={"ctx": {"event_id": str(event_id), "refunds": len(refunds)}})
    return [notify.Notification(event_id, {"type": "event", "status": "cancelled"})]

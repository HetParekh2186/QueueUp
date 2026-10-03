"""Joining and leaving the waitlist. Promotion itself lives in inventory.py, inside the
ticket-type lock, next to everything else that moves seats."""

import uuid
from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.config import settings
from app.db import transaction
from app.errors import DomainError
from app.models import Event, Ticket, WaitlistEntry
from app.notifications import Notification
from app.services.inventory import (
    ACTIVE_TICKET_STATUSES,
    _lock_ticket_type,
    expire_due_holds,
    settle,
    waitlist_waiting,
)


@dataclass
class Joined:
    entry_id: uuid.UUID
    notifications: list[Notification]


def position_expr() -> sa.ScalarSelect:
    """1-based place in line for the WaitlistEntry row being selected: waiting entries
    for the same ticket type that arrived no later (id breaks ties)."""
    ahead = aliased(WaitlistEntry)
    return (
        sa.select(sa.func.count())
        .select_from(ahead)
        .where(
            ahead.ticket_type_id == WaitlistEntry.ticket_type_id,
            ahead.status == "waiting",
            sa.tuple_(ahead.created_at, ahead.id) <= sa.tuple_(WaitlistEntry.created_at, WaitlistEntry.id),
        )
        .correlate(WaitlistEntry)
        .scalar_subquery()
    )


async def join(
    session: AsyncSession, *, user_id: uuid.UUID, event_id: uuid.UUID, ticket_type_id: uuid.UUID, quantity: int
) -> Joined:
    if not 1 <= quantity <= settings.max_waitlist_quantity:
        raise DomainError(422, "invalid_quantity", max=settings.max_waitlist_quantity)
    # Freed seats reach people already in line before we decide whether this person
    # needs to queue at all.
    settled = await settle(session, ticket_type_id)
    try:
        async with transaction(session):
            tt = await _lock_ticket_type(session, ticket_type_id)
            if tt is None or tt.event_id != event_id:
                raise DomainError(404, "ticket_type_not_found")
            status = await session.scalar(sa.select(Event.status).where(Event.id == event_id))
            if status != "published":
                raise DomainError(409, "event_not_on_sale", event_status=status)
            sold = tt.sold - await expire_due_holds(session, tt.id)
            if tt.capacity - sold >= quantity and not await waitlist_waiting(session, tt.id):
                raise DomainError(409, "seats_available", remaining=tt.capacity - sold)
            active = await session.scalar(
                sa.select(sa.func.count())
                .select_from(Ticket)
                .where(Ticket.ticket_type_id == tt.id, Ticket.user_id == user_id, Ticket.status.in_(ACTIVE_TICKET_STATUSES))
            )
            if active + quantity > settings.max_active_tickets_per_type:
                raise DomainError(409, "per_user_limit", limit=settings.max_active_tickets_per_type, active=active)
            entry_id = await session.scalar(
                sa.insert(WaitlistEntry)
                .values(ticket_type_id=tt.id, user_id=user_id, quantity=quantity)
                .returning(WaitlistEntry.id)
            )
    except IntegrityError as exc:
        if "ux_waitlist_one_active" in str(exc.orig):
            raise DomainError(409, "already_waiting") from None
        raise
    return Joined(entry_id=entry_id, notifications=[*settled])


async def leave(session: AsyncSession, *, user_id: uuid.UUID, entry_id: uuid.UUID) -> None:
    async with transaction(session):
        row = (
            await session.execute(
                sa.select(WaitlistEntry.user_id, WaitlistEntry.status, WaitlistEntry.order_id).where(
                    WaitlistEntry.id == entry_id
                )
            )
        ).first()
        if row is None or row.user_id != user_id:
            raise DomainError(404, "waitlist_entry_not_found")
        if row.status == "offered":
            # Their seat is already held: giving it back is releasing that order.
            raise DomainError(409, "offer_pending", order_id=row.order_id)
        left = await session.scalar(
            sa.update(WaitlistEntry)
            .where(WaitlistEntry.id == entry_id, WaitlistEntry.status == "waiting")
            .values(status="left")
            .returning(WaitlistEntry.id)
            .execution_options(synchronize_session=False)
        )
        if left is None:
            raise DomainError(409, "not_waiting", status=row.status)


def waiting_count(ticket_type_col) -> sa.ScalarSelect:
    return (
        sa.select(sa.func.count())
        .select_from(WaitlistEntry)
        .where(WaitlistEntry.ticket_type_id == ticket_type_col, WaitlistEntry.status == "waiting")
        .scalar_subquery()
    )


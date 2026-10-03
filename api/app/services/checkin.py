"""Door check-in. The mirror of the reservation race: the same ticket scanned at two
doors at once must check in exactly once."""

import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app import notifications as notify
from app.db import transaction
from app.models import CheckInEvent, Ticket, TicketType, User
from app.notifications import Notification
from app.security import TokenError, verify_qr

log = logging.getLogger("queueup.checkin")


@dataclass
class Verdict:
    status_code: int
    body: dict[str, Any]
    notifications: list[Notification] = field(default_factory=list)


async def checked_in_count(session: AsyncSession, event_id: uuid.UUID) -> int:
    return await session.scalar(
        sa.select(sa.func.count())
        .select_from(Ticket)
        .join(TicketType, TicketType.id == Ticket.ticket_type_id)
        .where(TicketType.event_id == event_id, Ticket.status == "checked_in")
    )


async def check_in(
    session: AsyncSession, *, staff_id: uuid.UUID, door_event_id: uuid.UUID, qr: str
) -> Verdict:
    """Caller has already verified the staff member may scan for ``door_event_id``."""

    async def record(ticket_id: uuid.UUID | None, result: str, reason: str | None = None) -> None:
        session.add(
            CheckInEvent(
                event_id=door_event_id, ticket_id=ticket_id, staff_id=staff_id, result=result, reason=reason
            )
        )
        log.info(
            "scan",
            extra={"ctx": {"event_id": str(door_event_id), "ticket_id": str(ticket_id), "result": result, "reason": reason}},
        )

    async with transaction(session):
        # 1. Forgery: without the server's QR secret the signature won't verify.
        try:
            ticket_id, token_event_id = verify_qr(qr)
        except TokenError:
            await record(None, "invalid", "signature")
            return Verdict(422, {"result": "invalid", "reason": "signature"})

        # 2. A valid ticket, but for some other event's door.
        if token_event_id != door_event_id:
            await record(None, "invalid", "wrong_event")
            return Verdict(422, {"result": "invalid", "reason": "wrong_event"})

        holder = aliased(User)
        row = (
            await session.execute(
                sa.select(TicketType.event_id, TicketType.name.label("ticket_type"), holder.display_name)
                .select_from(Ticket)
                .join(TicketType, TicketType.id == Ticket.ticket_type_id)
                .join(holder, holder.id == Ticket.user_id)
                .where(Ticket.id == ticket_id)
            )
        ).first()
        if row is None or row.event_id != door_event_id:
            await record(None, "invalid", "unknown_ticket")
            return Verdict(422, {"result": "invalid", "reason": "unknown_ticket"})

        # 3. The guarded write. Two simultaneous scans both reach this line; the row
        # lock serializes them, and only the first still sees status='confirmed'.
        admitted_at = await session.scalar(
            sa.update(Ticket)
            .where(Ticket.id == ticket_id, Ticket.status == "confirmed")
            .values(status="checked_in", checked_in_at=sa.func.now(), checked_in_by=staff_id)
            .returning(Ticket.checked_in_at)
            .execution_options(synchronize_session=False)
        )
        if admitted_at is not None:
            await record(ticket_id, "admitted")
            count = await checked_in_count(session, door_event_id)
            return Verdict(
                200,
                {
                    "result": "admitted",
                    "attendee": row.display_name,
                    "ticket_type": row.ticket_type,
                    "checked_in_at": admitted_at,
                },
                [notify.checkin(door_event_id, count)],
            )

        # 4. Lost the guard: work out why, for a useful message at the door.
        scanner = aliased(User)
        current = (
            await session.execute(
                sa.select(Ticket.status, Ticket.checked_in_at, scanner.display_name.label("scanned_by"))
                .outerjoin(scanner, scanner.id == Ticket.checked_in_by)
                .where(Ticket.id == ticket_id)
            )
        ).one()
        if current.status == "checked_in":
            await record(ticket_id, "already_used")
            return Verdict(
                409,
                {
                    "result": "already_used",
                    "attendee": row.display_name,
                    "ticket_type": row.ticket_type,
                    "checked_in_at": current.checked_in_at,
                    "checked_in_by": current.scanned_by,
                },
            )
        reason = "cancelled" if current.status == "cancelled" else "not_paid"
        await record(ticket_id, "invalid", reason)
        return Verdict(422, {"result": "invalid", "reason": reason, "attendee": row.display_name})

import uuid

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import get_current_user
from app.models import Event, Order, TicketType, User, WaitlistEntry
from app.ratelimit import RateLimit
from app.realtime import publisher
from app.schemas import WaitlistIn, WaitlistOut
from app.services import waitlist

router = APIRouter(tags=["waitlist"])


def _query():
    return (
        sa.select(
            WaitlistEntry,
            TicketType.name,
            Event.id,
            Event.title,
            Event.status,
            Event.starts_at,
            Event.timezone,
            Order.expires_at,
            waitlist.position_expr(),
        )
        .join(TicketType, TicketType.id == WaitlistEntry.ticket_type_id)
        .join(Event, Event.id == TicketType.event_id)
        .outerjoin(Order, Order.id == WaitlistEntry.order_id)
    )


def _out(row) -> WaitlistOut:
    e, type_name, event_id, title, event_status, starts_at, tz, offer_expires, position = row
    return WaitlistOut(
        id=e.id, event_id=event_id, event_title=title, event_status=event_status, starts_at=starts_at,
        timezone=tz, ticket_type_id=e.ticket_type_id, ticket_type=type_name, quantity=e.quantity,
        status=e.status, position=position if e.status == "waiting" else None, order_id=e.order_id,
        offer_expires_at=offer_expires if e.status == "offered" else None, created_at=e.created_at,
    )


@router.post(
    "/events/{event_id}/waitlist",
    response_model=WaitlistOut,
    status_code=201,
    dependencies=[Depends(RateLimit("waitlist", 20, 60, per="user"))],
)
async def join_waitlist(
    event_id: uuid.UUID,
    body: WaitlistIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WaitlistOut:
    joined = await waitlist.join(
        session, user_id=user.id, event_id=event_id, ticket_type_id=body.ticket_type_id, quantity=body.quantity
    )
    await publisher.publish(joined.notifications)
    row = (await session.execute(_query().where(WaitlistEntry.id == joined.entry_id))).one()
    return _out(row)


@router.delete("/waitlist/{entry_id}", status_code=204)
async def leave_waitlist(
    entry_id: uuid.UUID, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Response:
    await waitlist.leave(session, user_id=user.id, entry_id=entry_id)
    return Response(status_code=204)


@router.get("/me/waitlist", response_model=list[WaitlistOut])
async def my_waitlist(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    """Your places in line, and any seats the waitlist is holding for you. Settled
    entries (claimed, expired, left) from the last 30 days are included for context."""
    rows = (
        await session.execute(
            _query()
            .where(
                WaitlistEntry.user_id == user.id,
                sa.or_(
                    WaitlistEntry.status.in_(("waiting", "offered")),
                    WaitlistEntry.created_at > sa.func.now() - sa.text("interval '30 days'"),
                ),
            )
            .order_by(Event.starts_at, WaitlistEntry.created_at)
        )
    ).all()
    return [_out(r) for r in rows]


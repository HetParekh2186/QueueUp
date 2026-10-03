import uuid

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import get_current_user
from app.errors import DomainError
from app.models import Event, Order, Ticket, TicketType, User
from app.ratelimit import RateLimit
from app.realtime import publisher
from app.schemas import ConfirmIn, OrderOut, ReserveIn, TicketOut
from app.security import sign_qr
from app.services import inventory

router = APIRouter(tags=["orders"])

QR_STATUSES = ("confirmed", "checked_in")


def ticket_query():
    return (
        sa.select(
            Ticket.id, Ticket.status, Ticket.order_id, Ticket.checked_in_at,
            TicketType.name.label("ticket_type"),
            Event.id.label("event_id"), Event.title.label("event_title"), Event.status.label("event_status"),
            Event.starts_at, Event.timezone, Event.venue,
        )
        .join(TicketType, TicketType.id == Ticket.ticket_type_id)
        .join(Event, Event.id == TicketType.event_id)
    )


def ticket_out(row) -> TicketOut:
    return TicketOut(
        id=row.id, status=row.status, order_id=row.order_id, checked_in_at=row.checked_in_at,
        ticket_type=row.ticket_type, event_id=row.event_id, event_title=row.event_title,
        event_status=row.event_status, starts_at=row.starts_at, timezone=row.timezone, venue=row.venue,
        # Only paid tickets get a QR; a held ticket has nothing to show at the door.
        qr=sign_qr(row.id, row.event_id) if row.status in QR_STATUSES else None,
    )


async def load_order(session: AsyncSession, order_id: uuid.UUID, user_id: uuid.UUID) -> OrderOut:
    row = (
        await session.execute(
            sa.select(Order, Event.title, TicketType.name, TicketType.price_cents, sa.func.now())
            .join(Event, Event.id == Order.event_id)
            .join(TicketType, TicketType.id == Order.ticket_type_id)
            .where(Order.id == order_id)
        )
    ).first()
    if row is None or row[0].user_id != user_id:
        raise DomainError(404, "order_not_found")
    order, title, type_name, price, now = row
    tickets = (await session.execute(ticket_query().where(Ticket.order_id == order.id).order_by(Ticket.id))).all()
    return OrderOut(
        id=order.id, event_id=order.event_id, event_title=title, ticket_type_id=order.ticket_type_id,
        ticket_type=type_name, quantity=order.quantity, status=order.status,
        total_cents=price * order.quantity, expires_at=order.expires_at, server_now=now,
        tickets=[ticket_out(t) for t in tickets],
    )


@router.post(
    "/events/{event_id}/reservations",
    response_model=OrderOut,
    status_code=201,
    dependencies=[Depends(RateLimit("reserve", 20, 60, per="user"))],
)
async def reserve(
    event_id: uuid.UUID,
    body: ReserveIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> OrderOut:
    result = await inventory.reserve(
        session,
        user_id=user.id,
        event_id=event_id,
        ticket_type_id=body.ticket_type_id,
        quantity=body.quantity,
        idempotency_key=body.idempotency_key,
    )
    await publisher.publish(result.notifications)  # after commit, never before
    return await load_order(session, result.order_id, user.id)


@router.get("/orders/{order_id}", response_model=OrderOut)
async def get_order(
    order_id: uuid.UUID, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> OrderOut:
    return await load_order(session, order_id, user.id)


@router.post("/orders/{order_id}/confirm", response_model=OrderOut)
async def confirm(
    order_id: uuid.UUID,
    body: ConfirmIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> OrderOut:
    result = await inventory.confirm(session, order_id=order_id, user_id=user.id, payment_token=body.payment_token)
    await publisher.publish(result.notifications)
    return await load_order(session, order_id, user.id)


@router.delete("/orders/{order_id}", status_code=204)
async def release(
    order_id: uuid.UUID, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Response:
    result = await inventory.release(session, order_id=order_id, user_id=user.id)
    await publisher.publish(result.notifications)
    return Response(status_code=204)


@router.post("/orders/{order_id}/refund", response_model=OrderOut)
async def refund(
    order_id: uuid.UUID, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> OrderOut:
    result = await inventory.refund(session, order_id=order_id, user_id=user.id)
    await publisher.publish(result.notifications)
    return await load_order(session, order_id, user.id)

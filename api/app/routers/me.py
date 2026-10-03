import sqlalchemy as sa
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import get_current_user
from app.models import Event, Order, StaffAssignment, Ticket, User
from app.routers.events import _summaries, _summary_query
from app.routers.orders import load_order, ticket_out, ticket_query
from app.schemas import EventSummary, OrderOut, TicketOut

router = APIRouter(prefix="/me", tags=["me"])


@router.get("/tickets", response_model=list[TicketOut])
async def my_tickets(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    rows = (
        await session.execute(
            ticket_query()
            .where(Ticket.user_id == user.id, Ticket.status.in_(("confirmed", "checked_in", "cancelled")))
            .order_by(Event.starts_at, Ticket.id)
        )
    ).all()
    return [ticket_out(r) for r in rows]


@router.get("/holds", response_model=list[OrderOut])
async def my_active_holds(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    """Unpaid holds still inside their window, so a user can get back to checkout."""
    ids = (
        await session.execute(
            sa.select(Order.id)
            .where(Order.user_id == user.id, Order.status == "pending", Order.expires_at > sa.func.now())
            .order_by(Order.expires_at)
        )
    ).scalars().all()
    return [await load_order(session, order_id, user.id) for order_id in ids]


@router.get("/events", response_model=list[EventSummary])
async def my_events(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    """Events I organize (every status, including drafts)."""
    rows = (
        await session.execute(_summary_query().where(Event.organizer_id == user.id).order_by(Event.starts_at.desc()))
    ).all()
    return _summaries(rows)


@router.get("/staff-events", response_model=list[EventSummary])
async def my_staff_events(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    """Events I'm assigned to scan at."""
    rows = (
        await session.execute(
            _summary_query()
            .join(StaffAssignment, StaffAssignment.event_id == Event.id)
            .where(StaffAssignment.user_id == user.id, Event.status != "draft")
            .order_by(Event.starts_at)
        )
    ).all()
    return _summaries(rows)

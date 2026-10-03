"""Platform administration. Every route requires an admin, and only the ADMIN_EMAILS
setting makes admins: nothing in this router can grant admin to anyone."""

import uuid
from typing import Literal

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_session
from app.deps import get_event_or_404, require_admin
from app.errors import DomainError
from app.models import Event, Order, Ticket, TicketType, User
from app.realtime import publisher
from app.routers.events import _event_stats, _like, _summaries, _summary_query
from app.schemas import (
    AdminEventList,
    AdminStats,
    AdminUserList,
    AdminUserOut,
    AdminUserPatch,
    SuspendIn,
    UserOut,
)
from app.services import inventory

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])

ACTIVE = ("confirmed", "checked_in")


@router.get("/stats", response_model=AdminStats)
async def stats(session: AsyncSession = Depends(get_session)) -> AdminStats:
    admins = list(settings.admin_email_set) or [""]
    not_admin = sa.func.lower(User.email).not_in(admins)
    users = (
        await session.execute(
            sa.select(
                sa.func.count(),
                sa.func.count().filter(User.role == "organizer", not_admin),
                sa.func.count().filter(User.organizer_requested_at.is_not(None), User.role == "user", not_admin),
                sa.func.count().filter(User.is_suspended),
            )
        )
    ).one()
    by_status = dict((await session.execute(sa.select(Event.status, sa.func.count()).group_by(Event.status))).all())
    sold, checked_in = (
        await session.execute(
            sa.select(
                sa.func.count().filter(Ticket.status.in_(ACTIVE)),
                sa.func.count().filter(Ticket.status == "checked_in"),
            )
        )
    ).one()
    revenue = await session.scalar(
        sa.select(sa.func.coalesce(sa.func.sum(TicketType.price_cents * Order.quantity), 0))
        .select_from(Order)
        .join(TicketType, TicketType.id == Order.ticket_type_id)
        .where(Order.status == "paid")
    )
    return AdminStats(
        users=users[0], organizers=users[1], pending_requests=users[2], suspended=users[3],
        events_by_status={s: by_status.get(s, 0) for s in ("draft", "published", "ended", "cancelled")},
        tickets_sold=sold, checked_in=checked_in, revenue_cents=revenue,
    )


def _admin_user(u: User, events: int, tickets: int) -> AdminUserOut:
    out = AdminUserOut.model_validate(u)
    out.events_organized, out.tickets_held = events, tickets
    return out


@router.get("/users", response_model=AdminUserList)
async def list_users(
    q: str | None = Query(None, max_length=100, description="Match name or email"),
    role: Literal["user", "organizer", "admin"] | None = None,
    requested: bool = Query(False, description="Only users waiting for organizer approval"),
    suspended: bool | None = None,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> AdminUserList:
    events = sa.select(sa.func.count()).select_from(Event).where(Event.organizer_id == User.id).scalar_subquery()
    tickets = (
        sa.select(sa.func.count())
        .select_from(Ticket)
        .where(Ticket.user_id == User.id, Ticket.status.in_(ACTIVE))
        .scalar_subquery()
    )
    admins = list(settings.admin_email_set) or [""]
    stmt = sa.select(User, events, tickets)
    if q and q.strip():
        pattern = _like(q.strip())
        stmt = stmt.where(sa.or_(User.display_name.ilike(pattern, escape="\\"), User.email.ilike(pattern, escape="\\")))
    if role == "admin":
        stmt = stmt.where(sa.func.lower(User.email).in_(admins))
    elif role:
        stmt = stmt.where(User.role == role, sa.func.lower(User.email).not_in(admins))
    if requested:
        stmt = stmt.where(
            User.organizer_requested_at.is_not(None), User.role == "user", sa.func.lower(User.email).not_in(admins)
        )
    if suspended is not None:
        stmt = stmt.where(User.is_suspended.is_(suspended))
    total = await session.scalar(sa.select(sa.func.count()).select_from(stmt.subquery()))
    rows = (
        await session.execute(
            # Pending organizer requests first, then the newest accounts.
            stmt.order_by(User.organizer_requested_at.desc().nulls_last(), User.created_at.desc(), User.id)
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return AdminUserList(items=[_admin_user(u, e, t) for u, e, t in rows], total=total)


@router.patch("/users/{user_id}", response_model=AdminUserOut)
async def update_user(
    user_id: uuid.UUID,
    body: AdminUserPatch,
    session: AsyncSession = Depends(get_session),
) -> AdminUserOut:
    target = await session.get(User, user_id)
    if target is None:
        raise DomainError(404, "user_not_found")
    if target.is_admin:
        # Admins are defined by configuration; the panel can't demote or suspend one.
        raise DomainError(409, "admin_is_configured", hint="change ADMIN_EMAILS on the server")
    if body.role is not None:
        target.role = body.role
        target.organizer_requested_at = None  # approving or changing the role settles a request
    if body.decline_request:
        target.organizer_requested_at = None
    if body.suspended is not None:
        target.is_suspended = body.suspended
    await session.commit()
    events = await session.scalar(sa.select(sa.func.count()).where(Event.organizer_id == target.id))
    tickets = await session.scalar(
        sa.select(sa.func.count()).where(Ticket.user_id == target.id, Ticket.status.in_(ACTIVE))
    )
    return _admin_user(target, events, tickets)


@router.get("/events", response_model=AdminEventList)
async def list_all_events(
    q: str | None = Query(None, max_length=100),
    status: Literal["draft", "published", "ended", "cancelled"] | None = None,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> AdminEventList:
    """Every event in every state, drafts included, latest start first."""
    stmt = _summary_query(_event_stats())
    if q and q.strip():
        pattern = _like(q.strip())
        stmt = stmt.where(sa.or_(Event.title.ilike(pattern, escape="\\"), Event.venue.ilike(pattern, escape="\\")))
    if status:
        stmt = stmt.where(Event.status == status)
    total = await session.scalar(sa.select(sa.func.count()).select_from(stmt.subquery()))
    rows = (await session.execute(stmt.order_by(Event.starts_at.desc(), Event.id).limit(limit).offset(offset))).all()
    return AdminEventList(items=_summaries(rows), total=total)


@router.post("/users/{user_id}/suspend", response_model=UserOut)
async def suspend_user(
    user_id: uuid.UUID, body: SuspendIn, session: AsyncSession = Depends(get_session)
) -> UserOut:
    """Shorthand for PATCH /admin/users/{id} {"suspended": ...}."""
    return await update_user(user_id, AdminUserPatch(suspended=body.suspended), session)


@router.post("/events/{event_id}/suspend", status_code=204)
async def suspend_event(event_id: uuid.UUID, session: AsyncSession = Depends(get_session)) -> None:
    await get_event_or_404(session, event_id)
    await session.rollback()
    await publisher.publish(await inventory.cancel_event(session, event_id=event_id))

"""Authentication and per-event authorization.

Roles relative to an event come from data, not from the token: an organizer is the
user in ``events.organizer_id``; staff are rows in ``staff_assignments``. Every
protected route re-checks this server-side on every request.
"""

import uuid

import sqlalchemy as sa
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Event, StaffAssignment, User
from app.security import TokenError, decode_token

bearer = HTTPBearer(auto_error=False)


async def user_from_token(session: AsyncSession, token: str) -> User | None:
    try:
        user_id = decode_token(token, "access")
    except TokenError:
        return None
    user = await session.get(User, user_id)
    if user is None or user.is_suspended:
        return None
    # Detach so later rollbacks in this request's session can't expire it (an expired
    # instance would try to lazy-load, which async sessions forbid).
    session.expunge(user)
    return user


async def get_optional_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: AsyncSession = Depends(get_session),
) -> User | None:
    if creds is None:
        return None
    return await user_from_token(session, creds.credentials)


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: AsyncSession = Depends(get_session),
) -> User:
    if creds is None:
        raise HTTPException(401, {"error": "not_authenticated"}, headers={"WWW-Authenticate": "Bearer"})
    user = await user_from_token(session, creds.credentials)
    if user is None:
        raise HTTPException(401, {"error": "invalid_token"}, headers={"WWW-Authenticate": "Bearer"})
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(403, {"error": "forbidden"})
    return user


async def get_event_or_404(session: AsyncSession, event_id: uuid.UUID) -> Event:
    event = await session.get(Event, event_id)
    if event is None:
        raise HTTPException(404, {"error": "event_not_found"})
    return event


def can_manage(user: User | None, event: Event) -> bool:
    return user is not None and (user.is_admin or event.organizer_id == user.id)


async def can_scan(session: AsyncSession, user: User | None, event: Event) -> bool:
    if user is None:
        return False
    if can_manage(user, event):
        return True
    assigned = await session.scalar(
        sa.select(sa.literal(True)).where(
            StaffAssignment.event_id == event.id, StaffAssignment.user_id == user.id
        )
    )
    return bool(assigned)


async def managed_event(session: AsyncSession, user: User, event_id: uuid.UUID) -> Event:
    event = await get_event_or_404(session, event_id)
    if not can_manage(user, event):
        raise HTTPException(403, {"error": "forbidden"})
    return event


async def scannable_event(session: AsyncSession, user: User, event_id: uuid.UUID) -> Event:
    event = await get_event_or_404(session, event_id)
    if not await can_scan(session, user, event):
        raise HTTPException(403, {"error": "not_assigned"})
    return event

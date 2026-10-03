import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import get_event_or_404, require_admin
from app.errors import DomainError
from app.models import User
from app.realtime import publisher
from app.schemas import SuspendIn, UserOut
from app.services import inventory

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/users/{user_id}/suspend", response_model=UserOut)
async def suspend_user(
    user_id: uuid.UUID,
    body: SuspendIn,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> User:
    target = await session.get(User, user_id)
    if target is None:
        raise DomainError(404, "user_not_found")
    if target.id == admin.id:
        raise DomainError(409, "cannot_suspend_self")
    target.is_suspended = body.suspended
    await session.commit()
    return target


@router.post("/events/{event_id}/suspend", status_code=204)
async def suspend_event(
    event_id: uuid.UUID, _: User = Depends(require_admin), session: AsyncSession = Depends(get_session)
) -> None:
    await get_event_or_404(session, event_id)
    await session.rollback()
    await publisher.publish(await inventory.cancel_event(session, event_id=event_id))

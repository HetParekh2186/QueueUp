from fastapi import APIRouter, Depends
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import get_current_user, scannable_event
from app.models import User
from app.ratelimit import RateLimit
from app.realtime import publisher
from app.schemas import CheckinIn
from app.services.checkin import check_in

router = APIRouter(tags=["check-in"])


@router.post("/checkins", dependencies=[Depends(RateLimit("checkin", 600, 60, per="user"))])
async def scan(
    body: CheckinIn, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> JSONResponse:
    # Scoping runs before any scan logic: unassigned staff get a 403, not a verdict.
    await scannable_event(session, user, body.event_id)
    await session.rollback()
    verdict = await check_in(session, staff_id=user.id, door_event_id=body.event_id, qr=body.qr)
    await publisher.publish(verdict.notifications)
    return JSONResponse(status_code=verdict.status_code, content=jsonable_encoder(verdict.body))

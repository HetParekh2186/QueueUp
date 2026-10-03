"""Public platform totals for the landing page. Counts only: nothing personal."""

import time

import sqlalchemy as sa
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.demo import DEMO_DOMAIN
from app.models import Event, Ticket, TicketType, User
from app.schemas import PublicStats

router = APIRouter(tags=["stats"])

# Every landing-page visitor polls this, so serve a few-seconds-old answer from memory
# rather than recounting on every request. Per worker; staleness is bounded by the TTL.
TTL_SECONDS = 5.0
_cache: tuple[float, PublicStats] | None = None


async def compute(session: AsyncSession) -> PublicStats:
    sold, checked_in = (
        await session.execute(
            sa.select(
                sa.func.count().filter(Ticket.status.in_(("confirmed", "checked_in"))),
                sa.func.count().filter(Ticket.status == "checked_in"),
            )
        )
    ).one()
    on_sale = await session.scalar(sa.select(sa.func.count()).where(Event.status == "published"))
    demo = await session.scalar(
        sa.select(
            sa.exists()
            .where(TicketType.event_id == Event.id)
            .where(Event.organizer_id == User.id, User.email.ilike(f"%{DEMO_DOMAIN}"))
        )
    )
    return PublicStats(tickets_sold=sold, checked_in=checked_in, events_on_sale=on_sale, includes_demo=bool(demo))


@router.get("/stats", response_model=PublicStats)
async def public_stats(session: AsyncSession = Depends(get_session)) -> PublicStats:
    global _cache
    now = time.monotonic()
    if _cache is None or now - _cache[0] > TTL_SECONDS:
        _cache = (now, await compute(session))
    return _cache[1]

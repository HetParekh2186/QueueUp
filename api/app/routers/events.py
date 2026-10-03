import base64
import csv
import io
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.db import get_session
from app.demo import DEMO_DOMAIN
from app.deps import (
    can_manage,
    can_scan,
    get_current_user,
    get_event_or_404,
    get_optional_user,
    managed_event,
    scannable_event,
)
from app.errors import DomainError
from app.models import CheckInEvent, Event, Order, StaffAssignment, Ticket, TicketType, User
from app.realtime import publisher
from app.schemas import (
    DashboardOut,
    EventIn,
    EventListOut,
    EventOut,
    EventPatch,
    EventSummary,
    ScanOut,
    StaffIn,
    StaffOut,
    TicketTypeIn,
    TicketTypeOut,
    TicketTypePatch,
    TicketTypeStats,
)
from app.services import inventory

router = APIRouter(tags=["events"])

PUBLIC_STATUSES = ("published", "ended", "cancelled")


def to_utc(local: datetime, tz: str) -> datetime:
    """Interpret a naive wall-clock time in the venue's zone. An offset-aware input is
    taken as-is (the client already resolved the instant)."""
    if local.tzinfo is not None:
        return local
    return local.replace(tzinfo=ZoneInfo(tz))


def _encode_cursor(starts_at: datetime, event_id: uuid.UUID) -> str:
    return base64.urlsafe_b64encode(f"{starts_at.isoformat()}|{event_id}".encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode()).decode()
        ts, eid = raw.split("|")
        return datetime.fromisoformat(ts), uuid.UUID(eid)
    except Exception:
        raise HTTPException(422, {"error": "bad_cursor"}) from None


async def _ticket_types(session: AsyncSession, event_id: uuid.UUID) -> list[TicketTypeOut]:
    rows = (
        await session.execute(
            sa.select(TicketType).where(TicketType.event_id == event_id).order_by(TicketType.price_cents, TicketType.name)
        )
    ).scalars().all()
    return [
        TicketTypeOut(
            id=t.id, name=t.name, price_cents=t.price_cents, capacity=t.capacity,
            sold=t.sold, remaining=max(t.capacity - t.sold, 0),
        )
        for t in rows
    ]


async def _event_out(session: AsyncSession, event: Event, user: User | None) -> EventOut:
    organizer_name = await session.scalar(sa.select(User.display_name).where(User.id == event.organizer_id))
    return EventOut(
        id=event.id, organizer_id=event.organizer_id, organizer_name=organizer_name or "",
        title=event.title, description=event.description, venue=event.venue,
        starts_at=event.starts_at, ends_at=event.ends_at, timezone=event.timezone, status=event.status,
        ticket_types=await _ticket_types(session, event.id),
        can_manage=can_manage(user, event), can_scan=await can_scan(session, user, event),
    )


def _summary_query():
    agg = (
        sa.select(
            TicketType.event_id,
            sa.func.min(TicketType.price_cents).label("min_price_cents"),
            sa.func.coalesce(sa.func.sum(TicketType.capacity - TicketType.sold), 0).label("remaining"),
            sa.func.coalesce(sa.func.sum(TicketType.capacity), 0).label("capacity"),
        )
        .group_by(TicketType.event_id)
        .subquery()
    )
    return (
        sa.select(Event, agg.c.min_price_cents, agg.c.remaining, agg.c.capacity, User.email)
        .outerjoin(agg, agg.c.event_id == Event.id)
        .join(User, User.id == Event.organizer_id)
    )



def _summaries(rows) -> list[EventSummary]:
    return [
        EventSummary(
            id=e.id, title=e.title, venue=e.venue, starts_at=e.starts_at, timezone=e.timezone,
            status=e.status, min_price_cents=mp, remaining=rem or 0, capacity=cap or 0,
            is_demo=email.lower().endswith(DEMO_DOMAIN),
        )
        for e, mp, rem, cap, email in rows
    ]


@router.get("/events", response_model=EventListOut)
async def list_events(
    limit: int = Query(20, ge=1, le=50),
    cursor: str | None = None,
    session: AsyncSession = Depends(get_session),
) -> EventListOut:
    """Published events, soonest first. Cursor pagination keyed on (starts_at, id), so a
    newly published event never shifts or duplicates items across pages."""
    q = _summary_query().where(Event.status == "published")
    if cursor:
        ts, eid = _decode_cursor(cursor)
        q = q.where(sa.tuple_(Event.starts_at, Event.id) > sa.tuple_(ts, eid))
    rows = (await session.execute(q.order_by(Event.starts_at, Event.id).limit(limit + 1))).all()
    items = _summaries(rows[:limit])
    next_cursor = _encode_cursor(items[-1].starts_at, items[-1].id) if len(rows) > limit else None
    return EventListOut(items=items, next_cursor=next_cursor)


@router.get("/events/{event_id}", response_model=EventOut)
async def get_event(
    event_id: uuid.UUID,
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> EventOut:
    event = await get_event_or_404(session, event_id)
    if event.status not in PUBLIC_STATUSES and not can_manage(user, event):
        raise HTTPException(404, {"error": "event_not_found"})  # drafts don't exist publicly
    return await _event_out(session, event, user)


@router.post("/events", response_model=EventOut, status_code=201)
async def create_event(
    body: EventIn, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> EventOut:
    starts_at = to_utc(body.starts_at_local, body.timezone)
    ends_at = to_utc(body.ends_at_local, body.timezone) if body.ends_at_local else None
    if ends_at and ends_at <= starts_at:
        raise DomainError(422, "ends_before_start")
    event = Event(
        organizer_id=user.id, title=body.title.strip(), description=body.description, venue=body.venue,
        starts_at=starts_at, ends_at=ends_at, timezone=body.timezone, status="draft",
    )
    session.add(event)
    await session.commit()
    await session.refresh(event)
    return await _event_out(session, event, user)


@router.patch("/events/{event_id}", response_model=EventOut)
async def update_event(
    event_id: uuid.UUID,
    body: EventPatch,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> EventOut:
    event = await managed_event(session, user, event_id)
    if event.status in ("cancelled", "ended"):
        raise DomainError(409, "event_closed", status=event.status)

    if body.status == "cancelled":
        await session.rollback()
        notes = await inventory.cancel_event(session, event_id=event_id)
        await publisher.publish(notes)
        await session.refresh(event)
        return await _event_out(session, event, user)

    fields = body.model_dump(exclude_unset=True, exclude={"status", "starts_at_local", "ends_at_local"})
    for key, value in fields.items():
        setattr(event, key, value)
    tz = event.timezone
    if body.starts_at_local is not None:
        event.starts_at = to_utc(body.starts_at_local, tz)
    if "ends_at_local" in body.model_fields_set:
        event.ends_at = to_utc(body.ends_at_local, tz) if body.ends_at_local else None
    if event.ends_at and event.ends_at <= event.starts_at:
        raise DomainError(422, "ends_before_start")

    if body.status == "published" and event.status == "draft":
        has_types = await session.scalar(sa.select(sa.func.count()).where(TicketType.event_id == event.id))
        if not has_types:
            raise DomainError(409, "no_ticket_types")
        if event.starts_at <= await session.scalar(sa.select(sa.func.now())):
            raise DomainError(409, "event_in_past")
        event.status = "published"
    await session.commit()
    await session.refresh(event)
    return await _event_out(session, event, user)


@router.delete("/events/{event_id}", status_code=204)
async def delete_event(
    event_id: uuid.UUID, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Response:
    event = await managed_event(session, user, event_id)
    # Once anyone has held a ticket, deleting would orphan attendees: cancel instead.
    has_orders = await session.scalar(sa.select(sa.func.count()).where(Order.event_id == event.id))
    if has_orders:
        raise DomainError(409, "event_has_orders", hint="cancel the event instead")
    await session.delete(event)
    await session.commit()
    return Response(status_code=204)


# --- ticket types -------------------------------------------------------------------


@router.post("/events/{event_id}/ticket-types", response_model=TicketTypeOut, status_code=201)
async def add_ticket_type(
    event_id: uuid.UUID,
    body: TicketTypeIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TicketTypeOut:
    event = await managed_event(session, user, event_id)
    if event.status not in ("draft", "published"):
        raise DomainError(409, "event_closed", status=event.status)
    tt = TicketType(event_id=event.id, name=body.name.strip(), price_cents=body.price_cents, capacity=body.capacity)
    session.add(tt)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise DomainError(409, "duplicate_ticket_type_name") from None
    await session.refresh(tt)
    return TicketTypeOut(id=tt.id, name=tt.name, price_cents=tt.price_cents, capacity=tt.capacity,
                         sold=tt.sold, remaining=tt.capacity - tt.sold)


@router.patch("/events/{event_id}/ticket-types/{ticket_type_id}", response_model=TicketTypeOut)
async def update_ticket_type(
    event_id: uuid.UUID,
    ticket_type_id: uuid.UUID,
    body: TicketTypePatch,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TicketTypeOut:
    await managed_event(session, user, event_id)
    tt = await session.get(TicketType, ticket_type_id)
    if tt is None or tt.event_id != event_id:
        raise DomainError(404, "ticket_type_not_found")
    if body.price_cents is not None and body.price_cents != tt.price_cents and tt.sold > 0:
        raise DomainError(409, "price_locked", hint="tickets already sold at the current price")
    if body.name is not None:
        tt.name = body.name.strip()
    if body.price_cents is not None:
        tt.price_cents = body.price_cents
    await session.commit()
    if body.capacity is not None:
        # Capacity goes through the locked path: never below what's already claimed.
        notes = await inventory.set_capacity(session, ticket_type_id=ticket_type_id, capacity=body.capacity)
        await publisher.publish(notes)
    await session.refresh(tt)
    return TicketTypeOut(id=tt.id, name=tt.name, price_cents=tt.price_cents, capacity=tt.capacity,
                         sold=tt.sold, remaining=max(tt.capacity - tt.sold, 0))


@router.delete("/events/{event_id}/ticket-types/{ticket_type_id}", status_code=204)
async def delete_ticket_type(
    event_id: uuid.UUID,
    ticket_type_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    await managed_event(session, user, event_id)
    tt = await session.get(TicketType, ticket_type_id)
    if tt is None or tt.event_id != event_id:
        raise DomainError(404, "ticket_type_not_found")
    if await session.scalar(sa.select(sa.func.count()).where(Order.ticket_type_id == tt.id)):
        raise DomainError(409, "ticket_type_has_orders")
    await session.delete(tt)
    await session.commit()
    return Response(status_code=204)


# --- staff --------------------------------------------------------------------------


@router.get("/events/{event_id}/staff", response_model=list[StaffOut])
async def list_staff(
    event_id: uuid.UUID, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> list[StaffOut]:
    await managed_event(session, user, event_id)
    rows = (
        await session.execute(
            sa.select(User.id, User.email, User.display_name)
            .join(StaffAssignment, StaffAssignment.user_id == User.id)
            .where(StaffAssignment.event_id == event_id)
            .order_by(User.display_name)
        )
    ).all()
    return [StaffOut(user_id=r.id, email=r.email, display_name=r.display_name) for r in rows]


@router.post("/events/{event_id}/staff", response_model=StaffOut, status_code=201)
async def assign_staff(
    event_id: uuid.UUID,
    body: StaffIn,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> StaffOut:
    await managed_event(session, user, event_id)
    staff = await session.scalar(sa.select(User).where(User.email == body.email))
    if staff is None:
        raise DomainError(404, "user_not_found", hint="they need a QueueUp account first")
    await session.execute(
        pg_insert(StaffAssignment)
        .values(event_id=event_id, user_id=staff.id)
        .on_conflict_do_nothing()
    )
    await session.commit()
    return StaffOut(user_id=staff.id, email=staff.email, display_name=staff.display_name)


@router.delete("/events/{event_id}/staff/{user_id}", status_code=204)
async def remove_staff(
    event_id: uuid.UUID,
    user_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    await managed_event(session, user, event_id)
    await session.execute(
        sa.delete(StaffAssignment).where(StaffAssignment.event_id == event_id, StaffAssignment.user_id == user_id)
    )
    await session.commit()
    return Response(status_code=204)


# --- dashboard & export -------------------------------------------------------------


@router.get("/events/{event_id}/dashboard", response_model=DashboardOut)
async def dashboard(
    event_id: uuid.UUID, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> DashboardOut:
    event = await scannable_event(session, user, event_id)
    types = (
        await session.execute(sa.select(TicketType).where(TicketType.event_id == event_id).order_by(TicketType.price_cents))
    ).scalars().all()
    counts = (
        await session.execute(
            sa.select(Ticket.ticket_type_id, Ticket.status, sa.func.count())
            .join(TicketType, TicketType.id == Ticket.ticket_type_id)
            .where(TicketType.event_id == event_id, Ticket.status.in_(("held", "confirmed", "checked_in")))
            .group_by(Ticket.ticket_type_id, Ticket.status)
        )
    ).all()
    by_type: dict[uuid.UUID, dict[str, int]] = {}
    for type_id, status, n in counts:
        by_type.setdefault(type_id, {})[status] = n

    stats = []
    for t in types:
        c = by_type.get(t.id, {})
        stats.append(
            TicketTypeStats(
                id=t.id, name=t.name, price_cents=t.price_cents, capacity=t.capacity,
                held=c.get("held", 0), confirmed=c.get("confirmed", 0), checked_in=c.get("checked_in", 0),
                remaining=max(t.capacity - t.sold, 0),
            )
        )
    revenue = await session.scalar(
        sa.select(sa.func.coalesce(sa.func.sum(TicketType.price_cents * Order.quantity), 0))
        .select_from(Order)
        .join(TicketType, TicketType.id == Order.ticket_type_id)
        .where(Order.event_id == event_id, Order.status == "paid")
    )

    attendee, staff = aliased(User), aliased(User)
    scans = (
        await session.execute(
            sa.select(CheckInEvent.scanned_at, CheckInEvent.result, CheckInEvent.reason,
                      attendee.display_name, staff.display_name)
            .join(staff, staff.id == CheckInEvent.staff_id)
            .outerjoin(Ticket, Ticket.id == CheckInEvent.ticket_id)
            .outerjoin(attendee, attendee.id == Ticket.user_id)
            .where(CheckInEvent.event_id == event_id)
            .order_by(CheckInEvent.scanned_at.desc())
            .limit(15)
        )
    ).all()
    return DashboardOut(
        event_id=event.id, status=event.status,
        capacity=sum(s.capacity for s in stats),
        held=sum(s.held for s in stats),
        confirmed=sum(s.confirmed for s in stats),
        checked_in=sum(s.checked_in for s in stats),
        remaining=sum(s.remaining for s in stats),
        revenue_cents=revenue,
        ticket_types=stats,
        recent_scans=[ScanOut(scanned_at=a, result=b, reason=c, attendee=d, staff=e) for a, b, c, d, e in scans],
    )


def _csv_safe(value) -> str:
    """Neutralize spreadsheet formula injection (a display name like '=HYPERLINK(...)')."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


@router.get("/events/{event_id}/attendees.csv")
async def attendees_csv(
    event_id: uuid.UUID, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Response:
    event = await managed_event(session, user, event_id)
    rows = (
        await session.execute(
            sa.select(User.display_name, User.email, TicketType.name, Ticket.id, Ticket.status,
                      Ticket.confirmed_at, Ticket.checked_in_at)
            .join(TicketType, TicketType.id == Ticket.ticket_type_id)
            .join(User, User.id == Ticket.user_id)
            .where(TicketType.event_id == event_id, Ticket.status.in_(("confirmed", "checked_in")))
            .order_by(User.display_name, Ticket.id)
        )
    ).all()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["name", "email", "ticket_type", "ticket_id", "status", "confirmed_at", "checked_in_at"])
    for r in rows:
        writer.writerow([_csv_safe(v) for v in r])
    slug = "".join(ch if ch.isalnum() else "-" for ch in event.title.lower()).strip("-")[:40] or "event"
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{slug}-attendees.csv"'},
    )

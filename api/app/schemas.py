import uuid
from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


def _check_tz(value: str | None) -> str | None:
    if value is None:
        return value
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError("must be an IANA time zone, e.g. 'America/Chicago'") from None
    return value


class Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- auth ---------------------------------------------------------------------------


class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=1, max_length=80)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=128)


class RefreshIn(BaseModel):
    refresh_token: str


class UserOut(Out):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: uuid.UUID
    email: str
    display_name: str
    # "user" | "organizer" | "admin". Admin is computed from ADMIN_EMAILS, never stored.
    role: str = Field(validation_alias="effective_role")
    is_admin: bool
    organizer_requested_at: datetime | None = None


class AdminUserOut(UserOut):
    is_suspended: bool
    created_at: datetime
    events_organized: int = 0
    tickets_held: int = 0


class AdminUserList(BaseModel):
    items: list[AdminUserOut]
    total: int


class AdminUserPatch(BaseModel):
    # Only these two can ever be granted here; "admin" is rejected by validation.
    role: Literal["user", "organizer"] | None = None
    suspended: bool | None = None
    decline_request: bool = False


class AdminStats(BaseModel):
    users: int
    organizers: int
    pending_requests: int
    suspended: int
    events_by_status: dict[str, int]
    tickets_sold: int
    checked_in: int
    revenue_cents: int



class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserOut


# --- events -------------------------------------------------------------------------


class EventIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    venue: str | None = Field(default=None, max_length=300)
    # Wall-clock time *at the venue* plus the venue's IANA zone. The server converts to
    # UTC, so "8pm in Chicago" means the same instant for every viewer.
    starts_at_local: datetime
    ends_at_local: datetime | None = None
    timezone: str

    _tz = field_validator("timezone")(_check_tz)


class EventPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    venue: str | None = Field(default=None, max_length=300)
    starts_at_local: datetime | None = None
    ends_at_local: datetime | None = None
    timezone: str | None = None
    status: Literal["published", "cancelled"] | None = None

    _tz = field_validator("timezone")(_check_tz)


class TicketTypeIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    price_cents: int = Field(ge=0, le=10_000_000)
    capacity: int = Field(ge=0, le=100_000)


class TicketTypePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    price_cents: int | None = Field(default=None, ge=0, le=10_000_000)
    capacity: int | None = Field(default=None, ge=0, le=100_000)


class TicketTypeOut(Out):
    id: uuid.UUID
    name: str
    price_cents: int
    capacity: int
    sold: int
    remaining: int


class EventSummary(Out):
    id: uuid.UUID
    title: str
    venue: str | None
    starts_at: datetime
    timezone: str
    status: str
    min_price_cents: int | None = None
    remaining: int = 0
    capacity: int = 0
    is_demo: bool = False


class EventListOut(BaseModel):
    items: list[EventSummary]
    next_cursor: str | None


class EventOut(Out):
    id: uuid.UUID
    organizer_id: uuid.UUID
    organizer_name: str
    title: str
    description: str | None
    venue: str | None
    starts_at: datetime
    ends_at: datetime | None
    timezone: str
    status: str
    ticket_types: list[TicketTypeOut]
    can_manage: bool = False
    can_scan: bool = False


class StaffIn(BaseModel):
    email: EmailStr


class StaffOut(Out):
    user_id: uuid.UUID
    email: str
    display_name: str


class TicketTypeStats(BaseModel):
    id: uuid.UUID
    name: str
    price_cents: int
    capacity: int
    held: int
    confirmed: int
    checked_in: int
    remaining: int


class ScanOut(BaseModel):
    scanned_at: datetime
    result: str
    reason: str | None
    attendee: str | None
    staff: str


class DashboardOut(BaseModel):
    event_id: uuid.UUID
    status: str
    capacity: int
    held: int
    confirmed: int
    checked_in: int
    remaining: int
    revenue_cents: int
    ticket_types: list[TicketTypeStats]
    recent_scans: list[ScanOut]


# --- orders & tickets ---------------------------------------------------------------


class ReserveIn(BaseModel):
    ticket_type_id: uuid.UUID
    quantity: int = Field(ge=1, le=100)  # tighter business cap enforced in the service
    idempotency_key: uuid.UUID


class ConfirmIn(BaseModel):
    payment_token: str = Field(default="tok_visa", max_length=200)


class TicketOut(BaseModel):
    id: uuid.UUID
    status: str
    qr: str | None = None
    ticket_type: str
    event_id: uuid.UUID
    event_title: str
    event_status: str
    starts_at: datetime
    timezone: str
    venue: str | None
    order_id: uuid.UUID
    checked_in_at: datetime | None = None


class OrderOut(BaseModel):
    id: uuid.UUID
    event_id: uuid.UUID
    event_title: str
    ticket_type_id: uuid.UUID
    ticket_type: str
    quantity: int
    status: str
    total_cents: int
    expires_at: datetime
    # The DB's clock at response time. The browser countdown is cosmetic, but using
    # server_now lets it correct for a skewed client clock.
    server_now: datetime
    tickets: list[TicketOut]


# --- check-in -----------------------------------------------------------------------


class CheckinIn(BaseModel):
    qr: str = Field(min_length=1, max_length=2048)
    event_id: uuid.UUID  # the event this door is scanning for


class SuspendIn(BaseModel):
    suspended: bool = True


class AdminEventList(BaseModel):
    items: list[EventSummary]
    total: int

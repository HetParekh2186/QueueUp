"""ORM mappings. The DDL itself (CHECK constraints, partial indexes) lives in the
Alembic migration, which is the source of truth for the schema."""

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Text, text
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import DateTime

from app.config import settings

UUID_PK = {"primary_key": True, "server_default": text("gen_random_uuid()")}


class Base(DeclarativeBase):
    type_annotation_map = {datetime: DateTime(timezone=True)}


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(**UUID_PK)
    email: Mapped[str] = mapped_column(CITEXT, unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    display_name: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(Text, server_default=text("'user'"))  # 'user' | 'organizer'
    organizer_requested_at: Mapped[datetime | None]
    is_suspended: Mapped[bool] = mapped_column(server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(server_default=text("now()"))

    @property
    def is_admin(self) -> bool:
        """Admin comes only from the ADMIN_EMAILS setting, never from stored data."""
        return (self.email or "").lower() in settings.admin_email_set

    @property
    def effective_role(self) -> str:
        return "admin" if self.is_admin else self.role

    @property
    def can_organize(self) -> bool:
        return self.is_admin or self.role == "organizer"


class Event(Base):
    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(**UUID_PK)
    organizer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    venue: Mapped[str | None] = mapped_column(Text)
    starts_at: Mapped[datetime]
    ends_at: Mapped[datetime | None]
    timezone: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default=text("'draft'"))
    created_at: Mapped[datetime] = mapped_column(server_default=text("now()"))


class TicketType(Base):
    __tablename__ = "ticket_types"

    id: Mapped[uuid.UUID] = mapped_column(**UUID_PK)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(Text)
    price_cents: Mapped[int]
    capacity: Mapped[int]
    sold: Mapped[int] = mapped_column(server_default=text("0"))
    created_at: Mapped[datetime] = mapped_column(server_default=text("now()"))


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[uuid.UUID] = mapped_column(**UUID_PK)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id"))
    ticket_type_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ticket_types.id"))
    quantity: Mapped[int]
    status: Mapped[str] = mapped_column(Text, server_default=text("'pending'"))
    idempotency_key: Mapped[uuid.UUID | None] = mapped_column(unique=True)
    expires_at: Mapped[datetime]
    paid_at: Mapped[datetime | None]
    payment_ref: Mapped[str | None] = mapped_column(Text)
    reminder_sent_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(server_default=text("now()"))


class Ticket(Base):
    __tablename__ = "tickets"

    id: Mapped[uuid.UUID] = mapped_column(**UUID_PK)
    ticket_type_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ticket_types.id"))
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(Text, server_default=text("'held'"))
    expires_at: Mapped[datetime | None]
    confirmed_at: Mapped[datetime | None]
    checked_in_at: Mapped[datetime | None]
    checked_in_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(server_default=text("now()"))


class StaffAssignment(Base):
    __tablename__ = "staff_assignments"

    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(server_default=text("now()"))


class CheckInEvent(Base):
    __tablename__ = "check_in_events"

    id: Mapped[uuid.UUID] = mapped_column(**UUID_PK)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"))
    ticket_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tickets.id"))
    staff_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    result: Mapped[str] = mapped_column(Text)
    reason: Mapped[str | None] = mapped_column(Text)
    scanned_at: Mapped[datetime] = mapped_column(server_default=text("now()"))

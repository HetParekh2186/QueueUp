"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-10-02
"""

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

SCHEMA = """
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext UNIQUE NOT NULL,              -- case-insensitive: no duplicate accounts
  password_hash text NOT NULL,                       -- argon2id, never plaintext
  display_name  text NOT NULL,
  is_admin      boolean NOT NULL DEFAULT false,
  is_suspended  boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL REFERENCES users(id),
  title        text NOT NULL,
  description  text,
  venue        text,
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz,
  timezone     text NOT NULL,                        -- IANA name, e.g. 'America/Chicago'
  status       text NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft','published','cancelled','ended')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE ticket_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name        text NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  capacity    integer NOT NULL CHECK (capacity >= 0),
  sold        integer NOT NULL DEFAULT 0 CHECK (sold >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, name),
  -- The oversell guard, enforced by the database itself. Even if application
  -- locking had a bug, Postgres refuses to let sold exceed capacity.
  CONSTRAINT ticket_types_sold_le_capacity CHECK (sold <= capacity)
);

CREATE TABLE orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id),
  event_id         uuid NOT NULL REFERENCES events(id),
  ticket_type_id   uuid NOT NULL REFERENCES ticket_types(id),
  quantity         integer NOT NULL CHECK (quantity > 0),
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','paid','expired','cancelled','refunded')),
  idempotency_key  uuid UNIQUE,                      -- blocks double-submitted reservations
  expires_at       timestamptz NOT NULL,             -- the hold deadline (DB clock is authority)
  paid_at          timestamptz,
  payment_ref      text,
  reminder_sent_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tickets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_type_id uuid NOT NULL REFERENCES ticket_types(id),
  order_id       uuid NOT NULL REFERENCES orders(id),
  user_id        uuid NOT NULL REFERENCES users(id),
  status         text NOT NULL DEFAULT 'held'
                 CHECK (status IN ('held','confirmed','checked_in','cancelled','expired')),
  expires_at     timestamptz,                        -- set while held, NULL once resolved
  confirmed_at   timestamptz,
  checked_in_at  timestamptz,
  checked_in_by  uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'checked_in' OR checked_in_at IS NOT NULL)
);

CREATE TABLE staff_assignments (
  event_id   uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)                    -- a staffer is assigned once per event
);

-- Full scan log, separate from tickets.status, so every attempt (including rejects
-- and forged codes, which have no ticket) is auditable without touching the
-- single source of truth for "is this person in".
CREATE TABLE check_in_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  ticket_id  uuid REFERENCES tickets(id),
  staff_id   uuid NOT NULL REFERENCES users(id),
  result     text NOT NULL,                          -- 'admitted','already_used','invalid'
  reason     text,
  scanned_at timestamptz NOT NULL DEFAULT now()
);

-- Live "seats remaining" / dashboard counts only look at seat-occupying tickets.
CREATE INDEX ix_tickets_active_by_type ON tickets (ticket_type_id)
  WHERE status IN ('held','confirmed','checked_in');
-- The hold-expiry sweeper finds due holds cheaply.
CREATE INDEX ix_orders_pending_expiry ON orders (expires_at) WHERE status = 'pending';
CREATE INDEX ix_tickets_held_expiry ON tickets (expires_at) WHERE status = 'held';
CREATE INDEX ix_tickets_user ON tickets (user_id);
CREATE INDEX ix_tickets_order ON tickets (order_id);
CREATE INDEX ix_orders_user ON orders (user_id, created_at DESC);
CREATE INDEX ix_orders_type ON orders (ticket_type_id) WHERE status = 'pending';
CREATE INDEX ix_events_published ON events (starts_at, id) WHERE status = 'published';
CREATE INDEX ix_events_organizer ON events (organizer_id);
CREATE INDEX ix_staff_user ON staff_assignments (user_id);
CREATE INDEX ix_check_in_events_event ON check_in_events (event_id, scanned_at DESC);
"""


def upgrade() -> None:
    # asyncpg runs one statement per call.
    for statement in SCHEMA.split(";"):
        if statement.strip():
            op.execute(statement)


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS check_in_events, staff_assignments, tickets, orders,
                             ticket_types, events, users CASCADE;
        """
    )

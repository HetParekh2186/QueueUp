"""waitlist with automatic, first-come-first-served promotion

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-03
"""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

UPGRADE = [
    """CREATE TABLE waitlist_entries (
         id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         ticket_type_id uuid NOT NULL REFERENCES ticket_types(id) ON DELETE CASCADE,
         user_id        uuid NOT NULL REFERENCES users(id),
         quantity       integer NOT NULL CHECK (quantity BETWEEN 1 AND 4),
         -- waiting: in line. offered: a seat was freed and held for them (order_id).
         -- claimed: they paid. expired: the offer ran out. left / cancelled: out of line.
         status         text NOT NULL DEFAULT 'waiting'
                        CHECK (status IN ('waiting','offered','claimed','expired','left','cancelled')),
         order_id       uuid REFERENCES orders(id),
         created_at     timestamptz NOT NULL DEFAULT now(),
         offered_at     timestamptz,
         CHECK (status <> 'offered' OR order_id IS NOT NULL)
       )""",
    # One place in line per person per ticket type.
    """CREATE UNIQUE INDEX ux_waitlist_one_active ON waitlist_entries (ticket_type_id, user_id)
         WHERE status IN ('waiting', 'offered')""",
    # The front of the line, cheaply: FIFO by arrival, id as the tiebreak.
    """CREATE INDEX ix_waitlist_queue ON waitlist_entries (ticket_type_id, created_at, id)
         WHERE status = 'waiting'""",
    "CREATE INDEX ix_waitlist_order ON waitlist_entries (order_id) WHERE order_id IS NOT NULL",
    "CREATE INDEX ix_waitlist_user ON waitlist_entries (user_id, created_at DESC)",
]


def upgrade() -> None:
    for statement in UPGRADE:
        op.execute(statement)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS waitlist_entries")

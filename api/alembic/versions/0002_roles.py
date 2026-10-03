"""user roles: user / organizer stored; admin comes only from ADMIN_EMAILS

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-03
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

UPGRADE = [
    # Stored roles are deliberately only 'user' and 'organizer'. Admin is never a
    # database value: it is granted by the ADMIN_EMAILS server setting, so no API
    # call, SQL injection or admin-panel bug can mint a new admin.
    """ALTER TABLE users
         ADD COLUMN role text NOT NULL DEFAULT 'user'
           CONSTRAINT users_role_check CHECK (role IN ('user', 'organizer')),
         ADD COLUMN organizer_requested_at timestamptz""",
    # Nobody loses access: anyone who already owns an event, or was an admin, can
    # keep creating events.
    """UPDATE users SET role = 'organizer'
         WHERE is_admin OR id IN (SELECT organizer_id FROM events)""",
    "ALTER TABLE users DROP COLUMN is_admin",
    """CREATE INDEX ix_users_organizer_requests ON users (organizer_requested_at)
         WHERE organizer_requested_at IS NOT NULL""",
]

DOWNGRADE = [
    "DROP INDEX IF EXISTS ix_users_organizer_requests",
    "ALTER TABLE users ADD COLUMN is_admin boolean NOT NULL DEFAULT false",
    "ALTER TABLE users DROP COLUMN organizer_requested_at, DROP COLUMN role",
]


def upgrade() -> None:
    for statement in UPGRADE:
        op.execute(statement)


def downgrade() -> None:
    for statement in DOWNGRADE:
        op.execute(statement)

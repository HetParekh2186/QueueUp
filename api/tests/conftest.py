"""Tests run against a real PostgreSQL — row locks, CHECK constraints and now() are the
whole point, so a mock or SQLite would prove nothing."""

import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

TEST_DB = os.getenv(
    "TEST_DATABASE_URL", "postgresql+asyncpg://queueup:queueup@localhost:5433/queueup_test"
)
os.environ["DATABASE_URL"] = TEST_DB
os.environ.setdefault("REDIS_URL", "redis://localhost:6380/15")
os.environ["RATE_LIMIT_ENABLED"] = "false"
os.environ["ADMIN_EMAILS"] = "site-admin@example.com"
os.environ["SECRET_KEY"] = "test-secret-key-that-is-at-least-32-bytes"
os.environ["QR_SECRET"] = "test-qr-secret-that-is-at-least-32-bytes"
# Enough connections that 100 concurrent requests genuinely race in the database.
os.environ["DB_POOL_SIZE"] = "20"
os.environ["DB_MAX_OVERFLOW"] = "130"

import asyncpg  # noqa: E402
import httpx  # noqa: E402
import pytest  # noqa: E402
import sqlalchemy as sa  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402

from app.db import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402
from app.security import create_access_token  # noqa: E402

API_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TABLES = "waitlist_entries, check_in_events, staff_assignments, tickets, orders, ticket_types, events, users"


async def _ensure_database() -> None:
    plain = TEST_DB.replace("+asyncpg", "")
    base, name = plain.rsplit("/", 1)
    conn = await asyncpg.connect(f"{base}/postgres")
    try:
        if not await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", name):
            await conn.execute(f'CREATE DATABASE "{name}"')
    finally:
        await conn.close()


@pytest.fixture(scope="session", autouse=True)
def database():
    asyncio.run(_ensure_database())
    cfg = Config(os.path.join(API_DIR, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(API_DIR, "alembic"))
    cfg.attributes["database_url"] = TEST_DB
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    yield


@pytest.fixture(autouse=True)
async def clean_db():
    async with engine.begin() as conn:
        await conn.execute(sa.text(f"TRUNCATE {TABLES} CASCADE"))
    yield
    # Pooled asyncpg connections are bound to this test's event loop.
    await engine.dispose()


@pytest.fixture
async def client():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test", timeout=60
    ) as c:
        yield c


# --- helpers ------------------------------------------------------------------------


class Actor:
    def __init__(self, user_id: uuid.UUID, email: str):
        self.id = user_id
        self.email = email
        self.headers = {"Authorization": f"Bearer {create_access_token(user_id)}"}


async def make_user(name: str = "user", is_admin: bool = False, role: str = "user") -> Actor:
    """Insert a user directly (skipping argon2, which is deliberately slow).

    Admins exist only through ADMIN_EMAILS, so an admin fixture uses that address."""
    email = "site-admin@example.com" if is_admin else f"{name.replace(' ', '-')}-{uuid.uuid4().hex[:8]}@example.com"
    async with SessionLocal() as s:
        user = User(email=email, password_hash="x", display_name=name.title(), role=role)
        s.add(user)
        await s.commit()
        return Actor(user.id, email)


async def make_organizer(name: str = "organizer") -> Actor:
    return await make_user(name, role="organizer")


async def make_users(n: int, prefix: str = "buyer") -> list[Actor]:
    async with SessionLocal() as s:
        users = [
            User(email=f"{prefix}{i}-{uuid.uuid4().hex[:6]}@example.com", password_hash="x", display_name=f"{prefix} {i}")
            for i in range(n)
        ]
        s.add_all(users)
        await s.commit()
        return [Actor(u.id, u.email) for u in users]  # plain users


def future(days: int = 30) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).replace(tzinfo=None).isoformat(timespec="minutes")


async def make_event(
    client: httpx.AsyncClient,
    organizer: Actor,
    capacity: int = 10,
    price_cents: int = 2500,
    publish: bool = True,
) -> tuple[str, str]:
    """Create (and publish) an event with one ticket type. Returns (event_id, type_id)."""
    r = await client.post(
        "/events",
        json={"title": "Test Night", "venue": "Hall", "starts_at_local": future(), "timezone": "America/Chicago"},
        headers=organizer.headers,
    )
    assert r.status_code == 201, r.text
    event_id = r.json()["id"]
    r = await client.post(
        f"/events/{event_id}/ticket-types",
        json={"name": "General", "price_cents": price_cents, "capacity": capacity},
        headers=organizer.headers,
    )
    assert r.status_code == 201, r.text
    type_id = r.json()["id"]
    if publish:
        r = await client.patch(f"/events/{event_id}", json={"status": "published"}, headers=organizer.headers)
        assert r.status_code == 200, r.text
    return event_id, type_id


async def reserve(client, actor: Actor, event_id: str, type_id: str, quantity: int = 1, key: str | None = None):
    return await client.post(
        f"/events/{event_id}/reservations",
        json={"ticket_type_id": type_id, "quantity": quantity, "idempotency_key": key or str(uuid.uuid4())},
        headers=actor.headers,
    )


async def buy(client, actor: Actor, event_id: str, type_id: str, quantity: int = 1) -> dict:
    r = await reserve(client, actor, event_id, type_id, quantity)
    assert r.status_code == 201, r.text
    r = await client.post(f"/orders/{r.json()['id']}/confirm", json={"payment_token": "tok_visa"}, headers=actor.headers)
    assert r.status_code == 200, r.text
    return r.json()


async def sql(query: str, **params):
    async with engine.begin() as conn:
        result = await conn.execute(sa.text(query), params)
        return result.all() if result.returns_rows else None

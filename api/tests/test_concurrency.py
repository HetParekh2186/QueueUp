"""The proof that QueueUp never oversells.

Each test fires many requests at the same instant with asyncio.gather. They run over
separate database connections, so they genuinely race inside Postgres.
"""

import asyncio
import uuid

import sqlalchemy as sa

from app.db import SessionLocal
from app.models import Order, Ticket, TicketType

from .conftest import make_event, make_user, make_users, reserve, sql


async def test_100_buyers_race_for_the_last_seat_exactly_one_wins(client):
    organizer = await make_user("organizer")
    event_id, type_id = await make_event(client, organizer, capacity=1)
    buyers = await make_users(100)

    responses = await asyncio.gather(*(reserve(client, b, event_id, type_id) for b in buyers))

    codes = [r.status_code for r in responses]
    assert codes.count(201) == 1, f"expected exactly one winner, got {codes.count(201)}"
    assert codes.count(409) == 99
    assert all(r.json()["error"] == "sold_out" for r in responses if r.status_code == 409)

    [(sold, capacity, active)] = await sql(
        """SELECT tt.sold, tt.capacity,
                  (SELECT count(*) FROM tickets t WHERE t.ticket_type_id = tt.id
                     AND t.status IN ('held','confirmed','checked_in'))
           FROM ticket_types tt WHERE tt.id = :id""",
        id=type_id,
    )
    assert (sold, capacity, active) == (1, 1, 1)


async def test_multi_ticket_orders_are_all_or_nothing_under_contention(client):
    """50 buyers each want 3 of 10 seats: exactly 3 orders fit (9 seats), nobody gets a
    partial order, and the 10th seat stays unsold."""
    organizer = await make_user("organizer")
    event_id, type_id = await make_event(client, organizer, capacity=10)
    buyers = await make_users(50)

    responses = await asyncio.gather(*(reserve(client, b, event_id, type_id, quantity=3) for b in buyers))

    winners = [r for r in responses if r.status_code == 201]
    assert len(winners) == 3
    assert all(len(r.json()["tickets"]) == 3 for r in winners)
    [(sold, tickets)] = await sql(
        "SELECT sold, (SELECT count(*) FROM tickets WHERE ticket_type_id = :id) FROM ticket_types WHERE id = :id",
        id=type_id,
    )
    assert sold == tickets == 9


async def test_concurrent_capacity_cut_and_sales_never_go_negative(client):
    """The organizer lowers capacity while buyers race. Whatever interleaving happens,
    sold never exceeds capacity."""
    organizer = await make_user("organizer")
    event_id, type_id = await make_event(client, organizer, capacity=20)
    buyers = await make_users(40)

    async def cut():
        return await client.patch(
            f"/events/{event_id}/ticket-types/{type_id}", json={"capacity": 5}, headers=organizer.headers
        )

    tasks = [reserve(client, b, event_id, type_id) for b in buyers]
    tasks.insert(10, cut())
    await asyncio.gather(*tasks)

    [(sold, capacity)] = await sql("SELECT sold, capacity FROM ticket_types WHERE id = :id", id=type_id)
    assert sold <= capacity


async def test_naive_read_then_write_oversells(client):
    """Documents the bug QueueUp exists to avoid. This is the 'strategy 1' code from the
    spec — count, compare, insert — with no lock. Run concurrently, it sells 51 of 50
    (here: far more than 1 of 1). Kept as a test so the failure mode stays reproducible."""
    organizer = await make_user("organizer")
    event_id, type_id = await make_event(client, organizer, capacity=1)
    buyers = await make_users(20)

    async def naive_reserve(buyer_id: uuid.UUID) -> bool:
        async with SessionLocal() as s:
            count = await s.scalar(
                sa.select(sa.func.count()).select_from(Ticket).where(Ticket.ticket_type_id == uuid.UUID(type_id))
            )
            capacity = await s.scalar(sa.select(TicketType.capacity).where(TicketType.id == uuid.UUID(type_id)))
            await asyncio.sleep(0.05)  # the gap between "read" and "write" — real latency
            if count < capacity:
                order = Order(
                    user_id=buyer_id, event_id=uuid.UUID(event_id), ticket_type_id=uuid.UUID(type_id),
                    quantity=1, expires_at=sa.func.now(),
                )
                s.add(order)
                await s.flush()
                s.add(Ticket(ticket_type_id=uuid.UUID(type_id), order_id=order.id, user_id=buyer_id))
                await s.commit()
                return True
            return False

    results = await asyncio.gather(*(naive_reserve(b.id) for b in buyers))
    assert sum(results) > 1, "naive read-then-write should oversell under concurrency"


async def test_check_constraint_is_the_last_line_of_defense(client):
    """Even a buggy code path that skips locking can't push sold past capacity."""
    organizer = await make_user("organizer")
    _, type_id = await make_event(client, organizer, capacity=2)
    try:
        await sql("UPDATE ticket_types SET sold = 3 WHERE id = :id", id=type_id)
    except sa.exc.IntegrityError as exc:
        assert "ticket_types_sold_le_capacity" in str(exc)
    else:
        raise AssertionError("CHECK (sold <= capacity) did not fire")

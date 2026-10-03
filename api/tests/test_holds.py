"""Holds, confirmation, the confirm-vs-expiry race, idempotency."""

import asyncio
import uuid

from app.db import SessionLocal
from app.services import jobs

from .conftest import make_event, make_user, make_users, reserve, sql


async def expire_now(order_id: str) -> None:
    await sql(
        "UPDATE orders SET expires_at = now() - interval '1 second' WHERE id = :id",
        id=order_id,
    )
    await sql("UPDATE tickets SET expires_at = now() - interval '1 second' WHERE order_id = :id", id=order_id)


async def test_reserve_confirm_happy_path_issues_qr(client):
    organizer, buyer = await make_user("organizer"), await make_user("buyer")
    event_id, type_id = await make_event(client, organizer, capacity=5, price_cents=1500)

    r = await reserve(client, buyer, event_id, type_id, quantity=2)
    assert r.status_code == 201
    order = r.json()
    assert order["status"] == "pending" and order["total_cents"] == 3000
    assert all(t["status"] == "held" and t["qr"] is None for t in order["tickets"])

    r = await client.post(f"/orders/{order['id']}/confirm", json={}, headers=buyer.headers)
    assert r.status_code == 200
    paid = r.json()
    assert paid["status"] == "paid"
    assert all(t["status"] == "confirmed" and t["qr"] for t in paid["tickets"])

    # Confirm is safe to retry (network retry after a lost response).
    r = await client.post(f"/orders/{order['id']}/confirm", json={}, headers=buyer.headers)
    assert r.status_code == 200 and r.json()["status"] == "paid"

    r = await client.get("/me/tickets", headers=buyer.headers)
    assert len(r.json()) == 2


async def test_confirm_after_expiry_is_410_gone(client):
    organizer, buyer = await make_user("organizer"), await make_user("buyer")
    event_id, type_id = await make_event(client, organizer)
    order_id = (await reserve(client, buyer, event_id, type_id)).json()["id"]
    await expire_now(order_id)

    r = await client.post(f"/orders/{order_id}/confirm", json={}, headers=buyer.headers)
    assert r.status_code == 410
    assert r.json()["error"] == "hold_expired"


async def test_declined_payment_keeps_the_hold(client):
    organizer, buyer = await make_user("organizer"), await make_user("buyer")
    event_id, type_id = await make_event(client, organizer)
    order_id = (await reserve(client, buyer, event_id, type_id)).json()["id"]

    r = await client.post(f"/orders/{order_id}/confirm", json={"payment_token": "tok_decline"}, headers=buyer.headers)
    assert r.status_code == 402
    r = await client.post(f"/orders/{order_id}/confirm", json={"payment_token": "tok_visa"}, headers=buyer.headers)
    assert r.status_code == 200


async def test_confirm_and_sweeper_race_never_both_win(client):
    """The user clicks pay at the instant the hold expires and the sweeper runs. The
    mirrored guards mean exactly one of them owns the outcome — never both."""
    organizer = await make_user("organizer")
    event_id, type_id = await make_event(client, organizer, capacity=50)
    buyers = await make_users(25)
    orders = []
    for b in buyers:
        orders.append(((await reserve(client, b, event_id, type_id)).json()["id"], b))
    for order_id, _ in orders:
        await expire_now(order_id)

    async def sweep():
        async with SessionLocal() as s:
            return await jobs.sweep_expired_holds(s)

    confirms = [client.post(f"/orders/{oid}/confirm", json={}, headers=b.headers) for oid, b in orders]
    await asyncio.gather(*confirms, sweep(), sweep())

    rows = await sql(
        """SELECT o.status, array_agg(t.status) FROM orders o JOIN tickets t ON t.order_id = o.id
           GROUP BY o.id, o.status"""
    )
    for order_status, ticket_statuses in rows:
        if order_status == "paid":
            assert set(ticket_statuses) == {"confirmed"}
        else:
            assert order_status == "expired" and set(ticket_statuses) == {"expired"}
    [(sold,)] = await sql("SELECT sold FROM ticket_types WHERE id = :id", id=type_id)
    paid = sum(1 for s, _ in rows if s == "paid")
    assert sold == paid


async def test_expired_but_unswept_hold_does_not_block_a_buyer(client):
    """The sweeper runs every ~15s. A hold that expired a second ago must not make the
    event look sold out in the meantime."""
    organizer, first, second = await make_user("organizer"), await make_user("a"), await make_user("b")
    event_id, type_id = await make_event(client, organizer, capacity=1)
    order_id = (await reserve(client, first, event_id, type_id)).json()["id"]
    assert (await reserve(client, second, event_id, type_id)).status_code == 409

    await expire_now(order_id)  # expired, but no sweeper has run
    r = await reserve(client, second, event_id, type_id)
    assert r.status_code == 201
    [(status,)] = await sql("SELECT status FROM orders WHERE id = :id", id=order_id)
    assert status == "expired"


async def test_release_returns_seat(client):
    organizer, buyer, other = await make_user("organizer"), await make_user("buyer"), await make_user("other")
    event_id, type_id = await make_event(client, organizer, capacity=1)
    order_id = (await reserve(client, buyer, event_id, type_id)).json()["id"]

    r = await client.delete(f"/orders/{order_id}", headers=buyer.headers)
    assert r.status_code == 204
    assert (await reserve(client, other, event_id, type_id)).status_code == 201


async def test_cannot_touch_someone_elses_order(client):
    organizer, buyer, thief = await make_user("organizer"), await make_user("buyer"), await make_user("thief")
    event_id, type_id = await make_event(client, organizer)
    order_id = (await reserve(client, buyer, event_id, type_id)).json()["id"]
    assert (await client.post(f"/orders/{order_id}/confirm", json={}, headers=thief.headers)).status_code == 404
    assert (await client.delete(f"/orders/{order_id}", headers=thief.headers)).status_code == 404


async def test_idempotency_key_replay_returns_original_order(client):
    organizer, buyer = await make_user("organizer"), await make_user("buyer")
    event_id, type_id = await make_event(client, organizer)
    key = str(uuid.uuid4())

    first = await reserve(client, buyer, event_id, type_id, key=key)
    second = await reserve(client, buyer, event_id, type_id, key=key)
    assert first.status_code == 201
    assert second.status_code == 409
    assert second.json() == {"error": "duplicate_request", "order_id": first.json()["id"]}


async def test_double_click_storm_creates_one_hold(client):
    """Ten simultaneous submits with one idempotency key (a frantic double-click plus
    client retries) produce exactly one order."""
    organizer, buyer = await make_user("organizer"), await make_user("buyer")
    event_id, type_id = await make_event(client, organizer, capacity=100)
    key = str(uuid.uuid4())

    responses = await asyncio.gather(*(reserve(client, buyer, event_id, type_id, key=key) for _ in range(10)))
    assert [r.status_code for r in responses].count(201) == 1
    [(orders, sold)] = await sql(
        "SELECT (SELECT count(*) FROM orders), sold FROM ticket_types WHERE id = :id", id=type_id
    )
    assert orders == 1 and sold == 1


async def test_quantity_and_per_user_limits(client):
    organizer, buyer = await make_user("organizer"), await make_user("buyer")
    event_id, type_id = await make_event(client, organizer, capacity=100)
    assert (await reserve(client, buyer, event_id, type_id, quantity=0)).status_code == 422
    assert (await reserve(client, buyer, event_id, type_id, quantity=11)).status_code == 422
    assert (await reserve(client, buyer, event_id, type_id, quantity=10)).status_code == 201
    r = await reserve(client, buyer, event_id, type_id, quantity=1)
    assert r.status_code == 409 and r.json()["error"] == "per_user_limit"


async def test_refund_returns_seats_but_not_after_check_in(client):
    organizer, buyer = await make_user("organizer"), await make_user("buyer")
    event_id, type_id = await make_event(client, organizer, capacity=2)
    r = await reserve(client, buyer, event_id, type_id)
    order_id = r.json()["id"]
    paid = (await client.post(f"/orders/{order_id}/confirm", json={}, headers=buyer.headers)).json()

    await client.post("/checkins", json={"qr": paid["tickets"][0]["qr"], "event_id": event_id}, headers=organizer.headers)
    r = await client.post(f"/orders/{order_id}/refund", headers=buyer.headers)
    assert r.status_code == 409 and r.json()["error"] == "already_checked_in"

    r = await reserve(client, buyer, event_id, type_id)
    order2 = r.json()["id"]
    await client.post(f"/orders/{order2}/confirm", json={}, headers=buyer.headers)
    r = await client.post(f"/orders/{order2}/refund", headers=buyer.headers)
    assert r.status_code == 200 and r.json()["status"] == "refunded"
    [(sold,)] = await sql("SELECT sold FROM ticket_types WHERE id = :id", id=type_id)
    assert sold == 1


async def test_sweeper_and_reconcile_are_idempotent(client):
    organizer, buyer = await make_user("organizer"), await make_user("buyer")
    event_id, type_id = await make_event(client, organizer, capacity=3)
    order_id = (await reserve(client, buyer, event_id, type_id, quantity=2)).json()["id"]
    await expire_now(order_id)

    async with SessionLocal() as s:
        first = await jobs.sweep_expired_holds(s)
        second = await jobs.sweep_expired_holds(s)
        drift = await jobs.reconcile_inventory(s)
    assert first and not second
    assert drift == 0
    [(sold,)] = await sql("SELECT sold FROM ticket_types WHERE id = :id", id=type_id)
    assert sold == 0

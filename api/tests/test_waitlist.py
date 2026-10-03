"""Waitlist: join only when sold out, strict first-come-first-served promotion into an
ordinary hold, and the same no-double-allocation guarantee as buying."""

import asyncio

from app.db import SessionLocal
from app.services import jobs

from .conftest import buy, make_event, make_organizer, make_user, make_users, reserve, sql


async def join(client, actor, event_id, type_id, quantity=1):
    return await client.post(
        f"/events/{event_id}/waitlist", json={"ticket_type_id": type_id, "quantity": quantity}, headers=actor.headers
    )


async def expire(order_id):
    await sql("UPDATE orders SET expires_at = now() - interval '1 second' WHERE id = :id", id=order_id)
    await sql("UPDATE tickets SET expires_at = now() - interval '1 second' WHERE order_id = :id", id=order_id)


async def sweep():
    async with SessionLocal() as s:
        return await jobs.sweep_expired_holds(s)


async def sold_out_event(client, capacity=1):
    organizer, holder = await make_organizer(), await make_user("holder")
    event_id, type_id = await make_event(client, organizer, capacity=capacity)
    hold = (await reserve(client, holder, event_id, type_id, quantity=capacity)).json()
    return organizer, holder, event_id, type_id, hold["id"]


async def test_can_only_join_when_sold_out(client):
    organizer, user = await make_organizer(), await make_user("early")
    event_id, type_id = await make_event(client, organizer, capacity=5)
    r = await join(client, user, event_id, type_id)
    assert r.status_code == 409 and r.json()["error"] == "seats_available"


async def test_join_reports_place_in_line_and_blocks_duplicates(client):
    _, _, event_id, type_id, _ = await sold_out_event(client)
    a, b = await make_user("first"), await make_user("second")
    ra, rb = await join(client, a, event_id, type_id), await join(client, b, event_id, type_id)
    assert (ra.status_code, rb.status_code) == (201, 201)
    assert (ra.json()["position"], rb.json()["position"]) == (1, 2)
    assert (await join(client, a, event_id, type_id)).json()["error"] == "already_waiting"
    detail = (await client.get(f"/events/{event_id}")).json()
    assert detail["ticket_types"][0]["waiting"] == 2


async def test_expired_hold_goes_to_the_front_of_the_line(client):
    _, _, event_id, type_id, hold_id = await sold_out_event(client)
    first, second = await make_user("first"), await make_user("second")
    await join(client, first, event_id, type_id)
    await join(client, second, event_id, type_id)

    await expire(hold_id)
    await sweep()

    mine = (await client.get("/me/waitlist", headers=first.headers)).json()[0]
    assert mine["status"] == "offered" and mine["order_id"] and mine["offer_expires_at"]
    theirs = (await client.get("/me/waitlist", headers=second.headers)).json()[0]
    assert theirs["status"] == "waiting" and theirs["position"] == 1  # moved up

    r = await client.post(f"/orders/{mine['order_id']}/confirm", json={}, headers=first.headers)
    assert r.status_code == 200 and r.json()["status"] == "paid"
    assert (await client.get("/me/waitlist", headers=first.headers)).json()[0]["status"] == "claimed"


async def test_walk_up_buyer_cannot_jump_the_line(client):
    _, _, event_id, type_id, hold_id = await sold_out_event(client)
    waiting, walk_up = await make_user("waiting"), await make_user("walkup")
    await join(client, waiting, event_id, type_id)
    await expire(hold_id)  # seat is free, but the sweeper hasn't run yet

    r = await reserve(client, walk_up, event_id, type_id)
    assert r.status_code == 409 and r.json()["error"] == "sold_out" and r.json()["waitlist"] is True
    # The buyer's request settled the freed seat onto the person in line, and that stuck.
    assert (await client.get("/me/waitlist", headers=waiting.headers)).json()[0]["status"] == "offered"


async def test_unclaimed_offer_passes_to_the_next_person(client):
    _, _, event_id, type_id, hold_id = await sold_out_event(client)
    first, second = await make_user("first"), await make_user("second")
    await join(client, first, event_id, type_id)
    await join(client, second, event_id, type_id)
    await expire(hold_id)
    await sweep()

    offered = (await client.get("/me/waitlist", headers=first.headers)).json()[0]
    await expire(offered["order_id"])
    await sweep()

    assert (await client.get("/me/waitlist", headers=first.headers)).json()[0]["status"] == "expired"
    assert (await client.get("/me/waitlist", headers=second.headers)).json()[0]["status"] == "offered"


async def test_releasing_and_refunding_and_raising_capacity_all_promote(client):
    organizer, holder, event_id, type_id, hold_id = await sold_out_event(client)
    a, b, c = await make_user("a"), await make_user("b"), await make_user("c")
    for u in (a, b, c):
        await join(client, u, event_id, type_id)

    await client.delete(f"/orders/{hold_id}", headers=holder.headers)  # release
    assert (await client.get("/me/waitlist", headers=a.headers)).json()[0]["status"] == "offered"

    offer = (await client.get("/me/waitlist", headers=a.headers)).json()[0]["order_id"]
    await client.post(f"/orders/{offer}/confirm", json={}, headers=a.headers)
    await client.post(f"/orders/{offer}/refund", headers=a.headers)  # refund
    assert (await client.get("/me/waitlist", headers=b.headers)).json()[0]["status"] == "offered"

    await client.patch(f"/events/{event_id}/ticket-types/{type_id}", json={"capacity": 2}, headers=organizer.headers)
    assert (await client.get("/me/waitlist", headers=c.headers)).json()[0]["status"] == "offered"


async def test_strict_fifo_never_skips_the_front(client):
    _, _, event_id, type_id, hold_id = await sold_out_event(client, capacity=2)
    wants_three, wants_one = await make_user("big"), await make_user("small")
    # Raise capacity so a 3-seat request is allowed to wait, then free only one seat.
    await join(client, wants_three, event_id, type_id, quantity=3)
    await join(client, wants_one, event_id, type_id, quantity=1)
    await sql("UPDATE ticket_types SET capacity = 3 WHERE id = :id", id=type_id)
    await sweep()  # 1 seat free: not enough for the front of the line

    assert (await client.get("/me/waitlist", headers=wants_three.headers)).json()[0]["status"] == "waiting"
    assert (await client.get("/me/waitlist", headers=wants_one.headers)).json()[0]["status"] == "waiting"


async def test_concurrent_joins_and_promotions_never_double_allocate(client):
    """30 people join at once, then the seat frees while two sweepers and a walk-up
    buyer all race for it. Exactly one person ends up holding it."""
    _, _, event_id, type_id, hold_id = await sold_out_event(client)
    crowd = await make_users(30, "crowd")
    joined = await asyncio.gather(*(join(client, u, event_id, type_id) for u in crowd))
    assert all(r.status_code == 201 for r in joined)
    assert sorted(r.json()["position"] for r in joined) != []
    positions = (await sql("""SELECT count(DISTINCT id) FROM waitlist_entries WHERE status = 'waiting'"""))[0][0]
    assert positions == 30

    await expire(hold_id)
    walk_up = await make_user("walkup")
    await asyncio.gather(sweep(), sweep(), reserve(client, walk_up, event_id, type_id))

    [(offered, sold, active)] = await sql(
        """SELECT (SELECT count(*) FROM waitlist_entries WHERE status = 'offered'),
                  tt.sold,
                  (SELECT count(*) FROM tickets t WHERE t.ticket_type_id = tt.id
                     AND t.status IN ('held','confirmed','checked_in'))
           FROM ticket_types tt WHERE tt.id = :id""",
        id=type_id,
    )
    assert (offered, sold, active) == (1, 1, 1)
    # And it went to whoever joined first.
    [(first_status,)] = await sql(
        "SELECT status FROM waitlist_entries ORDER BY created_at, id LIMIT 1"
    )
    assert first_status == "offered"


async def test_leave_and_cancel(client):
    organizer, _, event_id, type_id, _ = await sold_out_event(client)
    user = await make_user("leaver")
    entry = (await join(client, user, event_id, type_id)).json()
    assert (await client.delete(f"/waitlist/{entry['id']}", headers=user.headers)).status_code == 204
    assert (await client.get("/me/waitlist", headers=user.headers)).json()[0]["status"] == "left"

    other = await make_user("other")
    await join(client, other, event_id, type_id)
    await client.patch(f"/events/{event_id}", json={"status": "cancelled"}, headers=organizer.headers)
    assert (await client.get("/me/waitlist", headers=other.headers)).json()[0]["status"] == "cancelled"


async def test_dashboard_shows_waiting(client):
    organizer, _, event_id, type_id, _ = await sold_out_event(client)
    await join(client, await make_user("w1"), event_id, type_id)
    d = (await client.get(f"/events/{event_id}/dashboard", headers=organizer.headers)).json()
    assert d["ticket_types"][0]["waiting"] == 1


async def test_buy_still_works_with_no_waitlist(client):
    organizer, buyer = await make_organizer(), await make_user("buyer")
    event_id, type_id = await make_event(client, organizer, capacity=3)
    assert (await buy(client, buyer, event_id, type_id))["status"] == "paid"

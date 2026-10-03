"""Door scanning: signatures, scoping, and the concurrent double-scan."""

import asyncio
import uuid

import jwt

from app.security import sign_qr

from .conftest import buy, make_event, make_organizer, make_user, reserve, sql


async def scan(client, actor, event_id, qr):
    return await client.post("/checkins", json={"qr": qr, "event_id": event_id}, headers=actor.headers)


async def setup(client):
    organizer, buyer, staff = await make_organizer("organizer"), await make_user("jordan lee"), await make_user("staff")
    event_id, type_id = await make_event(client, organizer)
    r = await client.post(f"/events/{event_id}/staff", json={"email": staff.email}, headers=organizer.headers)
    assert r.status_code == 201
    order = await buy(client, buyer, event_id, type_id)
    return organizer, buyer, staff, event_id, type_id, order["tickets"][0]["qr"]


async def test_valid_scan_admits_then_reports_already_used(client):
    _, _, staff, event_id, _, qr = await setup(client)

    r = await scan(client, staff, event_id, qr)
    assert r.status_code == 200
    assert r.json()["result"] == "admitted" and r.json()["attendee"] == "Jordan Lee"

    r = await scan(client, staff, event_id, qr)
    assert r.status_code == 409
    body = r.json()
    assert body["result"] == "already_used" and body["checked_in_by"] == "Staff" and body["checked_in_at"]


async def test_same_qr_at_two_doors_checks_in_exactly_once(client):
    organizer, _, staff, event_id, _, qr = await setup(client)

    responses = await asyncio.gather(*(scan(client, staff if i % 2 else organizer, event_id, qr) for i in range(20)))

    codes = [r.status_code for r in responses]
    assert codes.count(200) == 1
    assert codes.count(409) == 19
    [(admitted, logged)] = await sql(
        "SELECT count(*) FILTER (WHERE result = 'admitted'), count(*) FROM check_in_events"
    )
    assert admitted == 1 and logged == 20  # every attempt is in the audit log


async def test_forged_qr_rejected(client):
    _, _, staff, event_id, _, qr = await setup(client)
    claims = jwt.decode(qr, options={"verify_signature": False})
    forged = jwt.encode(claims, "not-the-server-secret-but-32-bytes-long", algorithm="HS256")

    for bad in (forged, str(uuid.uuid4()), qr[:-3] + "abc"):
        r = await scan(client, staff, event_id, bad)
        assert r.status_code == 422 and r.json() == {"result": "invalid", "reason": "signature"}


async def test_ticket_for_another_event_rejected(client):
    organizer, _, staff, event_id, _, qr = await setup(client)
    other_event, _ = await make_event(client, organizer)
    r = await scan(client, organizer, other_event, qr)
    assert r.status_code == 422 and r.json()["reason"] == "wrong_event"


async def test_unpaid_hold_rejected(client):
    organizer, buyer = await make_organizer("organizer"), await make_user("buyer")
    event_id, type_id = await make_event(client, organizer)
    order = (await reserve(client, buyer, event_id, type_id)).json()
    # A held ticket has no QR; mint one anyway to prove the server re-checks status.
    qr = sign_qr(uuid.UUID(order["tickets"][0]["id"]), uuid.UUID(event_id))
    r = await scan(client, organizer, event_id, qr)
    assert r.status_code == 422 and r.json()["reason"] == "not_paid"


async def test_unassigned_staff_blocked_before_scan_logic(client):
    _, _, _, event_id, _, qr = await setup(client)
    stranger = await make_user("stranger")
    r = await scan(client, stranger, event_id, qr)
    assert r.status_code == 403
    [(n,)] = await sql("SELECT count(*) FROM check_in_events")
    assert n == 0


async def test_cancelled_event_tickets_rejected(client):
    organizer, _, staff, event_id, _, qr = await setup(client)
    r = await client.patch(f"/events/{event_id}", json={"status": "cancelled"}, headers=organizer.headers)
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    r = await scan(client, staff, event_id, qr)
    assert r.status_code == 422 and r.json()["reason"] == "cancelled"
    [(order_status,)] = await sql("SELECT status FROM orders")
    assert order_status == "refunded"


async def test_dashboard_counts_and_scoping(client):
    organizer, buyer, staff, event_id, _, qr = await setup(client)
    await scan(client, staff, event_id, qr)

    r = await client.get(f"/events/{event_id}/dashboard", headers=staff.headers)
    assert r.status_code == 200
    d = r.json()
    assert (d["capacity"], d["checked_in"], d["confirmed"], d["remaining"]) == (10, 1, 0, 9)
    assert d["recent_scans"][0]["result"] == "admitted"

    assert (await client.get(f"/events/{event_id}/dashboard", headers=buyer.headers)).status_code == 403
    # Staff can see the dashboard but not export attendees or edit the event.
    assert (await client.get(f"/events/{event_id}/attendees.csv", headers=staff.headers)).status_code == 403
    assert (await client.patch(f"/events/{event_id}", json={"title": "x"}, headers=staff.headers)).status_code == 403

    r = await client.get(f"/events/{event_id}/attendees.csv", headers=organizer.headers)
    assert r.status_code == 200 and "Jordan Lee" in r.text and "checked_in" in r.text

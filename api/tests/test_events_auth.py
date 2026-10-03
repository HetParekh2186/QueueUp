"""Auth, event lifecycle, scoping and input edge cases."""

from .conftest import buy, future, make_event, make_organizer, make_user, reserve


async def test_signup_login_refresh_me(client):
    r = await client.post("/auth/signup", json={"email": "Het@Example.com", "password": "correct horse", "display_name": "Het"})
    assert r.status_code == 201
    tokens = r.json()

    # citext: the same address in different case is the same account.
    r = await client.post("/auth/signup", json={"email": "het@example.com", "password": "another one", "display_name": "H"})
    assert r.status_code == 409

    r = await client.post("/auth/login", json={"email": "HET@example.com", "password": "correct horse"})
    assert r.status_code == 200
    r = await client.get("/auth/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"})
    assert r.json()["display_name"] == "Het"

    r = await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 200
    # An access token can't be used as a refresh token.
    r = await client.post("/auth/refresh", json={"refresh_token": tokens["access_token"]})
    assert r.status_code == 401


async def test_login_does_not_reveal_which_emails_exist(client):
    await client.post("/auth/signup", json={"email": "a@example.com", "password": "password123", "display_name": "A"})
    wrong_pw = await client.post("/auth/login", json={"email": "a@example.com", "password": "nope-nope"})
    no_user = await client.post("/auth/login", json={"email": "ghost@example.com", "password": "nope-nope"})
    assert wrong_pw.status_code == no_user.status_code == 401
    assert wrong_pw.json() == no_user.json() == {"error": "invalid_credentials"}


async def test_protected_routes_require_auth(client):
    assert (await client.get("/me/tickets")).status_code == 401
    assert (await client.get("/me/tickets", headers={"Authorization": "Bearer garbage"})).status_code == 401


async def test_event_times_are_stored_in_utc_from_venue_local_time(client):
    organizer = await make_organizer("organizer")
    r = await client.post(
        "/events",
        json={"title": "Chicago show", "starts_at_local": "2027-01-15T20:00", "timezone": "America/Chicago"},
        headers=organizer.headers,
    )
    assert r.json()["starts_at"].startswith("2027-01-16T02:00:00")  # 8pm CST == 02:00 UTC
    r = await client.post(
        "/events",
        json={"title": "Bad tz", "starts_at_local": "2027-01-15T20:00", "timezone": "Mars/Olympus"},
        headers=organizer.headers,
    )
    assert r.status_code == 422


async def test_drafts_are_private_and_not_on_sale(client):
    organizer, buyer = await make_organizer("organizer"), await make_user("buyer")
    event_id, type_id = await make_event(client, organizer, publish=False)
    assert (await client.get(f"/events/{event_id}")).status_code == 404
    assert (await client.get(f"/events/{event_id}", headers=organizer.headers)).status_code == 200
    r = await reserve(client, buyer, event_id, type_id)
    assert r.status_code == 409 and r.json()["error"] == "event_not_on_sale"
    assert (await client.get("/events")).json()["items"] == []


async def test_publish_requires_ticket_types(client):
    organizer = await make_organizer("organizer")
    r = await client.post("/events", json={"title": "Empty", "starts_at_local": future(), "timezone": "UTC"}, headers=organizer.headers)
    r = await client.patch(f"/events/{r.json()['id']}", json={"status": "published"}, headers=organizer.headers)
    assert r.status_code == 409 and r.json()["error"] == "no_ticket_types"


async def test_only_owner_can_edit(client):
    organizer, other = await make_organizer("organizer"), await make_user("other")
    event_id, type_id = await make_event(client, organizer)
    assert (await client.patch(f"/events/{event_id}", json={"title": "mine"}, headers=other.headers)).status_code == 403
    r = await client.post(f"/events/{event_id}/ticket-types", json={"name": "VIP", "price_cents": 1, "capacity": 1}, headers=other.headers)
    assert r.status_code == 403
    assert (await client.post(f"/events/{event_id}/staff", json={"email": other.email}, headers=other.headers)).status_code == 403


async def test_admin_can_manage_any_event(client):
    organizer, admin = await make_organizer("organizer"), await make_user("admin", is_admin=True)
    event_id, _ = await make_event(client, organizer)
    r = await client.patch(f"/events/{event_id}", json={"title": "Fixed by admin"}, headers=admin.headers)
    assert r.status_code == 200


async def test_capacity_cannot_drop_below_sold(client):
    organizer, buyer = await make_organizer("organizer"), await make_user("buyer")
    event_id, type_id = await make_event(client, organizer, capacity=10)
    await buy(client, buyer, event_id, type_id, quantity=4)
    url = f"/events/{event_id}/ticket-types/{type_id}"
    r = await client.patch(url, json={"capacity": 3}, headers=organizer.headers)
    assert r.status_code == 409 and r.json() == {"error": "capacity_below_sold", "sold": 4}
    assert (await client.patch(url, json={"capacity": 4}, headers=organizer.headers)).status_code == 200
    assert (await client.patch(url, json={"capacity": 500}, headers=organizer.headers)).json()["remaining"] == 496


async def test_cannot_delete_event_with_orders(client):
    organizer, buyer = await make_organizer("organizer"), await make_user("buyer")
    event_id, type_id = await make_event(client, organizer)
    await reserve(client, buyer, event_id, type_id)
    r = await client.delete(f"/events/{event_id}", headers=organizer.headers)
    assert r.status_code == 409 and r.json()["error"] == "event_has_orders"

    empty_id, _ = await make_event(client, organizer, publish=False)
    assert (await client.delete(f"/events/{empty_id}", headers=organizer.headers)).status_code == 204


async def test_bad_inputs_rejected(client):
    organizer = await make_organizer("organizer")
    event_id, _ = await make_event(client, organizer)
    for bad in ({"name": "x", "price_cents": -1, "capacity": 1}, {"name": "x", "price_cents": 1, "capacity": -5}):
        r = await client.post(f"/events/{event_id}/ticket-types", json=bad, headers=organizer.headers)
        assert r.status_code == 422
    assert (await client.get("/events?limit=500")).status_code == 422


async def test_event_list_cursor_pagination(client):
    organizer = await make_organizer("organizer")
    for _ in range(5):
        await make_event(client, organizer)
    seen, cursor = [], None
    while True:
        r = await client.get("/events", params={"limit": 2, **({"cursor": cursor} if cursor else {})})
        page = r.json()
        seen += [e["id"] for e in page["items"]]
        cursor = page["next_cursor"]
        if not cursor:
            break
    assert len(seen) == len(set(seen)) == 5


async def test_csv_export_neutralizes_formulas(client):
    organizer = await make_organizer("organizer")
    evil = await make_user("=HYPERLINK(evil)")
    event_id, type_id = await make_event(client, organizer)
    await buy(client, evil, event_id, type_id)
    r = await client.get(f"/events/{event_id}/attendees.csv", headers=organizer.headers)
    assert "'=Hyperlink" in r.text or "'=HYPERLINK" in r.text.upper()


async def test_suspended_user_locked_out(client):
    admin, user = await make_user("admin", is_admin=True), await make_user("user")
    r = await client.post(f"/admin/users/{user.id}/suspend", json={"suspended": True}, headers=admin.headers)
    assert r.status_code == 200
    assert (await client.get("/me/tickets", headers=user.headers)).status_code == 401


async def test_health(client):
    r = await client.get("/health")
    assert r.status_code == 200 and r.json()["database"] == "ok"


async def test_event_list_filters(client):
    organizer, buyer = await make_organizer("organizer"), await make_user("buyer")
    jazz, jazz_type = await make_event(client, organizer, capacity=1, price_cents=3000)
    await client.patch(f"/events/{jazz}", json={"title": "Rooftop Jazz 100%"}, headers=organizer.headers)
    free, _ = await make_event(client, organizer, capacity=50, price_cents=0)
    await client.patch(f"/events/{free}", json={"title": "Builders Meetup", "venue": "Hall B, Austin"},
                       headers=organizer.headers)
    await buy(client, buyer, jazz, jazz_type)  # jazz is now sold out

    async def ids(**params):
        r = await client.get("/events", params=params)
        assert r.status_code == 200, r.text
        return {e["id"] for e in r.json()["items"]}

    assert await ids(q="austin") == {free}  # venue match, case-insensitive
    assert await ids(q="jazz 100%") == {jazz}  # % is literal, not a wildcard
    assert await ids(q="100_") == set()
    assert await ids(price="free") == {free}
    assert await ids(price="paid") == {jazz}
    assert await ids(available="true") == {free}

    r = await client.get("/events", params={"starts_before": "2000-01-01T00:00:00Z"})
    assert r.json()["items"] == []
    assert (await client.get("/events", params={"price": "cheap"})).status_code == 422


async def test_filtered_pagination_never_mixes_in_other_events(client):
    organizer = await make_organizer("organizer")
    free_ids = set()
    for i in range(5):
        eid, _ = await make_event(client, organizer, price_cents=0 if i % 2 == 0 else 500)
        if i % 2 == 0:
            free_ids.add(eid)
    seen, cursor = [], None
    while True:
        params = {"limit": 1, "price": "free", **({"cursor": cursor} if cursor else {})}
        page = (await client.get("/events", params=params)).json()
        seen += [e["id"] for e in page["items"]]
        cursor = page["next_cursor"]
        if not cursor:
            break
    assert seen and set(seen) == free_ids and len(seen) == len(free_ids)

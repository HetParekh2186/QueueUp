"""Roles: user (default), organizer (granted by an admin), admin (configuration only)."""

from .conftest import future, make_event, make_organizer, make_user, sql

EVENT = {"title": "Mine", "starts_at_local": future(), "timezone": "UTC"}


async def test_signup_is_a_plain_user_who_cannot_create_events(client):
    r = await client.post("/auth/signup", json={"email": "new@example.com", "password": "password123", "display_name": "New"})
    assert r.status_code == 201
    assert r.json()["user"]["role"] == "user"
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = await client.post("/events", json=EVENT, headers=headers)
    assert r.status_code == 403 and r.json()["error"] == "organizer_required"


async def test_admin_comes_only_from_admin_emails(client):
    r = await client.post(
        "/auth/signup", json={"email": "SITE-ADMIN@example.com", "password": "password123", "display_name": "Me"}
    )
    assert r.json()["user"]["role"] == "admin"  # case-insensitive match on the configured email
    [(stored,)] = await sql("SELECT role FROM users WHERE email = 'site-admin@example.com'")
    assert stored == "user", "admin is never written to the database"


async def test_request_approve_flow_takes_effect_on_the_same_token(client):
    admin, user = await make_user("admin", is_admin=True), await make_user("hopeful")

    r = await client.post("/me/organizer-request", headers=user.headers)
    assert r.status_code == 200 and r.json()["organizer_requested_at"]
    again = await client.post("/me/organizer-request", headers=user.headers)
    assert again.json()["organizer_requested_at"] == r.json()["organizer_requested_at"]  # idempotent

    queue = (await client.get("/admin/users", params={"requested": "true"}, headers=admin.headers)).json()
    assert [u["id"] for u in queue["items"]] == [str(user.id)]
    assert (await client.get("/admin/stats", headers=admin.headers)).json()["pending_requests"] == 1

    r = await client.patch(f"/admin/users/{user.id}", json={"role": "organizer"}, headers=admin.headers)
    assert r.status_code == 200 and r.json()["role"] == "organizer" and r.json()["organizer_requested_at"] is None

    # No new login needed: roles are read from the database on every request.
    assert (await client.post("/events", json=EVENT, headers=user.headers)).status_code == 201


async def test_declining_and_withdrawing_requests(client):
    admin, user = await make_user("admin", is_admin=True), await make_user("hopeful")
    await client.post("/me/organizer-request", headers=user.headers)
    r = await client.patch(f"/admin/users/{user.id}", json={"decline_request": True}, headers=admin.headers)
    assert r.json()["role"] == "user" and r.json()["organizer_requested_at"] is None

    await client.post("/me/organizer-request", headers=user.headers)
    r = await client.delete("/me/organizer-request", headers=user.headers)
    assert r.json()["organizer_requested_at"] is None


async def test_admin_can_never_be_granted_or_changed_through_the_api(client):
    admin, user = await make_user("admin", is_admin=True), await make_user("sneaky")
    r = await client.patch(f"/admin/users/{user.id}", json={"role": "admin"}, headers=admin.headers)
    assert r.status_code == 422
    r = await client.patch(f"/admin/users/{admin.id}", json={"suspended": True}, headers=admin.headers)
    assert r.status_code == 409 and r.json()["error"] == "admin_is_configured"


async def test_non_admins_are_locked_out_of_admin_routes(client):
    organizer = await make_organizer()
    for method, path in [("get", "/admin/stats"), ("get", "/admin/users"), ("get", "/admin/events")]:
        assert (await client.request(method, path, headers=organizer.headers)).status_code == 403
    assert (await client.get("/admin/stats")).status_code == 401


async def test_demoted_organizer_keeps_existing_events_but_cannot_create_more(client):
    admin, organizer = await make_user("admin", is_admin=True), await make_organizer()
    event_id, _ = await make_event(client, organizer)
    await client.patch(f"/admin/users/{organizer.id}", json={"role": "user"}, headers=admin.headers)
    assert (await client.post("/events", json=EVENT, headers=organizer.headers)).status_code == 403
    r = await client.patch(f"/events/{event_id}", json={"title": "Still mine"}, headers=organizer.headers)
    assert r.status_code == 200  # ownership of existing events is unaffected


async def test_admin_sees_every_event_including_drafts(client):
    admin, organizer = await make_user("admin", is_admin=True), await make_organizer()
    draft, _ = await make_event(client, organizer, publish=False)
    listing = (await client.get("/admin/events", params={"status": "draft"}, headers=admin.headers)).json()
    assert [e["id"] for e in listing["items"]] == [draft] and listing["total"] == 1
    assert (await client.get(f"/events/{draft}", headers=admin.headers)).json()["can_manage"] is True


async def test_admin_user_search_and_suspension(client):
    admin = await make_user("admin", is_admin=True)
    target = await make_user("Grace Hopper")
    found = (await client.get("/admin/users", params={"q": "grace"}, headers=admin.headers)).json()
    assert [u["id"] for u in found["items"]] == [str(target.id)]
    r = await client.patch(f"/admin/users/{target.id}", json={"suspended": True}, headers=admin.headers)
    assert r.json()["is_suspended"] is True
    assert (await client.get("/me/tickets", headers=target.headers)).status_code == 401

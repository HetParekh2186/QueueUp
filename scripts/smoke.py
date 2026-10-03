"""End-to-end smoke test against a running stack (docker compose up).

Walks the whole story: organizer creates a 1-seat event, two buyers race, a hold
expires and the *worker* returns the seat, the seat is resold, staff scan the ticket
twice. Along the way it asserts what two WebSocket clients (a public viewer and the
organizer's dashboard) receive.

    HOLD_SECONDS=45 docker compose up -d --build
    python scripts/smoke.py            # needs: pip install httpx websockets
"""

import asyncio
import json
import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import websockets

API = os.getenv("API_URL", "http://localhost:8000")
WEB = os.getenv("WEB_URL", "http://localhost:3000")
WS = API.replace("http", "ws", 1)


def step(msg: str) -> None:
    print(f"\n\033[1m▶ {msg}\033[0m")


def ok(msg: str) -> None:
    print(f"  \033[32m✓\033[0m {msg}")


class Watcher:
    """Collects messages from one event socket in the background."""

    def __init__(self, event_id: str, token: str | None = None):
        self.url = f"{WS}/ws/events/{event_id}" + (f"?token={token}" if token else "")
        self.messages: list[dict] = []

    async def run(self):
        async with websockets.connect(self.url) as ws:
            async for raw in ws:
                self.messages.append(json.loads(raw))

    async def wait_for(self, predicate, timeout: float) -> dict:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            for m in self.messages:
                if predicate(m):
                    self.messages.remove(m)
                    return m
            await asyncio.sleep(0.2)
        raise AssertionError(f"timed out waiting on {self.url}; got {self.messages}")


async def main() -> None:
    async with httpx.AsyncClient(base_url=API, timeout=30) as c:
        step("health")
        r = await c.get("/health")
        assert r.json() == {"status": "ok", "database": "ok", "redis": "ok"}, r.text
        ok(r.text)

        step("sign up organizer, staff, two buyers")
        tag = uuid.uuid4().hex[:6]
        users = {}
        for name in ("organizer", "staff", "alice", "bob"):
            r = await c.post("/auth/signup", json={"email": f"{name}-{tag}@example.com", "password": "password123", "display_name": name.title()})
            assert r.status_code == 201, r.text
            users[name] = r.json()
        h = {k: {"Authorization": f"Bearer {v['access_token']}"} for k, v in users.items()}
        ok("4 accounts")

        step("organizer creates and publishes a 1-seat event, assigns staff")
        start = (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%dT%H:%M")
        r = await c.post("/events", json={"title": f"Smoke Test {tag}", "venue": "Room 1", "starts_at_local": start, "timezone": "UTC"}, headers=h["organizer"])
        event_id = r.json()["id"]
        r = await c.post(f"/events/{event_id}/ticket-types", json={"name": "General", "price_cents": 1000, "capacity": 1}, headers=h["organizer"])
        type_id = r.json()["id"]
        assert (await c.patch(f"/events/{event_id}", json={"status": "published"}, headers=h["organizer"])).status_code == 200
        assert (await c.post(f"/events/{event_id}/staff", json={"email": users["staff"]["user"]["email"]}, headers=h["organizer"])).status_code == 201
        ok(f"event {event_id}")

        public, dashboard = Watcher(event_id), Watcher(event_id, users["organizer"]["access_token"])
        tasks = [asyncio.create_task(public.run()), asyncio.create_task(dashboard.run())]
        await public.wait_for(lambda m: m["type"] == "hello" and not m["privileged"], 5)
        await dashboard.wait_for(lambda m: m["type"] == "hello" and m["privileged"], 5)
        ok("public + organizer sockets connected")

        step("alice and bob race for the only seat")
        def body():
            return {"ticket_type_id": type_id, "quantity": 1, "idempotency_key": str(uuid.uuid4())}
        ra, rb = await asyncio.gather(
            c.post(f"/events/{event_id}/reservations", json=body(), headers=h["alice"]),
            c.post(f"/events/{event_id}/reservations", json=body(), headers=h["bob"]),
        )
        codes = sorted([ra.status_code, rb.status_code])
        assert codes == [201, 409], codes
        winner, loser = ("alice", "bob") if ra.status_code == 201 else ("bob", "alice")
        held_order = (ra if winner == "alice" else rb).json()
        ok(f"{winner} holds it, {loser} got 409 sold_out")
        await public.wait_for(lambda m: m["type"] == "seats" and m["remaining"] == 0, 5)
        ok("public socket saw remaining → 0")

        def ts(v: str) -> datetime:
            return datetime.fromisoformat(v.replace("Z", "+00:00"))

        hold_left =(ts(held_order["expires_at"]) - ts(held_order["server_now"])).total_seconds()
        step(f"{winner} walks away; waiting for the hold to expire ({hold_left:.0f}s) and the worker to sweep it")
        msg = await public.wait_for(lambda m: m["type"] == "seats" and m["remaining"] == 1, hold_left + 40)
        ok(f"worker released the seat and the socket saw it: {msg}")
        r = await c.post(f"/orders/{held_order['id']}/confirm", json={}, headers=h[winner])
        assert r.status_code == 410, r.text
        ok(f"{winner}'s late payment → 410 hold_expired")

        step(f"{loser} buys the returned seat")
        r = await c.post(f"/events/{event_id}/reservations", json=body(), headers=h[loser])
        assert r.status_code == 201, r.text
        r = await c.post(f"/orders/{r.json()['id']}/confirm", json={"payment_token": "tok_visa"}, headers=h[loser])
        assert r.status_code == 200 and r.json()["status"] == "paid", r.text
        qr = r.json()["tickets"][0]["qr"]
        ok("paid; QR issued")

        step("staff scans the QR twice")
        r1 = await c.post("/checkins", json={"qr": qr, "event_id": event_id}, headers=h["staff"])
        r2 = await c.post("/checkins", json={"qr": qr, "event_id": event_id}, headers=h["staff"])
        assert r1.status_code == 200 and r1.json()["result"] == "admitted", r1.text
        assert r2.status_code == 409 and r2.json()["result"] == "already_used", r2.text
        ok(f"first: admitted {r1.json()['attendee']}; second: already_used")
        await dashboard.wait_for(lambda m: m["type"] == "checkin" and m["checked_in"] == 1, 5)
        ok("organizer socket saw checked_in → 1")
        await asyncio.sleep(1)
        assert not any(m["type"] == "checkin" for m in public.messages), "public socket must not get staff messages"
        ok("public socket did not receive staff-only messages")

        step("dashboard + CSV")
        d = (await c.get(f"/events/{event_id}/dashboard", headers=h["organizer"])).json()
        assert (d["checked_in"], d["remaining"], d["revenue_cents"]) == (1, 0, 1000), d
        csv = (await c.get(f"/events/{event_id}/attendees.csv", headers=h["organizer"])).text
        assert loser.title() in csv
        ok("dashboard and attendee export agree")

        for t in tasks:
            t.cancel()

        step("web pages render (server-side, via the internal API URL)")
        async with httpx.AsyncClient(base_url=WEB, timeout=30) as w:
            r = await w.get("/")
            assert r.status_code == 200 and "Exactly one ticket" in r.text, r.status_code
            r = await w.get("/events?limit=50")
            assert r.status_code == 200 and f"Smoke Test {tag}" in r.text, r.status_code
            r = await w.get(f"/events/{event_id}")
            assert r.status_code == 200 and "Room 1" in r.text
            ok("landing, events list and event page render server-side")

        step("clean up: cancel the smoke event so it never lingers in public listings")
        r = await c.patch(f"/events/{event_id}", json={"status": "cancelled"}, headers=h["organizer"])
        assert r.status_code == 200 and r.json()["status"] == "cancelled", r.text
        ok("event cancelled (paid order refunded by the cancel flow)")

    print("\n\033[32;1mAll smoke checks passed.\033[0m")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except AssertionError as exc:
        print(f"\n\033[31;1mFAILED:\033[0m {exc}")
        sys.exit(1)

"""Seed a handful of demonstration events through the public API.

Every event is owned by an organizer at @demo.queueup.app, which the API flags as
`is_demo` so the site labels them "Demo event". Safe to run more than once: if the
demo organizer already has events, nothing is created.

    python scripts/seed_demo.py            # needs: pip install httpx
"""

import os
import sys
from datetime import datetime, timedelta, timezone

import httpx

API = os.getenv("API_URL", "http://localhost:8000")
EMAIL = "organizer@demo.queueup.app"
PASSWORD = os.getenv("DEMO_PASSWORD", "demo-organizer-password")

NOTE = "\n\nDemo event, seeded for demonstration. Payments use simulated test cards."

EVENTS = [
    {
        "title": "Night Market Sessions",
        "venue": "Riverside Warehouse, Chicago",
        "timezone": "America/Chicago",
        "days": 9, "time": "19:30",
        "description": "Street food, three DJs and a hundred makers' stalls under one roof.",
        "tiers": [("General", 1800, 300), ("Early entry", 3000, 60)],
    },
    {
        "title": "Small Room Comedy: Late Show",
        "venue": "The Basement, New York",
        "timezone": "America/New_York",
        "days": 12, "time": "21:00",
        "description": "Five comics, eighty seats, no phones.",
        "tiers": [("General", 2500, 80)],
    },
    {
        "title": "Builders Meetup",
        "venue": "Hall B, Austin",
        "timezone": "America/Chicago",
        "days": 16, "time": "18:00",
        "description": "Lightning talks and demos from people shipping side projects.",
        "tiers": [("Free entry", 0, 150)],
    },
    {
        "title": "Rooftop Jazz, Forty Seats",
        "venue": "Skyline Terrace, Los Angeles",
        "timezone": "America/Los_Angeles",
        "days": 21, "time": "20:00",
        "description": "A quartet at sunset. Every table faces the stage.",
        "tiers": [("Table seat", 4500, 40)],
    },
]


def main() -> None:
    with httpx.Client(base_url=API, timeout=30) as c:
        r = c.post("/auth/signup", json={"email": EMAIL, "password": PASSWORD, "display_name": "QueueUp Demo"})
        if r.status_code == 409:
            r = c.post("/auth/login", json={"email": EMAIL, "password": PASSWORD})
        r.raise_for_status()
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}

        if c.get("/me/events", headers=h).json():
            print("Demo events already seeded; nothing to do.")
            return

        for spec in EVENTS:
            day = (datetime.now(timezone.utc) + timedelta(days=spec["days"])).strftime("%Y-%m-%d")
            r = c.post("/events", headers=h, json={
                "title": spec["title"], "venue": spec["venue"], "timezone": spec["timezone"],
                "starts_at_local": f"{day}T{spec['time']}", "description": spec["description"] + NOTE,
            })
            r.raise_for_status()
            event_id = r.json()["id"]
            for name, price, capacity in spec["tiers"]:
                c.post(f"/events/{event_id}/ticket-types", headers=h,
                       json={"name": name, "price_cents": price, "capacity": capacity}).raise_for_status()
            c.patch(f"/events/{event_id}", headers=h, json={"status": "published"}).raise_for_status()
            print(f"  seeded {spec['title']}")
        print("Done.")


if __name__ == "__main__":
    try:
        main()
    except httpx.HTTPError as exc:
        print(f"Seeding failed: {exc}")
        sys.exit(1)

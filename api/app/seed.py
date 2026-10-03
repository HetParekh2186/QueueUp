"""Load a large, clearly labeled demonstration dataset straight into the database.

    docker compose exec api python -m app.seed --reset        # wipe demo data, reload
    docker compose exec api python -m app.seed --attendees 400

Everything is owned by accounts at DEMO_DOMAIN, so the API flags the events
`is_demo` and the site labels them "Demo event". Real users and their events are
never touched; --reset deletes only demo accounts and what hangs off them.

Every demo account's password is DEMO_PASSWORD, so you can log in as any of them:
    organizer@demo.queueup.app   (owns several events, sees dashboards)
    staff1@demo.queueup.app      (door staff, can scan)
    any attendee, e.g. the first one printed in the summary

The data respects every invariant the app enforces: `sold` equals the count of
held + confirmed + checked-in tickets and never exceeds capacity, check-ins exist
only on paid tickets at events that have happened, refunds and expiries free their
seats, and nobody holds more than the per-tier limit.
"""

import argparse
import asyncio
import random
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import SessionLocal, engine
from app.demo import DEMO_DOMAIN
from app.models import (
    CheckInEvent,
    Event,
    Order,
    StaffAssignment,
    Ticket,
    TicketType,
    User,
    WaitlistEntry,
)
from app.security import hash_password

DEMO_PASSWORD = "queueup-demo"
SEED = 2026

FIRST = """Aisha Ben Carmen Diego Elena Farah Gabriel Hana Ibrahim Jun Kavya Leo Maya Noah Olga
Priya Quinn Rafael Sofia Tariq Uma Victor Wen Ximena Yusuf Zoe Amara Bruno Chloe Dev Emeka Freya
Gustavo Ines Jonas Keiko Lucia Mateo Nia Oscar Paulo Rhea Sami Tomas Valentina Will Yara""".split()
LAST = """Abbott Banerjee Castillo Dubois Eze Fischer Garcia Haddad Ito Johansson Kim Lopez Mensah
Nakamura Okafor Patel Quintero Rossi Singh Tanaka Usman Varga Walsh Xu Yilmaz Zhang Alvarez Brooks
Chen Diallo Evans Fernandes Gupta Hughes Ivanova Jensen Khan Lindqvist Moreau Novak Osei Park""".split()

ORGANIZERS = [
    ("organizer", "QueueUp Demo"),
    ("riverside", "Riverside Collective"),
    ("basement", "Basement Comedy Co."),
    ("builders", "Builders Guild"),
    ("nightowl", "Night Owl Promotions"),
    ("cityarts", "City Arts Council"),
]

# (title, venue, tz, day offset, local time, organizer key, status, fill, tiers, description)
# status: published | ended | cancelled | draft. fill: share of each tier claimed.
EVENTS = [
    ("Night Market Sessions", "Riverside Warehouse, Chicago", "America/Chicago", 9, "19:30", "riverside", "published", 0.55,
     [("General", 1800, 300), ("Early entry", 3000, 60)], "Street food, three DJs and a hundred makers' stalls under one roof."),
    ("Small Room Comedy: Late Show", "The Basement, New York", "America/New_York", 5, "21:00", "basement", "published", 0.93,
     [("General", 2500, 80)], "Five comics, eighty seats, no phones."),
    ("Builders Meetup", "Hall B, Austin", "America/Chicago", 16, "18:00", "builders", "published", 0.4,
     [("Free entry", 0, 150)], "Lightning talks and demos from people shipping side projects."),
    ("Rooftop Jazz, Forty Seats", "Skyline Terrace, Los Angeles", "America/Los_Angeles", 21, "20:00", "organizer", "published", 1.0,
     [("Table seat", 4500, 40)], "A quartet at sunset. Every table faces the stage."),
    ("Synthwave All-Nighter", "Echo Hall, Berlin", "Europe/Berlin", 12, "22:00", "nightowl", "published", 0.7,
     [("Floor", 2200, 400), ("Balcony", 3500, 80)], "Analog synths until sunrise. Coat check included."),
    ("Data Engineering Summit", "Moscone West, Room 3, San Francisco", "America/Los_Angeles", 30, "09:00", "builders", "published", 0.35,
     [("Standard", 19900, 250), ("Workshop pass", 34900, 40)], "Streaming, lakehouses and the pipelines that actually ship."),
    ("Indie Film Night: Shorts Program", "Roxie Theater, San Francisco", "America/Los_Angeles", 7, "19:00", "cityarts", "published", 0.8,
     [("General", 1500, 120)], "Eight short films from first-time directors, with a Q&A after."),
    ("Midnight Ramen Pop-up", "Kanda Alley, Tokyo", "Asia/Tokyo", 10, "23:00", "nightowl", "published", 1.0,
     [("Bowl + entry", 2000, 60)], "Sixty bowls, one night, tonkotsu only."),
    ("Open Mic Poetry", "Café Lumen, Toronto", "America/Toronto", 4, "19:30", "cityarts", "published", 0.6,
     [("Listener", 0, 50), ("Reader slot", 500, 12)], "Five minutes each. Bring your own words."),
    ("Trivia Championship Finals", "The Anchor, London", "Europe/London", 14, "19:00", "organizer", "published", 0.5,
     [("Team seat", 1000, 96)], "Sixteen teams of six. The quizmaster's decision is final."),
    ("Sunrise Yoga on the Pier", "Santa Monica Pier, Los Angeles", "America/Los_Angeles", 3, "06:30", "organizer", "published", 0.9,
     [("Mat spot", 1200, 45)], "An hour of flow as the sun comes up. Mats provided."),
    ("Classical Quartet: Beethoven Cycle", "St. Martin's Hall, London", "Europe/London", 40, "19:30", "cityarts", "published", 0.25,
     [("Stalls", 3800, 160), ("Gallery", 2200, 90)], "The late quartets, played across one evening."),
    ("Robotics Workshop for Teens", "Maker Lab, Austin", "America/Chicago", 25, "10:00", "builders", "published", 0.45,
     [("Student", 0, 30), ("Parent", 0, 30)], "Build and program a line-following robot in three hours."),
    ("Startup Pitch Night", "Innovation Hub, Bengaluru", "Asia/Kolkata", 18, "18:30", "builders", "published", 0.3,
     [("Attendee", 800, 200)], "Ten founders, five minutes each, one audience vote."),
    ("Salsa Social & Lesson", "Studio 5, Miami", "America/New_York", 6, "20:00", "nightowl", "published", 0.66,
     [("Lesson + social", 2000, 90)], "Beginner lesson at eight, open floor until late."),
    ("Craft Beer Tasting Flight", "Brick Brewing Co., Denver", "America/Denver", 11, "17:00", "riverside", "published", 0.75,
     [("Tasting", 3500, 70), ("Designated driver", 1000, 20)], "Six pours from the brewers, with notes."),
    ("Esports Watch Party", "Arena Bar, Seattle", "America/Los_Angeles", 2, "18:00", "nightowl", "published", 0.85,
     [("General", 1000, 150)], "The grand final on the big screen. Prizes for the halftime quiz."),
    ("Chess Blitz Open", "Community Center, Singapore", "Asia/Singapore", 20, "13:00", "organizer", "published", 0.4,
     [("Player", 1500, 64), ("Spectator", 0, 80)], "Seven rounds of 3+2. Rated sections for all levels."),
    # Events that already happened, with door check-ins.
    ("Summer Block Party", "Wicker Park, Chicago", "America/Chicago", -12, "15:00", "riverside", "ended", 0.82,
     [("General", 0, 500), ("VIP", 4000, 50)], "Live bands, food trucks and a kids' zone."),
    ("AI Engineering Meetup #12", "Hall B, Austin", "America/Chicago", -20, "18:00", "builders", "ended", 0.9,
     [("Free entry", 0, 120)], "Evals, agents and what broke in production this month."),
    ("Comedy Late Show (September)", "The Basement, New York", "America/New_York", -26, "21:00", "basement", "ended", 1.0,
     [("General", 2500, 80)], "The September lineup. Sold out a week ahead."),
    # Cancelled after sales began: every paid order refunded.
    ("Outdoor Cinema: Classics", "Prospect Park, New York", "America/New_York", 15, "20:00", "cityarts", "cancelled", 0.3,
     [("Blanket spot", 1200, 200)], "Cancelled: the park permit fell through. All orders refunded."),
    # Drafts, visible only to their organizer.
    ("Winter Lights Festival", "Navy Pier, Chicago", "America/Chicago", 60, "17:00", "organizer", "draft", 0.0,
     [("General", 1500, 1000)], "A mile of light installations along the lake."),
    ("Product Design Crit Night", "Studio North, Toronto", "America/Toronto", 35, "18:30", "organizer", "draft", 0.0,
     [("Seat", 0, 40)], "Bring a work in progress. Leave with better questions."),
]

CHECKIN_RATE = 0.88  # share of paid tickets that showed up, at past events
MAX_PER_TIER = settings.max_active_tickets_per_type


@dataclass
class Batch:
    users: list = field(default_factory=list)
    events: list = field(default_factory=list)
    types: list = field(default_factory=list)
    orders: list = field(default_factory=list)
    tickets: list = field(default_factory=list)
    staff: list = field(default_factory=list)
    scans: list = field(default_factory=list)
    waitlist: list = field(default_factory=list)


def _local(tz: str, days: int, hhmm: str) -> datetime:
    zone = ZoneInfo(tz)
    day = (datetime.now(zone) + timedelta(days=days)).date()
    hour, minute = map(int, hhmm.split(":"))
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=zone)


def _between(rng: random.Random, start: datetime, end: datetime) -> datetime:
    if end <= start:
        return start
    return start + timedelta(seconds=rng.uniform(0, (end - start).total_seconds()))


def _qty(rng: random.Random, left: int) -> int:
    return min(left, rng.choices([1, 2, 3, 4], weights=[50, 30, 12, 8])[0])


TICKET_STATE = {"paid": "confirmed", "pending": "held", "expired": "expired", "refunded": "cancelled", "cancelled": "cancelled"}


@dataclass
class TierFiller:
    """Generates the orders, tickets and door scans for one ticket tier."""

    rng: random.Random
    b: Batch
    stats: dict
    now: datetime
    event: Event
    tt: TicketType
    created: datetime
    sales_end: datetime
    scanners: list
    attendees: list
    held_by: dict = field(default_factory=dict)

    def buyer_for(self, qty: int) -> User | None:
        """A random attendee who stays within the per-tier limit after buying qty."""
        for _ in range(40):
            cand = self.rng.choice(self.attendees)
            if self.held_by.get(cand.id, 0) + qty <= MAX_PER_TIER:
                self.held_by[cand.id] = self.held_by.get(cand.id, 0) + qty
                return cand
        return None

    def order(self, buyer: User, qty: int, state: str) -> None:
        rng, event, tt = self.rng, self.event, self.tt
        placed = _between(rng, self.created + timedelta(days=1), self.sales_end)
        o = Order(
            id=uuid.uuid4(), user_id=buyer.id, event_id=event.id, ticket_type_id=tt.id, quantity=qty,
            status=state, idempotency_key=uuid.uuid4(), created_at=placed,
            expires_at=placed + timedelta(seconds=settings.hold_seconds),
        )
        ticket_state = TICKET_STATE[state]
        if state == "pending":
            # A live hold: someone is at checkout right now.
            o.created_at = self.now - timedelta(minutes=rng.uniform(0.5, 4))
            o.expires_at = self.now + timedelta(minutes=rng.uniform(2, 9))
        if state in ("paid", "refunded"):
            o.paid_at = o.created_at + timedelta(minutes=rng.uniform(1, 6))
            o.payment_ref = None if tt.price_cents == 0 else f"sim_{uuid.uuid4().hex[:16]}"
        if event.status == "ended" and state == "paid":
            o.reminder_sent_at = event.starts_at - timedelta(hours=24)
        self.b.orders.append(o)
        self.stats["orders"] += 1
        for _ in range(qty):
            t = Ticket(
                id=uuid.uuid4(), ticket_type_id=tt.id, order_id=o.id, user_id=buyer.id,
                status=ticket_state, created_at=o.created_at,
                expires_at=o.expires_at if ticket_state == "held" else None,
                confirmed_at=o.paid_at if state in ("paid", "refunded") else None,
            )
            if event.status == "ended" and ticket_state == "confirmed" and rng.random() < CHECKIN_RATE:
                self.check_in(t)
            self.b.tickets.append(t)
            self.stats["tickets"] += 1
            if t.status in ("held", "confirmed", "checked_in"):
                tt.sold += 1

    def check_in(self, t: Ticket) -> None:
        rng, event = self.rng, self.event
        scanner = rng.choice(self.scanners)
        t.status = "checked_in"
        t.checked_in_at = event.starts_at + timedelta(minutes=rng.uniform(-30, 75))
        t.checked_in_by = scanner.id
        self.b.scans.append(CheckInEvent(event_id=event.id, ticket_id=t.id, staff_id=scanner.id,
                                         result="admitted", scanned_at=t.checked_in_at))
        if rng.random() < 0.03:  # someone tried the same code twice
            self.b.scans.append(CheckInEvent(
                event_id=event.id, ticket_id=t.id, staff_id=scanner.id, result="already_used",
                scanned_at=t.checked_in_at + timedelta(minutes=rng.uniform(1, 40))))
        self.stats["checked_in"] += 1


def build(rng: random.Random, n_attendees: int, password_hash: str) -> tuple[Batch, dict]:
    now = datetime.now(timezone.utc)
    b = Batch()

    def user(email: str, name: str, created: datetime, role: str = "user") -> User:
        u = User(id=uuid.uuid4(), email=email, password_hash=password_hash, display_name=name,
                 created_at=created, role=role)
        b.users.append(u)
        return u

    organizers = {
        key: user(f"{key}{DEMO_DOMAIN}", name, now - timedelta(days=90), role="organizer") for key, name in ORGANIZERS
    }
    staff = [
        user(f"staff{i}{DEMO_DOMAIN}", f"{rng.choice(FIRST)} {rng.choice(LAST)}", now - timedelta(days=80))
        for i in range(1, 9)
    ]
    attendees = []
    for i in range(n_attendees):
        first, last = rng.choice(FIRST), rng.choice(LAST)
        attendees.append(user(f"{first}.{last}{i}{DEMO_DOMAIN}".lower(), f"{first} {last}", now - timedelta(days=rng.uniform(1, 75))))

    for a in attendees[:3]:
        a.organizer_requested_at = now - timedelta(hours=rng.uniform(2, 72))

    stats = {"events": 0, "orders": 0, "tickets": 0, "checked_in": 0, "holds": 0, "refunded": 0, "expired": 0}

    for title, venue, tz, days, hhmm, org_key, status, fill, tiers, desc in EVENTS:
        starts = _local(tz, days, hhmm)
        created = min(now, starts) - timedelta(days=rng.uniform(20, 45))
        event = Event(
            id=uuid.uuid4(), organizer_id=organizers[org_key].id, title=title, venue=venue,
            description=f"{desc}\n\nDemo event, seeded for demonstration. Payments use simulated test cards.",
            starts_at=starts.astimezone(timezone.utc), ends_at=(starts + timedelta(hours=3)).astimezone(timezone.utc),
            timezone=tz, status=status, created_at=created,
        )
        b.events.append(event)
        stats["events"] += 1

        door = rng.sample(staff, 2) if status != "draft" else []
        for s in door:
            b.staff.append(StaffAssignment(event_id=event.id, user_id=s.id, created_at=created + timedelta(days=1)))
        scanners = door or [organizers[org_key]]

        sales_end = min(now, event.starts_at - timedelta(hours=1))
        for name, price, capacity in tiers:
            tt = TicketType(id=uuid.uuid4(), event_id=event.id, name=name, price_cents=price,
                            capacity=capacity, sold=0, created_at=created)
            b.types.append(tt)
            if status == "draft":
                continue

            filler = TierFiller(rng, b, stats, now, event, tt, created, sales_end, scanners, attendees)
            target = capacity if fill >= 1 else int(capacity * fill)

            # A few live holds on events still on sale (they expire in minutes, like real ones).
            live_holds = rng.randint(1, 3) if status == "published" and 0 < target < capacity and rng.random() < 0.5 else 0
            while tt.sold < target:
                left = target - tt.sold
                qty = _qty(rng, left)
                buyer = filler.buyer_for(qty)
                if buyer is None:
                    break
                if live_holds and left <= qty * 4:
                    filler.order(buyer, qty, "pending")
                    live_holds -= 1
                    stats["holds"] += 1
                else:
                    filler.order(buyer, qty, "paid")

            # Sold out and still on sale: a few people are waiting in line for it.
            if status == "published" and tt.sold >= capacity:
                hopefuls = [a for a in attendees if a.id not in filler.held_by]
                for k, person in enumerate(rng.sample(hopefuls, min(len(hopefuls), rng.randint(3, 6)))):
                    b.waitlist.append(WaitlistEntry(
                        ticket_type_id=tt.id, user_id=person.id, quantity=rng.choice([1, 1, 1, 2]),
                        status="waiting", created_at=now - timedelta(hours=48) + timedelta(minutes=37 * k),
                    ))
                    stats["waiting"] = stats.get("waiting", 0) + 1

            # History that no longer occupies seats: abandoned carts and refunds.
            if status in ("published", "ended"):
                for _ in range(rng.randint(1, max(1, capacity // 40))):
                    filler.order(rng.choice(attendees), _qty(rng, 2), "expired")
                    stats["expired"] += 1
            if status == "published" and rng.random() < 0.6:
                filler.order(rng.choice(attendees), 1, "refunded")
                stats["refunded"] += 1

        if status == "cancelled":
            # Sales happened, then the organizer cancelled: everything refunded, seats released.
            for o in b.orders:
                if o.event_id == event.id and o.status in ("paid", "pending"):
                    o.status = "refunded" if o.status == "paid" else "cancelled"
                    stats["refunded"] += 1
            for t in b.tickets:
                if t.order_id in {o.id for o in b.orders if o.event_id == event.id}:
                    t.status, t.expires_at = "cancelled", None
            for tt in b.types:
                if tt.event_id == event.id:
                    tt.sold = 0

        # A couple of rejected scans at past doors (screenshots of other events, forgeries).
        if status == "ended":
            for _ in range(rng.randint(1, 3)):
                b.scans.append(CheckInEvent(event_id=event.id, ticket_id=None, staff_id=rng.choice(scanners).id,
                                            result="invalid", reason=rng.choice(["signature", "wrong_event"]),
                                            scanned_at=event.starts_at + timedelta(minutes=rng.uniform(-20, 60))))

    stats["users"] = len(b.users)
    stats["sample_attendee"] = attendees[0].email if attendees else None
    return b, stats


async def reset(session: AsyncSession) -> None:
    """Delete demo accounts and everything attached to them. Real data is untouched,
    except that seat counters are recomputed for any tier a demo account had bought into."""
    demo_users = sa.select(User.id).where(User.email.ilike(f"%{DEMO_DOMAIN}")).scalar_subquery()
    demo_events = sa.select(Event.id).where(Event.organizer_id.in_(demo_users)).scalar_subquery()
    demo_types = sa.select(TicketType.id).where(TicketType.event_id.in_(demo_events)).scalar_subquery()
    touched = (await session.execute(
        sa.select(Ticket.ticket_type_id).where(Ticket.user_id.in_(demo_users)).distinct()
    )).scalars().all()
    demo_tickets = sa.select(Ticket.id).where(
        sa.or_(Ticket.ticket_type_id.in_(demo_types), Ticket.user_id.in_(demo_users))
    ).scalar_subquery()

    await session.execute(sa.delete(WaitlistEntry).where(sa.or_(
        WaitlistEntry.user_id.in_(demo_users), WaitlistEntry.ticket_type_id.in_(demo_types))))
    await session.execute(sa.delete(CheckInEvent).where(sa.or_(
        CheckInEvent.event_id.in_(demo_events), CheckInEvent.staff_id.in_(demo_users),
        CheckInEvent.ticket_id.in_(demo_tickets))))
    await session.execute(sa.update(Ticket).where(Ticket.checked_in_by.in_(demo_users))
                          .values(checked_in_by=None).execution_options(synchronize_session=False))
    await session.execute(sa.delete(Ticket).where(Ticket.id.in_(demo_tickets)))
    await session.execute(sa.delete(Order).where(sa.or_(Order.event_id.in_(demo_events), Order.user_id.in_(demo_users))))
    await session.execute(sa.delete(StaffAssignment).where(sa.or_(
        StaffAssignment.event_id.in_(demo_events), StaffAssignment.user_id.in_(demo_users))))
    await session.execute(sa.delete(TicketType).where(TicketType.event_id.in_(demo_events)))
    await session.execute(sa.delete(Event).where(Event.id.in_(demo_events)))
    await session.execute(sa.delete(User).where(User.id.in_(demo_users)))
    if touched:
        active = (sa.select(sa.func.count()).select_from(Ticket)
                  .where(Ticket.ticket_type_id == TicketType.id,
                         Ticket.status.in_(("held", "confirmed", "checked_in"))).scalar_subquery())
        await session.execute(sa.update(TicketType).where(TicketType.id.in_(touched)).values(sold=active)
                              .execution_options(synchronize_session=False))


async def seed(*, attendees: int = 300, do_reset: bool = False, password_hash: str | None = None) -> dict:
    rng = random.Random(SEED)
    async with SessionLocal() as session:
        async with session.begin():
            exists = await session.scalar(sa.select(sa.func.count()).where(User.email.ilike(f"%{DEMO_DOMAIN}")))
            if exists and not do_reset:
                raise SystemExit("Demo data already exists. Re-run with --reset to replace it.")
            if exists:
                await reset(session)
            batch, stats = build(rng, attendees, password_hash or hash_password(DEMO_PASSWORD))
            # Insert parents before children (no ORM relationships, so stage the flushes).
            for group in (batch.users, batch.events, batch.types, batch.staff, batch.orders, batch.tickets, batch.scans, batch.waitlist):
                session.add_all(group)
                await session.flush()
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description="Load QueueUp demonstration data.")
    parser.add_argument("--reset", action="store_true", help="delete existing demo data first")
    parser.add_argument("--attendees", type=int, default=300, help="number of demo attendee accounts")
    args = parser.parse_args()

    async def run() -> dict:
        try:
            return await seed(attendees=args.attendees, do_reset=args.reset)
        finally:
            await engine.dispose()

    stats = asyncio.run(run())
    print(
        f"Seeded {stats['users']} demo accounts, {stats['events']} events, {stats['orders']} orders, "
        f"{stats['tickets']} tickets ({stats['checked_in']} checked in, {stats['holds']} live holds, "
        f"{stats['refunded']} refunded, {stats['expired']} abandoned carts), {stats.get('waiting', 0)} people on waitlists."
    )
    print(f"Log in as organizer{DEMO_DOMAIN}, staff1{DEMO_DOMAIN} or {stats['sample_attendee']}")
    print(f"Password for every demo account: {DEMO_PASSWORD}")


if __name__ == "__main__":
    main()

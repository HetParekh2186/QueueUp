# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Three audiences, all of whom the public pages must serve (confirmed: "everyone"):

- **Attendees**: find an event, reserve a seat, pay inside a short hold window, and show a QR code at the door. Often on a phone.
- **Organizers**: create an event with capacity-limited ticket tiers, publish it, assign door staff, watch sales and check-ins live, and export the attendee list.
- **Door staff**: scan QR codes on their own phone's browser at the venue entrance, fast, in poor light, with a queue in front of them.
- **Evaluators** (hiring managers, engineers reviewing the project): want to see that the hard engineering problem is real and solved.

## Product Purpose

QueueUp sells a fixed number of tickets per event and checks attendees in at the door by QR, and never sells the same seat twice, even when many people race for the last ticket at the same instant. Success: a buyer either gets a real seat or a clear "sold out", never an oversold one; a ticket admits exactly one person.

## Positioning

The mechanism is correctness under contention: the check and the write happen in one guarded database step (row-level locking plus conditional updates), so the losing side of every race gets a clean answer: sold out, hold expired, already scanned. Holds expire on the database clock, and seat counts update live for everyone watching.

## Operating Context

- Buying happens under time pressure: a 10-minute hold with a countdown.
- Popular events cause a stampede: many buyers watching one counter tick down.
- Scanning happens at a physical door, on a staffer's phone, one-handed, with immediate green/amber/red verdicts.
- Organizers watch a live dashboard during the event as the check-in count climbs.

## Capabilities and Constraints

- Built: accounts with event-scoped roles (organizer, staff, admin); events with time zones and ticket tiers; time-boxed holds with idempotent reserve; simulated payment; signed QR tickets; browser-camera scanner; live seat counts and check-in counts over WebSocket; organizer dashboard; CSV export; background hold expiry, reminders, reconciliation.
- Stack: Next.js (App Router) + TypeScript + Tailwind v4 frontend; FastAPI + PostgreSQL + Redis + Celery backend.
- Payments are simulated (test cards). There are no assigned-seat maps, no offline scanning, and no real money settlement.
- The landing page (`/`) is product marketing for all audiences; the events listing lives at its own route.

## Brand Commitments

- The product name **QueueUp** is kept.
- Everything else visual (the "Q" mark, colors, fonts, the ticket-stub motif) may be replaced.

## Evidence on Hand

- A real, working product and its test suite: 100 simultaneous reservations for a single seat produce exactly one success (`api/tests/test_concurrency.py`); 20 simultaneous scans of one QR admit exactly one; an end-to-end smoke script (`scripts/smoke.py`).
- No customers, ticket volumes, testimonials, press, or pricing exist. This is a portfolio project; never fabricate any of them. Demonstration data must be labeled as such.

## Product Principles

1. **Exactly one winner.** Every race resolves cleanly, and the loser is told precisely why.
2. **The server is the authority.** Countdowns and live counters are views; the database decides.
3. **Show, don't claim.** The product's credibility comes from demonstrating the mechanism, never from invented social proof.
4. **Fast at the door.** Anything a staffer touches must work in seconds, one-handed.

## Accessibility & Inclusion

Scanner verdicts must not rely on color alone (icon + word + color). Live-updating numbers should be announced politely to assistive technology, not spammed.

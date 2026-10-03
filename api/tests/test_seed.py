"""The demo dataset must obey every invariant the app itself enforces."""

import pytest

from app.seed import seed

from .conftest import make_event, make_user, sql


async def check_invariants() -> None:
    drift = await sql(
        """SELECT tt.id FROM ticket_types tt
           WHERE tt.sold <> (SELECT count(*) FROM tickets t WHERE t.ticket_type_id = tt.id
                               AND t.status IN ('held','confirmed','checked_in'))
              OR tt.sold > tt.capacity"""
    )
    assert drift == [], "sold counter must equal active tickets and never exceed capacity"

    [(bad_checkins,)] = await sql(
        """SELECT count(*) FROM tickets t JOIN ticket_types tt ON tt.id = t.ticket_type_id
           JOIN events e ON e.id = tt.event_id
           WHERE t.status = 'checked_in' AND (e.status <> 'ended' OR t.checked_in_at IS NULL)"""
    )
    assert bad_checkins == 0, "check-ins only at events that happened"

    [(over_limit,)] = await sql(
        """SELECT count(*) FROM (SELECT user_id, ticket_type_id FROM tickets
             WHERE status IN ('held','confirmed','checked_in')
             GROUP BY 1, 2 HAVING count(*) > 10) x"""
    )
    assert over_limit == 0, "per-user tier limit respected"

    [(mismatched,)] = await sql(
        """SELECT count(*) FROM orders o WHERE
             (o.status = 'paid' AND EXISTS (SELECT 1 FROM tickets t WHERE t.order_id = o.id
                                            AND t.status NOT IN ('confirmed','checked_in')))
          OR (o.status IN ('refunded','cancelled','expired') AND EXISTS (SELECT 1 FROM tickets t
                WHERE t.order_id = o.id AND t.status IN ('held','confirmed','checked_in')))
          OR (o.quantity <> (SELECT count(*) FROM tickets t WHERE t.order_id = o.id))"""
    )
    assert mismatched == 0, "order and ticket states agree"


async def test_seed_is_consistent_and_resettable(client):
    real_organizer = await make_user("real organizer")
    real_event, _ = await make_event(client, real_organizer)

    stats = await seed(attendees=60, password_hash="x")
    assert stats["events"] == 24 and stats["checked_in"] > 0 and stats["holds"] > 0
    await check_invariants()

    listing = (await client.get("/events?limit=50")).json()["items"]
    demo = [e for e in listing if e["is_demo"]]
    assert demo and all(e["id"] != real_event for e in demo)
    assert any(e["remaining"] == 0 for e in demo), "some demo events are sold out"

    with pytest.raises(SystemExit):
        await seed(attendees=60, password_hash="x")  # refuses to double-load

    again = await seed(attendees=60, do_reset=True, password_hash="x")
    assert again["tickets"] == stats["tickets"]  # deterministic, fully replaced
    await check_invariants()
    [(real_left,)] = await sql("SELECT count(*) FROM events WHERE id = :id", id=real_event)
    assert real_left == 1, "reset never touches real data"

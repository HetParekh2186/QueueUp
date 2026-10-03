import uuid
from dataclasses import dataclass, field
from typing import Any, Literal


@dataclass(frozen=True)
class Notification:
    """A real-time message for one event's channel.

    Services *return* these instead of publishing them, so the caller can publish only
    after the transaction commits — never broadcast a seat change that rolls back.
    """

    event_id: uuid.UUID
    payload: dict[str, Any] = field(default_factory=dict)
    # "public" goes to everyone watching the event page; "staff" only to the
    # organizer / assigned staff dashboards.
    audience: Literal["public", "staff"] = "public"


def seats(event_id: uuid.UUID, ticket_type_id: uuid.UUID, capacity: int, sold: int) -> Notification:
    return Notification(
        event_id,
        {
            "type": "seats",
            "ticket_type_id": str(ticket_type_id),
            "capacity": capacity,
            "sold": sold,
            "remaining": max(capacity - sold, 0),
        },
    )


def checkin(event_id: uuid.UUID, checked_in: int) -> Notification:
    return Notification(event_id, {"type": "checkin", "checked_in": checked_in}, "staff")


def order_changed(event_id: uuid.UUID) -> Notification:
    """Held -> confirmed doesn't change seats remaining, but dashboards care."""
    return Notification(event_id, {"type": "orders"}, "staff")

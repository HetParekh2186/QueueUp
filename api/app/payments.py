"""Simulated payment provider with the same shape as a real one (authorize -> capture,
or void). The point is the ordering around the guarded confirm: authorize first,
then try to win the hold; capture only if we won, void if we didn't.

Test tokens: ``tok_visa`` (or anything else) succeeds, ``tok_decline`` is declined.
"""

import logging
import uuid

from app.errors import DomainError

log = logging.getLogger("queueup.payments")


def authorize(amount_cents: int, payment_token: str) -> str | None:
    if amount_cents == 0:
        return None  # free ticket, nothing to charge
    if payment_token == "tok_decline":
        raise DomainError(402, "payment_declined")
    auth_id = f"auth_{uuid.uuid4().hex[:16]}"
    log.info("payment authorized", extra={"ctx": {"auth": auth_id, "amount_cents": amount_cents}})
    return auth_id


def capture(auth_id: str | None) -> None:
    if auth_id:
        log.info("payment captured", extra={"ctx": {"auth": auth_id}})


def void(auth_id: str | None) -> None:
    if auth_id:
        log.info("payment voided", extra={"ctx": {"auth": auth_id}})


def refund(auth_id: str | None) -> None:
    if auth_id:
        log.info("payment refunded", extra={"ctx": {"auth": auth_id}})

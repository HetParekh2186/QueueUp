import uuid
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.config import settings

_hasher = PasswordHasher()
# Verified against when the email doesn't exist, so a login for an unknown account
# takes as long as one with a wrong password (no user enumeration via timing).
_DUMMY_HASH = _hasher.hash("queueup-timing-equalizer")

ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


class TokenError(Exception):
    pass


def _encode(claims: dict, ttl: timedelta, secret: str) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({**claims, "iat": now, "exp": now + ttl}, secret, algorithm=ALGORITHM)


def create_access_token(user_id: uuid.UUID, is_admin: bool) -> str:
    # Only identity and the platform-level admin bit go in the token. Per-event roles
    # (owner / staff) are looked up per request, so revoking staff access is immediate.
    return _encode(
        {"sub": str(user_id), "adm": is_admin, "typ": "access"},
        timedelta(minutes=settings.access_token_minutes),
        settings.secret_key,
    )


def create_refresh_token(user_id: uuid.UUID) -> str:
    return _encode(
        {"sub": str(user_id), "typ": "refresh"},
        timedelta(days=settings.refresh_token_days),
        settings.secret_key,
    )


def decode_token(token: str, expected_type: str) -> uuid.UUID:
    try:
        claims = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    except jwt.PyJWTError as exc:
        raise TokenError(str(exc)) from exc
    if claims.get("typ") != expected_type:
        raise TokenError("wrong token type")
    try:
        return uuid.UUID(claims["sub"])
    except (KeyError, ValueError) as exc:
        raise TokenError("bad subject") from exc


# --- Ticket QR codes ---------------------------------------------------------------
# A QR never holds a bare ticket id (guessable -> forgeable). It holds an HMAC-signed
# token over {ticket_id, event_id}. The signature stops forgery; the ticket state
# machine (confirmed -> checked_in, guarded) stops reuse of a copied code.


def sign_qr(ticket_id: uuid.UUID, event_id: uuid.UUID) -> str:
    return jwt.encode(
        {"tid": str(ticket_id), "eid": str(event_id), "typ": "qr"},
        settings.qr_secret,
        algorithm=ALGORITHM,
    )


def verify_qr(token: str) -> tuple[uuid.UUID, uuid.UUID]:
    try:
        claims = jwt.decode(token, settings.qr_secret, algorithms=[ALGORITHM])
        if claims.get("typ") != "qr":
            raise TokenError("wrong token type")
        return uuid.UUID(claims["tid"]), uuid.UUID(claims["eid"])
    except (jwt.PyJWTError, KeyError, ValueError) as exc:
        raise TokenError(str(exc)) from exc

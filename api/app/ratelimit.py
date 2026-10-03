"""Fixed-window rate limiting on Redis counters. Fails open: if Redis is unavailable we
keep selling tickets rather than take the site down (inventory safety never depends
on this — it's enforced by Postgres)."""

import logging

from fastapi import HTTPException, Request

from app.config import settings
from app.realtime import publisher
from app.security import TokenError, decode_token

log = logging.getLogger("queueup.ratelimit")


async def hit(key: str, limit: int, window_seconds: int) -> None:
    if not settings.rate_limit_enabled:
        return
    redis_key = f"rl:{key}"
    try:
        pipe = publisher.redis.pipeline()
        pipe.incr(redis_key)
        pipe.expire(redis_key, window_seconds, nx=True)
        count, _ = await pipe.execute()
    except Exception:
        log.warning("rate limiter unavailable; failing open")
        return
    if count > limit:
        raise HTTPException(
            status_code=429,
            detail={"error": "rate_limited", "retry_after": window_seconds},
            headers={"Retry-After": str(window_seconds)},
        )


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class RateLimit:
    """Dependency: ``Depends(RateLimit("reserve", 20, 60, per="user"))``."""

    def __init__(self, scope: str, limit: int, window_seconds: int, per: str = "ip") -> None:
        self.scope = scope
        self.limit = limit
        self.window = window_seconds
        self.per = per

    async def __call__(self, request: Request) -> None:
        subject = None
        if self.per == "user":
            auth = request.headers.get("authorization", "")
            if auth.lower().startswith("bearer "):
                try:
                    subject = f"u:{decode_token(auth[7:], 'access')}"
                except TokenError:
                    pass
        subject = subject or f"ip:{client_ip(request)}"
        await hit(f"{self.scope}:{subject}", self.limit, self.window)

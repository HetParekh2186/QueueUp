"""WebSocket fan-out across API workers via Redis pub/sub.

A reservation handled by worker 1 must reach a socket held by worker 2. Every handler
publishes to Redis channel ``event:<id>``; every worker runs one pattern subscriber
that forwards messages to its own local sockets.
"""

import asyncio
import json
import logging
import uuid
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass

from fastapi import WebSocket
from redis.asyncio import Redis

from app.config import settings
from app.notifications import Notification

log = logging.getLogger("queueup.realtime")

CHANNEL_PREFIX = "event:"


@dataclass(eq=False)
class Client:
    ws: WebSocket
    privileged: bool  # organizer / assigned staff: may receive dashboard messages


class ConnectionManager:
    def __init__(self) -> None:
        self.rooms: dict[str, set[Client]] = defaultdict(set)

    def add(self, event_id: uuid.UUID, client: Client) -> None:
        self.rooms[str(event_id)].add(client)

    def remove(self, event_id: uuid.UUID, client: Client) -> None:
        room = self.rooms.get(str(event_id))
        if room is not None:
            room.discard(client)
            if not room:
                self.rooms.pop(str(event_id), None)

    async def broadcast_local(self, event_id: str, payload: dict, audience: str) -> None:
        for client in list(self.rooms.get(event_id, ())):
            if audience == "staff" and not client.privileged:
                continue
            try:
                await client.ws.send_json(payload)
            except Exception:
                self.rooms[event_id].discard(client)


manager = ConnectionManager()


class Publisher:
    def __init__(self, redis_url: str) -> None:
        self.redis = Redis.from_url(
            redis_url, decode_responses=True, socket_connect_timeout=1, socket_timeout=1
        )

    async def publish(self, notifications: Iterable[Notification]) -> None:
        for n in notifications:
            message = json.dumps({"audience": n.audience, "payload": n.payload})
            try:
                await self.redis.publish(f"{CHANNEL_PREFIX}{n.event_id}", message)
            except Exception:
                # Real-time is an enhancement, not a dependency: if Redis is down,
                # at least deliver to sockets on this worker and keep serving HTTP.
                log.warning("redis publish failed; local delivery only", extra={"ctx": {"event_id": str(n.event_id)}})
                await manager.broadcast_local(str(n.event_id), n.payload, n.audience)

    async def close(self) -> None:
        await self.redis.aclose()


publisher = Publisher(settings.redis_url)


async def listen_forever(redis_url: str) -> None:
    while True:
        redis = Redis.from_url(redis_url, decode_responses=True)
        try:
            pubsub = redis.pubsub()
            await pubsub.psubscribe(f"{CHANNEL_PREFIX}*")
            log.info("realtime subscriber connected")
            async for message in pubsub.listen():
                if message.get("type") != "pmessage":
                    continue
                event_id = message["channel"][len(CHANNEL_PREFIX):]
                data = json.loads(message["data"])
                await manager.broadcast_local(event_id, data["payload"], data["audience"])
        except asyncio.CancelledError:
            raise
        except Exception:
            log.warning("realtime subscriber lost connection; retrying", exc_info=True)
            await asyncio.sleep(2)
        finally:
            await redis.aclose()

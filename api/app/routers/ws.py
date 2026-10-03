import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.db import SessionLocal
from app.deps import can_scan, user_from_token
from app.models import Event
from app.realtime import Client, manager

router = APIRouter()


@router.websocket("/ws/events/{event_id}")
async def event_socket(ws: WebSocket, event_id: uuid.UUID, token: str | None = None) -> None:
    """One channel per event. Everyone gets seat counts; organizer/assigned staff
    (authenticated via ``?token=``) also get check-in and order updates.

    Counts pushed here are a *view*, never a gate: the locked transaction at reserve
    time is the only thing that decides whether a sale succeeds.
    """
    async with SessionLocal() as session:
        event = await session.get(Event, event_id)
        if event is None or event.status == "draft":
            await ws.close(code=4404)
            return
        user = await user_from_token(session, token) if token else None
        privileged = await can_scan(session, user, event)

    await ws.accept()
    client = Client(ws=ws, privileged=privileged)
    manager.add(event_id, client)
    try:
        await ws.send_json({"type": "hello", "privileged": privileged})
        while True:
            await ws.receive_text()  # clients may send pings; we only push
    except WebSocketDisconnect:
        pass
    finally:
        manager.remove(event_id, client)

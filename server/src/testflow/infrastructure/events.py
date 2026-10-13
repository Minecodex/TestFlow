import asyncio

from fastapi import APIRouter, WebSocket
from sqlalchemy import select

from testflow.infrastructure.retry import database_retry
from testflow.features.auth import COOKIE
from testflow.infrastructure.models import Event, Session
from testflow.infrastructure.revisions import serialize

router = APIRouter(tags=["live"])


@database_retry
async def emit(app, execution_id, kind, data=None, node_id=None, task_id=None):
    async with app.state.database.sessions() as db, db.begin():
        row = Event(execution_id=execution_id, task_id=task_id, kind=kind, data=data or {}, node_id=node_id)
        db.add(row); await db.flush()
        return row.id


async def authorize_socket(socket: WebSocket):
    import hashlib
    from datetime import UTC, datetime
    settings = socket.app.state.settings
    origin = socket.headers.get("origin")
    if origin and origin != settings.public_url:
        await socket.close(1008); return False
    factory = socket.app.state.database.sessions
    if not factory: await socket.close(1013); return False
    token = socket.cookies.get(COOKIE, "")
    async with factory() as db:
        row = await db.get(Session, hashlib.sha256(token.encode()).hexdigest())
        if not row or row.expires.replace(tzinfo=UTC) < datetime.now(UTC):
            await socket.close(1008); return False
    return True


@router.websocket("/live")
async def live(socket: WebSocket, cursor: int = 0):
    if not await authorize_socket(socket): return
    await socket.accept()
    try:
        while True:
            if not await authorize_socket(socket): return
            async with socket.app.state.database.sessions() as db:
                rows = (await db.scalars(select(Event).where(Event.id > cursor).order_by(Event.id).limit(200))).all()
            for row in rows:
                await socket.send_json(serialize(row)); cursor = row.id
            if not rows:
                await socket.send_json({"kind": "heartbeat", "cursor": cursor})
                await asyncio.sleep(1)
    except Exception:
        # A closed browser subscription never changes execution state.
        return

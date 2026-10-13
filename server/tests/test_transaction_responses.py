import asyncio
import json

from fastapi import Request
from sqlalchemy.exc import SQLAlchemyError

from testflow.core.dependencies import session


async def test_login_response_waits_for_transaction_commit(app_client):
    app, _ = app_client
    committed, starts = False, []
    async def delayed_session(request: Request):
        nonlocal committed
        async with app.state.database.sessions() as db:
            async with db.begin():
                yield db
                await asyncio.sleep(.02)
            committed = True
    app.dependency_overrides[session] = delayed_session
    body = json.dumps({"username": "admin", "password": "test-password"}).encode()
    finished = asyncio.Event()
    delivered = False
    async def receive():
        nonlocal delivered
        if not delivered:
            delivered = True
            return {"type": "http.request", "body": body, "more_body": False}
        await finished.wait()
        return {"type": "http.disconnect"}
    async def send(message):
        if message["type"] == "http.response.start":
            starts.append({"status": message["status"], "committed": committed})
        if message["type"] == "http.response.body" and not message.get("more_body"):
            finished.set()
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST",
        "scheme": "http", "path": "/api/v1/auth/login", "raw_path": b"/api/v1/auth/login", "query_string": b"",
        "root_path": "", "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
        "client": ("127.0.0.1", 12345), "server": ("test", 80)}
    try:
        async with asyncio.timeout(3):
            await app(scope, receive, send)
        assert starts == [{"status": 200, "committed": True}]
    finally:
        app.dependency_overrides.clear()


async def test_commit_failure_returns_error_instead_of_success(app_client):
    app, client = app_client
    async def failing_session(request: Request):
        async with app.state.database.sessions() as db, db.begin():
            yield db
            raise SQLAlchemyError("simulated transaction commit failure")
    app.dependency_overrides[session] = failing_session
    try:
        response = await client.post("/api/v1/auth/login", json={"username": "admin", "password": "test-password"})
        assert response.status_code == 503 and response.json()["code"] == "database_unavailable"
        assert "set-cookie" not in response.headers
    finally:
        app.dependency_overrides.clear()

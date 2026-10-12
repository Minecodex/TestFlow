import pytest


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [ConnectionRefusedError("private connection details"), TimeoutError("private connection details")])
async def test_database_dependency_errors_are_bounded_public_failures(app_client, monkeypatch, failure):
    app, client = app_client

    class Unavailable:
        async def __aenter__(self):
            raise failure

        async def __aexit__(self, *args):
            pass

    monkeypatch.setattr(app.state.database, "sessions", lambda: Unavailable())
    response = await client.get("/api/v1/modules")
    assert response.status_code == 503
    assert response.json()["code"] == "database_unavailable"
    assert response.json()["request_id"] == response.headers["X-Request-ID"]
    assert "private" not in response.text

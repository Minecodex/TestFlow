from pathlib import Path

from fastapi.testclient import TestClient

from testflow.core.config import Settings
from testflow.main import create_app


def test_bootstrap_contract_and_storage(tmp_path: Path):
    app = create_app(Settings(environment="test", data_dir=tmp_path, database_url=None, _env_file=None))
    with TestClient(app) as client:
        assert client.get("/health/live").json() == {"status": "ok"}
        assert client.get("/health/ready").json() == {"status": "ready"}
        result = client.get("/api/v1/system/status")
        assert result.status_code == 200
        status = result.json()
        assert status["architecture"] == "monolith"
        assert status["database"] == "not_configured"
        assert len(status["features"]) == 8
        assert all(feature["state"] == "planned" for feature in status["features"])
        assert (tmp_path / "assets").is_dir()
        assert (tmp_path / "module-packages").is_dir()
        assert client.get("/api/v1/modules").status_code == 503


def test_dependency_failure_affects_readiness_only(tmp_path: Path, monkeypatch):
    app = create_app(Settings(environment="test", data_dir=tmp_path, database_url=None, _env_file=None))
    with TestClient(app) as client:
        async def unavailable():
            raise ConnectionError("sensitive connection details")

        monkeypatch.setattr(app.state.database, "ping", unavailable)
        response = client.get("/health/ready")
        assert response.status_code == 503
        assert response.json() == {"status": "not_ready"}
        assert "sensitive" not in response.text
        assert client.get("/health/live").status_code == 200

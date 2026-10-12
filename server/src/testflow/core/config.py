from pathlib import Path
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="TESTFLOW_", env_file=".env", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
    data_dir: Path = Path(".data")
    database_url: SecretStr | None = None
    admin_password_hash: SecretStr | None = None
    encryption_key: SecretStr | None = None
    cookie_secure: bool = False
    session_hours: int = 24
    public_url: str = "http://127.0.0.1:5173"
    namespace: str = "testflow-dev"
    kube_context: str | None = None
    backend_url: str = "http://testflow-server:8000"
    data_claim: str = "testflow-data"
    backend_node: str | None = None
    module_service_account: str = "testflow-module"
    image_pull_secret: str | None = None
    allow_local_images: bool = False
    scheduler_enabled: bool = True
    max_upload_bytes: int = 100 * 1024 * 1024

from pathlib import Path
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="TESTFLOW_", env_file=".env", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
    data_dir: Path = Path(".data")
    database_url: SecretStr | None = None

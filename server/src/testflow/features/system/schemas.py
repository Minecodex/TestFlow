from typing import Literal

from pydantic import BaseModel


class FeatureStatus(BaseModel):
    id: str
    state: Literal["planned", "available"] = "planned"


class SystemStatus(BaseModel):
    service: Literal["testflow"] = "testflow"
    version: str
    architecture: Literal["monolith"] = "monolith"
    database: Literal["configured", "not_configured"]
    features: list[FeatureStatus]

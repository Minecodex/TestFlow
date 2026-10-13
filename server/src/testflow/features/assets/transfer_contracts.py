from pathlib import PurePosixPath
from typing import Any, Literal

from pydantic import Field, field_validator, model_validator

from testflow.core.contracts import StrictModel
from testflow.infrastructure.revisions import digest


class ResourceSelection(StrictModel):
    id: str = Field(min_length=1)
    version: int | None = Field(default=None, ge=1)


class AssetFile(StrictModel):
    path: str = Field(min_length=1, max_length=256)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    size: int = Field(ge=0)

    @field_validator("path")
    @classmethod
    def safe_path(cls, value):
        path = PurePosixPath(value)
        if path.is_absolute() or len(path.parts) != 2 or path.parts[0] not in {"files", "originals"} or ".." in path.parts or "\\" in value or "\x00" in value or str(path) != value:
            raise ValueError("Use a file directly inside files/ or originals/")
        return value


class PortableAsset(StrictModel):
    key: str = Field(pattern=r"^[A-Za-z0-9_-]+$", max_length=128)
    name: str = Field(min_length=1, max_length=256)
    type: Literal["Text", "Audio", "Image"]
    format: str
    file: AssetFile
    original: AssetFile | None = None
    tags: list[str] = Field(default_factory=list, max_length=256)
    metadata: dict[str, Any] = Field(default_factory=dict)
    category: str = Field(default="", max_length=128)
    reference: Any = None
    reference_confirmed: bool = False
    source: str = Field(default="upload", max_length=256)

    @model_validator(mode="after")
    def media_format(self):
        formats = {"Text": "UTF-8", "Audio": "WAV · 16kHz · Mono", "Image": "Image/*"}
        if self.format != formats[self.type] or self.file.path.split("/")[0] != "files":
            raise ValueError("Asset format and canonical file must match the media type")
        if self.original and (self.type != "Audio" or self.original.path.split("/")[0] != "originals"):
            raise ValueError("Only audio may include an original file")
        import json
        json.dumps(self.reference, allow_nan=False)
        json.dumps(self.metadata, allow_nan=False)
        reserved = {"execution_id", "runtime_id", "width", "height", "encoding", "sample_rate", "channels", "frames", "duration"}
        if reserved.intersection(self.metadata):
            raise ValueError("Portable metadata excludes local Trace links and decoded media properties")
        return self

    def revision_digest(self):
        value = self.model_dump(mode="json", exclude={"key"})
        # File placement and extensions are packaging details, not revision identity.
        for field in ["file", "original"]:
            if value[field]:
                value[field].pop("path")
        return digest(value)


class AssetPackage(StrictModel):
    format: Literal["testflow.assets.v1"]
    assets: list[PortableAsset] = Field(min_length=1, max_length=1000)

    @field_validator("assets")
    @classmethod
    def unique_keys(cls, value):
        if len({a.key for a in value}) != len(value):
            raise ValueError("Asset keys must be unique")
        return value


class AssetExport(StrictModel):
    assets: list[ResourceSelection] = Field(min_length=1, max_length=1000)


class AssetImportItem(StrictModel):
    key: str
    name: str
    type: str
    revision_digest: str
    state: Literal["create", "reuse"]
    resource: ResourceSelection | None = None


class AssetPreview(StrictModel):
    valid: bool = True
    items: list[AssetImportItem]


class AssetImportResult(StrictModel):
    items: list[AssetImportItem]
    created: int
    reused: int

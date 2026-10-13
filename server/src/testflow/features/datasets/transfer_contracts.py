from typing import Any, Literal

from pydantic import Field, model_validator

from testflow.core.contracts import DatasetBody, Schema, StrictModel
from testflow.features.assets.transfer_contracts import ResourceSelection


class DatasetAsset(StrictModel):
    key: str = Field(pattern=r"^[A-Za-z0-9_-]+$", max_length=128)
    name: str
    type: Literal["Text", "Audio", "Image"]
    format: str
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    revision_digest: str = Field(pattern=r"^[a-f0-9]{64}$")


class PortableBinding(StrictModel):
    value: Any = None
    asset_key: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def one_source(self):
        if self.asset_key:
            if self.value is not None:
                raise ValueError("Choose an asset key or a literal value")
        elif "value" not in self.model_fields_set:
            raise ValueError("An explicit literal or asset key is required")
        import json
        json.dumps(self.value, allow_nan=False)
        return self


class PortableCase(StrictModel):
    key: str = Field(pattern=r"^[A-Za-z0-9_-]+$", max_length=128)
    name: str = Field(min_length=1)
    inputs: dict[str, PortableBinding]


class PortableDataset(StrictModel):
    name: str = Field(min_length=1, max_length=256)
    description: str = ""
    input_schema: Schema
    cases: list[PortableCase] = Field(default_factory=list, max_length=10000)

    @model_validator(mode="after")
    def case_fields(self):
        if len({c.key for c in self.cases}) != len(self.cases):
            raise ValueError("Case keys must be unique")
        names = {f.name for f in self.input_schema.fields}
        if any(set(c.inputs) != names for c in self.cases):
            raise ValueError("Each case must bind every named input exactly once")
        return self


class DatasetDocument(StrictModel):
    format: Literal["testflow.dataset.v1"]
    assets: list[DatasetAsset] = Field(default_factory=list, max_length=1000)
    dataset: PortableDataset

    @model_validator(mode="after")
    def dependencies(self):
        keys = [a.key for a in self.assets]
        used = {b.asset_key for c in self.dataset.cases for b in c.inputs.values() if b.asset_key}
        if len(set(keys)) != len(keys) or set(keys) != used:
            raise ValueError("Asset dependencies must be unique and exactly match case bindings")
        return self


class DatasetImport(StrictModel):
    document: DatasetDocument
    bindings: dict[str, ResourceSelection] = Field(default_factory=dict)
    name: str | None = Field(default=None, min_length=1, max_length=256)


class DatasetCandidate(ResourceSelection):
    name: str


class DatasetRequirement(DatasetAsset):
    state: Literal["resolved", "missing", "selection_required", "invalid_binding"]
    candidates: list[DatasetCandidate]
    selected: ResourceSelection | None = None


class DatasetPreview(StrictModel):
    valid: bool
    requirements: list[DatasetRequirement]
    errors: list[dict[str, Any]]
    dataset: DatasetBody | None = None

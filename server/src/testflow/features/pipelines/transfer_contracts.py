"""Portable workflows refer to package identities and Git commits, never installation IDs."""
from typing import Any, Literal

from pydantic import Field, model_validator

from testflow.core.contracts import GraphNode, PipelineBody, PodRuntime, RepositoryBody, Schema, StrictModel


class WorkflowModule(StrictModel):
    key: str = Field(min_length=1, max_length=128)
    id: str = Field(pattern=r"^[a-z][a-z0-9-]*$", max_length=128)
    version: str = Field(min_length=1, max_length=128)
    package_digest: str = Field(pattern=r"^[a-f0-9]{64}$")


class WorkflowRepository(StrictModel):
    key: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=256)
    url: str
    commit: str = Field(pattern=r"^[a-f0-9]{40,64}$")

    @model_validator(mode="after")
    def safe_url(self):
        RepositoryBody(name=self.name, url=self.url, branch=self.commit)
        return self


class WorkflowCredential(StrictModel):
    key: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=256)
    kind: Literal["module", "registry"]


class WorkflowMount(StrictModel):
    repository_key: str
    commit: str = Field(pattern=r"^[a-f0-9]{40,64}$")
    mount_path: str


class WorkflowRuntime(StrictModel):
    mode: Literal["pod"] = "pod"
    image: str
    port: int = 8080
    code_mount: WorkflowMount | None = None
    registry_credential_key: str | None = None
    reuse_scope: Literal["batch_node", "execution_node"] = "batch_node"
    requires_sequential: bool = False
    cpu: str = "500m"
    memory: str = "512Mi"

    @model_validator(mode="after")
    def valid_runtime(self):
        value = self.model_dump(exclude={"registry_credential_key", "code_mount"})
        if self.code_mount:
            value["code_mount"] = {"repository_id": self.code_mount.repository_key, "repository_version": 1,
                                   "commit": self.code_mount.commit, "mount_path": self.code_mount.mount_path}
        PodRuntime.model_validate(value)
        return self


class ParameterCredential(StrictModel):
    path: list[str | int] = Field(min_length=1, max_length=32)
    credential_key: str


class WorkflowNode(StrictModel):
    id: str
    kind: Literal["start", "end", "module", "assembly", "conversion"]
    name: str
    description: str = Field(default="", max_length=4096)
    x: float = 0
    y: float = 0
    module_key: str | None = None
    input_schema: Schema | None = None
    output_schema: Schema | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)
    parameter_credentials: list[ParameterCredential] = Field(default_factory=list)
    runtime: WorkflowRuntime | None = None
    timeout: float = 30
    mappings: list[dict[str, str]] = Field(default_factory=list)
    direction: Literal["to_stream", "to_full"] | None = None

    @model_validator(mode="after")
    def valid_node(self):
        value = self.model_dump(exclude={"module_key", "parameter_credentials", "runtime"})
        GraphNode.model_validate(value)
        if (self.kind == "module") != bool(self.module_key):
            raise ValueError("Only module nodes require a module_key")
        if self.kind != "module" and (self.runtime or self.parameter_credentials):
            raise ValueError("Only module nodes may declare runtime or credentials")
        paths = set()
        for binding in self.parameter_credentials:
            if tuple(binding.path) in paths:
                raise ValueError("Duplicate parameter credential path")
            paths.add(tuple(binding.path))
            value = self.parameters
            try:
                for part in binding.path:
                    if isinstance(value, list) and (not isinstance(part, int) or part < 0):
                        raise ValueError("Invalid array index")
                    value = value[part]
            except (KeyError, IndexError, TypeError):
                raise ValueError("Credential path must exist in parameters") from None
            if value is not None:
                raise ValueError("Portable credential parameters must be null")
        return self


class WorkflowPipeline(StrictModel):
    name: str = Field(min_length=1, max_length=256)
    description: str = ""
    input_schema: Schema
    output_schema: Schema
    nodes: list[WorkflowNode] = Field(min_length=2, max_length=500)
    edges: list[dict[str, str]] = Field(max_length=5000)
    preparation_timeout: float = 60
    cleanup_timeout: float = 10

    @model_validator(mode="after")
    def valid_settings(self):
        PipelineBody.model_validate({**self.model_dump(exclude={"nodes"}), "nodes": []})
        return self


class WorkflowDocument(StrictModel):
    format: Literal["testflow.workflow.v1"]
    pipeline: WorkflowPipeline
    modules: list[WorkflowModule] = Field(default_factory=list, max_length=500)
    repositories: list[WorkflowRepository] = Field(default_factory=list, max_length=500)
    credentials: list[WorkflowCredential] = Field(default_factory=list, max_length=500)

    @model_validator(mode="after")
    def references(self):
        keys = [r.key for r in [*self.modules, *self.repositories, *self.credentials]]
        if len(keys) != len(set(keys)):
            raise ValueError("Dependency keys must be globally unique")
        modules = {r.key for r in self.modules}
        repos = {r.key: r for r in self.repositories}
        credentials = {r.key: r.kind for r in self.credentials}
        used = set()
        for node in self.pipeline.nodes:
            if node.module_key:
                if node.module_key not in modules:
                    raise ValueError("Unknown module_key")
                used.add(node.module_key)
            if node.runtime:
                mount = node.runtime.code_mount
                if mount:
                    if mount.repository_key not in repos or repos[mount.repository_key].commit != mount.commit:
                        raise ValueError("Mount must refer to the declared repository commit")
                    used.add(mount.repository_key)
                key = node.runtime.registry_credential_key
                if key:
                    if credentials.get(key) != "registry":
                        raise ValueError("Invalid registry credential key")
                    used.add(key)
            for binding in node.parameter_credentials:
                if credentials.get(binding.credential_key) != "module":
                    raise ValueError("Invalid module credential key")
                used.add(binding.credential_key)
        if used != set(keys):
            raise ValueError("Every declared dependency must be used")
        return self


class WorkflowSelection(StrictModel):
    id: str = Field(min_length=1)
    version: int | None = Field(default=None, ge=1)


class WorkflowImport(StrictModel):
    document: WorkflowDocument
    bindings: dict[str, WorkflowSelection] = Field(default_factory=dict)
    name: str | None = Field(default=None, min_length=1, max_length=256)


class WorkflowOption(WorkflowSelection):
    name: str


class WorkflowRequirement(StrictModel):
    key: str
    kind: Literal["module", "repository", "credential"]
    name: str
    identity: str
    state: Literal["resolved", "missing", "selection_required"]
    options: list[WorkflowOption]
    selected: WorkflowSelection | None = None


class WorkflowPreview(StrictModel):
    valid: bool
    requirements: list[WorkflowRequirement]
    errors: list[dict[str, Any]]
    pipeline: PipelineBody | None = None

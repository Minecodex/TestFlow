"""Public response envelopes. Internal snapshots retain additive evidence fields."""
from datetime import datetime
from typing import Any
from pydantic import BaseModel, ConfigDict, Field

class EvidenceResponse(BaseModel):
    model_config = ConfigDict(extra='ignore')

class ErrorResponse(EvidenceResponse):
    code: str
    message: str
    fields: dict[str, Any] = Field(default_factory=dict)
    request_id: str | None = None

class OperationResponse(EvidenceResponse):
    id: str
    kind: str
    state: str
    progress: int
    payload: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any]
    error: ErrorResponse | None = None
    created: datetime
    updated: datetime

class ResourceResponse(EvidenceResponse):
    id: str
    kind: str
    name: str
    version: int
    selected_version: int
    revision_id: str
    digest: str
    hidden: bool
    created: datetime
    updated: datetime
    data: dict[str, Any]
    operation_id: str | None = None
    binding_digest: str | None = None
    availability: OperationResponse | None = None
    sync_operation: OperationResponse | None = None
    import_operation: OperationResponse | None = None

class ResourcePageResponse(EvidenceResponse):
    items: list[ResourceResponse]
    total: int
    page: int
    page_size: int

class RevisionResponse(EvidenceResponse):
    id: str
    resource_id: str
    number: int
    data: dict[str, Any]
    digest: str
    created: datetime

class RevisionPageResponse(EvidenceResponse):
    items: list[RevisionResponse]

class CredentialResponse(EvidenceResponse):
    id: str
    name: str
    kind: str
    created: datetime

class CredentialPageResponse(EvidenceResponse):
    items: list[CredentialResponse]


class EventResponse(EvidenceResponse):
    id: int
    kind: str
    execution_id: str | None = None
    task_id: str | None = None
    node_id: str | None = None
    data: dict[str, Any]
    created: datetime


class EventPageResponse(EvidenceResponse):
    items: list[EventResponse]
    cursor: int


class TraceNodeResponse(EvidenceResponse):
    id: str
    name: str
    kind: str
    state: str
    span_id: str
    input: dict[str, Any]
    output: dict[str, Any]
    started_ms: float | None = None
    duration_ms: float | None = None
    runtime_id: str | None = None
    image_id: str | None = None
    invocation_id: str | None = None
    error: dict[str, Any] | None = None
    reason: str | None = None


class EvaluationResponse(EvidenceResponse):
    id: str
    execution_id: str
    state: str
    profile: ResourceResponse
    result: dict[str, Any]
    error: dict[str, Any] | None = None
    created: datetime
    ended: datetime | None = None
    operation_id: str | None = None


class ExecutionResponse(EvidenceResponse):
    id: str
    root_id: str
    item_id: str | None = None
    task_id: str | None = None
    batch_id: str
    attempt: int
    name: str
    state: str
    cleanup: str
    trace_id: str
    snapshot: dict[str, Any]
    actual_inputs: dict[str, Any]
    output: dict[str, Any]
    nodes: dict[str, TraceNodeResponse]
    winner: str | None = None
    error: dict[str, Any] | None = None
    created: datetime
    started: datetime | None = None
    ended: datetime | None = None
    duration_ms: float | None = None
    operation_id: str | None = None
    evaluations: list[EvaluationResponse] = Field(default_factory=list)
    events: list[EventResponse] = Field(default_factory=list)
    attempts: list['ExecutionResponse'] = Field(default_factory=list)


class ExecutionPageResponse(EvidenceResponse):
    items: list[ExecutionResponse]
    total: int
    page: int
    page_size: int


class RatesResponse(EvidenceResponse):
    expected: int
    valid: int
    passed: int
    pass_rate: float | None
    coverage: float | None


class ReportRowResponse(EvidenceResponse):
    item_id: str
    pair_id: str
    case: dict[str, Any]
    dataset: dict[str, Any]
    pipeline: dict[str, Any]
    sample_identity: str
    repetition: int
    plan_state: str
    execution_id: str | None
    execution_state: str
    active_execution_id: str | None
    evaluation_id: str | None
    verdict: str
    evaluation: dict[str, Any] | None
    duration_ms: float | None
    cleanup: str


class ReportResponse(EvidenceResponse):
    task_id: str
    task_name: str
    state: str
    plan_count: int
    rows: list[ReportRowResponse]
    requested_concurrency: int
    effective_concurrency: int
    restrictions: list[dict[str, Any]]
    reference: RatesResponse
    quality: RatesResponse
    run_completed: int
    evaluated: int
    passed: int


class SavedReportResponse(EvidenceResponse):
    id: str
    task_id: str
    created: datetime
    snapshot: ReportResponse


class ReportsResponse(EvidenceResponse):
    current: ReportResponse
    items: list[SavedReportResponse]


class TaskResponse(EvidenceResponse):
    id: str
    name: str
    state: str
    hidden: bool
    snapshot: dict[str, Any]
    requested_concurrency: int
    effective_concurrency: int
    created: datetime
    operation_id: str | None = None


class TaskDetailResponse(TaskResponse):
    report: ReportResponse


class TaskPageResponse(EvidenceResponse):
    items: list[TaskDetailResponse]
    total: int
    page: int
    page_size: int


class PlanPreviewResponse(EvidenceResponse):
    plan_count: int
    requested_concurrency: int
    effective_concurrency: int
    restrictions: list[dict[str, Any]]
    profile: ResourceResponse
    pairs: list[dict[str, Any]]
    items: list[dict[str, Any]]


class EvaluationStatisticsResponse(EvidenceResponse):
    total: int
    attempted: int
    pass_count: int = Field(alias="pass")
    fail: int
    error: int


class OverviewResponse(EvidenceResponse):
    counts: dict[str, int]
    runs: dict[str, int]
    evaluations: EvaluationStatisticsResponse
    reference: RatesResponse
    quality: RatesResponse
    tasks: list[TaskDetailResponse]

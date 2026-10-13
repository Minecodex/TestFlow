from fastapi import APIRouter, Depends, Header

from testflow.core.contracts import PipelineBody
from testflow.core.dependencies import session
from testflow.core.errors import fail
from testflow.core.responses import ResourceResponse
from testflow.features.auth import require_admin
from testflow.features.pipelines.transfer import export_workflow, preview_workflow
from testflow.features.pipelines.transfer_contracts import WorkflowDocument, WorkflowImport, WorkflowPreview
from testflow.infrastructure.operations import idempotent
from testflow.infrastructure.revisions import get_resource, save_resource

router = APIRouter(prefix="/pipelines", tags=["workflows"], dependencies=[Depends(require_admin)])


@router.post("/export", response_model=WorkflowDocument)
async def export_draft(body: PipelineBody, db=Depends(session, scope="function")):
    return await export_workflow(db, body)


@router.get("/{pipeline_id}/export", response_model=WorkflowDocument)
async def export_version(pipeline_id: str, version: int | None = None, db=Depends(session, scope="function")):
    resource = await get_resource(db, "pipelines", pipeline_id, version)
    return await export_workflow(db, PipelineBody.model_validate(resource["data"]))


@router.post("/import/preview", response_model=WorkflowPreview)
async def preview(body: WorkflowImport, db=Depends(session, scope="function")):
    return await preview_workflow(db, body)


@router.post("/import", response_model=ResourceResponse)
async def import_workflow(body: WorkflowImport, idempotency_key: str = Header(..., min_length=1, max_length=128), db=Depends(session, scope="function")):
    async def create():
        preview = await preview_workflow(db, body)
        if not preview.valid:
            fail("workflow_not_ready", "Resolve workflow dependencies and graph errors before importing", 422,
                 {"requirements": [r.model_dump() for r in preview.requirements if r.state != "resolved"], "errors": preview.errors})
        return await save_resource(db, "pipelines", preview.pipeline.model_dump(mode="json"))
    return await idempotent(db, "workflow.import", idempotency_key, body.model_dump(mode="json"), create)

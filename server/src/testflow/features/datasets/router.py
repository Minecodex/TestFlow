from fastapi import APIRouter, Depends, Header, Request

from testflow.core.contracts import DatasetBody
from testflow.core.dependencies import session
from testflow.core.errors import fail
from testflow.core.responses import ResourceResponse
from testflow.features.auth import require_admin
from testflow.features.datasets.transfer import export_dataset, preview_dataset
from testflow.features.datasets.transfer_contracts import DatasetDocument, DatasetImport, DatasetPreview
from testflow.infrastructure.operations import idempotent
from testflow.infrastructure.revisions import get_resource, save_resource

router = APIRouter(prefix="/datasets", tags=["dataset-transfer"], dependencies=[Depends(require_admin)])


@router.get("/{dataset_id}/export", response_model=DatasetDocument)
async def export_version(dataset_id: str, request: Request, version: int | None = None, db=Depends(session, scope="function")):
    resource = await get_resource(db, "datasets", dataset_id, version)
    if "output_schema" in resource["data"]:
        fail("outdated_dataset_contract", "Export the current input-only dataset revision", fields={"version": resource["version"]})
    return await export_dataset(db, request.app.state.settings.data_dir.resolve(), DatasetBody.model_validate(resource["data"]), follow_latest=version is None)


@router.post("/import/preview", response_model=DatasetPreview)
async def preview(body: DatasetImport, request: Request, db=Depends(session, scope="function")):
    return await preview_dataset(db, request.app.state.settings.data_dir.resolve(), body)


@router.post("/import", response_model=ResourceResponse)
async def import_dataset(body: DatasetImport, request: Request, idempotency_key: str = Header(..., min_length=1, max_length=128), db=Depends(session, scope="function")):
    async def create():
        result = await preview_dataset(db, request.app.state.settings.data_dir.resolve(), body)
        if not result.valid:
            fail("dataset_not_ready", "Import fixed asset revisions and resolve dataset errors before saving", 422,
                {"requirements": [r.model_dump(mode="json") for r in result.requirements if r.state != "resolved"], "errors": result.errors})
        return await save_resource(db, "datasets", result.dataset.model_dump(mode="json"))
    return await idempotent(db, "dataset.import", idempotency_key, body.model_dump(mode="json", exclude_unset=True), create)

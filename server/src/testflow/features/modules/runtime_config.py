"""Saved module launch defaults, independent of ZIP identity and node business parameters."""
from testflow.core.contracts import PodRuntime, StrictModel
from testflow.core.errors import fail
from testflow.features.auth import validate_credential
from testflow.infrastructure.revisions import get_resource
from pydantic import Field


class ModuleRuntimeUpdate(StrictModel):
    expected_version: int = Field(ge=1)
    runtime: PodRuntime


def effective_runtime(data):
    return data.get("runtime") or data["manifest"]["runtime"]


async def validate_runtime(db, data, runtime, *, require_visible=False):
    declared = data["manifest"]["runtime"]
    if declared["requires_sequential"] and not runtime["requires_sequential"]:
        fail("sequential_required", "The module requires sequential execution")
    if declared["reuse_scope"] == "execution_node" and runtime["reuse_scope"] != "execution_node":
        fail("isolated_instance_required", "The module requires a separate Pod per execution")
    await validate_credential(db, runtime.get("registry_credential_id"), "registry")
    mount = runtime.get("code_mount")
    if not mount:
        return None
    repository = await get_resource(db, "repositories", mount["repository_id"], mount["repository_version"])
    if (repository["data"].get("commit") != mount["commit"] or not repository["data"].get("code_path")
            or require_visible and repository["hidden"]):
        fail("code_unavailable", "A synced fixed repository commit is required")
    return repository

from testflow.core.errors import fail
from testflow.infrastructure.revisions import get_resource


async def validate_dataset(db, body):
    for case in body.cases:
        for field in body.input_schema.fields:
            binding = case.inputs[field.name]
            if binding.asset_id:
                asset = await get_resource(db, "assets", binding.asset_id)
                if asset["hidden"] or asset["data"]["type"] != field.type or asset["data"]["format"] != field.format:
                    fail("invalid_asset_binding", "Asset type and format must match the named field", fields={case.id: field.name})
            elif field.type not in {"Text", "JSON"}:
                fail("media_asset_required", "Media inputs require fixed assets")
            elif field.type == "Text" and not isinstance(binding.value, str):
                fail("invalid_input_literal", "Text inputs require a string literal", fields={case.id: field.name})

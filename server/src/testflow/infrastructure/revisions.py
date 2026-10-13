import hashlib
import json

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from testflow.core.errors import fail
from testflow.infrastructure.models import Event, Resource, Revision, now


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def serialize(row) -> dict:
    return {c.name: getattr(row, c.name).isoformat() if hasattr(getattr(row, c.name), "isoformat") else getattr(row, c.name)
            for c in row.__table__.columns if c.name not in {"encrypted", "token"}}


async def get_resource(db: AsyncSession, kind: str, resource_id: str, version: int | None = None, *, lock=False) -> dict:
    query = select(Resource).where(Resource.id == resource_id, Resource.kind == kind)
    if lock:
        query = query.with_for_update()
    resource = await db.scalar(query)
    if not resource:
        fail("not_found", "Resource not found", 404)
    revision = await db.scalar(select(Revision).where(Revision.resource_id == resource_id, Revision.number == (version or resource.version)))
    if not revision:
        fail("version_not_found", "Version not found", 404)
    return {**serialize(resource), "revision_id": revision.id, "selected_version": revision.number, "digest": revision.digest, "data": revision.data}


async def save_resource(db: AsyncSession, kind: str, data: dict, resource_id: str | None = None, expected_version: int | None = None) -> dict:
    if resource_id:
        row = await db.scalar(select(Resource).where(Resource.id == resource_id, Resource.kind == kind).with_for_update())
        if not row:
            fail("not_found", "Resource not found", 404)
        if row.version != expected_version:
            fail("version_conflict", "Resource changed; refresh before saving your draft", 409, {"version": row.version})
        row.version += 1
        row.updated = now()
        row.name = data["name"]
    else:
        row = Resource(kind=kind, name=data["name"])
        db.add(row)
        await db.flush()
    db.add(Revision(resource_id=row.id, number=row.version, data=data, digest=digest(data)))
    await resource_changed(db, kind, row.id, row.version, row.hidden)
    await db.flush()
    return await get_resource(db, kind, row.id)


async def resource_changed(db, kind, resource_id, version, hidden):
    # Commit the cursor alongside the revision. Broadcast only identity, never resource contents.
    db.add(Event(kind="resource.changed", data={"kind": kind, "resource_id": resource_id, "version": version, "hidden": hidden}))


async def list_resources(db: AsyncSession, kind: str, hidden: bool = False, search: str = "", page: int = 1, page_size: int = 30, *, asset_type=None):
    where = [Resource.kind == kind, Resource.hidden == hidden]
    if search:
        where.append(Resource.name.ilike("%" + search.replace("%", "\\%").replace("_", "\\_") + "%", escape="\\"))
    query = select(Resource.id)
    if kind == "assets" and asset_type:
        query = query.join(Revision, (Revision.resource_id == Resource.id) & (Revision.number == Resource.version))
        where.append(Revision.data["type"].as_string() == asset_type)
    query = query.where(*where)
    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    ids = (await db.scalars(query.order_by(Resource.updated.desc(), Resource.id).offset((page - 1) * page_size).limit(page_size))).all()
    return {"items": [await get_resource(db, kind, i) for i in ids], "total": total, "page": page, "page_size": page_size}

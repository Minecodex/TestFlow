"""Append input-only dataset revisions without altering recorded executions."""
from datetime import UTC, datetime
import hashlib
import json
from uuid import uuid4

from alembic import op
import sqlalchemy as sa

revision = 'a2d91c50b7e4'
down_revision = '42357d1ae6b2'
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    metadata = sa.MetaData()
    resources = sa.Table('resources', metadata, autoload_with=connection)
    revisions = sa.Table('revisions', metadata, autoload_with=connection)
    events = sa.Table('events', metadata, autoload_with=connection)
    rows = connection.execute(sa.select(resources.c.id, resources.c.version, resources.c.hidden, revisions.c.data)
        .join(revisions, (resources.c.id == revisions.c.resource_id) & (resources.c.version == revisions.c.number))
        .where(resources.c.kind == 'datasets')).mappings().all()
    for row in rows:
        data = row['data']
        clean = {key: value for key, value in data.items() if key in {'name', 'description', 'input_schema', 'cases'}}
        clean['cases'] = [{key: value for key, value in case.items() if key in {'id', 'name', 'inputs'}} for case in data.get('cases', [])]
        if clean == data:
            continue
        version, created = row['version'] + 1, datetime.now(UTC)
        checksum = hashlib.sha256(json.dumps(clean, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        connection.execute(revisions.insert().values(id=str(uuid4()), resource_id=row['id'], number=version,
            data=clean, digest=checksum, created=created))
        connection.execute(resources.update().where(resources.c.id == row['id']).values(version=version, updated=created))
        connection.execute(events.insert().values(kind='resource.changed', created=created,
            data={'kind': 'datasets', 'resource_id': row['id'], 'version': version, 'hidden': row['hidden']}))


def downgrade():
    # Append-only revisions remain available. A downgrade never rewrites recorded evidence.
    pass

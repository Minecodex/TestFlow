import hashlib
import io

from PIL import Image
from sqlalchemy import select

from testflow.infrastructure.models import Event, PlanItem, Resource


async def create(client, kind, body):
    response = await client.post('/api/v1/' + kind, json=body)
    assert response.status_code == 200, response.text
    return response.json()


async def revise(client, asset, **changes):
    response = await client.put('/api/v1/assets/' + asset['id'], json={
        'expected_version': asset['version'], 'data': {**asset['data'], **changes}})
    assert response.status_code == 200, response.text
    return response.json()


async def test_shared_text_updates_bytes_and_retains_historical_revisions(app_client):
    _, client = app_client
    original = await create(client, 'assets', {'name': 'Question', 'type': 'Text', 'text': 'Before'})
    updated = await revise(client, original, text='After 中文', tags=['shared'], reference='Confirmed', reference_confirmed=True)
    assert updated['data']['text'] == 'After 中文'
    assert updated['data']['sha256'] == hashlib.sha256('After 中文'.encode()).hexdigest()
    assert (await client.get('/api/v1/media/' + original['id'] + '?version=2')).content == 'After 中文'.encode()
    assert (await client.get('/api/v1/assets/' + original['id'] + '?version=1')).json()['data']['text'] == 'Before'
    assert (await client.get('/api/v1/media/' + original['id'])).headers['cache-control'] == 'private, no-cache'
    conflict = await client.put('/api/v1/assets/' + original['id'], json={'expected_version': 1, 'data': original['data']})
    assert conflict.status_code == 409


async def test_image_content_type_does_not_depend_on_editable_name(app_client):
    _, client = app_client
    content = io.BytesIO()
    Image.new('RGB', (32, 20), '#128055').save(content, 'PNG')
    response = await client.post('/api/v1/media/upload', files={'files': ('picture.png', content.getvalue(), 'image/png')})
    original = response.json()['items'][0]['resource']
    updated = await revise(client, original, name='Picture without extension', tags=['image'])
    media = await client.get('/api/v1/media/' + original['id'] + '?version=' + str(updated['version']))
    assert media.headers['content-type'] == 'image/png' and media.content == content.getvalue()
    old = await client.get('/api/v1/media/' + original['id'] + '?version=1')
    assert old.content == content.getvalue()


async def test_resource_changes_have_replayable_cursors_without_content(app_client):
    app, client = app_client
    original = await create(client, 'assets', {'name': 'Shared', 'type': 'Text', 'text': 'private content marker'})
    updated = await revise(client, original, text='updated private marker')
    await client.post('/api/v1/assets/' + original['id'] + '/hide')
    assert (await client.post('/api/v1/assets/' + original['id'] + '/restore')).status_code == 404
    async with app.state.database.sessions() as db, db.begin():
        (await db.get(Resource, original['id'])).hidden = False
    conflict = await client.put('/api/v1/assets/' + original['id'], json={'expected_version': 1, 'data': original['data']})
    assert conflict.status_code == 409
    async with app.state.database.sessions() as db:
        events = (await db.scalars(select(Event).where(Event.kind == 'resource.changed').order_by(Event.id))).all()
        assert len(events) == 3 and [event.data['hidden'] for event in events] == [False, False, True]
        assert [event.data['version'] for event in events] == [1, updated['version'], updated['version']]
        assert all(set(event.data) == {'kind', 'resource_id', 'version', 'hidden'} for event in events)
        assert all(event.execution_id is None and event.task_id is None for event in events)


async def test_dataset_uses_latest_shared_assets_but_queued_task_is_frozen(app_client):
    app, client = app_client
    asset = await create(client, 'assets', {'name': 'Shared', 'type': 'Text', 'text': 'v1', 'reference': 'r1', 'reference_confirmed': True})
    schema = {'fields': [{'name': 'query', 'type': 'Text', 'format': 'UTF-8'}]}
    pipeline = await create(client, 'pipelines', {'name': 'Echo', 'input_schema': schema, 'output_schema': schema,
        'nodes': [{'id': 'start', 'name': 'Start', 'kind': 'start', 'output_schema': schema},
                  {'id': 'end', 'name': 'End', 'kind': 'end', 'input_schema': schema, 'output_schema': schema}],
        'edges': [{'source': 'start', 'target': 'end'}]})
    profile = await create(client, 'evaluation-profiles', {'name': 'Completion', 'dimensions': [
        {'id': 'completed', 'name': 'Completed', 'method': 'completion', 'actual': {'source': 'execution', 'field': 'state'}}]})
    dataset = await create(client, 'datasets', {'name': 'Live inputs', 'input_schema': schema,
        'cases': [{'id': 'case', 'name': 'Shared case', 'inputs': {'query': {'asset_id': asset['id'], 'asset_version': 1}}}]})
    current = await revise(client, asset, text='v2', reference='r2', tags=['current'])
    body = {'name': 'Freeze', 'profile_id': profile['id'], 'profile_version': profile['version'], 'pairs': [
        {'dataset_id': dataset['id'], 'dataset_version': dataset['version'], 'pipeline_id': pipeline['id'], 'pipeline_version': pipeline['version']}]}
    preview = await client.post('/api/v1/tasks/preview', json=body)
    assert preview.status_code == 200, preview.text
    assert preview.json()['items'][0]['input_snapshot']['query']['value'] == 'v2'
    response = await client.post('/api/v1/tasks', json=body, headers={'Idempotency-Key': 'shared-assets'})
    assert response.status_code == 200, response.text
    task_id = response.json()['id']
    await revise(client, current, text='v3', reference='r3', reference_confirmed=False)
    async with app.state.database.sessions() as db:
        item = await db.scalar(select(PlanItem).where(PlanItem.task_id == task_id))
        assert item.snapshot['inputs']['query']['value'] == 'v2'
        assert item.snapshot['inputs']['query']['asset']['selected_version'] == 2
        assert item.snapshot['case']['inputs']['query']['asset_version'] == 2
        assert item.snapshot['reference'] == {} and not item.snapshot['reference_confirmed']
        assert not item.snapshot['reference_sources']
    report = (await client.get('/api/v1/tasks/' + task_id)).json()['report']
    assert report['rows'][0]['materials']['inputs']['query']['value'] == 'v2'
    future = (await client.post('/api/v1/tasks/preview', json=body)).json()
    assert future['items'][0]['input_snapshot']['query']['value'] == 'v3'
    assert not future['items'][0]['reference_confirmed']
    document = (await client.get('/api/v1/datasets/' + dataset['id'] + '/export')).json()
    assert 'output_schema' not in document['dataset'] and 'reference_assets' not in document['dataset']['cases'][0]
    imported = await client.post('/api/v1/datasets/import/preview', json={'document': document})
    assert imported.status_code == 200 and imported.json()['valid']
    assert imported.json()['dataset']['cases'][0]['inputs']['query']['asset_id'] == asset['id']

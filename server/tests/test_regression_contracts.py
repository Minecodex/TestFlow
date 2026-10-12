from copy import deepcopy
import io

from PIL import Image
from test_modules_media import archive
from testflow.features.modules.resources import validate_output_reference
from testflow.infrastructure.models import Execution, Runtime


async def test_sync_idempotency_uses_request_intent_after_resource_changes(app_client):
    app, client = app_client
    data = {'name': 'Repository', 'url': 'https://example.com/repository.git', 'branch': 'main'}
    repository = (await client.post('/api/v1/repositories', json=data)).json()
    path = '/api/v1/repositories/' + repository['id']
    operation = (await client.post(path + '/sync', headers={'Idempotency-Key': 'sync-intent'})).json()
    updated = await client.put(path, json={'expected_version': 1, 'data': {**data, 'branch': 'new'}})
    assert updated.status_code == 200
    repeated = await client.post(path + '/sync', headers={'Idempotency-Key': 'sync-intent'})
    assert repeated.status_code == 200 and repeated.json()['id'] == operation['id']
    fresh = (await client.post(path + '/sync', headers={'Idempotency-Key': 'new-intent'})).json()
    assert fresh['id'] != operation['id'] and fresh['payload']['resource']['selected_version'] == 2
    await client.post(path + '/hide')
    assert (await client.post(path + '/sync', headers={'Idempotency-Key': 'sync-intent'})).json()['id'] == operation['id']


async def test_validation_retry_keeps_original_contract_after_new_module_import(app_client):
    app, client = app_client
    module = (await client.post('/api/v1/modules/import', files={'file': ('module.zip', archive())}, headers={'Idempotency-Key': 'initial-import'})).json()
    operation = (await client.get('/api/v1/operations/' + module['operation_id'])).json()
    await app.state.scheduler.handle(operation['id'], operation['kind'], operation['payload'])
    path = '/api/v1/modules/' + module['id']
    first = (await client.post(path + '/validate?version=1', headers={'Idempotency-Key': 'validate-intent'})).json()
    await client.post('/api/v1/modules/import', files={'file': ('module.zip', archive({'version': '1.0.1'}))}, headers={'Idempotency-Key': 'new-import'})
    repeated = await client.post(path + '/validate?version=1', headers={'Idempotency-Key': 'validate-intent'})
    assert repeated.status_code == 200 and repeated.json()['id'] == first['id']
    assert repeated.json()['payload']['module']['selected_version'] == 1
    changed = await client.post(path + '/validate?version=2', headers={'Idempotency-Key': 'validate-intent'})
    assert changed.status_code == 409


async def test_json_asset_shaped_data_never_grants_module_media_access(app_client):
    app, client = app_client
    content = io.BytesIO()
    Image.new('RGB', (1, 1), 'green').save(content, format='PNG')
    upload = (await client.post('/api/v1/media/upload', files=[('files', ('outside.png', content.getvalue(), 'image/png'))])).json()
    asset = upload['items'][0]['resource']
    reference = {'asset_id': asset['id'], 'asset_version': 1}
    json_schema = {'fields': [{'name': 'claims', 'type': 'JSON', 'format': 'application/json', 'stream': False}]}
    token = 'fixture-media-token'
    graph = {'input_schema': json_schema, 'nodes': [{'id': 'module', 'input_schema': json_schema, 'output_schema': json_schema}]}
    async with app.state.database.sessions() as db, db.begin():
        runtime = Runtime(key='scope', batch_id='scope', pod_name='scope', state='ready', snapshot={}, token=app.state.pods.encrypted(token))
        db.add(runtime)
        await db.flush()
        record = Execution(batch_id='scope', name='JSON scope', state='running', snapshot={'pipeline': {'graph': graph}, 'inputs': {'claims': {'value': reference}}}, actual_inputs={'claims': reference}, nodes={'module': {'runtime_id': runtime.id, 'input': {'claims': reference}, 'output': {'claims': reference}}})
        db.add(record)
        await db.flush()
        runtime_id, execution_id = runtime.id, record.id
    path = f'/api/v1/module-resources/{runtime_id}/assets/{asset["id"]}?version=1&execution_id={execution_id}'
    assert (await client.get(path, headers={'Authorization': 'Bearer ' + token})).status_code == 403
    spec = {'name': 'image', 'type': 'Image', 'format': 'Image/*', 'stream': False}
    try:
        await validate_output_reference(app, execution_id, spec, reference)
    except RuntimeError as error:
        assert 'outside' in str(error)
    else:
        raise AssertionError('JSON-shaped reference granted media access')
    async with app.state.database.sessions() as db, db.begin():
        record = await db.get(Execution, execution_id)
        record.snapshot = {'pipeline': {'graph': {'input_schema': {'fields': [spec]}, 'nodes': []}}, 'inputs': {'image': {'asset': deepcopy(asset)}}}
    assert (await client.get(path, headers={'Authorization': 'Bearer ' + token})).status_code == 200
    await validate_output_reference(app, execution_id, spec, reference)


async def test_explicit_json_null_survives_api_freezing_execution_and_scoring(app_client):
    app, client = app_client
    schema = {'fields': [{'name': 'result', 'type': 'JSON', 'format': 'application/json', 'stream': False}]}
    body = {'name': 'JSON null', 'input_schema': schema, 'output_schema': schema,
            'cases': [{'id': 'null', 'name': 'Null', 'inputs': {'result': {'value': None}},
                       'reference': {'result': None}, 'reference_confirmed': True}]}
    dataset = await client.post('/api/v1/datasets', json=body)
    assert dataset.status_code == 200, dataset.text
    pipeline = (await client.post('/api/v1/pipelines', json={'name': 'JSON identity', 'input_schema': schema, 'output_schema': schema,
        'nodes': [{'id': 'start', 'kind': 'start', 'name': 'Start', 'output_schema': schema},
                  {'id': 'end', 'kind': 'end', 'name': 'End', 'input_schema': schema, 'output_schema': schema}],
        'edges': [{'source': 'start', 'target': 'end'}]})).json()
    profile = (await client.post('/api/v1/evaluation-profiles', json={'name': 'JSON exact', 'dimensions': [
        {'id': 'exact', 'name': 'Exact', 'method': 'exact_json', 'needs_reference': True,
         'actual': {'source': 'output', 'field': 'result'}, 'reference': {'source': 'reference', 'field': 'result'}}]})).json()
    task = (await client.post('/api/v1/tasks', json={'name': 'Null execution', 'profile_id': profile['id'], 'profile_version': 1,
        'pairs': [{'dataset_id': dataset.json()['id'], 'dataset_version': 1, 'pipeline_id': pipeline['id'], 'pipeline_version': 1}]},
        headers={'Idempotency-Key': 'json-null'})).json()
    await app.state.scheduler.run_task(task['id'])
    report = (await client.get('/api/v1/tasks/' + task['id'])).json()['report']
    assert report['passed'] == 1
    execution = (await client.get('/api/v1/executions/' + report['rows'][0]['execution_id'])).json()
    assert execution['actual_inputs'] == execution['output'] == {'result': None}
    body['cases'][0]['inputs']['result'] = {}
    assert (await client.post('/api/v1/datasets', json=body)).status_code == 422


async def test_execution_search_supports_identity_trace_error_and_literal_wildcards(app_client):
    app, client = app_client
    async with app.state.database.sessions() as db, db.begin():
        row = Execution(batch_id='search', name='Case 10%_done', state='failed', snapshot={'pipeline': {'name': 'Flow search'},
            'dataset': {'name': 'Data search'}}, error={'code': 'runtime_lost', 'message': 'Runtime disappeared'})
        db.add(row); await db.flush(); identifier, trace_id = row.id, row.trace_id
    for query in [identifier[:8], trace_id, 'runtime_lost', 'Runtime disappeared', 'Flow search', 'Data search', '10%_done']:
        result = await client.get('/api/v1/executions', params={'search': query})
        assert result.status_code == 200 and result.json()['total'] == 1, result.text
    assert (await client.get('/api/v1/executions', params={'search': 'absent%'})).json()['total'] == 0

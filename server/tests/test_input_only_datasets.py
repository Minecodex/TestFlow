"""Input-only plans, model credentials and preservation across the contract change."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path

from cryptography.fernet import Fernet
import httpx
from sqlalchemy import select

from testflow.infrastructure.models import Credential, Execution, Resource, Revision
from testflow.infrastructure.revisions import save_resource
from test_business import TEXT, dataset


async def test_inputs_only_and_model_judgment_with_independent_flow_outputs(app_client, monkeypatch):
    app, client = app_client
    inputs = dataset()
    inputs['cases'] = [{'id': name, 'name': name, 'inputs': {'text': {'value': name}}} for name in ['valid', 'wrong']]
    response = await client.post('/api/v1/datasets', json=inputs)
    assert response.status_code == 200, response.text
    resource = response.json()
    assert 'output_schema' not in resource['data']
    for forbidden in ['output_schema', 'reference', 'reference_assets']:
        invalid = deepcopy(inputs)
        target = invalid if forbidden == 'output_schema' else invalid['cases'][0]
        target[forbidden] = TEXT if forbidden == 'output_schema' else {'answer': 'expected'}
        assert (await client.post('/api/v1/datasets', json=invalid)).status_code == 422
    outputs = {'fields': [{**TEXT['fields'][0], 'name': name} for name in ['answer', 'extra']]}
    graph = {'name': 'Independent outputs', 'input_schema': TEXT, 'output_schema': outputs, 'nodes': [
        {'id': 'start', 'kind': 'start', 'name': 'Start', 'output_schema': TEXT},
        {'id': 'group', 'kind': 'assembly', 'name': 'Group', 'output_schema': outputs,
         'mappings': [{'target': name, 'source': 'start', 'field': 'text'} for name in ['answer', 'extra']]},
        {'id': 'end', 'kind': 'end', 'name': 'End', 'input_schema': outputs, 'output_schema': outputs}],
        'edges': [{'source': 'start', 'target': 'group'}, {'source': 'group', 'target': 'end'}]}
    pipeline = (await client.post('/api/v1/pipelines', json=graph)).json()
    secret = 'fixture-secret-do-not-export'
    profile = await client.post('/api/v1/evaluation-profiles', json={'name': 'Model judgment',
        'endpoint': 'https://model.test/v1', 'model': 'fixture-only', 'api_key': secret, 'dimensions': [
        {'id': 'correct', 'name': 'Correctness', 'method': 'ai', 'actual': {'source': 'output', 'field': ''},
         'evidence': [{'source': 'input', 'field': ''}]}]})
    assert profile.status_code == 200 and secret not in profile.text, profile.text
    assert 'api_key' not in profile.json()['data']
    captured = []
    class Provider:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, url, **kwargs):
            assert kwargs['headers']['Authorization'] == 'Bearer ' + secret
            material = json.loads(kwargs['json']['messages'][1]['content'][0]['text'])['material']
            captured.append(material)
            score = 1 if material['actual']['answer'] == 'valid' else 0
            return httpx.Response(200, request=httpx.Request('POST', url), json={'choices': [
                {'finish_reason': 'stop', 'message': {'content': json.dumps({'score': score, 'reason': 'Fixture only', 'evidence': ['actual', 'evidence:0']})}}]})
    monkeypatch.setattr('testflow.features.evaluation.service.httpx.AsyncClient', lambda **kwargs: Provider())
    task = await client.post('/api/v1/tasks', json={'name': 'Model decisions', 'profile_id': profile.json()['id'], 'profile_version': 1,
        'pairs': [{'dataset_id': resource['id'], 'dataset_version': 1, 'pipeline_id': pipeline['id'], 'pipeline_version': 1}]},
        headers={'Idempotency-Key': 'input-only-model'})
    assert task.status_code == 200, task.text
    await app.state.scheduler.run_task(task.json()['id'])
    report = (await client.get('/api/v1/tasks/' + task.json()['id'])).json()['report']
    assert report['plan_count'] == 2 and report['passed'] == 1
    assert [row['verdict'] for row in report['rows']] == ['pass', 'fail']
    assert all(item['reference'] is None and len(item['evidence']) == 1 for item in captured)
    assert secret not in json.dumps(report)


async def test_inline_keys_are_encrypted_versioned_and_rolled_back_on_conflict(app_client):
    app, client = app_client
    body = {'name': 'Inline key', 'api_key': 'first-private-test-key', 'dimensions': []}
    original = (await client.post('/api/v1/evaluation-profiles', json=body)).json()
    first_id = original['data']['credential_id']
    updated = await client.put('/api/v1/evaluation-profiles/' + original['id'], json={'expected_version': 1,
        'data': {'name': body['name'], 'credential_id': first_id, 'api_key': 'second-private-test-key', 'dimensions': []}})
    assert updated.status_code == 200 and updated.json()['data']['credential_id'] != first_id
    conflict = await client.put('/api/v1/evaluation-profiles/' + original['id'], json={'expected_version': 1,
        'data': {'name': body['name'], 'api_key': 'rejected-private-test-key', 'dimensions': []}})
    assert conflict.status_code == 409
    async with app.state.database.sessions() as db:
        credentials = (await db.scalars(select(Credential))).all()
        assert len(credentials) == 2
        decrypted = [Fernet(app.state.settings.encryption_key.get_secret_value().encode()).decrypt(row.encrypted.encode()).decode() for row in credentials]
        assert decrypted == ['first-private-test-key', 'second-private-test-key']
        revisions = (await db.scalars(select(Revision))).all()
        assert all('api_key' not in row.data and 'private-test-key' not in json.dumps(row.data) for row in revisions)
    cleared = await client.put('/api/v1/evaluation-profiles/' + original['id'], json={'expected_version': 2,
        'data': {'name': body['name'], 'credential_id': None, 'dimensions': []}})
    assert cleared.status_code == 200 and cleared.json()['data']['credential_id'] is None


async def test_contract_migration_appends_versions_and_leaves_execution_evidence(app_client, monkeypatch):
    app, client = app_client
    legacy = {**dataset(), 'output_schema': TEXT}
    legacy['cases'][0].update(reference={'text': 'old expected'}, reference_confirmed=True)
    async with app.state.database.sessions() as db, db.begin():
        original = await save_resource(db, 'datasets', legacy)
        ex = Execution(batch_id='old', name='Recorded', state='succeeded', output={'text': 'recorded'}, snapshot={'dataset': original, 'reference': {'text': 'old expected'}})
        db.add(ex); await db.flush(); execution_id = ex.id
    spec = importlib.util.spec_from_file_location('input_only_migration', Path(__file__).parents[1] / 'migrations/versions/a2d91c50b7e4_input_only_datasets.py')
    migration = importlib.util.module_from_spec(spec); spec.loader.exec_module(migration)
    def migrate(connection):
        monkeypatch.setattr(migration.op, 'get_bind', lambda: connection)
        migration.upgrade()
    async with app.state.database.engine.begin() as connection:
        await connection.run_sync(migrate)
    async with app.state.database.sessions() as db:
        resource = await db.get(Resource, original['id'])
        revisions = (await db.scalars(select(Revision).where(Revision.resource_id == resource.id).order_by(Revision.number))).all()
        assert resource.version == 2 and revisions[0].data == legacy
        assert 'output_schema' not in revisions[1].data and set(revisions[1].data['cases'][0]) == {'id', 'name', 'inputs'}
        ex = await db.get(Execution, execution_id)
        assert ex.output == {'text': 'recorded'} and ex.snapshot['reference'] == {'text': 'old expected'}
    outdated = await client.get('/api/v1/datasets/' + original['id'] + '/export?version=1')
    assert outdated.status_code == 422 and outdated.json()['code'] == 'outdated_dataset_contract'
    current = await client.get('/api/v1/datasets/' + original['id'] + '/export')
    assert current.status_code == 200 and 'output_schema' not in current.json()['dataset']

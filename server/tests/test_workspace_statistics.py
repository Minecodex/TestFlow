from copy import deepcopy
from datetime import timedelta

from test_business import dataset, graph
from testflow.infrastructure.models import Evaluation, Execution
from testflow.infrastructure.revisions import now


async def test_workspace_uses_fixed_profile_latest_ended_attempt_and_error(app_client):
    app, client = app_client
    data = dataset()
    data['cases'].append({**deepcopy(data['cases'][0]), 'id': 'two', 'name': 'Two',
                          'inputs': {'text': {'value': 'second'}}, 'reference': {'text': 'second'}})
    d = (await client.post('/api/v1/datasets', json=data)).json()
    p = (await client.post('/api/v1/pipelines', json=graph())).json()
    profile_body = {'name': 'Fixed exact', 'dimensions': [{'id': 'exact', 'name': 'Exact',
        'method': 'exact_text', 'needs_reference': True, 'actual': {'source': 'output', 'field': 'text'},
        'reference': {'source': 'reference', 'field': 'text'}}]}
    profile = (await client.post('/api/v1/evaluation-profiles', json=profile_body)).json()
    body = {'name': 'Statistics', 'pairs': [{'dataset_id': d['id'], 'dataset_version': 1,
        'pipeline_id': p['id'], 'pipeline_version': 1}], 'profile_id': profile['id'], 'profile_version': 1}
    task = (await client.post('/api/v1/tasks', json=body, headers={'Idempotency-Key': 'statistics'})).json()
    scope = f'/api/v1/system/overview?profile_id={profile["id"]}&profile_version=1'
    queued = (await client.get(scope)).json()
    assert queued['reference'] == {'expected': 2, 'valid': 0, 'passed': 0, 'pass_rate': None, 'coverage': 0}
    assert queued['quality']['pass_rate'] is None
    await app.state.scheduler.run_task(task['id'])
    finished = (await client.get(scope)).json()
    assert finished['reference']['valid'] == finished['reference']['expected'] == 2
    ex_id = finished['tasks'][0]['report']['rows'][0]['execution_id']
    rerun = (await client.post(f'/api/v1/executions/{ex_id}/rerun', headers={'Idempotency-Key': 'statistics-rerun'})).json()
    active = (await client.get(scope)).json()
    assert active['reference'] == finished['reference']
    await app.state.scheduler.run_execution(rerun['id'])
    repeated = (await client.get(scope)).json()
    assert repeated['reference'] == finished['reference'] and repeated['counts']['executions'] == 3
    async with app.state.database.sessions() as db, db.begin():
        execution = await db.get(Execution, rerun['id'])
        mismatch = deepcopy(execution.snapshot['profile'])
        mismatch['binding_digest'] = 'different-binding'
        db.add(Evaluation(execution_id=execution.id, profile=mismatch, state='error', result={}, created=now() + timedelta(seconds=1)))
    assert (await client.get(scope)).json()['reference']['valid'] == 2
    async with app.state.database.sessions() as db, db.begin():
        execution = await db.get(Execution, rerun['id'])
        db.add(Evaluation(execution_id=execution.id, profile=execution.snapshot['profile'], state='error', result={}, created=now() + timedelta(seconds=2)))
    error = (await client.get(scope)).json()
    assert error['reference']['expected'] == 2 and error['reference']['valid'] == 1
    assert error['reference']['coverage'] == .5 and error['evaluations']['error'] == 1
    # A new profile version has a distinct score scope and never inherits an old pass.
    await client.put(f'/api/v1/evaluation-profiles/{profile["id"]}', json={'expected_version': 1, 'data': profile_body})
    new_scope = scope.replace('profile_version=1', 'profile_version=2')
    assert (await client.get(new_scope)).json()['reference']['pass_rate'] is None
    assert (await client.get('/api/v1/system/overview')).json()['reference'] == error['reference']

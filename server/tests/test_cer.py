from test_business import dataset, graph
from testflow.core.contracts import Dimension

async def test_cer_uses_error_rate_upper_limit_and_retains_empty_reference(app_client):
    app, client = app_client
    data = dataset()
    data['cases'][0].update(inputs={'text': {'value': 'axc'}}, reference={'text': 'abc'})
    data['cases'].append({'id': 'empty', 'name': 'Empty reference', 'inputs': {'text': {'value': ''}},
                          'reference': {'text': ''}, 'reference_confirmed': True})
    dataset_resource = (await client.post('/api/v1/datasets', json=data)).json()
    pipeline = (await client.post('/api/v1/pipelines', json=graph())).json()
    dimension = {'id': 'cer', 'name': 'CER', 'method': 'cer', 'needs_reference': True,
                 'actual': {'source': 'output', 'field': 'text'}, 'reference': {'source': 'reference', 'field': 'text'}}
    assert Dimension.model_validate(dimension).threshold == .1
    profile = (await client.post('/api/v1/evaluation-profiles', json={'name': 'CER maximum', 'dimensions': [dimension]})).json()
    task = (await client.post('/api/v1/tasks', json={'name': 'CER tests', 'profile_id': profile['id'], 'profile_version': 1,
        'pairs': [{'dataset_id': dataset_resource['id'], 'dataset_version': 1, 'pipeline_id': pipeline['id'], 'pipeline_version': 1}]},
        headers={'Idempotency-Key': 'cer-maximum'})).json()
    await app.state.scheduler.run_task(task['id'])
    rows = (await client.get('/api/v1/tasks/' + task['id'])).json()['report']['rows']
    scored = rows[0]['evaluation']['dimensions'][0]
    assert scored['state'] == 'fail' and abs(scored['score'] - 1 / 3) < 1e-10 and scored['threshold'] == .1
    assert rows[1]['evaluation']['dimensions'][0]['state'] == 'undetermined'
    assert rows[1]['verdict'] == 'incomplete'

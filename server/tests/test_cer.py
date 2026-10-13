from test_business import dataset, graph
from testflow.core.contracts import Dimension

async def test_cer_uses_error_rate_upper_limit_and_retains_empty_reference(app_client):
    app, client = app_client
    pipeline = (await client.post('/api/v1/pipelines', json=graph())).json()
    dimension = {'id': 'cer', 'name': 'CER', 'method': 'cer', 'needs_reference': True,
                 'actual': {'source': 'output', 'field': 'text'}, 'reference': {'source': 'reference', 'field': 'text'}}
    assert Dimension.model_validate(dimension).threshold == .1
    profile = (await client.post('/api/v1/evaluation-profiles', json={'name': 'CER maximum', 'dimensions': [dimension]})).json()
    rows = []
    for index, (actual, reference) in enumerate([('axc', 'abc'), ('', '')]):
        response = await client.post('/api/v1/executions/quick', json={'pipeline_id': pipeline['id'], 'pipeline_version': 1,
            'profile_id': profile['id'], 'profile_version': 1, 'inputs': {'text': {'value': actual}},
            'reference': {'text': reference}, 'reference_confirmed': True}, headers={'Idempotency-Key': 'cer-' + str(index)})
        assert response.status_code == 200, response.text
        await app.state.scheduler.run_execution(response.json()['id'])
        rows.append((await client.get('/api/v1/executions/' + response.json()['id'])).json()['evaluations'][0]['result'])
    scored = rows[0]['dimensions'][0]
    assert scored['state'] == 'fail' and abs(scored['score'] - 1 / 3) < 1e-10 and scored['threshold'] == .1
    assert rows[1]['dimensions'][0]['state'] == 'undetermined'
    assert rows[1]['verdict'] == 'incomplete'

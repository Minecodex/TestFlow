"""JSON mode must describe the same schema and enforce the same evidence as strict mode."""
import json
from types import SimpleNamespace

import httpx
import pytest
from testflow.features.evaluation import service
from testflow.infrastructure.models import Execution


@pytest.mark.asyncio
@pytest.mark.parametrize('mode', ['json_object', 'json_schema'])
@pytest.mark.parametrize('temperature', [None, .5])
async def test_scoring_modes_describe_and_enforce_evidence(monkeypatch, mode, temperature):
    async def credential(*args): return 'TEST ONLY fixture credential'
    monkeypatch.setattr(service, 'credential_value', credential)
    answer = {'score': 1, 'reason': 'Matches the actual material', 'evidence': ['actual', 'evidence:0']}
    def respond(request):
        body = json.loads(request.content)
        assert body['response_format']['type'] == mode
        assert ('temperature' in body) == (temperature is not None)
        if temperature is not None: assert body['temperature'] == temperature
        system = body['messages'][0]['content']
        assert json.dumps(service.SCORE_SCHEMA) in system
        assert 'nonempty array of string IDs' in system
        material = json.loads(body['messages'][1]['content'][0]['text'])
        assert material['allowed_evidence_ids'] == ['actual', 'evidence:0']
        return httpx.Response(200, json={'model': 'test-model', 'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(answer)}}]})
    client = httpx.AsyncClient
    monkeypatch.setattr(service.httpx, 'AsyncClient', lambda **kw: client(transport=httpx.MockTransport(respond), **kw))
    app = SimpleNamespace(state=SimpleNamespace(settings=None))
    profile = {'data': {'credential_id': 'test', 'response_format': mode, 'model': 'test-model', 'endpoint': 'https://example.invalid/v1', 'prompt': 'Check equality', 'modalities': ['Text'], 'temperature': temperature}}
    dimension = {'name': 'Equality', 'prompt': 'Check actual', 'needs_reference': False, 'actual': {'source': 'output', 'field': 'text'}, 'evidence': [{'source': 'input', 'field': 'text'}]}
    execution = Execution(snapshot={}, actual_inputs={}, output={'text': 'result'})
    material = {'actual': 'result', 'reference': None, 'evidence': ['input']}
    result = await service.ai_score(app, None, profile, dimension, material, execution)
    assert result['score'] == 1 and result['provider']['response_format'] == mode
    answer['evidence'] = ['invented:1']
    with pytest.raises(service.EvaluationError) as caught:
        await service.ai_score(app, None, profile, dimension, material, execution)
    assert caught.value.code == 'parse_error'
    answer['evidence'] = ['actual', 'evidence:0']
    answer['score'] = float('nan')
    with pytest.raises(service.EvaluationError) as caught:
        await service.ai_score(app, None, profile, dimension, material, execution)
    assert caught.value.code == 'parse_error'

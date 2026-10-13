"""Small, real v1 module host. No platform shortcuts or fabricated model responses."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
from fastapi import FastAPI, HTTPException, WebSocket
import uvicorn
from processors import execute

manifest = json.loads(Path('/app/manifest.json').read_text())
contract = {key: manifest[key] for key in ['protocol', 'id', 'version']}
contract.update({key: json.loads(Path('/app/schemas/' + key + '.json').read_text()) for key in ['inputs', 'outputs', 'parameters']})
app = FastAPI()
invocations = {}

@app.get('/module/v1/health')
def health():
    return {'ready': True}

@app.get('/module/v1/contract')
def get_contract():
    return contract

@app.post('/module/v1/executions')
async def create(body: dict):
    identifier = body['invocation_id']
    identity = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
    if identifier in invocations and invocations[identifier]['identity'] != identity:
        raise HTTPException(409, 'Invocation already has different inputs')
    invocations.setdefault(identifier, {'body': body, 'identity': identity, 'state': 'created', 'task': None,
                                       'attached': False, 'queue': asyncio.Queue()})
    return {'invocation_id': identifier}

@app.get('/module/v1/executions/{identifier}')
def status(identifier: str):
    if identifier not in invocations:
        raise HTTPException(404)
    return {'invocation_id': identifier, 'state': invocations[identifier]['state']}

@app.post('/module/v1/executions/{identifier}/cancel')
async def cancel(identifier: str):
    if identifier not in invocations:
        raise HTTPException(404)
    invocation = invocations[identifier]
    if invocation['state'] not in {'completed', 'failed', 'canceled'}:
        if invocation['task']:
            invocation['task'].cancel()
            await asyncio.gather(invocation['task'], return_exceptions=True)
        invocation['state'] = 'canceled'
        await invocation['queue'].put({'type': 'execution.canceled', 'invocation_id': identifier, 'remote_stop_confirmed': True})
    return {'accepted': True, 'state': invocation['state']}

async def process(identifier):
    invocation = invocations[identifier]
    async def send(kind, **payload):
        await invocation['queue'].put({'type': kind, 'invocation_id': identifier, **payload})
    try:
        invocation['state'] = 'running'
        await execute(manifest['id'], invocation['body'], send)
        invocation['state'] = 'completed'
        await send('execution.completed')
    except asyncio.CancelledError:
        raise
    except Exception as error:
        invocation['state'] = 'failed'
        await send('execution.error', code='scenario_error', message=type(error).__name__)

@app.websocket('/module/v1/executions/{identifier}/stream')
async def stream(socket: WebSocket, identifier: str):
    if identifier not in invocations or invocations[identifier]['attached']:
        await socket.close(1008)
        return
    await socket.accept()
    invocation = invocations[identifier]
    invocation['attached'] = True
    if invocation['state'] != 'canceled':
        invocation['task'] = asyncio.create_task(process(identifier))
    try:
        while True:
            event = await invocation['queue'].get()
            await socket.send_json(event)
            if event['type'] in {'execution.completed', 'execution.error', 'execution.canceled'}:
                break
    finally:
        if invocation['task'] and not invocation['task'].done():
            invocation['task'].cancel()
            await asyncio.gather(invocation['task'], return_exceptions=True)
        await socket.close()

if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=int(os.environ.get('TESTFLOW_MODULE_PORT', '8080')))

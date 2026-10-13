"""Real WAV gain processing, standard v1 invocation and cancellation service."""
import asyncio
import io
import json
import math
import os
import struct
import wave
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.responses import JSONResponse
import uvicorn

manifest=json.loads(Path('/app/manifest.json').read_text())
contract={'protocol':manifest['protocol'],'id':manifest['id'],'version':manifest['version'],'inputs':json.loads(Path('/app/schemas/inputs.json').read_text()),'outputs':json.loads(Path('/app/schemas/outputs.json').read_text()),'parameters':json.loads(Path('/app/schemas/parameters.json').read_text())}
app=FastAPI(); invocations={}

@app.get('/module/v1/health')
def health():return {'ready':True}
@app.get('/module/v1/contract')
def get_contract():return contract
@app.post('/module/v1/executions')
def create(body:dict):
    identifier=body['invocation_id']
    if identifier in invocations:return {'invocation_id':identifier}
    invocations[identifier]={'body':body,'state':'created','task':None,'queue':asyncio.Queue()}
    return {'invocation_id':identifier}
@app.get('/module/v1/executions/{identifier}')
def status(identifier:str):
    if identifier not in invocations:raise HTTPException(404)
    return {'invocation_id':identifier,'state':invocations[identifier]['state']}
@app.post('/module/v1/executions/{identifier}/cancel')
async def cancel(identifier:str):
    invocation=invocations[identifier]
    if invocation['task'] and not invocation['task'].done():invocation['task'].cancel()
    if invocation['state'] not in {'completed','failed'}:
        invocation['state']='canceled';await invocation['queue'].put({'type':'execution.canceled','invocation_id':identifier,'remote_stop_confirmed':True})
    return {'accepted':True,'state':invocation['state']}

async def process(identifier):
    invocation=invocations[identifier];body=invocation['body'];context=body['context'];queue=invocation['queue']
    async def send(kind,**payload):await queue.put({'type':kind,'invocation_id':identifier,**payload})
    try:
        invocation['state']='running'
        ref=body['inputs']['audio']['value'];root=os.environ['TESTFLOW_PLATFORM_URL'];runtime=os.environ['TESTFLOW_RUNTIME_ID'];headers={'Authorization':'Bearer '+os.environ['TESTFLOW_RUNTIME_TOKEN']}
        params={'execution_id':context['execution_id'],'version':ref['asset_version']}
        async with httpx.AsyncClient(timeout=20) as client:
            response=await client.get(f'{root}/api/v1/module-resources/{runtime}/assets/{ref["asset_id"]}',params=params,headers=headers);response.raise_for_status()
            source=io.BytesIO(response.content)
            with wave.open(source) as audio:
                if audio.getsampwidth()!=2 or audio.getnchannels()!=1:raise ValueError('Expected mono PCM16')
                rate=audio.getframerate();frames=audio.readframes(audio.getnframes())
            samples=struct.unpack('<'+'h'*(len(frames)//2),frames);gain=body['parameters'].get('gain',1)
            changed=[max(-32768,min(32767,round(v*gain))) for v in samples]
            target=io.BytesIO()
            with wave.open(target,'wb') as audio:
                audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(rate);audio.writeframes(struct.pack('<'+'h'*len(changed),*changed))
            result=await client.post(f'{root}/api/v1/module-resources/{runtime}/assets',params={'execution_id':context['execution_id'],'type':'Audio','format':'WAV · 16kHz · Mono'},headers=headers,files={'file':('processed.wav',target.getvalue(),'audio/wav')});result.raise_for_status()
        await send('trace',trace_id=context['trace_id'],parent_span_id=context['span_id'],span_id=identifier+'-gain',name='pcm_gain',frames=len(changed),gain=gain)
        await send('output.value',field='audio',value=result.json())
        await send('output.value',field='summary',value=f'{len(changed)} samples at {rate} Hz; gain={gain:g}; peak={max(map(abs,changed),default=0)}')
        await send('output.value',field='stats',value={'frames':len(changed),'sample_rate':rate,'peak':max(map(abs,changed),default=0),'rms':math.sqrt(sum(v*v for v in changed)/max(1,len(changed)))})
        invocation['state']='completed';await send('execution.completed')
    except asyncio.CancelledError:raise
    except Exception as error:
        invocation['state']='failed';await send('execution.error',code='audio_error',message=type(error).__name__)

@app.websocket('/module/v1/executions/{identifier}/stream')
async def stream(socket:WebSocket,identifier:str):
    await socket.accept();invocation=invocations[identifier]
    if not invocation['task']:invocation['task']=asyncio.create_task(process(identifier))
    try:
        while True:
            event=await invocation['queue'].get();await socket.send_json(event)
            if event['type'] in {'execution.completed','execution.error','execution.canceled'}:break
    finally:await socket.close()

if __name__=='__main__':uvicorn.run(app,host='0.0.0.0',port=int(os.environ.get('TESTFLOW_MODULE_PORT','8080')))

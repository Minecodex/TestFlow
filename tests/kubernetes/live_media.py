"""Real live WAV/image streams through conversion and Python/Go Pods, including truncated capture."""
import argparse
import asyncio
import base64
import copy
import io
import json
from pathlib import Path
import wave
from uuid import uuid4

import httpx
from websockets.asyncio.client import connect
from support import wait_api

ROOT = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser(); p.add_argument('--namespace', required=True); args = p.parse_args()
if not args.namespace.startswith('testflow-e2e-'): raise SystemExit('Use a disposable acceptance namespace')
access = json.loads((ROOT / '.data/kubernetes' / args.namespace / 'access.json').read_text())
folder = ROOT / '.data/acceptance' / args.namespace
fixtures = json.loads((folder / 'result.json').read_text())['resources']
evidence = {'namespace': args.namespace, 'checks': [], 'executions': []}

def check(value, message):
    if not value: raise AssertionError(message)

async def main():
    async with httpx.AsyncClient(base_url=access['url'] + '/api/v1', trust_env=False, timeout=30) as http:
        await wait_api(http)
        async def call(method, path, body=None, **kwargs):
            response = await http.request(method, path, json=body, **kwargs)
            check(response.is_success, f'{method} {path}: HTTP {response.status_code} {response.text[:300]}')
            return response.json()
        async def ended(identifier):
            async with asyncio.timeout(120):
                while True:
                    row = await call('GET', '/executions/' + identifier)
                    if row['state'] not in {'queued', 'running'} and row['cleanup'] != 'stopping': return row
                    await asyncio.sleep(.2)
        await call('POST', '/auth/login', {'username': 'admin', 'password': access['password']})
        for module_id, kind in [('audio-gain', 'Audio'), ('image-grayscale', 'Image')]:
            source = await call('GET', '/pipelines/' + fixtures['pipelines'][module_id])
            graph = copy.deepcopy(source['data'])
            full = copy.deepcopy(graph['input_schema']); streamed = copy.deepcopy(full)
            streamed['fields'][0]['stream'] = True
            graph.update(name='TEST ONLY: live ' + kind, input_schema=streamed)
            graph['nodes'][0]['output_schema'] = streamed
            graph['nodes'].insert(1, {'id': 'convert', 'kind': 'conversion', 'name': 'Capture full media',
                                     'input_schema': streamed, 'output_schema': full, 'direction': 'to_full', 'timeout': 30})
            graph['edges'] = [{'source': 'start', 'target': 'convert'}, {'source': 'convert', 'target': 'module'}, {'source': 'module', 'target': 'end'}]
            pipeline = await call('POST', '/pipelines', graph)
            field = streamed['fields'][0]
            source_bytes = (await http.get('/media/' + fixtures['assets'][kind] + '?version=1')).content
            if kind == 'Audio':
                # Match a real microphone stream: unknown RIFF/data lengths, complete PCM16 chunks.
                # Uploaded FFmpeg WAVs can contain LIST chunks; microphone WAV has the canonical 44-byte header.
                canonical = io.BytesIO()
                with wave.open(io.BytesIO(source_bytes)) as uploaded, wave.open(canonical, 'wb') as microphone:
                    microphone.setparams(uploaded.getparams()); microphone.writeframes(uploaded.readframes(uploaded.getnframes()))
                source_bytes = canonical.getvalue()
                source_bytes = source_bytes[:4] + b'\xff' * 4 + source_bytes[8:40] + b'\xff' * 4 + source_bytes[44:]
            for truncated in [False, True]:
                ex = await call('POST', '/executions/quick', {'pipeline_id': pipeline['id'], 'pipeline_version': 1,
                    'profile_id': fixtures['profile'], 'profile_version': 1, 'inputs': {}, 'live': True},
                    headers={'Idempotency-Key': str(uuid4())})
                uri = access['url'].replace('http://', 'ws://') + '/api/v1/executions/' + ex['id'] + '/input'
                async with connect(uri, proxy=None, additional_headers={
                    'Cookie': '; '.join(f'{key}={value}' for key, value in http.cookies.items()), 'Origin': access['url']}) as socket:
                    seq = 0
                    for offset in range(0, len(source_bytes), 8192):
                        await socket.send(json.dumps({'type': 'input.chunk', 'field': field['name'], 'seq': seq,
                            'format': field['format'], 'encoding': 'base64', 'data': base64.b64encode(source_bytes[offset:offset+8192]).decode()}))
                        seq += 1
                    if not truncated:
                        await socket.send(json.dumps({'type': 'input.eos', 'field': field['name'], 'seq': seq}))
                        check(json.loads(await socket.recv())['type'] == 'input.completed', 'Explicit input EOS acknowledgment')
                row = await ended(ex['id']); evidence['executions'].append(ex['id'])
                check(row['state'] == ('failed' if truncated else 'succeeded'), f'{kind} terminal: {row.get("error")}')
                captured = row['actual_inputs'][field['name']]
                check(captured['truncated'] == truncated and captured['asset_id'], 'Capture completeness is fixed evidence')
                asset = await call('GET', f'/assets/{captured["asset_id"]}?version={captured["asset_version"]}')
                check(asset['data']['source'] == 'live_input' and asset['data']['metadata']['truncated'] == truncated, 'Capture provenance survives conversion persistence')
                media = await http.get(f'/media/{captured["asset_id"]}?version={captured["asset_version"]}')
                media.raise_for_status()
                if kind == 'Audio':
                    with wave.open(io.BytesIO(media.content)) as audio:
                        check(audio.getframerate() == 16000 and audio.getnchannels() == 1 and audio.getnframes() > 0, 'Captured microphone WAV is replayable')
                else:
                    check(media.content == source_bytes, 'Captured image bytes preserved exactly')
                if not truncated:
                    check(row['nodes']['module']['image_id'] and row['output'], 'Media was processed in a real language Pod')
                    check(sum(event['kind'] == 'module.request' for event in row['events']) == 1, 'Conversion starts exactly one invocation')
                evidence['checks'].append(kind.lower() + ('_disconnect_truncated_capture' if truncated else '_live_eos_conversion_real_pod'))
    (folder / 'live-media.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'passed': evidence['checks'], 'evidence': str(folder / 'live-media.json')}, ensure_ascii=False, indent=2))

try: asyncio.run(main())
except Exception as error:
    evidence['error'] = str(error)[:1000]
    (folder / 'live-media.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + '\n')
    raise

"""Create an actual concurrent revision in an owned acceptance namespace, never read UI state."""
import argparse
import asyncio
import json
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--namespace', required=True)
parser.add_argument('--resource', choices=['assets', 'datasets', 'repositories'], required=True)
parser.add_argument('--id', required=True)
parser.add_argument('--rename-input', help='Dataset schema conflict fixture: OLD:NEW')
args = parser.parse_args()
if not args.namespace.startswith('testflow-e2e-'):
    raise SystemExit('Only an explicitly owned acceptance namespace is supported')
access = json.loads((ROOT / '.data/kubernetes' / args.namespace / 'access.json').read_text())

async def main():
    async with httpx.AsyncClient(base_url=access['url']+'/api/v1') as http:
        response = await http.post('/auth/login', json={'username':'admin', 'password':access['password']})
        response.raise_for_status()
        path = '/'+args.resource+'/'+args.id
        response = await http.get(path)
        response.raise_for_status()
        resource = response.json()
        field = 'category' if args.resource == 'assets' else 'description'
        data = {**resource['data'], field:'Concurrent acceptance revision'}
        if args.rename_input:
            if args.resource != 'datasets': raise ValueError('Input rename applies only to a dataset')
            old, new = args.rename_input.split(':', 1)
            for item in data['input_schema']['fields']:
                if item['name'] == old: item['name'] = new
            for case in data['cases']:
                if old in case['inputs']: case['inputs'][new] = case['inputs'].pop(old)
        response = await http.put(path, json={'expected_version':resource['version'], 'data':data})
        response.raise_for_status()
        result = response.json()
        print(json.dumps({'id':result['id'], 'previous':resource['version'], 'version':result['version']}))

asyncio.run(main())

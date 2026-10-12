"""Read a frozen commit inside a real module container and prove its mount is read-only."""
import argparse
import asyncio
import json
import os
from pathlib import Path
import subprocess
from uuid import uuid4

import httpx
from support import wait_api, kube_connection

parser=argparse.ArgumentParser();parser.add_argument('--namespace',required=True);args=parser.parse_args()
if not args.namespace.startswith('testflow-e2e-'):raise SystemExit('Only disposable e2e namespaces')
root=Path(__file__).resolve().parents[2]
access=json.loads((root/'.data/kubernetes'/args.namespace/'access.json').read_text())
fixtures=json.loads((root/'.data/acceptance'/args.namespace/'result.json').read_text())['resources']
cli, env = kube_connection(access, args.namespace)
def kube(*args):return subprocess.run(cli+list(args),env=env,check=True,capture_output=True,text=True).stdout
async def main():
 async with httpx.AsyncClient(base_url=access['url']+'/api/v1',timeout=45,trust_env=False) as h:
  await wait_api(h)
  async def call(method,path,body=None):
   response=await h.request(method,path,json=body,headers={'Idempotency-Key':str(uuid4())});response.raise_for_status();return response.json()
  await call('POST','/auth/login',{'username':'admin','password':access['password']})
  repo=await call('GET','/repositories/'+fixtures['repository'])
  module=await call('GET','/modules/'+fixtures['modules']['text-transform'])
  mount={'repository_id':repo['id'],'repository_version':repo['selected_version'],'commit':repo['data']['commit'],'mount_path':'/workspace/code'}
  runtime={**module['data']['manifest']['runtime'],'code_mount':mount}
  operation=await call('POST','/modules/'+module['id']+'/validate',runtime)
  async with asyncio.timeout(90):
   while True:
    result=await call('GET','/operations/'+operation['id'])
    if result['state'] not in {'queued','running'}:assert result['state']=='succeeded';break
    await asyncio.sleep(.2)
  inp,out=module['data']['inputs'],module['data']['outputs']
  flow=await call('POST','/pipelines',{'name':'TEST ONLY: frozen read-only mount','input_schema':inp,'output_schema':out,'nodes':[{'id':'start','kind':'start','name':'Start','output_schema':inp},{'id':'module','kind':'module','name':module['name'],'module_id':module['id'],'module_version':module['selected_version'],'runtime':runtime,'parameters':{'mode':'uppercase','chunk_size':1000,'delay_ms':5000}},{'id':'end','kind':'end','name':'End','input_schema':out,'output_schema':out}],'edges':[{'source':'start','target':'module'},{'source':'module','target':'end'}]})
  execution=await call('POST','/executions/quick',{'pipeline_id':flow['id'],'pipeline_version':1,'profile_id':fixtures['profile'],'profile_version':1,'inputs':{'text':{'value':'mounted repository input'}}})
  try:
   async with asyncio.timeout(60):
    while True:
     ex=await call('GET','/executions/'+execution['id'])
     if ex['nodes'].get('module',{}).get('state')=='running':break
     if ex['state'] not in {'queued','running'}:raise AssertionError('Execution ended before mount observation')
     await asyncio.sleep(.1)
   runtime_id=ex['nodes']['module']['runtime_id']
   pod=json.loads(kube('get','pods','-l','testflow-runtime='+runtime_id,'-o','json'))['items'][0]['metadata']['name']
   source="const fs=require('node:fs'); const text=fs.readFileSync('/workspace/code/prefix.txt','utf8'); let error; try{fs.writeFileSync('/workspace/code/testflow-write-probe','test')}catch(e){error=e.code}; console.log(JSON.stringify({text,write_error:error}));"
   observed=json.loads(kube('exec',pod,'--','node','-e',source))
   assert observed=={'text':'fixed repository content\n','write_error':'EROFS'},observed
   async with asyncio.timeout(40):
    while True:
     ex=await call('GET','/executions/'+execution['id'])
     if ex['state']=='succeeded' and ex['cleanup']=='stopped':break
     await asyncio.sleep(.2)
   assert ex['snapshot']['pipeline']['graph']['nodes'][1]['runtime']['code_mount']==mount
   proof={'checks':['fixed_commit_read_inside_real_node_container','repository_mount_rejects_write','execution_snapshot_pins_same_commit_and_path','module_instance_cleaned_after_execution'],'execution_id':execution['id'],'mount':mount,'observed':observed,'image_id':ex['nodes']['module']['image_id']}
   (root/'.data/acceptance'/args.namespace/'code-mount.json').write_text(json.dumps(proof,indent=2)+'\n')
   print('Real Pod fixed-commit read and read-only mount passed')
  finally:
   ex=await call('GET','/executions/'+execution['id'])
   if ex['state'] in {'queued','running'}:await call('POST','/executions/'+execution['id']+'/cancel')
asyncio.run(main())

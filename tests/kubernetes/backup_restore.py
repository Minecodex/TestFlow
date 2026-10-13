"""Verify a restored DB/PVC/vault against the saved real acceptance records."""
import argparse
import asyncio
import json
from pathlib import Path
from uuid import uuid4
import httpx
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--namespace',required=True);p.add_argument('--source',required=True);a=p.parse_args()
async def main():
 access=json.loads((ROOT/'.data/kubernetes'/a.namespace/'access.json').read_text())
 source=json.loads((ROOT/'.data/acceptance'/a.source/'result.json').read_text())
 checks=[]
 async with httpx.AsyncClient(base_url=access['url']+'/api/v1',timeout=60) as h:
  async def call(method,path,**kw):
   r=await h.request(method,path,**kw);assert r.is_success,f'{method} {path}: {r.status_code}';return r.json()
  await call('POST','/auth/login',json={'username':'admin','password':access['password']});checks.append('restored_admin_session')
  task=await call('GET','/tasks/'+source['resources']['task']);assert task['report']['plan_count']==3 and task['report']['passed']==3;checks.append('restored_task_and_current_report')
  reports=await call('GET','/tasks/'+task['id']+'/reports');assert len(reports['items'])>=2;checks.append('restored_immutable_report_history')
  for run in source['executions']:
   actual=await call('GET','/executions/'+run['id']);assert actual['state']==run['state'] and actual['output'];assert actual['events'];assert actual['nodes']['module']['image_id']==run['image_id']
  checks.append('restored_outputs_trace_and_image_identity')
  for asset in source['resources']['assets'].values():
   actual=await call('GET','/assets/'+asset);r=await h.get('/media/'+asset,headers={'Range':'bytes=0-15'});assert r.status_code==206 and len(r.content)==min(actual['data']['size'],16)
  checks.append('restored_media_and_range_reads')
  profiles=(await call('GET','/evaluation-profiles'))['items'];profile=next(r for r in profiles if r['data']['model']=='k3')
  text=next(r['id'] for r in source['executions'] if 'text' in r['output_fields'])
  score=await call('POST','/executions/'+text+'/reevaluate?profile_id='+profile['id']+'&profile_version=1',headers={'Idempotency-Key':str(uuid4())})
  async with asyncio.timeout(120):
   while True:
    op=await call('GET','/operations/'+score['operation_id'])
    if op['state'] not in {'queued','running'}:assert op['state']=='succeeded';break
    await asyncio.sleep(.5)
  ex=await call('GET','/executions/'+text);evaluation=next(e for e in ex['evaluations'] if e['id']==score['id']);assert evaluation['state']=='completed' and evaluation['result']['verdict']=='pass'
  provider=source.get('ai',{}).get('provider_kind','real_kimi')
  checks.append('restored_encrypted_vault_'+provider+'_call')
  destination=ROOT/'.data/acceptance'/a.namespace;destination.mkdir(parents=True,exist_ok=True);(destination/'restore.json').write_text(json.dumps({'source':a.source,'destination':a.namespace,'checks':checks},indent=2)+'\n')
  print(json.dumps({'passed':checks,'evidence':str(destination/'restore.json')},indent=2))
asyncio.run(main())

"""Create synthetic browser fault/JSON resources only in an owned E2E namespace."""
import argparse,asyncio,json
from pathlib import Path
from uuid import uuid4
import httpx
ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--namespace',required=True);args=parser.parse_args()
ns=args.namespace
if not ns.startswith('testflow-e2e-'):raise SystemExit('Only disposable acceptance namespaces are supported')
access=json.loads((ROOT/'.data/kubernetes'/ns/'access.json').read_text())
async def main():
 async with httpx.AsyncClient(base_url=access['url']+'/api/v1',timeout=45,trust_env=False) as http:
  async def call(method,path,body=None,**kw):
   r=await http.request(method,path,json=body,**kw)
   if not r.is_success: raise RuntimeError(f'{method} {path}: {r.status_code}')
   return r.json()
  async def resource(kind,body):
   rows=(await call('GET','/'+kind+'?q='+body['name']))['items']
   found=next((r for r in rows if r['name']==body['name']),None)
   return found or await call('POST','/'+kind,body)
  async def op(ident):
   async with asyncio.timeout(90):
    while True:
     r=await call('GET','/operations/'+ident)
     if r['state'] not in {'queued','running'}:
      assert r['state']=='succeeded',r.get('error');return
     await asyncio.sleep(.2)
  await call('POST','/auth/login',{'username':'admin','password':access['password']})
  modules=(await call('GET','/modules'))['items']
  module=next(m for m in modules if m['data']['manifest']['id']=='test-fixture')
  runtime=module['data']['manifest']['runtime']
  validation=await call('POST',f'/modules/{module["id"]}/validate?version={module["selected_version"]}',runtime,headers={'Idempotency-Key':str(uuid4())})
  await op(validation['id'])
  inputs,outputs=module['data']['inputs'],module['data']['outputs']
  graph={'name':'TEST UI cancel fixture','input_schema':inputs,'output_schema':outputs,'cleanup_timeout':2,'preparation_timeout':60,'nodes':[
   {'id':'start','kind':'start','name':'Start','output_schema':inputs},
   {'id':'module','kind':'module','name':'Cancelable fixture','module_id':module['id'],'module_version':module['selected_version'],'runtime':runtime,'parameters':{'mode':'by_input','delay_ms':0},'timeout':30},
   {'id':'end','kind':'end','name':'End','input_schema':outputs,'output_schema':outputs}], 'edges':[{'source':'start','target':'module'},{'source':'module','target':'end'}]}
  pipeline=await resource('pipelines',graph)
  dataset=await resource('datasets',{'name':'TEST UI cancellation cases','input_schema':inputs,'output_schema':outputs,'cases':[{'id':str(uuid4()),'name':text,'inputs':{'text':{'value':text}}} for text in ['hang','success','never_started']]})
  profile=await resource('evaluation-profiles',{'name':'TEST UI cancellation rules','dimensions':[{'id':'complete','name':'完成状态','method':'completion','actual':{'source':'execution','field':'state'}}]})
  j={'fields':[{'name':'claims','type':'JSON','format':'application/json','stream':False}]}
  jp=await resource('pipelines',{'name':'TEST UI declared JSON','input_schema':j,'output_schema':j,'nodes':[{'id':'start','kind':'start','name':'Start','output_schema':j},{'id':'end','kind':'end','name':'End','input_schema':j,'output_schema':j}],'edges':[{'source':'start','target':'end'}]})
  image=next(a for a in (await call('GET','/assets?type=Image'))['items'])
  value={'asset_id':image['id'],'asset_version':image['selected_version'],'value':None,'stream':True,'eos':False}
  jd=await resource('datasets',{'name':'TEST UI JSON values','input_schema':j,'output_schema':j,'cases':[{'id':str(uuid4()),'name':name,'inputs':{'claims':{'value':v}},'reference':{'claims':v},'reference_confirmed':True} for name,v in [('Null JSON',None),('Asset-shaped JSON',value)]]})
  jprofile=await resource('evaluation-profiles',{'name':'TEST UI JSON rules','dimensions':[{'id':'exact','name':'JSON 一致','method':'exact_json','needs_reference':True,'actual':{'source':'output','field':'claims'},'reference':{'source':'reference','field':'claims'}}]})
  task=await call('POST','/tasks',{'name':'TEST UI JSON material','pairs':[{'dataset_id':jd['id'],'dataset_version':1,'pipeline_id':jp['id'],'pipeline_version':1}],'profile_id':jprofile['id'],'profile_version':1},headers={'Idempotency-Key':str(uuid4())})
  async with asyncio.timeout(40):
   while True:
    task=await call('GET','/tasks/'+task['id'])
    if task['state'] not in {'queued','running'}:break
    await asyncio.sleep(.2)
  assert task['report']['passed']==2,task['report']['rows']
  result={'cancellation':{'pipeline':pipeline['id'],'dataset':dataset['id'],'profile':profile['id']},'json_task':task['id'],'json_executions':[{ 'case':r['case']['name'],'id':r['execution_id']} for r in task['report']['rows']]}
  (ROOT/'.data/acceptance'/ns/'browser-fixtures.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
  print(result)
asyncio.run(main())

"""Real-Pod fault, streaming, race and restart acceptance. No simulated scheduler."""
import argparse
import asyncio
from copy import deepcopy
import json
import os
from pathlib import Path
import subprocess
from uuid import uuid4

from support import kube_connection

import httpx

ROOT = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser(); p.add_argument('--namespace', required=True); args = p.parse_args()
access = json.loads((ROOT/'.data/kubernetes'/args.namespace/'access.json').read_text())
cli, env = kube_connection(access, args.namespace)
output = ROOT/'.data/acceptance'/args.namespace; output.mkdir(parents=True, exist_ok=True)

def kube(*cmd):
    return subprocess.run(cli+list(cmd), env=env, check=True, capture_output=True, text=True).stdout

def check(value, message):
    if not value: raise AssertionError(message)

async def main():
    evidence = {'namespace':args.namespace, 'checks':[], 'executions':[]}
    async with httpx.AsyncClient(base_url=access['url']+'/api/v1', timeout=30) as http:
        async def call(method, path, body=None, **kwargs):
            response = await http.request(method, path, json=body, **kwargs)
            check(response.is_success, f'{method} {path}: {response.status_code} {response.text[:400]}')
            return response.json()
        async def operation(identifier):
            async with asyncio.timeout(90):
                while True:
                    row = await call('GET','/operations/'+identifier)
                    if row['state'] not in {'queued','running'}:
                        check(row['state']=='succeeded', f'Operation {row.get("error")}'); return row
                    await asyncio.sleep(.2)
        async def ended(identifier):
            async with asyncio.timeout(90):
                while True:
                    row = await call('GET','/executions/'+identifier)
                    if row['state'] not in {'queued','running'} and row['cleanup']!='stopping' and row['evaluations'] and row['evaluations'][0]['state'] not in {'queued','running'}:
                        evidence['executions'].append({'id':row['id'],'state':row['state'],'cleanup':row['cleanup'],'error':row.get('error')}); return row
                    await asyncio.sleep(.2)
        async def running(identifier, node='module'):
            async with asyncio.timeout(40):
                while True:
                    row = await call('GET','/executions/'+identifier)
                    if row['nodes'].get(node,{}).get('state')=='running': return row
                    check(row['state'] in {'queued','running'}, 'Invocation ended before expected running state')
                    await asyncio.sleep(.15)
        await call('POST','/auth/login',{'username':'admin','password':access['password']})
        module = await call('POST','/modules/import',files={'file':('fault.zip',(ROOT/'.data/module-packages/test-fixture-1.0.0.zip').read_bytes(),'application/zip')},headers={'Idempotency-Key':str(uuid4())})
        if module.get('operation_id'): await operation(module['operation_id'])
        runtime = module['data']['manifest']['runtime']
        validation = await call('POST',f'/modules/{module["id"]}/validate',runtime,headers={'Idempotency-Key':str(uuid4())}); await operation(validation['id'])
        inp, out = module['data']['inputs'], module['data']['outputs']
        profile = await call('POST','/evaluation-profiles',{'name':'TEST ONLY: terminal rules','dimensions':[{'id':'complete','name':'Completed','method':'completion','actual':{'source':'execution','field':'state'}}]})
        def node(identifier, mode='success', delay=0, timeout=10, rt=None):
            return {'id':identifier,'kind':'module','name':identifier,'module_id':module['id'],'module_version':module['selected_version'],'runtime':rt or runtime,'parameters':{'mode':mode,'delay_ms':delay},'timeout':timeout,'x':300,'y':150}
        async def flow(nodes, edges, name, schema=out, cleanup=1):
            body={'name':'TEST ONLY: '+name,'input_schema':inp,'output_schema':schema,'nodes':[{'id':'start','kind':'start','name':'Start','output_schema':inp,'x':20,'y':150},*nodes],'edges':[{'source':a,'target':b} for a,b in edges],'preparation_timeout':60,'cleanup_timeout':cleanup}
            return await call('POST','/pipelines',body)
        async def simple(mode, delay=0, timeout=10, cleanup=1):
            return await flow([node('module',mode,delay,timeout),{'id':'end','kind':'end','name':'End','input_schema':out,'output_schema':out,'x':650,'y':150}],[('start','module'),('module','end')],mode,cleanup=cleanup)
        async def quick(pipeline, text='hello', live=False):
            return await call('POST','/executions/quick',{'pipeline_id':pipeline['id'],'pipeline_version':1,'profile_id':profile['id'],'profile_version':1,'inputs':{'text':{'value':text}},'live':live},headers={'Idempotency-Key':str(uuid4())})
        for mode, expected in [('error','failed'),('truncate','failed'),('wrong_sequence','failed'),('premature_complete','failed'),('spontaneous_cancel','failed'),('success','succeeded')]:
            pipeline = await simple(mode); ex = await quick(pipeline); row = await ended(ex['id'])
            check(row['state']==expected, f'{mode} must be {expected}: {row.get("error")}')
            check(sum(e['kind'] in {'execution.succeeded','execution.failed','execution.canceled'} for e in row['events'])==1, 'Exactly one terminal')
            evidence['checks'].append(mode+'_actual_pod_terminal')
            print('Passed:', mode, flush=True)
        pipeline = await simple('hang', timeout=1); row = await ended((await quick(pipeline))['id'])
        check(row['error']['code']=='node_timeout', 'Node runtime deadline'); evidence['checks'].append('node_timeout_excludes_preparation')
        pipeline = await simple('hang'); ex = await quick(pipeline); await running(ex['id']); await call('POST','/executions/'+ex['id']+'/cancel'); row = await ended(ex['id'])
        check(row['state']=='canceled' and row['cleanup']=='stopped', 'Invocation cancellation and stopped confirmation'); evidence['checks'].append('accepted_cancel_and_normal_cleanup')
        pipeline = await simple('end_then_hang',cleanup=.5); row = await ended((await quick(pipeline))['id'])
        check(row['state']=='succeeded' and row['cleanup']=='timed_out','Success preserved despite independent cleanup timeout')
        check(any(e['kind']=='cleanup.timed_out' and e['data']['pod_evidence'] for e in row['events']),'Actual Pod deletion evidence'); evidence['checks'].append('success_and_independent_cleanup_deadline')
        # One module output feeds two converters. Upstream invocation is never duplicated.
        full={'fields':[{**f,'stream':False} for f in out['fields']]}
        branches=[node('module'),*({'id':c,'kind':'conversion','name':c,'direction':'to_full','input_schema':out,'output_schema':full} for c in ['c1','c2']),*({'id':e,'kind':'end','name':e,'input_schema':full,'output_schema':full} for e in ['e1','e2'])]
        pipeline=await flow(branches,[('start','module'),('module','c1'),('module','c2'),('c1','e1'),('c2','e2')],'fanout',full)
        row=await ended((await quick(pipeline))['id']);check(row['state']=='succeeded' and row['output']['text']=='HELLO','Stream-to-full output')
        check(sum(e['kind']=='module.request' for e in row['events'])==1,'Fork invokes upstream once'); evidence['checks'].append('fanout_once_stream_to_full_and_complete_end_race')
        assembled={'fields':[{**inp['fields'][0],'name':name} for name in ['left','right']]}
        nodes=[node('left'),node('right'),{'id':'join','kind':'assembly','name':'Join','output_schema':assembled,'mappings':[{'source':n,'field':'text','target':n} for n in ['left','right']]},{'id':'end','kind':'end','name':'End','input_schema':assembled,'output_schema':assembled}]
        pipeline=await flow(nodes,[('start','left'),('start','right'),('left','join'),('right','join'),('join','end')],'ordered assembly',assembled)
        row=await ended((await quick(pipeline))['id']);check(row['state']=='succeeded' and all(row['output'][n]['text']=='HELLO' and row['output'][n]['eos'] for n in ['left','right']),'Assembly continuously forwards normal streams'); evidence['checks'].append('ordered_assembly_forwards_streams')
        # A single reused Pod has two concurrent invocations; cleanup of one kills the shared runtime.
        pipeline=await simple('by_input',cleanup=.5)
        dataset=await call('POST','/datasets',{'name':'TEST ONLY: shared runtime','input_schema':inp,'output_schema':out,'cases':[{'id':str(uuid4()),'name':v,'inputs':{'text':{'value':v}}} for v in ['end_then_hang','slow_success','success']]})
        task=await call('POST','/tasks',{'name':'TEST ONLY: shared Pod loss','pairs':[{'dataset_id':dataset['id'],'dataset_version':1,'pipeline_id':pipeline['id'],'pipeline_version':1}],'profile_id':profile['id'],'profile_version':1,'concurrency':2},headers={'Idempotency-Key':str(uuid4())})
        await operation(task['operation_id']); report=(await call('GET','/tasks/'+task['id']))['report']
        runs=[await ended(r['execution_id']) for r in report['rows']]
        check(runs[0]['state']=='succeeded' and runs[0]['cleanup']=='timed_out','First complete end kept')
        check(runs[1]['error']['code']=='runtime_lost','Other shared invocation records runtime loss')
        check(runs[2]['state']=='succeeded' and runs[2]['nodes']['module']['runtime_id']!=runs[0]['nodes']['module']['runtime_id'],'Remaining plan uses new instance'); evidence['checks'].append('shared_pod_lost_and_remaining_plan_new_instance')
        # Live input disconnect is truncated; normal live input is captured into immutable assets.
        pipeline=await simple('success')
        for truncated in [False,True]:
            ex=await quick(pipeline,live=True)
            from websockets.asyncio.client import connect
            uri=access['url'].replace('http://','ws://')+'/api/v1/executions/'+ex['id']+'/input'
            async with connect(uri,proxy=None,additional_headers={'Cookie':'; '.join(f'{k}={v}' for k,v in http.cookies.items()),'Origin':access['url']}) as socket:
                await socket.send(json.dumps({'type':'input.chunk','field':'text','seq':0,'format':'UTF-8','data':'live evidence'}))
                if not truncated:
                    await socket.send(json.dumps({'type':'input.eos','field':'text','seq':1}))
                    await socket.recv()
            row=await ended(ex['id']); check(row['state']==('failed' if truncated else 'succeeded'),'Live disconnect/normal EOS terminal')
            check(row['actual_inputs']['text']['asset_id'] and row['actual_inputs']['text']['truncated']==truncated,'Live material captured with completeness evidence')
        evidence['checks'].append('live_input_capture_eos_and_disconnect')
        # Sequential declaration dominates requested case concurrency.
        sequential={**runtime,'requires_sequential':True}
        val=await call('POST',f'/modules/{module["id"]}/validate',sequential,headers={'Idempotency-Key':str(uuid4())});await operation(val['id'])
        seqflow=await flow([node('module',rt=sequential),{'id':'end','kind':'end','name':'End','input_schema':out,'output_schema':out}],[('start','module'),('module','end')],'sequential')
        body={'name':'TEST ONLY: sequential','pairs':[{'dataset_id':dataset['id'],'dataset_version':1,'pipeline_id':seqflow['id'],'pipeline_version':1}],'profile_id':profile['id'],'profile_version':1,'concurrency':3}
        preview=await call('POST','/tasks/preview',body);check(preview['effective_concurrency']==1,'Sequential effective concurrency');evidence['checks'].append('sequential_effective_case_concurrency')
        # Abrupt backend restart preserves already ended outputs and interrupts only the active attempt.
        pipeline=await simple('by_input',timeout=40)
        restart_data=await call('POST','/datasets',{'name':'TEST ONLY: restart','input_schema':inp,'output_schema':out,'cases':[{'id':str(uuid4()),'name':v,'inputs':{'text':{'value':v}}} for v in ['hang','success','success2']]})
        task=await call('POST','/tasks',{'name':'TEST ONLY: restart recovery','pairs':[{'dataset_id':restart_data['id'],'dataset_version':1,'pipeline_id':pipeline['id'],'pipeline_version':1}],'profile_id':profile['id'],'profile_version':1},headers={'Idempotency-Key':str(uuid4())})
        async with asyncio.timeout(30):
            while True:
                detail=await call('GET','/tasks/'+task['id']);current=detail['report']['rows'][0].get('active_execution_id')
                if current:await running(current);break
                await asyncio.sleep(.2)
        pod=json.loads(kube('get','pods','-l','app=testflow-server','-o','json'))['items'][0]['metadata']['name']
        await asyncio.to_thread(kube,'delete','pod',pod,'--grace-period=0','--force','--wait=false')
        async with asyncio.timeout(60):
            while True:
                try:
                    detail=await call('GET','/tasks/'+task['id'])
                    if detail['state'] in {'completed','completed_with_errors'}:break
                except (httpx.HTTPError,AssertionError):pass
                await asyncio.sleep(.5)
        check(detail['report']['plan_count']==3 and len(detail['report']['rows'])==3,'Recovery does not expand frozen denominator')
        recovered=[await call('GET','/executions/'+r['execution_id']) for r in detail['report']['rows']]
        check(recovered[0]['state']=='failed' and recovered[0]['error']['code']=='interrupted','Running attempt marked interrupted')
        check(all(r['state']=='succeeded' and r['attempt']==1 for r in recovered[1:]),'Only never-started plans resume')
        evidence['checks'].append('abrupt_backend_restart_interrupts_active_and_resumes_pending_only')
        check(not json.loads(kube('get','pods','-l','testflow-runtime','-o','json'))['items'],'Fault acceptance Pods reclaimed')
        (output/'boundaries.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps({'passed':evidence['checks'],'evidence':str(output/'boundaries.json')},ensure_ascii=False,indent=2))

asyncio.run(main())

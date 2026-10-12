"""Real namespaced acceptance: Git, three language Pods, media, AI, reruns and reports.

Run after scripts/deploy-kubernetes.py. All data is generated test material.
No credentials or response bodies containing credentials are written to evidence.
"""
import argparse
import asyncio
import io
import json
import math
import os
from pathlib import Path
import struct
import subprocess
import time
from uuid import uuid4
import wave
from support import wait_api, kube_connection

import httpx
from PIL import Image
from testflow.core.config import Settings
from testflow.features.auth import credential_value
from testflow.infrastructure.database import Database

ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser()
parser.add_argument('--namespace',required=True)
parser.add_argument('--kimi-reference',type=Path,default=ROOT/'.data/kimi-credential-reference')
args=parser.parse_args()
access=json.loads((ROOT/'.data/kubernetes'/args.namespace/'access.json').read_text())
output=ROOT/'.data/acceptance'/args.namespace;output.mkdir(parents=True,exist_ok=True)
cli, environment = kube_connection(access, args.namespace)

def kube(*command):
    return subprocess.run(cli+list(command),env=environment,check=True,capture_output=True,text=True).stdout

def check(condition,message):
    if not condition: raise AssertionError(message)

async def main():
    evidence={'namespace':args.namespace,'checks':[],'resources':{},'executions':[]}
    async with httpx.AsyncClient(base_url=access['url']+'/api/v1',timeout=60) as http:
        await wait_api(http)
        async def call(method,path,body=None,**kwargs):
            # Read-only polling may cross a rollout/port-forward reconnect. Never repeat an uncertain write.
            deadline=time.monotonic()+12
            while True:
                try:
                    response=await http.request(method,path,json=body,**kwargs)
                    if method=='GET' and response.status_code in {502,503,504} and time.monotonic()<deadline:
                        await asyncio.sleep(.25);continue
                    check(response.is_success,f'{method} {path}: HTTP {response.status_code}; {response.text[:800]}')
                    return response.json()
                except httpx.HTTPError:
                    if method!='GET' or time.monotonic()>=deadline:raise
                    await asyncio.sleep(.25)
        async def op(identifier):
            async with asyncio.timeout(90):
                while True:
                    result=await call('GET','/operations/'+identifier)
                    if result['state'] not in {'queued','running'}:
                        check(result['state']=='succeeded',f'Operation failed: {result.get("error")}')
                        return result
                    await asyncio.sleep(.25)
        async def execution(identifier):
            async with asyncio.timeout(150):
                while True:
                    result=await call('GET','/executions/'+identifier)
                    if result['state'] not in {'queued','running'} and result['cleanup']!='stopping' and result['evaluations'] and result['evaluations'][0]['state'] not in {'queued','running'}:
                        return result
                    await asyncio.sleep(.25)
        await call('POST','/auth/login',{'username':'admin','password':access['password']})
        check((await call('GET','/system/overview'))['runs']=={},'Default installation must have no invented runs')
        fixture=output/'git-fixture';fixture.mkdir(exist_ok=True)
        subprocess.run(['git','init','--initial-branch=main',str(fixture)],check=True,capture_output=True)
        (fixture/'prefix.txt').write_text('fixed repository content\n')
        subprocess.run(['git','-C',str(fixture),'add','.'],check=True)
        subprocess.run(['git','-C',str(fixture),'-c','user.name=TestFlow','-c','user.email=testflow@example.invalid','commit','--allow-empty','-m','Acceptance fixture'],check=True,capture_output=True)
        pod=json.loads(kube('get','pods','-l','app=testflow-server','-o','json'))['items'][0]['metadata']['name']
        kube('exec',pod,'--','mkdir','-p','/data/fixtures')
        kube('cp',str(fixture),pod+':/data/fixtures/repository')
        repo=await call('POST','/repositories',{'name':'验收：固定仓库','url':'file:///data/fixtures/repository','branch':'main'})
        operation=await call('POST','/repositories/'+repo['id']+'/sync',headers={'Idempotency-Key':str(uuid4())})
        await op(operation['id']);repo=await call('GET','/repositories/'+repo['id'])
        check(len(repo['data']['commit'])==40,'Git must pin a complete commit')
        evidence['checks'].append('real_git_sync_and_fixed_commit');evidence['resources']['repository']=repo['id']
        modules={}
        for package in json.loads((ROOT/'.data/example-modules.json').read_text()):
            result=await call('POST','/modules/import',files={'file':(Path(package['zip']).name,(ROOT/package['zip']).read_bytes(),'application/zip')},headers={'Idempotency-Key':str(uuid4())})
            if result.get('operation_id'): await op(result['operation_id'])
            runtime=result['data']['manifest']['runtime']
            if package['id']=='text-transform':
                runtime={**runtime,'code_mount':{'repository_id':repo['id'],'repository_version':repo['selected_version'],'commit':repo['data']['commit'],'mount_path':'/workspace/code'}}
            validation=await call('POST','/modules/'+result['id']+'/validate',runtime,headers={'Idempotency-Key':str(uuid4())})
            validated=await op(validation['id']);check(validated['result']['contract_verified'],'Actual Pod contract')
            modules[package['id']]={**result,'runtime':runtime,'image_id':validated['result']['image_id']}
        evidence['checks'].append('python_node_go_actual_pod_identity_and_contract')
        evidence['resources']['modules']={k:v['id'] for k,v in modules.items()}
        wav=io.BytesIO()
        with wave.open(wav,'wb') as audio:
            audio.setparams((1,2,16000,16000,'NONE','not compressed'))
            audio.writeframes(b''.join(struct.pack('<h',int(8000*math.sin(i*2*math.pi*440/16000))) for i in range(16000)))
        png=io.BytesIO();Image.new('RGB',(96,64),(220,40,70)).save(png,format='PNG')
        uploads=await call('POST','/media/upload',files=[('files',('input.wav',wav.getvalue(),'audio/wav')),('files',('input.png',png.getvalue(),'image/png')),('files',('input.txt',b'hello testflow','text/plain'))])
        check(all(item['resource'] for item in uploads['items']),'Real media imports')
        assets={a['resource']['data']['type']:a['resource'] for a in uploads['items']}
        for kind,asset in assets.items():
            media=await http.get('/media/'+asset['id'],headers={'Range':'bytes=0-15'})
            check(media.status_code==206 and len(media.content)==min(16,asset['data']['size']),'Range media access '+kind)
        evidence['checks'].append('audio_image_text_import_and_media_range')
        profile=await call('POST','/evaluation-profiles',{'name':'验收：真实完成状态','dimensions':[{'id':'completion','name':'执行成功','method':'completion','actual':{'source':'execution','field':'state'}}]})
        flows={};datasets={}
        for key,module in modules.items():
            inp,out=module['data']['inputs'],module['data']['outputs']
            flow={'name':'验收：'+module['name'],'input_schema':inp,'output_schema':out,'nodes':[{'id':'start','kind':'start','name':'开始','x':50,'y':180,'output_schema':inp}, {'id':'module','kind':'module','name':module['name'],'x':340,'y':180,'module_id':module['id'],'module_version':module['selected_version'],'parameters':module['data']['manifest']['defaults'],'runtime':module['runtime']}, {'id':'end','kind':'end','name':'结束','x':660,'y':180,'input_schema':out,'output_schema':out}],'edges':[{'source':'start','target':'module'},{'source':'module','target':'end'}]}
            flow=await call('POST','/pipelines',flow);flows[key]=flow
            field=inp['fields'][0];asset=assets[field['type']]
            dataset={'name':'验收案例：'+module['name'],'input_schema':inp,'output_schema':out,'cases':[{'id':str(uuid4()),'name':module['name']+'真实输入','inputs':{field['name']:{'asset_id':asset['id'],'asset_version':asset['version']}}}]}
            datasets[key]=await call('POST','/datasets',dataset)
        body={'name':'验收：跨语言真实任务','pairs':[{'dataset_id':datasets[k]['id'],'dataset_version':1,'pipeline_id':v['id'],'pipeline_version':1} for k,v in flows.items()],'profile_id':profile['id'],'profile_version':1,'concurrency':2}
        preview=await call('POST','/tasks/preview',body);check(preview['plan_count']==3,'Frozen pair plan')
        request_key=str(uuid4());task=await call('POST','/tasks',body,headers={'Idempotency-Key':request_key})
        same=await call('POST','/tasks',body,headers={'Idempotency-Key':request_key});check(same['id']==task['id'],'Idempotent task submission')
        await op(task['operation_id'])
        report=await call('GET','/tasks/'+task['id']+'/reports')
        check(report['current']['passed']==3,f'Actual task must pass: {report["current"]["rows"]}')
        old=report['items'][0]
        runs=[await execution(row['execution_id']) for row in report['current']['rows']]
        for run in runs:
            check(run['state']=='succeeded' and run['cleanup']=='stopped','Execution terminal and cleanup')
            check(any(e['kind']=='trace.internal' for e in run['events']),'Real internal Trace')
            evidence['executions'].append({'id':run['id'],'state':run['state'],'cleanup':run['cleanup'],'output_fields':list(run['output']),'image_id':run['nodes']['module']['image_id']})
        node_run=next(run for run in runs if run['snapshot']['pipeline']['id']==flows['text-transform']['id'])
        check(node_run['output']['text']['eos'] and node_run['output']['text']['text']=='HELLO TESTFLOW','WebSocket incremental output and normal EOS')
        check(node_run['output']['stats']['received_chunks']>0,'Real WebSocket stream input')
        evidence['checks'].append('real_cross_language_media_processing_streaming_trace_and_report')
        retry=await call('POST','/executions/'+node_run['id']+'/rerun',headers={'Idempotency-Key':str(uuid4())})
        retried=await execution(retry['id']);check(retried['state']=='succeeded','Real Pod rerun')
        check(retried['nodes']['module']['runtime_id']!=node_run['nodes']['module']['runtime_id'],'Rerun must use a new instance')
        reports=await call('GET','/tasks/'+task['id']+'/reports')
        check(reports['current']['plan_count']==3 and any(r['id']==old['id'] and r['snapshot']==old['snapshot'] for r in reports['items']),'Old reports immutable; denominator unchanged')
        evidence['checks'].append('rerun_new_pod_immutable_old_report_and_stable_denominator')
        if args.kimi_reference.exists():
            settings=Settings(_env_file=ROOT/'.env');database=Database(settings)
            async with database.sessions() as db:
                token=await credential_value(db,settings,args.kimi_reference.read_text().strip())
            await database.close()
            credential=await call('POST','/credentials',{'name':'验收：Kimi','kind':'evaluation','value':token})
            token=None
            ai=await call('POST','/evaluation-profiles',{'name':'验收：Kimi K3','endpoint':'https://api.kimi.com/coding/v1','model':'k3','credential_id':credential['id'],'response_format':'json_schema','dimensions':[{'id':'ai','name':'文本质量','method':'ai','threshold':.5,'actual':{'source':'output','field':'text'},'prompt':'Score 1 if the actual text equals HELLO TESTFLOW; otherwise score 0. Cite actual as evidence.'}]})
            scoring=await call('POST','/executions/'+retry['id']+'/reevaluate?profile_id='+ai['id']+'&profile_version=1',headers={'Idempotency-Key':str(uuid4())})
            await op(scoring['operation_id']);scored=await call('GET','/executions/'+retry['id'])
            record=next(e for e in scored['evaluations'] if e['id']==scoring['id'])
            check(record['state']=='completed' and record['result']['verdict']=='pass','Real Kimi evaluation must pass '+str(record.get('error')))
            evidence['ai']=record['result'];evidence['checks'].append('real_kimi_k3_json_schema_scoring_and_evidence_validation')
        else: evidence['ai']={'state':'not_tested','reason':'Real credential reference unavailable'}
        evidence['resources'].update(task=task['id'],profile=profile['id'],pipelines={k:v['id'] for k,v in flows.items()},datasets={k:v['id'] for k,v in datasets.items()},assets={k:v['id'] for k,v in assets.items()})
        check(not json.loads(kube('get','pods','-l','testflow-runtime','-o','json'))['items'],'Batch module Pods reclaimed')
        evidence['checks'].append('module_pod_cleanup')
        (output/'result.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps({'namespace':args.namespace,'passed':evidence['checks'],'evidence':str((output/'result.json').relative_to(ROOT))},ensure_ascii=False,indent=2))

asyncio.run(main())

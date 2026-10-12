"""Real small-model helpdesk experiment, in an explicitly disposable Kubernetes workspace."""
import argparse
import asyncio
import io
import json
import os
from pathlib import Path
import subprocess
import wave
from uuid import uuid4
import httpx
from PIL import Image, ImageDraw, ImageFont
from support import wait_api, kube_connection
from testflow.core.config import Settings
from testflow.features.auth import credential_value
from testflow.infrastructure.database import Database

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--namespace', required=True)
args = parser.parse_args()
if not args.namespace.startswith('testflow-e2e-'):
    raise SystemExit('Only disposable acceptance namespaces')
access = json.loads((ROOT/'.data/kubernetes'/args.namespace/'access.json').read_text())
cli, env = kube_connection(access, args.namespace)
output = ROOT/'.data/acceptance'/args.namespace
output.mkdir(parents=True,exist_ok=True)
def kube(*arguments):
    return subprocess.run(cli+list(arguments),env=env,check=True,capture_output=True,text=True).stdout
def check(condition, message):
    if not condition:
        raise AssertionError(message)
field = lambda name, kind, stream=False: {'name':name,'type':kind,'stream':stream,
    'format':{'Text':'UTF-8','JSON':'application/json','Audio':'WAV · 16kHz · Mono','Image':'Image/*'}[kind]}
schema = lambda *fields: {'fields':list(fields)}

async def main():
    evidence = {'namespace':args.namespace,'project':'Acorn Mini Store','checks':[], 'runs':[],
                'limitations':['English constrained ASR grammar, not general speech recognition',
                               'OCR reads printed English text, not general visual understanding',
                               'BM25 has no embedding model', 'Kimi is a remote model', 'No microphone access']}
    packages = json.loads((ROOT/'.data/tiny-scenario-modules.json').read_text())
    async with httpx.AsyncClient(base_url=access['url']+'/api/v1',timeout=90,trust_env=False) as http:
        await wait_api(http)
        async def call(method,path,body=None,**kwargs):
            headers = {'Idempotency-Key':str(uuid4())} if method != 'GET' else {}
            response = await http.request(method,path,json=body,headers=headers,**kwargs)
            response.raise_for_status()
            return response.json()
        async def operation(identifier):
            async with asyncio.timeout(180):
                while True:
                    row = await call('GET','/operations/'+identifier)
                    if row['state'] not in {'queued','running'}:
                        check(row['state']=='succeeded','Operation failed: '+str(row.get('error')))
                        return row
                    await asyncio.sleep(.25)
        async def execution(identifier):
            async with asyncio.timeout(300):
                while True:
                    row = await call('GET','/executions/'+identifier)
                    evaluations = row['evaluations']
                    if row['state'] not in {'queued','running'} and row['cleanup']!='stopping' and evaluations and all(e['state'] not in {'queued','running'} for e in evaluations):
                        return row
                    await asyncio.sleep(.25)
        await call('POST','/auth/login',{'username':'admin','password':access['password']})
        evidence['checks'].append('real_admin_session')
        project = output/'project'
        project.mkdir(exist_ok=True)
        for file in ['knowledge.json','README.md']:
            (project/file).write_bytes((ROOT/'examples/scenarios/tiny-helpdesk/project'/file).read_bytes())
        subprocess.run(['git','init','--initial-branch=main',str(project)],check=True,capture_output=True)
        subprocess.run(['git','-C',str(project),'add','.'],check=True,capture_output=True)
        subprocess.run(['git','-C',str(project),'-c','user.name=TestFlow','-c','user.email=testflow@example.invalid','commit','-m','Fictional helpdesk knowledge'],check=True,capture_output=True)
        pod = json.loads(kube('get','pods','-l','app=testflow-server','-o','json'))['items'][0]['metadata']['name']
        kube('exec',pod,'--','mkdir','-p','/data/fixtures')
        kube('cp',str(project),pod+':/data/fixtures/tiny-helpdesk')
        repo = await call('POST','/repositories',{'name':'实验：Acorn Mini Store','url':'file:///data/fixtures/tiny-helpdesk','branch':'main'})
        await operation((await call('POST','/repositories/'+repo['id']+'/sync'))['id'])
        repo = await call('GET','/repositories/'+repo['id'])
        evidence['repository']={'id':repo['id'],'commit':repo['data']['commit'],'version':repo['selected_version']}
        evidence['checks'].append('fictional_project_real_git_fixed_commit')
        settings = Settings(_env_file=ROOT/'.env')
        database = Database(settings)
        async with database.sessions() as db:
            token = await credential_value(db,settings,(ROOT/'.data/kimi-credential-reference').read_text().strip())
        await database.close()
        module_credential = await call('POST','/credentials',{'name':'实验 Kimi 模块','kind':'module','value':token})
        evaluation_credential = await call('POST','/credentials',{'name':'实验 Kimi 评测','kind':'evaluation','value':token})
        token = None
        modules = {}
        for package in packages:
            imported = await call('POST','/modules/import',files={'file':(Path(package['zip']).name,(ROOT/package['zip']).read_bytes(),'application/zip')})
            if imported.get('operation_id'):
                await operation(imported['operation_id'])
            runtime = imported['data']['manifest']['runtime']
            if package['id']=='tiny-retrieval':
                runtime = {**runtime,'code_mount':{'repository_id':repo['id'],'repository_version':repo['selected_version'],
                            'commit':repo['data']['commit'],'mount_path':'/workspace/project'}}
            verified = await operation((await call('POST','/modules/'+imported['id']+'/validate',runtime))['id'])
            check(verified['result']['contract_verified'],'Actual module contract')
            modules[package['id']]={**imported,'runtime':runtime,'image_id':verified['result']['image_id']}
        evidence['modules']={k:{'id':v['id'],'image_id':v['image_id']} for k,v in modules.items()}
        evidence['checks'].append('five_actual_module_pod_contracts_and_image_identity')
        tts_image = next(p['image'] for p in packages if p['id']=='tiny-tts')
        evidence['models']=json.loads(subprocess.run(['docker','run','--rm','--entrypoint','cat',tts_image,'/app/models.json'],check=True,capture_output=True).stdout)
        generator = "import subprocess,tempfile; from pathlib import Path;\nwith tempfile.TemporaryDirectory() as d:\n a=Path(d)/'raw.wav'; b=Path(d)/'input.wav'; subprocess.run(['espeak-ng','-v','en-us','-s','135','-w',str(a),'what is the refund policy'],check=True); subprocess.run(['ffmpeg','-v','error','-i',str(a),'-ar','16000','-ac','1','-c:a','pcm_s16le',str(b)],check=True); import sys; sys.stdout.buffer.write(b.read_bytes())"
        wav = subprocess.run(['docker','run','--rm','--entrypoint','python',tts_image,'-c',generator],check=True,capture_output=True).stdout
        with wave.open(io.BytesIO(wav)) as audio:
            check((audio.getframerate(),audio.getnchannels(),audio.getsampwidth())==(16000,1,2),'Synthetic speech WAV')
        (output/'question.wav').write_bytes(wav)
        picture = Image.new('RGB',(1000,160),'white')
        fonts = [Path('/System/Library/Fonts/Supplemental/Arial.ttf'),Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')]
        font = ImageFont.truetype(str(next(p for p in fonts if p.exists())),42)
        ImageDraw.Draw(picture).text((25,45),'What is the refund policy?',font=font,fill='black')
        png = io.BytesIO();picture.save(png,format='PNG');(output/'question.png').write_bytes(png.getvalue())
        uploaded = await call('POST','/media/upload',files=[('files',('question.wav',wav,'audio/wav')),('files',('question.png',png.getvalue(),'image/png'))])
        assets = {item['resource']['data']['type']:item['resource'] for item in uploaded['items']}
        check(len(assets)==2,'Real media imports')
        evidence['checks'].append('synthetic_speech_and_printed_image_imported_as_real_assets')
        completion = await call('POST','/evaluation-profiles',{'name':'实验闭环规则','dimensions':[
            {'id':'completion','name':'正常完成','method':'completion','threshold':1,'actual':{'source':'execution','field':'state'}},
            {'id':'structure','name':'输出完整','method':'structure','threshold':1,'actual':{'source':'output','field':''}},
            {'id':'duration','name':'期限内完成','method':'duration','threshold':120000,'actual':{'source':'execution','field':'duration_ms'}}]})
        pipelines, datasets = {}, {}
        for modality, source_id, inp in [('text',None,schema(field('query','Text'))),('voice','tiny-asr',schema(field('audio','Audio'))),('image','tiny-ocr',schema(field('image','Image')))]:
            def node(identifier,module_id,x,parameters=None):
                module=modules[module_id]
                return {'id':identifier,'kind':'module','name':module['name'],'x':x,'y':200,
                        'module_id':module['id'],'module_version':module['selected_version'],'runtime':module['runtime'],
                        'parameters':parameters if parameters is not None else module['data']['manifest']['defaults'],'timeout':120 if module_id=='kimi-answer' else 30}
            full = schema(field('answer','Text'),field('evidence','JSON'))
            result = schema(field('answer','Text'),field('audio','Audio'),field('evidence','JSON'))
            nodes=[{'id':'start','kind':'start','name':'输入','x':20,'y':200},
                   node('retrieval','tiny-retrieval',400),node('kimi','kimi-answer',660,{'credential_id':module_credential['id']}),
                   {'id':'full','kind':'conversion','name':'收集完整回答','x':910,'y':200,'direction':'to_full',
                    'input_schema':modules['kimi-answer']['data']['outputs'],'output_schema':full},
                   {'id':'tts-input','kind':'assembly','name':'选取回答','x':1160,'y':200,'output_schema':schema(field('answer','Text')),
                    'mappings':[{'target':'answer','source':'full','field':'answer'}]},
                   node('tts','tiny-tts',1400),
                   {'id':'result','kind':'assembly','name':'固定回答与证据','x':1640,'y':200,'output_schema':result,
                    'mappings':[{'target':'answer','source':'tts','field':'answer'},{'target':'audio','source':'tts','field':'audio'},
                                {'target':'evidence','source':'full','field':'evidence'}]},
                   {'id':'end','kind':'end','name':'结果','x':1900,'y':200}]
            edges=[('retrieval','kimi'),('kimi','full'),('full','tts-input'),('tts-input','tts'),('tts','result'),('full','result'),('result','end')]
            if source_id:
                nodes.insert(1,node('recognition',source_id,180));edges.extend([('start','recognition'),('recognition','retrieval')])
                asset=assets['Audio' if modality=='voice' else 'Image'];binding={inp['fields'][0]['name']:{'asset_id':asset['id'],'asset_version':asset['selected_version']}}
            else:
                edges.append(('start','retrieval'));binding={'query':{'value':'What is the refund policy?'}}
            pipeline=await call('POST','/pipelines',{'name':'实验：'+modality+' → RAG → Kimi → 语音','input_schema':inp,'output_schema':result,
                'preparation_timeout':90,'cleanup_timeout':10,'nodes':nodes,'edges':[{'source':s,'target':t} for s,t in edges]})
            pipelines[modality]=pipeline
            datasets[modality]=await call('POST','/datasets',{'name':'实验案例：'+modality,'input_schema':inp,'output_schema':result,
                'cases':[{'id':str(uuid4()),'name':'Acorn refund / '+modality,'inputs':binding}]})
        body={'name':'实验：文字、语音、图片真实帮助台','pairs':[{'dataset_id':datasets[m]['id'],'dataset_version':1,
             'pipeline_id':pipelines[m]['id'],'pipeline_version':1} for m in pipelines],'profile_id':completion['id'],'profile_version':1,'concurrency':1}
        preview=await call('POST','/tasks/preview',body);check(preview['plan_count']==3,'Three frozen scenario items')
        task=await call('POST','/tasks',body);await operation(task['operation_id'])
        report=(await call('GET','/tasks/'+task['id']+'/reports'))['current']
        (output/'scenario-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        check(report['passed']==3,'All three real model chains must pass')
        for row in report['rows']:
            run=await execution(row['execution_id'])
            check(run['state']=='succeeded' and run['cleanup']=='stopped','Actual execution and remote cleanup')
            answer=run['output']['answer'];citations=run['output']['evidence']
            check('14' in answer and 'returns' in citations['cited_ids'],'Grounded refund answer and known source')
            check(run['nodes']['kimi']['output']['answer']['eos'] and citations['chunks']>0,'Real incremental Kimi stream EOS')
            check(any(e['kind']=='trace.internal' for e in run['events']),'Real model trace')
            ref=run['output']['audio'];media=await http.get('/media/'+ref['asset_id']+'?version='+str(ref['asset_version']))
            media.raise_for_status()
            with wave.open(io.BytesIO(media.content)) as audio:
                check(audio.getframerate()==16000 and audio.getnframes()>0,'Real playable TTS artifact')
                frames=audio.getnframes()
            modality=next(m for m,p in pipelines.items() if p['id']==run['snapshot']['pipeline']['id'])
            (output/(modality+'-reply.wav')).write_bytes(media.content)
            (output/(modality+'-execution.json')).write_text(json.dumps(run,ensure_ascii=False,indent=2)+'\n')
            evidence['runs'].append({'modality':modality,'execution_id':run['id'],'answer':answer,'evidence':citations,
                'recognized_query':run['nodes'].get('recognition',{}).get('output',{}).get('query'),
                'trace_spans':sum(e['kind']=='trace.internal' for e in run['events']),'speech_frames':frames,
                'image_ids':{k:n['image_id'] for k,n in run['nodes'].items() if n.get('image_id')}})
        evidence['checks'].extend(['text_bm25_kimi_stream_tts_report','speech_asr_bm25_kimi_stream_tts_report','image_ocr_bm25_kimi_stream_tts_report'])
        profile=await call('POST','/evaluation-profiles',{'name':'实验：Kimi 答案证据评测','endpoint':'https://api.kimi.com/coding/v1','model':'k3',
            'credential_id':evaluation_credential['id'],'response_format':'json_schema','modalities':['Text','JSON'],'dimensions':[
                {'id':'grounded','name':'回答引用检索证据','method':'ai','threshold':.5,'actual':{'source':'output','field':'answer'},
                 'evidence':[{'source':'output','field':'evidence'}],'prompt':'Score 1 if the answer states the refund is within 14 days and cites the returns document. Otherwise score 0. Cite actual and evidence:0 when supported.'}]})
        first=evidence['runs'][0]['execution_id']
        evaluation=await call('POST','/executions/'+first+'/reevaluate?profile_id='+profile['id']+'&profile_version=1')
        await operation(evaluation['operation_id'])
        evaluated=await call('GET','/executions/'+first)
        scored=next(e for e in evaluated['evaluations'] if e['id']==evaluation['id'])
        check(scored['state']=='completed' and scored['result']['verdict']=='pass','Real Kimi evidence evaluation')
        evidence['evaluation']=scored['result'];evidence['checks'].append('real_kimi_structured_evaluation_of_grounded_answer')
        reports=await call('GET','/tasks/'+task['id']+'/reports');old=reports['items'][0]
        rerun=await call('POST','/executions/'+first+'/rerun')
        retry=await execution(rerun['id']);check(retry['state']=='succeeded','Real scenario rerun')
        after=await call('GET','/tasks/'+task['id']+'/reports')
        check(after['current']['plan_count']==3 and any(r['id']==old['id'] and r['snapshot']==old['snapshot'] for r in after['items']),'Immutable old report and stable denominator')
        evidence['checks'].append('new_instance_rerun_and_immutable_old_report')
        check(not json.loads(kube('get','pods','-l','testflow-runtime','-o','json'))['items'],'Experimental module Pods reclaimed')
        evidence['checks'].append('experimental_pods_reclaimed')
        evidence['resources']={'task':task['id'],'pipelines':{m:p['id'] for m,p in pipelines.items()},'datasets':{m:d['id'] for m,d in datasets.items()},
                              'modules':{m:v['id'] for m,v in modules.items()},'evaluation_profile':profile['id']}
        evidence['passed']=True
        (output/'tiny-scenario.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps({'namespace':args.namespace,'checks':evidence['checks'],'passed':True},ensure_ascii=False))

asyncio.run(main())

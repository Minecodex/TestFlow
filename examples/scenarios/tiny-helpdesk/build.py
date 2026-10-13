"""Build and package the tiny experimental modules with immutable source tags."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[3]
directory = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--build', action='store_true')
args = parser.parse_args()
field = lambda name, kind, stream=False: {'name':name,'type':kind,'stream':stream,
    'format':{'Text':'UTF-8','JSON':'application/json','Audio':'WAV · 16kHz · Mono','Image':'Image/*'}[kind]}
query, audio, image = field('query','Text'), field('audio','Audio'), field('image','Image')
context, evidence = field('context','JSON'), field('evidence','JSON')
answer = field('answer','Text')
specs = [
    ('tiny-retrieval','Tiny BM25 retrieval',[query],[query,context],{'top_k':{'type':'integer','minimum':1,'maximum':3}},{'top_k':2}),
    ('tiny-asr','Tiny English ASR',[audio],[query],{},{}),
    ('tiny-ocr','Tiny English OCR',[image],[query],{},{}),
    ('kimi-answer','Kimi grounded answer',[query,context],[field('answer','Text',True),evidence],
     {'credential_id':{'type':'string','minLength':1,'x-testflow-credential':True}}, {'credential_id':'configure-module-credential'}),
    ('tiny-tts','Tiny speech synthesis',[answer],[answer,audio],{'speed':{'type':'integer','minimum':100,'maximum':220}},{'speed':150}),
]
identity = hashlib.sha256()
for file in ['Dockerfile','prepare_models.py','service.py','processors.py','build.py']:
    identity.update((directory/file).read_bytes())
source = identity.hexdigest()[:12]
version = '1.0.0'
records = []
for identifier,name,inputs,outputs,properties,defaults in specs:
    path = directory/'packages'/identifier
    (path/'schemas').mkdir(parents=True,exist_ok=True)
    (path/'ui').mkdir(exist_ok=True)
    image_name = f'testflow/{identifier}:v{version}-{source}'
    manifest = {'protocol':'testflow.module.v1','id':identifier,'name':name,'version':version,
        'description':'Real small-model helpdesk experiment; English fixtures; not a quality benchmark',
        'exposes_trace':True,'defaults':defaults,
        'runtime':{'mode':'pod','image':image_name,'port':8080,'reuse_scope':'batch_node',
                   'requires_sequential':False,'cpu':'500m','memory':'384Mi'}}
    parameters={'$schema':'https://json-schema.org/draft/2020-12/schema','type':'object',
                'properties':properties,'required':list(properties),'additionalProperties':False}
    for file,value in [('manifest.json',manifest),('schemas/inputs.json',{'fields':inputs}),
                       ('schemas/outputs.json',{'fields':outputs}),('schemas/parameters.json',parameters)]:
        (path/file).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
    (path/'ui/config-panel.js').write_bytes((root/'examples/modules/common/ui.js').read_bytes())
    (path/'README.md').write_text(f'# {name}\n\nSmall real experimental module; see examples/scenarios/tiny-helpdesk/README.md.\n')
    archive = root/'.data/module-packages'/f'{identifier}-{version}.zip'
    subprocess.run(['uv','run','--project','server','python','scripts/module-package.py','package',str(path),'--output',str(archive)],cwd=root,check=True)
    if args.build:
        subprocess.run(['docker','build','--build-arg','MODULE='+identifier,'-t',image_name,str(directory)],check=True)
    records.append({'id':identifier,'image':image_name,'zip':str(archive.relative_to(root))})
destination=root/'.data/tiny-scenario-modules.json'
destination.write_text(json.dumps(records,indent=2)+'\n')
print(json.dumps(records,indent=2))

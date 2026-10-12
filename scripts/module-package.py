"""Validate and package immutable module contracts; build images explicitly."""
import argparse
import hashlib
import json
import subprocess
import zipfile
from pathlib import Path
from testflow.core.contracts import ModuleManifest
from testflow.features.modules.router import read_package

root=Path(__file__).resolve().parents[1]
def schema(fields):return {'fields':[{'name':name,'type':kind,'format':{'Text':'UTF-8','Audio':'WAV · 16kHz · Mono','Image':'Image/*','JSON':'application/json'}[kind],'stream':stream} for name,kind,stream in fields]}
def examples(version,build):
    specs=[('python-audio','audio-gain','Audio gain',[('audio','Audio',False)],[('audio','Audio',False),('summary','Text',False),('stats','JSON',False)],{'gain':{'type':'number','minimum':0,'maximum':5}},{'gain':1}),
    ('node-text','text-transform','Text transform',[('text','Text',True)],[('text','Text',True),('stats','JSON',False)],{'mode':{'type':'string','enum':['uppercase','lowercase','reverse','identity']},'chunk_size':{'type':'integer','minimum':1,'maximum':1000},'delay_ms':{'type':'integer','minimum':0,'maximum':10000}},{'mode':'uppercase','chunk_size':3,'delay_ms':0}),
    ('go-image','image-grayscale','Image grayscale',[('image','Image',False)],[('image','Image',False),('caption','Text',False),('stats','JSON',False)],{'max_width':{'type':'integer','minimum':1,'maximum':4096}},{'max_width':640})]
    outputs=[]
    for directory,identifier,name,inputs,outputs_fields,properties,defaults in specs:
        path=root/'examples/modules'/directory
        parameters={'$schema':'https://json-schema.org/draft/2020-12/schema','type':'object','properties':properties,'required':list(properties),'additionalProperties':False}
        identity=hashlib.sha256()
        for filename in ['Dockerfile','module.py','server.mjs','main.go','package.json','package-lock.json','go.mod','go.sum']:
            if (path/filename).exists():identity.update((path/filename).read_bytes())
        identity.update(json.dumps([version,inputs,outputs_fields,parameters,defaults],sort_keys=True).encode())
        image=f'testflow/{directory}:v{version}-{identity.hexdigest()[:12]}'
        manifest={'protocol':'testflow.module.v1','id':identifier,'name':name,'version':version,'description':'Real cross-language example module','exposes_trace':True,'defaults':defaults,'runtime':{'mode':'pod','image':image,'port':8080,'reuse_scope':'batch_node','requires_sequential':False}}
        manifest=ModuleManifest.model_validate(manifest).model_dump(mode='json')
        (path/'schemas').mkdir(exist_ok=True)
        (path/'ui').mkdir(exist_ok=True)
        for filename,value in [('manifest.json',manifest),('schemas/inputs.json',schema(inputs)),('schemas/outputs.json',schema(outputs_fields)),('schemas/parameters.json',parameters)]:
            (path/filename).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
        (path/'ui/config-panel.js').write_bytes((root/'examples/modules/common/ui.js').read_bytes())
        (path/'README.md').write_text(f'# {name}\n\nReal {directory} container module. Pod only; image ENTRYPOINT starts the service.\n')
        archive=package(path,root/'.data/module-packages'/f'{identifier}-{version}.zip')
        if build:subprocess.run(['docker','build','-t',image,str(path)],check=True)
        outputs.append({'id':identifier,'image':image,'zip':str(archive.relative_to(root))})
    destination=root/'.data/example-modules.json';destination.parent.mkdir(parents=True,exist_ok=True);destination.write_text(json.dumps(outputs,indent=2)+'\n');print(json.dumps(outputs,indent=2))

def package(directory,output):
    manifest=ModuleManifest.model_validate_json((directory/'manifest.json').read_bytes())
    output.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(['manifest.json',manifest.inputs,manifest.outputs,manifest.parameters,manifest.ui,'README.md']):
            entry=zipfile.ZipInfo(name, date_time=(2026,1,1,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED;entry.external_attr=0o100644 << 16
            archive.writestr(entry,(directory/name).read_bytes())
    read_package(output.read_bytes(),100*1024*1024)
    return output

parser=argparse.ArgumentParser();sub=parser.add_subparsers(dest='command',required=True)
example=sub.add_parser('examples');example.add_argument('--version',default='1.0.0');example.add_argument('--build',action='store_true')
pack=sub.add_parser('package');pack.add_argument('directory',type=Path);pack.add_argument('--output',required=True,type=Path)
args=parser.parse_args()
if args.command=='examples':examples(args.version,args.build)
else:print(package(args.directory.resolve(),args.output.resolve()))

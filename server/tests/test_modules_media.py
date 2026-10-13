import io
import json
import zipfile
from pathlib import Path
from uuid import uuid4

from testflow.features.modules.router import finish_import, read_package

ROOT=Path(__file__).resolve().parents[2]

def archive(manifest=None,defaults=None,unsafe=False,parameters=None):
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w') as file:
        data={'protocol':'testflow.module.v1','id':'test-module','version':'1.0.0','name':'Test','defaults':defaults or {},'runtime':{'mode':'pod','image':'testflow/test:v1'}}
        data.update(manifest or {})
        file.writestr('manifest.json',json.dumps(data))
        schema={'fields':[{'name':'text','type':'Text','format':'UTF-8','stream':False}]}
        file.writestr('schemas/inputs.json',json.dumps(schema));file.writestr('schemas/outputs.json',json.dumps(schema))
        file.writestr('schemas/parameters.json',json.dumps(parameters if parameters is not None else {'type':'object','properties':{'count':{'type':'integer'}},'additionalProperties':False}))
        file.writestr('ui/config-panel.js','export const sdk="testflow.ui.v1"; export default function() {return null;}')
        file.writestr('README.md','# Test')
        if unsafe:file.writestr('../escape','not allowed')
    return out.getvalue()

async def test_import_is_durable_and_semver_identity_immutable(app_client):
    app,c=app_client
    content=archive()
    first=await c.post('/api/v1/modules/import',files={'file':('module.zip',content)},headers={'Idempotency-Key':'import'})
    assert first.status_code==200,first.text
    item=first.json();assert item['operation_id']
    operation=(await c.get('/api/v1/operations/'+item['operation_id'])).json();assert operation['state']=='queued'
    assert (await c.post('/api/v1/modules/'+item['id']+'/validate',headers={'Idempotency-Key':'validate'})).status_code==409
    await app.state.scheduler.handle(operation['id'],operation['kind'],operation['payload'])
    assert (await c.get('/api/v1/modules/'+item['id']+'/files/ui/config-panel.js?version=1')).status_code==200
    second=await c.post('/api/v1/modules/import',files={'file':('module.zip',content)},headers={'Idempotency-Key':'same-bytes'})
    assert second.json()['id']==item['id']
    conflict=await c.post('/api/v1/modules/import',files={'file':('module.zip',archive({'name':'Changed'}))},headers={'Idempotency-Key':'conflict'})
    assert conflict.status_code==409
    next_version=await c.post('/api/v1/modules/import',files={'file':('module.zip',archive({'version':'1.0.1'}))},headers={'Idempotency-Key':'new-version'})
    assert next_version.json()['version']==2
    historic_conflict=await c.post('/api/v1/modules/import',files={'file':('module.zip',archive({'name':'Historic changed'}))},headers={'Idempotency-Key':'historic'})
    assert historic_conflict.status_code==409

async def test_bad_package_defaults_and_paths_are_field_errors(app_client):
    app,c=app_client
    for content in [archive(defaults={'count':'invalid'}),archive(unsafe=True)]:
        response=await c.post('/api/v1/modules/import',files={'file':('module.zip',content)},headers={'Idempotency-Key':str(uuid4())})
        assert response.status_code==422 and response.json()['code']=='invalid_package'

async def test_parameter_schema_has_one_dialect_and_no_remote_dynamic_refs(app_client):
    app,c=app_client
    valid={'$schema':'https://json-schema.org/draft/2020-12/schema','type':'object','$defs':{'count':{'type':'integer'}},'properties':{'count':{'$ref':'#/$defs/count'}}}
    assert read_package(archive(parameters=valid,defaults={'count':1}),100000)['parameters']==valid
    invalid=[{**valid,'$schema':'http://json-schema.org/draft-07/schema#'},
             {'type':'object','$dynamicRef':'https://example.invalid/mutable-schema'},
             {'type':'object','$ref':123}]
    for parameters in invalid:
        result=await c.post('/api/v1/modules/import',files={'file':('module.zip',archive(parameters=parameters))},headers={'Idempotency-Key':str(uuid4())})
        assert result.status_code==422 and result.json()['code']=='invalid_package'

async def test_hidden_historical_media_range_and_asset_type_filter(app_client):
    app,c=app_client
    upload=await c.post('/api/v1/media/upload',files=[('files',('text.txt',b'abcdefghijklmnopqrstuvwxyz','text/plain')),('files',('invalid.bin',b'x','application/octet-stream'))])
    assert upload.status_code==200
    item=upload.json()['items'][0]['resource'];assert upload.json()['items'][1]['error']
    await c.post('/api/v1/assets/'+item['id']+'/hide')
    ranged=await c.get('/api/v1/media/'+item['id']+'?version=1',headers={'Range':'bytes=2-4'})
    assert ranged.status_code==206 and ranged.content==b'cde'
    assert (await c.get('/api/v1/assets?type=Audio')).json()['total']==0
    assert (await c.get('/api/v1/assets?type=Text&hidden=true')).json()['total']==1
    forged=await c.post('/api/v1/assets',json={'name':'forged','type':'Image','blob':'repositories/private'})
    assert forged.status_code==422

async def test_invocation_credential_scope_and_evidence_redaction(app_client):
    from testflow.infrastructure.models import Execution, Runtime
    from testflow.infrastructure.redaction import redact
    app,c=app_client
    credential=(await c.post('/api/v1/credentials',json={'name':'Scoped','kind':'module','value':'fixture-module-secret'})).json()
    outside=(await c.post('/api/v1/credentials',json={'name':'Other','kind':'evaluation','value':'fixture-outside-secret'})).json()
    token='fixture-runtime-token'
    async with app.state.database.sessions() as db,db.begin():
        runtime=Runtime(key='key',batch_id='batch',pod_name='test',state='ready',snapshot={},token=app.state.pods.encrypted(token))
        db.add(runtime);await db.flush()
        node={'id':'one','parameters':{'credential':credential['id']},'module_snapshot':{'data':{'parameters':{'type':'object','properties':{'credential':{'type':'string','x-testflow-credential':True}}}}}}
        ex=Execution(batch_id='batch',name='Scope',snapshot={'pipeline':{'graph':{'nodes':[node]}}},nodes={'one':{'runtime_id':runtime.id}},state='running')
        db.add(ex);await db.flush();runtime_id,identifier=runtime.id,ex.id
    prefix=f'/api/v1/module-resources/{runtime_id}/credentials/'
    headers={'Authorization':'Bearer '+token}
    permitted=await c.get(prefix+credential['id']+'?execution_id='+identifier,headers=headers)
    assert permitted.status_code==200 and permitted.json()['value']=='fixture-module-secret'
    denied=await c.get(prefix+outside['id']+'?execution_id='+identifier,headers=headers)
    assert denied.status_code==403 and 'fixture-outside-secret' not in denied.text
    safe=redact({'message':'Bearer fixture-module-secret'},app.state.secret_values[identifier])
    assert safe['message']=='Bearer [redacted]'
    async with app.state.database.sessions() as db,db.begin():(await db.get(Execution,identifier)).cleanup='stopped'
    assert (await c.get(prefix+credential['id']+'?execution_id='+identifier,headers=headers)).status_code==403

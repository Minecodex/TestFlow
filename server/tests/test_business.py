from sqlalchemy import select
from testflow.infrastructure.models import Credential, Revision
from testflow.core.contracts import ModuleManifest
from testflow.features.pipelines.service import validate_graph
from testflow.execution.transport.channels import FieldChannel
from testflow.infrastructure.operations import idempotent
from testflow.infrastructure.revisions import get_resource

TEXT={'fields':[{'name':'text','type':'Text','format':'UTF-8','stream':False}]}

def dataset(name='Dataset'):
    return {'name':name,'input_schema':TEXT,'cases':[{'id':'one','name':'One','inputs':{'text':{'value':'hello'}}}]}

def graph():
    return {'name':'Identity','input_schema':TEXT,'output_schema':TEXT,'preparation_timeout':60,'cleanup_timeout':10,'nodes':[
        {'id':'start','kind':'start','name':'Start','output_schema':TEXT},
        {'id':'end','kind':'end','name':'End','input_schema':TEXT,'output_schema':TEXT}], 'edges':[{'source':'start','target':'end'}]}

async def test_auth_encryption_and_versions(app_client):
    app,c=app_client
    credential=await c.post('/api/v1/credentials',json={'name':'Provider','kind':'evaluation','value':'secret-that-must-not-leak'})
    assert credential.status_code==200 and 'secret-that' not in credential.text
    async with app.state.database.sessions() as db:
        row=await db.get(Credential,credential.json()['id']);assert 'secret-that' not in row.encrypted
    created=await c.post('/api/v1/datasets',json=dataset());assert created.status_code==200,created.text
    root=created.json();changed=dataset('Changed')
    updated=await c.put('/api/v1/datasets/'+root['id'],json={'expected_version':1,'data':changed});assert updated.status_code==200
    conflict=await c.put('/api/v1/datasets/'+root['id'],json={'expected_version':1,'data':dataset('Lost')});assert conflict.status_code==409
    old=await c.get('/api/v1/datasets/'+root['id']+'?version=1');assert old.json()['data']['name']=='Dataset'
    await c.post('/api/v1/datasets/'+root['id']+'/hide')
    assert (await c.get('/api/v1/datasets')).json()['total']==0
    assert (await c.get('/api/v1/datasets/'+root['id']+'?version=1')).status_code==200
    await c.post('/api/v1/auth/logout')
    assert (await c.get('/api/v1/datasets')).status_code==401

async def test_frozen_plan_execution_and_reports(app_client):
    app,c=app_client
    d=(await c.post('/api/v1/datasets',json=dataset())).json()
    g=graph();p=(await c.post('/api/v1/pipelines',json=g)).json();assert 'id' in p,p
    profile=(await c.post('/api/v1/evaluation-profiles',json={'name':'Completion','dimensions':[{'id':'complete','name':'Complete','method':'completion','actual':{'source':'execution','field':'state'}}]})).json()
    body={'name':'Task','pairs':[{'dataset_id':d['id'],'dataset_version':1,'pipeline_id':p['id'],'pipeline_version':1}],'profile_id':profile['id'],'profile_version':1}
    submitted=await c.post('/api/v1/tasks',json=body,headers={'Idempotency-Key':'one'});assert submitted.status_code==200,submitted.text
    assert (await c.post('/api/v1/tasks',json=body,headers={'Idempotency-Key':'one'})).json()['id']==submitted.json()['id']
    body['name']='Different'
    assert (await c.post('/api/v1/tasks',json=body,headers={'Idempotency-Key':'one'})).status_code==409
    changed=dataset('Later');changed['cases'][0]['inputs']['text']['value']='changed'
    assert (await c.put('/api/v1/datasets/'+d['id'],json={'expected_version':1,'data':changed})).status_code==200
    await app.state.scheduler.run_task(submitted.json()['id'])
    report=(await c.get('/api/v1/tasks/'+submitted.json()['id']+'/reports')).json()
    assert report['current']['plan_count']==1 and report['current']['passed']==1,report
    original=report['items'][0]['snapshot']
    ex_id=original['rows'][0]['execution_id']
    ex=(await c.get('/api/v1/executions/'+ex_id)).json()
    assert ex['output']=={'text':'hello'} and ex['cleanup']=='stopped'
    rerun=(await c.post('/api/v1/executions/'+ex_id+'/rerun',headers={'Idempotency-Key':'retry'})).json()
    await app.state.scheduler.run_execution(rerun['id'])
    reports=(await c.get('/api/v1/tasks/'+submitted.json()['id']+'/reports')).json()
    assert reports['current']['plan_count']==1 and reports['current']['rows'][0]['execution_id']==rerun['id']
    assert reports['items'][-1]['snapshot']==original
    assert len((await c.get('/api/v1/executions')).json()['items'])==2

async def test_stream_fanout_integrity():
    field=FieldChannel({'name':'text','type':'Text','format':'UTF-8','stream':True})
    async def collect(): return [v['data'] async for v in field.read()]
    import asyncio
    a,b=asyncio.create_task(collect()),asyncio.create_task(collect())
    await field.put('chunk',{'seq':0,'format':'UTF-8','data':'a'})
    try: await field.put('chunk',{'seq':2,'format':'UTF-8','data':'gap'})
    except ValueError: pass
    else: assert False,'Gap accepted'
    await field.put('chunk',{'seq':1,'format':'UTF-8','data':'b'})
    assert not field.complete.is_set()
    await field.put('eos',{'seq':2})
    assert await a==await b==['a','b']
    assert field.snapshot()['text']=='ab' and field.snapshot()['eos']

async def test_graph_groups_and_empty_reference_verdict(app_client):
    app,c=app_client
    g=graph();assert validate_graph(g)==[]
    g['nodes'][1]['input_schema']={'fields':[{**TEXT['fields'][0],'name':'other'}]}
    assert any('Complete groups' in e['message'] for e in validate_graph(g))
    assert (await c.post('/api/v1/modules/manifest/validate',json={'protocol':'testflow.module.v1','id':'bad','name':'Bad','version':'1.0.0','runtime':{'mode':'local','image':'test:v1'}})).status_code==422

"""Terminal, queue and evidence boundaries; protocol fixtures are test-only."""
import asyncio
from copy import deepcopy
from uuid import uuid4

from sqlalchemy import select

from testflow.core.contracts import PipelineBody
from testflow.execution.engine import DAGRun
from testflow.execution.transport.channels import FieldChannel
from testflow.infrastructure.models import Evaluation, Event, Execution, Operation, PlanItem, Task
from testflow.infrastructure.revisions import get_resource
from test_business import TEXT, dataset, graph

async def setup(app_client, dimensions=None, cases=None, concurrency=1):
    app,c=app_client
    payload=dataset()
    if cases:payload['cases']=cases
    d=(await c.post('/api/v1/datasets',json=payload)).json()
    p=(await c.post('/api/v1/pipelines',json=graph())).json()
    profile=(await c.post('/api/v1/evaluation-profiles',json={'name':'Rules','dimensions':dimensions or [{'id':'complete','name':'Complete','method':'completion','actual':{'source':'execution','field':'state'}}]})).json()
    task=(await c.post('/api/v1/tasks',json={'name':'Boundaries','pairs':[{'dataset_id':d['id'],'dataset_version':1,'pipeline_id':p['id'],'pipeline_version':1}],'profile_id':profile['id'],'profile_version':1,'concurrency':concurrency},headers={'Idempotency-Key':str(uuid4())})).json()
    return app,c,task,p,profile

async def test_queued_cancel_is_terminal_and_durable(app_client):
    app,c,task,_,_=await setup(app_client)
    result=await c.post('/api/v1/tasks/'+task['id']+'/cancel')
    assert result.json()['state']=='canceled'
    await app.state.scheduler.run_task(task['id'])
    actual=(await c.get('/api/v1/tasks/'+task['id'])).json()
    assert actual['state']=='canceled' and actual['report']['plan_count']==1
    assert actual['report']['rows'][0]['plan_state']=='canceled'
    assert (await c.get('/api/v1/executions')).json()['total']==0

async def test_quick_reruns_keep_lineage_and_current_filter(app_client):
    app,c,task,p,profile=await setup(app_client)
    quick=(await c.post('/api/v1/executions/quick',json={'pipeline_id':p['id'],'pipeline_version':1,'profile_id':profile['id'],'profile_version':1,'inputs':{'text':{'value':'hello'}}},headers={'Idempotency-Key':'quick'})).json()
    await app.state.scheduler.run_execution(quick['id'])
    retry=(await c.post('/api/v1/executions/'+quick['id']+'/rerun',headers={'Idempotency-Key':'rerun'})).json()
    await app.state.scheduler.run_execution(retry['id'])
    assert retry['root_id']==quick['root_id'] and retry['attempt']==2
    detail=(await c.get('/api/v1/executions/'+quick['id'])).json()
    assert [r['attempt'] for r in detail['attempts']]==[2,1]
    listed=(await c.get('/api/v1/executions?all_attempts=false')).json()
    assert listed['total']==1 and listed['items'][0]['id']==retry['id']

async def test_first_terminal_and_late_events_remain_immutable(app_client):
    app,c,task,_,_=await setup(app_client)
    async with app.state.database.sessions() as db,db.begin():
        item=await db.scalar(select(PlanItem).where(PlanItem.task_id==task['id']))
        ex=Execution(item_id=item.id,task_id=task['id'],batch_id=task['id'],name='Race',snapshot=item.snapshot)
        db.add(ex);await db.flush()
    run=DAGRun(app,ex)
    await run.groups['end']['text'].put('value',{'value':'complete'})
    assert await run.terminal('succeeded',winner='end')
    assert not await run.terminal('failed',error={'code':'late_error'})
    assert not await run.terminal('canceled')
    await run.event('module.late_error',{'message':'Late evidence'})
    detail=(await c.get('/api/v1/executions/'+ex.id)).json()
    assert detail['state']=='succeeded' and detail['output']=={'text':'complete'}
    assert any(e['kind']=='module.late_error' for e in detail['events'])
    assert sum(e['kind']=='execution.succeeded' for e in detail['events'])==1

async def test_recovery_preserves_terminal_and_resumes_pending_only(app_client):
    app,c,task,_,_=await setup(app_client)
    async with app.state.database.sessions() as db,db.begin():
        item=await db.scalar(select(PlanItem).where(PlanItem.task_id==task['id']))
        item.state='running';t=await db.get(Task,task['id']);t.state='running'
        ex=Execution(item_id=item.id,task_id=task['id'],batch_id=task['id'],name='Interrupted',snapshot=item.snapshot,state='running',cleanup='pending')
        db.add(ex);await db.flush();identifier=ex.id
    await app.state.scheduler.recover()
    async with app.state.database.sessions() as db:
        ex=await db.get(Execution,identifier);assert ex.state=='failed' and ex.error['code']=='interrupted'
        item=await db.get(PlanItem,ex.item_id);assert item.state=='completed'
    await app.state.scheduler.run_task(task['id'])
    assert (await c.get('/api/v1/executions')).json()['total']==1

async def test_score_error_does_not_revert_or_reduce_coverage(app_client):
    app,c,task,_,_=await setup(app_client)
    await app.state.scheduler.run_task(task['id'])
    report=(await c.get('/api/v1/tasks/'+task['id'])).json()['report'];identifier=report['rows'][0]['execution_id']
    async with app.state.database.sessions() as db,db.begin():
        ex=await db.get(Execution,identifier)
        db.add(Evaluation(execution_id=identifier,profile=ex.snapshot['profile'],state='error',result={'verdict':'error','dimensions':[]},error={'code':'interrupted'}))
    current=(await c.get('/api/v1/tasks/'+task['id'])).json()['report']
    assert current['rows'][0]['verdict']=='error' and current['passed']==0
    assert current['quality']['expected']==1 and current['quality']['valid']==0 and current['quality']['coverage']==0

async def test_no_required_dimensions_cannot_pass(app_client):
    app,c,task,_,_=await setup(app_client,[{'id':'optional','name':'Optional','method':'completion','required':False,'actual':{'source':'execution','field':'state'}}])
    await app.state.scheduler.run_task(task['id'])
    report=(await c.get('/api/v1/tasks/'+task['id'])).json()['report']
    assert report['rows'][0]['verdict']=='unscored' and report['passed']==0

async def test_invalid_media_sequences_and_missing_eos():
    f=FieldChannel({'name':'audio','type':'Audio','format':'WAV · 16kHz · Mono','stream':True})
    try:await f.put('chunk',{'seq':0,'format':f.spec['format'],'encoding':'base64','data':'not-base64%'})
    except ValueError:pass
    else:assert False,'Invalid media accepted'
    await f.put('chunk',{'seq':0,'format':f.spec['format'],'encoding':'base64','data':'YQ=='})
    await f.abort('disconnected')
    try:await f.ended()
    except RuntimeError:pass
    else:assert False,'Truncated stream accepted'

async def test_terminal_acceptance_order_survives_database_outage(app_client):
    from sqlalchemy.exc import OperationalError
    app,c,task,_,_=await setup(app_client)
    async with app.state.database.sessions() as db,db.begin():
        item=await db.scalar(select(PlanItem).where(PlanItem.task_id==task['id']))
        ex=Execution(item_id=item.id,task_id=task['id'],batch_id=task['id'],name='Database outage race',snapshot=item.snapshot)
        db.add(ex);await db.flush()
    run=DAGRun(app,ex);await run.groups['end']['text'].put('value',{'value':'complete'})
    original=app.state.database.sessions;first=True;attempted=asyncio.Event()
    def sessions():
        nonlocal first
        if first:
            first=False;attempted.set();raise OperationalError('connection',{},ConnectionRefusedError(),connection_invalidated=True)
        return original()
    app.state.database.sessions=sessions
    try:
        winning=asyncio.create_task(run.terminal('succeeded',winner='end'))
        await attempted.wait()
        losing=asyncio.create_task(run.terminal('failed',error={'code':'later_error'}))
        assert await winning and not await losing
    finally:app.state.database.sessions=original
    detail=(await c.get('/api/v1/executions/'+ex.id)).json()
    assert detail['state']=='succeeded' and detail['output']=={'text':'complete'} and run.done.is_set()

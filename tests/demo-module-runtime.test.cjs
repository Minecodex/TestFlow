const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDemo } = require('./demo-test-helpers.cjs');

test('all modules are Pod-only and keep implementation decisions inside code', () => {
  const {state,moduleRuntimeErrors}=loadDemo();
  for(const module of state.modules){
    assert.equal(module.runtime.launch,'pod');
    assert.equal(moduleRuntimeErrors(module).length,0,module.name);
    for(const key of ['local','docker','language','entry','command','source','endpoint','externalProtocol']) assert.equal(Object.hasOwn(module.runtime,key),false,key);
  }
  assert.match(moduleRuntimeErrors(state.modules[0],{launch:'local'}).join(' '),/Kubernetes Pod/);
});

test('Pod image is required without a platform launch command',()=>{
  const {state,moduleRuntimeErrors}=loadDemo();
  const runtime={launch:'pod',pod:{image:'example/module:immutable',repoId:''}};
  assert.equal(moduleRuntimeErrors(state.modules[0],runtime).length,0);
  runtime.pod.image='';assert.match(moduleRuntimeErrors(state.modules[0],runtime).join(' '),/镜像引用/);
});

test('repository mounts validate availability, pinned revision and absolute destination',()=>{
  const {state,moduleRuntimeErrors}=loadDemo();
  const runtime={launch:'pod',pod:{image:'example/adapter:1',repoId:'ai',mountPath:'/workspace/code'}};
  assert.equal(moduleRuntimeErrors(state.modules[0],runtime,'a7c2d91').length,0);
  assert.match(moduleRuntimeErrors(state.modules[0],runtime,'missing').join(' '),/代码版本不可用/);
  runtime.pod.mountPath='relative/path';assert.match(moduleRuntimeErrors(state.modules[0],runtime).join(' '),/绝对路径/);
  runtime.pod.mountPath='/workspace/code';state.repos[0].status='syncing';assert.match(moduleRuntimeErrors(state.modules[0],runtime).join(' '),/已同步/);
  runtime.pod.repoId='';assert.equal(moduleRuntimeErrors(state.modules[0],runtime).length,0);
});

test('snapshots freeze Pod image, optional code mount and parameters',()=>{
  const {state,flowSnapshot}=loadDemo();const flow=state.flows.find(f=>f.id==='flow-multi');
  const live=flow.nodes.find(n=>n.id==='asr');live.runtime={launch:'pod',pod:{image:'example/locked:1',repoId:'ai',mountPath:'/workspace/code',reuseScope:'batch_node'}};live.commitBinding='92be461';live.params.customConfig={value:'owned'};
  const snapshot=flowSnapshot(flow),node=snapshot.nodes.find(n=>n.id==='asr');
  assert.equal(node.runtime.pod.mountPath,'/workspace/code');assert.equal(node.repositorySnapshot.commit,'92be461');assert.equal(node.params.customConfig.value,'owned');
  live.runtime.pod.image='example/changed:1';live.runtime.pod.mountPath='/changed';live.params.customConfig.value='changed';
  assert.equal(node.runtime.pod.image,'example/locked:1');assert.equal(node.runtime.pod.mountPath,'/workspace/code');assert.equal(node.params.customConfig.value,'owned');
  assert.equal(Object.hasOwn(node,'serviceSnapshot'),false);
  for(const n of snapshot.nodes.filter(n=>n.moduleId))assert.equal(n.runtime.launch,'pod');
});

test('Pod launch preserves full group contracts and sequential restrictions',()=>{
  const {state,clone,validateFlow,buildTask}=loadDemo();
  for(const flow of state.flows)assert.equal(validateFlow(flow).length,0,flow.name);
  const task=buildTask('Sequential',[{datasetId:'ds-audio',flowId:'flow-state'}],state.profiles[0],3);assert.equal(task.requestedConcurrency,3);assert.equal(task.effectiveConcurrency,1);
  const broken=clone(state.flows[0]);broken.nodes.find(n=>n.id==='asr').runtime.pod.image='';assert.match(validateFlow(broken).join(' '),/镜像引用/);
});

test('simulated Pod modules finish only after normal EOS',async()=>{
  const {state,buildTask,makeExecution,runExecution}=loadDemo();const task=buildTask('Pod test',[{datasetId:'ds-audio',flowId:'flow-race'}],state.profiles[1],1);const ex=makeExecution(task,task.plan[0]);await runExecution(ex);
  assert.equal(ex.status,'succeeded');assert.equal(ex.output.speech.eos,true);
  assert.ok(ex.events.some(e=>e.type==='module.ready'&&/HTTP.*WebSocket/.test(e.text)));
  assert.ok(ex.events.findIndex(e=>e.type==='stream.eos')<ex.events.findIndex(e=>e.type==='execution.succeeded'));
});

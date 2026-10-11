const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDemo } = require('./demo-test-helpers.cjs');

test('Docker requires an image and does not require local language or entry', () => {
  const { state, moduleRuntimeErrors } = loadDemo();
  const m = state.modules.find(m => m.id === 'asr');
  const runtime = { launch: 'docker', docker: { image: 'example/adapter:1', repoId: '' } };
  assert.equal(moduleRuntimeErrors(m, runtime).length, 0);
  runtime.docker.image = '';
  assert.match(moduleRuntimeErrors(m, runtime).join(' '), /镜像引用/);
  for (const module of state.modules) {
    for (const key of ['source', 'endpoint', 'externalProtocol', 'serviceVersion']) {
      assert.equal(Object.hasOwn(module.runtime, key), false, key);
    }
  }
});

test('Docker repository mounts validate availability, pinned revision and absolute destination', () => {
  const { state, moduleRuntimeErrors } = loadDemo();
  const m = state.modules[0];
  const runtime = { launch: 'docker', docker: { image: 'example/adapter:1', repoId: 'ai', mountPath: '/workspace/code' } };
  assert.equal(moduleRuntimeErrors(m, runtime, 'a7c2d91').length, 0);
  assert.match(moduleRuntimeErrors(m, runtime, 'missing').join(' '), /代码版本不可用/);
  runtime.docker.mountPath = 'relative/path';
  assert.match(moduleRuntimeErrors(m, runtime).join(' '), /绝对路径/);
  runtime.docker.mountPath = '/workspace/code';
  state.repos[0].status = 'syncing';
  assert.match(moduleRuntimeErrors(m, runtime).join(' '), /已同步/);
  runtime.docker.repoId = '';
  assert.equal(moduleRuntimeErrors(m, runtime).length, 0);
});

test('local runtime requires language and entry and supports arbitrary custom languages', () => {
  const { state, clone, moduleRuntimeErrors } = loadDemo();
  const m = clone(state.modules[0]);
  m.runtime.local.language = 'Python';
  m.runtime.local.entry = 'adapter/server.py';
  assert.equal(moduleRuntimeErrors(m).length, 0);
  m.runtime.local.entry = '';
  assert.match(moduleRuntimeErrors(m).join(' '), /运行入口/);
  m.runtime.local.entry = 'adapter/server.exs';
  m.runtime.local.language = 'Elixir';
  m.runtime.local.command = '';
  assert.match(moduleRuntimeErrors(m).join(' '), /自定义语言/);
  m.runtime.local.command = 'elixir adapter/server.exs';
  assert.equal(moduleRuntimeErrors(m).length, 0);
  m.runtime.local.language = '';
  assert.match(moduleRuntimeErrors(m).join(' '), /后端语言/);
});

test('snapshots retain only active launch settings and freeze code mount plus module parameters', () => {
  const { state, flowSnapshot } = loadDemo();
  const flow = state.flows.find(f => f.id === 'flow-multi');
  const live = flow.nodes.find(n => n.id === 'asr');
  live.runtime.launch = 'docker';
  live.runtime.docker = { image: 'example/adapter:locked', repoId: 'ai', mountPath: '/workspace/code' };
  live.commitBinding = '92be461';
  live.params.customConfig = { value: 'module-owned' };
  const snapshot = flowSnapshot(flow);
  const node = snapshot.nodes.find(n => n.id === 'asr');
  assert.equal(Object.hasOwn(node.runtime, 'local'), false);
  assert.equal(Object.hasOwn(node.moduleSnapshot.runtime, 'local'), false);
  assert.equal(node.runtime.docker.mountPath, '/workspace/code');
  assert.equal(node.repositorySnapshot.commit, '92be461');
  assert.equal(node.params.customConfig.value, 'module-owned');
  assert.equal(Object.hasOwn(node, 'serviceSnapshot'), false);
  live.runtime.docker.image = 'example/adapter:changed';
  live.runtime.docker.mountPath = '/changed';
  live.params.customConfig.value = 'changed';
  state.repos[0].commit = 'changed';
  assert.equal(node.runtime.docker.image, 'example/adapter:locked');
  assert.equal(node.runtime.docker.mountPath, '/workspace/code');
  assert.equal(node.params.customConfig.value, 'module-owned');
  assert.equal(node.repositorySnapshot.commit, '92be461');
  const native = snapshot.nodes.find(n => n.id === 'vision');
  assert.equal(Object.hasOwn(native.runtime, 'docker'), false);
  assert.equal(native.runtime.local.command, 'java -jar adapter/vision-adapter.jar');
});

test('startup changes preserve DAG contracts and sequential concurrency restrictions', () => {
  const { state, clone, validateFlow, buildTask } = loadDemo();
  for (const flow of state.flows) {
    const schemas = JSON.stringify(flow.nodes.map(n => [n.input, n.output]));
    for (const node of flow.nodes.filter(n => n.moduleId)) {
      node.runtime.launch = node.runtime.launch === 'local' ? 'docker' : 'local';
    }
    assert.equal(validateFlow(flow).length, 0, flow.name);
    assert.equal(JSON.stringify(flow.nodes.map(n => [n.input, n.output])), schemas);
  }
  const task = buildTask('Sequential', [{ datasetId: 'ds-audio', flowId: 'flow-state' }], state.profiles[0], 3);
  assert.equal(task.requestedConcurrency, 3);
  assert.equal(task.effectiveConcurrency, 1);
  const broken = clone(state.flows[0]);
  broken.nodes.find(n => n.id === 'asr').runtime.docker.image = '';
  broken.nodes.find(n => n.id === 'asr').runtime.launch = 'docker';
  assert.match(validateFlow(broken).join(' '), /镜像引用/);
});

test('simulated native and Docker modules use the same contract and finish after stream EOS', async () => {
  const { state, buildTask, makeExecution, runExecution } = loadDemo();
  const task = buildTask('Runtime test', [{ datasetId: 'ds-audio', flowId: 'flow-race' }], state.profiles[1], 1);
  const ex = makeExecution(task, task.plan[0]);
  await runExecution(ex);
  assert.equal(ex.status, 'succeeded');
  assert.equal(ex.output.speech.eos, true);
  assert.ok(ex.events.some(e => e.type === 'module.ready' && /HTTP.*WebSocket/.test(e.text)));
  assert.ok(ex.events.some(e => e.type === 'module.request' && /统一模块契约/.test(e.text)));
  assert.equal(ex.events.some(e => e.text.includes('undefined')), false);
  assert.ok(ex.events.findIndex(e => e.type === 'stream.eos') < ex.events.findIndex(e => e.type === 'execution.succeeded'));
});

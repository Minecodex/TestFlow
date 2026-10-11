const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDemo } = require('./demo-test-helpers.cjs');
const pair = { datasetId: 'ds-audio', flowId: 'flow-race' };

test('all nine seeded pages and reports render without undefined data access', () => {
  const d = loadDemo();
  for (const [route, render] of Object.entries(d.pageRenderers)) {
    assert.equal(typeof render(), 'string', route);
  }
  d.state.view.taskId = d.state.tasks[0].id;
  assert.match(d.pageRenderers.tasks(), /案例执行列表/);
  d.state.view.executionId = d.state.executions[0].id;
  for (const tab of ['trace', 'io', 'scoring', 'snapshot', 'events', 'history']) {
    d.state.view.executionTab = tab;
    assert.equal(typeof d.pageRenderers.executions(), 'string', tab);
  }
});

test('all queued inputs, references, parameters and revisions freeze at plan creation', () => {
  const d = loadDemo(), { state } = d;
  const t = d.buildTask('Frozen queue', [pair], state.profiles[0], 1);
  const plan = t.plan[4], original = JSON.stringify(plan.inputSnapshot);
  const asset = state.assets.find(a => a.id === plan.case.inputs.audio);
  asset.name = 'Changed after freeze'; asset.transcript = 'Changed'; asset.url = 'changed';
  state.datasets[0].cases[4].reference = 'Changed reference';
  state.flows[0].nodes[1].params.beam_size = 19;
  const ex = d.makeExecution(t, plan);
  assert.equal(JSON.stringify(ex.inputSnapshot), original);
  assert.notEqual(ex.caseSnapshot.reference, 'Changed reference');
  assert.notEqual(ex.flowSnapshot.nodes[1].params.beam_size, 19);
  ex.inputSnapshot.audio.name = 'Attempt-only mutation';
  assert.equal(JSON.stringify(plan.inputSnapshot), original);
});

test('invalid/missing asset bindings, changed schemas and empty task constraints are rejected', () => {
  const d = loadDemo(), { state } = d, ds = state.datasets[0];
  ds.cases[0].inputs.audio = 'missing';
  assert.throws(() => d.buildTask('Bad', [pair], state.profiles[0], 1), /缺少必需输入/);
  ds.cases[0].inputs.audio = 'image-1';
  assert.ok(d.pairErrors(ds, state.flows[0]).some(e => /素材类型或格式/.test(e)));
  for (const n of [0, -1, 1.5, NaN]) assert.throws(() => d.buildTask('Bad', [pair], state.profiles[0], n), /正整数/);
  assert.throws(() => d.buildTask('Bad', [], state.profiles[0], 1), /配对/);
  assert.throws(() => d.buildTask('Bad', [pair], state.profiles[0], 1, 6), /1–5/);
});

test('reruns preserve finished report results and plan denominator while showing activity', () => {
  const d = loadDemo(), t = d.state.tasks[0], plan = t.plan[0], old = d.latestAttempt(t, plan);
  const ex = d.makeExecution(t, plan);
  const counts = d.taskCounts(t);
  assert.equal(d.latestAttempt(t, plan).id, ex.id);
  assert.equal(d.latestAttempt(t, plan, true).id, old.id);
  assert.equal(counts.done, 6); assert.equal(counts.running, 1); assert.equal(counts.waiting, 0);
  const oldReport = JSON.stringify(t.reportHistory || []);
  d.reportSnapshot(t);
  assert.ok(t.reportHistory.at(-1).executions.some(e => e.id === old.id));
  assert.ok(!t.reportHistory.at(-1).executions.some(e => e.id === ex.id));
  assert.equal(t.plan.length, 6);
  assert.equal(oldReport, '[]');
});

test('report scoring selects the latest finished evaluation of the fixed profile/version', () => {
  const d = loadDemo(), t = d.state.tasks[0], ex = d.latestAttempt(t, t.plan[0]);
  const original = d.latestEval(ex, t.profile), before = d.rates([ex], 'quality', t.profile);
  const other = d.clone(d.state.profiles[1]); other.dimensions.at(-1).threshold = 5;
  ex.evaluations.push(d.evaluationFor(ex, other));
  assert.equal(d.latestEval(ex).verdict, 'fail');
  assert.equal(d.latestEval(ex, t.profile).id, original.id);
  assert.equal(JSON.stringify(d.rates([ex], 'quality', t.profile)), JSON.stringify(before));
  ex.evaluations.push({ status: 'running', profile: t.profile, dimensions: [] });
  assert.equal(d.latestEval(ex, t.profile).id, original.id);
  ex.evaluations.push(d.evaluationFor(ex, t.profile, true));
  assert.equal(d.latestEval(ex, t.profile).verdict, 'error');
  assert.equal(d.rates([ex], 'quality', t.profile).coverage, 0);
});

test('quality thresholds change verdict and report snapshots retain the previous scores', () => {
  const d = loadDemo(), t = d.state.tasks[0], ex = d.latestAttempt(t, t.plan[0]);
  d.reportSnapshot(t); const original = JSON.stringify(t.reportHistory[0]);
  const p = d.clone(t.profile); p.dimensions.find(v => v.kind === 'quality').threshold = 5;
  const evaluation = d.evaluationFor(ex, p);
  assert.equal(evaluation.dimensions.find(v => v.kind === 'quality').verdict, 'fail');
  ex.evaluations.push(evaluation); d.reportSnapshot(t);
  assert.equal(JSON.stringify(t.reportHistory[0]), original);
  assert.equal(d.verdict(ex, t.profile), 'fail');
});

test('CER is inapplicable without ASR, while missing references remain explicit for ASR', async () => {
  const d = loadDemo(), p = d.state.profiles[0];
  const t = d.buildTask('Strict text', [{ datasetId: 'ds-text', flowId: 'flow-text' }], p, 1);
  const ex = d.makeExecution(t, t.plan[0]); await d.runExecution(ex);
  const evaluation = d.latestEval(ex, p), cer = evaluation.dimensions.find(v => v.kind === 'reference');
  assert.equal(cer.applicable, false); assert.equal(evaluation.verdict, 'pass');
  assert.equal(d.rates([ex], 'reference', p).total, 0);
  const audio = d.buildTask('Missing reference', [pair], p, 1), audioEx = d.makeExecution(audio, audio.plan[4]);
  audioEx.status = 'succeeded'; audioEx.winner = 'end-a';
  const result = d.evaluationFor(audioEx, p);
  assert.equal(result.dimensions.find(v => v.kind === 'reference').verdict, 'unscored');
  assert.equal(result.verdict, 'incomplete');
  const f = d.clone(d.state.flows[0]); f.nodes[0].name = '';
  assert.ok(d.validateFlow(f).some(e => e.includes('名称不能为空')));
});

test('custom-named output groups render every field in declaration order', () => {
  const d = loadDemo(), ex = d.clone(d.state.executions[0]);
  ex.flowSnapshot.outputSchema = [{ name: 'picture', type: 'Image' }, { name: 'summary', type: 'Text' }, { name: 'recording', type: 'Audio', stream: true }];
  ex.output = { summary: '<safe text>', picture: { url: 'image-url' }, recording: { url: 'audio-url', stream: true, eos: true } };
  const html = d.outputPreview(ex);
  assert.ok(html.indexOf('picture / Image') < html.indexOf('summary / Text'));
  assert.ok(html.indexOf('summary / Text') < html.indexOf('recording / Audio'));
  assert.match(html, /&lt;safe text&gt;/); assert.match(html, /正常 EOS/);
  assert.match(html, /image-url/); assert.match(html, /audio-url/);
});

test('text and multimodal seeds complete with usable outputs', async () => {
  const d = loadDemo();
  for (const [datasetId, flowId] of [['ds-text', 'flow-text'], ['ds-multi', 'flow-multi']]) {
    const t = d.buildTask(flowId, [{ datasetId, flowId }], d.state.profiles[1], 1);
    const ex = d.makeExecution(t, t.plan[0]); await d.runExecution(ex);
    assert.equal(ex.status, 'succeeded'); assert.equal(typeof ex.output.reply, 'string');
    assert.ok(!ex.output.reply.includes('[object Object]'));
  }
});

test('streaming start inputs and both explicit conversions await normal EOS', async () => {
  for (const streamStart of [true, false]) {
    const d = loadDemo(), f = d.state.flows.find(f => f.id === 'flow-text');
    f.inputSchema[0].stream = streamStart;
    const full = d.clone(f.inputSchema).map(v => ({ ...v, stream: false }));
    const streamed = d.clone(full).map(v => ({ ...v, stream: true }));
    const buffer = d.makeNode('buffer', 'conversion', 'Buffer text', 300, 100);
    buffer.input = streamed; buffer.output = full; buffer.params.direction = 'to-batch';
    f.nodes.push(buffer);
    const model = f.nodes.find(n => n.moduleId === 'model');
    f.edges = [['start', 'buffer'], ['buffer', model.id], [model.id, 'end']];
    if (!streamStart) {
      const replay = d.makeNode('replay', 'conversion', 'Replay text', 200, 100);
      replay.input = full; replay.output = streamed; replay.params.direction = 'to-stream';
      f.nodes.push(replay); f.edges[0] = ['replay', 'buffer']; f.edges.unshift(['start', 'replay']);
    }
    assert.equal(d.validateFlow(f).length, 0);
    const t = d.buildTask('Stream text', [{ datasetId: 'ds-text', flowId: f.id }], d.state.profiles[1], 1);
    const ex = d.makeExecution(t, t.plan[0]); await d.runExecution(ex);
    assert.equal(ex.status, 'succeeded');
    assert.ok(ex.events.findIndex(e => e.type === 'stream.eos') < ex.events.findIndex(e => e.type === 'execution.succeeded'));
    assert.ok(!ex.output.reply.includes('[object Object]'));
  }
});

test('node failure stops the case and cancellation keeps its terminal state after cleanup', async () => {
  const d = loadDemo(), t = d.buildTask('Cancel', [pair], d.state.profiles[1], 1);
  const failed = d.makeExecution(t, t.plan[0]); await d.runExecution(failed, true);
  assert.equal(failed.status, 'failed'); assert.equal(failed.cleanup, 'stopped');
  assert.ok(failed.spans.some(s => s.status === 'not_started'));
  const canceled = d.makeExecution(t, t.plan[1]), pending = d.runExecution(canceled);
  d.controllers.get(canceled.id).cancel(); await pending;
  assert.equal(canceled.status, 'canceled'); assert.equal(canceled.cleanup, 'stopped');
  assert.equal(canceled.winner, null);
});

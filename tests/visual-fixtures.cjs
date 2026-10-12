// Read-only visual fixtures derived from the actual prototype. Never seed a normal installation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadDemo } = require('./demo-test-helpers.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.data/visual-fixtures');
const now = 1791696000000, randomSeed = 271828;
const demo = loadDemo({ now, randomSeed }), state = demo.state;
const iso = value => new Date(value || now).toISOString();
const schema = fields => ({ fields: fields || [] });
const resource = (kind, value, data) => ({ id: value.id, kind, name: value.name,
  version: typeof value.version === 'number' ? value.version : 1,
  selected_version: typeof value.version === 'number' ? value.version : 1,
  revision_id: value.id + '-revision', digest: crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex'),
  hidden: !!value.hidden, created: iso(), updated: iso(), data });
const page = items => ({ items, total: items.length, page: 1, page_size: 100 });
const resources = {};
resources.repositories = state.repos.map(r => resource('repositories', r, { name: r.name,
  url: r.url, branch: r.branch, commit: r.commit, commits: r.versions, sync_state: r.status,
  credential_id: null, description: '', synced_at: iso(r.synced) }));
resources.assets = state.assets.map(a => resource('assets', a, { name: a.name, type: a.type,
  format: a.format, tags: a.tags || [], category: a.category || '', text: a.type === 'Text' ? a.value : null,
  reference: a.reference, reference_confirmed: !!a.confirmed, size: 96044, duration: a.duration,
  metadata: { duration: a.duration, ...(a.demoTone ? {description: '演示提示音'} : {}) },
  fixture_url: a.url?.startsWith('blob:') ? '/fixtures/tone.wav' : a.url }));
const mount = r => r.pod.repoId ? { repository_id: r.pod.repoId, repository_version: 1,
  commit: state.repos.find(v => v.id === r.pod.repoId)?.commit, mount_path: r.pod.mountPath } : null;
resources.modules = state.modules.map(m => resource('modules', { ...m, version: 1 }, {
  name: m.name, manifest: { id: m.id, name: m.name, description: m.description, version: m.version,
    protocol: 'testflow.module.v1', ui_sdk: 'testflow.ui.v1', ui: m.ui,
    defaults: m.params, exposes_trace: m.trace,
    runtime: { mode: 'pod', image: m.runtime.pod.image, port: 8080, code_mount: mount(m.runtime),
      requires_sequential: m.sequential, reuse_scope: 'batch_node', cpu: '250m', memory: '256Mi' } },
  inputs: schema(m.input), outputs: schema(m.output), parameters: { type: 'object', properties: {} },
  package_digest: 'visual-fixture', contract_digest: 'visual-fixture', readme: m.description }));
resources.modules.forEach(m => { m.availability = { id: 'fixture-validation-'+m.id, state: 'succeeded', result: {}, progress: 100 }; });
const makeCase = (c, dataset) => ({ id: c.id, name: c.name,
  inputs: Object.fromEntries(Object.entries(c.inputs).map(([name, value]) => [name,
    typeof value === 'string' && state.assets.some(a => a.id === value) ? { asset_id: value, asset_version: 1 } : { value }])),
  reference: typeof c.reference === 'object' ? c.reference : { [dataset.outputSchema.find(f => f.type === 'Text')?.name || 'text']: c.reference },
  reference_confirmed: !!c.confirmed });
resources.datasets = state.datasets.map(d => resource('datasets', d, { name: d.name, description: '',
  input_schema: schema(d.inputSchema), output_schema: schema(d.outputSchema), cases: d.cases.map(c => makeCase(c, d)) }));
resources.pipelines = state.flows.map(f => resource('pipelines', f, { name: f.name, description: f.description,
  input_schema: schema(f.inputSchema), output_schema: schema(f.outputSchema), preparation_timeout: 60, cleanup_timeout: 10,
  nodes: f.nodes.map(n => ({ id: n.id, name: n.name, kind: n.kind,
    x: n.x, y: n.y, module_id: n.moduleId, module_version: 1, parameters: n.params,
    direction: n.kind === 'conversion' ? (n.direction || 'to_full') : undefined,
    module_snapshot: n.moduleId ? resources.modules.find(m => m.id === n.moduleId) : undefined,
    runtime: n.runtime ? resources.modules.find(m => m.id === n.moduleId)?.data.manifest.runtime : null,
    timeout: n.timeout, input_schema: schema(n.input), output_schema: schema(n.output), mappings: n.mappings })),
  edges: f.edges.map(([source, target]) => ({ source, target })) }));
const binding = b => ({ source: b?.source || 'output', field: b?.field || '', node_id: b?.nodeId || null });
resources['evaluation-profiles'] = state.profiles.map(p => resource('evaluation-profiles', p, {
  name: p.name, description: '', model: p.model, endpoint: '', temperature: p.temperature, prompt: p.prompt,
  response_format: 'json_schema', modalities: ['Text'],
  dimensions: p.dimensions.map((d,i) => ({ id: p.id+'-'+i, name: d.name,
    method: d.method === 'AI' ? 'ai' : d.kind === 'reference' ? 'cer' : 'structure',
    required: d.required, threshold: d.threshold,
    needs_reference: d.kind === 'reference',
    actual: binding(d.actual), reference: d.kind === 'reference' ? binding(d.reference) : null,
    evidence: (d.evidenceBindings || []).map(binding), prompt: '' })) }));
const get = (kind, id) => resources[kind].find(r => r.id === id);
const rate = group => { const v = demo.rates(state.executions, group, state.profiles[0]);
  return { expected: v.total, valid: v.valid, passed: v.passed, pass_rate: v.pass == null ? null : v.pass/100,
    coverage: v.coverage == null ? null : v.coverage/100 }; };
const executions = state.executions.map(e => ({ id: e.id, root_id: e.id, item_id: e.planId, task_id: e.taskId,
  batch_id: e.batchId, attempt: e.attempt, name: e.caseSnapshot.name, state: e.status, cleanup: e.cleanup,
  trace_id: e.traceId, created: iso(e.created), duration_ms: e.duration, winner: e.winner, error: null,
  snapshot: { pipeline: { ...get('pipelines', e.flowId), graph: get('pipelines', e.flowId).data },
    dataset: get('datasets', e.datasetId), case: makeCase(e.caseSnapshot, e.datasetSnapshot),
    profile: get('evaluation-profiles', e.profileSnapshot.id), reference: makeCase(e.caseSnapshot,e.datasetSnapshot).reference,
    reference_confirmed: !!e.caseSnapshot.confirmed,
    inputs: Object.fromEntries(Object.entries(e.inputSnapshot).map(([key, a]) => [key, { asset: get('assets', a.id) }])) },
  actual_inputs: {}, output: e.output,
  nodes: Object.fromEntries(e.spans.map(s => [s.node.id, { id: s.node.id, name: s.node.name, kind: s.node.kind,
    state: s.status, span_id: s.id, input: s.input, output: s.output, started_ms: s.start, duration_ms: s.duration,
    runtime_id: null, image_id: null, invocation_id: null, error: s.error }])),
  events: e.events.map((v,i) => ({ id: i+1, kind: v.type, execution_id: e.id, data: { text: v.text }, created: iso(e.created+v.at) })),
  evaluations: e.evaluations.map(v => ({ id: v.id, execution_id: e.id, state: v.status, profile: get('evaluation-profiles', v.profile.id),
    created: iso(v.time), error: null, result: { verdict: demo.verdict(e, v.profile), dimensions: v.dimensions.map((d,i) => ({
      id: v.profile.id+'-'+i, name: d.name, method: d.method === 'AI' ? 'ai' : d.kind === 'reference' ? 'cer' : 'structure',
      state: d.verdict || 'pass', score: d.score, reason: d.reason, required: d.required, applicable: d.applicable !== false,
      needs_reference: d.kind === 'reference', bindings: { actual: binding(d.actual), reference: binding(d.reference),
        evidence: (d.evidenceBindings || []).map(binding) }, evidence: d.evidence || [] })) } })), attempts: [] }));
const tasks = state.tasks.map(t => { const counts = demo.taskCounts(t);
  const rows = t.plan.map(p => { const e = executions.find(r => r.item_id === p.id);
    return { item_id: p.id, pair_id: p.pairId, case: e.snapshot.case, dataset: { id: e.snapshot.dataset.id, name: e.snapshot.dataset.name, version: e.snapshot.dataset.version },
      pipeline: { id: e.snapshot.pipeline.id, name: e.snapshot.pipeline.name, version: e.snapshot.pipeline.version }, sample_identity: p.case.id,
      repetition: 1, plan_state: e.state, execution_id: e.id, active_execution_id: null, execution_state: e.state,
      evaluation_id: e.evaluations[0]?.id, evaluation: e.evaluations[0]?.result, verdict: e.evaluations[0]?.result.verdict || 'unscored',
      duration_ms: e.duration_ms, cleanup: e.cleanup }; });
  const report = { task_id: t.id, task_name: t.name, state: t.status, plan_count: t.plan.length, rows,
    requested_concurrency: t.requestedConcurrency, effective_concurrency: t.effectiveConcurrency, restrictions: [],
    reference: rate('reference'), quality: rate('quality'), run_completed: counts.done, evaluated: rows.length, passed: counts.passes };
  return { id: t.id, name: t.name, state: t.status, created: iso(t.created), snapshot: { pairs: t.pairs.map(p => ({
    dataset_id: p.datasetId, pipeline_id: p.flowId, dataset_version: p.dataset.version, pipeline_version: p.flow.version })) }, report }; });
const counts = Object.fromEntries(Object.entries(resources).map(([key, v]) => [key, v.length]));
counts.evaluation = resources['evaluation-profiles'].length; counts.tasks = tasks.length; counts.executions = executions.length;
counts.planned_cases = state.tasks.reduce((sum,t)=>sum+t.plan.length,0);
const routes = { '/auth/session': { authenticated: true, username: 'admin' }, '/credentials': page([]),
  '/system/overview': { counts, tasks, runs: Object.fromEntries(['succeeded','failed','running'].map(s => [s, executions.filter(e => e.state === s).length])),
    reference: rate('reference'), quality: rate('quality') }, '/tasks': page(tasks), '/executions': page([...executions].reverse()) };
for (const [kind, values] of Object.entries(resources)) {
  routes['/'+kind] = page(values);
  for (const value of values) {
    routes['/'+kind+'/'+value.id] = value;
    routes['/'+kind+'/'+value.id+'/versions'] = { items: [{ id: value.revision_id, number: value.version, data: value.data, created: iso() }] };
  }
}
for (const t of tasks) { routes['/tasks/'+t.id] = t; routes['/tasks/'+t.id+'/reports'] = { current: t.report, items: [{id:t.id+'-report',snapshot:t.report}] }; }
for (const e of executions) routes['/executions/'+e.id] = e;
// Adapt prototype media and streams into the public API's actual value shapes.
for (const execution of executions) {
  for (const field of execution.snapshot.pipeline.graph.output_schema.fields) {
    const value=execution.output[field.name];
    if (field.type==='Text' && field.stream && typeof value==='string')
      execution.output[field.name]={stream:true,text:value,eos:true,format:field.format};
    if (field.type==='Audio' && value?.url) {
      const identifier='visual-output-'+execution.id+'-'+field.name;
      routes['/assets/'+identifier]=resource('assets',{id:identifier,name:field.name+'.wav'},
        {name:field.name+'.wav',type:'Audio',format:field.format,size:96044,metadata:{duration:3},fixture_url:'/fixtures/tone.wav'});
      execution.output[field.name]={asset_id:identifier,asset_version:1,stream:!!value.stream,eos:!!value.eos,format:field.format};
    }
  }
}
let prototype = fs.readFileSync(path.join(root,'docs/demo.html'),'utf8')
  .replaceAll('Date.now()', String(now)).replaceAll('Math.random()', 'visualRandom()')
  .replace('const toneURL=URL.createObjectURL(toneBlob);', "const toneURL='/fixtures/tone.wav';")
  .replace('</style>', '/* Visual fixtures disable only entrance animation. */\n.screen-in{animation:none!important}\n</style>')
  .replace('<script>', `<script>\n// Deterministic, test-only clock and identifiers.\nlet visualSeed=${randomSeed}; const visualRandom=()=>((visualSeed=(1664525*visualSeed+1013904223)>>>0)/4294967296);`);
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,'responses.json'),JSON.stringify(routes));
fs.writeFileSync(path.join(output,'prototype.html'),prototype);
fs.writeFileSync(path.join(output,'screens.json'),JSON.stringify({fixture:'prototype-derived read-only data',
  screens:['overview','repositories','modules','assets','datasets','pipelines','evaluation','tasks','executions'].map(id=>({
    id,actual:`visual-formal-${id}-1440.jpg`,baseline:`visual-demo-${id}-1440.jpg`,masks:[]
  }))},null,2)+'\n');
fs.writeFileSync(path.join(output,'source.json'),JSON.stringify({ now, randomSeed,
  entrance_animation: 'disabled to capture its completed state',
  prototype_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'docs/demo.html'))).digest('hex'),
  purpose: 'Read-only visual fixtures; not real executions or scoring evidence' },null,2));
fetch(state.assets.find(a => a.type === 'Audio').url).then(r => r.arrayBuffer()).then(data => {
  fs.writeFileSync(path.join(output, 'tone.wav'), Buffer.from(data));
  console.log(path.relative(root,output));
});

// Input groups and read-only media with a deterministic, explicitly test-only model provider.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium, expect} from '@playwright/test';
import {waitForPreview} from './browser/fixtures.mjs';

const namespace = process.env.TESTFLOW_E2E_NAMESPACE;
if (!namespace?.startsWith('testflow-e2e-')) throw Error('An owned disposable namespace is required');
const access = JSON.parse(await fs.readFile('.data/kubernetes/' + namespace + '/access.json', 'utf8'));
const directory = path.resolve('.data/acceptance/' + namespace + '/input-only');
await fs.mkdir(directory, {recursive: true, mode: 0o700});
const browser = await chromium.launch(), context = await browser.newContext({baseURL: access.url, viewport: {width: 1440, height: 1000}});
const page = await context.newPage(), errors = [], cases = [], layouts = [];
page.on('pageerror', error => errors.push(error.message));
const dialog = () => page.locator('[data-slot="modal-dialog"]').last();
const button = (name, scope = page) => scope.getByRole('button', {name, exact: true});
const api = async (method, route, data) => {
  const response = await context.request.fetch('/api/v1' + route, {method, data, headers: {'Idempotency-Key': randomUUID()}});
  if (!response.ok()) throw Error(`${method} ${route}: ${response.status()}`);
  return response.json();
};
const create = (kind, data) => api('POST', '/' + kind, data);
const read = (kind, id) => api('GET', '/' + kind + '/' + id);
async function shot(name) {await page.evaluate(() => document.fonts.ready); await page.screenshot({path: path.join(directory, name + '.png'), fullPage: true, animations: 'disabled'});}
async function step(id, run) {await run(); cases.push({id, passed: true, screenshot: id + '.png'}); await shot(id); console.log('PASS ' + id);}
async function close() {await dialog().press('Escape'); await expect(page.locator('[data-slot="modal-dialog"]')).toHaveCount(0);}
async function upload(filename, mime) {
  const response = await context.request.post('/api/v1/media/upload', {multipart: {files: {name: path.basename(filename), mimeType: mime, buffer: await fs.readFile(filename)}}});
  expect(response.ok()).toBe(true); const item = (await response.json()).items[0]; expect(item.error).toBeFalsy(); return item.resource;
}
const input = {fields: [{name: 'text', type: 'Text', format: 'UTF-8', stream: false}, {name: 'audio', type: 'Audio', format: 'WAV · 16kHz · Mono', stream: false}, {name: 'image', type: 'Image', format: 'Image/*', stream: false}]};
const output = {fields: [{name: 'answer', type: 'Text', format: 'UTF-8', stream: false}, {name: 'echo', type: 'Text', format: 'UTF-8', stream: false}]};
let dataset, pipeline, profile, task, failure, text, image, audio;
const secret = 'sk-test-fixture-' + randomUUID();
try {
  await waitForPreview(context.request, access.url); await page.goto('/');
  await page.getByRole('textbox', {name: '密码*', exact: true}).fill(access.password); await button('登录').click();
  await expect(page.getByRole('heading', {name: '测试工作台', exact: true})).toBeVisible();
  await context.tracing.start({screenshots: true, snapshots: true, sources: false});
  text = await create('assets', {name: 'TEST UI valid input', type: 'Text', text: 'valid request', tags: ['shared'], category: 'Inputs'});
  const wrong = await create('assets', {name: 'TEST UI wrong input', type: 'Text', text: 'wrong request'});
  image = await upload('examples/repository-helpdesk/inputs/question.png', 'image/png');
  audio = await upload('examples/repository-helpdesk/inputs/question.wav', 'audio/wav');
  dataset = await create('datasets', {name: 'TEST UI input groups', input_schema: input, cases: [text, wrong].map((asset, index) => ({
    id: randomUUID(), name: index ? 'Wrong input group' : 'Valid input group', inputs: {text: {asset_id: asset.id}, audio: {asset_id: audio.id}, image: {asset_id: image.id}}}))});
  pipeline = await create('pipelines', {name: 'TEST UI independent output', input_schema: input, output_schema: output, nodes: [
    {id: 'start', kind: 'start', name: '开始', output_schema: input},
    {id: 'answer', kind: 'assembly', name: '实际输出', output_schema: output, mappings: [{target: 'answer', source: 'start', field: 'text'}, {target: 'echo', source: 'start', field: 'text'}]},
    {id: 'end', kind: 'end', name: '结束', input_schema: output, output_schema: output}], edges: [{source: 'start', target: 'answer'}, {source: 'answer', target: 'end'}]});
  await step('simplified-global-shell', async () => {
    for (const label of ['搜索工作区', '刷新', '凭据管理', '回收站']) await expect(page.getByRole('button', {name: label, exact: true})).toHaveCount(0);
    await expect(page.locator('.testflow-footer-status')).toHaveCount(0);
    await expect(page.locator('.testflow-workspace-box')).toHaveCount(0);
    await expect(page.getByText('默认工作区', {exact: true})).toHaveCount(0);
    await expect(page.getByText('v0.1', {exact: true})).toHaveCount(0);
    await page.keyboard.press('Control+k'); await expect(page.locator('[data-slot="modal-dialog"]')).toHaveCount(0);
    await expect(page.getByRole('button', {name: '切换语言', exact: true})).toBeVisible();
  });
  await page.goto('/assets');
  await step('pool-image-opens-large-viewer', async () => {
    await page.locator('tbody tr').filter({hasText: image.name}).locator('.testflow-image-open').click();
    await expect(dialog().locator('.testflow-image-large')).toBeVisible();
    await expect(dialog().getByRole('textbox')).toHaveCount(0);
    await expect.poll(() => dialog().locator('img').evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
    await shot('large-image-in-pool'); await close();
  });
  await page.goto('/datasets');
  await step('dataset-card-is-input-only', async () => {
    await expect(page.getByText('输出字段组', {exact: true})).toHaveCount(0);
    await expect(page.getByText('2 组输入', {exact: true})).toBeVisible();
  });
  await page.goto('/datasets/' + dataset.id);
  await step('multi-field-input-groups', async () => {
    const groups = page.locator('.testflow-input-group'); await expect(groups).toHaveCount(2);
    await expect(groups.first().locator('[data-field]')).toHaveCount(3);
    await expect(groups.first().locator('tbody tr')).toHaveCount(3);
    await expect(groups.first().locator('.testflow-material-number')).toHaveText(['1', '2', '3']);
    await expect(page.locator('.testflow-source-button')).toHaveCount(0);
    await expect(page.getByText('打开素材池', {exact: true})).toHaveCount(0);
    await expect(groups.first()).toContainText('valid request'); await expect(groups.first().locator('img')).toBeVisible();
    await expect(groups.first().locator('audio')).toHaveCount(1);
    await expect(page.getByText('输出字段组', {exact: true})).toHaveCount(0);
    await expect(page.getByText('参考已确认', {exact: true})).toHaveCount(0);
  });
  await step('input-group-audio-is-playable', async () => {
    const group = page.locator('.testflow-input-group').first(); await group.locator('[data-a="play-audio"]').click();
    await expect.poll(() => group.locator('audio').evaluate(el => !el.paused && el.currentTime > 0)).toBe(true);
    await group.locator('[data-a="play-audio"]').click();
  });
  await step('group-image-viewer-is-read-only', async () => {
    await page.locator('.testflow-input-group').first().locator('.testflow-image-open').click();
    await expect(dialog().locator('.testflow-image-large')).toBeVisible();
    await expect(dialog().getByRole('textbox')).toHaveCount(0); await shot('large-image-in-group'); await close();
  });
  await step('edit-controls-have-button-borders', async () => {
    const styles = await page.locator('[data-a="edit-dataset"]').evaluate(el => {const s = getComputedStyle(el); return {border:s.borderStyle,color:s.borderColor,height:el.getBoundingClientRect().height};});
    expect(styles.border).toBe('solid'); expect(styles.color).not.toBe('rgba(0, 0, 0, 0)'); expect(styles.height).toBe(32);
    await page.locator('[data-a="edit-dataset"]').click();
    await expect(dialog().getByRole('heading', {name: '输出字段组', exact: true})).toHaveCount(0);
    await expect(dialog().locator('[data-a="schema-add"]')).toHaveCount(1);
    await expect(dialog().getByRole('textbox', {name: '字段名', exact: true})).toHaveCount(3);
    await close();
  });
  await step('group-editor-has-no-expected-output', async () => {
    await page.locator('.testflow-input-group').first().locator('[data-a="edit-case"]').click();
    await expect(dialog().getByRole('textbox', {name: '输入组名称', exact: true})).toHaveValue('Valid input group');
    await expect(dialog().getByText('参考字段 JSON', {exact: true})).toHaveCount(0);
    await expect(dialog().getByText('参考来源', {exact: false})).toHaveCount(0);
    await button('保存', dialog()).click(); await expect(page.locator('[data-slot="modal-dialog"]')).toHaveCount(0);
    dataset = await read('datasets', dataset.id); expect(Object.keys(dataset.data.cases[0]).sort()).toEqual(['id','inputs','name']);
  });
  await step('source-opens-search-and-editor-in-new-tab', async () => {
    const popupEvent = context.waitForEvent('page');
    await page.locator('.testflow-input-group').first().locator('[data-field="text"] .testflow-asset-source-name').click();
    const popup = await popupEvent; await popup.waitForURL('**/assets/' + text.id + '?q=*');
    await expect(popup.locator('[data-slot="modal-dialog"]')).toHaveCount(1);
    await expect(popup.getByRole('textbox', {name: '搜索工作区', exact: true})).toHaveValue(text.name);
    await popup.getByRole('textbox', {name: '文字内容', exact: true}).fill('valid updated request');
    await popup.getByRole('button', {name: '保存', exact: true}).click();
    await expect(page.locator('.testflow-input-group').first()).toContainText('valid updated request');
    await expect(page.locator('[data-slot="modal-dialog"]')).toHaveCount(0); await popup.close();
  });
  await step('portable-input-only-dataset', async () => {
    const document = await api('GET', '/datasets/' + dataset.id + '/export');
    expect(Object.keys(document.dataset).sort()).toEqual(['cases','description','input_schema','name']);
    expect(Object.keys(document.dataset.cases[0]).sort()).toEqual(['inputs','key','name']);
    const preview = await api('POST', '/datasets/import/preview', {document}); expect(preview.valid).toBe(true);
    const copy = await create('datasets/import', {document, name: 'TEST UI imported input groups'});
    expect(copy.data.cases).toHaveLength(2); expect(copy.data.output_schema).toBeUndefined();
  });
  await step('repository-credentials-configured-in-context', async () => {
    await page.goto('/repositories'); await button('注册仓库').click();
    await button('配置访问凭据', dialog()).click();
    await dialog().getByRole('textbox', {name:'名称',exact:true}).fill('TEST UI scoped Git key');
    await dialog().getByRole('textbox', {name:'凭据正文（加密保存）',exact:true}).fill(secret);
    await button('保存', dialog()).click(); await expect(page.locator('[data-slot="modal-dialog"]')).toHaveCount(1);
    await expect(dialog().getByRole('button', {name:'凭据引用',exact:false})).toContainText('TEST UI scoped Git key');
    await close();
  });
  await page.goto('/evaluation-profiles'); await button('新建评测配置').click();
  await step('model-key-configured-in-model-form', async () => {
    await dialog().getByRole('textbox', {name: '名称', exact: true}).fill('TEST UI model judgment');
    await dialog().getByRole('textbox', {name: '服务地址（兼容 Chat Completions）', exact: true}).fill('http://testflow-eval-fixture:8080/v1');
    await dialog().getByRole('textbox', {name: '模型', exact: true}).fill('contract-fixture');
    await dialog().getByRole('textbox', {name: '模型 API Key', exact: true}).fill(secret);
    await dialog().getByText('音频', {exact:true}).click(); await dialog().getByText('图片', {exact:true}).click();
    await expect(dialog().getByRole('checkbox', {name:'音频',exact:true})).toBeChecked(); await expect(dialog().getByRole('checkbox', {name:'图片',exact:true})).toBeChecked();
    await expect(dialog().locator('.testflow-dimension-toggle')).toContainText('答案正确性');
    expect(await page.evaluate(key => Object.keys(localStorage).every(name => !(localStorage.getItem(name) || '').includes(key)), secret)).toBe(true);
  });
  await step('model-save-retry-retains-key-only-in-memory', async () => {
    let rejected = false;
    await page.route('**/api/v1/evaluation-profiles', async route => {
      if (route.request().method() === 'POST' && !rejected) {rejected = true; await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'database_unavailable',message:'Fixture save failure'})});} else await route.continue();
    });
    await button('保存', dialog()).click(); await expect(dialog().getByRole('alert')).toBeVisible();
    await expect(dialog().getByRole('textbox', {name: '模型 API Key', exact: true})).toHaveValue(secret);
    await button('保存', dialog()).click(); await expect(page.locator('[data-slot="modal-dialog"]')).toHaveCount(0); await page.unroute('**/api/v1/evaluation-profiles');
    profile = (await api('GET', '/evaluation-profiles')).items.find(item => item.name === 'TEST UI model judgment');
    expect(profile.data.credential_id).toBeTruthy(); expect(profile.data.api_key).toBeUndefined(); expect(JSON.stringify(profile)).not.toContain(secret);
  });
  await step('saved-key-retained-without-plaintext-readback', async () => {
    await page.locator('.testflow-profile-card .testflow-edit-action').click();
    await expect(dialog().getByRole('textbox', {name: '模型 API Key', exact: true})).toHaveValue('');
    await expect(dialog().getByRole('textbox', {name: '模型 API Key', exact: true})).toHaveAttribute('placeholder', '已保存，留空保留现有凭证');
    await button('保存', dialog()).click(); await expect(page.locator('[data-slot="modal-dialog"]')).toHaveCount(0);
    const updated = await read('evaluation-profiles', profile.id); expect(updated.data.credential_id).toBe(profile.data.credential_id); profile = updated;
  });
  await step('actual-model-contract-judges-output-without-answers', async () => {
    const submitted = await create('tasks', {name:'TEST UI model decisions',profile_id:profile.id,profile_version:profile.version,
      pairs:[{dataset_id:dataset.id,dataset_version:dataset.version,pipeline_id:pipeline.id,pipeline_version:pipeline.version}]});
    await expect.poll(async () => (await read('tasks', submitted.id)).state, {timeout:60000}).toBe('completed');
    task = await read('tasks', submitted.id); expect(task.report.plan_count).toBe(2); expect(task.report.passed).toBe(1);
    expect(task.report.rows.map(row=>row.verdict)).toEqual(['pass','fail']);
    const execution = await read('executions',task.report.rows[0].execution_id); expect(execution.output.answer).toBe('valid updated request');
    expect(execution.snapshot.reference).toEqual({}); expect(execution.snapshot.reference_sources).toEqual({});
    expect(JSON.stringify(execution.snapshot)).not.toContain(secret);
    await page.goto('/test-tasks/'+task.id); await expect(page.locator('tbody tr')).toHaveCount(2);
  });
  await step('report-media-stays-read-only', async () => {
    await expect(page.locator('tbody .testflow-edit-action')).toHaveCount(0);
    await expect(page.locator('.testflow-source-button')).toHaveCount(0);
    await expect(page.locator('tbody tr').first().locator('.testflow-execution-preview').first().locator('.testflow-material-number')).toHaveText(['1', '2', '3']);
    await expect(page.locator('tbody tr').first().locator('.testflow-execution-preview').last().locator('.testflow-material-number')).toHaveText(['1', '2']);
    await page.locator('tbody .testflow-image-open').first().click(); await expect(dialog().locator('.testflow-image-large')).toBeVisible(); await close();
    await page.goto('/executions'); await expect(page.locator('tbody tr')).toHaveCount(2); await expect(button('刷新')).toHaveCount(0); await expect(page.locator('tbody .testflow-edit-action')).toHaveCount(0);
    await expect(page.locator('tbody tr').first().locator('.testflow-execution-preview').first().locator('.testflow-material-number')).toHaveText(['1', '2', '3']);
  });
  await step('deleted-assets-have-no-restore-api', async () => {
    const disposable = await create('assets',{name:'TEST UI delete-only',type:'Text',text:'delete-only'});
    await api('POST','/assets/'+disposable.id+'/hide');
    expect((await context.request.post('/api/v1/assets/'+disposable.id+'/restore')).status()).toBe(404);
    expect((await read('assets',disposable.id)).hidden).toBe(true);
  });
  await step('desktop-languages-and-themes', async () => {
    const routes=[['groups','/datasets/'+dataset.id],['cards','/datasets'],['report','/test-tasks/'+task.id],['history','/executions']];
    for(const width of [1200,1440,1920]) for(const locale of ['zh-CN','en-US']) for(const theme of ['light','dark']) {
      await page.setViewportSize({width,height:1000}); await page.evaluate(value=>{localStorage.setItem('testflow.locale',value.locale);localStorage.setItem('testflow.theme',value.theme);},{locale,theme});
      for(const [name,url] of routes) {
        await page.goto(url); await expect(page.locator('.testflow-page-heading h1')).toBeVisible();
        if(name==='groups') await expect(page.locator('.testflow-input-group')).toHaveCount(2);
        if(name==='report'||name==='history') await expect(page.locator('tbody tr')).toHaveCount(2);
        const images=page.locator(name==='groups'?'.testflow-input-group img':'tbody img');
        if(name!=='cards'){await expect(images).toHaveCount(2);await expect.poll(()=>images.evaluateAll(all=>all.every(image=>image.complete&&image.naturalWidth>0))).toBe(true);}
        expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
        const screenshot=`${name}-${width}-${locale}-${theme}`;await shot(screenshot);layouts.push({name,width,locale,theme,screenshot:screenshot+'.png'});
      }
    }
    expect(errors).toEqual([]);
  });
} catch(error) {failure=error;await shot('failure').catch(()=>{});}
finally {
  await context.tracing.stop({path:path.join(directory,'private-trace.zip')}).catch(()=>{});
  await fs.chmod(path.join(directory,'private-trace.zip'),0o600).catch(()=>{});
  await fs.writeFile(path.join(directory,'control-cases.json'),JSON.stringify({namespace,passed:!failure,cases,layouts,errors,failure:failure?.message,provider:'contract-fixture (not a real model)',resources:{dataset:dataset?.id,pipeline:pipeline?.id,profile:profile?.id,task:task?.id}},null,2));
  await browser.close();
}
if(failure)throw failure;
console.log(JSON.stringify({passed:true,cases:cases.length,layouts:layouts.length,errors}));

// Shared asset editing and rich media lists against real disposable Kubernetes resources.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium, expect} from '@playwright/test';
import {waitForPreview} from './browser/fixtures.mjs';

const namespace = process.env.TESTFLOW_E2E_NAMESPACE;
if (!namespace?.startsWith('testflow-e2e-')) throw Error('An owned disposable Kubernetes namespace is required');
const access = JSON.parse(await fs.readFile('.data/kubernetes/' + namespace + '/access.json', 'utf8'));
const directory = path.resolve('.data/acceptance/' + namespace + '/asset-experience');
await fs.mkdir(directory, {recursive: true, mode: 0o700});
const browser = await chromium.launch();
const context = await browser.newContext({baseURL: access.url, viewport: {width: 1440, height: 1000}});
const page = await context.newPage(), cases = [], layouts = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
const dialog = () => page.locator('[data-slot="modal-dialog"]').last();
const button = (name, scope = page) => scope.getByRole('button', {name, exact: true});
const api = async (method, route, data) => {
  const response = await context.request.fetch('/api/v1' + route, {method, data, headers: {'Idempotency-Key': randomUUID()}});
  if (!response.ok()) throw Error(`${method} ${route}: ${response.status()} ${await response.text()}`);
  return response.json();
};
const read = (kind, id) => api('GET', '/' + kind + '/' + id);
const create = (kind, data) => api('POST', '/' + kind, data);
const patch = async (kind, id, changes) => {const resource = await read(kind, id); return api('PUT', '/' + kind + '/' + id, {expected_version: resource.version, data: {...resource.data, ...changes}});};
const row = name => page.locator('tbody tr').filter({hasText: name});
async function shot(name) {await page.evaluate(() => document.fonts.ready); await page.screenshot({path: path.join(directory, name + '.png'), fullPage: true}); return name + '.png';}
async function step(id, expected, run) {const actual = await run(); cases.push({id, expected, actual: actual || {passed: true}, passed: true, screenshot: await shot(id)}); console.log('PASS ' + id);}
async function close() {await dialog().press('Escape'); await expect(page.locator('[data-slot="modal-dialog"]')).toHaveCount(0);}
async function select(label, name, scope = dialog()) {await scope.getByRole('button', {name: label, exact: false}).click(); await page.getByRole('option', {name, exact: true}).click();}
async function play(scope) {await scope.locator('[data-a="play-audio"]').first().click(); await expect.poll(() => scope.locator('audio').first().evaluate(el => !el.paused && el.currentTime > 0), {timeout: 10000}).toBe(true);}
async function upload(filename, mime) {
  const response = await context.request.post('/api/v1/media/upload', {multipart: {files: {name: path.basename(filename), mimeType: mime, buffer: await fs.readFile(filename)}}});
  expect(response.ok()).toBe(true); const item = (await response.json()).items[0]; expect(item.error).toBeFalsy(); return item.resource;
}
const schema = {fields: [{name: 'text', type: 'Text', format: 'UTF-8', stream: false}, {name: 'audio', type: 'Audio', format: 'WAV · 16kHz · Mono', stream: false}, {name: 'image', type: 'Image', format: 'Image/*', stream: false}]};
let text, image, audio, dataset, profile, pipeline, first, second, failure;
async function task(name) {
  const current = await read('evaluation-profiles', profile.id);
  const result = await create('tasks', {name, profile_id: current.id, profile_version: current.version, pairs: [{dataset_id: dataset.id, dataset_version: dataset.version, pipeline_id: pipeline.id, pipeline_version: pipeline.version}]});
  await expect.poll(async () => (await read('tasks', result.id)).state, {timeout: 45000}).toBe('completed');
  const report = (await read('tasks', result.id)).report; expect(report.plan_count).toBe(1); expect(report.passed).toBe(1);
  return {id: result.id, report, execution: await read('executions', report.rows[0].execution_id)};
}
try {
  await waitForPreview(context.request, access.url); await page.goto('/');
  await page.getByRole('textbox', {name: '密码*', exact: true}).fill(access.password); await button('登录').click();
  await expect(page.getByRole('heading', {name: '测试工作台', exact: true})).toBeVisible();
  text = await create('assets', {name: 'TEST UI shared text', type: 'Text', text: 'First shared content', category: 'Shared category', tags: ['original'], reference: 'First shared content', reference_confirmed: true});
  image = await upload('examples/repository-helpdesk/inputs/question.png', 'image/png');
  audio = await upload('examples/repository-helpdesk/inputs/question.wav', 'audio/wav');
  await patch('assets', audio.id, {name: 'TEST UI shared audio', category: 'Voice', tags: ['audio']}); audio = await read('assets', audio.id);
  profile = await create('evaluation-profiles', {name: 'TEST UI shared rules', dimensions: [
    {id: 'completion', name: '正常完成', method: 'completion', threshold: 1, required: true, actual: {source: 'execution', field: 'state'}},
    {id: 'structure', name: '输出结构', method: 'structure', threshold: 1, required: true, actual: {source: 'output', field: ''}},
    {id: 'text', name: '精确文字', method: 'exact_text', threshold: 1, required: true, needs_reference: true, actual: {source: 'output', field: 'text'}, reference: {source: 'reference', field: 'text'}}]});
  pipeline = await create('pipelines', {name: 'TEST UI shared flow', input_schema: schema, output_schema: schema, nodes: [
    {id: 'start', name: '开始', kind: 'start', output_schema: schema, x: 50, y: 160}, {id: 'end', name: '结束', kind: 'end', input_schema: schema, output_schema: schema, x: 450, y: 160}], edges: [{source: 'start', target: 'end'}]});
  dataset = await create('datasets', {name: 'TEST UI shared dataset', input_schema: schema, output_schema: schema, cases: [{id: randomUUID(), name: 'TEST UI multimedia case', inputs: {
    text: {asset_id: text.id, asset_version: 1}, audio: {asset_id: audio.id, asset_version: audio.version}, image: {asset_id: image.id, asset_version: image.version}}, reference_assets: {text: text.id}}]});
  const repo = await create('repositories', {name: 'TEST UI repository edit', url: 'https://github.com/Minecodex/TestFlow.git', branch: 'feature/v0.0.1-beta'});
  const imported = await context.request.post('/api/v1/modules/import', {headers: {'Idempotency-Key': randomUUID()}, multipart: {file: {name: 'repo-bm25.zip', mimeType: 'application/zip', buffer: await fs.readFile('examples/repository-helpdesk/downloads/modules/repo-bm25.zip')}}});
  expect(imported.ok()).toBe(true); const module = await imported.json(); await expect.poll(async () => (await api('GET', '/operations/' + module.operation_id)).state).toBe('succeeded');
  first = await task('TEST UI original media');
  await context.tracing.start({screenshots: true, snapshots: true, sources: false});
  await page.goto('/assets');
  await step('full-image-thumbnail', 'Image assets show decoded complete thumbnails, not cropped words', async () => {
    const img = row(image.name).locator('img'); await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
    expect(await img.evaluate(el => getComputedStyle(el).objectFit)).toBe('contain'); expect((await img.boundingBox()).width).toBeGreaterThanOrEqual(140);
  });
  await step('edit-delete-standardization', 'Resource edit/delete use the same compact icon-and-text buttons', async () => {
    const current = row(text.name), edit = current.locator('.testflow-edit-action'), remove = current.locator('.testflow-delete-action');
    await expect(edit).toContainText('编辑'); await expect(edit.locator('svg')).toHaveCount(1); await expect(remove).toContainText('删除');
    const styles = await current.locator('.testflow-resource-action').evaluateAll(list => list.map(el => {const s = getComputedStyle(el); return {height: el.getBoundingClientRect().height, border: s.borderColor, background: s.backgroundColor, font: s.fontSize};}));
    expect(styles[0]).toEqual(styles[1]);
    await page.goto('/repositories'); await expect(row(repo.name).locator('.testflow-edit-action')).toContainText('编辑');
  });
  await page.goto('/assets/' + text.id);
  await step('enter-tags-deduplicate-remove', 'Enter adds chips, duplicates are ignored, chip removal and IME-safe drafts work', async () => {
    await expect(dialog()).toBeVisible(); const tags = dialog().getByRole('textbox', {name: '标签', exact: true});
    await tags.fill('shared-ui'); await tags.press('Enter'); await expect(dialog().locator('.testflow-tags-input .testflow-tag')).toHaveCount(2);
    await tags.fill(' shared-ui '); await tags.press('Enter'); await expect(dialog().locator('.testflow-tags-input .testflow-tag')).toHaveCount(2);
    await button('删除 original', dialog()).click(); await expect(dialog().locator('.testflow-tags-input .testflow-tag')).toHaveCount(1);
  });
  await step('asset-save-failure-and-retry', 'A failed global save preserves content and tags and succeeds on explicit retry', async () => {
    await dialog().getByRole('textbox', {name: '文字内容', exact: true}).fill('Second shared content');
    await dialog().getByRole('textbox', {name: '参考内容', exact: true}).fill('Second shared content');
    let failed = false; const handler = async route => {if (route.request().method() === 'PUT' && !failed) {failed = true; await route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({code: 'database_unavailable', message: 'Retry the shared asset save'})});} else await route.continue();};
    await page.route('**/api/v1/assets/' + text.id, handler); await button('保存', dialog()).click(); await expect(dialog().getByRole('alert')).toBeVisible();
    await expect(dialog().getByRole('textbox', {name: '文字内容', exact: true})).toHaveValue('Second shared content');
    await button('保存', dialog()).click(); await expect(page.locator('[data-slot="modal-dialog"]')).toHaveCount(0); await page.unroute('**/api/v1/assets/' + text.id, handler);
    text = await read('assets', text.id); expect(text.data.tags).toEqual(['shared-ui']); expect(text.data.text).toBe('Second shared content');
  });
  await page.goto('/datasets/' + dataset.id);
  await step('dataset-rich-media-and-live-reference', 'Cases show playable audio, full images, latest text, category, tags and reference status', async () => {
    await expect(row('TEST UI multimedia case')).toBeVisible(); const current = row('TEST UI multimedia case');
    await expect(current.locator('img')).toBeVisible(); await expect(current.getByText('Second shared content', {exact: true}).first()).toBeVisible();
    await expect(current).toContainText('Shared category'); await expect(current).toContainText('shared-ui');
    await play(current); expect((await read('assets', text.id)).data.text).toBe('Second shared content');
  });
  await step('nested-source-edit', 'Editing source metadata from a case updates the shared pool and returns to the case list', async () => {
    await row('TEST UI multimedia case').locator('[data-asset-id="' + text.id + '"] .testflow-media-open').first().click();
    await dialog().getByRole('textbox', {name: '分类', exact: true}).fill('Changed from dataset'); await button('保存', dialog()).click();
    await expect(page.locator('[data-slot="modal-dialog"]')).toHaveCount(0); await expect(row('TEST UI multimedia case')).toContainText('Changed from dataset');
    expect((await read('assets', text.id)).data.category).toBe('Changed from dataset');
  });
  await step('case-reference-explicit-binding', 'Case editing retains explicit asset standard bindings and uses latest asset selection', async () => {
    const standard = await create('assets', {name: 'TEST UI separate reference', type: 'Text', text: 'Reference material only', reference: 'Second shared content', reference_confirmed: true});
    await row('TEST UI multimedia case').locator('[data-a="edit-case"]').click();
    await expect(dialog().getByText('引用全局素材的最新内容，创建任务时固定实际版本。')).toHaveCount(3);
    await expect(dialog().getByRole('button', {name: 'text · 参考来源', exact: false})).toContainText('素材参考标准');
    await select('text · 参考来源', '素材参考标准 · ' + standard.name);
    await expect(dialog().locator('.testflow-asset-reference-reference')).toContainText('Second shared content');
    await expect(dialog().locator('.testflow-asset-reference-reference')).not.toContainText('Reference material only');
    await button('保存', dialog()).click(); await expect(page.locator('[data-slot="modal-dialog"]')).toHaveCount(0);
    dataset = await read('datasets', dataset.id); expect(dataset.data.cases[0].reference_assets).toEqual({text: standard.id});
  });
  await step('literal-case-opens-editor', 'Literal case content opens its case editor and updates the current case without changing history', async () => {
    const value = dataset.data.cases[0];
    dataset = await patch('datasets', dataset.id, {cases: [{...value, inputs: {...value.inputs, text: {value: 'Literal current content'}}}]});
    await page.goto('/datasets/' + dataset.id); await row('TEST UI multimedia case').getByRole('button', {name: 'Literal current content', exact: true}).first().click();
    await dialog().getByRole('textbox', {name: 'text', exact: true}).fill('Edited literal content'); await button('保存', dialog()).click(); await expect(page.locator('[data-slot="modal-dialog"]')).toHaveCount(0);
    dataset = await read('datasets', dataset.id); expect(dataset.data.cases[0].inputs.text.value).toBe('Edited literal content');
    const edited = dataset.data.cases[0]; dataset = await patch('datasets', dataset.id, {cases: [{...edited, inputs: {...edited.inputs, text: {asset_id: text.id}}}]});
  });
  second = await task('TEST UI updated media');
  await page.goto('/test-tasks/' + second.id);
  await step('task-report-rich-media', 'Real task report rows preview both input and actual output with audio and images', async () => {
    const current = row('TEST UI multimedia case'); await expect(current.locator('img')).toHaveCount(2);
    await expect(current).toContainText('Second shared content'); await expect(current).toContainText('通过');
    await play(current); expect(second.execution.output.text).toBe('Second shared content'); expect(Object.keys(second.execution.snapshot.inputs).sort()).toEqual(['audio','image','text']);
  });
  await step('history-keeps-frozen-content', 'Old execution input/output remains fixed after global edits while a new task uses current content', async () => {
    await page.goto('/test-tasks/' + first.id); const current = row('TEST UI multimedia case');
    await expect(current).toContainText('First shared content'); await expect(current).not.toContainText('Second shared content');
    expect(first.execution.output.text).toBe('First shared content');
    expect(second.execution.snapshot.inputs.text.asset.selected_version).toBeGreaterThan(1);
  });
  await page.goto('/executions');
  await step('execution-history-rich-media-and-one-player', 'Execution history displays input/output and stops the other audio player on playback', async () => {
    await expect(page.locator('tbody tr')).toHaveCount(2); const current = page.locator('tbody tr').first(); await expect(current.locator('img')).toHaveCount(2);
    await play(current); await current.locator('[data-a="play-audio"]').nth(1).click();
    await expect.poll(() => current.locator('audio').evaluateAll(all => all.filter(el => !el.paused).length)).toBe(1);
  });
  await step('wide-table-actions-and-scroll', 'Wide media tables scroll within their panel and keep the actions reachable', async () => {
    await page.setViewportSize({width: 1200, height: 1000});
    const table = page.locator('.testflow-history-table');
    expect(await table.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    const panel = await table.boundingBox(); expect(panel.width).toBeLessThanOrEqual(950);
    const action = page.locator('tbody tr').first().locator('[data-a="execution-detail"]').last();
    const box = await action.boundingBox(); expect(box.x + box.width).toBeLessThanOrEqual(1200);
    await table.hover({position: {x: 400, y: 100}}); await page.mouse.wheel(800, 0);
    await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    await page.setViewportSize({width: 1440, height: 1000});
  });
  await step('edit-source-from-history', 'A historical asset can open the current shared editor without rewriting execution evidence', async () => {
    await page.locator('tbody tr').first().locator('[data-asset-id="' + audio.id + '"] .testflow-edit-action').first().click();
    const tags = dialog().getByRole('textbox', {name: '标签', exact: true}); await tags.fill('history-edited'); await tags.press('Enter'); await button('保存', dialog()).click();
    await expect(page.locator('[data-slot="modal-dialog"]')).toHaveCount(0); expect((await read('assets', audio.id)).data.tags).toContain('history-edited');
    expect((await read('executions', second.execution.id)).output.audio.asset_version).toBe(second.execution.output.audio.asset_version);
  });
  await step('live-audio-after-global-revision', 'A live case audio player remains playable after its source revision changes in the same page', async () => {
    await page.goto('/datasets/' + dataset.id); const current = row('TEST UI multimedia case');
    await current.locator('[data-asset-id="' + audio.id + '"] .testflow-edit-action').click();
    const tags = dialog().getByRole('textbox', {name: '标签', exact: true}); await tags.fill('live-revision'); await tags.press('Enter'); await button('保存', dialog()).click();
    await expect(page.locator('[data-slot="modal-dialog"]')).toHaveCount(0);
    const latest = await read('assets', audio.id);
    await expect(current.locator('audio')).toHaveAttribute('src', new RegExp('version=' + latest.version + '$'));
    await play(current);
  });
  await page.goto('/evaluation-profiles');
  await step('dimensions-collapsed-in-edit', 'Every dimension starts as one summary row; expand/collapse preserves fields', async () => {
    await page.locator('.testflow-profile-card .testflow-edit-action').click();
    await expect(dialog().locator('.testflow-dimension')).toHaveCount(3); await expect(dialog().locator('.testflow-dimension-toggle[aria-expanded="false"]')).toHaveCount(3);
    await dialog().locator('.testflow-dimension-toggle').first().click(); await dialog().getByRole('textbox', {name: '维度名称', exact: true}).fill('完成状态已编辑');
    await dialog().locator('.testflow-dimension-toggle').first().click(); await dialog().locator('.testflow-dimension-toggle').first().click();
    await expect(dialog().getByRole('textbox', {name: '维度名称', exact: true})).toHaveValue('完成状态已编辑');
  });
  await step('new-dimension-starts-collapsed', 'Adding a dimension keeps it collapsed and blocks saving until it has a name', async () => {
    await button('新增维度', dialog()).click(); await expect(dialog().locator('.testflow-dimension-toggle').last()).toHaveAttribute('aria-expanded', 'false');
    await expect(button('保存', dialog())).toBeDisabled(); await dialog().locator('.testflow-dimension').last().locator('.testflow-delete-action').click();
    await button('保存', dialog()).click(); await expect(page.locator('[data-slot="modal-dialog"]')).toHaveCount(0);
  });
  await step('new-profile-collapsed-default', 'New profiles also start with collapsed dimensions', async () => {
    await button('新建评测配置').click(); await expect(dialog().locator('.testflow-dimension-toggle')).toHaveAttribute('aria-expanded', 'false'); await close();
  });
  await page.goto('/modules');
  await step('module-separate-contracts', 'Module cards separate localized input and output groups', async () => {
    const groups = page.locator('.testflow-module-contract-groups'); await expect(groups).toHaveCount(1);
    await expect(groups.getByText('输入字段组', {exact: true})).toBeVisible(); await expect(groups.getByText('输出字段组', {exact: true})).toBeVisible();
    await expect(groups).toContainText('文字');
  });
  await page.goto('/pipelines/' + pipeline.id);
  await step('localized-canvas-and-cards', 'Canvas groups and dataset card headers use localized wording', async () => {
    await expect(page.locator('.testflow-node-fields small').first()).toHaveText('输出');
    await expect(page.locator('.react-flow__node')).toContainText(['开始', '结束']);
    await page.goto('/datasets'); await expect(page.getByText('输入字段组', {exact: true})).toBeVisible(); await expect(page.getByText('输出字段组', {exact: true})).toBeVisible();
    await expect(page.getByText('INPUT SCHEMA', {exact: true})).toHaveCount(0);
  });
  await step('image-editor-rename-keeps-media-type', 'Renaming an image does not break its preview or native content type', async () => {
    await page.goto('/assets/' + image.id); await dialog().getByRole('textbox', {name: '名称', exact: true}).fill('TEST UI image without extension');
    await button('保存', dialog()).click(); image = await read('assets', image.id); const response = await context.request.get('/api/v1/media/' + image.id + '?version=' + image.version);
    expect(response.headers()['content-type']).toBe('image/png'); await expect(row(image.name).locator('img')).toBeVisible();
  });
  await step('both-languages-themes-widths', 'Rich lists, cards and collapsed dimensions fit desktop themes and languages', async () => {
    const routes = [['assets', '/assets'], ['datasets', '/datasets/' + dataset.id], ['report', '/test-tasks/' + second.id], ['history', '/executions'], ['profiles', '/evaluation-profiles'], ['modules', '/modules']];
    for (const width of [1200, 1440, 1920]) for (const locale of ['zh-CN', 'en-US']) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({width, height: 1000}); await page.evaluate(({locale, theme}) => {localStorage.setItem('testflow.locale', locale);localStorage.setItem('testflow.theme', theme);}, {locale, theme});
      for (const [name, route] of routes) {
        await page.goto(route); await expect(page.locator('.testflow-page-heading h1')).toBeVisible();
        if (['assets', 'datasets', 'report', 'history'].includes(name)) await expect(page.locator('tbody tr').first()).toBeVisible();
        if (name === 'modules') await expect(page.locator('.testflow-module-contract-groups')).toBeVisible();
        if (['assets','datasets','report','history'].includes(name)) {
          const images = page.locator('tbody img'); await expect(images).toHaveCount(name === 'history' ? 4 : name === 'report' ? 2 : 1);
          await expect.poll(() => images.evaluateAll(all => all.every(img => img.complete && img.naturalWidth > 0))).toBe(true);
          await expect(page.locator('tbody audio').first()).toHaveAttribute('src', /api\/v1\/media/);
        }
        const geometry = await page.evaluate(() => ({overflow: document.documentElement.scrollWidth > innerWidth + 1, theme: document.documentElement.className})); expect(geometry.overflow).toBe(false);
        const screenshot = await shot(name + '-' + width + '-' + locale + '-' + theme); layouts.push({name,width,locale,theme,...geometry,screenshot});
      }
    }
    expect(errors).toEqual([]);
  });
} catch (error) {failure = error; await shot('failure').catch(() => {});}
finally {
  const trace = path.join(directory, 'private-trace.zip'); await context.tracing.stop({path: trace}).catch(() => {}); await fs.chmod(trace, 0o600).catch(() => {});
  await fs.writeFile(path.join(directory, 'control-cases.json'), JSON.stringify({namespace,passed:!failure,cases,layouts,errors,failure:failure?.message,resources:{text:text?.id,image:image?.id,audio:audio?.id,dataset:dataset?.id,pipeline:pipeline?.id,profile:profile?.id,first:first?.id,second:second?.id}},null,2));
  await browser.close();
}
if (failure) throw failure;
console.log(JSON.stringify({passed:true,cases:cases.length,layouts:layouts.length,errors}));

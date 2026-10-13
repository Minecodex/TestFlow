// Real browser verification of the compact workspace and on-demand editors.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium, expect} from '@playwright/test';
import {waitForPreview} from './browser/fixtures.mjs';

const namespace = process.env.TESTFLOW_E2E_NAMESPACE;
if (!namespace?.startsWith('testflow-e2e-')) throw Error('Disposable Kubernetes namespace required');
const access = JSON.parse(await fs.readFile('.data/kubernetes/' + namespace + '/access.json', 'utf8'));
const directory = path.resolve('.data/acceptance/' + namespace + '/interface-redesign');
await fs.mkdir(directory, {recursive: true, mode: 0o700});
const browser = await chromium.launch();
const context = await browser.newContext({baseURL: access.url, viewport: {width: 1440, height: 1000}, acceptDownloads: true});
const page = await context.newPage();
const cases = [], errors = [], layouts = [];
page.on('pageerror', error => errors.push(error.message));
const dialog = () => page.locator('[data-slot="modal-dialog"]');
const button = (name, scope = page) => scope.getByRole('button', {name, exact: true});
const close = async () => { await dialog().press('Escape'); await expect(dialog()).toHaveCount(0); };
const json = async response => {
  if (!response.ok()) throw Error('API returned ' + response.status() + ' at ' + new URL(response.url()).pathname);
  return response.json();
};
const api = (method, endpoint, data) => context.request.fetch('/api/v1' + endpoint, {method, data}).then(json);
const read = (kind, id) => api('GET', '/' + kind + '/' + id);
const create = (kind, data) => api('POST', '/' + kind, data);
const input = {fields: [{name: 'text', type: 'Text', format: 'UTF-8', stream: false}]};
let profile, pipeline, module, dataset, asset, repository, execution, task;
async function select(label, option, scope = page) {
  await scope.getByRole('button', {name: label, exact: false}).click();
  await page.getByRole('option', {name: option, exact: true}).click();
}
async function shot(name) {
  await page.evaluate(() => window.document.fonts.ready);
  const filename = name + '.png';
  await page.screenshot({path: path.join(directory, filename), fullPage: true});
  return filename;
}
async function step(id, actions, mode, expected, run) {
  const actual = await run();
  cases.push({id, actions, mode, expected, actual: actual || {passed: true}, screenshot: await shot(id), passed: true});
  await fs.writeFile(path.join(directory, 'progress.json'), JSON.stringify({cases: cases.length, latest: id}));
  console.log('PASS ' + id);
}
async function inspect(id) {
  await page.locator('.react-flow__node[data-id="' + id + '"]').click();
  await expect(dialog()).toHaveCount(1);
  await expect(page.locator('.testflow-node-drawer')).toBeVisible();
}
async function fit() {
  await button('适应画布').click();
  await page.waitForTimeout(250);
}
let failure;
try {
  await waitForPreview(context.request, access.url);
  await page.goto('/');
  await page.getByRole('textbox', {name: '密码*', exact: true}).fill(access.password);
  await button('登录').click();
  await expect(page.getByRole('heading', {name: '测试工作台', exact: true})).toBeVisible();
  profile = await create('evaluation-profiles', {name: 'TEST UI compact rules', description: 'Configuration details only', dimensions: [{id: 'completion', name: '完成状态', method: 'completion', actual: {source: 'execution', field: 'state'}, threshold: 1, required: true}]});
  pipeline = await create('pipelines', {name: 'TEST UI compact flow', input_schema: input, output_schema: input, preparation_timeout: 60, cleanup_timeout: 10, nodes: [{id: 'start', kind: 'start', name: '开始节点', x: 50, y: 180, output_schema: input}, {id: 'end', kind: 'end', name: '结束节点', x: 440, y: 180, input_schema: input, output_schema: input}], edges: [{source: 'start', target: 'end'}]});
  repository = await create('repositories', {name: 'TEST UI compact repository', url: 'https://github.com/Minecodex/TestFlow.git', branch: 'feature/v0.0.1-beta'});
  asset = await create('assets', {name: 'TEST UI compact text', type: 'Text', text: 'A real input for the compact interface', format: 'UTF-8'});
  const imported = await context.request.post('/api/v1/modules/import', {headers: {'Idempotency-Key': randomUUID()}, multipart: {file: {name: 'repo-bm25.zip', mimeType: 'application/zip', buffer: await fs.readFile('examples/repository-helpdesk/downloads/modules/repo-bm25.zip')}}});
  module = await json(imported);
  await expect.poll(async () => (await api('GET', '/operations/' + module.operation_id)).state, {timeout: 30000}).toBe('succeeded');
  await context.tracing.start({screenshots: true, snapshots: true, sources: false});

  await page.goto('/executions');
  await step('compact-selects', ['history-filters'], 'normal', 'Dropdowns and indicators use compact shared tokens', async () => {
    await expect(page.locator('[data-slot="select-trigger"]').first()).toBeVisible();
    const measures = await page.locator('[data-slot="select-trigger"]').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element), icon = element.querySelector('.select__indicator');
      return {height: rect.height, border: parseFloat(style.borderWidth), font: parseFloat(style.fontSize), icon: icon?.getBoundingClientRect().width};
    }));
    for (const measure of measures) { expect(measure.height).toBeLessThanOrEqual(34); expect(measure.border).toBe(1); expect(measure.font).toBe(11); expect(measure.icon).toBeLessThanOrEqual(12.1); }
    await page.locator('[data-slot="select-trigger"]').first().click();
    await expect(page.getByRole('listbox')).toBeVisible();
    expect(await page.getByRole('option').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBe(11);
    await page.getByRole('listbox').press('Escape');
    return {measures};
  });
  await step('compact-select-keyboard', ['history-filters'], 'boundary', 'Dropdown keyboard open and Escape preserve selection', async () => {
    const choice = page.locator('[data-slot="select-trigger"]').first(), original = await choice.textContent();
    await choice.focus(); await choice.press('ArrowDown');
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.getByRole('listbox').press('Escape');
    await expect(choice).toBeFocused(); expect(await choice.textContent()).toBe(original);
  });

  await page.goto('/evaluation-profiles');
  const card = () => page.locator('.testflow-profile-card').filter({hasText: profile.name});
  await step('profile-card-summary', ['select-profile', 'edit-profile'], 'normal', 'Cards show rules and model; full details are closed by default', async () => {
    await expect(card()).toHaveCount(1);
    await expect(card()).toContainText('完成状态');
    await expect(card()).toContainText('不使用模型');
    await expect(page.locator('table')).toHaveCount(0);
    await expect(card()).not.toContainText('Configuration details only');
    await expect(card()).not.toContainText('评测提示词');
    const cardBox = await card().boundingBox(), editBox = await button('编辑', card()).boundingBox();
    expect(editBox.x).toBeGreaterThan(cardBox.x + cardBox.width / 2);
    expect(editBox.y).toBeGreaterThan(cardBox.y + cardBox.height / 2);
  });
  await step('profile-readonly-details', ['select-profile'], 'normal', 'Clicking a card opens read-only versioned details and a shareable URL', async () => {
    await card().getByRole('link').click();
    await expect(page).toHaveURL(new RegExp('/evaluation-profiles/' + profile.id));
    await expect(dialog()).toContainText('Configuration details only');
    await expect(dialog().locator('table')).toBeVisible();
    await expect(dialog().getByRole('textbox')).toHaveCount(0);
    await page.reload(); await expect(dialog().locator('table')).toBeVisible();
    await close(); await expect(page).toHaveURL(/\/evaluation-profiles$/);
  });
  await step('profile-edit-failure-and-retry', ['edit-profile'], 'boundary', 'Editing opens a form; a failed save preserves fields and retries', async () => {
    await button('编辑', card()).click();
    const name = dialog().getByRole('textbox', {name: '名称', exact: true});
    await name.fill(profile.name + ' updated');
    let failed = false;
    const pattern = '**/api/v1/evaluation-profiles/' + profile.id;
    const failOnce = async route => {
      if (route.request().method() === 'PUT' && !failed) {
        failed = true;
        await route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({code: 'database_unavailable', message: 'Temporary test error'})});
      } else await route.continue();
    };
    await page.route(pattern, failOnce);
    await button('保存', dialog()).click(); await expect(dialog().getByRole('alert')).toBeVisible(); await expect(name).toHaveValue(profile.name + ' updated');
    await button('保存', dialog()).click(); await expect(dialog()).toHaveCount(0);
    await page.unroute(pattern, failOnce);
    profile = await read('evaluation-profiles', profile.id); expect(profile.version).toBe(2);
  });
  await step('profile-edit-conflict', ['edit-profile'], 'boundary', 'A real version conflict retains the draft and supports merging onto the latest version', async () => {
    await button('编辑', card()).click();
    const name = dialog().getByRole('textbox', {name: '名称', exact: true});
    await name.fill(profile.name + ' merged');
    await api('PUT', '/evaluation-profiles/' + profile.id, {expected_version: profile.version, data: {...profile.data, description: 'Concurrent revision'}});
    await button('保存', dialog()).click(); await expect(button('查看最新版本', dialog())).toBeVisible();
    await expect(name).toHaveValue(profile.name + ' merged');
    await button('查看最新版本', dialog()).click();
    await button('保留草稿并继续编辑', dialog().last()).click(); await expect(dialog()).toHaveCount(1); await button('保存', dialog()).click(); await expect(dialog()).toHaveCount(0);
    profile = await read('evaluation-profiles', profile.id); expect(profile.version).toBe(4);
  });

  await page.goto('/pipelines/' + pipeline.id);
  await step('canvas-default', ['toggle-node-library'], 'normal', 'Canvas uses all available width with both side panels and timeout fields initially closed', async () => {
    await expect(page.locator('.testflow-palette')).toHaveCount(0); await expect(page.locator('.testflow-inspector')).toHaveCount(0); await expect(dialog()).toHaveCount(0);
    await expect(page.getByLabel('准备超时（秒）')).toHaveCount(0);
    const container = await page.locator('.testflow-designer').boundingBox(), canvas = await page.locator('.testflow-canvas').boundingBox();
    expect(canvas.width).toBeGreaterThan(container.width - 4);
    expect(await page.locator('[data-a="toggle-node-library"]').getAttribute('aria-expanded')).toBe('false');
  });
  await step('library-toggle-search-and-add', ['toggle-node-library', 'add-node'], 'normal', 'The top-right plus opens a searchable library; choosing a module adds one node', async () => {
    await button('添加节点').click(); await expect(page.locator('.testflow-palette')).toBeVisible();
    await page.getByRole('textbox', {name: '搜索模块', exact: true}).fill('does not exist'); await expect(page.locator('.testflow-palette')).toContainText('没有匹配结果');
    await page.getByRole('textbox', {name: '搜索模块', exact: true}).fill('BM25'); await button(module.name, page.locator('.testflow-palette')).click();
    await expect(page.locator('.react-flow__node')).toHaveCount(3); await expect(page.locator('.testflow-palette')).toHaveCount(0);
    await fit();
    await page.locator('.react-flow__node').filter({hasText: module.name}).click(); await expect(dialog()).toContainText('模块参数');
    await expect(dialog().getByRole('button', {name: '仓库挂载（可选）', exact: false})).toBeVisible();
    await button('删除节点', dialog()).click(); await expect(dialog()).toHaveCount(0); await expect(page.locator('.react-flow__node')).toHaveCount(2);
  });
  await step('library-escape', ['toggle-node-library'], 'boundary', 'Closing the library does not change the graph', async () => {
    await button('添加节点').click(); await page.getByRole('textbox', {name: '搜索模块', exact: true}).press('Escape');
    await expect(page.locator('.testflow-palette')).toHaveCount(0); await expect(page.locator('.react-flow__node')).toHaveCount(2);
  });
  await step('node-drag-without-drawer', ['canvas-drag'], 'normal', 'Dragging moves the node without opening a configuration drawer', async () => {
    await fit(); const node = page.locator('.react-flow__node[data-id="start"]'), before = await node.boundingBox();
    const head = await node.locator('.testflow-node-head').boundingBox();
    await page.mouse.move(head.x + head.width / 2, head.y + head.height / 2); await page.mouse.down(); await page.mouse.move(head.x + head.width / 2 + 70, head.y + head.height / 2 + 40, {steps: 15}); await page.mouse.up();
    await expect(dialog()).toHaveCount(0); const after = await node.boundingBox(); expect(after.x).toBeGreaterThan(before.x + 30);
  });
  await step('start-contract-in-drawer', ['flow-schema'], 'normal', 'Clicking Start opens the right drawer and edits only the input contract', async () => {
    await inspect('start'); await expect(dialog().getByRole('heading', {name: '输入字段组', exact: true})).toBeVisible(); await expect(dialog().getByRole('heading', {name: '输出字段组', exact: true})).toHaveCount(0);
    await dialog().getByRole('textbox', {name: '字段名', exact: true}).fill('query');
    await dialog().getByRole('textbox', {name: '节点名称', exact: true}).fill('开始输入');
    await close(); await expect(page.locator('.react-flow__node[data-id="start"]')).toContainText('query');
  });
  await step('shared-end-contract-in-drawer', ['flow-schema'], 'normal', 'Editing an end output updates every end node', async () => {
    await button('添加节点').click(); await button('结束节点', page.locator('.testflow-palette')).click(); await expect(page.locator('.react-flow__node')).toHaveCount(3); await fit();
    await inspect('end'); await expect(dialog().getByRole('heading', {name: '输出字段组', exact: true})).toBeVisible(); await expect(dialog().getByRole('heading', {name: '输入字段组', exact: true})).toHaveCount(0);
    await dialog().getByRole('textbox', {name: '字段名', exact: true}).fill('query'); await close();
    const endNodes = page.locator('.react-flow__node').filter({has: page.locator('.testflow-node-end')}); await expect(endNodes).toHaveCount(2);
    for (const node of await endNodes.all()) await expect(node).toContainText('query');
    const extra = page.locator('.react-flow__node').filter({has: page.locator('.testflow-node-end')}).filter({hasNot: page.locator('[data-id="end"]')});
    const ids = await endNodes.evaluateAll(elements => elements.map(el => el.getAttribute('data-id')));
    await inspect(ids.find(id => id !== 'end')); await button('删除节点', dialog()).click();
  });
  await step('settings-cancel-and-validation', ['flow-settings'], 'boundary', 'Timeout settings are isolated until saved; invalid values cannot apply', async () => {
    await button('流程设置').click(); await dialog().getByLabel('准备超时（秒）').fill('0'); await expect(button('保存', dialog())).toBeDisabled(); await expect(dialog().getByRole('alert')).toBeVisible(); await button('取消', dialog()).click();
    await button('流程设置').click(); await expect(dialog().getByLabel('准备超时（秒）')).toHaveValue('60'); await dialog().getByLabel('准备超时（秒）').fill('120'); await button('取消', dialog()).click();
    await button('流程设置').click(); await expect(dialog().getByLabel('准备超时（秒）')).toHaveValue('60'); await close();
  });
  await step('settings-save-version-and-reload', ['flow-settings', 'save-flow'], 'normal', 'Settings and both node contracts save in the version and survive reload', async () => {
    await button('流程设置').click(); await dialog().getByLabel('准备超时（秒）').fill('120'); await dialog().getByLabel('独立收尾超时（秒）').fill('20'); await button('保存', dialog()).click(); await expect(dialog()).toHaveCount(0);
    await button('保存', page.locator('.testflow-page-heading')).click();
    await expect.poll(async () => (await read('pipelines', pipeline.id)).version).toBe(2);
    pipeline = await read('pipelines', pipeline.id); expect(pipeline.data.preparation_timeout).toBe(120); expect(pipeline.data.cleanup_timeout).toBe(20); expect(pipeline.data.input_schema.fields[0].name).toBe('query'); expect(pipeline.data.output_schema.fields[0].name).toBe('query');
    await page.reload(); await expect(page.locator('.testflow-palette')).toHaveCount(0); await button('流程设置').click(); await expect(dialog().getByLabel('准备超时（秒）')).toHaveValue('120'); await close();
  });
  await step('node-drawer-save-shortcut', ['save-flow'], 'normal', 'Ctrl-S in the node drawer saves its edited parameters without closing the drawer', async () => {
    await inspect('start'); const name = dialog().getByRole('textbox', {name: '节点名称', exact: true}); await name.fill('开始输入 v3'); await name.press('Control+s');
    await expect.poll(async () => (await read('pipelines', pipeline.id)).version).toBe(3); await expect(dialog()).toHaveCount(1); await close(); pipeline = await read('pipelines', pipeline.id);
  });
  await step('node-drawer-save-failure-and-retry', ['save-flow'], 'boundary', 'Shortcut save errors are visible inside the drawer and retain the draft for retry', async () => {
    await inspect('start');
    const name = dialog().getByRole('textbox', {name: '节点名称', exact: true});
    await name.fill('开始输入 v4');
    let failed = false;
    const pattern = '**/api/v1/pipelines/' + pipeline.id;
    const failOnce = async route => {
      if (route.request().method() === 'PUT' && !failed) { failed = true; await route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({code: 'database_unavailable', message: 'Test failure'})}); }
      else await route.continue();
    };
    await page.route(pattern, failOnce);
    await name.press('Control+s');
    await expect(dialog().getByRole('alert')).toBeVisible();
    await expect(name).toHaveValue('开始输入 v4');
    expect((await read('pipelines', pipeline.id)).version).toBe(3);
    await name.press('Control+s');
    await expect.poll(async () => (await read('pipelines', pipeline.id)).version).toBe(4);
    await page.unroute(pattern, failOnce); await close(); pipeline = await read('pipelines', pipeline.id);
  });
  await step('real-quick-execution', ['quick-run'], 'normal', 'The saved canvas still runs and produces a real completed execution', async () => {
    await button('快速运行').click(); await select('评测配置', profile.name, dialog());
    const text = dialog().getByRole('textbox', {name: 'query', exact: true}); await text.fill('Actual UI execution');
    await button('快速运行', dialog()).click(); await expect(page).toHaveURL(/\/executions\/[a-f0-9-]+/);
    execution = await api('GET', '/executions/' + new URL(page.url()).pathname.split('/').pop());
    await expect.poll(async () => (await api('GET', '/executions/' + execution.id)).state, {timeout: 30000}).toBe('succeeded');
    expect((await api('GET', '/executions/' + execution.id)).output.query).toBe('Actual UI execution');
  });
  dataset = await create('datasets', {name: 'TEST UI compact dataset', input_schema: pipeline.data.input_schema, output_schema: pipeline.data.output_schema, cases: [{id: randomUUID(), name: 'Compact flow case', inputs: {query: {value: 'Task UI test'}}}]});
  task = await json(await context.request.post('/api/v1/tasks', {headers: {'Idempotency-Key': randomUUID()}, data: {name: 'TEST UI compact task', profile_id: profile.id, profile_version: profile.version, pairs: [{dataset_id: dataset.id, dataset_version: dataset.version, pipeline_id: pipeline.id, pipeline_version: pipeline.version}]}}));
  await expect.poll(async () => (await read('tasks', task.id)).state, {timeout: 30000}).toBe('completed');

  const resources = [{kind: 'repositories', route: '/repositories', label: '代码仓库', resource: repository}, {kind: 'modules', route: '/modules', label: '能力模块', resource: module}, {kind: 'assets', route: '/assets', label: '素材池', resource: asset}, {kind: 'datasets', route: '/datasets', label: '测试集', resource: dataset}, {kind: 'pipelines', route: '/pipelines', label: '流程画布', resource: pipeline}, {kind: 'evaluation-profiles', route: '/evaluation-profiles', label: '评测配置', resource: profile}, {kind: 'tasks', route: '/test-tasks/' + task.id, label: '测试任务', resource: task}];
  for (const item of resources) {
    await page.goto(item.route);
    await step('delete-and-restore-' + item.kind, ['hide-resource', 'confirm-hide', 'hidden-resources', 'restore-resource'], 'normal', 'Delete is explicitly labeled and recoverable for ' + item.kind, async () => {
      const action = button('删除 ' + item.resource.name); await expect(action).toBeVisible(); await expect(action).toHaveText(/删除/); await expect(action.locator('svg[class*="trash"]')).toHaveCount(1);
      await action.click(); await expect(dialog()).toContainText('回收站'); await button('取消', dialog()).click(); expect((await read(item.kind, item.resource.id)).hidden).toBe(false);
      await action.click(); await button('确认删除', dialog()).click(); await expect(dialog()).toHaveCount(0); expect((await read(item.kind, item.resource.id)).hidden).toBe(true);
      await button('回收站').click(); await select('类型', item.label, dialog()); await button('恢复 ' + item.resource.name, dialog()).click(); await dialog().last().getByRole('button', {name: '恢复', exact: true}).click();
      await expect(dialog()).toHaveCount(1); expect((await read(item.kind, item.resource.id)).hidden).toBe(false); await close();
    });
  }
  await page.goto('/evaluation-profiles');
  await step('delete-failure-retains-resource', ['hide-resource', 'confirm-hide'], 'boundary', 'Failed deletion keeps the resource and can be retried or cancelled', async () => {
    await button('删除 ' + profile.name).click();
    const pattern = '**/api/v1/evaluation-profiles/' + profile.id + '/hide';
    await page.route(pattern, route => route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({code: 'database_unavailable', message: 'Test failure'})}));
    await button('确认删除', dialog()).click(); await expect(dialog().getByRole('alert')).toBeVisible(); expect((await read('evaluation-profiles', profile.id)).hidden).toBe(false); await page.unroute(pattern); await button('取消', dialog()).click(); await expect(card()).toHaveCount(1);
  });
  await step('recycle-bin-resource-types', ['hidden-resources'], 'boundary', 'Recycle bin lists only resource types, excluding overview and execution history', async () => {
    await button('回收站').click(); await dialog().getByRole('button', {name: '类型', exact: false}).click(); await expect(page.getByRole('option')).toHaveCount(7); await expect(page.getByRole('option', {name: '测试工作台', exact: true})).toHaveCount(0); await page.getByRole('listbox').press('Escape'); await close();
  });

  const pages = ['/', '/repositories', '/modules', '/assets', '/datasets', '/pipelines', '/evaluation-profiles', '/test-tasks', '/executions'];
  await step('all-page-headings-compact', ['page-layout'], 'normal', 'Every main page removes intro paragraphs and English numbering', async () => {
    for (const route of pages) {
      await page.goto(route); await expect(page.locator('.testflow-page-heading h1')).toBeVisible(); await expect(page.locator('.testflow-page-heading p')).toHaveCount(0); await expect(page.locator('.testflow-page-heading .testflow-eyebrow')).toHaveCount(0);
      expect((await page.locator('.testflow-page-heading').boundingBox()).height).toBeLessThan(50); await shot('page-' + (route.slice(1) || 'overview'));
    }
  });
  await step('desktop-themes-and-languages', ['page-layout'], 'normal', 'The changed pages fit desktop widths, both languages and themes', async () => {
    for (const width of [1200, 1440, 1920]) for (const locale of ['zh-CN', 'en-US']) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({width, height: 1000});
      await page.evaluate(({locale, theme}) => { localStorage.setItem('testflow.locale', locale); localStorage.setItem('testflow.theme', theme); }, {locale, theme});
      for (const [name, route] of [['profiles', '/evaluation-profiles'], ['canvas', '/pipelines/' + pipeline.id], ['history', '/executions']]) {
        await page.goto(route); await expect(page.locator('.testflow-page-heading h1')).toBeVisible();
        const geometry = await page.evaluate(() => ({overflow: document.documentElement.scrollWidth > innerWidth + 1, theme: document.documentElement.className})); expect(geometry.overflow).toBe(false);
        const screenshot = await shot(name + '-' + width + '-' + locale + '-' + theme); layouts.push({name, width, locale, theme, ...geometry, screenshot});
      }
    }
    expect(errors).toEqual([]);
    return {layouts: layouts.length, javascriptErrors: errors};
  });
} catch (error) { failure = error; await shot('failure').catch(() => {}); }
finally {
  const trace = path.join(directory, 'private-trace.zip');
  await context.tracing.stop({path: trace}).catch(() => {}); await fs.chmod(trace, 0o600).catch(() => {});
  await fs.writeFile(path.join(directory, 'control-cases.json'), JSON.stringify({namespace, passed: !failure, cases, layouts, errors, failure: failure?.message, resources: {profile: profile?.id, pipeline: pipeline?.id, execution: execution?.id, task: task?.id}}, null, 2));
  await browser.close();
}
if (failure) throw failure;
console.log(JSON.stringify({passed: true, cases: cases.length, layouts: layouts.length, directory}));

// Asset package and portable dataset controls against an actual Kubernetes installation.
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium, expect} from '@playwright/test';
import {waitForPreview} from './browser/fixtures.mjs';

const namespace = process.env.TESTFLOW_E2E_NAMESPACE;
if (!namespace?.startsWith('testflow-e2e-')) throw Error('Disposable Kubernetes workspace required');
const access = JSON.parse(await fs.readFile('.data/kubernetes/' + namespace + '/access.json', 'utf8'));
const result = JSON.parse(await fs.readFile('.data/acceptance/' + namespace + '/data-transfer.json', 'utf8'));
if (!result.passed) throw Error('Complete the Kubernetes data and example scenarios first');
const directory = path.resolve('.data/acceptance/' + namespace + '/data-ui-' + Date.now());
await fs.mkdir(directory, {recursive: true, mode: 0o700});
const browser = await chromium.launch();
const context = await browser.newContext({baseURL: access.url, viewport: {width: 1440, height: 1000}});
const page = await context.newPage();
const checks = [];
const dialog = () => page.getByRole('dialog');
const button = (name, scope = page) => name === '关闭' ? scope.getByRole('button', {name, exact: true}).filter({hasText: '关闭'}) : scope.getByRole('button', {name, exact: true});
const document = JSON.parse(await fs.readFile('examples/repository-helpdesk/datasets/text.dataset.json', 'utf8'));
const jsonFile = value => ({name: 'text.dataset.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value))});
const fileInput = () => dialog().getByLabel('选择测试集 JSON', {exact: true});
async function screenshot(name) {
  await page.evaluate(() => window.document.fonts.ready);
  await page.screenshot({path: path.join(directory, name + '.png'), fullPage: true});
}
async function step(name, run) { await run(); await screenshot(name); checks.push({name, passed: true}); }
async function saveDownload(event, name) { const downloaded = await event; await downloaded.saveAs(path.join(directory, name)); return downloaded; }
let failure;
try {
  await waitForPreview(context.request, access.url);
  await page.goto('/');
  await page.getByRole('textbox', {name: '密码*', exact: true}).fill(access.password);
  await button('登录').click();
  await expect(page.getByRole('heading', {name: '测试工作台', exact: true})).toBeVisible();
  await context.tracing.start({screenshots: true, snapshots: true, sources: false});
  await page.goto('/test-tasks/' + result.installed.task.id);
  await step('four_imported_dataset_cases_have_real_passed_reports', async () => {
    for (const modality of ['retrieval', 'text', 'voice', 'image']) {
      const row = page.getByRole('row').filter({hasText: 'Refund policy · ' + modality});
      await expect(row.getByText('成功', {exact: true})).toBeVisible();
      await expect(row.getByText('通过', {exact: true})).toBeVisible();
    }
  });
  await page.goto('/assets');
  await step('asset_package_empty_and_invalid_are_disabled', async () => {
    await button('导入素材包').click();
    await expect(button('导入素材包', dialog())).toBeDisabled();
    await dialog().getByLabel('选择素材包 ZIP').setInputFiles({name: 'bad.zip', mimeType: 'application/zip', buffer: Buffer.from('bad')});
    await expect(dialog().getByRole('alert')).toBeVisible();
    await expect(button('导入素材包', dialog())).toBeDisabled();
  });
  await step('asset_package_preview_and_close_preserve_file', async () => {
    await dialog().getByLabel('选择素材包 ZIP').setInputFiles('examples/repository-helpdesk/downloads/assets/helpdesk.assets.zip');
    await expect(dialog().getByText('将复用固定修订', {exact: true})).toHaveCount(3);
    await button('关闭', dialog()).click();
    await button('导入素材包').click();
    await expect(dialog()).toContainText('helpdesk.assets.zip');
    await expect(button('导入素材包', dialog())).toBeEnabled();
  });
  await step('asset_import_pending_blocks_close_and_duplicate_submit', async () => {
    let start, release, count = 0;
    const started = new Promise(resolve => start = resolve), held = new Promise(resolve => release = resolve);
    const handler = async route => { count++; start(); await held; await route.continue(); };
    await page.route('**/api/v1/assets/import', handler);
    try {
      await button('导入素材包', dialog()).click(); await started;
      await expect(button('导入素材包', dialog())).toBeDisabled();
      await expect(button('关闭', dialog())).toBeDisabled();
      await expect(dialog().getByLabel('选择素材包 ZIP')).toBeDisabled();
      await dialog().press('Escape'); await expect(dialog()).toBeVisible();
    } finally { release(); }
    await expect(dialog().getByText('已复用', {exact: true})).toHaveCount(3);
    expect(count).toBe(1);
    await expect(button('导入素材包', dialog())).toBeDisabled();
    await page.unroute('**/api/v1/assets/import', handler);
  });
  await button('关闭', dialog()).click();
  await step('asset_export_selection_clear_and_real_zip_download', async () => {
    await button('导出素材包').click();
    await expect(button('导出素材包', dialog())).toBeDisabled();
    await button('全选素材', dialog()).click();
    await expect(button('导出素材包', dialog())).toBeEnabled();
    await button('清空选择', dialog()).click();
    await expect(button('导出素材包', dialog())).toBeDisabled();
    await dialog().getByRole('textbox', {name: '筛选素材名称', exact: true}).fill('no matching asset');
    await expect(dialog()).toContainText('暂无数据');
    await dialog().getByRole('textbox', {name: '筛选素材名称', exact: true}).fill('Helpdesk example');
    await expect(dialog().getByRole('checkbox')).toHaveCount(3);
    for (const name of ['query.txt', 'question.wav', 'question.png']) {
      await dialog().getByText(new RegExp('Helpdesk example · ' + name)).click();
      await expect(dialog().getByRole('checkbox', {name: new RegExp('Helpdesk example · ' + name)})).toBeChecked();
    }
    const event = page.waitForEvent('download');
    await button('导出素材包', dialog()).click();
    const downloaded = await saveDownload(event, 'exported.assets.zip');
    expect(downloaded.suggestedFilename()).toBe('testflow-assets.zip');
    await expect(dialog()).toContainText('素材包已下载');
  });
  await step('asset_export_failure_can_retry_without_losing_selection', async () => {
    await page.route('**/api/v1/assets/export', route => route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({code: 'database_unavailable', message: 'retry export'})}), {times: 1});
    await button('导出素材包', dialog()).click(); await expect(dialog().getByRole('alert')).toBeVisible();
    await expect(button('导出素材包', dialog())).toBeEnabled();
    const event = page.waitForEvent('download'); await button('导出素材包', dialog()).click(); await saveDownload(event, 'retry.assets.zip');
  });
  await button('关闭', dialog()).click();
  await page.goto('/datasets');
  await step('dataset_invalid_json_and_shape_are_disabled', async () => {
    await button('导入测试集').click(); await expect(button('导入测试集', dialog())).toBeDisabled();
    await fileInput().setInputFiles({name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{bad')});
    await expect(dialog()).toContainText('请选择有效的');
    await fileInput().setInputFiles(jsonFile({format: 'testflow.dataset.v1', dataset: {name: 'Malformed'}}));
    await expect(dialog()).toContainText('请选择有效的');
    await expect(button('导入测试集', dialog())).toBeDisabled();
  });
  await step('dataset_missing_digest_blocks_import', async () => {
    const broken = structuredClone(document); broken.assets[0].revision_digest = '0'.repeat(64);
    await fileInput().setInputFiles(jsonFile(broken));
    await expect(dialog()).toContainText('请先导入配套素材包');
    await expect(button('导入测试集', dialog())).toBeDisabled();
  });
  await step('dataset_draft_survives_close_navigation_and_reload', async () => {
    await fileInput().setInputFiles(jsonFile(document));
    await expect(dialog()).toContainText('结构与素材绑定已通过校验');
    await dialog().getByRole('textbox', {name: '名称', exact: true}).fill('Browser imported portable dataset');
    const key = await page.evaluate(() => JSON.parse(localStorage.getItem('testflow.dataset-import-draft.v1')).key);
    await button('取消', dialog()).click(); await page.goto('/assets'); await page.goto('/datasets'); await page.reload();
    await button('导入测试集').click(); await expect(dialog()).toContainText('text.dataset.json');
    await expect(dialog().getByRole('textbox', {name: '名称', exact: true})).toHaveValue('Browser imported portable dataset');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('testflow.dataset-import-draft.v1')).key)).toBe(key);
    await expect(button('导入测试集', dialog())).toBeEnabled();
  });
  await step('dataset_preview_failure_disables_submit_and_refresh_recovers', async () => {
    await page.route('**/api/v1/datasets/import/preview', route => route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({code: 'database_unavailable', message: 'retry preview'})}), {times: 1});
    await button('刷新', dialog()).click(); await expect(dialog().getByRole('alert')).toBeVisible();
    await expect(button('导入测试集', dialog())).toBeDisabled();
    await button('刷新', dialog()).click(); await expect(button('导入测试集', dialog())).toBeEnabled();
  });
  await step('dataset_committed_response_loss_retries_same_idempotent_resource', async () => {
    let committed, start, release;
    const started = new Promise(resolve => start = resolve), held = new Promise(resolve => release = resolve);
    await page.route('**/api/v1/datasets/import', async route => {
      const actual = await route.fetch(); committed = (await actual.json()).id;
      start(); await held;
      await route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({code: 'response_lost', message: 'response lost after commit'})});
    }, {times: 1});
    try {
      await button('导入测试集', dialog()).click(); await started;
      await expect(button('导入测试集', dialog())).toBeDisabled();
      await expect(button('取消', dialog())).toBeDisabled();
      await expect(fileInput()).toBeDisabled();
      await expect(dialog().getByRole('textbox', {name: '名称', exact: true})).toBeDisabled();
      await dialog().press('Escape'); await expect(dialog()).toBeVisible();
    } finally { release(); }
    await expect(dialog().getByRole('alert')).toBeVisible();
    await expect(dialog()).toContainText('text.dataset.json');
    await button('导入测试集', dialog()).click(); await expect(page).toHaveURL(new RegExp('/datasets/' + committed + '$'));
    await expect(page.getByRole('heading', {name: 'Browser imported portable dataset', exact: true})).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('testflow.dataset-import-draft.v1'))).toBeNull();
  });
  await step('dataset_real_export_download_contains_portable_fixed_references', async () => {
    const event = page.waitForEvent('download'); await button('导出测试集').click(); await saveDownload(event, 'exported.dataset.json');
    const value = JSON.parse(await fs.readFile(path.join(directory, 'exported.dataset.json'), 'utf8'));
    expect(value.format).toBe('testflow.dataset.v1'); expect(value.dataset.cases).toHaveLength(1);
    expect(value.assets[0].revision_digest).toBe(document.assets[0].revision_digest);
    for (const asset of Object.values(result.installed.assets)) expect(JSON.stringify(value)).not.toContain(asset.id);
  });
  await step('dataset_export_failure_retries', async () => {
    await page.route('**/api/v1/datasets/*/export?*', route => route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({code: 'database_unavailable', message: 'retry dataset export'})}), {times: 1});
    await button('导出测试集').click(); await expect(page.getByRole('alert')).toBeVisible();
    const event = page.waitForEvent('download'); await button('导出测试集').click(); await saveDownload(event, 'retry.dataset.json');
  });
  await step('dataset_companion_assets_export_pins_old_revision_after_annotations_change', async () => {
    const id = result.installed.assets.query.id;
    const actual = await context.request.get(access.url + '/api/v1/assets/' + id);
    const resource = await actual.json();
    const changed = await context.request.put(access.url + '/api/v1/assets/' + id, {data: {expected_version: resource.version, data: {...resource.data, tags: [...resource.data.tags, 'later-ui-annotation-' + Date.now()]}}});
    expect(changed.status()).toBe(200);
    const event = page.waitForEvent('download'); await button('导出配套素材').click(); await saveDownload(event, 'dataset-companion.assets.zip');
    const bytes = await fs.readFile(path.join(directory, 'dataset-companion.assets.zip'));
    const validated = await context.request.post(access.url + '/api/v1/assets/import/preview', {multipart: {file: {name: 'companion.zip', mimeType: 'application/zip', buffer: bytes}}});
    expect(validated.status()).toBe(200);
    const entry = (await validated.json()).items[0];
    expect(entry.revision_digest).toBe(document.assets[0].revision_digest);
    expect(entry.resource).toEqual({id, version: 1});
  });
  await step('dataset_companion_export_failure_retries', async () => {
    await page.route('**/api/v1/assets/export', route => route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({code: 'database_unavailable', message: 'retry companion export'})}), {times: 1});
    await button('导出配套素材').click(); await expect(page.getByRole('alert')).toBeVisible();
    const event = page.waitForEvent('download'); await button('导出配套素材').click(); await saveDownload(event, 'retry-companion.assets.zip');
  });
  await step('desktop_bilingual_theme_layouts_have_no_horizontal_overflow', async () => {
    const layouts = [];
    const detail = new URL(page.url()).pathname;
    for (const width of [1200, 1440, 1920]) for (const locale of ['zh-CN', 'en-US']) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({width, height: 1000});
      await page.evaluate(({locale, theme}) => { localStorage.setItem('testflow.locale', locale); localStorage.setItem('testflow.theme', theme); }, {locale, theme});
      for (const resource of ['assets', 'datasets', 'dataset-detail']) {
        await page.goto(resource === 'dataset-detail' ? detail : '/' + resource);
        await expect(page.locator('h1')).toBeVisible();
        await page.evaluate(() => window.document.fonts.ready);
        const geometry = await page.evaluate(() => ({width: innerWidth, scroll: window.document.documentElement.scrollWidth}));
        expect(geometry.scroll).toBeLessThanOrEqual(width);
        const name = `${resource}-${width}-${locale}-${theme}`; await screenshot(name); layouts.push({name, ...geometry});
      }
    }
    await fs.writeFile(path.join(directory, 'layouts.json'), JSON.stringify(layouts, null, 2));
  });
} catch (error) { failure = {type: error.name, message: String(error.message).slice(0, 2500)}; await screenshot('failure').catch(() => {}); throw error; }
finally {
  await context.tracing.stop({path: path.join(directory, 'private-trace.zip')}).catch(() => {});
  await fs.chmod(path.join(directory, 'private-trace.zip'), 0o600).catch(() => {});
  const outcome = {namespace, directory, passed: !failure, checks, error: failure};
  await fs.writeFile(path.join(directory, 'result.json'), JSON.stringify(outcome, null, 2));
  await fs.writeFile('.data/acceptance/' + namespace + '/data-ui.json', JSON.stringify(outcome, null, 2));
  await browser.close();
}
console.log(JSON.stringify({passed: true, checks: checks.length, directory}));

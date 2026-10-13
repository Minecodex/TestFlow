// Actual browser outcomes for portable workflow import/export and repository-code execution.
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium,expect} from '@playwright/test';
import {controlsUI} from './browser/control-ledger.mjs';
import {waitForPreview} from './browser/fixtures.mjs';

const namespace=process.env.TESTFLOW_E2E_NAMESPACE;
if(!namespace?.startsWith('testflow-e2e-'))throw Error('Disposable Kubernetes workspace required');
const access=JSON.parse(await fs.readFile('.data/kubernetes/'+namespace+'/access.json','utf8'));
const result=JSON.parse(await fs.readFile('.data/acceptance/'+namespace+'/repository-workflows.json','utf8'));
if(!result.passed)throw Error('Complete the actual repository-code scenarios first');
const directory=path.resolve('.data/acceptance/'+namespace+'/workflow-ui-'+Date.now());
await fs.mkdir(directory,{recursive:true,mode:0o700});
const browser=await chromium.launch();
const context=await browser.newContext({baseURL:access.url,viewport:{width:1440,height:1000}});
const page=await context.newPage();
const ui=controlsUI(page,access.url);
const checks=[];
let error;
async function capture(name) {
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:path.join(directory,name+'.png'),fullPage:true});
  return name+'.png';
}
async function step(name,run) {await run();checks.push({name,passed:true,screenshot:await capture(name)});}
const dialog=()=>page.getByRole('dialog');
const button=(name,scope=page)=>scope.getByRole('button',{name,exact:true});
const jsonFile=value=>({name:'example.workflow.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
const document=JSON.parse(await fs.readFile('examples/repository-helpdesk/workflows/text.workflow.json','utf8'));
const upload=value=>dialog().getByLabel('流程 JSON 文件',{exact:true}).setInputFiles(jsonFile(value));
try {
  await waitForPreview(context.request,access.url);
  await page.goto('/');
  await page.getByRole('textbox',{name:'密码*',exact:true}).fill(access.password);
  await button('登录').click();
  await expect(page.getByRole('heading',{name:'测试工作台',exact:true})).toBeVisible();
  // Start after authentication so the shareable trace has no password entry.
  await context.tracing.start({screenshots:true,snapshots:true,sources:false});
  await page.goto('/test-tasks/'+result.resources.task);
  await step('real_four_workflow_report',async()=>{
    for(const modality of ['retrieval','text','voice','image']) {
      const row=page.getByRole('row').filter({hasText:'Repository code / '+modality});
      await expect(row.getByText('成功',{exact:true})).toBeVisible();
      await expect(row.getByText('通过',{exact:true})).toBeVisible();
    }
  });
  await page.goto('/pipelines');
  await step('empty_import_disabled',async()=>{
    await button('导入流程').click();
    await expect(button('导入流程',dialog())).toBeDisabled();
  });
  await step('invalid_json_retains_dialog',async()=>{
    await dialog().getByLabel('流程 JSON 文件',{exact:true}).setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{bad')});
    await expect(dialog()).toContainText('请选择有效的流程 JSON 文件');
    await expect(button('导入流程',dialog())).toBeDisabled();
  });
  await step('missing_digest_prevents_import',async()=>{
    const missing=structuredClone(document);missing.modules[0].package_digest='0'.repeat(64);
    await upload(missing);
    await expect(dialog()).toContainText('缺少依赖');
    await expect(button('导入流程',dialog())).toBeDisabled();
  });
  await step('credentials_require_explicit_binding',async()=>{
    await upload(document);
    await expect(dialog().getByRole('button',{name:/凭据 · Kimi Code/})).toBeVisible();
    await expect(button('导入流程',dialog())).toBeDisabled();
    await ui.select('凭据 · Kimi Code','Kimi Code',dialog());
    await expect(dialog()).toContainText('依赖与图校验通过');
    await expect(button('导入流程',dialog())).toBeEnabled();
  });
  await step('cancel_reopens_same_file_and_binding',async()=>{
    const before=(await ui.api('get','/pipelines')).total;
    await button('取消',dialog()).click();
    await expect(dialog()).toHaveCount(0);
    await button('导入流程').click();
    await expect(dialog()).toContainText('example.workflow.json');
    await expect(dialog()).toContainText('依赖与图校验通过');
    expect((await ui.api('get','/pipelines')).total).toBe(before);
  });
  await step('navigation_reload_restores_draft_and_idempotency_key',async()=>{
    const key=await page.evaluate(()=>JSON.parse(localStorage.getItem('testflow.workflow-import-draft.v1')).key);
    await button('取消',dialog()).click();
    await page.goto('/repositories');
    await page.goto('/pipelines');
    await page.reload();
    await button('导入流程').click();
    await expect(dialog()).toContainText('example.workflow.json');
    await expect(dialog()).toContainText('依赖与图校验通过');
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('testflow.workflow-import-draft.v1')).key)).toBe(key);
  });
  await step('preview_failure_retry_preserves_draft',async()=>{
    await page.route('**/api/v1/pipelines/import/preview',async route=>{
      await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'database_unavailable',message:'temporarily unavailable'})});
    },{times:1});
    await button('刷新',dialog()).click();
    await expect(dialog().getByRole('alert')).toBeVisible();
    await expect(button('导入流程',dialog())).toBeDisabled();
    await button('刷新',dialog()).click();
    await expect(dialog()).toContainText('依赖与图校验通过');
  });
  await step('pending_import_blocks_duplicates_and_close',async()=>{
    let start,release,count=0;
    const started=new Promise(resolve=>start=resolve);
    const held=new Promise(resolve=>release=resolve);
    const handler=async route=>{count++;start();await held;await route.continue();};
    await page.route('**/api/v1/pipelines/import',handler);
    try {
      await button('导入流程',dialog()).click();
      await started;
      await expect(button('导入流程',dialog())).toBeDisabled();
      await expect(button('取消',dialog())).toBeDisabled();
      await expect(dialog().getByLabel('流程 JSON 文件',{exact:true})).toBeDisabled();
      await dialog().press('Escape');
      await expect(dialog()).toBeVisible();
      release();
      await page.waitForURL(/\/pipelines\/[0-9a-f-]+$/);
      expect(count).toBe(1);
    } finally {release();await page.unroute('**/api/v1/pipelines/import',handler);}
  });
  let exported;
  await step('portable_export_contains_fixed_dependencies_only',async()=>{
    await expect(page.locator('.react-flow__node')).toHaveCount(document.pipeline.nodes.length);
    const pending=page.waitForEvent('download');
    await button('导出流程').click();
    const download=await pending;
    exported=JSON.parse(await fs.readFile(await download.path(),'utf8'));
    expect(exported.format).toBe('testflow.workflow.v1');
    expect(exported.modules.map(m=>m.package_digest).sort()).toEqual(document.modules.map(m=>m.package_digest).sort());
    expect(exported.repositories[0].commit).toBe(result.source.commit);
    const serialized=JSON.stringify(exported);
    for(const id of [result.repository.id,result.resources.module_credential,...Object.values(result.resources.modules)])expect(serialized).not.toContain(id);
    expect(exported.pipeline.nodes.find(n=>n.id==='kimi').parameters.credential_id).toBeNull();
    await fs.writeFile(path.join(directory,'browser-export.workflow.json'),JSON.stringify(exported,null,2)+'\n');
  });
  await step('export_failure_keeps_canvas_and_retries',async()=>{
    await page.route('**/api/v1/pipelines/export',async route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'database_unavailable',message:'temporarily unavailable'})}),{times:1});
    await button('导出流程').click();
    await expect(page.getByRole('alert')).toBeVisible();
    const pending=page.waitForEvent('download');await button('导出流程').click();await pending;
    await expect(page.locator('.react-flow__node')).toHaveCount(document.pipeline.nodes.length);
  });
  await step('browser_export_reimports_as_new_pipeline',async()=>{
    await button('流程列表').click();
    await button('导入流程').click();
    await upload(exported);
    await ui.select('凭据 · Kimi Code','Kimi Code',dialog());
    await dialog().getByRole('textbox',{name:'名称',exact:true}).fill('Browser exported workflow round trip');
    await expect(dialog()).toContainText('依赖与图校验通过');
    await button('导入流程',dialog()).click();
    await page.waitForURL(/\/pipelines\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading',{name:'Browser exported workflow round trip',exact:true})).toBeVisible();
  });
  await step('imported_offline_flow_executes_from_ui',async()=>{
    await page.goto('/pipelines/'+result.resources.pipelines.retrieval);
    await button('快速运行').click();
    await ui.select('评测配置','Imported workflow rules',dialog());
    await dialog().getByRole('textbox',{name:'query',exact:true}).fill('What is the refund policy?');
    await button('快速运行',dialog()).click();
    await page.waitForURL(/\/executions\/[0-9a-f-]+/);
    await expect(page.locator('main')).toContainText('within 14 days of delivery');
    await expect(page.locator('main')).toContainText('已收尾');
    await page.getByRole('tab',{name:'原始事件',exact:true}).click();
    await expect(page.locator('main')).toContainText('repository_code_import');
  });
  await step('twelve_import_dialog_layouts',async()=>{
    let locale='zh-CN',dark=false;
    const layouts=[];
    for(const width of [1200,1440,1920])for(const wanted of ['zh-CN','en-US'])for(const night of [false,true]) {
      await page.setViewportSize({width,height:1000});
      if(locale!==wanted){await button(locale==='zh-CN'?'切换语言':'Change language').click();locale=wanted;}
      if(dark!==night){await button(locale==='zh-CN'?'切换配色':'Change theme').click();dark=night;}
      await page.goto('/pipelines');
      await button(locale==='zh-CN'?'导入流程':'Import workflow').click();
      await dialog().getByLabel(locale==='zh-CN'?'流程 JSON 文件':'Workflow JSON file',{exact:true}).setInputFiles(jsonFile(document));
      await expect(dialog().locator('.testflow-transfer-identity')).toHaveCount(5);
      const rectangle=await dialog().boundingBox();
      expect(rectangle.x).toBeGreaterThanOrEqual(0);expect(rectangle.y).toBeGreaterThanOrEqual(0);
      expect(rectangle.x+rectangle.width).toBeLessThanOrEqual(width+1);expect(rectangle.y+rectangle.height).toBeLessThanOrEqual(1001);
      for(const panel of await dialog().locator('.testflow-panel').all()){
        const box=await panel.boundingBox();expect(box.x).toBeGreaterThanOrEqual(rectangle.x);expect(box.x+box.width).toBeLessThanOrEqual(rectangle.x+rectangle.width+1);
      }
      layouts.push({width,locale,dark,screenshot:await capture(`import-${width}-${locale}-${dark?'dark':'light'}`)});
      await button(locale==='zh-CN'?'取消':'Cancel',dialog()).click();
    }
    await fs.writeFile(path.join(directory,'layouts.json'),JSON.stringify(layouts,null,2)+'\n');
  });
} catch(failure) {
  error={name:failure.name,message:failure.message};
  await capture('failure').catch(()=>{});
  throw failure;
} finally {
  await context.tracing.stop({path:path.join(directory,'private-trace.zip')}).catch(()=>{});
  await fs.chmod(path.join(directory,'private-trace.zip'),0o600).catch(()=>{});
  await fs.writeFile(path.join(directory,'result.json'),JSON.stringify({namespace,checks,error,passed:!error},null,2)+'\n');
  await fs.writeFile('.data/acceptance/'+namespace+'/workflow-ui.json',JSON.stringify({directory,checks:checks.length,passed:!error},null,2)+'\n');
  await context.close();await browser.close();
}
console.log(JSON.stringify({checks:checks.length,passed:true}));

// Inspect actual experiment results and exercise the new initial-contract controls through the UI.
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium,expect} from '@playwright/test';
import {controlsUI} from './browser/control-ledger.mjs';
import {waitForPreview} from './browser/fixtures.mjs';

const namespace=process.env.TESTFLOW_E2E_NAMESPACE;
if(!namespace?.startsWith('testflow-e2e-'))throw Error('Disposable Kubernetes workspace required');
const access=JSON.parse(await fs.readFile('.data/kubernetes/'+namespace+'/access.json','utf8'));
const scenario=JSON.parse(await fs.readFile('.data/acceptance/'+namespace+'/tiny-scenario.json','utf8'));
const directory=path.resolve('.data/acceptance/'+namespace+'/scenario-ui');
await fs.mkdir(directory,{recursive:true,mode:0o700});
const browser=await chromium.launch();
const context=await browser.newContext({baseURL:access.url,viewport:{width:1440,height:1000}});
const page=await context.newPage();
const checks=[];
const ui=controlsUI(page,access.url);
async function capture(name) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(async()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
  const file=name+'.png';await page.screenshot({path:path.join(directory,file),fullPage:true});return file;
}
try {
  await waitForPreview(context.request,access.url);
  await page.goto('/');
  await page.getByRole('textbox',{name:'密码*',exact:true}).fill(access.password);
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await expect(page.getByRole('heading',{name:'测试工作台',exact:true})).toBeVisible();
  await page.goto('/test-tasks/'+scenario.resources.task);
  for(const name of ['Acorn refund / text','Acorn refund / voice','Acorn refund / image']) {
    const row=page.getByRole('row').filter({hasText:name});
    await expect(row.getByText('成功',{exact:true})).toBeVisible();
    await expect(row.getByText('通过',{exact:true})).toBeVisible();
  }
  checks.push({name:'three_real_model_chains_in_ui_report',passed:true,screenshot:await capture('three-scenarios-report')});
  const run=scenario.runs.find(r=>r.modality==='voice');
  await page.goto('/executions/'+run.execution_id);
  await expect(page.locator('main')).toContainText('14 days');
  const player=page.locator('.testflow-execution-materials > .testflow-panel').last().locator('audio');
  await expect(player).toHaveCount(1);
  await expect.poll(()=>player.evaluate(e=>e.readyState)).toBeGreaterThanOrEqual(2);
  await player.click({position:{x:18,y:16}});
  await expect.poll(()=>player.evaluate(e=>!e.paused && e.currentTime>0)).toBe(true);
  await player.click({position:{x:18,y:16}});
  checks.push({name:'actual_synthesized_reply_playback_in_browser',passed:true,screenshot:await capture('voice-output')});
  for(const label of ['执行过程','输入与输出','评测结果','配置快照','原始事件','历史记录']) {
    await page.getByRole('tab',{name:label,exact:true}).click();
    await expect(page.getByRole('tabpanel')).toBeVisible();
    checks.push({name:'actual_execution_tab_'+label,passed:true,screenshot:await capture('tab-'+label)});
  }
  const ex=await ui.api('get','/executions/'+scenario.runs[0].execution_id);
  const ai=ex.evaluations.find(e=>e.profile.id===scenario.resources.evaluation_profile);
  await page.goto('/executions/'+ex.id+'?tab=scoring&evaluation='+ai.id);
  await expect(page.getByRole('tabpanel')).toContainText('回答引用检索证据');
  checks.push({name:'real_kimi_evidence_score_visible',passed:true,screenshot:await capture('kimi-score')});
  let locale='zh-CN',dark=false;
  const layouts=[];
  for(const width of [1200,1440,1920])for(const wanted of ['zh-CN','en-US'])for(const night of [false,true]) {
    await page.setViewportSize({width,height:1000});
    if(locale!==wanted) {await ui.button(locale==='zh-CN'?'切换语言':'Change language').click();locale=wanted;}
    if(dark!==night) {await ui.button(locale==='zh-CN'?'切换配色':'Change theme').click();dark=night;}
    await page.goto('/pipelines');
    await ui.button(locale==='zh-CN'?'新建流程':'New pipeline').click();
    await expect(ui.dialog()).toBeVisible();
    const box=await ui.dialog().boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x+box.width).toBeLessThanOrEqual(width+1);expect(box.y+box.height).toBeLessThanOrEqual(1001);
    const controls=await ui.dialog().locator('input,button[aria-haspopup="listbox"]').all();
    for(const control of controls) {
      const rectangle=await control.boundingBox();
      if(rectangle) {expect(rectangle.x).toBeGreaterThanOrEqual(box.x);expect(rectangle.x+rectangle.width).toBeLessThanOrEqual(box.x+box.width+1);}
    }
    layouts.push({width,locale,dark,passed:true,screenshot:await capture('new-flow-'+width+'-'+locale+'-'+(dark?'dark':'light'))});
    await ui.button(locale==='zh-CN'?'取消':'Cancel',ui.dialog()).click();
  }
  if(locale!=='zh-CN')await ui.button('Change language').click();
  if(dark)await ui.button('切换配色').click();
  await page.setViewportSize({width:1440,height:1000});
  checks.push({name:'initial_contract_dialog_twelve_layout_combinations',passed:true,layouts});
  await page.goto('/pipelines');
  await ui.button('新建流程').click();
  const dialog=ui.dialog();
  await expect(ui.button('创建',dialog)).toBeDisabled();
  await dialog.getByRole('textbox',{name:'名称',exact:true}).fill('TEST actual initial contract '+Date.now());
  await dialog.getByRole('textbox',{name:'开始节点名称',exact:true}).fill('');
  await expect(ui.button('创建',dialog)).toBeDisabled();
  await dialog.getByRole('textbox',{name:'开始节点名称',exact:true}).fill('语音与图片起点');
  await ui.select('初始输入','audio + image',dialog);
  await ui.select('统一输出','reply + speech（流式）',dialog);
  checks.push({name:'initial_contract_validation_and_choices',passed:true,screenshot:await capture('initial-contract')});
  await ui.button('取消',dialog).click();
  await ui.button('新建流程').click();
  await expect(ui.dialog().getByRole('textbox',{name:'开始节点名称',exact:true})).toHaveValue('语音与图片起点');
  await ui.button('创建',ui.dialog()).click();
  await expect(ui.dialog()).toHaveCount(0);
  await page.waitForURL(/\/pipelines\/[0-9a-f-]+(?:\?.*)?$/);
  const identifier=new URL(page.url()).pathname.split('/').at(-1);
  const pipeline=await ui.api('get','/pipelines/'+identifier);
  expect(pipeline.data.input_schema.fields.map(f=>f.type)).toEqual(['Audio','Image']);
  expect(pipeline.data.output_schema.fields.map(f=>[f.name,f.stream])).toEqual([['reply',true],['speech',true]]);
  expect(pipeline.data.nodes[0].name).toBe('语音与图片起点');
  expect(pipeline.data.edges).toEqual([]);
  checks.push({name:'initial_groups_persisted_without_implicit_edge',passed:true,screenshot:await capture('created-contract')});
  await ui.button('编辑流程输入 / 输出').click();
  await expect(ui.dialog()).toBeVisible();
  await ui.button('取消',ui.dialog()).click();
  checks.push({name:'canvas_overview_contract_editor',passed:true});
  const result={namespace,checks,passed:true,scope:'Actual real-model report, playback and new initial contract controls; no microphone'};
  await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({checks:checks.length,passed:true}));
} finally {
  await context.close();await browser.close();
}

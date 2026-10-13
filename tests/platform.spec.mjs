import { test } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verifyPlatform } from './platform.e2e.mjs';
import { verifyWorkflow, workflow } from './platform-workflow.e2e.mjs';
import { verifyFinalControls } from './platform-final-controls.e2e.mjs';
import { verifyLayoutGroup } from './platform-layouts.e2e.mjs';
import { playwrightTab } from './browser/playwright-tab.mjs';
import { retirePriorUiResources, waitForPreview } from './browser/fixtures.mjs';

test('real Kubernetes desktop workflow', async ({ page }, info) => {
  const namespace = process.env.TESTFLOW_E2E_NAMESPACE;
  test.skip(!namespace, 'Provide a disposable deployed TESTFLOW_E2E_NAMESPACE');
  if (!/^testflow-e2e-[a-z0-9-]+$/.test(namespace)) throw Error('Only owned e2e namespaces may be mutated');
  const access = JSON.parse(await fs.readFile(path.resolve('.data/kubernetes',namespace,'access.json'),'utf8'));
  const acceptance = JSON.parse(await fs.readFile(path.resolve('.data/acceptance',namespace,'result.json'),'utf8'));
  await fs.mkdir(info.outputDir,{recursive:true,mode:0o700});
  await fs.chmod(info.outputDir,0o700);
  await waitForPreview(page.request, access.url);
  await page.goto(access.url+'/');
  await page.getByRole('textbox',{name:'密码*',exact:true}).fill(access.password);
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.getByRole('heading',{name:'测试工作台',exact:true}).waitFor({state:'visible'});
  await retirePriorUiResources(page.request, access.url);
  // Login is excluded from trace. The raw trace is private and must be scrubbed before sharing.
  await page.context().tracing.start({screenshots:true,snapshots:true,sources:false});
  const tab = playwrightTab(page);
  const observe=async()=>{
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    return page.locator('body').innerText();
  };
  try {
    for (const stage of ['navigation','global','repositories','assets','modules']) {
      console.info('Workflow stage: '+stage); await verifyPlatform(stage,tab,observe);
    }
    for (const stage of ['datasets','evaluation','pipelines','tasks']) {
      console.info('Workflow stage: '+stage); await verifyWorkflow(stage,tab,observe);
    }
    await verifyPlatform('executions',tab,observe,{origin:access.url,executionId:acceptance.executions[0].id});
    workflow.final_controls = await verifyFinalControls(tab,observe);
    workflow.layouts = [];
    for (const width of [1200,1440,1920]) for (const locale of ['zh-CN','en-US']) for (const theme of ['light','dark']) {
      workflow.layouts.push(...await verifyLayoutGroup(tab,observe,{width,locale,theme,
        setViewport:size=>page.setViewportSize(size),
        capture:async(file,clip)=>{await page.screenshot({path:info.outputPath(file),clip,type:'jpeg'});},
      }));
    }
    await fs.writeFile(info.outputPath('workflow.json'),JSON.stringify(workflow,null,2),{mode:0o600});
  } finally {
    const privatePath=info.outputPath('trace.private.zip');
    await page.context().tracing.stop({path:privatePath});
    await fs.chmod(privatePath,0o600);
    await promisify(execFile)('python3',[path.resolve('scripts/sanitize-browser-trace.py'),privatePath,info.outputPath('trace.zip')]);
  }
});

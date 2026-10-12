// Diagnostic prototype comparison for details and dialogs; no fixture UI or application state injection.
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium, expect} from '@playwright/test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const origin=process.env.TESTFLOW_DETAIL_VISUAL_URL || 'http://127.0.0.1:18802';
const directory=path.resolve(process.env.TESTFLOW_DETAIL_VISUAL_OUTPUT || '.data/acceptance/scenario-20261011/detail-visual');
await fs.mkdir(directory,{recursive:true,mode:0o700});
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const formal=await context.newPage(), prototype=await context.newPage();
const manifest={environment:{browser:browser.version(),viewport:{width:1440,height:1000},deviceScaleFactor:1},
  scope:'Diagnostic detail comparisons; differences may include required real-service controls',screens:[]};
async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(async()=>{
    await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  });
}
async function capture(id, formalOpen, prototypeOpen) {
  await formalOpen();await prototypeOpen();
  await settle(formal);await settle(prototype);
  await formal.screenshot({path:path.join(directory,'formal-'+id+'.png')});
  await prototype.screenshot({path:path.join(directory,'demo-'+id+'.png')});
  manifest.screens.push({id,actual:'formal-'+id+'.png',baseline:'demo-'+id+'.png',masks:[]});
  await fs.writeFile(path.join(directory,'screens.json'),JSON.stringify(manifest,null,2)+'\n');
}
let captureIndex=0;
const go=async(page,route)=>{
  const url=new URL(origin+route);
  if(route.startsWith('/prototype.html'))url.searchParams.set('capture',String(++captureIndex));
  await page.goto(url.href);await settle(page);
};
const action=async(page,selector)=>{await page.locator(selector).click();};
try {
  for (const [id,route,actionId] of [['text-dialog','assets','new-text-asset'],['pipeline-dialog','pipelines','new-flow'],['dataset-wizard','datasets','new-dataset'],['repository-dialog','repositories','new-repo']]) {
    await capture(id,async()=>{await go(formal,'/'+route);await action(formal,'[data-a="'+actionId+'"]');await expect(formal.getByRole('dialog')).toBeVisible();},
      async()=>{await go(prototype,'/prototype.html#'+route);if(route==='pipelines')await prototype.locator('[data-a="flow-list"]').click();await action(prototype,'[data-a="'+actionId+'"]');});
  }
  await capture('dataset-detail',async()=>go(formal,'/datasets/ds-audio'),async()=>{await go(prototype,'/prototype.html#datasets');await action(prototype,'[data-a="dataset-detail"][data-id="ds-audio"]');});
  await capture('pipeline-canvas',async()=>go(formal,'/pipelines/flow-text'),async()=>{await go(prototype,'/prototype.html#pipelines');await prototype.locator('[data-a="flow-list"]').click();await action(prototype,'[data-a="open-flow"][data-id="flow-text"]');});
  for (const tab of ['trace','io','scoring','snapshot','events','history']) {
    await capture('execution-'+tab,async()=>go(formal,'/executions/exec_206?tab='+tab),async()=>{
      await go(prototype,'/prototype.html#executions');await action(prototype,'.cell-title[data-a="execution-detail"][data-id="exec_206"]');
      await action(prototype,'[data-a="execution-tab"][data-tab="'+tab+'"]');
    });
  }
  await capture('task-report',async()=>go(formal,'/test-tasks/batch_baseline'),async()=>{await go(prototype,'/prototype.html#tasks');await action(prototype,'.cell-title[data-a="task-detail"][data-id="batch_baseline"]');});
} finally {
  await context.close();await browser.close();
}
try {
  const result=await promisify(execFile)('uv',['run','--project','server','python','tests/visual-compare.py','--directory',directory,'--manifest',path.join(directory,'screens.json'),'--output',path.join(directory,'result.json')]);
  console.log(result.stdout);
} catch(error) {
  if(error.code===1 && await fs.stat(path.join(directory,'result.json')).catch(()=>false)) { console.log(error.stdout); console.log('Diagnostic differences retained; no complete-reproduction claim.'); }
  else throw error;
}

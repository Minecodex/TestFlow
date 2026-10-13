// Module launch defaults, ZIP-defined business parameters, and canvas-owned removal controls.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium, expect} from '@playwright/test';
import {waitForPreview} from './browser/fixtures.mjs';

const namespace = process.env.TESTFLOW_E2E_NAMESPACE;
if (!namespace?.startsWith('testflow-e2e-')) throw Error('Owned disposable namespace required');
const access = JSON.parse(await fs.readFile('.data/kubernetes/' + namespace + '/access.json', 'utf8'));
const directory = path.resolve('.data/acceptance/' + namespace + '/node-configuration');
await fs.mkdir(directory, {recursive:true,mode:0o700});
const browser = await chromium.launch(), context = await browser.newContext({baseURL:access.url,viewport:{width:1440,height:1000}});
const page = await context.newPage(), cases=[], layouts=[], errors=[];
page.on('pageerror', error=>errors.push(error.message));
const dialog = () => page.locator('[data-slot="modal-dialog"]').last();
const button = (name,scope=page)=>scope.getByRole('button',{name,exact:true});
const api = async (method,route,data) => {
  const response=await context.request.fetch('/api/v1'+route,{method,data,headers:{'Idempotency-Key':randomUUID()}});
  if(!response.ok())throw Error(`${method} ${route}: ${response.status()}`);return response.json();
};
const create=(kind,data)=>api('POST','/'+kind,data), read=(kind,id)=>api('GET','/'+kind+'/'+id);
const close=async()=>{await dialog().press('Escape');await expect(page.locator('[data-slot="modal-dialog"]')).toHaveCount(0);};
async function shot(name){await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(directory,name+'.png'),fullPage:true,animations:'disabled'});}
async function step(id,run){await run();cases.push({id,passed:true});await shot(id);console.log('PASS '+id);}
async function saveFlow(){const event=page.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname==='/api/v1/pipelines/'+pipeline.id);await page.keyboard.press('Control+s');expect((await event).ok()).toBe(true);pipeline=await read('pipelines',pipeline.id);}
const node=id=>page.locator(`.react-flow__node[data-id="${id}"]`);
async function connect(source,target){const point=async locator=>{const box=await locator.boundingBox();return{x:box.x+box.width/2,y:box.y+box.height/2};};const a=await point(node(source).locator('.react-flow__handle.source')),b=await point(node(target).locator('.react-flow__handle.target'));await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:18});await page.mouse.up();}
let module,pipeline,nodeId,execution,businessCredential,failure;
try {
  await waitForPreview(context.request,access.url);await page.goto('/');await page.getByRole('textbox',{name:'密码*',exact:true}).fill(access.password);await button('登录').click();
  await expect(page.getByRole('heading',{name:'测试工作台',exact:true})).toBeVisible();await context.tracing.start({screenshots:true,snapshots:true,sources:false});
  const examples=JSON.parse(await fs.readFile('.data/example-modules.json','utf8')),example=examples.find(item=>item.id==='text-transform');
  const response=await context.request.post('/api/v1/modules/import',{headers:{'Idempotency-Key':randomUUID()},multipart:{file:{name:'module.zip',mimeType:'application/zip',buffer:await fs.readFile(example.zip)}}});
  expect(response.ok()).toBe(true);module=await response.json();await expect.poll(async()=>(await read('operations',module.operation_id)).state,{timeout:60000}).toBe('succeeded');
  await page.goto('/modules');await page.locator('[data-a="edit-module-runtime"]').click();
  await step('zip-provides-launch-defaults',async()=>{
    const editor=page.locator('.testflow-module-runtime-editor');await expect(editor.getByRole('textbox',{name:'模块镜像引用',exact:true})).toHaveValue(example.image);
    await expect(editor.getByRole('spinbutton',{name:'服务端口',exact:true})).toHaveValue('8080');
    await expect(editor.getByRole('textbox',{name:'CPU',exact:true})).toHaveValue('500m');expect(module.data.runtime).toEqual(module.data.manifest.runtime);
  });
  await step('runtime-save-error-and-retry',async()=>{
    const editor=page.locator('.testflow-module-runtime-editor');await editor.getByRole('textbox',{name:'CPU',exact:true}).fill('250m');await editor.getByRole('textbox',{name:'内存上限',exact:true}).fill('256Mi');
    let rejected=false;await page.route('**/api/v1/modules/'+module.id+'/runtime',async route=>{if(!rejected){rejected=true;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'fixture_unavailable',message:'Retry fixture'})});}else await route.continue();});
    await button('保存运行配置',editor).click();await expect(editor.getByRole('alert')).toBeVisible();await expect(editor.getByRole('textbox',{name:'CPU',exact:true})).toHaveValue('250m');
    await button('保存运行配置',editor).click();await expect(button('保存运行配置',editor)).toBeDisabled();await page.unroute('**/api/v1/modules/'+module.id+'/runtime');
    const latest=await read('modules',module.id);expect(latest.version).toBe(2);expect(latest.data.runtime.cpu).toBe('250m');expect(latest.data.package_digest).toBe(module.data.package_digest);
    expect((await api('GET','/modules/'+module.id+'?version=1')).data.runtime.cpu).toBe('500m');module=latest;await close();await page.goto('/modules/'+module.id);
    await expect(page.locator('.testflow-module-runtime-editor').getByRole('textbox',{name:'CPU',exact:true})).toHaveValue('250m');
  });
  await step('runtime-conflict-retains-draft',async()=>{
    const editor=page.locator('.testflow-module-runtime-editor');await editor.getByRole('textbox',{name:'CPU',exact:true}).fill('275m');
    await api('PUT','/modules/'+module.id+'/runtime',{expected_version:module.version,runtime:{...module.data.runtime,cpu:'300m'}});
    await expect(editor).toContainText('服务端已有新版本，本地草稿已保留。');await expect(editor.getByRole('textbox',{name:'CPU',exact:true})).toHaveValue('275m');
    await button('查看最新版本',editor).click();await expect(page.locator('[data-slot="modal-dialog"]')).toHaveCount(2);await button('保留草稿并继续编辑',dialog()).click();
    await button('保存运行配置',editor).click();await expect(button('保存运行配置',editor)).toBeDisabled();module=await read('modules',module.id);expect(module.version).toBe(4);expect(module.data.runtime.cpu).toBe('275m');
  });
  await step('saved-runtime-validates-real-pod',async()=>{
    const request=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/v1/modules/'+module.id+'/validate');
    await button('验证可用性',page.locator('.testflow-module-runtime-editor')).click();const result=await request;expect(result.ok()).toBe(true);const operation=await result.json();
    await expect.poll(async()=>(await read('operations',operation.id)).state,{timeout:90000}).toBe('succeeded');
    const record=await read('operations',operation.id);expect(record.payload.runtime.cpu).toBe('275m');expect(record.result.image_id).toBeTruthy();await close();
  });
  pipeline=await create('pipelines',{name:'TEST business parameters',input_schema:module.data.inputs,output_schema:module.data.outputs,nodes:[
    {id:'start',kind:'start',name:'Start',x:0,y:200,output_schema:module.data.inputs},{id:'end',kind:'end',name:'End',x:620,y:200,input_schema:module.data.outputs}],edges:[]});
  await page.goto('/pipelines/'+pipeline.id);await button('添加节点').click();await page.locator('.testflow-palette [data-a="add-node"]').filter({hasText:module.name}).click();
  const ids=await page.locator('.react-flow__node').evaluateAll(nodes=>nodes.map(n=>n.dataset.id));nodeId=ids.find(id=>!['start','end'].includes(id));
  await node(nodeId).click();
  await step('node-editor-is-business-only',async()=>{
    const editor=page.locator('.testflow-node-settings');await expect(editor.getByRole('textbox',{name:'节点名称',exact:true})).toBeVisible();await expect(editor.getByRole('textbox',{name:'节点描述',exact:true})).toBeVisible();
    for(const label of ['模块镜像引用','仓库挂载（可选）','节点运行超时（秒）','CPU'])await expect(editor.getByRole('textbox',{name:label,exact:true})).toHaveCount(0);
    await expect(editor.locator('.testflow-chips')).toHaveCount(0);await expect(editor.locator('[data-a="remove-node"],[data-a="disconnect-node"],[data-a="validate-module"]')).toHaveCount(0);
    for(const field of ['mode','chunk_size','delay_ms'])await expect(editor.getByRole('textbox',{name:field,exact:true})).toBeEditable();
    await editor.getByRole('textbox',{name:'节点名称',exact:true}).fill('Business transform');await editor.getByRole('textbox',{name:'节点描述',exact:true}).fill('Reverse text using the capability-defined parameters');await editor.getByRole('textbox',{name:'mode',exact:true}).fill('reverse');
  });
  await step('business-schema-blocks-invalid-parameters',async()=>{
    await dialog().getByRole('textbox',{name:'chunk_size',exact:true}).fill('0');await expect(page.locator('.testflow-node-settings')).toContainText('参数不符合模块 Schema');
    await dialog().getByRole('textbox',{name:'chunk_size',exact:true}).fill('2');await expect(page.locator('.testflow-node-settings').getByRole('alert')).toHaveCount(0);await saveFlow();await close();
    const saved=pipeline.data.nodes.find(n=>n.id===nodeId);expect(saved.description).toBe('Reverse text using the capability-defined parameters');expect(saved.parameters).toEqual({mode:'reverse',chunk_size:2,delay_ms:0});expect(saved.runtime.cpu).toBe('275m');expect(saved.module_version).toBe(4);
  });
  await step('canvas-connect-and-node-settings',async()=>{
    await connect('start',nodeId);await connect(nodeId,'end');await expect(page.locator('.react-flow__edge')).toHaveCount(2);
    await button('流程设置').click();await dialog().locator('.testflow-node-platform-settings summary').click();
    await dialog().getByRole('spinbutton',{name:'Business transform · 节点运行超时（秒）',exact:true}).fill('65');await button('取消',dialog()).click();
    await button('流程设置').click();await dialog().locator('.testflow-node-platform-settings summary').click();await expect(dialog().getByRole('spinbutton',{name:'Business transform · 节点运行超时（秒）',exact:true})).toHaveValue('30');
    await dialog().getByRole('spinbutton',{name:'Business transform · 节点运行超时（秒）',exact:true}).fill('65');await button('保存',dialog()).click();await saveFlow();
    expect(pipeline.data.nodes.find(n=>n.id===nodeId).timeout).toBe(65);expect((await api('POST','/pipelines/validate',pipeline.data)).valid).toBe(true);
  });
  await step('business-parameters-drive-actual-container-output',async()=>{
    const dataset=await create('datasets',{name:'TEST text input',input_schema:module.data.inputs,cases:[{id:randomUUID(),name:'Reverse request',inputs:{text:{value:'Hello TestFlow'}}}]});
    const profile=await create('evaluation-profiles',{name:'TEST completed output',dimensions:[{id:'done',name:'Completion',method:'completion',actual:{source:'execution',field:'state'}}]});
    const task=await create('tasks',{name:'TEST real business node',profile_id:profile.id,profile_version:profile.version,pairs:[{dataset_id:dataset.id,dataset_version:dataset.version,pipeline_id:pipeline.id,pipeline_version:pipeline.version}]});
    await expect.poll(async()=>(await read('tasks',task.id)).state,{timeout:90000}).toBe('completed');const completed=await read('tasks',task.id);expect(completed.report.passed).toBe(1);
    execution=await read('executions',completed.report.rows[0].execution_id);expect(execution.state).toBe('succeeded');expect(execution.output.text.text).toBe('wolFtseT olleH');expect(execution.output.text.eos).toBe(true);
    const frozen=execution.snapshot.pipeline.graph.nodes.find(n=>n.id===nodeId);expect(frozen.parameters.mode).toBe('reverse');expect(frozen.runtime.cpu).toBe('275m');
  });
  await step('edge-click-is-passive-hover-delete-is-explicit',async()=>{
    const edge=page.locator('.react-flow__edge').first();
    const point=await edge.locator('.react-flow__edge-interaction').evaluate(path=>{const p=path.getPointAtLength(path.getTotalLength()*.2),m=path.getScreenCTM();return{x:p.x*m.a+p.y*m.c+m.e,y:p.x*m.b+p.y*m.d+m.f};});
    await page.mouse.click(point.x,point.y);await expect(page.locator('[data-slot="modal-dialog"]')).toHaveCount(0);
    await page.locator('.testflow-canvas').focus();await page.mouse.move(250,100);await expect(edge.locator('.testflow-edge-delete-anchor')).toHaveCSS('opacity','0');
    await page.mouse.move(point.x,point.y);await expect(edge.locator('.testflow-edge-delete-anchor')).toHaveCSS('opacity','1');await shot('hover-edge-delete');
    await edge.getByRole('button',{name:'删除连线',exact:true}).click();await expect(dialog()).toContainText('确认删除这条完整组连线');await button('取消',dialog()).click();await expect(page.locator('.react-flow__edge')).toHaveCount(2);
    await page.mouse.move(point.x,point.y);await edge.getByRole('button',{name:'删除连线',exact:true}).click();await dialog().locator('[data-a="confirm-edge-delete"]').click();await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    await button('恢复上次保存').click();await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  });
  await step('node-delete-belongs-to-canvas',async()=>{
    await expect(node('start').locator('[data-a="remove-node"]')).toHaveCount(0);await node(nodeId).hover();await node(nodeId).locator('[data-a="remove-node"]').click();
    await expect(page.locator('.react-flow__node')).toHaveCount(2);await expect(page.locator('.react-flow__edge')).toHaveCount(0);await expect(page.locator('[data-slot="modal-dialog"]')).toHaveCount(0);
    await button('恢复上次保存').click();await expect(node(nodeId)).toBeVisible();
  });
  await step('description-and-runtime-survive-workflow-roundtrip',async()=>{
    const document=await api('GET','/pipelines/'+pipeline.id+'/export');expect(document.pipeline.nodes.find(n=>n.id===nodeId).description).toBe('Reverse text using the capability-defined parameters');
    const bindings={[document.modules[0].key]:{id:module.id,version:module.version}};
    const imported=await create('pipelines/import',{document,bindings,name:'TEST imported business parameters'});const restored=imported.data.nodes.find(n=>n.id===nodeId);
    expect(restored.description).toBe(pipeline.data.nodes.find(n=>n.id===nodeId).description);expect(restored.parameters.mode).toBe('reverse');expect(restored.runtime.cpu).toBe('275m');
  });
  await step('schema-declared-business-credential-is-configurable',async()=>{
    const result=await context.request.post('/api/v1/modules/import',{headers:{'Idempotency-Key':randomUUID()},multipart:{file:{name:'repo-kimi.zip',mimeType:'application/zip',buffer:await fs.readFile('examples/repository-helpdesk/downloads/modules/repo-kimi.zip')}}});
    expect(result.ok()).toBe(true);const capability=await result.json();await expect.poll(async()=>(await read('operations',capability.operation_id)).state,{timeout:60000}).toBe('succeeded');
    await button('添加节点').click();await page.locator('.testflow-palette [data-a="add-node"]').filter({hasText:capability.name}).click();
    await expect(page.locator('.react-flow__node:visible')).toHaveCount(4);
    const businessNode=page.locator('.react-flow__node').filter({hasText:capability.name});await businessNode.click();
    await button('配置能力凭据',dialog()).click();await button('配置访问凭据',dialog()).click();
    await dialog().getByRole('textbox',{name:'名称',exact:true}).fill('TEST module credential');await dialog().getByRole('textbox',{name:'凭据正文（加密保存）',exact:true}).fill('fixture-business-key');await button('保存',dialog()).click();
    await expect(page.locator('[data-slot="modal-dialog"]')).toHaveCount(2);await dialog().getByRole('button',{name:'关闭',exact:true}).last().click();await expect(page.locator('[data-slot="modal-dialog"]')).toHaveCount(1);
    const credentials=await api('GET','/credentials');const credential=credentials.items.find(item=>item.name==='TEST module credential');businessCredential=credential.id;expect(credential.kind).toBe('module');expect(JSON.stringify(credential)).not.toContain('fixture-business-key');
    await expect(dialog().getByRole('textbox',{name:'credential_id',exact:true})).toHaveValue(credential.id);await close();
    await businessNode.hover();await businessNode.locator('[data-a="remove-node"]').click();await expect(page.locator('.react-flow__node')).toHaveCount(3);
  });
  await step('example-installer-saves-and-reuses-module-launch-defaults',async()=>{
    const install=()=>promisify(execFile)('uv',['run','--project','server','python','examples/repository-helpdesk/install.py','--namespace',namespace,'--module-credential-id',businessCredential],{timeout:200000,maxBuffer:4*1024*1024});
    await install();
    const installed=JSON.parse(await fs.readFile('.data/example-installations/'+namespace+'/installed.json','utf8'));
    expect(installed.installed).toBe(true);expect(installed.checks).toContain('saved_module_launch_defaults');expect(Object.keys(installed.validations)).toHaveLength(5);
    const before=await api('GET','/modules?page_size=100');
    for(const entry of Object.values(installed.modules)){
      const capability=before.items.find(item=>item.id===entry.id);expect(capability.selected_version).toBe(entry.version);expect(capability.version).toBe(2);
      expect(capability.data.runtime.code_mount.repository_id).toBe(installed.repository.id);expect(capability.data.runtime.code_mount.commit).toBe(installed.source.commit);expect(capability.data.runtime.code_mount.mount_path).toBe('/workspace/repository');
    }
    const counts=async()=>Object.fromEntries(await Promise.all(['modules','pipelines','datasets','assets','executions'].map(async kind=>[kind,(await api('GET','/'+kind+'?page_size=100')).total])));
    const first=await counts();await install();expect(await counts()).toEqual(first);
    const after=await api('GET','/modules?page_size=100');expect(after.items.map(item=>[item.id,item.version])).toEqual(before.items.map(item=>[item.id,item.version]));
    expect((await api('GET','/executions?page_size=100')).total).toBe(1);
  });
  await step('business-drawer-languages-and-themes',async()=>{
    for(const width of [1200,1440,1920])for(const locale of ['zh-CN','en-US'])for(const theme of ['light','dark']){
      await page.setViewportSize({width,height:1000});await page.evaluate(v=>{localStorage.setItem('testflow.locale',v.locale);localStorage.setItem('testflow.theme',v.theme);},{locale,theme});
      await page.goto('/pipelines/'+pipeline.id+'?node='+nodeId);await expect(page.locator('.testflow-node-settings')).toBeVisible();await expect(page.locator('.testflow-node-settings').getByRole('textbox',{name:'mode',exact:true})).toHaveValue('reverse');
      expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);const name=`drawer-${width}-${locale}-${theme}`;await shot(name);layouts.push({width,locale,theme,screenshot:name+'.png'});
    }
    expect(errors).toEqual([]);
  });
}catch(error){failure=error;await shot('failure').catch(()=>{});}
finally{
  await context.tracing.stop({path:path.join(directory,'private-trace.zip')}).catch(()=>{});await fs.chmod(path.join(directory,'private-trace.zip'),0o600).catch(()=>{});
  await fs.writeFile(path.join(directory,'control-cases.json'),JSON.stringify({passed:!failure,cases,layouts,errors,failure:failure?.message,resources:{module:module?.id,pipeline:pipeline?.id,execution:execution?.id}},null,2));await browser.close();
}
if(failure)throw failure;
console.log(JSON.stringify({passed:true,cases:cases.length,layouts:layouts.length,errors}));

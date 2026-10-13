// Run only through documented UI APIs; both CUA and Playwright adapters use this harness.
export const results=[];
const assert=(condition,message)=>{if(!condition)throw Error(message);};
export async function verifyPlatform(stage,tab,observe,fixtures={}) {
 const ui=tab.playwright;
 const button=name=>ui.getByRole('button',{name,exact:true});
 const click=async locator=>{await locator.click();await observe();};
 const go=async name=>{await click(ui.getByRole('link',{name:new RegExp('^'+name)}));await ui.getByRole('heading',{name:name==='流程画布'?'流程集':name,exact:true}).waitFor({state:'visible'});};
 const finish=name=>{results.push({stage,name});return name;};
 if(stage==='navigation'){
  for(const page of ['代码仓库','能力模块','素材池','测试集','流程画布','评测配置','测试任务','执行历史']){await go(page);await tab.reload();await observe();await ui.getByRole('heading',{name:page==='流程画布'?'流程集':page,exact:true}).waitFor({state:'visible'});}
  await click(button('切换语言'));assert(await ui.locator('html').getAttribute('lang')==='en-US','English language');
  await click(ui.getByRole('button',{name:/theme/i}));assert((await ui.locator('html').getAttribute('class')).includes('dark'),'Dark theme');
  await tab.reload();await observe();assert(await ui.locator('html').getAttribute('lang')==='en-US','Persisted English');assert((await ui.locator('html').getAttribute('class')).includes('dark'),'Persisted dark');
  await click(ui.getByRole('button',{name:/language/i}));await click(button('切换配色'));
  return finish('eight resource pages, route reload, both languages, themes and persistence');
 }
 if(stage==='global'){
  await click(button('搜索工作区 Ctrl K'));
  await ui.getByRole('dialog',{name:'搜索工作区',exact:true}).getByRole('textbox',{name:'搜索工作区',exact:true}).fill('未匹配的工作区查询');await observe();
  await ui.getByText('没有匹配结果',{exact:true}).waitFor({state:'visible'});
  await ui.getByRole('dialog',{name:'搜索工作区',exact:true}).getByRole('textbox',{name:'搜索工作区',exact:true}).press('Escape');await observe();
  await click(button('体验全流程'));
  for(let i=0;i<7;i++)await click(ui.locator('.testflow-guide').getByRole('button',{name:'下一步',exact:true}));
  await click(button('结束导览'));
  await click(ui.getByRole('banner').getByRole('button',{name:'刷新',exact:true}));
  return finish('search empty state, Escape, eight-step guide and refresh');
 }
 if(stage==='repositories'){
  await go('代码仓库');await click(button('注册仓库'));
  let dialog=ui.getByRole('dialog',{name:'注册仓库',exact:true});
  await dialog.getByRole('textbox',{name:'名称*',exact:true}).fill('TEST UI Repository');
  await dialog.getByRole('textbox',{name:'仓库地址*',exact:true}).fill('file:///data/fixtures/repository');
  await dialog.getByRole('textbox',{name:'分支*',exact:true}).fill('main');await observe();await click(dialog.getByRole('button',{name:'保存',exact:true}));
  const row=ui.getByRole('row').filter({hasText:'TEST UI Repository'});
  await row.waitFor({state:'visible'});await click(row.getByRole('button',{name:'手动同步',exact:true}));
  await row.getByText('可用',{exact:true}).waitFor({state:'visible',timeoutMs:40000});
  // Operation completion can arrive before the live resource refresh. The next
  // edit must start from the visible synchronized commit, not the prior revision.
  await row.getByRole('button',{name:'版本记录',exact:true}).filter({hasText:/^[a-f0-9]{12}$/}).waitFor({state:'visible',timeoutMs:40000});
  await click(row.getByRole('button',{name:'版本记录',exact:true}));await ui.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();await observe();
  await click(row.getByRole('button',{name:'编辑',exact:true}));dialog=ui.getByRole('dialog',{name:'编辑',exact:true});
  await dialog.getByRole('textbox',{name:'分支*',exact:true}).fill('missing-test-branch');await click(dialog.getByRole('button',{name:'保存',exact:true}));
  await click(row.getByRole('button',{name:'手动同步',exact:true}));await row.getByText('失败',{exact:true}).waitFor({state:'visible',timeoutMs:40000});
  await tab.reload();await observe();await row.getByText('失败',{exact:true}).waitFor({state:'visible'});
  await click(row.getByRole('button',{name:'编辑',exact:true}));dialog=ui.getByRole('dialog',{name:'编辑',exact:true});
  await dialog.getByRole('textbox',{name:'分支*',exact:true}).fill('main');await click(dialog.getByRole('button',{name:'保存',exact:true}));await click(row.getByRole('button',{name:'手动同步',exact:true}));await row.getByText('可用',{exact:true}).waitFor({state:'visible',timeoutMs:40000});
  await click(row.getByRole('button',{name:'隐藏 TEST UI Repository',exact:true}));dialog=ui.getByRole('dialog',{name:'TEST UI Repository',exact:true});await click(dialog.getByRole('button',{name:'取消',exact:true}));assert(await row.count()===1,'Hide cancel keeps repository');
  await click(row.getByRole('button',{name:'隐藏 TEST UI Repository',exact:true}));await click(ui.getByRole('dialog',{name:'TEST UI Repository',exact:true}).getByRole('button',{name:'确认隐藏',exact:true}));await row.waitFor({state:'hidden'});
  await click(button('隐藏资源'));dialog=ui.getByRole('dialog',{name:'隐藏资源',exact:true});await click(dialog.getByRole('button',{name:'恢复 TEST UI Repository',exact:true}));await click(ui.getByRole('dialog',{name:'TEST UI Repository',exact:true}).getByRole('button',{name:'恢复',exact:true}));await click(dialog.getByRole('button',{name:'关闭',exact:true}));await row.waitFor({state:'visible'});
  return finish('register, actual Git sync, versions, edit, failure reload, retry, hide cancel and restore');
 }
 if(stage==='assets'){
  await go('素材池');await click(button('新增文字'));
  let dialog=ui.getByRole('dialog',{name:'新增文字',exact:true});
  await dialog.getByRole('textbox',{name:'名称',exact:true}).fill('TEST UI text');await dialog.getByRole('textbox',{name:'文字内容',exact:true}).fill('real UI input');await click(dialog.getByRole('button',{name:'保存',exact:true}));
  const row=ui.getByRole('row').filter({hasText:'TEST UI text'});await row.waitFor({state:'visible'});await click(row.getByRole('button',{name:'查看详情',exact:true}));dialog=ui.getByRole('dialog',{name:'TEST UI text',exact:true});
  await dialog.getByRole('textbox',{name:'标签（逗号分隔）',exact:true}).fill('ui,acceptance');await dialog.getByRole('textbox',{name:'参考内容',exact:true}).fill('REAL UI INPUT');await dialog.getByRole('checkbox').check();await click(dialog.getByRole('button',{name:'保存',exact:true}));await row.getByText('参考已确认',{exact:true}).waitFor({state:'visible'});
  await click(row.getByRole('button',{name:'版本记录',exact:true}));assert((await ui.getByRole('dialog').innerText()).includes('v2'),'Reference edit creates immutable version');await click(ui.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}));
  await click(button('导入素材'));dialog=ui.getByRole('dialog',{name:'导入素材',exact:true});const pending=ui.waitForEvent('filechooser');await dialog.locator('input[type="file"]').click();const chooser=await pending;assert(chooser.isMultiple(),'Multiple media chooser');await chooser.setFiles(['/tmp/testflow-ui-audit/input.txt','/tmp/testflow-ui-audit/input.wav','/tmp/testflow-ui-audit/invalid.wav']);await observe();await click(dialog.getByRole('button',{name:'导入素材',exact:true}));await dialog.getByText('invalid.wav',{exact:true}).waitFor({state:'visible',timeoutMs:30000});assert(await dialog.getByRole('alert').count()===1,'Each invalid file has its own error; other files import');await click(dialog.getByRole('button',{name:'关闭',exact:true}).last());
  await ui.getByRole('textbox',{name:'搜索工作区',exact:true}).fill('TEST UI text');await observe();await row.waitFor({state:'visible'});assert((await tab.url()).includes('q=TEST'),'URL search persists');await tab.reload();await observe();await row.waitFor({state:'visible'});
  await ui.getByRole('textbox',{name:'搜索工作区',exact:true}).fill('');await observe();
  return finish('text input, immutable tags/reference edits, confirmation, file chooser, per-file failure and persisted search');
 }
 if(stage==='modules'){
  await go('能力模块');
  const card=ui.locator('.testflow-module-card').filter({hasText:'Audio gain'});
  await click(card.getByRole('button',{name:'查看契约',exact:true}));
  await ui.getByRole('textbox',{name:'gain',exact:true}).waitFor({state:'visible'});
  assert(!(await ui.getByRole('textbox',{name:'gain',exact:true}).isEnabled()),'Readonly component');
  assert(await ui.getByRole('textbox',{name:'模块镜像引用',exact:true}).count()===1,'Pod image control');
  for(const name of ['后端语言','运行入口','启动方式','外部服务地址'])assert(await ui.getByLabel(name,{exact:true}).count()===0,'No external implementation controls: '+name);
  await click(button('关闭'));await click(button('包结构说明'));await click(button('关闭'));
  return finish('Pod-only contract drawer, shared React component readonly mode and package specification');
 }
 if(stage==='executions'){
  await tab.goto(fixtures.origin+'/executions/'+fixtures.executionId);await observe();
  await ui.getByRole('tab',{name:'执行过程',exact:true}).waitFor({state:'visible'});
  for(const name of ['执行过程','输入与输出','评测结果','配置快照','原始事件','历史记录']){
   await click(ui.getByRole('tab',{name,exact:true}));assert(await ui.getByRole('tabpanel').count()===1,'Accessible tab panel '+name);
  }
  await click(ui.getByRole('tab',{name:'配置快照',exact:true}));
  assert((await ui.locator('.testflow-content').innerText()).includes('testflow.module.v1'),'Fixed module contract in snapshot');
  await click(ui.getByRole('tab',{name:'输入与输出',exact:true}));
  const pending=ui.waitForEvent('download');await click(button('导出 JSON'));const downloaded=await pending;const path=await downloaded.path();assert(path,'Execution export');
  await click(button('返回'));await click(button('清空筛选'));
  return finish('six accessible execution tabs, fixed snapshot, full attempt history, export and back');
 }
 throw Error('Unknown stage '+stage);
}

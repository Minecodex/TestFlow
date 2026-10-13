// Run each stage through CUA. Only UI/DOM observations are used; no app-state injection.
export const context = { passed: [], downloads: [] };
export async function verifyStage(stage, tab, observe, fixtureRoot = '/tmp/testflow-ui-audit') {
  const ui = tab.playwright;
  const check = (v, m) => { if (!v) throw new Error(m); };
  const button = name => ui.getByRole('button', { name, exact: true });
  const label = name => ui.getByLabel(name, { exact: true });
  const content = () => ui.locator('#content').innerText();
  const modal = () => ui.locator('#modal-layer').innerText();
  const go = async route => { await ui.locator('#sidebar [data-route="'+route+'"]').click(); await observe(); };
  const click = async name => { await button(name).click(); await observe(); };
  const choose = async (name, value) => { await label(name).selectOption(value); await observe(); };
  const until = async (predicate, message, timeout=15000) => { const end=Date.now()+timeout; while(Date.now()<end){await observe();if(await predicate())return;await ui.waitForTimeout(250);}throw new Error(message); };
  const finish = message => { context.passed.push(message); return message; };
  const download = async name => {
    const pending = ui.waitForEvent('download', { timeoutMs: 10000 });
    await button(name).click(); const result = await pending;
    const path = await result.path(); check(path, 'Download must produce a file');
    context.downloads.push(path); await observe();
  };

  if (stage === 'resources') {
    for(const key of ['datasetId','flowId','modelNodeId','taskId','oldReportId','failedExecutionId','successId'])delete context[key];
    await tab.reload(); await observe(); await go('repositories');
    await click('注册仓库');
    await label('仓库名称').fill('E2E repo'); await label('仓库地址').fill('invalid-url');
    await click('保存仓库配置');
    check((await ui.locator('#toasts').innerText()).includes('仓库地址'), 'Invalid repo address must be explained');
    await label('仓库地址').fill('https://git.example.internal/e2e.git'); await click('保存仓库配置');
    const row = ui.locator('tr').filter({ hasText: 'E2E repo' });
    await row.getByRole('button', { name: '同步', exact: true }).click();
    await row.getByText('可用', { exact: true }).waitFor({ state: 'visible', timeoutMs: 10000 }); await observe();
    await row.getByRole('button', { name: '编辑仓库', exact: true }).click(); await observe();
    await label('目标分支').fill('develop'); await click('保存仓库配置');
    check((await row.innerText()).includes('待执行'), 'Changed branch requires resync');
    await row.getByRole('button', { name: '同步', exact: true }).click();
    await row.getByText('可用', { exact: true }).waitFor({ state: 'visible', timeoutMs: 10000 }); await observe();
    await row.getByRole('button', { name: '隐藏仓库', exact: true }).click(); await click('取消');
    check(await row.count() === 1, 'Cancel hiding leaves repo intact');
    await row.getByRole('button', { name: '隐藏仓库', exact: true }).click(); await click('确认隐藏');
    check(await row.count() === 0, 'Hidden repo leaves active list');
    await click('已隐藏资源');
    await ui.locator('#modal-layer tr').filter({ hasText: 'E2E repo' }).getByRole('button', { name: '恢复', exact: true }).click();
    await observe(); check((await modal()).includes('没有已隐藏资源'), 'Restore completes hidden-resource workflow');
    await click('关闭'); check(await row.count() === 1, 'Restored repo can be selected again');
    return finish('仓库注册、校验、同步、分支变更、隐藏取消与恢复');
  }

  if (stage === 'assets') {
    await go('assets'); await click('导入素材');
    const pending = ui.waitForEvent('filechooser', { timeoutMs: 10000 });
    await ui.locator('#asset-import-form input[type="file"]').click();
    const chooser = await pending; check(chooser.isMultiple(), 'Asset importer supports multiple files');
    await chooser.setFiles(['input.txt', 'input.svg', 'input.wav', 'invalid.wav'].map(name => fixtureRoot+'/'+name));
    await click('导入到素材池');
    await ui.locator('#content').getByText('input.txt', { exact: true }).waitFor({ state: 'visible', timeoutMs: 10000 }); await observe();
    check((await content()).includes('input.svg') && (await content()).includes('input.wav'), 'All supported local file types import');
    check((await ui.locator('#toasts').innerText()).includes('invalid.wav 导入失败'), 'Invalid audio retains a per-file error');
    await choose('素材类型', 'Text'); await ui.getByLabel('搜索名称、内容或标签', { exact: true }).fill('input.txt'); await observe();
    await click('input.txt');
    await label('标准参考内容').fill(''); await label('内容正确，确认为正式参考').check(); await click('保存素材修订');
    check((await ui.locator('#toasts').innerText()).includes('参考内容'), 'Confirmed references cannot be blank');
    await label('标准参考内容').fill('E2E imported text'); await label('标签').fill('审计, 审计, 本地'); await click('保存素材修订');
    check((await content()).includes('参考已确认'), 'Asset edit persists');
    await choose('素材类型', 'all'); await ui.getByLabel('搜索名称、内容或标签', { exact: true }).fill('no-such-material'); await observe();
    check((await content()).includes('没有符合筛选条件的素材'), 'Asset empty filter state is explicit');
    await ui.getByLabel('搜索名称、内容或标签', { exact: true }).fill(''); await observe();
    await click('实时录音'); check((await modal()).includes('麦克风权限'), 'Recording makes its permission boundary visible');
    check(!await button('停止并入池').isEnabled(), 'Stop disabled until recording starts');
    await click('关闭');
    return finish('真实本地文字/图片/音频导入、坏音频错误、标注校验、筛选与录音准备态');
  }

  if (stage === 'datasets') {
    await go('datasets'); await click('新建测试集');
    await label('测试集名称').fill('E2E 完整案例');
    await ui.locator('[data-a="schema-add"][data-key="inputs"]').click(); await observe();
    check(await label('测试集名称').evaluate(el => el.value) === 'E2E 完整案例', 'Schema redraw retains dataset name');
    await ui.locator('[data-a="schema-up"][data-key="inputs"][data-index="1"]').click(); await observe();
    check(await ui.locator('[data-schema="inputs"] [data-field-name]').first().evaluate(el => el.value) === 'field_2', 'Schema reordering changes declaration order');
    await ui.locator('[data-a="schema-remove"][data-key="inputs"][data-index="0"]').click(); await observe();
    await click('下一步'); await click('绑定新案例'); await click('关闭弹窗');
    check((await modal()).includes('案例绑定'), 'X returns from nested case editor to wizard');
    await click('绑定新案例'); await label('案例名称').press('Escape'); await observe();
    check((await modal()).includes('案例绑定'), 'Escape returns from nested case editor to wizard');
    await click('绑定新案例'); await click('取消'); check((await modal()).includes('案例绑定'), 'Cancel returns to wizard');
    await click('批量加入演示音频');
    const countBefore = await ui.locator('#modal-layer tbody tr').count(); await click('批量加入演示音频');
    check(await ui.locator('#modal-layer tbody tr').count() === countBefore, 'Batch add is idempotent');
    await ui.locator('#modal-layer tbody tr').first().getByRole('button', { name: '编辑', exact: true }).click(); await observe();
    await label('案例名称').fill('E2E 修改案例'); await click('保存案例');
    check((await modal()).includes('E2E 修改案例'), 'Draft case edit returns and persists');
    await ui.locator('#modal-layer tbody tr').last().getByRole('button', { name: '移除', exact: true }).click(); await observe();
    check(await ui.locator('#modal-layer tbody tr').count() === countBefore-1, 'Draft case removal persists');
    await click('下一步'); await click('上一步'); await click('下一步'); await click('创建测试集');
    context.datasetId = await ui.locator('[data-a="add-case"]').getAttribute('data-id');
    check((await content()).includes('E2E 修改案例'), 'Created dataset includes edited cases');
    await click('编辑名称与结构'); await label('测试集名称').fill('E2E 完整案例 · 修订');
    await click('下一步'); await click('下一步'); await click('保存测试集版本');
    check((await content()).includes('测试集 v2'), 'Dataset structure/name edits create a new version');
    await click('返回列表');
    return finish('测试集结构增删排序、嵌套取消、批量去重、案例修订、返回与版本编辑');
  }

  if (stage === 'flow') {
    await go('pipelines'); await click('新建流程');
    await label('流程名称').fill('E2E 自建文本流程'); await label('初始输入').selectOption('text'); await label('统一输出').selectOption('reply');
    await click('创建草稿并打开画布'); context.flowId = await label('选择流程').evaluate(el => el.value);
    await click('保存版本'); check((await modal()).includes('校验失败'), 'Incomplete draft cannot be saved executable'); await click('关闭');
    await ui.locator('.palette [data-module="model"]').click(); await observe();
    context.modelNodeId = await ui.locator('.flow-node.selected').getAttribute('data-node');
    await ui.locator('[data-a="connect-out"][data-id="start"]').click();
    await ui.locator('[data-a="connect-in"][data-id="'+context.modelNodeId+'"]').click(); await observe();
    await ui.locator('[data-a="connect-out"][data-id="'+context.modelNodeId+'"]').click();
    await ui.locator('[data-a="connect-in"][data-id="end"]').click(); await observe();
    await click('校验'); check((await modal()).includes('图无环'), 'User-built graph validates'); await click('关闭');
    await click('保存版本'); check((await ui.locator('.pipeline-bar').innerText()).includes('v1'), 'First valid graph becomes v1');
    await button('回答生成，点击配置').press('Enter'); await observe(); await label('节点名称').fill('E2E 未保存修改');
    check((await ui.locator('.pipeline-bar').innerText()).includes('未保存修改'), 'Node edits mark dirty immediately');
    await click('快速测试'); check((await ui.locator('#toasts').innerText()).includes('先保存'), 'Quick-run blocks unsaved graph');
    await click('放弃修改'); check((await content()).includes('回答生成') && !(await content()).includes('E2E 未保存修改'), 'Revert restores saved graph');
    await click('放大画布'); await click('缩小画布'); await click('适应全部节点');
    await download('导出流程快照'); await click('快速测试');
    await ui.locator('input[name="source"][value="live"]').check(); await observe();
    await label('transcript · Text').fill('E2E 自定义文字'); await click('模拟执行一次');
    await until(async()=>(await content()).includes('已完成'),'Execution must complete');
    await click('查看 Trace'); check((await content()).includes('模拟回答：E2E 自定义文字'), 'Custom text remains usable through start/model/end');
    await click('输入与输出'); await download('导出 JSON');
    return finish('自建 DAG、失败校验、整组连接、键盘选择、版本保存/撤销、缩放、自定义快速输入与导出');
  }

  if (stage === 'tasks') {
    if(context.taskId){await go('tasks');await ui.locator('[data-a="task-detail"][data-id="'+context.taskId+'"]').first().click();await observe();}else{
    await go('tasks'); await click('创建测试任务');
    await label('任务名称').fill('E2E 批次故障闭环');
    await choose('配对测试集', context.datasetId); await choose('配对流程', 'flow-race');
    await click('添加配对'); check(await ui.locator('[data-pair]').count() === 2, 'Explicit pair can be added');
    await button('移除配对').last().click(); await observe(); check(await ui.locator('[data-pair]').count() === 1, 'Pair removal retains at least one');
    await choose('任务统一评测配置', 'quality');
    await label('同时执行案例数').fill('2'); await label('同时执行案例数').press('Tab'); await observe();
    await label('故障演示：第 3 个计划项触发 ASR 错误，其余继续').check(); await click('冻结计划并模拟执行');
    context.taskId = await ui.locator('[data-a="cancel-task"]').getAttribute('data-id');
    await go('overview'); check((await content()).includes('E2E 批次故障闭环'), 'Overview follows newest running batch safely');
    await go('tasks'); await click('E2E 批次故障闭环');
    }
    await until(async()=>(await content()).includes('完成 · 有异常'),'Fault batch must complete');
    const rows = ui.locator('tr').filter({ has: ui.locator('[data-a="execution-detail"]') });
    check((await rows.allTextContents()).some(t => t.includes('失败')), 'Injected case failure remains visible');
    check((await rows.allTextContents()).filter(t => t.includes('成功')).length >= 3, 'Other plans continue after failure');
    context.oldReportId = await label('报告版本').evaluate(el => Array.from(el.options).find(o => o.value !== 'current').value);
    const failed = rows.filter({ hasText: '失败' });
    context.failedExecutionId = await failed.locator('[data-a="execution-detail"]').getAttribute('data-id');
    await failed.getByRole('button', { name: '查看 Trace', exact: true }).click(); await observe();
    await click('重跑'); await go('tasks'); await click('E2E 批次故障闭环');
    check((await content()).includes('新尝试运行中，保留已结束结果'), 'Active rerun keeps old finished result in report');
    await until(async()=>(await content()).includes('已完成'),'Execution must complete');
    await choose('报告版本', context.oldReportId);
    check((await ui.locator('tr').filter({ hasText: context.failedExecutionId }).innerText()).includes('失败'), 'Historical report preserves prior failed attempt');
    await choose('报告版本', 'current');
    check(!(await ui.locator('tr').filter({ hasText: context.failedExecutionId }).count()), 'Current report selects completed rerun');
    await click('创建新任务'); await label('任务名称').fill('E2E 取消闭环');
    await choose('配对流程', 'flow-race'); await click('冻结计划并模拟执行'); await click('取消整个任务');
    check((await content()).includes('未执行 · 任务取消'), 'Unissued plans remain unexecuted after cancel');
    await choose('报告版本', 'current'); check((await content()).includes('已取消'), 'Cancel terminal state survives cleanup');
    return finish('显式配对、案例并发、第3条失败继续、工作台最新任务、重跑双状态、旧报告与任务取消');
  }

  if (stage === 'history') {
    await go('executions'); await choose('执行状态筛选', 'failed');
    check((await content()).includes(context.failedExecutionId), 'Failure filter includes original attempt');
    await ui.getByLabel('搜索案例、执行或 Trace ID', { exact: true }).fill('not-an-execution'); await observe();
    check((await content()).includes('没有符合条件的执行'), 'History search has explicit empty state'); await click('清空筛选');
    await ui.locator('tr').filter({ hasText: context.failedExecutionId }).getByRole('button', { name: '打开执行详情', exact: true }).click(); await observe();
    await click('历史记录'); check((await content()).includes('第') || (await content()).includes('尝试'), 'All attempt history is reachable');
    await click('配置快照'); await download('导出快照'); await click('原始事件');
    check((await content()).includes('execution.failed'), 'Original failure events retained');
    await click('返回历史'); await choose('任务筛选', context.taskId);
    const success = ui.locator('tr').filter({ hasText: '成功' }).first();
    await success.getByRole('button', { name: '打开执行详情', exact: true }).click(); await observe();
    context.successId = await ui.locator('[data-a="reevaluate-execution"]').getAttribute('data-id');
    await click('仅重新评测'); await choose('评测配置版本', 'quality@1'); await choose('演示情形', 'error'); await click('新增评测记录');
    await click('评测结果');
    await ui.getByText('模拟评测服务返回解析错误。保留旧评分记录。', { exact: true }).waitFor({ state: 'visible', timeoutMs: 10000 }); await observe();
    const records = label('评测记录'); check(await records.evaluate(el => el.options.length) >= 2, 'Reevaluation appends a record');
    await records.selectOption(await records.evaluate(el => el.options[0].value)); await observe();
    check(!(await ui.locator('.evidence').allTextContents()).join(' ').includes('解析错误'), 'Old score can still be inspected');
    await click('仅重新评测'); await choose('评测配置版本', 'quality@1'); await click('新增评测记录');
    await until(async()=>(await ui.locator('#toasts').innerText()).includes('新评分已完成，旧记录全部保留'),'Reevaluation must complete');
    await click('历史记录'); check((await content()).includes('评测错误'), 'Old scoring error stays in history');
    await go('evaluation'); await ui.locator('[data-a="select-profile"][data-id="quality"]').click(); await click('编辑配置');
    await label('材料一致性合格线').fill('1'); await click('保存评测版本');
    check((await content()).includes('v2'), 'Profile edit creates a new version');
    await go('executions'); await click('清空筛选');
    await ui.locator('tr').filter({ hasText: context.successId }).getByRole('button', { name: '打开执行详情', exact: true }).click(); await click('仅重新评测');
    check(await label('评测配置版本').evaluate(el => Array.from(el.options).some(o => o.value === 'quality@1')), 'Original profile version remains available');
    await choose('评测配置版本', 'quality@2'); await click('新增评测记录');
    await until(async()=>(await ui.locator('#toasts').innerText()).includes('新评分已完成，旧记录全部保留'),'Reevaluation must complete');
    await click('评测结果'); check((await ui.locator('.evidence').allTextContents()).join(' ').includes('合格线 1'), 'Latest detail uses new threshold');
    await go('tasks'); await click('E2E 批次故障闭环');
    check((await content()).includes('无参考质量通过率 100%'), 'Batch report retains original scoring version');
    await go('overview'); await choose('统计评测口径', 'quality@2');
    check((await content()).replace(/\s+/g,' ').includes('无参考质量维度通过率 0%'), 'Overview separates different versions');
    return finish('历史筛选/清空、6个详情页签、导出、复评错误/恢复、旧评分查看、阈值与固定口径统计');
  }

  if (stage === 'utility') {
    await click('搜索页面和执行'); await ui.getByLabel('输入页面、案例名称或 execution_id', { exact: true }).fill('nothing-found'); await observe();
    check((await modal()).includes('没有匹配的页面或执行'), 'Global search has an explicit empty state');
    await ui.getByLabel('输入页面、案例名称或 execution_id', { exact: true }).fill(context.successId); await observe();
    await ui.locator('[data-a="search-execution"]').click(); await observe();
    check((await content()).includes(context.successId), 'Search opens the selected execution');
    await click('体验全流程');
    for (let i = 0; i < 7; i++) { await ui.locator('#guide-layer [data-a="guide-next"]').click(); await observe(); }
    check((await ui.locator('#guide-layer').innerText()).includes('8 / 8'), 'Guide reaches history');
    await click('完成体验'); check(await ui.locator('#guide-layer').innerText() === '', 'Guide completes and closes');
    await button('搜索页面和执行').press('ControlOrMeta+k'); await observe();
    check(await ui.locator('#modal-layer').isVisible(), 'Search shortcut opens modal');
    await ui.getByLabel('输入页面、案例名称或 execution_id', { exact: true }).press('Escape'); await observe();
    check(!await ui.locator('#modal-layer').isVisible(), 'Escape closes search');
    await go('assets');
    await ui.locator('[data-a="play-audio"]').first().click(); await observe();
    await ui.locator('[data-a="play-audio"]').first().click(); await observe();
    return finish('全局搜索、无结果与跳转、8步导览、快捷键/Escape、音频播放停止');
  }

  if (stage === 'canvas') {
    await go('pipelines'); await choose('选择流程', 'flow-multi');
    await click('组装文字材料，点击配置');
    await choose('transcript ← 来源字段', ''); await click('校验');
    check((await modal()).includes('缺少有效字段映射'), 'Missing assembly mappings are rejected'); await click('关闭');
    await choose('transcript ← 来源字段', 'asr:transcript');
    await click('编辑目标输出组');
    await ui.locator('[data-schema="outputs"] [data-field-name]').last().fill('transcript'); await click('应用输出组');
    check((await ui.locator('#toasts').innerText()).includes('唯一'), 'Assembly target names must be unique');
    await click('取消'); await click('放弃修改');
    await ui.locator('[data-a="connect-out"][data-id="summary"]').click();
    await ui.locator('[data-a="connect-in"][data-id="join"]').click(); await observe();
    check((await ui.locator('#toasts').innerText()).includes('不能形成循环'), 'Cycle connection is rejected');
    await ui.locator('[data-node="summary"]').press('Escape'); await observe();
    check(await ui.locator('.flow-port.out.armed').count() === 0, 'Escape disarms pending connection');
    await ui.locator('[data-a="connect-out"][data-id="start"]').click();
    await ui.locator('[data-a="connect-in"][data-id="pick-a"]').click(); await observe();
    check((await ui.locator('#toasts').innerText()).includes('已存在'), 'Duplicate connection is rejected');
    await ui.locator('[data-node="start"]').press('Escape'); await observe();
    await click('字段组装 / 选择'); await click('移除节点');
    await click('流式转换'); await choose('转换方向', 'to-batch'); await click('移除节点');
    await click('结束节点'); await click('移除节点'); await click('放弃修改');
    await click('图像理解，点击配置'); await label('图像提示词').fill('E2E 参数草稿');
    await label('节点超时（秒）').fill('0'); await click('保存版本');
    check((await modal()).includes('超时必须为正数'), 'Invalid platform timeout blocks save'); await click('关闭');
    await click('放弃修改'); await click('组装文字材料，点击配置'); await click('断开输入');
    await click('校验'); check((await modal()).includes('缺少来源组'), 'Disconnect changes graph and validation'); await click('关闭'); await click('放弃修改');
    await click('移除连线 1'); await click('取消');
    await click('移除连线 1'); await click('移除连线');
    await click('放弃修改'); await click('流程集');
    await ui.locator('.panel').filter({ hasText: '图文语音 · 组装理解' }).getByRole('button', { name: '打开画布', exact: true }).click(); await observe();
    await click('快速测试'); await click('模拟执行一次');
    await until(async()=>await ui.locator('[data-a="cancel-task"]').count()===0,'Multimodal case must complete'); await click('查看 Trace');
    await ui.locator('[data-a="trace-node"][data-id="vision"]').click(); await observe();
    check((await content()).includes('模块未声明内部 Trace'), 'Unexposed internals stay explicit');
    await go('modules'); await ui.locator('.module-card').filter({ hasText: '图像理解' }).getByRole('button', { name: '查看契约', exact: true }).click(); await observe();
    check(!await label('图像提示词').isEnabled(), 'Module detail example is read-only');
    await click('在画布中使用'); await click('移除节点'); await click('放弃修改');
    return finish('字段组装映射/重名、拒绝循环/重复边、内置节点增删、超时、断连、删边取消、模块只读/入图、多模态 Trace');
  }
  throw new Error('Unknown stage: '+stage);
}

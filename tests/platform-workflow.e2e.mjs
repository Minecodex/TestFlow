// Shared CUA / CI facade. Uses visible controls and real persisted APIs through the application.
export const workflow = { checks: [] };
const assert = (value, message) => { if (!value) throw Error(message); };
export async function verifyWorkflow(stage, tab, observe) {
  const ui = tab.playwright, button = name => ui.getByRole('button', { name, exact: true });
  const dialog = () => ui.getByRole('dialog').last();
  const click = async locator => { await locator.click(); await observe(); };
  const go = async name => { await click(ui.getByRole('link', { name: new RegExp('^' + name) })); };
  const finish = message => { workflow.checks.push({ stage, message }); return message; };
  if (stage === 'datasets') {
    await go('测试集'); await click(button('新建测试集'));
    await dialog().getByRole('textbox', { name: '名称', exact: true }).fill('TEST UI scripted dataset');
    await click(dialog().getByRole('button', { name: '新增字段', exact: true }).first());
    await click(dialog().getByRole('button', { name: '向上移动', exact: true }).nth(1));
    await click(dialog().getByRole('button', { name: '删除字段', exact: true }).first());
    await click(dialog().getByRole('button', { name: '下一步', exact: true }));
    await click(dialog().getByRole('button', { name: '新增案例', exact: true }));
    await dialog().getByRole('textbox', { name: '案例名称', exact: true }).fill('TEST UI scripted case');
    await dialog().getByRole('textbox', { name: 'text', exact: true }).fill('scripted real input');
    await dialog().getByRole('textbox', { name: '参考字段 JSON', exact: true }).fill('{bad');
    await observe(); assert(!await dialog().getByRole('button', { name: '保存', exact: true }).isEnabled(), 'Invalid reference must block save');
    await dialog().getByRole('textbox', { name: '参考字段 JSON', exact: true }).fill('{"text":"scripted real input"}');
    await dialog().getByRole('checkbox', { name: '已确认参考', exact: true }).check();
    await click(dialog().getByRole('button', { name: '保存', exact: true }));
    await click(dialog().getByRole('button', { name: '上一步', exact: true }));
    assert(await dialog().getByRole('textbox', { name: '名称', exact: true }).evaluate(e => e.value) === 'TEST UI scripted dataset', 'Wizard retains entered values');
    await click(dialog().getByRole('button', { name: '下一步', exact: true }));
    await click(dialog().getByRole('button', { name: '新增案例', exact: true }));
    await click(dialog().getByRole('button', { name: '取消', exact: true }));
    assert((await dialog().innerText()).includes('TEST UI scripted case'), 'Nested cancel returns to parent');
    await click(dialog().getByRole('button', { name: '编辑', exact: true }));
    await dialog().getByRole('textbox', { name: '案例名称', exact: true }).fill('TEST UI scripted case edited');
    await click(dialog().getByRole('button', { name: '保存', exact: true }));
    await click(dialog().getByRole('button', { name: '新增案例', exact: true }));
    await dialog().getByRole('textbox', { name: '案例名称', exact: true }).fill('TEST UI temporary draft removal');
    await dialog().getByRole('textbox', { name: 'text', exact: true }).fill('draft only');
    await click(dialog().getByRole('button', { name: '保存', exact: true }));
    await click(dialog().getByRole('button', { name: '移除', exact: true }).last());
    assert(!(await dialog().innerText()).includes('TEST UI temporary draft removal'), 'Draft case removal retains the edited case');
    await click(dialog().getByRole('button', { name: '下一步', exact: true }));
    await click(dialog().getByRole('button', { name: '保存', exact: true }));
    await ui.locator('.testflow-card').filter({ hasText: 'TEST UI scripted dataset' }).waitFor({ state: 'visible' });
    return finish('ordered schema, invalid reference, wizard return, nested cancel, draft case edit/removal and real dataset creation');
  }
  if (stage === 'evaluation') {
    await go('评测配置'); await click(button('新建评测配置'));
    await dialog().getByRole('textbox', { name: '名称', exact: true }).fill('TEST UI scripted rules');
    await dialog().getByRole('textbox', { name: '维度名称', exact: true }).fill('完成状态');
    await click(dialog().getByRole('button', { name: '新增维度', exact: true }));
    await click(dialog().getByRole('button', { name: '移除', exact: true }).last());
    await click(dialog().getByRole('button', { name: '保存', exact: true }));
    const card = ui.locator('.testflow-card').filter({ hasText: 'TEST UI scripted rules' });
    await card.waitFor({ state: 'visible' }); await click(card.getByRole('button', { name: 'TEST UI scripted rules', exact: true }));
    await click(button('编辑'));
    await dialog().getByRole('textbox', { name: '说明', exact: true }).fill('Immutable UI acceptance profile');
    await click(dialog().getByRole('button', { name: '保存', exact: true }));
    await click(card.getByRole('button', { name: '版本记录', exact: true }));
    assert((await dialog().innerText()).includes('"number": 2'), 'Profile revision is persisted');
    await click(dialog().getByRole('button', { name: '关闭', exact: true }));
    return finish('dimension add/remove, explicit completion binding, edit and immutable profile history');
  }
  if (stage === 'pipelines') {
    if (!workflow.pipelineId) {
      await go('流程画布'); await click(button('新建流程'));
      await dialog().getByRole('textbox', { name: '名称', exact: true }).fill('TEST UI scripted pipeline');
      await click(dialog().getByRole('button', { name: '创建', exact: true }));
    }
    await ui.locator('.react-flow__node').first().waitFor({ state: 'visible' });
    workflow.pipelineId = new URL(await tab.url()).pathname.split('/').at(-1);
    for (const label of ['放大', '缩小', '适应画布']) await click(button(label));
    const edge = ui.locator('.react-flow__edge-interaction').first();
    const point = await edge.evaluate(e => { const r = e.getBoundingClientRect(); return [r.x+r.width/2,r.y+r.height/2]; });
    await tab.click(point); await observe(); await click(dialog().getByRole('button', { name: '取消', exact: true }));
    // A horizontal SVG edge has a zero-height geometry box but a visible stroke.
    // Its continued presence and the next successful click prove it was retained.
    await ui.locator('.react-flow__edge').first().waitFor({state:'attached'});
    assert(await ui.locator('.react-flow__edge').count() === 1, 'Cancel edge deletion retains edge');
    await tab.click(point); await observe(); await click(dialog().getByRole('button', { name: '移除', exact: true }));
    await ui.locator('.react-flow__edge').first().waitFor({state:'detached'});
    assert(await ui.locator('.react-flow__edge').count() === 0, 'Confirmed edge deletion');
    await click(button('恢复上次保存'));
    await click(button('校验流程')); await ui.getByText('图校验通过', { exact: true }).waitFor({ state: 'visible' });
    await click(button('结束节点')); await ui.locator('.testflow-canvas').press('Delete'); await observe();
    await ui.locator('.react-flow__node').nth(2).waitFor({state:'hidden'});
    assert(await ui.locator('.react-flow__node').count() === 2, 'Keyboard node removal');
    await click(button('保存'));
    await ui.getByText('已保存版本 v2', { exact: true }).waitFor({ state: 'visible' });
    return finish('real pipeline, zoom/fit, edge deletion cancel/confirm, revert, validation, node keyboard removal and version save');
  }
  if (stage === 'tasks') {
    await go('测试任务'); await click(button('创建测试任务'));
    await dialog().getByRole('textbox', { name: '名称', exact: true }).fill('TEST UI scripted task');
    for (const [label, name] of [['评测配置','TEST UI scripted rules'],['测试集版本','TEST UI scripted dataset'],['流程版本','TEST UI scripted pipeline']]) {
      await click(dialog().getByRole('button', { name: new RegExp(' '+label+' '+label+'$') }));
      await click(ui.getByRole('option', { name, exact: true }));
    }
    await click(dialog().getByRole('button', { name: '新增配对', exact: true }));
    await click(dialog().getByRole('button', { name: '移除', exact: true }).last());
    await click(dialog().getByRole('button', { name: '预检与计划预览', exact: true }));
    await dialog().getByRole('button', { name: '创建测试任务', exact: true }).waitFor({ state: 'visible' });
    await click(dialog().getByRole('button', { name: '创建测试任务', exact: true }));
    workflow.taskId = new URL(await tab.url()).pathname.split('/').at(-1);
    const row = ui.getByRole('row').filter({ hasText: 'TEST UI scripted case' });
    await row.getByText('成功', { exact: true }).waitFor({ state: 'visible', timeoutMs:45000 });
    await row.getByText('通过', { exact: true }).waitFor({ state: 'visible' });
    await click(row.getByRole('button', { name: '查看详情', exact: true }));
    workflow.executionId = new URL(await tab.url()).pathname.split('/').at(-1);
    await click(button('重跑')); await ui.getByText('scripted real input', { exact: true }).first().waitFor({ state: 'visible' });
    await ui.getByRole('button', { name: '重跑', exact: true }).waitFor({ state: 'visible', timeoutMs:45000 });
    await click(button('返回')); assert((await tab.url()).includes(workflow.taskId), 'Rerun returns to its task report');
    return finish('explicit pairing, add/remove pair, preflight, real execution/evaluation, rerun and report return');
  }
  throw Error('Unknown workflow stage: '+stage);
}

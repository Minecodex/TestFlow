// Reusable desktop checks through the documented CUA Playwright facade.
export default async function verifyModuleRuntime(tab, observe, fixtureRoot = '/tmp/testflow-ui-audit') {
  const ui = tab.playwright, passed = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const label = name => ui.getByLabel(name, { exact: true });
  const button = name => ui.getByRole('button', { name, exact: true });
  const value = name => label(name).evaluate(el => el.value);
  const change = async (name, choice) => { await label(name).selectOption(choice); await observe(); };
  const noImplementationFields = async () => {
    check(await label('能力来源').count() === 0 && await label('外部服务地址').count() === 0, 'Module internals must stay outside platform configuration');
  };
  const dockerOnly = async () => {
    check(await label('后端语言').count() === 0 && await label('运行入口').count() === 0 && await label('本地启动命令').count() === 0,
      'Docker must not require native language or entry');
  };

  await tab.reload(); await observe();
  await ui.getByRole('button', { name: /^能力模块 / }).click(); await observe();
  await button('导入 ZIP 模块').click(); await observe();
  const chooserPending = ui.waitForEvent('filechooser', { timeoutMs: 10000 });
  await ui.locator('#module-form input[type="file"]').click();
  const chooser = await chooserPending;
  await chooser.setFiles([fixtureRoot+'/module.zip']); await observe();
  await noImplementationFields();
  const order = await ui.locator('#module-form').evaluate(el => Array.from(el.querySelectorAll('select')).map(select => select.getAttribute('aria-label')));
  check(order.indexOf('启动方式') < order.indexOf('后端语言') && order.indexOf('后端语言') < order.indexOf('运行入口'), 'Select launch mode before local language and entry');
  await label('模块名称').fill('E2E Ruby 模块');
  await change('后端语言', 'Ruby');
  check((await ui.locator('#module-form').innerText()).includes('module.zip'), 'Selected ZIP survives conditional form redraw');
  await change('运行入口', '__manual__');
  await label('入口路径').fill('adapter/test.rb');
  await change('启动方式', 'docker'); await dockerOnly();
  await label('Docker 镜像引用').fill('example/ruby-adapter:1');
  await change('挂载代码仓库（可选）', 'ai');
  await label('容器挂载目录').fill('/srv/module');
  await change('启动方式', 'local');
  check(await value('后端语言') === 'Ruby' && await value('入口路径') === 'adapter/test.rb', 'Mode switch preserves local draft');
  await change('启动方式', 'docker');
  check(await value('Docker 镜像引用') === 'example/ruby-adapter:1' && await value('容器挂载目录') === '/srv/module', 'Mode switch preserves Docker draft');
  await change('启动方式', 'local');
  await button('模拟导入并登记').click(); await observe();
  const nativeCard = ui.locator('.module-card').filter({ hasText: 'E2E Ruby 模块' });
  check((await nativeCard.innerText()).replace(/\s+/g, ' ').includes('Ruby 本地进程'), 'Local import uses chosen language');
  passed.push('launch-first local language/entry selection and per-mode draft preservation');

  await button('导入 ZIP 模块').click(); await observe();
  await label('模块名称').fill('E2E Docker 模块');
  await change('启动方式', 'docker'); await dockerOnly();
  await label('Docker 镜像引用').fill('example/adapter:1');
  await change('挂载代码仓库（可选）', 'ai');
  await label('容器挂载目录').fill('relative/path');
  await button('模拟导入并登记').click();
  check((await ui.locator('#toasts').innerText()).includes('绝对路径'), 'Reject relative container mount destinations');
  await label('容器挂载目录').fill('/workspace/repo');
  await button('模拟导入并登记').click(); await observe();
  const dockerCard = ui.locator('.module-card').filter({ hasText: 'E2E Docker 模块' });
  await dockerCard.getByRole('button', { name: '查看契约', exact: true }).click(); await observe();
  const dockerDetail = await ui.locator('#drawer-layer').innerText();
  check(dockerDetail.includes('ENTRYPOINT / CMD') && dockerDetail.includes('/workspace/repo'), 'Docker detail shows image startup and code mount');
  check(!dockerDetail.includes('运行入口') && !dockerDetail.includes('后端语言'), 'Docker detail excludes native settings');
  await button('关闭侧栏').click(); await observe();
  passed.push('Docker image startup, repository mount and destination validation');

  await button('导入 ZIP 模块').click(); await observe();
  await label('模块名称').fill('E2E 自定义语言');
  await change('后端语言', '__custom__');
  await label('自定义语言').fill('Elixir');
  await label('入口路径').fill('adapter/server.exs');
  await label('自定义启动命令').fill('elixir adapter/server.exs');
  await button('模拟导入并登记').click(); await observe();
  check((await ui.locator('.module-card').filter({ hasText: 'E2E 自定义语言' }).innerText()).includes('Elixir'), 'Custom local languages remain supported');
  passed.push('custom language profile remains available');

  await button('流程画布').click(); await observe();
  await button('语音识别，点击配置').click();
  await change('启动方式', 'docker'); await dockerOnly(); await noImplementationFields();
  await label('Docker 镜像引用').fill('example/asr-adapter:e2e');
  await change('挂载代码仓库（可选）', 'ai');
  await label('容器挂载目录').fill('/srv/e2e');
  await label('依赖代码版本').selectOption('92be461');
  check((await ui.locator('.pipeline-bar').innerText()).includes('未保存修改'), 'Runtime edits mark the flow dirty');
  await button('保存版本').click(); await observe();
  check((await ui.locator('.pipeline-bar').innerText()).includes('v4'), 'Runtime edits create a flow version');
  await button('快速测试').click(); await observe();
  await button('模拟执行一次').click(); await observe();
  await button('查看 Trace').click();
  await ui.getByText('正常 EOS', { exact: true }).waitFor({ state: 'visible', timeoutMs: 10000 }); await observe();
  await button('配置快照').click(); await observe();
  let snapshotText = await ui.locator('#content').innerText();
  check(snapshotText.includes('example/asr-adapter:e2e') && snapshotText.includes('/srv/e2e') && snapshotText.includes('92be461'), 'Execution freezes image, mount target and selected revision');
  check(!snapshotText.includes('后端语言') && !snapshotText.includes('运行入口'), 'All-Docker execution snapshot excludes local settings');
  const executionId = await ui.locator('[data-a="export-execution"]').getAttribute('data-id');
  passed.push('node mount settings, pinned revision, flow version and execution snapshot');

  await button('流程画布').click(); await observe();
  await button('语音识别，点击配置').click();
  await label('Docker 镜像引用').fill('example/asr-adapter:next-version');
  await label('容器挂载目录').fill('/srv/next-version');
  await button('保存版本').click();
  await button('执行历史').click(); await observe();
  await ui.locator('tr').filter({ hasText: executionId }).getByRole('button', { name: '打开执行详情', exact: true }).click();
  await button('配置快照').click(); await observe();
  snapshotText = await ui.locator('#content').innerText();
  check(snapshotText.includes('example/asr-adapter:e2e') && snapshotText.includes('/srv/e2e') && !snapshotText.includes('next-version'), 'Later edits leave historical runtime unchanged');
  passed.push('historical image and mount survive later edits');

  await ui.getByRole('button', { name: /^测试任务 / }).click();
  await button('创建测试任务').click(); await observe();
  await ui.locator('[data-pair-flow]').selectOption('flow-state'); await observe();
  await label('同时执行案例数').fill('3'); await label('同时执行案例数').press('Tab'); await observe();
  check((await ui.locator('#task-form').innerText()).includes('有效案例并发：1'), 'Sequential constraints remain effective');
  await button('取消').click(); await observe();
  passed.push('sequential module constraint remains effective');
  return passed;
}

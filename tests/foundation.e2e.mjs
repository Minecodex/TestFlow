// Run via the CUA Playwright facade or the regular Playwright runner adapter.
export async function verifyFoundation(tab, observe) {
  const ui = tab.playwright;
  const passed = [];
  const check = (value, message) => { if (!value) throw new Error(message); };
  const button = name => ui.getByRole('button', { name, exact: true });
  await ui.getByRole('heading', { name: '测试工作台', exact: true }).waitFor({ state: 'visible' });
  await ui.getByRole('status').waitFor({ state: 'visible' });
  await ui.getByText('服务已连接', { exact: true }).waitFor({ state: 'visible', timeoutMs: 10000 });
  check((await ui.locator('.testflow-system-grid').innerText()).includes('单体服务'), 'Real API reports monolith');
  await button('重新检查').click(); await observe();
  await ui.getByText('服务已连接', { exact: true }).waitFor({ state: 'visible' });
  passed.push('real API connection, metadata and refresh');

  const pages = ['代码仓库', '适配模块', '素材池', '测试集', '流程集', '评测配置', '测试任务', '执行历史'];
  for (const name of pages) {
    await ui.getByRole('link', { name, exact: true }).click(); await observe();
    await ui.getByRole('heading', { name, exact: true }).waitFor({ state: 'visible' });
    await ui.getByRole('heading', { name: '准备中', exact: true }).waitFor({ state: 'visible' });
    check(await ui.getByRole('link', { name, exact: true }).getAttribute('aria-current') === 'page', 'Active route navigation');
    await button('返回工作台').click(); await observe();
    await ui.getByRole('heading', { name: '测试工作台', exact: true }).waitFor({ state: 'visible' });
  }
  await ui.locator('.testflow-feature-card').filter({ hasText: '适配模块' }).getByRole('button').click(); await observe();
  await tab.reload(); await observe();
  await ui.getByRole('heading', { name: '适配模块', exact: true }).waitFor({ state: 'visible' });
  await button('返回工作台').click(); await observe();
  passed.push('eight business routes, active navigation, card entry, return and deep-route reload');

  await button('切换语言').click(); await observe();
  await ui.getByRole('heading', { name: 'Test workspace', exact: true }).waitFor({ state: 'visible' });
  await button('Change theme').click(); await observe();
  check((await ui.locator('html').getAttribute('class')).includes('dark'), 'Dark theme applied');
  await tab.reload(); await observe();
  await ui.getByRole('heading', { name: 'Test workspace', exact: true }).waitFor({ state: 'visible' });
  check(await ui.locator('html').getAttribute('lang') === 'en-US', 'Language preference persists');
  check((await ui.locator('html').getAttribute('class')).includes('dark'), 'Theme preference persists');
  for (const name of ['Code repositories', 'Adapter modules', 'Assets', 'Datasets', 'Pipelines', 'Evaluation profiles', 'Test tasks', 'Execution history']) {
    await ui.getByRole('link', { name, exact: true }).click(); await observe();
    await ui.getByRole('heading', { name, exact: true }).waitFor({ state: 'visible' });
  }
  await button('Change language').click(); await observe();
  await button('切换配色').click(); await observe();
  check((await ui.locator('html').getAttribute('class')).includes('light'), 'Light theme restored');
  await button('返回工作台').click(); await observe();
  passed.push('both languages for every page, light/dark themes and persisted preferences');

  const origin = new URL(await tab.url()).origin;
  await tab.goto(origin + '/missing-foundation-page'); await observe();
  await ui.getByRole('heading', { name: '页面不存在', exact: true }).waitFor({ state: 'visible' });
  await button('返回工作台').click(); await observe();
  await ui.getByText('服务已连接', { exact: true }).waitFor({ state: 'visible' });
  passed.push('404 and return to connected workspace');
  return passed;
}

export async function verifyUnavailable(tab, observe) {
  const ui = tab.playwright;
  await ui.getByRole('button', { name: '重新检查', exact: true }).click(); await observe();
  await ui.getByText('服务未连接', { exact: true }).waitFor({ state: 'visible', timeoutMs: 10000 });
  await ui.getByText('服务连接失败，稍后重试或检查服务是否已启动。', { exact: true }).waitFor({ state: 'visible' });
  return 'visible API failure and manual retry';
}

export async function verifyRecovery(tab, observe) {
  await tab.playwright.getByRole('button', { name: '重新检查', exact: true }).click(); await observe();
  await tab.playwright.getByText('服务已连接', { exact: true }).waitFor({ state: 'visible', timeoutMs: 10000 });
  return 'API recovery through retry';
}

export const layoutPages = [
  ['overview',''],['repositories','repositories'],['modules','modules'],['assets','assets'],
  ['datasets','datasets'],['pipelines','pipelines'],['evaluation','evaluation-profiles'],
  ['tasks','test-tasks'],['executions','executions'],
];

export async function verifyLayoutGroup(tab, observe, { width,locale,theme,setViewport,capture }) {
  const ui = tab.playwright, origin = new URL(await tab.url()).origin, checks = [];
  await setViewport({ width,height:1000 });
  if (await ui.locator('html').getAttribute('lang') !== locale) {
    await ui.getByRole('button', { name:locale === 'en-US' ? '切换语言':'Change language',exact:true }).click();
    await observe();
  }
  const dark = (await ui.locator('html').getAttribute('class') || '').includes('dark');
  if (dark !== (theme === 'dark')) {
    await ui.getByRole('button', { name:locale === 'zh-CN' ? '切换配色':'Change theme',exact:true }).click();
    await observe();
  }
  for (const [page,route] of layoutPages) {
    await tab.goto(origin+'/'+route);
    await ui.getByRole('heading', { level:1 }).waitFor({ state:'visible' });
    await observe();
    const geometry = await ui.evaluate(() => ({
      width:document.documentElement.clientWidth,height:document.documentElement.clientHeight,
      scroll:document.documentElement.scrollWidth,locale:document.documentElement.lang,
      dark:document.documentElement.className.includes('dark'),
    }));
    const passed = geometry.width === width && geometry.height === 1000 && geometry.scroll <= width
      && geometry.locale === locale && geometry.dark === (theme === 'dark');
    if (!passed) throw Error('Layout mismatch: '+JSON.stringify({ page,width,locale,theme,geometry }));
    const screenshot = `layout-${width}-${locale}-${theme}-${page}.jpg`;
    await capture(screenshot,{ x:0,y:0,width,height:1000 });
    checks.push({ page,width,locale,theme,geometry,passed,screenshot });
  }
  return checks;
}

import { test, expect } from '@playwright/test';
import { verifyFoundation, verifyUnavailable, verifyRecovery } from './foundation.e2e.mjs';

test('desktop foundation integrates with the monolith', async ({ page }) => {
  await page.goto('/');
  const tab = {
    playwright: page,
    reload: () => page.reload(),
    goto: url => page.goto(url),
    url: async () => page.url(),
  };
  expect(await verifyFoundation(tab, () => page.locator('body').innerText())).toHaveLength(4);
  await page.route('**/api/v1/system/status', route => route.abort());
  await verifyUnavailable(tab, () => page.locator('body').innerText());
  await page.unroute('**/api/v1/system/status');
  await verifyRecovery(tab, () => page.locator('body').innerText());
});

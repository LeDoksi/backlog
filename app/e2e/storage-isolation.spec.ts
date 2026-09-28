import { test, expect } from '@playwright/test';
import { installStub } from './fixtures/supabaseStub';

test('v2 never touches v1 localStorage keys', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('backlog-added', '[{"id":"v1-only"}]');
    localStorage.setItem('backlog-overrides', '{"v1-only":{"status":"done"}}');
  });
  await installStub(page, { signedIn: true, hasProfile: true });
  await page.goto('./');
  await page.waitForTimeout(500);
  const keys = await page.evaluate(() => ({ added: localStorage.getItem('backlog-added'), overrides: localStorage.getItem('backlog-overrides') }));
  expect(keys.added).toBe('[{"id":"v1-only"}]');
  expect(keys.overrides).toBe('{"v1-only":{"status":"done"}}');
});

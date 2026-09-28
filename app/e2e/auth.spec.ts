import { test, expect } from '@playwright/test';
import { installStub } from './fixtures/supabaseStub';

test('signed out shows the sign-in screen', async ({ page }) => {
  await installStub(page, { signedIn: false });
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Войти через Google' })).toBeVisible();
});

test('signed in without a profile shows not-invited', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: false });
  await page.goto('./');
  await expect(page.getByText('Этот аккаунт пока не приглашён')).toBeVisible();
});

test('signed in with a profile reaches the shell with bottom navigation on phone', async ({ page, isMobile }) => {
  await installStub(page, { signedIn: true, hasProfile: true });
  await page.goto('./');
  const nav = page.getByRole('navigation', { name: 'Разделы' });
  await expect(nav.filter({ visible: true })).toBeVisible();
  if (isMobile) await expect(page.getByRole('button', { name: 'Добавить тайтл' }).first()).toBeVisible();
});

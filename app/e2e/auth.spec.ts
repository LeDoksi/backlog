import { test, expect } from '@playwright/test';
import { installStub } from './fixtures/supabaseStub';

test('signed out shows the sign-in screen', async ({ page }) => {
  await installStub(page, { signedIn: false });
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Войти через Google' })).toBeVisible();
});

test('the sign-in screen says it is a closed club and explains the data without signing in', async ({ page }) => {
  await installStub(page, { signedIn: false });
  await page.goto('./');
  await expect(page.getByText('Закрытое пространство для друзей · Только по приглашению')).toBeVisible();
  await page.getByRole('button', { name: 'Как мы используем данные' }).click();
  const sheet = page.getByRole('dialog', { name: 'Как мы используем данные' });
  await expect(sheet.getByRole('heading', { name: 'Какие данные хранятся' })).toBeVisible();
  await expect(sheet.getByText('This product uses the TMDB API but is not endorsed or certified by TMDB')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
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

test('the phone sign-in screen only downloads the posters it shows', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone only');
  const covers = new Set<string>();
  page.on('request', (r) => { if (r.url().includes('images/covers/')) covers.add(r.url()); });
  await installStub(page, { signedIn: false });
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Войти через Google' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(covers.size).toBeLessThanOrEqual(16);
});

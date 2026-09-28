import { test, expect } from '@playwright/test';
import { installStub } from './fixtures/supabaseStub';

test('a new account picks a nickname and lands on an empty personal board', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, nickname: null });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Как тебя называть?' })).toBeVisible();
  const nick = page.getByRole('textbox', { name: 'Ник' });
  await nick.fill('taken');
  await expect(page.getByText('Ник занят')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Продолжить' })).toBeDisabled();
  await nick.fill('ab');
  await expect(page.getByText('Только латиница, цифры и _, от 3 до 20')).toBeVisible();
  await nick.fill('new_friend');
  await expect(page.getByText('Ник свободен')).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.getByRole('navigation', { name: 'Разделы' }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('Здесь пока пусто', { exact: false })).toBeVisible();
  const calls = await page.evaluate(() => (window as unknown as { __rpcCalls: { name: string; args: { p_nickname?: string } }[] }).__rpcCalls);
  expect(calls.some((c) => c.name === 'set_profile' && c.args.p_nickname === 'new_friend')).toBe(true);
});

import { test, expect } from '@playwright/test';
import { installStub } from './fixtures/supabaseStub';

async function openProfile(page: import('@playwright/test').Page) {
  await page.getByRole('navigation', { name: 'Разделы' }).filter({ visible: true }).getByRole('button', { name: 'Профиль' }).click();
}

test('the theme choice changes data-theme and survives a reload', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true });
  await page.goto('./');
  await openProfile(page);
  await page.getByRole('radio', { name: 'Тёмная' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await openProfile(page);
  await page.getByRole('radio', { name: 'Как в системе' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
});

test('inviting by email calls invite_email with the right arguments', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true });
  await page.goto('./');
  await openProfile(page);
  await page.getByRole('button', { name: 'Пригласить по email' }).click();
  const sheet = page.getByRole('dialog', { name: 'Пригласить по email' });
  await sheet.getByRole('textbox', { name: 'Почта Google' }).fill('friend@example.com');
  await sheet.getByRole('switch', { name: 'Добавить в моё пространство' }).click();
  await sheet.getByRole('button', { name: 'Пригласить' }).click();
  await expect(sheet.getByRole('status')).toContainText('Готово');
  const calls = await page.evaluate(() => (window as unknown as { __rpcCalls: unknown[] }).__rpcCalls);
  expect(calls).toContainEqual({ name: 'invite_email', args: { target_email: 'friend@example.com', add_to_my_workspace: true } });
});

test('stats show the all-time summary', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, drafts: [
    { id: 'a', title: 'A', category: 'movie', status: 'done', genres: ['драма'], cover: '', created_at: '1' },
    { id: 'b', title: 'B', category: 'movie', status: 'queue', genres: [], cover: '', created_at: '2' }
  ] });
  await page.goto('./');
  await page.getByRole('navigation', { name: 'Разделы' }).filter({ visible: true }).getByRole('button', { name: 'Итоги' }).click();
  await expect(page.getByText('За всё время')).toBeVisible();
  await expect(page.getByText('Из 2 в бэклоге', { exact: false })).toBeVisible();
  await expect(page.getByText('драма')).toBeVisible();
});

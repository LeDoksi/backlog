import { test, expect, type Page } from '@playwright/test';
import { installStub } from './fixtures/supabaseStub';
import { catalogRows } from './fixtures/catalog';

async function openProfile(page: Page) {
  await page.getByRole('navigation', { name: 'Разделы' }).filter({ visible: true }).getByRole('button', { name: 'Профиль' }).click();
}
const rpcCalls = (page: Page) => page.evaluate(() => (window as unknown as { __rpcCalls: { name: string; args: unknown }[] }).__rpcCalls);
const dasha = { id: '00000000-0000-4000-8000-0000000000d1', name: 'Даша', nickname: 'dasha' };

test('the theme choice changes data-theme, survives a reload and goes to the account', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true });
  await page.goto('./');
  await openProfile(page);
  await page.getByRole('radio', { name: 'Тёмная' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await rpcCalls(page)).toContainEqual({ name: 'set_theme', args: { p_theme: 'dark' } });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await openProfile(page);
  await page.getByRole('radio', { name: 'Как в системе' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
});

test('inviting by email only lets the person into the app', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true });
  await page.goto('./');
  await openProfile(page);
  await page.getByRole('button', { name: 'Пригласить по почте' }).click();
  const sheet = page.getByRole('dialog', { name: 'Пригласить по почте' });
  await sheet.getByRole('textbox', { name: 'Почта Google' }).fill('friend@example.com');
  await sheet.getByRole('button', { name: 'Пригласить' }).click();
  await expect(sheet.getByRole('status')).toContainText('Готово');
  expect(await rpcCalls(page)).toContainEqual({ name: 'invite_email', args: { target_email: 'friend@example.com' } });
});

test('the profile shows the nickname and both boards with their counts', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, titles: catalogRows(3), sharedTitles: catalogRows(5, 3), sharedWith: [dasha] });
  await page.goto('./');
  await openProfile(page);
  await expect(page.getByText('@e2e')).toBeVisible();
  await expect(page.getByText('3 тайтла, видно только мне')).toBeVisible();
  await expect(page.getByText('5 тайтлов, вместе с: Даша')).toBeVisible();
  await page.getByRole('button', { name: 'Участники' }).click();
  const sheet = page.getByRole('dialog', { name: 'Участники' });
  await sheet.getByRole('listitem').filter({ hasText: 'Даша' }).getByRole('button', { name: 'Удалить' }).click();
  await page.getByRole('dialog', { name: 'Удалить Даша из общей доски?' }).getByRole('button', { name: 'Удалить' }).click();
  await expect(sheet.getByText('Даша')).toHaveCount(0);
  expect(await rpcCalls(page)).toContainEqual({ name: 'remove_board_member', args: { p_user: dasha.id } });
});

test('creating a shared board invites someone by exact nickname', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, users: [dasha] });
  await page.goto('./');
  await openProfile(page);
  await page.getByRole('button', { name: 'Создать общую доску' }).click();
  const sheet = page.getByRole('dialog', { name: 'Создать общую доску' });
  await sheet.getByRole('textbox', { name: 'Ник' }).fill('@dash');
  await sheet.getByRole('button', { name: 'Найти' }).click();
  await expect(sheet.getByRole('alert')).toContainText('Не нашли @dash');
  await sheet.getByRole('textbox', { name: 'Ник' }).fill('@Dasha');
  await sheet.getByRole('button', { name: 'Найти' }).click();
  await sheet.getByRole('button', { name: 'Пригласить @dasha' }).click();
  await expect(sheet.getByRole('status')).toContainText('Приглашение отправлено');
  expect(await rpcCalls(page)).toContainEqual({ name: 'invite_to_shared_board', args: { p_user: dasha.id } });
});

test('accepting an incoming invite (in «Друзья») adds the shared board', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, titles: catalogRows(2),
    invites: [{ id: 7, from_id: dasha.id, from_name: 'Даша', from_nickname: 'dasha' }] });
  await page.goto('./');
  await page.getByRole('navigation', { name: 'Разделы' }).filter({ visible: true }).getByRole('button', { name: /Друзья/ }).click();
  await expect(page.getByText('зовёт в общую доску')).toBeVisible();
  await page.getByRole('button', { name: 'Принять: Даша' }).click();
  await expect(page.getByText('зовёт в общую доску')).toHaveCount(0);
  await openProfile(page);
  await expect(page.getByText('0 тайтлов, вместе с: Даша')).toBeVisible();
  expect(await rpcCalls(page)).toContainEqual({ name: 'respond_board_invite', args: { p_id: 7, p_accept: true } });
});

test('stats show the all-time summary', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, titles: [
    { id: 'a', title: 'A', category: 'movie', status: 'done', genres: ['драма'], cover: '', created_at: '1' },
    { id: 'b', title: 'B', category: 'movie', status: 'queue', genres: [], cover: '', created_at: '2' }
  ] });
  await page.goto('./');
  await page.getByRole('navigation', { name: 'Разделы' }).filter({ visible: true }).getByRole('button', { name: 'Итоги' }).click();
  await expect(page.getByText('За всё время', { exact: true })).toBeVisible();
  await expect(page.getByText('Из 2 в бэклоге', { exact: false })).toBeVisible();
  await expect(page.getByText('драма')).toBeVisible();
});


test('stats open on this month when something was finished in it', async ({ page }) => {
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1, 12).toISOString();
  await installStub(page, { signedIn: true, hasProfile: true, titles: [
    { id: 'a', title: 'A', category: 'movie', status: 'done', genres: ['драма'], cover: '', completed_at: thisMonth, created_at: '1' },
    { id: 'b', title: 'B', category: 'movie', status: 'done', genres: [], cover: '', completed_at: null, created_at: '2' }
  ] });
  await page.goto('./');
  await page.getByRole('navigation', { name: 'Разделы' }).filter({ visible: true }).getByRole('button', { name: 'Итоги' }).click();
  await expect(page.getByRole('radio', { name: 'Месяц' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('На 1 больше, чем в прошлом месяце')).toBeVisible();
  await page.getByRole('radio', { name: 'Всё время' }).click();
  await expect(page.getByText('За всё время', { exact: true })).toBeVisible();
  await expect(page.getByText('Из 2 в бэклоге', { exact: false })).toBeVisible();
});

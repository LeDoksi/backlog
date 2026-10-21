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

test('the admin invites by email and with a link, sees live invites and takes one back', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, isAdmin: true });
  await page.goto('./');
  await openProfile(page);
  await page.getByRole('button', { name: 'Пригласить в Бэклог' }).click();
  const sheet = page.getByRole('dialog', { name: 'Пригласить в Бэклог' });
  await expect(sheet.getByText('Сейчас нет неиспользованных приглашений')).toBeVisible();
  await sheet.getByRole('textbox', { name: 'Почта Google' }).fill('friend@example.com');
  await sheet.getByRole('button', { name: 'Пригласить', exact: true }).click();
  await expect(sheet.getByRole('status')).toContainText('Готово');
  expect(await rpcCalls(page)).toContainEqual({ name: 'invite_email', args: { target_email: 'friend@example.com' } });
  const live = sheet.getByRole('list', { name: 'Действующие приглашения' });
  await expect(live.getByRole('listitem')).toHaveCount(1);

  await sheet.getByRole('radio', { name: 'Ссылкой' }).click();
  await sheet.getByRole('textbox', { name: 'Почта Google' }).fill('pal@example.com');
  await sheet.getByRole('button', { name: 'Создать ссылку' }).click();
  await expect(sheet.getByText('Пустит только pal@example.com, один раз')).toBeVisible();
  await expect(sheet.getByText('#f/g7k2q4m9x0', { exact: false })).toBeVisible();
  expect(await rpcCalls(page)).toContainEqual({ name: 'create_invite_link', args: { p_email: 'pal@example.com' } });
  await expect(live.getByRole('listitem')).toHaveCount(2);

  await live.getByRole('button', { name: 'Отозвать: friend@example.com' }).click();
  await expect(live.getByRole('listitem')).toHaveCount(1);
  expect(await rpcCalls(page)).toContainEqual({ name: 'admin_revoke_invite', args: { p_kind: 'email', p_key: 'friend@example.com' } });
});

test('a member does not see «Пригласить в Бэклог» and never asks for invites', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true });
  await page.goto('./');
  await openProfile(page);
  await expect(page.getByText('Данные и аккаунт')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Пригласить в Бэклог' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Пригласить по почте/ })).toHaveCount(0);
  const names = (await rpcCalls(page)).map((c) => c.name);
  expect(names).not.toContain('admin_invites');
  expect(names).not.toContain('create_invite_link');
});

test('deleting the account needs the nickname, then lands on the sign-in screen with the mirror gone', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, titles: catalogRows(2) });
  await page.goto('./');
  await openProfile(page);
  await page.getByRole('button', { name: 'Удалить аккаунт' }).click();
  const sheet = page.getByRole('dialog', { name: 'Удалить аккаунт?' });
  const confirm = sheet.getByRole('button', { name: 'Удалить аккаунт' });
  await expect(confirm).toBeDisabled();
  await sheet.getByRole('textbox').fill('someone');
  await expect(confirm).toBeDisabled();
  await sheet.getByRole('textbox').fill('@E2E');
  await confirm.click();
  await expect(page.getByRole('button', { name: 'Войти через Google' })).toBeVisible();
  expect(await rpcCalls(page)).toContainEqual({ name: 'delete_my_account', args: { p_nickname: 'e2e' } });
  const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('bl2:titles:')));
  expect(left).toEqual([]);
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

test('«Скрытые тайтлы» shows only when something is hidden', async ({ page }) => {
  const rows = catalogRows(3);
  await installStub(page, { signedIn: true, hasProfile: true, titles: rows });
  await page.goto('./');
  await openProfile(page);
  await expect(page.getByRole('button', { name: 'Приватность' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Скрытые тайтлы/ })).toHaveCount(0);
});

test('with a hidden title the row is there with its count', async ({ page }) => {
  const rows = catalogRows(3).map((r, i) => (i === 0 ? { ...r, hidden: true } : r));
  await installStub(page, { signedIn: true, hasProfile: true, titles: rows });
  await page.goto('./');
  await openProfile(page);
  await expect(page.getByRole('button', { name: /Скрытые тайтлы/ })).toContainText('1');
});

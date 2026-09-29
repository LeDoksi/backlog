import { test, expect, type Page } from '@playwright/test';
import { installStub, PERSONAL, SHARED } from './fixtures/supabaseStub';
import { catalogRows } from './fixtures/catalog';

const dasha = { id: '00000000-0000-4000-8000-0000000000d1', name: 'Даша', nickname: 'dasha' };
const rpcCalls = (page: Page) => page.evaluate(() => (window as unknown as { __rpcCalls: { name: string; args: unknown }[] }).__rpcCalls);
const writes = (page: Page) => page.evaluate(() => (window as unknown as { __writes?: Record<string, unknown>[] }).__writes ?? []);
async function openProfile(page: Page) {
  await page.getByRole('navigation', { name: 'Разделы' }).filter({ visible: true }).getByRole('button', { name: 'Профиль' }).click();
}

test('board levels and switches go to the server with every value', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, titles: catalogRows(2), sharedTitles: catalogRows(2, 2), sharedWith: [dasha] });
  await page.goto('./');
  await openProfile(page);
  await page.getByRole('button', { name: 'Приватность' }).click();
  const sheet = page.getByRole('dialog', { name: 'Приватность' });
  await sheet.getByRole('radiogroup', { name: 'Кто видит: Моё' }).getByRole('radio', { name: 'Друзья' }).click();
  await sheet.getByRole('radiogroup', { name: 'Кто видит: Общее с: Даша' }).getByRole('radio', { name: 'Все в Бэклоге' }).click();
  await expect(sheet.getByRole('radiogroup', { name: 'Кто видит: Моё' }).getByRole('radio', { name: 'Друзья' })).toHaveAttribute('aria-checked', 'true');
  await sheet.getByRole('switch', { name: 'Лидерборд' }).click();
  await expect(sheet.getByRole('switch', { name: 'Лидерборд' })).toHaveAttribute('aria-checked', 'true');
  await sheet.getByRole('switch', { name: 'Поиск по нику' }).click();
  const calls = await rpcCalls(page);
  expect(calls).toContainEqual({ name: 'set_board_visibility', args: { p_workspace: PERSONAL, p_visibility: 'friends' } });
  expect(calls).toContainEqual({ name: 'set_board_visibility', args: { p_workspace: SHARED, p_visibility: 'everyone' } });
  expect(calls).toContainEqual({ name: 'set_privacy', args: { p_in_leaderboard: true, p_share_activity: true, p_share_matches: true, p_findable_by_nick: true } });
  expect(calls).toContainEqual({ name: 'set_privacy', args: { p_in_leaderboard: true, p_share_activity: true, p_share_matches: true, p_findable_by_nick: false } });
  await page.keyboard.press('Escape');
  await expect(page.getByText('2 тайтла, видят друзья')).toBeVisible();
});

test('hiding a title from friends writes hidden and it shows up in «Скрытые тайтлы»', async ({ page }) => {
  const rows = catalogRows(3);
  await installStub(page, { signedIn: true, hasProfile: true, titles: rows });
  await page.goto('./');
  const card = page.locator(`article[data-id="${String(rows[0]!.id)}"]`);
  await card.locator(':scope > button').first().click();
  const sheet = page.getByRole('dialog', { name: String(rows[0]!.title) });
  await sheet.getByRole('button', { name: 'Скрыть от друзей' }).click();
  await expect(sheet.getByText('Скрыт от друзей')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Показать друзьям' })).toBeVisible();
  expect(await writes(page)).toContainEqual(expect.objectContaining({ op: 'update', id: rows[0]!.id, row: { hidden: true } }));
  await page.keyboard.press('Escape');
  await openProfile(page);
  await expect(page.getByRole('button', { name: /Скрытые тайтлы/ })).toContainText('1');
  await page.getByRole('button', { name: /Скрытые тайтлы/ }).click();
  const list = page.getByRole('dialog', { name: 'Скрытые тайтлы' });
  await list.getByRole('button', { name: `Показать друзьям «${String(rows[0]!.title)}»` }).click();
  await expect(list.getByText('Скрытых нет', { exact: false })).toBeVisible();
  expect(await writes(page)).toContainEqual(expect.objectContaining({ op: 'update', id: rows[0]!.id, row: { hidden: false } }));
});

import { test, expect, type Page } from '@playwright/test';
import { installStub, E2E_USER, PERSONAL, SHARED } from './fixtures/supabaseStub';
import { catalogRows } from './fixtures/catalog';

const rpcCalls = (page: Page) => page.evaluate(() => (window as unknown as { __rpcCalls: { name: string; args: Record<string, unknown> }[] }).__rpcCalls);
const nav = (page: Page) => page.getByRole('navigation', { name: 'Разделы' }).filter({ visible: true });
const id = (n: number) => `00000000-0000-4000-8000-00000000${String(n).padStart(4, '0')}`;
const row = (n: number, name: string, score: number) => ({ board_id: id(n), kind: 'personal', name, members: [id(n)], score, place: n, mine: false });
const DASHA = '00000000-0000-4000-8000-0000000000d1';

test('rows are boards: personal and shared apart, mine marked, mine outside the top ten under it', async ({ page }) => {
  const top = Array.from({ length: 10 }, (_, i) => row(i + 1, `Игрок ${i + 1}`, 20 - i));
  const ours = { board_id: SHARED, kind: 'shared', name: 'E2E + Даша', members: [E2E_USER, DASHA], score: 3, place: 2, mine: true };
  await installStub(page, {
    signedIn: true, hasProfile: true, titles: catalogRows(6),
    leaderboard: {
      movie: { status: 'ok', rows: top, mine: [{ board_id: PERSONAL, kind: 'personal', name: 'E2E', score: 2, place: 14 }] },
      anime: { status: 'ok', rows: [row(1, 'Вадим', 5), ours], mine: [{ board_id: PERSONAL, kind: 'personal', name: 'E2E', score: 0, place: null }, { ...ours, mine: undefined }] }
    }
  });
  await page.goto('./');
  await nav(page).getByRole('button', { name: /Итоги/ }).click();
  const board = page.getByRole('region', { name: /^Лидеры/ });
  await board.scrollIntoViewIfNeeded();
  await expect(board.getByRole('list', { name: 'Лидеры' }).getByRole('listitem')).toHaveCount(10);
  const outside = board.locator('p[data-mine]');
  await expect(outside).toHaveCount(1);
  await expect(outside).toContainText('14');
  await expect(outside).toContainText('E2E');
  await board.getByRole('button', { name: 'Аниме' }).click();
  await expect(board.getByRole('button', { name: 'Аниме' })).toHaveAttribute('aria-pressed', 'true');
  const list = board.getByRole('list', { name: 'Лидеры' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.getByRole('listitem').nth(1)).toContainText('E2E + Даша');
  await expect(list.getByRole('listitem').nth(1)).toHaveAttribute('data-mine', '');
  await expect(list.getByRole('listitem').nth(0)).not.toHaveAttribute('data-mine', '');
  await expect(board.getByText('Ты', { exact: true })).toHaveCount(0);
  // A board of mine with nothing done has no place and is not repeated under the list.
  await expect(outside).toHaveCount(0);
  await page.getByRole('radiogroup', { name: 'Период' }).getByRole('radio', { name: 'Всё время' }).click();
  await expect(page.getByRole('heading', { name: 'Лидеры за всё время' })).toBeVisible();
  expect(await rpcCalls(page)).toContainEqual({ name: 'leaderboard', args: { p_category: 'anime', p_period: 'all' } });
});

test('not taking part: a plate that opens privacy; switching it on shows the board', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, titles: catalogRows(6), leaderboard: 'off' });
  await page.goto('./');
  await nav(page).getByRole('button', { name: /Итоги/ }).click();
  const board = page.getByRole('region', { name: /^Лидеры/ });
  await expect(board).toContainText('Включи участие в лидерборде в приватности');
  await board.getByRole('button', { name: 'Открыть приватность' }).click();
  const sheet = page.getByRole('dialog', { name: 'Приватность' });
  await sheet.getByRole('switch', { name: 'Лидерборд' }).click();
  await expect(sheet.getByRole('switch', { name: 'Лидерборд' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await nav(page).getByRole('button', { name: /Итоги/ }).click();
  await expect(page.getByRole('region', { name: /^Лидеры/ }).getByText('Пока никто ничего не завершил.')).toBeVisible();
});

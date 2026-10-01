import { test, expect, type Page } from '@playwright/test';
import { installStub, E2E_USER } from './fixtures/supabaseStub';
import { catalogRows } from './fixtures/catalog';

const rpcCalls = (page: Page) => page.evaluate(() => (window as unknown as { __rpcCalls: { name: string; args: Record<string, unknown> }[] }).__rpcCalls);
const nav = (page: Page) => page.getByRole('navigation', { name: 'Разделы' }).filter({ visible: true });
const row = (n: number, name: string, score: number, me = false) => ({ user_id: `00000000-0000-4000-8000-00000000${String(n).padStart(4, '0')}`, name, score, place: n, is_me: me });

test('top ten by category; my line under it when I am not there; period changes the heading', async ({ page }) => {
  const top = Array.from({ length: 10 }, (_, i) => row(i + 1, `Игрок ${i + 1}`, 20 - i));
  await installStub(page, {
    signedIn: true, hasProfile: true, titles: catalogRows(6),
    leaderboard: {
      movie: { status: 'ok', rows: top, me: { score: 2, place: 14 } },
      anime: { status: 'ok', rows: [row(1, 'Вадим', 5), { ...row(2, 'E2E', 3, true), user_id: E2E_USER }], me: { score: 3, place: 2 } }
    }
  });
  await page.goto('./');
  await nav(page).getByRole('button', { name: /Итоги/ }).click();
  const board = page.getByRole('region', { name: /^Лидеры/ });
  await board.scrollIntoViewIfNeeded();
  await expect(board.getByRole('list', { name: 'Лидеры' }).getByRole('listitem')).toHaveCount(10);
  const mine = board.locator('p', { hasText: 'Ты' });
  await expect(mine).toContainText('14');
  await expect(mine).toContainText('2');
  await board.getByRole('button', { name: 'Аниме' }).click();
  await expect(board.getByRole('button', { name: 'Аниме' })).toHaveAttribute('aria-pressed', 'true');
  const list = board.getByRole('list', { name: 'Лидеры' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.getByRole('listitem').nth(1)).toContainText('Ты');
  await expect(mine).toHaveCount(0);
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

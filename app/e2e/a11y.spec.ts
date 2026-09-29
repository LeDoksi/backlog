import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installStub } from './fixtures/supabaseStub';
import { catalogRows } from './fixtures/catalog';

// Spec 7: no serious or critical axe violations on the core screens, in both
// themes. Minor/moderate findings are reported by axe but not gated.
const rows = catalogRows(24);
const parts = [{ id: String(rows.find((r) => r.parts)!.id), indices: [0] }];

async function audit(page: Page, where: string) {
  // Let entry animations settle, otherwise contrast is measured mid-fade.
  await page.waitForTimeout(700);
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const report = bad.map((v) => `${where}: ${v.id} (${v.impact}) ${v.help}\n  ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('\n  ')}`);
  expect(report, report.join('\n')).toEqual([]);
}

function nav(page: Page, name: string) {
  return page.getByRole('navigation', { name: 'Разделы' }).filter({ visible: true }).getByRole('button', { name }).click();
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('bl2:theme', t), theme);
    });

    test('sign-in screen', async ({ page }) => {
      await installStub(page, { signedIn: false });
      await page.goto('./');
      await expect(page.getByRole('button', { name: 'Войти через Google' })).toBeVisible();
      await audit(page, 'sign-in');
    });

    test('backlog, title panel and edit form', async ({ page }) => {
      await installStub(page, { signedIn: true, hasProfile: true, titles: rows, parts });
      await page.goto('./');
      await expect(page.locator('article.bl-card').first()).toBeVisible();
      await audit(page, 'backlog');
      await page.locator('article > button').first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await audit(page, 'title panel');
      await page.getByRole('dialog').getByRole('button', { name: 'Редактировать' }).click();
      await expect(page.getByRole('heading', { name: 'Редактирование' })).toBeVisible();
      await audit(page, 'edit form');
    });

    test('quick add', async ({ page }) => {
      await installStub(page, { signedIn: true, hasProfile: true, titles: rows });
      await page.goto('./');
      await page.getByRole('button', { name: 'Добавить тайтл' }).filter({ visible: true }).first().click();
      await expect(page.getByRole('dialog', { name: /Добав/ })).toBeVisible();
      await audit(page, 'quick add');
    });

    test('stats and profile', async ({ page }) => {
      await installStub(page, { signedIn: true, hasProfile: true, titles: rows, parts });
      await page.goto('./');
      await nav(page, 'Итоги');
      await expect(page.getByText('За всё время', { exact: true })).toBeVisible();
      await audit(page, 'stats');
      await nav(page, 'Профиль');
      await expect(page.getByRole('radio', { name: 'Тёмная' })).toBeVisible();
      await audit(page, 'profile');
      await page.getByRole('button', { name: 'Приватность' }).click();
      await expect(page.getByRole('dialog', { name: 'Приватность' })).toBeVisible();
      await audit(page, 'privacy');
    });

    test('friends, a friend\'s page and adding a friend', async ({ page }) => {
      const vadim = { id: '00000000-0000-4000-8000-0000000000e2', name: 'Вадим', nickname: 'vadim', since: '2026-08-14T10:00:00Z' };
      const cover = 'images/covers/drive-2011.jpg';
      await installStub(page, {
        signedIn: true, hasProfile: true, titles: rows, friends: [vadim],
        friendRequests: [{ id: 7, user_id: '00000000-0000-4000-8000-0000000000e4', name: 'Катя', nickname: 'katya' }],
        feed: [{ actor_id: vadim.id, actor_name: 'Вадим', kind: 'completed', title_id: 'd', workspace_id: 'w', title: 'Драйв', category: 'movie', cover, count: 1, covers: null, at: new Date().toISOString(), on_shared_board: false }],
        matches: [{ friend_id: vadim.id, friend_name: 'Вадим', title_key: 'k', title: 'Драйв', category: 'movie', cover, my_status: 'queue', friend_status: 'queue' }],
        shelves: { [vadim.id]: { done: [{ id: 'd', title: 'Драйв', category: 'movie', year: 2011, cover, common: true }] } },
        taste: { [vadim.id]: { status: 'ok', percent: 72, common: 14, both_want: 5, genres: ['драма'] } }
      });
      await page.goto('./');
      await nav(page, 'Друзья');
      await expect(page.getByRole('button', { name: /Вадим · завершено «Драйв»/ })).toBeVisible();
      await audit(page, 'friends');
      await page.getByRole('button', { name: /Вадим · завершено «Драйв»/ }).click();
      await expect(page.getByRole('region', { name: 'Совпадение вкусов' })).toBeVisible();
      await audit(page, 'friend page');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Добавить', exact: true }).first().click();
      await expect(page.getByRole('dialog', { name: 'Добавить друга' })).toBeVisible();
      await audit(page, 'add friend');
    });
  });
}

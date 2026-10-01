import { test, expect, type Page } from '@playwright/test';
import { installStub } from './fixtures/supabaseStub';
import { catalogRows } from './fixtures/catalog';

// Screen baselines, checked by eye against docs/design/2026-09-25-redesign/
// mockups before they were accepted. A diff here means a screen changed: fix
// the code, or re-accept with `npx playwright test visual --update-snapshots`
// after looking at the new shot.
const rows = catalogRows(24);
const parts = [{ id: String(rows.find((r) => r.parts)!.id), indices: [0] }];

async function shot(page: Page, name: string) {
  // Motion's springs are JS-driven, so CSS animation freezing doesn't cover them.
  await page.waitForTimeout(1000);
  await expect(page).toHaveScreenshot(`${name}.png`, { maxDiffPixelRatio: 0.01 });
}

function nav(page: Page, name: string) {
  return page.getByRole('navigation', { name: 'Разделы' }).filter({ visible: true }).getByRole('button', { name }).click();
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('bl2:theme', t), theme);
      // The stats hero draws a random set of posters; a fixed sequence keeps the shot stable.
      await page.addInitScript(() => {
        let seed = 1;
        Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
      });
    });

    test('sign-in', async ({ page }) => {
      await installStub(page, { signedIn: false });
      await page.goto('./');
      await expect(page.getByRole('button', { name: 'Войти через Google' })).toBeVisible();
      await shot(page, `${theme}-sign-in`);
    });

    test('empty board', async ({ page }) => {
      await installStub(page, { signedIn: true, hasProfile: true });
      await page.goto('./');
      await expect(page.getByRole('heading', { name: 'Бэклог' })).toBeVisible();
      await shot(page, `${theme}-empty`);
    });

    test('backlog, genres, title panel, edit', async ({ page }) => {
      await installStub(page, { signedIn: true, hasProfile: true, titles: rows, parts });
      await page.goto('./');
      await expect(page.locator('article.bl-card').first()).toBeVisible();
      await shot(page, `${theme}-backlog`);
      await page.getByRole('button', { name: /^Жанры/ }).click();
      await expect(page.getByRole('heading', { name: 'Жанры' })).toBeVisible();
      await shot(page, `${theme}-genres`);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('heading', { name: 'Жанры' })).toBeHidden();
      await page.locator('article > button').first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await shot(page, `${theme}-title`);
      await page.getByRole('dialog').getByRole('button', { name: 'Редактировать' }).click();
      await expect(page.getByRole('heading', { name: 'Редактирование' })).toBeVisible();
      await shot(page, `${theme}-edit`);
    });

    test('quick add', async ({ page }) => {
      await installStub(page, { signedIn: true, hasProfile: true, titles: rows });
      await page.goto('./');
      await page.getByRole('button', { name: 'Добавить тайтл' }).filter({ visible: true }).first().click();
      await expect(page.getByRole('heading', { name: 'Добавить тайтл' })).toBeVisible();
      await shot(page, `${theme}-quick-add`);
    });

    test('stats and profile', async ({ page }) => {
      // The whole catalog, so the summary has finished titles and genres.
      await installStub(page, { signedIn: true, hasProfile: true, titles: catalogRows(), parts, sharedTitles: catalogRows(5),
        sharedWith: [{ id: '00000000-0000-4000-8000-0000000000d1', name: 'Даша', nickname: 'dasha' }] });
      await page.goto('./');
      await nav(page, 'Итоги');
      await expect(page.getByText('За всё время', { exact: true })).toBeVisible();
      await shot(page, `${theme}-stats`);
      await nav(page, 'Профиль');
      await expect(page.getByRole('radio', { name: 'Тёмная' })).toBeVisible();
      await expect(page.getByText('5 тайтлов, вместе с: Даша')).toBeVisible();
      await shot(page, `${theme}-profile`);
    });

    test('friends', async ({ page }) => {
      const vadim = { id: '00000000-0000-4000-8000-0000000000e2', name: 'Вадим', nickname: 'vadim', since: '2026-08-14T10:00:00Z' };
      const dasha = { id: '00000000-0000-4000-8000-0000000000d1', name: 'Даша', nickname: 'dasha', since: '2026-08-20T10:00:00Z' };
      // Fixed times today, so the lines read the same on every run.
      const at = (h: number) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString(); };
      const covers = ['images/covers/the-batman-2022.jpg', 'images/covers/drive-2011.jpg', 'images/covers/frieren-2023.jpg'];
      await installStub(page, {
        signedIn: true, hasProfile: true, titles: rows, friends: [vadim, dasha],
        friendRequests: [{ id: 7, user_id: '00000000-0000-4000-8000-0000000000e4', name: 'Катя', nickname: 'katya' }],
        feed: [
          { actor_id: dasha.id, actor_name: 'Даша', kind: 'parts', title_id: 'f', workspace_id: 'w', title: 'Фрирен', category: 'anime', cover: covers[2], count: 2, covers: null, at: at(0), on_shared_board: true },
          { actor_id: vadim.id, actor_name: 'Вадим', kind: 'added', title_id: 'b', workspace_id: 'w', title: 'Бэтмен', category: 'movie', cover: covers[0], count: 3, covers, at: at(0), on_shared_board: false }
        ],
        matches: [{ friend_id: vadim.id, friend_name: 'Вадим', title_key: 'k', title: 'Бэтмен', category: 'movie', cover: covers[0], my_status: 'queue', friend_status: 'queue' }],
        taste: { [vadim.id]: { status: 'ok', percent: 72, common: 14, both_want: 5, genres: [] }, [dasha.id]: { status: 'ok', percent: 81, common: 9, both_want: 2, genres: [] } }
      });
      await page.goto('./');
      await nav(page, 'Друзья');
      await expect(page.getByRole('button', { name: /Даша · 2 сезона «Фрирен»/ })).toBeVisible();
      await shot(page, `${theme}-friends`);
    });
  });
}

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
      await installStub(page, { signedIn: true, hasProfile: true, titles: catalogRows(), parts });
      await page.goto('./');
      await nav(page, 'Итоги');
      await expect(page.getByText('За всё время')).toBeVisible();
      await shot(page, `${theme}-stats`);
      await nav(page, 'Профиль');
      await expect(page.getByRole('radio', { name: 'Тёмная' })).toBeVisible();
      await shot(page, `${theme}-profile`);
    });
  });
}

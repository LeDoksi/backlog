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
      await expect(page.getByText('За всё время')).toBeVisible();
      await audit(page, 'stats');
      await nav(page, 'Профиль');
      await expect(page.getByRole('radio', { name: 'Тёмная' })).toBeVisible();
      await audit(page, 'profile');
    });
  });
}

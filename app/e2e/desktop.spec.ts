import { test, expect } from '@playwright/test';
import { installStub } from './fixtures/supabaseStub';
import { catalogRows } from './fixtures/catalog';

test.beforeEach(async ({ isMobile }) => { test.skip(isMobile, 'desktop only'); });

test('five columns, a centred title modal and Esc-closing popovers', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, drafts: catalogRows() });
  await page.goto('./');
  const cards = page.locator('article');
  await expect(cards.nth(9)).toBeVisible();
  await page.waitForTimeout(800);
  const tops = await Promise.all([0, 4, 5, 9].map(async (i) => (await cards.nth(i).boundingBox())!.y));
  expect(tops[0]).toBe(tops[1]);
  expect(tops[2]).toBe(tops[3]);
  expect(tops[2]).toBeGreaterThan(tops[0]!);

  await page.getByRole('button', { name: /^Жанры/ }).click();
  await expect(page.getByRole('dialog', { name: 'Жанры' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Жанры' })).toBeHidden();

  await page.locator('article > button').first().click();
  const modal = page.getByRole('dialog').first();
  await page.waitForTimeout(500);
  const box = (await modal.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(880);
  expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThan(2);
});

test('the three control rows do not wrap or overlap at 1440', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, drafts: catalogRows() });
  await page.goto('./');
  const rows = [page.getByRole('heading', { name: 'Бэклог' }), page.getByRole('navigation', { name: 'Категории' }), page.getByRole('button', { name: /Что посмотреть/ })];
  const boxes = await Promise.all(rows.map(async (r) => (await r.boundingBox())!));
  expect(boxes[0]!.y + boxes[0]!.height).toBeLessThanOrEqual(boxes[1]!.y);
  expect(boxes[1]!.y + boxes[1]!.height).toBeLessThanOrEqual(boxes[2]!.y);
  const sort = (await page.getByRole('button', { name: 'Актуальное' }).boundingBox())!;
  expect(Math.abs(sort.y - boxes[2]!.y)).toBeLessThan(4);
});

test('the title modal leaves quickly on close instead of parking at the bottom edge', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, drafts: catalogRows(10) });
  await page.goto('./');
  await page.locator('article.bl-card').first().locator(':scope > button').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  await expect(dialog).toHaveCount(0, { timeout: 1 });
});

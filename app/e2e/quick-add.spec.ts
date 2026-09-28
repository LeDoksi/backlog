import { test, expect, type Page } from '@playwright/test';
import { installStub } from './fixtures/supabaseStub';

async function mockTmdb(page: Page) {
  await page.route(/api\.themoviedb\.org\/3\/search\/movie/, (r) => r.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { results: [
    { id: 438631, title: 'Дюна', release_date: '2021-09-15', poster_path: null },
    { id: 693134, title: 'Дюна: Часть вторая', release_date: '2024-02-27', poster_path: null }
  ] } }));
  await page.route(/api\.themoviedb\.org\/3\/movie\/\d+/, (r) => r.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: {
    id: 438631, title: 'Дюна', release_date: '2021-09-15', genres: [{ name: 'фантастика' }], overview: 'Пески Арракиса.', poster_path: null
  } }));
}

test('search, add with +, stay in the field, and refuse a duplicate', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, drafts: [] });
  await mockTmdb(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'Добавить тайтл' }).first().click();
  const panel = page.getByRole('dialog', { name: 'Добавить тайтл' });
  const field = panel.getByRole('textbox', { name: 'Название' });
  await expect(field).toBeFocused();
  await field.fill('Дюна');
  await panel.getByRole('button', { name: 'Добавить «Дюна»', exact: true }).click();
  await expect(panel.getByText('Добавлено: «Дюна»')).toBeVisible();
  await expect(field).toHaveValue('');
  await expect(field).toBeFocused();
  await field.fill('Дюна');
  await panel.getByRole('button', { name: 'Добавить «Дюна»', exact: true }).click();
  await expect(panel.getByText('Этот тайтл уже есть в бэклоге')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('article')).toHaveCount(1);
  await expect(page.locator('article')).toContainText('Дюна');
});

test('manual add when search has nothing', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, drafts: [] });
  await page.route(/api\.themoviedb\.org/, (r) => r.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { results: [] } }));
  await page.goto('./');
  await page.getByRole('button', { name: 'Добавить тайтл' }).first().click();
  const panel = page.getByRole('dialog', { name: 'Добавить тайтл' });
  await panel.getByRole('textbox', { name: 'Название' }).fill('Мой домашний фильм');
  await expect(panel.getByText('Ничего не нашлось.')).toBeVisible();
  await panel.getByRole('button', { name: /Добавить «Мой домашний фильм» вручную/ }).click();
  await expect(panel.getByText('Добавлено: «Мой домашний фильм»')).toBeVisible();
});

test('with the keyboard open the field and first result stay visible (BL-25)', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone only');
  await installStub(page, { signedIn: true, hasProfile: true, drafts: [] });
  await mockTmdb(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'Добавить тайтл' }).first().click();
  const panel = page.getByRole('dialog', { name: 'Добавить тайтл' });
  const field = panel.getByRole('textbox', { name: 'Название' });
  await field.fill('Дюна');
  // An iPhone keyboard leaves about 554px of the 844px screen visible.
  await page.setViewportSize({ width: 390, height: 554 });
  const first = panel.getByRole('button', { name: 'Добавить «Дюна»', exact: true });
  await expect(first).toBeVisible();
  const vh = await page.evaluate(() => window.visualViewport?.height ?? innerHeight);
  for (const el of [field, first]) {
    const box = (await el.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(vh);
  }
});

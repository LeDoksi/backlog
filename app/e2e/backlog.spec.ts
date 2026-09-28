import { test, expect } from '@playwright/test';
import { installStub } from './fixtures/supabaseStub';
import { catalogRows, catalogTitles } from './fixtures/catalog';

const rows = catalogRows();

test.beforeEach(async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, drafts: rows });
  await page.goto('./');
  await expect(page.locator('article').first()).toBeVisible();
});

test('the grid shows cards and the anime tab only anime', async ({ page }) => {
  expect(await page.locator('article').count()).toBeGreaterThanOrEqual(6);
  const anime = catalogTitles.filter((t) => t.category === 'anime').length;
  const tab = page.getByRole('navigation', { name: 'Категории' }).getByRole('button', { name: /^Аниме/ });
  await expect(tab).toContainText(String(anime));
  await tab.click();
  await expect(page.locator('article')).toHaveCount(anime);
});

test('search narrows to Фрирен', async ({ page }) => {
  await page.getByRole('button', { name: 'Поиск' }).click();
  await page.getByRole('searchbox').fill('Фрир');
  await expect(page.locator('article')).toHaveCount(1);
  await expect(page.locator('article')).toContainText('Фрирен');
});

test('an empty filter result offers a reset', async ({ page }) => {
  await page.getByRole('button', { name: 'Поиск' }).click();
  await page.getByRole('searchbox').fill('zzzzzz');
  await expect(page.getByText('Ничего не нашлось')).toBeVisible();
  await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
  await expect(page.locator('article').first()).toBeVisible();
});

test('two genres show their union and «Показать N» matches the grid', async ({ page }) => {
  const [a, b] = ['драма', 'ужасы'];
  const expected = catalogTitles.filter((t) => t.genres.includes(a) || t.genres.includes(b)).length;
  await page.getByRole('button', { name: /^Жанры/ }).click();
  const panel = page.getByRole('dialog');
  await panel.getByRole('button', { name: new RegExp(`^${a}`) }).click();
  await panel.getByRole('button', { name: new RegExp(`^${b}`) }).click();
  await panel.getByRole('button', { name: `Показать ${expected}` }).click();
  await expect(page.locator('article')).toHaveCount(expected);
});

test('the title sheet changes status, and Back closes it', async ({ page }) => {
  const plain = catalogTitles.find((t) => !t.parts && t.status === 'queue')!;
  await page.getByRole('button', { name: 'Поиск' }).click();
  await page.getByRole('searchbox').fill(plain.title);
  await page.getByRole('button', { name: new RegExp(`^${plain.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} — В бэклоге`) }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: plain.title })).toBeVisible();
  await sheet.getByRole('radio', { name: 'Завершено' }).click();
  await page.goBack();
  await expect(sheet).toBeHidden();
  await expect(page.locator('article').first()).toContainText('Завершено');
});

test('ticking a season derives the status', async ({ page }) => {
  const withParts = catalogTitles.find((t) => t.parts && t.parts.filter((p) => p.released !== false).length > 1)!;
  await page.getByRole('button', { name: 'Поиск' }).click();
  await page.getByRole('searchbox').fill(withParts.title.slice(0, 8));
  await page.locator('article > button').first().click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('checkbox').first().check();
  await expect(sheet.getByText(/Просмотрено 1 из/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('article').first()).toContainText('Смотрю');
});

test('deleting asks first and removes the card', async ({ page }) => {
  const first = page.locator('article').first();
  const name = (await first.getAttribute('data-id'))!;
  await first.locator(':scope > button').first().click();
  await page.getByRole('button', { name: 'Удалить тайтл' }).click();
  await expect(page.getByText('Это нельзя отменить.')).toBeVisible();
  await page.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.locator(`article[data-id="${name}"]`)).toHaveCount(0);
});

test('«Что посмотреть?» never picks a game on the games tab', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Категории' }).getByRole('button', { name: /^Игры/ }).click();
  await page.getByRole('button', { name: /Что посмотреть/ }).click({ force: true });
  await expect(page.getByText('Игры не смотрят').first()).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

// iOS Safari zooms the page in on focus when a field's text is under 16px.
test('no field is small enough for iPhone to zoom in on focus', async ({ page }) => {
  const small = async () => page.evaluate(() => [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]), textarea')]
    .filter((el) => (el as HTMLElement).offsetParent !== null)
    .map((el) => [(el as HTMLInputElement).getAttribute('aria-label') ?? el.tagName, parseFloat(getComputedStyle(el).fontSize)] as const)
    .filter(([, size]) => size < 16));
  await page.getByRole('button', { name: 'Поиск', exact: true }).click();
  expect(await small()).toEqual([]);
  await page.getByRole('button', { name: 'Закрыть поиск' }).click();
  await page.locator('article > button').first().click();
  await page.getByRole('button', { name: 'Редактировать' }).click();
  await page.getByRole('button', { name: '+ жанр' }).click();
  expect(await small()).toEqual([]);
});

test('the phone filter sheet fits the screen, sort options included', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone filter sheet');
  await page.setViewportSize({ width: 375, height: 740 });
  await page.getByRole('button', { name: 'Фильтры' }).click();
  const sheet = page.getByRole('dialog', { name: 'Фильтры' });
  await expect(sheet).toBeVisible();
  const overflow = await sheet.evaluate((el) => [...el.querySelectorAll('*')].filter((n) => n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX !== 'visible').length);
  expect(overflow).toBe(0);
  const byName = sheet.getByRole('radio', { name: 'Название' });
  const box = (await byName.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  await byName.click();
  await expect(byName).toHaveAttribute('aria-checked', 'true');
});

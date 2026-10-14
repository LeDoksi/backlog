// Wave 3 (spec 3.2–3.4): a wide game picture fits on a blur, a machine
// translation says so, and the daily refresh gives a game its tall cover
// and Russian description.
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { installStub, PERSONAL } from './fixtures/supabaseStub';

const HEADER = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/abc/header.jpg';
const TALL = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/library_600x900.jpg';
const wide = readFileSync(new URL('./fixtures/wide-header.jpg', import.meta.url));
const tall = readFileSync(new URL('../../images/covers/a-new-dawn-2026.jpg', import.meta.url));

async function steamImages(page: Page, hasTall: boolean) {
  await page.route(/steamstatic\.com\/.*\.jpg/, (r) => {
    if (r.request().url().includes('library_600x900')) return hasTall ? r.fulfill({ contentType: 'image/jpeg', body: tall }) : r.fulfill({ status: 404, body: '' });
    return r.fulfill({ contentType: 'image/jpeg', body: wide });
  });
}

const game = (extra: Record<string, unknown> = {}) => ({ id: 'portal-2-2011', title: 'Portal 2', category: 'game', status: 'queue', year: 2011, genres: ['Экшены'],
  synopsis: '[mt] Программа вечного тестирования расширена.', cover: HEADER, created_at: '2026-01-01T00:00:00Z', ...extra });

test('a wide game picture is shown whole on a blur; a machine translation is marked', async ({ page }, info) => {
  await installStub(page, { signedIn: true, hasProfile: true, titles: [game()] });
  await steamImages(page, false);
  await page.goto('./');
  const card = page.locator('article', { hasText: 'Portal 2' });
  await expect(card.locator('img')).toHaveCount(2);
  const fit = await card.locator('img').nth(1).evaluate((el) => getComputedStyle(el).objectFit);
  expect(fit).toBe('contain');
  await page.screenshot({ path: info.outputPath('tile.png') });
  await card.getByRole('button', { name: /^Portal 2/ }).click();
  await expect(page.getByText('Программа вечного тестирования расширена.')).toBeVisible();
  await expect(page.getByText('Машинный перевод')).toBeVisible();
  await expect(page.getByText('[mt]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('sheet.png') });
});

test('the daily refresh gives a Steam game its tall cover and the Russian text', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, titles: [game({ source: 'steam', source_id: '620', synopsis: 'The Perpetual Testing Initiative has been expanded.' })] });
  await steamImages(page, true);
  await page.route(/workers\.dev\/https:\/\/store\.steampowered\.com\/api\/appdetails\?appids=620&/, (r) => r.fulfill({
    headers: { 'access-control-allow-origin': '*' },
    json: { 620: { success: true, data: { name: 'Portal 2', release_date: { date: '18 апр. 2011 г.' }, genres: [{ description: 'Экшены' }],
      short_description: 'Программа вечного тестирования расширена.', header_image: HEADER, platforms: { windows: true } } } }
  }));
  await page.goto('./');
  const card = page.locator('article', { hasText: 'Portal 2' });
  await expect(card.locator('img')).toHaveCount(1);
  await expect(card.locator('img')).toHaveAttribute('src', TALL);
  const writes = await page.evaluate(() => (window as unknown as { __rpcCalls: { name: string; args: { p_workspace: string; p_updates: Record<string, unknown>[] } }[] }).__rpcCalls
    .filter((c) => c.name === 'apply_title_refresh'));
  expect(writes[0]!.args.p_workspace).toBe(PERSONAL);
  expect(writes[0]!.args.p_updates[0]).toMatchObject({ id: 'portal-2-2011', cover: TALL, synopsis: 'Программа вечного тестирования расширена.' });
  await card.getByRole('button', { name: /^Portal 2/ }).click();
  await expect(page.getByText('Программа вечного тестирования расширена.')).toBeVisible();
  await expect(page.getByText('Машинный перевод')).toHaveCount(0);
});

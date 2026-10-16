// Wave 2 (spec 2.1–2.5): one search row per franchise, parts on add, the
// extras block, «Ждёт продолжения», and the daily refresh. TMDb and
// Shikimori answer from the live responses recorded 2026-10-14.
import { test, expect, type Page } from '@playwright/test';
import { installStub, PERSONAL } from './fixtures/supabaseStub';
import { liveBody } from '../tests/fixtures/liveFetch';

async function liveApis(page: Page) {
  await page.route(/api\.themoviedb\.org|shikimori\.io/, (r) => {
    const body = liveBody(r.request().url());
    return r.fulfill(body == null ? { status: 404, headers: { 'access-control-allow-origin': '*' }, json: {} }
      : { headers: { 'access-control-allow-origin': '*' }, json: body });
  });
}

const row = (id: string, title: string, category: string, status: string, extra: Record<string, unknown> = {}) =>
  ({ id, title, category, status, genres: [], synopsis: '', cover: null, created_at: '2026-01-01T00:00:00Z', ...extra });

test('anime search shows a franchise once, with its seasons, and adds it whole', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, titles: [] });
  await liveApis(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'Добавить тайтл' }).first().click();
  const panel = page.getByRole('dialog', { name: 'Добавить тайтл' });
  await panel.getByRole('radio', { name: 'Аниме' }).click();
  await panel.getByRole('textbox', { name: 'Название' }).fill('атака титанов');
  await expect(panel.getByText('6 сезонов, 1 спецвыпуск')).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Добавить «/ })).toHaveCount(1);
  await panel.getByRole('button', { name: 'Добавить «Атака титанов»', exact: true }).click();
  await expect(panel.getByText('Добавлено: «Атака титанов»')).toBeVisible();
  // The franchise is now on the board: searching again says so.
  await panel.getByRole('textbox', { name: 'Название' }).fill('атака титанов');
  await expect(panel.getByText('Уже в бэклоге')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('article', { hasText: 'Атака титанов' }).getByRole('button', { name: /^Атака титанов/ }).click();
  await expect(page.getByText('Просмотрено 0 из 7')).toBeVisible();
  const toggle = page.getByRole('button', { name: /^Ещё \d+: OVA и спешлы/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('Атака титанов OVA')).toHaveCount(0);
  await toggle.click();
  await expect(page.getByText('Атака титанов OVA')).toBeVisible();
});

test('caught up with more announced: «Ждёт продолжения», after the queue', async ({ page }) => {
  const parts = [{ name: 'Сезон 1', released: true }, { name: 'Сезон 2', released: false, year: 2027 }];
  await installStub(page, {
    signedIn: true, hasProfile: true,
    titles: [row('waiting', 'Ждущий', 'series', 'queue', { parts }), row('queued', 'В очереди', 'movie', 'queue'), row('later', 'Потом', 'movie', 'unreleased')],
    parts: [{ id: 'waiting', indices: [0] }]
  });
  await page.goto('./');
  await expect(page.locator('article')).toHaveCount(3);
  await expect(page.locator('article').nth(0)).toContainText('В очереди');
  await expect(page.locator('article').nth(1)).toContainText('Ждущий');
  await expect(page.locator('article').nth(1)).toContainText('Ждёт продолжения');
  await page.getByRole('button', { name: /^Фильтры/ }).click();
  await page.getByRole('group', { name: 'Статус' }).getByRole('button', { name: 'Ждёт продолжения' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('article')).toHaveCount(1);
});

test('the daily refresh fills in seasons quietly on open', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, titles: [row('twd', 'Ходячие мертвецы', 'series', 'done', { source: 'tmdb-series', source_id: '1402' })] });
  await liveApis(page);
  await page.goto('./');
  await expect(page.locator('article')).toContainText('11 из 11');
  // The seasons write (the one-time normalization of wave 3 writes the card on its own).
  const calls = await page.evaluate(() => (window as unknown as { __rpcCalls: { name: string; args: { p_workspace: string; p_updates: { parts?: unknown }[] } }[] }).__rpcCalls
    .filter((c) => c.name === 'apply_title_refresh' && c.args.p_updates.some((u) => u.parts)).map((c) => c.args.p_workspace));
  expect(calls).toEqual([PERSONAL]);
  // Reopening the same day does not ask again (the stub's rows start over on reload, the day mark does not).
  await page.reload();
  await expect(page.locator('article')).toBeVisible();
  await page.waitForTimeout(1500);
  const again = await page.evaluate(() => (window as unknown as { __rpcCalls?: { name: string }[] }).__rpcCalls?.filter((c) => c.name === 'apply_title_refresh').length ?? 0);
  expect(again).toBe(0);
});

test('on open, an OVA of a show folds into it and a film out of the extras takes its place (2026-10-16)', async ({ page }) => {
  // Konosuba's film once sat in the extras, the way the Slime films did.
  const kParts = [
    { name: 'S1', ref: 'shiki:30831', year: 2016, released: true }, { name: 'S2', ref: 'shiki:32937', year: 2017, released: true },
    { name: 'S3', ref: 'shiki:49458', year: 2024, released: true }, { name: 'Этот замечательный мир! Багровая легенда', ref: 'shiki:38040', year: 2019, released: true, extra: true }
  ];
  await installStub(page, {
    signedIn: true, hasProfile: true,
    titles: [
      row('aot', 'Атака титанов', 'anime', 'done', { source: 'shikimori', source_id: '16498' }),
      row('aot-ova', 'Атака титанов OVA', 'anime', 'done', { source: 'shikimori', source_id: '18397', created_at: '2026-02-01T00:00:00Z' }),
      row('konosuba', 'Этот замечательный мир!', 'anime', 'queue', { source: 'shikimori', source_id: '30831', parts: kParts })
    ]
  });
  await liveApis(page);
  await page.goto('./');
  await expect(page.locator('article')).toHaveCount(2);
  await expect(page.locator('article', { hasText: 'Атака титанов OVA' })).toHaveCount(0);
  await page.locator('article', { hasText: 'Этот замечательный мир!' }).getByRole('button', { name: /^Этот замечательный мир!/ }).click();
  const sheet = page.getByRole('dialog');
  // The film is in the main list, between the second and third seasons, not behind «Ещё».
  const film = sheet.getByText('Этот замечательный мир! Багровая легенда');
  await expect(film).toBeVisible();
  await page.screenshot({ path: 'test-results/konosuba-film-main.png' });
  await page.keyboard.press('Escape');
  await page.locator('article', { hasText: 'Атака титанов' }).getByRole('button', { name: /^Атака титанов/ }).click();
  await page.getByRole('button', { name: /^Ещё \d+: OVA и спешлы/ }).click();
  await expect(page.getByRole('dialog').getByRole('checkbox', { name: /Атака титанов OVA/ })).toBeChecked();
  await page.screenshot({ path: 'test-results/aot-ova-ticked.png' });
});

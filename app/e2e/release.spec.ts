// BL-117: a film or game from search gets «Ещё не вышло» and loses it by
// itself, a film in cinemas says so, and what came out since the last visit
// gets a note.
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { installStub, PERSONAL } from './fixtures/supabaseStub';

const live = (f: string) => JSON.parse(readFileSync(new URL(`../tests/fixtures/live/${f}`, import.meta.url), 'utf8'));
const DUNE = live('tmdb-movie-1170608.json');
const FIGHTER = live('tmdb-movie-1153576.json');
const poster = (d: { poster_path: string }) => `https://image.tmdb.org/t/p/w500${d.poster_path}`;
const film = (id: string, d: { id: number; title: string; original_title: string; overview: string; poster_path: string }, extra: Record<string, unknown> = {}) => ({
  id, title: d.title, original_title: d.original_title, category: 'movie', status: 'queue', year: 2026, genres: [], synopsis: d.overview, cover: poster(d),
  source: 'tmdb-movie', source_id: String(d.id), created_at: '2026-01-01T00:00:00Z', ...extra });

async function tmdb(page: Page) {
  await page.route(/api\.themoviedb\.org\/3\/movie\/(\d+)\?/, (r) => {
    const id = /movie\/(\d+)\?/.exec(r.request().url())![1];
    const body = id === '1170608' ? DUNE : id === '1153576' ? FIGHTER : null;
    return body ? r.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: body }) : r.fulfill({ status: 404, body: '' });
  });
  await page.route(/image\.tmdb\.org/, (r) => r.fulfill({ status: 404, body: '' }));
}

test('a film not out yet gets the badge by itself; one in cinemas says so', async ({ page }, info) => {
  await page.clock.setFixedTime(new Date('2026-10-21T12:00:00'));
  await installStub(page, { signedIn: true, hasProfile: true, titles: [film('dune-3', DUNE), film('fighter', FIGHTER)] });
  await tmdb(page);
  await page.goto('./');
  const dune = page.locator('article', { hasText: DUNE.title });
  await expect(dune.getByText('Не вышло')).toBeVisible();
  await dune.getByRole('button', { name: new RegExp(`^${DUNE.title}`) }).click();
  await expect(page.getByText('Ещё не вышло. Снимем отметку сами, когда выйдет.')).toBeVisible();
  await page.screenshot({ path: info.outputPath('unreleased.png') });
  await page.keyboard.press('Escape');
  await page.locator('article', { hasText: FIGHTER.title }).getByRole('button', { name: new RegExp(`^${FIGHTER.title}`) }).click();
  await expect(page.getByText('Сейчас в кино')).toBeVisible();
  await page.screenshot({ path: info.outputPath('in-cinema.png') });
  const writes = await page.evaluate(() => (window as unknown as { __rpcCalls: { name: string; args: { p_workspace: string; p_updates: Record<string, unknown>[] } }[] }).__rpcCalls
    .filter((c) => c.name === 'apply_title_refresh'));
  expect(writes.map((w) => w.args.p_updates[0])).toContainEqual(expect.objectContaining({ id: 'dune-3', status: 'unreleased', release_date: '2026-12-15' }));
  expect(writes[0]!.args.p_workspace).toBe(PERSONAL);
});

test('the badge comes off when the film is out, with a note that opens it', async ({ page }, info) => {
  await page.clock.setFixedTime(new Date('2026-10-21T12:00:00'));
  await page.addInitScript((board) => { localStorage.setItem(`bl2:releases-seen:${board}`, '2026-10-10'); }, PERSONAL);
  await installStub(page, { signedIn: true, hasProfile: true, titles: [film('fighter', FIGHTER, { status: 'unreleased', release_date: '2026-10-25' })] });
  await tmdb(page);
  await page.goto('./');
  await expect(page.getByText(`Вышло в кино: ${FIGHTER.title}`)).toBeVisible();
  await page.screenshot({ path: info.outputPath('toast.png') });
  await page.getByRole('button', { name: 'Открыть' }).click();
  await expect(page.getByText('Сейчас в кино')).toBeVisible();
  await expect(page.getByText('Ещё не вышло')).toHaveCount(0);
});

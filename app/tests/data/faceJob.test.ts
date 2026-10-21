// The weekly card refresh and the daily release check (BL-117).
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runFaceJob, type FaceDeps } from '../../src/data/faceJob';
import type { TitleRow } from '../../src/lib/titleRow';
import type { FetchLike, StorageLike } from '../../src/lib/types';

const live = (f: string) => JSON.parse(readFileSync(join(__dirname, '../fixtures/live', f), 'utf8'));
const now = new Date('2026-10-21T12:00:00');

function memory(): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
}
type Route = [RegExp, unknown];
function routes(list: Route[], calls: string[] = []): FetchLike {
  return (url) => {
    calls.push(url);
    const hit = list.find(([re]) => re.test(url));
    return Promise.resolve(hit ? { ok: true, status: 200, json: () => Promise.resolve(hit[1]) } : { ok: false, status: 404, json: () => Promise.resolve({}) });
  };
}
const film = (id: string, sourceId: string, extra: Partial<TitleRow> = {}): TitleRow => ({ workspace_id: 'b1', id, title: id, category: 'movie', status: 'queue',
  source: 'tmdb-movie', source_id: sourceId, checked_parts: {}, parts: null, cover: 'x', synopsis: '', genres: [], created_at: '2026-01-01T00:00:00Z', ...extra });
const DUNE = live('tmdb-movie-1170608.json');
const FIGHTER = live('tmdb-movie-1153576.json');
const FILMS: Route[] = [[/\/3\/movie\/1170608\?/, DUNE], [/\/3\/movie\/1153576\?/, FIGHTER]];
const same = (d: { title: string; original_title: string; overview: string; poster_path: string; genres: { name: string }[]; release_date: string }) =>
  ({ title: d.title, original_title: d.original_title, synopsis: d.overview, cover: `https://image.tmdb.org/t/p/w500${d.poster_path}`,
    genres: d.genres.map((g) => g.name), year: Number(d.release_date.slice(0, 4)) });

function deps(rows: TitleRow[], over: Partial<FaceDeps> = {}) {
  const rpc = vi.fn(async (_n: string, _a: Record<string, unknown>) => ({ data: 1, error: null }));
  const onChanges = vi.fn();
  const d: FaceDeps = { board: 'b1', rows, pendingIds: new Set(), fetchFn: routes(FILMS), proxy: '', tmdbKey: 'K', rawgKey: 'R', loadImage: async () => false,
    client: { rpc }, storage: memory(), now, pause: async () => {}, onChanges, ...over };
  return { d, rpc, onChanges, updates: () => rpc.mock.calls.map((c) => (c[1] as { p_updates: Record<string, unknown>[] }).p_updates[0]!) };
}

describe('runFaceJob', () => {
  it('a film not out yet gets its dates and the badge, quietly, with the fields in the base', async () => {
    const { d, updates, onChanges } = deps([film('dune', '1170608', same(DUNE))]);
    const r = await runFaceJob(d);
    expect(r.updated).toBe(1);
    expect(updates()[0]).toEqual({ id: 'dune', base: { parts: null, checked_parts: {}, status: 'queue', release_date: null }, status: 'unreleased', release_date: '2026-12-15' });
    expect(onChanges).toHaveBeenCalledWith([{ id: 'dune', cols: { status: 'unreleased', release_date: '2026-12-15' } }]);
  });

  it('the poster that changed at the source is taken; nothing else changes', async () => {
    const { d, updates } = deps([film('f', '1153576', { ...same(FIGHTER), cover: 'https://image.tmdb.org/t/p/w500/old.jpg', release_date: '2026-10-13', digital_date: '2026-12-01' })]);
    await runFaceJob(d);
    expect(updates()[0]).toMatchObject({ cover: `https://image.tmdb.org/t/p/w500${FIGHTER.poster_path}` });
    expect(Object.keys(updates()[0]!).sort()).toEqual(['base', 'cover', 'id']);
  });

  it('a card is asked again after a week; one not out yet and one in cinemas every day', async () => {
    const calls: string[] = [];
    const rows = [film('dune', '1170608', { ...same(DUNE), status: 'unreleased', release_date: '2026-12-15' }),
      film('f', '1153576', { ...same(FIGHTER), release_date: '2026-10-13', digital_date: '2026-12-01' }),
      film('old', '1', { release_date: '2020-01-01' })];
    const { d } = deps(rows, { fetchFn: routes([...FILMS, [/\/3\/movie\/1\?/, { id: 1, title: 'old', release_date: '2020-01-01' }]], calls) });
    await runFaceJob(d);
    expect(calls.length).toBe(3);
    calls.length = 0;
    await runFaceJob({ ...d, now: new Date('2026-10-21T20:00:00') });
    expect(calls).toEqual([]);
    await runFaceJob({ ...d, now: new Date('2026-10-22T09:00:00') });
    expect(calls.map((u) => /movie\/(\d+)/.exec(u)![1])).toEqual(['1170608', '1153576']);
    calls.length = 0;
    await runFaceJob({ ...d, now: new Date('2026-10-28T13:00:00') });
    expect(calls.length).toBe(3);
  });

  it('the daily ones go first, then onDailyDone, then the rest', async () => {
    const order: string[] = [];
    const calls: string[] = [];
    const f: FetchLike = (u, i) => { order.push(/movie\/(\d+)/.exec(u)?.[1] ?? u); return routes(FILMS, calls)(u, i); };
    const { d } = deps([film('f', '1153576', same(FIGHTER)), film('dune', '1170608', { status: 'unreleased' })], { fetchFn: f, onDailyDone: () => order.push('done') });
    await runFaceJob(d);
    expect(order).toEqual(['1170608', 'done', '1153576']);
  });

  it('hand-made cards and cards with a pending edit are never asked; a stale write is retried next run', async () => {
    const calls: string[] = [];
    const rpc = vi.fn(async () => ({ data: -1, error: null }));
    const manual: TitleRow = { ...film('mine', '0'), source: null, source_id: null };
    const { d, onChanges } = deps([manual, film('p', '1153576'), film('dune', '1170608')], { fetchFn: routes(FILMS, calls), client: { rpc }, pendingIds: new Set(['p']) });
    await runFaceJob(d);
    expect(calls.map((u) => /movie\/(\d+)/.exec(u)![1])).toEqual(['1170608']);
    expect(onChanges).not.toHaveBeenCalled();
    calls.length = 0;
    await runFaceJob({ ...d, now: new Date('2026-10-21T13:00:00') });
    expect(calls.length).toBe(1);
  });

  it('a source that does not answer is left alone after a few failures and asked next run', async () => {
    const calls: string[] = [];
    const down: FetchLike = (u) => { calls.push(u); return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }); };
    const rows = Array.from({ length: 8 }, (_, i) => film(`f${i}`, String(100 + i)));
    const { d, rpc } = deps(rows, { fetchFn: down });
    const r = await runFaceJob(d);
    expect(rpc).not.toHaveBeenCalled();
    expect(r.skipped).toBe(8);
    expect(calls.length).toBe(8);
  });

  it('a Steam game coming out: the badge comes off with the day Steam gives', async () => {
    const data = live('steam-app-1030300.json');
    const game: TitleRow = { ...film('silk', '1030300'), category: 'game', source: 'steam', title: 'Hollow Knight: Silksong', status: 'unreleased',
      cover: 'https://cdn2.steamgriddb.com/grid/x.png', synopsis: data['1030300'].data.short_description };
    const { d, updates } = deps([game], { fetchFn: routes([[/appdetails\?appids=1030300&/, data]]) });
    await runFaceJob(d);
    expect(updates()[0]).toMatchObject({ status: 'queue', release_date: '2025-09-04' });
  });
});

describe('runFaceJob after BL-118', () => {
  it('a hand-made list of seasons on a search show is built again from the source, the ticks carried over', async () => {
    const { liveFetch } = await import('../fixtures/liveFetch');
    const hand: TitleRow = { workspace_id: 'b1', id: 'twd', title: 'Ходячие мертвецы', category: 'series', status: 'in_progress', source: 'tmdb-series', source_id: '1402',
      parts: [{ name: '1', released: true }, { name: '2', released: true }], checked_parts: { 0: '2026-01-01T00:00:00Z' }, parts_manual: true,
      season_info: 'Сезоны 1-11', created_at: '2026-01-01T00:00:00Z' };
    const { d, rpc, onChanges } = deps([hand], { fetchFn: liveFetch });
    await runFaceJob(d);
    const first = (rpc.mock.calls[0]![1] as { p_updates: Record<string, unknown>[] }).p_updates[0]!;
    expect(first.parts_manual).toBe(false);
    expect((first.parts as unknown[]).length).toBeGreaterThan(2);
    expect(first.checked_parts).toEqual({ 0: '2026-01-01T00:00:00Z' });
    const later = rpc.mock.calls.slice(1).map((c) => (c[1] as { p_updates: Record<string, unknown>[] }).p_updates[0]!);
    expect(later.some((u) => u.season_info === null)).toBe(true);
    expect(onChanges).toHaveBeenCalled();
  });
});

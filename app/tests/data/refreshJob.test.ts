// The daily refresh on the live answers recorded 2026-10-14 (spec 2.5).
import { describe, expect, it, vi } from 'vitest';
import { runDailyRefresh, type RefreshDeps } from '../../src/data/refreshJob';
import type { TitleRow } from '../../src/lib/titleRow';
import type { FetchLike, StorageLike } from '../../src/lib/types';
import { liveFetch } from '../fixtures/liveFetch';

const now = new Date('2026-10-14T12:00:00Z');

function memory(): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
}

const row = (id: string, category: 'series' | 'anime', source: string, sourceId: string, status: string, extra: Partial<TitleRow> = {}): TitleRow =>
  ({ workspace_id: 'b1', id, title: id, category, status, source, source_id: sourceId, checked_parts: {}, parts: null, created_at: '2026-01-01T00:00:00Z', ...extra });

function deps(rows: TitleRow[], over: Partial<RefreshDeps> = {}) {
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ data: 1, error: null }));
  const d: RefreshDeps = {
    board: 'b1', rows, pendingIds: new Set(), fetchFn: liveFetch, client: { rpc }, storage: memory(), now,
    tmdbKey: 'KEY', proxy: null, pause: async () => {}, ...over
  };
  return { d, rpc, args: () => rpc.mock.calls[0]![1] as { p_updates: Record<string, unknown>[]; p_deletes: { id: string }[] } };
}

describe('runDailyRefresh', () => {
  it('a finished series without seasons gets them all, ticked, and stays finished', async () => {
    const { d, rpc, args } = deps([row('twd', 'series', 'tmdb-series', '1402', 'done', { completed_at: '2025-05-01T00:00:00Z' })]);
    const r = await runDailyRefresh(d);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(r.updated).toBe(1);
    const u = args().p_updates[0]!;
    expect(u.status).toBe('done');
    expect((u.parts as unknown[]).length).toBe(12);
    expect(Object.keys(u.checked_parts as object)).toHaveLength(11);
    expect(Object.values(u.checked_parts as object)[0]).toBe('2025-05-01T00:00:00Z');
    expect(u.base).toEqual({ parts: null, checked_parts: {}, status: 'done' });
  });

  it('a second run the same day does nothing', async () => {
    const { d, rpc } = deps([row('twd', 'series', 'tmdb-series', '1402', 'queue')]);
    await runDailyRefresh(d);
    await runDailyRefresh(d);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('a finished show with a new season goes back to in progress', async () => {
    const two = [{ name: 'Сезон 1', ref: 'shiki:52991', year: 2023, released: true }, { name: 'Сезон 2', ref: 'shiki:59978', year: 2026, released: true }];
    const { d, args } = deps([row('frieren', 'anime', 'shikimori', '52991', 'done', { parts: two, checked_parts: { '0': 'a', '1': 'b' } })]);
    await runDailyRefresh(d);
    const u = args().p_updates[0]!;
    expect((u.parts as { ref: string }[]).slice(0, 3).map((p) => p.ref)).toEqual(['shiki:52991', 'shiki:59978', 'shiki:63816']);
    // The third season is only announced: caught up, «Ждёт продолжения» rather than done.
    expect(u.status).toBe('in_progress');
    expect(u.checked_parts).toEqual({ '0': 'a', '1': 'b' });
  });

  it('one source failing does not stop the others', async () => {
    const failing: FetchLike = (u, i) => (u.includes('/3/tv/') ? Promise.reject(new Error('down')) : liveFetch(u, i));
    const { d, args } = deps([row('twd', 'series', 'tmdb-series', '1402', 'queue'), row('bl', 'anime', 'shikimori', '49596', 'queue')], { fetchFn: failing });
    const r = await runDailyRefresh(d);
    expect(r.skipped).toBe(1);
    expect(args().p_updates.map((u) => u.id)).toEqual(['bl']);
  });

  it('titles with edits still waiting are left for another day', async () => {
    const { d, rpc } = deps([row('twd', 'series', 'tmdb-series', '1402', 'queue')], { pendingIds: new Set(['twd']) });
    await runDailyRefresh(d);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('parts edited by hand: only the released flags move', async () => {
    const mine = [{ name: 'Мой сезон', ref: 'tmdb-season:1', released: false, year: 1999 }];
    const { d, args } = deps([row('twd', 'series', 'tmdb-series', '1402', 'unreleased', { parts: mine, parts_manual: true })]);
    await runDailyRefresh(d);
    expect(args().p_updates[0]!.parts).toEqual([{ name: 'Мой сезон', ref: 'tmdb-season:1', released: true, year: 1999 }]);
  });

  it('duplicates of a franchise merge into the first season; a spin-off and a title in progress stay', async () => {
    const { d, args } = deps([
      row('konosuba-3', 'anime', 'shikimori', '49458', 'done', { created_at: '2026-01-01T00:00:00Z', rating: 9, completed_at: '2026-02-01T00:00:00Z' }),
      row('konosuba', 'anime', 'shikimori', '30831', 'queue', { created_at: '2026-03-01T00:00:00Z', rating: 7 }),
      row('konosuba-2', 'anime', 'shikimori', '32937', 'in_progress'),
      row('megumin', 'anime', 'shikimori', '51958', 'queue')
    ]);
    const r = await runDailyRefresh(d);
    expect(r.merged).toBe(1);
    expect(args().p_deletes.map((x) => x.id)).toEqual(['konosuba-3']);
    const u = args().p_updates.find((x) => x.id === 'konosuba')!;
    const parts = u.parts as { ref: string }[];
    expect(u.checked_parts).toEqual({ [String(parts.findIndex((p) => p.ref === 'shiki:49458'))]: '2026-02-01T00:00:00Z' });
    expect(u.rating).toBe(9);
    expect(u.status).toBe('in_progress');
    expect(args().p_updates.map((x) => x.id)).not.toContain('konosuba-2');
  });

  it('a first list only where the status survives it', async () => {
    const { d, rpc } = deps([row('aot-3', 'anime', 'shikimori', '35760', 'done'), row('aot-3b', 'anime', 'shikimori', '35760', 'in_progress')]);
    await runDailyRefresh(d);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('«Смотрю» without seasons gets them, nothing ticked, still «Смотрю»', async () => {
    const { d, args } = deps([row('twd', 'series', 'tmdb-series', '1402', 'in_progress')]);
    await runDailyRefresh(d);
    const u = args().p_updates[0]!;
    expect((u.parts as unknown[]).length).toBe(12);
    expect(u.checked_parts).toEqual({});
    expect(u.status).toBe('in_progress');
  });

  it('a film on its own gets no list, and one given earlier is taken back', async () => {
    const film = 999001;
    const lone: FetchLike = (u, i) => (u.includes(`/animes/${film}/franchise`)
      ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ nodes: [{ id: film, name: 'Фильм', kind: 'Фильм', year: 2016, date: 1470000000 }], links: [] }) })
      : liveFetch(u, i));
    const given = [{ name: 'Фильм', ref: `shiki:${film}`, year: 2016, released: true }];
    const { d, args } = deps([
      row('new', 'anime', 'shikimori', String(film), 'queue'),
      row('old', 'anime', 'shikimori', String(film), 'done', { parts: given, checked_parts: { '0': '1970-01-01T00:00:00.000Z' }, manual_status: 'done' })
    ], { fetchFn: lone });
    await runDailyRefresh(d);
    expect(args().p_updates).toHaveLength(1);
    expect(args().p_updates[0]).toMatchObject({ id: 'old', parts: [], checked_parts: {}, status: 'done' });
  });

  it('OVAs in a hand-made anime list move to the extras block', async () => {
    const legacy = [{ name: 'Сезон 1', released: true }, { name: 'OVA «Memory Snow»', released: true }, { name: 'Сезон 2', released: true }];
    const { d, args } = deps([row('frieren', 'anime', 'shikimori', '52991', 'in_progress', { parts: legacy, checked_parts: { '0': 'a' } })]);
    await runDailyRefresh(d);
    const u = args().p_updates[0]!;
    expect((u.parts as { extra?: boolean }[]).map((p) => !!p.extra)).toEqual([false, true, false]);
    expect(u.checked_parts).toEqual({ '0': 'a' });
  });

  it('a finished title on no known day gets its ticks dated before every period', async () => {
    const { d, args } = deps([row('twd', 'series', 'tmdb-series', '1402', 'done')]);
    await runDailyRefresh(d);
    expect(new Set(Object.values(args().p_updates[0]!.checked_parts as object))).toEqual(new Set(['1970-01-01T00:00:00.000Z']));
  });

  it('a hand-made Shikimori list is not lined up (its TV entries are not seasons)', async () => {
    const legacy = [1, 2, 3, 4].map((n) => ({ name: `Сезон ${n}`, released: true }));
    const { d, rpc } = deps([row('aot', 'anime', 'shikimori', '16498', 'done', { parts: legacy, checked_parts: { '0': 'a', '1': 'a', '2': 'a', '3': 'a' }, manual_status: 'done', airing_status: 'completed' })]);
    await runDailyRefresh(d);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a lone recap film is not turned into the franchise', async () => {
    const { d, rpc } = deps([row('chronicle', 'anime', 'shikimori', '42091', 'done')]);
    await runDailyRefresh(d);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a stale answer (-1) writes nothing locally and tries again next open', async () => {
    const { d, rpc } = deps([row('twd', 'series', 'tmdb-series', '1402', 'queue')]);
    rpc.mockResolvedValueOnce({ data: -1, error: null });
    const r = await runDailyRefresh(d);
    expect(r.changes).toEqual([]);
    // Not again on every pull, but after a while.
    await runDailyRefresh(d);
    expect(rpc).toHaveBeenCalledTimes(1);
    await runDailyRefresh({ ...d, now: new Date(now.getTime() + 31 * 60 * 1000) });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('nothing to change: no call at all', async () => {
    const { d, rpc } = deps([row('movie', 'series', 'tmdb-series', '999999', 'queue')]);
    await runDailyRefresh(d);
    expect(rpc).not.toHaveBeenCalled();
  });
});

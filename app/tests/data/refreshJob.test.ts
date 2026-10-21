// The daily refresh on the live answers recorded 2026-10-14 (spec 2.5).
import { describe, expect, it, vi } from 'vitest';
import { rebuildSeasons, runDailyRefresh, type RefreshDeps } from '../../src/data/refreshJob';
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

  it('duplicates of a franchise merge into the first season, a spin-off not started too; a title in progress stays', async () => {
    const { d, args } = deps([
      row('konosuba-3', 'anime', 'shikimori', '49458', 'done', { created_at: '2026-01-01T00:00:00Z', rating: 9, completed_at: '2026-02-01T00:00:00Z' }),
      row('konosuba', 'anime', 'shikimori', '30831', 'queue', { created_at: '2026-03-01T00:00:00Z', rating: 7 }),
      row('konosuba-2', 'anime', 'shikimori', '32937', 'in_progress'),
      row('megumin', 'anime', 'shikimori', '51958', 'queue')
    ]);
    const r = await runDailyRefresh(d);
    expect(r.merged).toBe(2);
    expect(args().p_deletes.map((x) => x.id)).toEqual(['konosuba-3', 'megumin']);
    const u = args().p_updates.find((x) => x.id === 'konosuba')!;
    const parts = u.parts as { ref: string }[];
    expect(u.checked_parts).toEqual({ [String(parts.findIndex((p) => p.ref === 'shiki:49458'))]: '2026-02-01T00:00:00Z' });
    expect(u.rating).toBe(9);
    expect(u.status).toBe('in_progress');
    expect(args().p_updates.map((x) => x.id)).not.toContain('konosuba-2');
  });

  it('a finished OVA folds into the finished show and ticks its extra («Атака титанов OVA» on est\'s board)', async () => {
    const { d, args } = deps([
      row('aot', 'anime', 'shikimori', '16498', 'done', { created_at: '2026-01-01T00:00:00Z' }),
      row('aot-ova', 'anime', 'shikimori', '18397', 'done', { created_at: '2026-02-01T00:00:00Z', completed_at: '2026-03-01T00:00:00Z' })
    ]);
    const r = await runDailyRefresh(d);
    expect(args().p_deletes.map((x) => x.id)).toEqual(['aot-ova']);
    expect(r.merged).toBe(1);
    const u = args().p_updates.find((x) => x.id === 'aot')!;
    const parts = u.parts as { ref: string; extra?: boolean }[];
    const ova = parts.findIndex((p) => p.ref === 'shiki:18397');
    expect(parts[ova]!.extra).toBe(true);
    expect((u.checked_parts as Record<string, string>)[String(ova)]).toBe('2026-03-01T00:00:00Z');
    expect(u.status).toBe('done');
  });

  it('a list not finished is put in the provider\'s order; its ticks move with their parts', async () => {
    // Konosuba's film once sat in the extras (the shape the Slime films had before 2026-10-16).
    const parts = [
      { name: 'S1', ref: 'shiki:30831', year: 2016, released: true }, { name: 'S2', ref: 'shiki:32937', year: 2017, released: true },
      { name: 'S3', ref: 'shiki:49458', year: 2024, released: true }, { name: 'Film', ref: 'shiki:38040', year: 2019, released: true, extra: true }
    ];
    const { d, args } = deps([row('konosuba', 'anime', 'shikimori', '30831', 'in_progress', { parts, checked_parts: { '0': 'a', '2': 'c' } })]);
    await runDailyRefresh(d);
    const u = args().p_updates.find((x) => x.id === 'konosuba')!;
    const after = u.parts as { ref: string; extra?: boolean }[];
    expect(after.filter((p) => !p.extra).slice(0, 4).map((p) => p.ref)).toEqual(['shiki:30831', 'shiki:32937', 'shiki:38040', 'shiki:49458']);
    expect(u.checked_parts).toEqual({ '0': 'a', [String(after.findIndex((p) => p.ref === 'shiki:49458'))]: 'c' });
    expect(u.status).toBe('in_progress');
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

  it('a hand-made list nobody started gives way to the provider\'s; one with ticks or in progress stays', async () => {
    const legacy = [{ name: 'Сезон 1', year: 2023, released: true }, { name: 'Сезон 2', year: 2026, released: false }, { name: 'Сезон 3', year: 2027, released: false }];
    const { d, args } = deps([
      row('queued', 'anime', 'shikimori', '52991', 'queue', { parts: legacy }),
      row('watching', 'anime', 'shikimori', '16498', 'in_progress', { parts: legacy, checked_parts: { '0': 'a' } }),
      row('shows', 'series', 'tmdb-series', '71024', 'queue', { parts: [{ name: 'Книга 1', released: true }, { name: 'Книга 2', released: false }] })
    ]);
    await runDailyRefresh(d);
    const ups = args().p_updates;
    expect(ups.find((u) => u.id === 'watching')?.parts ?? legacy).toEqual(legacy);
    for (const u of ups.filter((x) => x.id !== 'watching')) {
      expect((u.parts as { ref?: string }[]).every((p) => p.ref)).toBe(true);
      expect(u.checked_parts).toEqual({});
      expect(u.status).toBe('queue');
    }
    expect(ups.map((u) => u.id)).toEqual(expect.arrayContaining(['queued', 'shows']));
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

describe('rebuildSeasons («Обновить сезоны»)', () => {
  const legacy = [{ name: 'Сезон 1', released: true }, { name: 'OVA', extra: true, released: true }, { name: 'Сезон 2', released: true }, { name: 'Сезон 3', released: false }];
  const call = (r: TitleRow) => {
    const rpc = vi.fn(async (_n: string, _a: Record<string, unknown>) => ({ data: 1, error: null }));
    return { rpc, run: () => rebuildSeasons({ board: 'b1', row: r, fetchFn: liveFetch, client: { rpc }, now, tmdbKey: 'KEY', proxy: null }) };
  };

  it('builds the list from the source and carries the main ticks over by count, quietly', async () => {
    const { rpc, run } = call(row('frieren', 'anime', 'shikimori', '52991', 'in_progress', { parts: legacy, checked_parts: { '0': '2026-01-01', '1': '2026-01-02', '2': '2026-01-03' } }));
    const res = await run();
    expect(res).not.toBe('none');
    const cols = (res as { cols: TitleRow }).cols;
    expect((cols.parts as { ref?: string }[]).every((p) => p.ref)).toBe(true);
    // Two main parts were ticked (the OVA does not count): the first two released main parts are.
    expect(Object.values(cols.checked_parts as object)).toEqual(['2026-01-01', '2026-01-03']);
    expect(rpc.mock.calls[0]![0]).toBe('apply_title_refresh');
  });

  it('a finished title stays finished', async () => {
    const { run } = call(row('twd', 'series', 'tmdb-series', '1402', 'done', { parts: [{ name: 'Книга 1', released: true }], checked_parts: { '0': 'a' }, completed_at: '2025-05-01T00:00:00Z' }));
    const res = await run() as { cols: TitleRow };
    expect(res.cols.status).toBe('done');
  });

  it('a list that knows more parts than the source is kept («Бумажный дом», «Фоллаут» 3)', async () => {
    const more = Array.from({ length: 13 }, (_, i) => ({ name: `Сезон ${i + 1}`, released: i < 11 }));
    const { rpc, run } = call(row('twd', 'series', 'tmdb-series', '1402', 'in_progress', { parts: more, checked_parts: { '0': 'a' } }));
    expect(await run()).toBe('none');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a stale write says so', async () => {
    const r = row('frieren', 'anime', 'shikimori', '52991', 'queue', { parts: legacy });
    const rpc = vi.fn(async () => ({ data: -1, error: null }));
    expect(await rebuildSeasons({ board: 'b1', row: r, fetchFn: liveFetch, client: { rpc }, now, tmdbKey: 'KEY', proxy: null })).toBe('stale');
  });
});

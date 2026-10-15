// The one-time pass that brings old-site titles to what search gives (wave 3, task 5a).
import { describe, expect, it, vi } from 'vitest';
import { normalizedAlready, runNormalize, type NormalizeDeps } from '../../src/data/normalizeJob';
import type { TitleRow } from '../../src/lib/titleRow';
import type { FetchLike, StorageLike } from '../../src/lib/types';

function memory(): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
}
const movie = (id: string, tmdb: string, extra: Partial<TitleRow> = {}): TitleRow => ({
  workspace_id: 'b1', id, title: id, category: 'movie', status: 'done', source: 'tmdb-movie', source_id: tmdb,
  cover: `images/covers/${id}.jpg`, synopsis: 'Старое описание.', genres: ['драма'], year: 2000, parts: null, checked_parts: {}, ...extra
});
const tmdb: FetchLike = (u) => {
  const m = /\/3\/movie\/(\d+)\?/.exec(u);
  if (!m || m[1] === '404') return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: Number(m[1]), title: `Фильм ${m[1]}`, original_title: `Film ${m[1]}`, release_date: '2021-01-01',
    genres: [{ name: 'фантастика' }], overview: `Описание ${m[1]} из поиска.`, poster_path: `/p${m[1]}.jpg` }) });
};

function deps(rows: TitleRow[], over: Partial<NormalizeDeps> = {}) {
  const rpc = vi.fn(async (_n: string, a: { p_updates: unknown[] }) => ({ data: a.p_updates.length, error: null }));
  const onChanges = vi.fn();
  const d: NormalizeDeps = { board: 'b1', rows, pendingIds: new Set(), client: { rpc }, storage: memory(), fetchFn: tmdb, proxy: '',
    tmdbKey: 'k', rawgKey: 'r', loadImage: async () => false, pause: async () => {}, onChanges, ...over };
  return { d, rpc, onChanges };
}

describe('runNormalize', () => {
  it('an old-site title gets name, original name, poster, description, genres and year from search', async () => {
    const { d, rpc, onChanges } = deps([movie('dune', '438631')]);
    const r = await runNormalize(d);
    expect(r).toMatchObject({ ran: true, done: true, updated: 1 });
    const u = (rpc.mock.calls[0]![1] as { p_updates: Record<string, unknown>[] }).p_updates[0]!;
    expect(u).toMatchObject({ id: 'dune', title: 'Фильм 438631', original_title: 'Film 438631', cover: 'https://image.tmdb.org/t/p/w500/p438631.jpg',
      synopsis: 'Описание 438631 из поиска.', genres: ['фантастика'], year: 2021 });
    expect(u.base).toMatchObject({ status: 'done', title: 'dune', cover: 'images/covers/dune.jpg' });
    expect(onChanges).toHaveBeenCalledTimes(1);
    expect(normalizedAlready(d.storage, 'b1')).toBe(true);
  });

  it('a cover someone chose stays', async () => {
    const { d, rpc } = deps([movie('dune', '438631', { cover: 'data:image/jpeg;base64,AAA' })]);
    await runNormalize(d);
    expect((rpc.mock.calls[0]![1] as { p_updates: Record<string, unknown>[] }).p_updates[0]!.cover).toBeUndefined();
  });

  it('runs once: a second run asks nothing', async () => {
    const calls: string[] = [];
    const f: FetchLike = (u, i) => { calls.push(u); return tmdb(u, i); };
    const { d } = deps([movie('dune', '438631')], { fetchFn: f });
    await runNormalize(d);
    calls.length = 0;
    expect((await runNormalize(d)).ran).toBe(false);
    expect(calls).toEqual([]);
  });

  it('writes in batches; a stale batch stops the run and the next open goes on from it', async () => {
    const rows = Array.from({ length: 23 }, (_, i) => movie(`m${i}`, String(1000 + i)));
    let n = 0;
    const rpc = vi.fn(async (_x: string, a: { p_updates: unknown[] }) => (++n === 2 ? { data: -1, error: null } : { data: a.p_updates.length, error: null }));
    const { d } = deps(rows, { client: { rpc } });
    const first = await runNormalize(d);
    expect(first).toMatchObject({ done: false, updated: 10 });
    const second = await runNormalize(d);
    expect(second).toMatchObject({ done: true, updated: 13 });
    expect(rpc).toHaveBeenCalledTimes(4);
  });

  it('a dead id is asked again later and does not hold the others; titles without a source are left alone', async () => {
    const { d, rpc } = deps([movie('gone', '404'), movie('dune', '438631'), { ...movie('haven', '1'), source: null, source_id: null, category: 'game' }]);
    const r = await runNormalize(d);
    expect(r).toMatchObject({ done: false, updated: 1, skipped: 1 });
    expect((rpc.mock.calls[0]![1] as { p_updates: { id: string }[] }).p_updates.map((u) => u.id)).toEqual(['dune']);
  });

  it('titles with edits still waiting are skipped this time', async () => {
    const { d, rpc } = deps([movie('dune', '438631')], { pendingIds: new Set(['dune']) });
    const r = await runNormalize(d);
    expect(rpc).not.toHaveBeenCalled();
    expect(r.done).toBe(false);
  });

  it('a title whose source fails it while answering for others is given up on the third such open', async () => {
    const { d } = deps([movie('dune', '438631'), movie('gone', '404')]);
    (d.storage as ReturnType<typeof memory>).data['normalize:2:b1'] = JSON.stringify({ done: [], fails: { gone: 2 } });
    expect((await runNormalize(d)).done).toBe(true);
    expect((await runNormalize(d)).ran).toBe(false);
  });

  it('a lone dead id is not given up while its source answers nothing: it costs one ask per open', async () => {
    const calls: string[] = [];
    const { d } = deps([movie('gone', '404')], { fetchFn: (u, i) => { calls.push(u); return tmdb(u, i); } });
    for (let k = 0; k < 4; k++) expect((await runNormalize(d)).done).toBe(false);
    expect(calls.length).toBe(4 * 2);
  });

  it('a source that does not answer once is asked again after a pause', async () => {
    let first = true;
    const flaky: FetchLike = (u, i) => {
      if (first) { first = false; return Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({}) }); }
      return tmdb(u, i);
    };
    const pauses: number[] = [];
    const { d, rpc } = deps([movie('dune', '438631')], { fetchFn: flaky, pause: async (ms) => { pauses.push(ms); } });
    expect(await runNormalize(d)).toMatchObject({ done: true, updated: 1 });
    expect(pauses).toContain(2000);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('a source that is down is left for the next open, and none of its titles is given up', async () => {
    const down: FetchLike = () => Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({}) });
    const calls: string[] = [];
    const rows = Array.from({ length: 8 }, (_, i) => movie(`m${i}`, String(1000 + i)));
    const { d } = deps(rows, { fetchFn: (u, i) => { calls.push(u); return down(u, i); } });
    for (let k = 0; k < 4; k++) expect((await runNormalize(d)).done).toBe(false);
    // Four titles, each asked twice, then the source is left alone.
    expect(calls.length).toBe(4 * 4 * 2);
    d.fetchFn = tmdb;
    expect(await runNormalize(d)).toMatchObject({ done: true, updated: 8 });
  });
});

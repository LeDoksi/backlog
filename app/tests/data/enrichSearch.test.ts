// Search on the live Shikimori answers recorded 2026-10-14 (spec 2.3).
import { beforeEach, describe, expect, it } from 'vitest';
import { alreadyOnBoard, details, resetFranchiseCache, search, type Hit } from '../../src/data/enrichSearch';
import { buildTitle } from '../../src/data/newTitle';
import { liveFetch } from '../fixtures/liveFetch';
import type { FetchLike } from '../../src/lib/types';

beforeEach(() => resetFranchiseCache());

async function hits(q: string, fetchFn: FetchLike = liveFetch): Promise<Hit[]> {
  const r = await search('anime', q, fetchFn);
  if (!r.ok) throw new Error('search failed');
  return r.hits;
}

describe('anime search: one row per franchise', () => {
  it('«атака титанов» is one row: the first season, with what it holds', async () => {
    const h = await hits('атака титанов');
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ id: 16498, title: 'Атака титанов', year: 2013, label: '6 сезонов, 1 спецвыпуск' });
    expect(h[0]!.poster).toMatch(/^https:\/\//);
  });

  it('«синяя тюрьма»: the franchise first, unrelated titles after it', async () => {
    const h = await hits('синяя тюрьма');
    expect(h[0]).toMatchObject({ id: 49596, label: '3 сезона' });
    expect(h.slice(1).every((x) => !x.label)).toBe(true);
    expect(h.map((x) => x.id)).not.toContain(54865);
  });

  it('asks Shikimori for each franchise once, a second search not at all', async () => {
    const calls: string[] = [];
    const counting: FetchLike = (u, i) => { calls.push(u); return liveFetch(u, i); };
    await hits('этот замечательный мир', counting);
    const first = calls.filter((u) => u.includes('/franchise'));
    expect(first.length).toBeLessThanOrEqual(3);
    calls.length = 0;
    await hits('этот замечательный мир', counting);
    // Only the unrelated title whose franchise failed is asked again.
    expect(calls.filter((u) => u.includes('/franchise'))).toEqual(first.filter((u) => !u.includes('/32380/')));
  });

  it('a franchise that fails to load leaves plain rows', async () => {
    const noFranchise: FetchLike = (u, i) => (u.includes('/franchise') ? Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }) : liveFetch(u, i));
    const h = await hits('атака титанов', noFranchise);
    expect(h.length).toBe(5);
    expect(h.every((x) => !x.label)).toBe(true);
  });
});

describe('already on the board', () => {
  it('any entry of the franchise on the board marks the row', async () => {
    const [aot] = await hits('атака титанов');
    expect(alreadyOnBoard(aot!, [{ source: 'shikimori', sourceId: '18397' }])).toBe(true);
    expect(alreadyOnBoard(aot!, [{ source: 'shikimori', sourceId: '1' }])).toBe(false);
    expect(alreadyOnBoard(aot!, [{ source: null, sourceId: null, parts: [{ name: 'x', ref: 'shiki:25777' }] }])).toBe(true);
  });
  it('a series by its TMDb id', () => {
    const hit = { provider: 'tmdb-series', id: 1402, title: 'x', year: 2010, poster: '' } as Hit;
    expect(alreadyOnBoard(hit, [{ source: 'tmdb-series', sourceId: '1402' }])).toBe(true);
  });
});

describe('a picked row comes with its parts (BL-90)', () => {
  it('an anime franchise', async () => {
    const [aot] = await hits('атака титанов');
    const d = await details(aot!, liveFetch);
    const t = buildTitle('anime', 'атака', d!, []);
    if (t === 'duplicate') throw new Error('dup');
    expect(t.parts!.filter((p) => !p.extra)).toHaveLength(7);
    expect(t.parts![0]).toEqual({ name: 'Атака титанов', year: 2013, released: true, ref: 'shiki:16498' });
    expect(t.sourceId).toBe('16498');
  });
  it('a TMDb series', async () => {
    const d = await details({ provider: 'tmdb-series', id: 1402, title: '', year: null, poster: '' }, liveFetch);
    expect(d!.parts!.filter((p) => !p.extra)).toHaveLength(11);
    expect(d).not.toHaveProperty('tmdbSeasons');
  });
  it('a film gets no parts', () => {
    const t = buildTitle('movie', 'x', { title: 'x', parts: [{ name: '1' }] }, []);
    expect(t !== 'duplicate' && t.parts).toBeFalsy();
  });
});

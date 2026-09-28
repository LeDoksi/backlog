import { describe, expect, it } from 'vitest';
import catalog from '../fixtures/catalog.json';
import { computeStats, showcase } from '../../src/data/stats';
import type { Title } from '../../src/lib/types';

const titles = catalog as Title[];

describe('computeStats', () => {
  it('categories add up to the total done', () => {
    const s = computeStats(titles, () => []);
    const sum = s.byCategory.movie.done + s.byCategory.series.done + s.byCategory.anime.done + s.byCategory.game.done;
    expect(sum).toBe(s.done);
    expect(s.done).toBe(titles.filter((t) => t.status === 'done').length);
  });
  it('genres are sorted by count, most first', () => {
    const g = computeStats(titles, () => []).genres;
    for (let i = 1; i < g.length; i++) expect(g[i - 1]!.count).toBeGreaterThanOrEqual(g[i]!.count);
  });
  it('counts watched seasons and titles waiting for more', () => {
    const show: Title = { id: 's', title: 'S', category: 'anime', status: 'in_progress', genres: [], parts: [{ name: '1' }, { name: '2' }, { name: '3', released: false }] };
    const s = computeStats([show], () => [0, 1]);
    expect(s.byCategory.anime.seasons).toBe(2);
    expect(s.waiting).toBe(1);
  });
});

// A tiny seeded generator, so "random" is repeatable in tests.
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

describe('showcase', () => {
  const done = titles.filter((t) => t.status === 'done');

  it('picks only finished titles with a real cover, without repeats', () => {
    const picks = showcase([...titles, { ...done[0]!, id: 'nocover', cover: 'images/covers/_placeholder.svg' }], 10, seeded(1));
    expect(picks).toHaveLength(10);
    expect(picks.every((t) => t.status === 'done' && !t.cover?.includes('_placeholder'))).toBe(true);
    expect(new Set(picks.map((t) => t.id)).size).toBe(10);
  });
  it('a different draw gives a different set', () => {
    const a = showcase(titles, 5, seeded(1)).map((t) => t.id);
    const b = showcase(titles, 5, seeded(7)).map((t) => t.id);
    expect(a).not.toEqual(b);
  });
  it('returns every finished title when there are fewer than asked', () => {
    expect(showcase(done.slice(0, 2), 10, seeded(3))).toHaveLength(2);
  });
});

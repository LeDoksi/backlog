import { describe, expect, it } from 'vitest';
import catalog from '../fixtures/catalog.json';
import { computeStats } from '../../src/data/stats';
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

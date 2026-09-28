import { describe, expect, it } from 'vitest';
import catalog from '../fixtures/catalog.json';
import { visibleTitles, categoryCounts, genreCounts, DEFAULT_FILTERS, type FilterState } from '../../src/data/filters';
import { matchesFilters, matchesSearch, sortTitles } from '../../src/lib/query';
import type { Status, Title } from '../../src/lib/types';

const titles = (catalog as Title[]).map((t, i) => ({ ...t, status: (['queue', 'in_progress', 'done', 'unreleased'] as Status[])[i % 4]! }));

// v1's getVisibleTitles, verbatim in behaviour: one status or all.
function v1(f: FilterState): Title[] {
  const inCat = f.category === 'all' ? titles : titles.filter((t) => t.category === f.category);
  const list = inCat.filter((t) => {
    if (f.hideDone && t.status === 'done') return false;
    return matchesFilters(t, { status: f.statuses[0] ?? 'all', genre: f.genres, returning: f.stillAiring }) && matchesSearch(t, f.search);
  });
  return sortTitles(list, f.sort);
}

function rng(seed: number) { return () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; }; }

describe('visibleTitles', () => {
  it('matches v1 on 50 random filter combinations', () => {
    const r = rng(42);
    const allGenres = [...new Set(titles.flatMap((t) => t.genres))];
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
    for (let i = 0; i < 50; i++) {
      const f: FilterState = {
        category: pick(['all', 'anime', 'movie', 'series', 'game'] as const),
        statuses: r() < 0.5 ? [] : [pick(['queue', 'in_progress', 'done', 'unreleased'] as Status[])],
        genres: r() < 0.5 ? [] : [pick(allGenres), pick(allGenres)],
        stillAiring: r() < 0.3,
        hideDone: r() < 0.3,
        search: r() < 0.3 ? pick(['а', 'ин', 'the', 'Фри']) : '',
        sort: pick(['status', 'added', 'name', 'year'] as const)
      };
      expect(visibleTitles(titles, f).map((t) => t.id)).toEqual(v1(f).map((t) => t.id));
    }
  });

  it('several statuses show their union', () => {
    const got = visibleTitles(titles, { ...DEFAULT_FILTERS, statuses: ['queue', 'done'] });
    expect(got.length).toBe(titles.filter((t) => t.status === 'queue' || t.status === 'done').length);
  });
});

describe('categoryCounts', () => {
  it('sums every category into all', () => {
    const c = categoryCounts(titles);
    expect(c.all.total).toBe(titles.length);
    expect(c.anime.total + c.movie.total + c.series.total + c.game.total).toBe(titles.length);
    expect(c.anime.done + c.movie.done + c.series.done + c.game.done).toBe(c.all.done);
  });
});

describe('genreCounts', () => {
  it('sorts by use, most first', () => {
    const g = genreCounts(titles, 'all');
    for (let i = 1; i < g.length; i++) expect(g[i - 1]!.count).toBeGreaterThanOrEqual(g[i]!.count);
  });
});

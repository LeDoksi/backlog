import { describe, expect, it } from 'vitest';
import catalog from '../fixtures/catalog.json';
import { comparison, computeStats, defaultPeriod, periodStats, showcase } from '../../src/data/stats';
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

describe('periodStats', () => {
  const now = new Date(2026, 8, 20); // 20 Sep 2026, local time
  const at = (m: number, d = 10, y = 2026) => new Date(y, m, d).toISOString();
  // A done title with no date is one migrated from before completed_at existed.
  const movie = (id: string, completedAt: string | null, genres: string[] = []): Title =>
    ({ id, title: id, category: 'movie', status: 'done', genres, completedAt });
  const show: Title = { id: 'show', title: 'S', category: 'series', status: 'in_progress', genres: [], parts: [{ name: '1' }, { name: '2' }, { name: '3' }] };
  const ticks: Record<string, Record<string, string>> = { show: { '0': at(7), '1': at(8, 3) } };
  const list = [movie('a', at(8, 1), ['драма']), movie('b', at(8, 15)), movie('c', at(7)), movie('d', at(2)), movie('old', null), show];
  const run = (p: 'month' | 'year' | 'all') => periodStats(list, (id) => ticks[id] ?? {}, p, now);

  it('a month counts titles finished and seasons ticked in it, and compares with the month before', () => {
    const m = run('month');
    expect(m.label).toBe('Сентябрь');
    expect(m.done).toBe(2);
    expect(m.byCategory.movie.done).toBe(2);
    expect(m.byCategory.series.seasons).toBe(1);
    expect(m.previous).toBe(1);
    expect(m.genres).toEqual([{ genre: 'драма', count: 1 }]);
    expect(comparison(m, 'month')).toBe('На 1 больше, чем в прошлом месяце');
  });

  it('a year counts the whole calendar year; titles without a date only count for all time', () => {
    const y = run('year');
    expect(y.label).toBe('2026');
    expect(y.done).toBe(4);
    expect(y.byCategory.series.seasons).toBe(2);
    expect(y.previous).toBe(0);
    expect(run('all').done).toBe(5);
    expect(run('all').previous).toBeNull();
  });

  it('says so when the periods are equal or fewer', () => {
    expect(comparison({ done: 2, previous: 2 }, 'month')).toBe('Столько же, сколько в прошлом месяце');
    expect(comparison({ done: 1, previous: 3 }, 'year')).toBe('На 2 меньше, чем в прошлом году');
    expect(comparison({ done: 3, previous: null }, 'all')).toBeNull();
  });

  it('opens on the month only when something happened in it', () => {
    expect(defaultPeriod(list, (id) => ticks[id] ?? {}, now)).toBe('month');
    expect(defaultPeriod([movie('old', null)], () => ({}), now)).toBe('all');
  });
});

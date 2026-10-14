import { describe, expect, it } from 'vitest';
import { fillTicksForDone, mergeParts, planMerge, seasonNumber, ticksWith, type FreshPart } from '../../src/lib/refresh';
import { isCaughtUp, partsProgress } from '../../src/lib/storage';
import type { Part, Title } from '../../src/lib/types';

const season = (n: number, released = true, year: number | null = 2020 + n): FreshPart =>
  ({ name: `Сезон ${n}`, year, released, ref: `tmdb-season:${n}`, season: n });

describe('seasonNumber', () => {
  it('reads hand-made season names', () => {
    expect(['1', 'Сезон 2', '3 сезон', 'Сезон 3 «Золотые земли»', 'Сезон 5 (финальный)', 'season 4'].map(seasonNumber)).toEqual([1, 2, 3, 3, 5, 4]);
  });
  it('anything else is not a season', () => {
    expect(['Сезон 5, часть 1', 'Книга 1: Вода', 'OVA', 'Фильм «Бесконечный поезд»', 'Часть 1', ''].map(seasonNumber)).toEqual([null, null, null, null, null, null]);
  });
});

describe('mergeParts', () => {
  it('an empty title takes the fresh list', () => {
    const r = mergeParts(undefined, [season(1), season(2, false)]);
    expect(r.changed).toBe(true);
    expect(r.parts).toEqual([
      { name: 'Сезон 1', year: 2021, released: true, ref: 'tmdb-season:1' },
      { name: 'Сезон 2', year: 2022, released: false, ref: 'tmdb-season:2' }
    ]);
  });

  it('appends a new season and never reorders the old ones', () => {
    const cur: Part[] = [{ name: 'Первый', released: true, ref: 'tmdb-season:1', year: 2021 }, { name: 'Второй', released: false, ref: 'tmdb-season:2', year: 2022 }];
    const r = mergeParts(cur, [season(1), season(2), season(3, false)]);
    expect(r.parts.map((p) => p.name)).toEqual(['Первый', 'Второй', 'Сезон 3']);
    expect(r.parts[1]!.released).toBe(true);
    expect(r.parts[2]!.released).toBe(false);
  });

  it('nothing new: unchanged, the same list back', () => {
    const fresh = [season(1), season(2)];
    const cur = mergeParts(undefined, fresh).parts;
    const r = mergeParts(cur, fresh);
    expect(r.changed).toBe(false);
    expect(r.parts).toBe(cur);
  });

  it('a provider that lost a season does not remove it', () => {
    const cur = mergeParts(undefined, [season(1), season(2)]).parts;
    expect(mergeParts(cur, [season(1)]).parts).toHaveLength(2);
  });

  it('an empty answer changes nothing', () => {
    const cur: Part[] = [{ name: '1' }];
    expect(mergeParts(cur, [])).toEqual({ parts: cur, changed: false });
  });

  it('a hand-made «season N» list gets refs and the seasons after it', () => {
    const cur: Part[] = [{ name: '1', year: null, released: true }, { name: 'Сезон 2 «Квартал»', year: null, released: false }];
    const r = mergeParts(cur, [season(1), season(2), season(3, false)]);
    expect(r.parts).toEqual([
      { name: '1', year: 2021, released: true, ref: 'tmdb-season:1' },
      { name: 'Сезон 2 «Квартал»', year: 2022, released: true, ref: 'tmdb-season:2' },
      { name: 'Сезон 3', year: 2023, released: false, ref: 'tmdb-season:3' }
    ]);
  });

  it('a hand-made list with a film or a part in it is left alone', () => {
    const cur: Part[] = [{ name: 'Сезон 1' }, { name: 'Фильм «Бесконечный поезд»' }];
    expect(mergeParts(cur, [season(1), season(2)])).toEqual({ parts: cur, changed: false });
  });

  it('a hand-made season the provider does not have: left alone', () => {
    const cur: Part[] = [{ name: 'Сезон 1' }, { name: 'Сезон 5' }];
    expect(mergeParts(cur, [season(1), season(2)]).changed).toBe(false);
  });

  it('parts edited by hand: only the released flags move', () => {
    const cur: Part[] = [{ name: 'Мой', released: false, ref: 'tmdb-season:1', year: 1999 }];
    const r = mergeParts(cur, [season(1), season(2)], { manual: true });
    expect(r.parts).toEqual([{ name: 'Мой', released: true, ref: 'tmdb-season:1', year: 1999 }]);
    expect(mergeParts([{ name: '1' }], [season(1), season(2)], { manual: true }).changed).toBe(false);
  });

  it('extras keep their mark', () => {
    const r = mergeParts([], [season(1), { name: 'OVA', ref: 'shiki:1', extra: true, released: true }]);
    expect(r.parts[1]).toEqual({ name: 'OVA', year: null, released: true, ref: 'shiki:1', extra: true });
  });
});

describe('extras count toward nothing', () => {
  const parts: Part[] = [{ name: 'S1' }, { name: 'OVA', extra: true }, { name: 'S2', released: false }];
  it('partsProgress skips them', () => {
    expect(partsProgress(parts, [0, 1])).toEqual({ released: 1, pending: 1, watched: 1 });
  });
  it('caught up: every released main part ticked, one announced', () => {
    const t = { id: 'x', title: 'x', category: 'anime', status: 'in_progress', genres: [], parts } as Title;
    expect(isCaughtUp(t, [0])).toBe(true);
  });
});

describe('fillTicksForDone', () => {
  it('a finished title ticks every released main part', () => {
    expect(fillTicksForDone([{ name: '1' }, { name: 'OVA', extra: true }, { name: '2' }, { name: '3', released: false }], 'done')).toEqual([0, 2]);
  });
  it('anything else ticks nothing', () => {
    expect(fillTicksForDone([{ name: '1' }], 'in_progress')).toEqual([]);
  });
});

describe('ticksWith', () => {
  it('keeps old dates and stamps new ticks', () => {
    expect(ticksWith({ '0': 'a' }, [0, 2], 'b')).toEqual({ '0': 'a', '2': 'b' });
  });
});

describe('planMerge', () => {
  const t = (id: string, status: Title['status'], createdAt: string, rating: number | null = null, parts?: Part[]): Title =>
    ({ id, title: id, category: 'anime', status, genres: [], createdAt, rating, parts });
  const hellParts: Part[] = [{ name: 'Сезон 1', ref: 'shiki:46569' }, { name: 'Сезон 2', ref: 'shiki:55825' }];

  it('two finished seasons become one title with both ticked', () => {
    const plans = planMerge(
      [t('hell-2', 'done', '2026-01-01', 7), t('hell', 'done', '2026-02-01', 9)],
      { hell: { key: 'hp', ref: 'shiki:46569' }, 'hell-2': { key: 'hp', ref: 'shiki:55825' } },
      { hp: 'shiki:46569' },
      { hell: hellParts }
    );
    expect(plans).toEqual([{ keep: 'hell', absorb: ['hell-2'], ticks: [1], rating: 9 }]);
  });

  it('a duplicate still in the queue moves no ticks', () => {
    const parts: Part[] = [{ name: 'Сезон 1', ref: 'shiki:1' }, { name: 'Против сборной', ref: 'shiki:2' }];
    const plans = planMerge(
      [t('bl', 'done', '2026-01-01'), t('bl-movie', 'queue', '2026-02-01')],
      { bl: { key: 'b', ref: 'shiki:1' }, 'bl-movie': { key: 'b', ref: 'shiki:2' } }, { b: 'shiki:1' }, { bl: parts });
    expect(plans).toEqual([{ keep: 'bl', absorb: ['bl-movie'], ticks: [], rating: null }]);
  });

  it('without the first TV season, the title added first is kept', () => {
    const plans = planMerge(
      [t('ova', 'queue', '2026-03-01'), t('s3', 'queue', '2026-01-01', null)],
      { ova: { key: 'k', ref: 'shiki:9' }, s3: { key: 'k', ref: 'shiki:3' } }, { k: 'shiki:1' },
      { s3: [{ name: 's3', ref: 'shiki:3' }, { name: 'ova', ref: 'shiki:9', extra: true }] });
    expect(plans[0]!.keep).toBe('s3');
  });

  it('the keep has no part for the duplicate: nothing is merged', () => {
    const plans = planMerge(
      [t('hell', 'done', '2026-01-01'), t('hell-2', 'done', '2026-02-01')],
      { hell: { key: 'hp', ref: 'shiki:46569' }, 'hell-2': { key: 'hp', ref: 'shiki:55825' } }, { hp: 'shiki:46569' },
      { hell: [{ name: '1' }] });
    expect(plans).toEqual([]);
  });

  it('titles without a franchise, or alone in theirs, are not touched', () => {
    expect(planMerge([t('a', 'queue', '1'), t('b', 'queue', '2')], { a: { key: 'x', ref: 'shiki:1' } }, {}, {})).toEqual([]);
  });
});

import { cardFixes } from '../../src/lib/refresh';
import type { TitleRow } from '../../src/lib/titleRow';
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

  it('a hand-made list nobody started takes the provider\'s list whole', () => {
    const fresh = [season(1), season(2), season(3, false)];
    const r = mergeParts([{ name: 'Книга 1: Вода' }, { name: 'Сезон 5', released: false }], fresh, { untouched: true, lineUp: false });
    expect(r).toEqual({ parts: mergeParts(undefined, fresh).parts, changed: true });
    expect(mergeParts([{ name: 'Книга 1: Вода' }], fresh, { untouched: true, manual: true }).changed).toBe(false);
  });

  it('a hand-made list is lined up only as season 1, 2, … in order, and never with lineUp off', () => {
    const fresh = [season(1), season(2), season(3)];
    expect(mergeParts([{ name: 'Сезон 1' }, { name: 'Сезон 3' }], fresh).changed).toBe(false);
    expect(mergeParts([{ name: 'Сезон 2' }], fresh).changed).toBe(false);
    expect(mergeParts([{ name: 'Сезон 1' }], fresh, { lineUp: false }).changed).toBe(false);
  });

  it('a main part linked between parts already on the list goes to the extras; a new last season does not', () => {
    const film: FreshPart = { name: 'Фильм', year: 2019, released: true, ref: 'shiki:7' };
    const ova: FreshPart = { name: 'OVA', year: 2015, released: true, ref: 'shiki:9', extra: true };
    const cur = mergeParts(undefined, [season(1), season(2), ova]).parts;
    const r = mergeParts(cur, [season(1), film, season(2), season(3, false), ova]);
    expect(r.parts.slice(3).map((p) => [p.name, !!p.extra])).toEqual([['Фильм', true], ['Сезон 3', false]]);
  });

  it('a part the provider now counts as a side piece moves to the extras, never back', () => {
    const cur: Part[] = [{ name: 'S1', ref: 'shiki:1', released: true, year: 2020 }, { name: 'OVA', ref: 'shiki:2', released: true, year: 2021 },
      { name: 'Фильм', ref: 'shiki:7', released: true, year: 2019, extra: true }];
    const r = mergeParts(cur, [{ name: 'S1', ref: 'shiki:1', year: 2020, released: true }, { name: 'Фильм', ref: 'shiki:7', year: 2019, released: true },
      { name: 'OVA', ref: 'shiki:2', year: 2021, released: true, extra: true }]);
    expect(r.parts.map((p) => !!p.extra)).toEqual([false, true, true]);
  });

  it('OVAs and specials named so in a hand-made list go to the extras', () => {
    const cur: Part[] = [{ name: 'Сезон 1' }, { name: 'OVA «Ледяные узы»' }, { name: 'Спешл' }, { name: 'Ovation' }];
    expect(mergeParts(cur, [season(1)], { lineUp: false }).parts.map((p) => !!p.extra)).toEqual([false, true, true, false]);
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
      { hell: { key: 'hp', ref: 'shiki:46569', main: true }, 'hell-2': { key: 'hp', ref: 'shiki:55825', main: true } },
      { hp: 'shiki:46569' },
      { hell: hellParts }
    );
    expect(plans).toEqual([{ keep: 'hell', absorb: ['hell-2'], ticks: [1], rating: 9 }]);
  });

  it('a duplicate still in the queue moves no ticks', () => {
    const parts: Part[] = [{ name: 'Сезон 1', ref: 'shiki:1' }, { name: 'Против сборной', ref: 'shiki:2' }];
    const plans = planMerge(
      [t('bl', 'done', '2026-01-01'), t('bl-movie', 'queue', '2026-02-01')],
      { bl: { key: 'b', ref: 'shiki:1', main: true }, 'bl-movie': { key: 'b', ref: 'shiki:2', main: true } }, { b: 'shiki:1' }, { bl: parts });
    expect(plans).toEqual([{ keep: 'bl', absorb: ['bl-movie'], ticks: [], rating: null }]);
  });

  it('without the first TV season, the main-story title added first is kept', () => {
    const parts: Part[] = [{ name: 's2', ref: 'shiki:2' }, { name: 's3', ref: 'shiki:3' }, { name: 'ova', ref: 'shiki:9', extra: true }];
    const plans = planMerge(
      [t('ova', 'queue', '2025-01-01'), t('s3', 'queue', '2026-02-01'), t('s2', 'queue', '2026-01-01')],
      { ova: { key: 'k', ref: 'shiki:9', main: false }, s3: { key: 'k', ref: 'shiki:3', main: true }, s2: { key: 'k', ref: 'shiki:2', main: true } },
      { k: 'shiki:1' }, { s2: parts, s3: parts });
    expect(plans).toEqual([{ keep: 's2', absorb: ['s3'], ticks: [], rating: null }]);
  });

  it('only what lands whole is absorbed: spin-offs, titles in progress or with ticks stay', () => {
    const parts: Part[] = [{ name: 's1', ref: 'shiki:1' }, { name: 's2', ref: 'shiki:2' }, { name: 's3', ref: 'shiki:3' }, { name: 's4', ref: 'shiki:4' },
      { name: 'school', ref: 'shiki:8', extra: true }];
    const plans = planMerge(
      [t('s1', 'queue', '1'), t('s2', 'in_progress', '2'), t('s3', 'queue', '3'), t('s4', 'done', '4'), t('school', 'queue', '5')],
      { s1: { key: 'k', ref: 'shiki:1', main: true }, s2: { key: 'k', ref: 'shiki:2', main: true }, s3: { key: 'k', ref: 'shiki:3', main: true },
        s4: { key: 'k', ref: 'shiki:4', main: true }, school: { key: 'k', ref: 'shiki:8', main: false } },
      { k: 'shiki:1' }, { s1: parts }, new Set(['s3']));
    expect(plans).toEqual([{ keep: 's1', absorb: ['s4'], ticks: [3], rating: null }]);
  });

  it('the keep has no part for the duplicate: nothing is merged', () => {
    const plans = planMerge(
      [t('hell', 'done', '2026-01-01'), t('hell-2', 'done', '2026-02-01')],
      { hell: { key: 'hp', ref: 'shiki:46569', main: true }, 'hell-2': { key: 'hp', ref: 'shiki:55825', main: true } }, { hp: 'shiki:46569' },
      { hell: [{ name: '1' }] });
    expect(plans).toEqual([]);
  });

  it('titles without a franchise, or alone in theirs, are not touched', () => {
    expect(planMerge([t('a', 'queue', '1'), t('b', 'queue', '2')], { a: { key: 'x', ref: 'shiki:1' } }, {}, {})).toEqual([]);
  });
});

describe('cardFixes (wave 3)', () => {
  const HEADER = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/990080/abc/header.jpg?t=1';
  const TALL = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/990080/library_600x900_2x.jpg';
  const EN = 'Hogwarts Legacy is an immersive, open-world action RPG.';
  const RU_TEXT = 'Hogwarts Legacy — ролевая игра с открытым миром.';
  const row = (o: Partial<TitleRow> = {}): TitleRow => ({ id: 'h', title: 'Hogwarts Legacy', category: 'game', status: 'queue', cover: HEADER, synopsis: EN, genres: ['RPG'], year: 2023, ...o });

  it('daily: a Steam header becomes the tall cover, English becomes Russian', () => {
    expect(cardFixes(row(), { cover: TALL, synopsis: RU_TEXT }, 'daily')).toEqual({ cover: TALL, synopsis: RU_TEXT });
  });
  it('a cover someone chose is never replaced', () => {
    expect(cardFixes(row({ cover: 'data:image/jpeg;base64,AAA' }), { cover: TALL }, 'daily')).toBeNull();
    expect(cardFixes(row({ cover: 'https://example.com/my.jpg' }), { cover: TALL }, 'normalize')).toBeNull();
    expect(cardFixes(row({ cover: 'https://rjdnpwamcxvhryiigbvt.supabase.co/storage/v1/object/public/covers/x.jpg' }), { cover: TALL }, 'normalize')).toBeNull();
  });
  it('an old-site file gives way to a tall cover, not to a wide one', () => {
    expect(cardFixes(row({ cover: 'images/covers/haven-2020.jpg' }), { cover: TALL }, 'normalize')).toEqual({ cover: TALL });
    expect(cardFixes(row({ cover: 'images/covers/haven-2020.jpg' }), { cover: HEADER }, 'normalize')).toBeNull();
    expect(cardFixes(row({ cover: 'images/covers/_placeholder.svg' }), { cover: HEADER }, 'daily')).toEqual({ cover: HEADER });
  });
  it('a Russian description stays in daily mode, and never gives way to a machine translation', () => {
    expect(cardFixes(row({ synopsis: 'Своё описание по-русски.' }), { synopsis: 'Другое русское описание.' }, 'daily')).toBeNull();
    expect(cardFixes(row({ synopsis: 'Своё описание по-русски.' }), { synopsis: '[mt] Машинный перевод.' }, 'normalize')).toBeNull();
    expect(cardFixes(row({ synopsis: 'Своё описание по-русски.' }), { synopsis: 'Описание из поиска.' }, 'normalize')).toEqual({ synopsis: 'Описание из поиска.' });
    expect(cardFixes(row({ synopsis: 'Своё описание по-русски.' }), { synopsis: EN }, 'normalize')).toBeNull();
  });
  it('normalize: name, original name, genres and year as search gives them', () => {
    expect(cardFixes(row({ title: 'Хогвартс', genres: ['rpg'], year: null, cover: TALL, synopsis: RU_TEXT }),
      { title: 'Hogwarts Legacy', originalTitle: 'Hogwarts Legacy', genres: ['Ролевые игры'], year: 2023, cover: TALL, synopsis: RU_TEXT }, 'normalize'))
      .toEqual({ title: 'Hogwarts Legacy', genres: ['Ролевые игры'], year: 2023 });
    expect(cardFixes(row({ title: 'Дюна', category: 'movie', cover: 'https://image.tmdb.org/t/p/w500/d.jpg', synopsis: 'Наследник.' }),
      { title: 'Дюна', originalTitle: 'Dune', cover: 'https://image.tmdb.org/t/p/w500/other.jpg', synopsis: 'Наследник.' }, 'normalize'))
      .toEqual({ original_title: 'Dune' });
  });
  it('normalize: a Russian name of a show is not given up for TMDb\'s English fallback', () => {
    const show = row({ title: 'Локи', category: 'series', cover: 'https://image.tmdb.org/t/p/w500/l.jpg', synopsis: 'Бог обмана.' });
    expect(cardFixes(show, { title: 'Loki', originalTitle: 'Loki', cover: 'https://image.tmdb.org/t/p/w500/l.jpg', synopsis: 'Бог обмана.' }, 'normalize'))
      .toEqual({ original_title: 'Loki' });
    expect(cardFixes(show, { title: 'Локи (2021)', cover: 'https://image.tmdb.org/t/p/w500/l.jpg', synopsis: 'Бог обмана.' }, 'normalize'))
      .toEqual({ title: 'Локи (2021)' });
  });
  it('daily never touches the name, genres or year', () => {
    expect(cardFixes(row({ cover: TALL, synopsis: RU_TEXT }), { title: 'Другое', genres: ['x'], year: 1999 }, 'daily')).toBeNull();
  });
  it('a second pass changes nothing', () => {
    const card = { title: 'Hogwarts Legacy', cover: TALL, synopsis: RU_TEXT, genres: ['Ролевые игры'], year: 2023 };
    const first = cardFixes(row(), card, 'normalize')!;
    expect(cardFixes(row(first), card, 'normalize')).toBeNull();
    expect(cardFixes(row(first), card, 'daily')).toBeNull();
  });
});

describe('mergeParts untouched, the source knowing less', () => {
  it('keeps a hand-made list with more main parts than the source', () => {
    const cur = [{ name: '1', released: true }, { name: '2', released: true }, { name: '3', released: false }];
    const fresh = [{ name: 'Сезон 1', released: true, ref: 'tmdb-season:1', season: 1 }, { name: 'Сезон 2', released: true, ref: 'tmdb-season:2', season: 2 }];
    const m = mergeParts(cur, fresh, { untouched: true, lineUp: false });
    expect(m.parts.map((p) => p.name)).toEqual(['1', '2', '3']);
  });
});

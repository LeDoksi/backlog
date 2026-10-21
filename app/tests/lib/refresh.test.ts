import { cardFixes } from '../../src/lib/refresh';
import type { TitleRow } from '../../src/lib/titleRow';
import { describe, expect, it } from 'vitest';
import { fillTicksForDone, mergeParts, planMerge, seasonNumber, ticksMoved, ticksWith, type FreshPart } from '../../src/lib/refresh';
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

describe('mergeParts reorder (a title not finished follows the provider)', () => {
  const p = (ref: string, extra = false): Part => ({ name: ref, year: 2020, released: true, ref, ...(extra ? { extra: true } : {}) });
  const f = (ref: string, extra = false): FreshPart => ({ name: ref, year: 2020, released: true, ref, ...(extra ? { extra: true } : {}) });
  const slime: Part[] = [p('s1'), p('s2'), p('s3'), p('ova', true), p('film1', true), p('film2', true)];
  const fresh = [f('s1'), f('s2'), f('film1'), f('s3'), f('film2'), f('ova', true)];

  it('films the provider now counts as main leave the extras and take their place; ticks move with them', () => {
    const m = mergeParts(slime, fresh, { reorder: true });
    expect(m.parts.map((x) => [x.ref, !!x.extra])).toEqual([['s1', false], ['s2', false], ['film1', false], ['s3', false], ['film2', false], ['ova', true]]);
    expect(m.from).toEqual([0, 1, 4, 2, 5, 3]);
    expect(ticksMoved({ '0': 'a', '2': 'b', '3': 'c' }, m.from!)).toEqual({ '0': 'a', '3': 'b', '5': 'c' });
  });

  it('without reorder (a finished title) the films stay extras and nothing moves', () => {
    const m = mergeParts(slime, fresh);
    expect(m.from).toBeUndefined();
    expect(m.parts.filter((x) => x.extra).map((x) => x.ref)).toEqual(['ova', 'film1', 'film2']);
  });

  it('a list already in the provider\'s order is left as it is', () => {
    const m = mergeParts(fresh.map((x) => ({ ...x })) as Part[], fresh, { reorder: true });
    expect(m.from).toBeUndefined();
    expect(m.changed).toBe(false);
  });

  it('a hand-edited list is never reordered; a part the provider does not name stays after its own', () => {
    expect(mergeParts(slime, fresh, { reorder: true, manual: true }).from).toBeUndefined();
    const m = mergeParts([...slime, { name: 'мой спешл' }], fresh, { reorder: true });
    expect(m.parts.at(-1)).toEqual({ name: 'мой спешл' });
    expect(m.from!.at(-1)).toBe(6);
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
    expect(plans).toEqual([{ keep: 's2', absorb: ['ova', 's3'], ticks: [], rating: null }]);
  });

  it('only what lands whole is absorbed: titles in progress or with ticks stay', () => {
    const parts: Part[] = [{ name: 's1', ref: 'shiki:1' }, { name: 's2', ref: 'shiki:2' }, { name: 's3', ref: 'shiki:3' }, { name: 's4', ref: 'shiki:4' },
      { name: 'school', ref: 'shiki:8', extra: true }];
    const plans = planMerge(
      [t('s1', 'queue', '1'), t('s2', 'in_progress', '2'), t('s3', 'queue', '3'), t('s4', 'done', '4'), t('school', 'queue', '5')],
      { s1: { key: 'k', ref: 'shiki:1', main: true }, s2: { key: 'k', ref: 'shiki:2', main: true }, s3: { key: 'k', ref: 'shiki:3', main: true },
        s4: { key: 'k', ref: 'shiki:4', main: true }, school: { key: 'k', ref: 'shiki:8', main: false } },
      { k: 'shiki:1' }, { s1: parts }, new Set(['s3']));
    expect(plans).toEqual([{ keep: 's1', absorb: ['s4', 'school'], ticks: [3], rating: null }]);
  });

  it('an OVA of the franchise folds into the show and ticks its extra («Атака титанов OVA» on est\'s board)', () => {
    const parts: Part[] = [{ name: 'Атака титанов', ref: 'shiki:16498' }, { name: 'Атака титанов 2', ref: 'shiki:25777' },
      { name: 'Атака титанов OVA', ref: 'shiki:18397', extra: true }];
    const plans = planMerge(
      [t('aot', 'done', '1'), t('aot-ova', 'done', '2', 8)],
      { aot: { key: 'k', ref: 'shiki:16498', main: true }, 'aot-ova': { key: 'k', ref: 'shiki:18397', main: false } },
      { k: 'shiki:16498' }, { aot: parts });
    expect(plans).toEqual([{ keep: 'aot', absorb: ['aot-ova'], ticks: [2], rating: 8 }]);
  });

  it('a side piece never becomes the keep', () => {
    const parts: Part[] = [{ name: 's2', ref: 'shiki:2' }, { name: 'ova', ref: 'shiki:9', extra: true }];
    const plans = planMerge(
      [t('ova', 'queue', '1'), t('s2', 'queue', '2')],
      { ova: { key: 'k', ref: 'shiki:9', main: false }, s2: { key: 'k', ref: 'shiki:2', main: true } },
      { k: 'shiki:1' }, { s2: parts });
    expect(plans).toEqual([{ keep: 's2', absorb: ['ova'], ticks: [], rating: null }]);
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

  it('weekly: a Steam header becomes the tall cover, English becomes Russian', () => {
    expect(cardFixes(row(), { cover: TALL, synopsis: RU_TEXT }, 'weekly')).toEqual({ cover: TALL, synopsis: RU_TEXT });
  });
  it('a cover someone chose is never replaced', () => {
    expect(cardFixes(row({ cover: 'data:image/jpeg;base64,AAA' }), { cover: TALL }, 'weekly')).toBeNull();
    expect(cardFixes(row({ cover: 'https://example.com/my.jpg' }), { cover: TALL }, 'normalize')).toBeNull();
    expect(cardFixes(row({ cover: 'https://rjdnpwamcxvhryiigbvt.supabase.co/storage/v1/object/public/covers/x.jpg' }), { cover: TALL }, 'normalize')).toBeNull();
  });
  it('an old-site file gives way to a tall cover, not to a wide one', () => {
    expect(cardFixes(row({ cover: 'images/covers/haven-2020.jpg' }), { cover: TALL }, 'normalize')).toEqual({ cover: TALL });
    expect(cardFixes(row({ cover: 'images/covers/haven-2020.jpg' }), { cover: HEADER }, 'normalize')).toBeNull();
    expect(cardFixes(row({ cover: 'images/covers/_placeholder.svg' }), { cover: HEADER }, 'weekly')).toEqual({ cover: HEADER });
    expect(cardFixes(row({ cover: TALL }), { cover: HEADER }, 'weekly')).toBeNull();
  });
  it('a Russian description never gives way to a machine translation or English', () => {
    expect(cardFixes(row({ synopsis: 'Своё описание по-русски.' }), { synopsis: 'Другое русское описание.' }, 'weekly')).toEqual({ synopsis: 'Другое русское описание.' });
    expect(cardFixes(row({ synopsis: 'Своё описание по-русски.' }), { synopsis: '[mt] Машинный перевод.' }, 'weekly')).toBeNull();
    expect(cardFixes(row({ synopsis: 'Своё описание по-русски.' }), { synopsis: EN }, 'weekly')).toBeNull();
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
    // Only the case differs: the name stays.
    expect(cardFixes(row({ title: 'Что, если...?', category: 'series', cover: 'https://image.tmdb.org/t/p/w500/l.jpg', synopsis: 'Бог обмана.' }),
      { title: 'Что, Если...?', cover: 'https://image.tmdb.org/t/p/w500/l.jpg', synopsis: 'Бог обмана.' }, 'normalize')).toBeNull();
  });
  it('weekly: a film\'s poster follows its source, «Локи» stays «Локи»', () => {
    const film = row({ title: 'Дюна', category: 'movie', cover: 'https://image.tmdb.org/t/p/w500/d.jpg', synopsis: 'Наследник.' });
    expect(cardFixes(film, { cover: 'https://image.tmdb.org/t/p/w500/new.jpg', synopsis: 'Наследник.' }, 'weekly')).toEqual({ cover: 'https://image.tmdb.org/t/p/w500/new.jpg' });
    expect(cardFixes(film, { cover: 'https://shikimori.one/assets/globals/missing_original.jpg' }, 'weekly')).toBeNull();
    const loki = row({ title: 'Локи', category: 'series', cover: 'https://image.tmdb.org/t/p/w500/l.jpg', synopsis: 'Бог обмана.' });
    expect(cardFixes(loki, { title: 'Loki', cover: 'https://image.tmdb.org/t/p/w500/l.jpg', synopsis: 'God of mischief.' }, 'weekly')).toBeNull();
  });
  it('weekly: a game\'s platforms and genres in their canonical names', () => {
    expect(cardFixes(row({ cover: TALL, synopsis: RU_TEXT, platforms: ['PC'] }), { platforms: ['PC', 'PlayStation 5'] }, 'weekly')).toEqual({ platforms: ['PC', 'PS5'] });
    expect(cardFixes(row({ cover: TALL, synopsis: RU_TEXT, platforms: ['PC', 'PS5'] }), { platforms: ['PC', 'PlayStation 5'] }, 'weekly')).toBeNull();
  });
  it('weekly: release dates and the badge (BL-117)', () => {
    const film = (o: Partial<TitleRow> = {}) => row({ title: 'Дюна 3', category: 'movie', cover: 'c', synopsis: 'Текст.', ...o });
    expect(cardFixes(film(), { release: { date: '2026-12-15', digital: null, out: false } }, 'weekly', '2026-10-21'))
      .toEqual({ status: 'unreleased', release_date: '2026-12-15' });
    expect(cardFixes(film({ status: 'unreleased', release_date: '2026-12-15' }), { release: { date: '2026-12-15', digital: null, out: true } }, 'weekly', '2026-12-15'))
      .toEqual({ status: 'queue' });
    // Seen at a festival: started or finished keeps its status.
    expect(cardFixes(film({ status: 'done' }), { release: { date: '2026-12-15', digital: null, out: false } }, 'weekly', '2026-10-21'))
      .toEqual({ release_date: '2026-12-15' });
    // Postponed: the badge comes back on a title nobody started.
    expect(cardFixes(film({ release_date: '2026-10-01' }), { release: { date: '2027-03-01', digital: null, out: false } }, 'weekly', '2026-10-21'))
      .toEqual({ status: 'unreleased', release_date: '2027-03-01' });
    // A game out with no day given: today.
    expect(cardFixes(row({ cover: TALL, synopsis: RU_TEXT, status: 'unreleased' }), { release: { date: null, digital: null, out: true } }, 'weekly', '2026-10-21'))
      .toEqual({ status: 'queue', release_date: '2026-10-21' });
    // An old film TMDb keeps no date for is not «not out yet».
    expect(cardFixes(film({ year: 1987 }), { release: { date: null, digital: null, out: false } }, 'weekly', '2026-10-21')).toBeNull();
    // Normalize leaves releases alone; a series has none.
    expect(cardFixes(film(), { release: { date: '2026-12-15', digital: null, out: false } }, 'normalize')).toBeNull();
    expect(cardFixes(film({ category: 'series' }), { release: { date: '2026-12-15', digital: null, out: false } }, 'weekly')).toBeNull();
  });
  it('a second pass changes nothing', () => {
    const card = { title: 'Hogwarts Legacy', cover: TALL, synopsis: RU_TEXT, genres: ['Ролевые игры'], year: 2023 };
    const first = cardFixes(row(), card, 'normalize')!;
    expect(cardFixes(row(first), card, 'normalize')).toBeNull();
    expect(cardFixes(row(first), card, 'weekly')).toBeNull();
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

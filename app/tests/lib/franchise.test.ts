// Seasons and franchises on the live answers recorded 2026-10-14
// (tests/fixtures/live, fetched on Georgy's computer through Remote Control).
import { describe, expect, it } from 'vitest';
import { fetchShikimoriFranchise, fetchTmdbDetails, fetchTmdbSeasons, type Franchise } from '../../src/lib/enrich';
import { franchiseLabel, isLoneWork, partsFromFranchise, partsFromTmdb } from '../../src/lib/franchise';
import { liveFetch } from '../fixtures/liveFetch';

const today = new Date('2026-10-14T12:00:00Z');
const franchise = async (id: number) => (await fetchShikimoriFranchise(liveFetch, id)) as Franchise;

describe('TMDb seasons', () => {
  it('Ходячие мертвецы: 11 main seasons, the specials in the extras', async () => {
    const s = await fetchTmdbSeasons(liveFetch, null, 'KEY', 1402);
    const parts = partsFromTmdb(s!.seasons, today);
    expect(parts.filter((p) => !p.extra).map((p) => p.name)).toEqual(Array.from({ length: 11 }, (_, i) => `Сезон ${i + 1}`));
    expect(parts.at(-1)).toMatchObject({ name: 'Спецматериалы', extra: true, ref: 'tmdb-season:0' });
    expect(parts[0]).toMatchObject({ ref: 'tmdb-season:1', year: 2010, released: true, season: 1 });
    expect(s!.status).toBe('Ended');
  });

  it('the details of a series carry its seasons, no second request', async () => {
    const d = await fetchTmdbDetails(liveFetch, null, 'KEY', 'series', 71024);
    expect((d!.tmdbSeasons as { seasons: unknown[] }).seasons).toHaveLength(4);
  });

  it('a season without a date or with one ahead is not out', () => {
    const parts = partsFromTmdb([{ number: 1, name: 'Сезон 1', year: 2020, airDate: '2020-01-01' }, { number: 2, name: 'Сезон 2', year: 2027, airDate: '2027-03-01' },
      { number: 3, name: 'Сезон 3', year: null, airDate: null }], today);
    expect(parts.map((p) => p.released)).toEqual([true, false, false]);
  });

  it('a season with its own name keeps it', () => {
    expect(partsFromTmdb([{ number: 1, name: 'Книга 1: Вода', year: 2005, airDate: '2005-02-21' }], today)[0]!.name).toBe('Книга 1: Вода');
  });

  it('a network error is null', async () => {
    expect(await fetchTmdbSeasons(() => Promise.reject(new Error('down')), null, 'KEY', 1402)).toBeNull();
  });
});

describe('Shikimori franchise', () => {
  it('Атака титанов: the story in order, the OVA and the recap films in the extras', async () => {
    const f = await franchise(16498);
    expect(f.rootId).toBe(16498);
    const parts = partsFromFranchise(f, today);
    const main = parts.filter((p) => !p.extra);
    expect(main.map((p) => p.ref)).toEqual(['shiki:16498', 'shiki:25777', 'shiki:35760', 'shiki:38524', 'shiki:40028', 'shiki:48583', 'shiki:51535']);
    expect(main.filter((p) => p.season).map((p) => p.season)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(parts.find((p) => p.ref === 'shiki:18397')).toMatchObject({ name: 'Атака титанов OVA', extra: true });
    expect(parts.some((p) => /Сникерс|Моя война/.test(p.name))).toBe(false);
    expect(franchiseLabel(f)).toBe('6 сезонов, 1 спецвыпуск');
  });

  it('Этот замечательный мир!: the film between the seasons is main, the spin-off is an extra', async () => {
    const f = await franchise(30831);
    const main = partsFromFranchise(f, today).filter((p) => !p.extra);
    expect(main.map((p) => p.ref)).toEqual(['shiki:30831', 'shiki:32937', 'shiki:38040', 'shiki:49458', 'shiki:61203']);
    expect(main.at(-1)!.released).toBe(false);
    expect(franchiseLabel(f)).toBe('4 сезона, 1 фильм');
  });

  it('Синяя тюрьма: the film about Nagi between the seasons, the announced third season not out', async () => {
    const parts = partsFromFranchise(await franchise(49596), today);
    expect(parts.filter((p) => !p.extra).map((p) => [p.ref, p.released]))
      .toEqual([['shiki:49596', true], ['shiki:54866', true], ['shiki:54865', true], ['shiki:62589', false]]);
  });

  it('О моём перерождении в слизь: the films hung off a season are main, in their place; the diaries stay extras', () => {
    const node = (id: number, kind: string, year: number | null, date: string, name = String(id)) =>
      ({ id, kind, year, date: Date.parse(date) / 1000, name, image_url: '' });
    const link = (source_id: number, target_id: number, relation: string) => ({ source_id, target_id, relation });
    // The shape Shikimori gave on 2026-10-16 (ids and links as they are, dates approximate).
    const data = {
      nodes: [node(37430, 'TV Сериал', 2018, '2018-10-02'), node(39551, 'TV Сериал', 2021, '2021-01-12'), node(41487, 'TV Сериал', 2021, '2021-07-06'),
        node(49877, 'Фильм', 2022, '2022-11-25', 'Алые узы'), node(53580, 'TV Сериал', 2024, '2024-04-05'),
        node(59971, 'Фильм', 2026, '2026-02-27', 'Слёзы синего моря'), node(59970, 'TV Сериал', 2026, '2026-04-03'),
        node(39607, 'TV Спецвыпуск', 2019, '2019-03-26', 'Дневник Вельдоры'), node(57434, 'Спецвыпуск', 2023, '2023-01-01')],
      links: [link(37430, 39551, 'sequel'), link(39551, 37430, 'prequel'), link(39551, 41487, 'sequel'), link(41487, 39551, 'prequel'),
        link(41487, 53580, 'sequel'), link(53580, 41487, 'prequel'), link(53580, 59970, 'sequel'), link(59970, 53580, 'prequel'),
        link(49877, 41487, 'parent_story'), link(49877, 57434, 'other'), link(59971, 53580, 'parent_story'), link(39607, 37430, 'full_story')]
    };
    const fetchFn = () => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
    return fetchShikimoriFranchise(fetchFn, 37430).then((f) => {
      const parts = partsFromFranchise(f!, today);
      expect(parts.filter((p) => !p.extra).map((p) => p.ref))
        .toEqual(['shiki:37430', 'shiki:39551', 'shiki:41487', 'shiki:49877', 'shiki:53580', 'shiki:59971', 'shiki:59970']);
      expect(parts.filter((p) => !p.extra).map((p) => p.season ?? null)).toEqual([1, 2, 3, null, 4, null, 5]);
      expect(parts.find((p) => p.ref === 'shiki:39607')!.extra).toBe(true);
      expect(franchiseLabel(f!)).toBe('5 сезонов, 2 фильма');
    });
  });

  it('Фрирен: three seasons, the third ahead', async () => {
    const f = await franchise(52991);
    const main = partsFromFranchise(f, today).filter((p) => !p.extra);
    expect(main.map((p) => p.released)).toEqual([true, true, false]);
  });

  it('Гинтама: a franchise of 39 entries keeps the main list short', async () => {
    const f = await franchise(918);
    const parts = partsFromFranchise(f, today);
    const main = parts.filter((p) => !p.extra);
    expect(main.length).toBeLessThanOrEqual(15);
    expect(main[0]!.ref).toBe('shiki:918');
    expect(main.at(-1)!.name).toBe('Гинтама: Финал');
    // A special inside the chain is still a side piece.
    expect(parts.find((p) => p.name === 'Гинтама: Полуфинал')!.extra).toBe(true);
  });

  it('asked from a later season, the root is still the first TV season', async () => {
    const f = await fetchShikimoriFranchise(liveFetch, 16498);
    expect(f!.rootId).toBe(16498);
  });

  it('a film on its own is a lone work; one season or two films are not', () => {
    expect(isLoneWork([{ name: 'Фильм', ref: 'shiki:1', released: true }, { name: 'OVA', ref: 'shiki:2', released: true, extra: true }])).toBe(true);
    expect(isLoneWork([{ name: 'S1', ref: 'shiki:1', released: true, season: 1 }])).toBe(false);
    expect(isLoneWork([{ name: 'A', ref: 'shiki:1', released: true }, { name: 'B', ref: 'shiki:2', released: true }])).toBe(false);
  });

  it('a network error or an empty franchise is null', async () => {
    expect(await fetchShikimoriFranchise(() => Promise.reject(new Error('down')), 1)).toBeNull();
    expect(await fetchShikimoriFranchise(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ nodes: [], links: [] }) }), 1)).toBeNull();
  });
});

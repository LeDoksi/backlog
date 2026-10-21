import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cinemaLabel, isSearchCard, movieRelease, parseSteamDate, rawgRelease, releaseEvents, releaseStatus, releaseToast, steamRelease } from '../../src/lib/release';
import type { Title } from '../../src/lib/types';

const live = (f: string) => JSON.parse(readFileSync(join(__dirname, '../fixtures/live', f), 'utf8'));
const steam = (id: number) => live(`steam-app-${id}.json`)[id].data;
const TODAY = '2026-10-21';

describe('movieRelease (live TMDb, 2026-10-21)', () => {
  it('a film already in cinemas somewhere is out, dated by its earliest theatrical release', () => {
    expect(movieRelease(live('tmdb-movie-1153576.json'), TODAY)).toEqual({ date: '2026-10-13', digital: '2026-12-01', out: true });
  });
  it('TMDb «Released» with every date ahead is not out', () => {
    expect(movieRelease(live('tmdb-movie-1381071.json'), TODAY)).toMatchObject({ date: '2026-11-03', out: false });
  });
  it('a film with no Russian release still counts from the earliest country', () => {
    expect(movieRelease(live('tmdb-movie-1368337.json'), TODAY)).toEqual({ date: '2026-07-15', digital: '2026-11-17', out: true });
  });
  it('a premiere (type 1) is not a theatrical release', () => {
    expect(movieRelease(live('tmdb-movie-1248723.json'), TODAY).date).toBe('2025-12-31');
  });
  it('Dune 3 is not out', () => {
    expect(movieRelease(live('tmdb-movie-1170608.json'), TODAY)).toEqual({ date: '2026-12-15', digital: null, out: false });
  });
  it('no dates at all: not out', () => {
    expect(movieRelease({ id: 1, release_date: '', release_dates: { results: [] } }, TODAY)).toEqual({ date: null, digital: null, out: false });
  });
  it('without release_dates the main date is used', () => {
    expect(movieRelease({ id: 1, release_date: '2020-05-01' }, TODAY)).toEqual({ date: '2020-05-01', digital: null, out: true });
  });
});

describe('Steam dates (live)', () => {
  it.each([
    ['22 окт. 2026 г.', '2026-10-22'], ['14 мая. 2026 г.', '2026-05-14'], ['4 сен. 2025 г.', '2025-09-04'], ['9 дек. 2020 г.', '2020-12-09'],
    ['1 дек. 2029 г.', '2029-12-01'], ['Sep 4, 2025', '2025-09-04'], ['4 Sep, 2025', '2025-09-04'],
    ['4 квартал 2026', null], ['2026', null], ['Ещё не объявлена', null], ['Скоро выйдет', null], ['Октябрь 2026', null], ['', null]
  ])('%s → %s', (s, want) => { expect(parseSteamDate(s)).toBe(want); });

  it('released games are out', () => {
    expect(steamRelease(steam(1030300), TODAY)).toEqual({ date: '2025-09-04', digital: null, out: true });
    expect(steamRelease(steam(1962700), TODAY)).toMatchObject({ date: '2026-05-14', out: true });
  });
  it('coming soon is not out, dated or not', () => {
    expect(steamRelease(steam(4435490), TODAY)).toEqual({ date: '2026-10-22', digital: null, out: false });
    expect(steamRelease(steam(3517740), TODAY)).toEqual({ date: null, digital: null, out: false });
    expect(steamRelease(steam(5362020), TODAY).out).toBe(false);
    expect(steamRelease(steam(1422450), TODAY).out).toBe(false);
  });
  it('coming soon with the day passed stays not out until Steam says so', () => {
    expect(steamRelease(steam(4435490), '2026-10-25').out).toBe(false);
  });
});

describe('rawgRelease (live)', () => {
  it('GTA VI is dated ahead, The Elder Scrolls VI is TBA, Ghost of Yotei is out', () => {
    expect(rawgRelease(live('rawg-game-972995.json'), TODAY)).toEqual({ date: '2026-11-19', digital: null, out: false });
    expect(rawgRelease(live('rawg-game-58781.json'), TODAY)).toEqual({ date: null, digital: null, out: false });
    expect(rawgRelease(live('rawg-game-989329.json'), TODAY)).toEqual({ date: '2025-10-02', digital: null, out: true });
  });
});

describe('releaseStatus', () => {
  it('only «В очереди» gets the badge and only the badge comes off', () => {
    expect(releaseStatus('queue', false)).toBe('unreleased');
    expect(releaseStatus('unreleased', true)).toBe('queue');
    expect(releaseStatus('in_progress', false)).toBe('in_progress');
    expect(releaseStatus('done', false)).toBe('done');
    expect(releaseStatus('queue', true)).toBe('queue');
  });
});

describe('cinemaLabel', () => {
  const film = (releaseDate: string | null, digitalDate: string | null) => ({ category: 'movie' as const, releaseDate, digitalDate });
  it('in cinemas until the digital release', () => {
    expect(cinemaLabel(film('2026-10-13', '2026-12-01'), TODAY)).toBe('Сейчас в кино');
    expect(cinemaLabel(film('2026-10-13', '2026-12-01'), '2026-12-01')).toBe('Вышло в цифре');
    expect(cinemaLabel(film('2026-10-13', '2026-12-01'), '2026-12-30')).toBe('Вышло в цифре');
    expect(cinemaLabel(film('2026-10-13', '2026-12-01'), '2026-12-31')).toBeNull();
  });
  it('no digital date: 90 days after the premiere', () => {
    expect(cinemaLabel(film('2026-09-16', null), TODAY)).toBe('Сейчас в кино');
    expect(cinemaLabel(film('2026-07-24', null), TODAY)).toBe('Сейчас в кино');
    expect(cinemaLabel(film('2026-07-23', null), TODAY)).toBeNull();
  });
  it('nothing before the premiere, nothing for games', () => {
    expect(cinemaLabel(film('2026-12-15', null), TODAY)).toBeNull();
    expect(cinemaLabel({ category: 'game', releaseDate: '2026-10-20', digitalDate: null }, TODAY)).toBeNull();
  });
});

describe('isSearchCard', () => {
  it('a title with a known source and id', () => {
    expect(isSearchCard({ source: 'tmdb-movie', sourceId: '1' })).toBe(true);
    expect(isSearchCard({ source: 'steam', sourceId: null })).toBe(false);
    expect(isSearchCard({ source: null, sourceId: null })).toBe(false);
    expect(isSearchCard({ source: 'manual', sourceId: '1' })).toBe(false);
  });
});

describe('releaseEvents and the toast', () => {
  const t = (id: string, over: Partial<Title>): Title => ({ id, title: id, category: 'movie', status: 'queue', genres: [], createdAt: '2026-09-01T10:00:00Z', ...over });
  const titles = [
    t('dune', { title: 'Дюна 3', releaseDate: '2026-10-20' }),
    t('old', { releaseDate: '2026-10-10' }),
    t('late', { releaseDate: '2026-10-20', createdAt: '2026-10-20T12:00:00Z' }),
    t('seen', { releaseDate: '2026-10-20', status: 'done' }),
    t('digital', { title: 'Майкл', releaseDate: '2026-04-22', digitalDate: '2026-10-21' }),
    t('gta', { title: 'GTA VI', category: 'game', releaseDate: '2026-10-21' }),
    t('future', { releaseDate: '2026-10-22' })
  ];
  it('what came out since the last visit, on titles added before it did and not finished', () => {
    expect(releaseEvents(titles, '2026-10-15', TODAY)).toEqual([
      { id: 'dune', title: 'Дюна 3', kind: 'cinema' }, { id: 'digital', title: 'Майкл', kind: 'digital' }, { id: 'gta', title: 'GTA VI', kind: 'game' }
    ]);
  });
  it('nothing new since today', () => { expect(releaseEvents(titles, TODAY, TODAY)).toEqual([]); });
  it('texts', () => {
    expect(releaseToast([{ id: 'dune', title: 'Дюна 3', kind: 'cinema' }])).toEqual({ text: 'Вышло в кино: Дюна 3', id: 'dune' });
    expect(releaseToast([{ id: 'm', title: 'Майкл', kind: 'digital' }])).toEqual({ text: 'Вышло в цифре: Майкл', id: 'm' });
    expect(releaseToast([{ id: 'g', title: 'GTA VI', kind: 'game' }])).toEqual({ text: 'Вышло: GTA VI', id: 'g' });
    expect(releaseToast(releaseEvents(titles, '2026-10-15', TODAY))).toEqual({ text: 'Вышло: Дюна 3 и ещё 2', id: null });
    expect(releaseToast([])).toBeNull();
  });
});

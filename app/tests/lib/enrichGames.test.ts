// Wave 3 providers (BL-91, BL-92): tall covers, Wikipedia, translation.
import { describe, expect, it } from 'vitest';
import { isLatin, opening, ruWikiSummary, sgdbTallCover, steamTallCover, translateToRu } from '../../src/lib/enrich';
import type { FetchLike } from '../../src/lib/types';

type Route = [RegExp, unknown];
function routes(list: Route[], calls: string[] = []): FetchLike {
  return (url) => {
    calls.push(url);
    const hit = list.find(([re]) => re.test(url));
    return Promise.resolve(hit
      ? { ok: true, status: 200, json: () => Promise.resolve(hit[1]) }
      : { ok: false, status: 404, json: () => Promise.resolve({}) });
  };
}
const PROXY = 'https://proxy.example/';

describe('steamTallCover', () => {
  it('the library art when it loads as a portrait picture', async () => {
    expect(await steamTallCover(620, async () => true)).toBe('https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/library_600x900.jpg');
  });
  it('null when it does not load (or loads wide)', async () => {
    expect(await steamTallCover(620, async () => false)).toBeNull();
    expect(await steamTallCover(620, async () => { throw new Error('x'); })).toBeNull();
    expect(await steamTallCover('../x', async () => true)).toBeNull();
  });
});

describe('sgdbTallCover', () => {
  const grid = { success: true, data: [{ id: 1, url: 'https://cdn2.steamgriddb.com/grid/abc.png' }] };
  it('by Steam appid first, through the proxy', async () => {
    const calls: string[] = [];
    const url = await sgdbTallCover(routes([[/grids\/steam\/990080\?dimensions=600x900/, grid]], calls), PROXY, { steamAppId: '990080', name: 'Hogwarts Legacy' });
    expect(url).toBe('https://cdn2.steamgriddb.com/grid/abc.png');
    expect(calls).toEqual([`${PROXY}https://www.steamgriddb.com/api/v2/grids/steam/990080?dimensions=600x900&types=static&nsfw=false&humor=false`]);
  });
  it('a RAWG game (no appid) is found by name', async () => {
    const url = await sgdbTallCover(routes([
      [/search\/autocomplete\/Orbitals$/, { success: true, data: [{ id: 5551, name: 'Orbitals' }] }],
      [/grids\/game\/5551\?/, grid]
    ]), PROXY, { name: 'Orbitals' });
    expect(url).toBe('https://cdn2.steamgriddb.com/grid/abc.png');
  });
  it('no grids by appid: falls back to the name', async () => {
    const url = await sgdbTallCover(routes([
      [/grids\/steam\//, { success: true, data: [] }],
      [/search\/autocomplete\//, { success: true, data: [{ id: 7, name: 'X' }] }],
      [/grids\/game\/7\?/, grid]
    ]), PROXY, { steamAppId: '1', name: 'X' });
    expect(url).toBe('https://cdn2.steamgriddb.com/grid/abc.png');
  });
  it('a proxy without the key (503) is just "nothing"', async () => {
    const fail: FetchLike = () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
    expect(await sgdbTallCover(fail, PROXY, { steamAppId: '1', name: 'X' })).toBeNull();
  });
});

describe('ruWikiSummary', () => {
  const search = (titles: string[]) => ({ query: { search: titles.map((title) => ({ title })) } });
  const extract = (title: string, text: string) => ({ query: { pages: { '1': { pageid: 1, title, extract: text } } } });
  it('the first paragraph of the article about the game', async () => {
    const text = await ruWikiSummary(routes([
      [/list=search/, search(['Bloodborne', 'FromSoftware'])],
      [/titles=Bloodborne$/, extract('Bloodborne', 'Bloodborne (англ. ) — компьютерная игра в жанре action/RPG, разработанная FromSoftware.\nВторой абзац.')]
    ]), 'Bloodborne');
    expect(text).toBe('Bloodborne — компьютерная игра в жанре action/RPG, разработанная FromSoftware.');
  });
  it('«Название (игра)» goes first', async () => {
    const calls: string[] = [];
    await ruWikiSummary(routes([
      [/list=search/, search(['Haven', 'Haven (игра)'])],
      [/titles=Haven%20\(%D0%B8%D0%B3%D1%80%D0%B0\)$/, extract('Haven (игра)', 'Haven — приключенческая ролевая игра студии The Game Bakers о паре влюблённых.')]
    ], calls), 'Haven');
    expect(calls[1]).toMatch(/titles=Haven%20\(/);
  });
  it('a film of the same name is not taken', async () => {
    const text = await ruWikiSummary(routes([
      [/list=search/, search(['Интерстеллар', 'Interstellar'])],
      [/titles=Interstellar$/, extract('Interstellar', 'Interstellar — научно-фантастический фильм Кристофера Нолана 2014 года.')]
    ]), 'Interstellar');
    expect(text).toBeNull();
  });
  it('an article with another name is not taken', async () => {
    expect(await ruWikiSummary(routes([[/list=search/, search(['Dota Underlords'])], [/prop=extracts/, extract('Dota Underlords', 'Dota Underlords — компьютерная игра.')]]), 'Dota 2')).toBeNull();
  });
  it('nothing found, or Wikipedia down: null', async () => {
    expect(await ruWikiSummary(routes([[/list=search/, search([])]]), 'Orbitals')).toBeNull();
    expect(await ruWikiSummary(routes([]), 'Orbitals')).toBeNull();
  });
});

describe('translateToRu', () => {
  const ok = (t: string) => ({ responseData: { translatedText: t, match: 0.85 }, responseStatus: 200, quotaFinished: false });
  it('direct first', async () => {
    const calls: string[] = [];
    expect(await translateToRu(routes([[/mymemory/, ok('Тёмный триллер.')]], calls), PROXY, 'A dark thriller.')).toBe('Тёмный триллер.');
    expect(calls[0]).toMatch(/^https:\/\/api\.mymemory\.translated\.net\/get\?q=A%20dark%20thriller\.&langpair=en\|ru$/);
  });
  it('a blocked direct request retries through the proxy', async () => {
    const calls: string[] = [];
    const f: FetchLike = (u) => { calls.push(u); return u.startsWith(PROXY) ? Promise.resolve({ ok: true, json: () => Promise.resolve(ok('Привет')) }) : Promise.reject(new TypeError('Failed to fetch')); };
    expect(await translateToRu(f, PROXY, 'Hello')).toBe('Привет');
    expect(calls[1]!.startsWith(PROXY)).toBe(true);
  });
  it('quota over, a warning instead of a translation, an error: null', async () => {
    expect(await translateToRu(routes([[/mymemory/, { responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY' }, responseStatus: 429, quotaFinished: true }]]), PROXY, 'Hi there')).toBeNull();
    expect(await translateToRu(routes([[/mymemory/, { responseData: { translatedText: 'QUERY LENGTH LIMIT EXCEEDED. MAX ALLOWED QUERY : 500 CHARS' }, responseStatus: 403 }]]), PROXY, 'Hi there')).toBeNull();
    expect(await translateToRu(routes([]), PROXY, 'Hi there')).toBeNull();
  });
});

it('opening(): one paragraph, cut at a sentence end under 450 characters', () => {
  const long = 'First sentence is here. '.repeat(30) + '\nSecond paragraph.';
  const o = opening(long);
  expect(o.length).toBeLessThanOrEqual(450);
  expect(o.endsWith('.')).toBe(true);
  expect(opening('### Plot\nShort one.')).toBe('Short one.');
});

it('isLatin', () => {
  expect(isLatin('Hogwarts Legacy is an immersive open-world RPG.')).toBe(true);
  expect(isLatin('Hogwarts Legacy — это ролевая игра с открытым миром.')).toBe(false);
  expect(isLatin('')).toBe(false);
});

describe('review fixes', () => {
  const search = (titles: string[]) => ({ query: { search: titles.map((title) => ({ title })) } });
  const extract = (title: string, text: string) => ({ query: { pages: { '1': { title, extract: text } } } });
  it('a film «по мотивам компьютерных игр» is not the game', async () => {
    expect(await ruWikiSummary(routes([[/list=search/, search(['Warcraft'])],
      [/prop=extracts/, extract('Warcraft', 'Warcraft (англ. Warcraft) — американский фэнтезийный фильм 2016 года по мотивам серии компьютерных игр Warcraft.')]]), 'Warcraft')).toBeNull();
  });
  it('«(англ. …)» before the dash does not cut the sentence short', async () => {
    const text = await ruWikiSummary(routes([[/list=search/, search(['Ghost of Tsushima'])],
      [/prop=extracts/, extract('Ghost of Tsushima', 'Ghost of Tsushima (с англ. Призрак Цусимы) — компьютерная игра в жанре action-adventure, разработанная Sucker Punch.')]]), 'Ghost of Tsushima');
    expect(text).toMatch(/^Ghost of Tsushima .*компьютерная игра/);
  });
  it('a sequel is another game', async () => {
    expect(await ruWikiSummary(routes([[/list=search/, search(['Hades II'])], [/prop=extracts/, extract('Hades II', 'Hades II — компьютерная игра в жанре roguelike.')]]), 'Hades')).toBeNull();
    const calls: string[] = [];
    expect(await sgdbTallCover(routes([[/autocomplete/, { success: true, data: [{ id: 1, name: 'DOOM II' }, { id: 2, name: 'DOOM' }] }],
      [/grids\/game\/2\?/, { success: true, data: [{ url: 'https://cdn2.steamgriddb.com/grid/doom.png' }] }]], calls), PROXY, { name: 'Doom' })).toBe('https://cdn2.steamgriddb.com/grid/doom.png');
    expect(await sgdbTallCover(routes([[/autocomplete/, { success: true, data: [{ id: 1, name: 'DOOM II' }] }]]), PROXY, { name: 'Doom' })).toBeNull();
  });
});

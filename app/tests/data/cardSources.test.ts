// A card from its sources (spec 3.1–3.3).
import { describe, expect, it } from 'vitest';
import { cardFor, type SourceDeps } from '../../src/data/cardSources';
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
const deps = (fetchFn: FetchLike, tall = false): SourceDeps => ({ fetchFn, proxy: 'https://p/', tmdbKey: 't', rawgKey: 'r', loadImage: async () => tall });

const steamApp = (id: string, data: Record<string, unknown>) => [new RegExp(`appdetails\\?appids=${id}&`), { [id]: { success: true, data } }] as Route;
const HOGWARTS = steamApp('990080', {
  name: 'Hogwarts Legacy', release_date: { date: '10 фев. 2023 г.' }, genres: [{ description: 'Ролевые игры' }],
  short_description: 'Hogwarts Legacy is an immersive, open-world action RPG set in the world first introduced in the Harry Potter books.',
  header_image: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/990080/header.jpg', platforms: { windows: true }
});
const RAWG_SEARCH = [/api\.rawg\.io\/api\/games\?search=/, { results: [{ id: 47, name: 'Hogwarts Legacy', released: '2023-02-10' }] }] as Route;
const RAWG_GAME = [/api\.rawg\.io\/api\/games\/47\?/, {
  id: 47, name: 'Hogwarts Legacy', released: '2023-02-10', genres: [{ name: 'RPG' }], description_raw: 'Hogwarts Legacy is an open-world action RPG.',
  background_image: 'https://media.rawg.io/media/games/044/x.jpg', platforms: [{ platform: { name: 'PC' } }, { platform: { name: 'PlayStation 5' } }]
}] as Route;

describe('a Steam game', () => {
  it('Russian text and genres from Steam, platforms from RAWG, Steam\'s tall cover', async () => {
    const card = await cardFor('steam', '620', deps(routes([
      steamApp('620', { name: 'Portal 2', release_date: { date: '18 апр. 2011 г.' }, genres: [{ description: 'Экшены' }], short_description: 'Программа вечного тестирования расширена.', header_image: 'https://x/header.jpg', platforms: { windows: true } }),
      [/search=Portal/, { results: [{ id: 2, name: 'Portal 2' }] }],
      [/api\/games\/2\?/, { id: 2, name: 'Portal 2', platforms: [{ platform: { name: 'PC' } }, { platform: { name: 'Xbox 360' } }] }]
    ]), true));
    expect(card).toMatchObject({ title: 'Portal 2', year: 2011, genres: ['Экшены'], synopsis: 'Программа вечного тестирования расширена.', platforms: ['PC', 'Xbox 360'] });
    expect(card!.cover).toMatch(/\/620\/library_600x900\.jpg$/);
  });

  it('English on Steam, Wikipedia has it: the Wikipedia text; no tall Steam art: SteamGridDB', async () => {
    const card = await cardFor('steam', '990080', deps(routes([
      HOGWARTS, RAWG_SEARCH, RAWG_GAME,
      [/grids\/steam\/990080/, { success: true, data: [{ url: 'https://cdn2.steamgriddb.com/grid/h.png' }] }],
      [/list=search/, { query: { search: [{ title: 'Hogwarts Legacy' }] } }],
      [/prop=extracts/, { query: { pages: { '9': { extract: 'Hogwarts Legacy — компьютерная ролевая игра в открытом мире по вселенной «Гарри Поттера».' } } } }]
    ])));
    expect(card!.synopsis).toBe('Hogwarts Legacy — компьютерная ролевая игра в открытом мире по вселенной «Гарри Поттера».');
    expect(card!.cover).toBe('https://cdn2.steamgriddb.com/grid/h.png');
  });

  it('no article: RAWG\'s English is machine-translated and marked', async () => {
    const card = await cardFor('steam', '990080', deps(routes([
      HOGWARTS, RAWG_SEARCH, RAWG_GAME,
      [/mymemory/, { responseData: { translatedText: 'Hogwarts Legacy — ролевая игра с открытым миром.' }, responseStatus: 200 }]
    ])));
    expect(card!.synopsis).toBe('[mt] Hogwarts Legacy — ролевая игра с открытым миром.');
    // Nothing tall anywhere: RAWG's landscape picture.
    expect(card!.cover).toBe('https://media.rawg.io/media/games/044/x.jpg');
  });

  it('no translation either: the English stays, nothing fails', async () => {
    const card = await cardFor('steam', '990080', deps(routes([HOGWARTS])));
    expect(card!.synopsis).toMatch(/^Hogwarts Legacy is an immersive/);
    expect(card!.cover).toMatch(/header\.jpg$/);
  });

  it('RAWG\'s top match with another name is not used', async () => {
    const card = await cardFor('steam', '990080', deps(routes([HOGWARTS, [/search=/, { results: [{ id: 9, name: 'Hogwarts Mystery' }] }],
      [/api\/games\/9\?/, { id: 9, name: 'Hogwarts Mystery', platforms: [{ platform: { name: 'iOS' } }] }]])));
    expect(card!.platforms).toEqual(['PC']);
  });

  it('a Steam page that does not answer: no card', async () => {
    expect(await cardFor('steam', '1', deps(routes([])))).toBeNull();
  });
});

describe('a RAWG game with a Steam version', () => {
  it('still gets a tall cover from SteamGridDB, by name', async () => {
    const card = await cardFor('rawg', '972995', deps(routes([
      [/api\/games\/972995\?/, { id: 972995, name: 'Grand Theft Auto VI', description_raw: 'Grand Theft Auto VI is an upcoming action-adventure game.', background_image: 'https://media.rawg.io/g.jpg' }],
      [/search\/autocomplete\/Grand%20Theft%20Auto%20VI/, { success: true, data: [{ id: 5 }] }],
      [/grids\/game\/5\?/, { success: true, data: [{ url: 'https://cdn2.steamgriddb.com/grid/gta.png' }] }]
    ])));
    expect(card).toMatchObject({ title: 'Grand Theft Auto VI', cover: 'https://cdn2.steamgriddb.com/grid/gta.png' });
  });
});

it('films and anime come from their one source', async () => {
  const card = await cardFor('tmdb-movie', '438631', deps(routes([[/\/3\/movie\/438631/, { id: 438631, title: 'Дюна', original_title: 'Dune', release_date: '2021-09-15', genres: [{ name: 'фантастика' }], overview: 'Наследник знаменитого дома.', poster_path: '/d.jpg' }]])));
  expect(card).toMatchObject({ title: 'Дюна', originalTitle: 'Dune', year: 2021, genres: ['фантастика'], cover: 'https://image.tmdb.org/t/p/w500/d.jpg' });
});

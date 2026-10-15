// The field table (spec 3.1, BL-93): each field from the first source with
// a good value.
import { describe, expect, it } from 'vitest';
import { assemble, good, pick, SOURCES, type SourceName } from '../../src/lib/sources';

describe('pick', () => {
  it('an empty Steam description falls through to Wikipedia', async () => {
    const card = await pick('game', { steam: { title: 'Portal 2', synopsis: '' }, wiki: { synopsis: 'Portal 2 — компьютерная игра.' } });
    expect(card.synopsis).toBe('Portal 2 — компьютерная игра.');
  });
  it('an English Steam description is not good: Wikipedia wins, English stays only as the last resort', async () => {
    const en = 'A dark detective thriller where folklore is real and violence is chilling.';
    expect((await pick('game', { steam: { synopsis: en }, wiki: { synopsis: 'Детективная игра по комиксам.' } })).synopsis).toBe('Детективная игра по комиксам.');
    expect((await pick('game', { steam: { synopsis: en } })).synopsis).toBe(en);
  });
  it('platforms come from RAWG first, Steam second', async () => {
    expect((await pick('game', { steam: { platforms: ['PC'] }, rawg: { platforms: ['PC', 'PlayStation 5'] } })).platforms).toEqual(['PC', 'PlayStation 5']);
    expect((await pick('game', { steam: { platforms: ['PC'] }, rawg: null })).platforms).toEqual(['PC']);
  });
  it('a tall cover beats the landscape ones', async () => {
    const card = await pick('game', { steam: { cover: 'https://x/header.jpg' }, rawg: { cover: 'https://media.rawg.io/a.jpg' }, sgdb: { cover: 'https://cdn2.steamgriddb.com/grid/a.png' } });
    expect(card.cover).toBe('https://cdn2.steamgriddb.com/grid/a.png');
  });
  it('a film never asks game sources', async () => {
    const asked: SourceName[] = [];
    const card = await assemble('movie', async (s) => { asked.push(s); return s === 'tmdb' ? { title: 'Дюна', year: 2021 } : { title: 'wrong' }; });
    expect(card).toMatchObject({ title: 'Дюна', year: 2021 });
    expect(new Set(asked)).toEqual(new Set(['tmdb']));
  });
  it('a provider answering null, or failing, is skipped', async () => {
    const card = await assemble('game', async (s) => {
      if (s === 'steam') return null;
      if (s === 'steamTall') throw new Error('boom');
      return s === 'rawg' ? { title: 'Orbitals', year: 2026 } : null;
    });
    expect(card).toMatchObject({ title: 'Orbitals', year: 2026 });
  });
  it('loads lazily: a Russian Steam text and a tall Steam cover ask nothing else for them', async () => {
    const asked: SourceName[] = [];
    await assemble('game', async (s) => {
      asked.push(s);
      if (s === 'steam') return { title: 'Portal 2', synopsis: 'Программа тестирования расширена.' };
      if (s === 'steamTall') return { cover: 'https://x/library_600x900_2x.jpg' };
      return null;
    });
    expect(asked).not.toContain('wiki');
    expect(asked).not.toContain('translate');
    expect(asked).not.toContain('sgdb');
  });
});

it('good(): a machine translation counts as Russian', () => {
  expect(good('synopsis', '[mt] Тёмный детективный триллер.')).toBe(true);
  expect(good('synopsis', 'Hogwarts Legacy is an immersive open-world action RPG.')).toBe(false);
  expect(good('genres', [])).toBe(false);
});

it('the table is the spec table', () => {
  expect(SOURCES.game.synopsis).toEqual(['steam', 'wiki', 'translate', 'rawg']);
  expect(SOURCES.game.cover).toEqual(['steamTall', 'sgdb', 'rawg', 'steam']);
  expect(SOURCES.anime.title).toEqual(['shikimori']);
  expect(SOURCES.series.genres).toEqual(['tmdb']);
});

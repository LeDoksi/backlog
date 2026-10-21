import { expect, it } from 'vitest';
import { buildTitle } from '../../src/data/newTitle';
import { makeId } from '../../src/lib/slug';
import type { Title } from '../../src/lib/types';

const dune: Title = { id: makeId('Дюна', 2021), title: 'Дюна', category: 'movie', status: 'queue', genres: [], year: 2021, source: 'tmdb-movie', sourceId: '438631' };

it('the same title and year is a duplicate', () => {
  expect(buildTitle('movie', 'Дюна', { title: 'Дюна', year: 2021 }, [dune])).toBe('duplicate');
});
it('the same external id is a duplicate even under another name', () => {
  expect(buildTitle('movie', 'Dune', { title: 'Dune', year: 2020, source: 'tmdb-movie', sourceId: '438631' }, [dune])).toBe('duplicate');
});
it('another year is a different title', () => {
  const t = buildTitle('movie', 'Дюна', { title: 'Дюна', year: 1984 }, [dune]) as Title;
  expect(t.id).toBe(makeId('Дюна', 1984));
  expect(t.draft).toBe(false);
});
it('a manual add without a year gets a suffix instead of clashing', () => {
  const first = buildTitle('movie', 'Дюна', {}, [{ ...dune, id: makeId('Дюна') }]) as Title;
  expect(first.id).not.toBe(makeId('Дюна'));
  expect(first.cover).toBe('images/covers/_placeholder.svg');
});
it('keeps the source of a picked hit', () => {
  const t = buildTitle('anime', 'x', { title: 'Фрирен', year: 2023, source: 'shikimori', sourceId: '52991' }, []) as Title;
  expect([t.source, t.sourceId]).toEqual(['shikimori', '52991']);
});
it('the same name and year in another category is not a duplicate', () => {
  const t = buildTitle('game', 'Дюна', { title: 'Дюна', year: 2021 }, [dune]) as Title;
  expect(t.id).not.toBe(dune.id);
  expect(t.id.startsWith(dune.id)).toBe(true);
});
it('an id a deleted title left behind is not reused', () => {
  const t = buildTitle('movie', 'Дюна', { title: 'Дюна', year: 2021 }, [], [dune.id]) as Title;
  expect(t.id).not.toBe(dune.id);
});
it('a name slugify cannot read still gets an id', () => {
  const t = buildTitle('anime', '君の名は', {}, []) as Title;
  expect(t.id).toBe('anime-title');
});

it('a film from search not out yet comes in as «Ещё не вышло», with its dates (BL-117)', () => {
  const t = buildTitle('movie', 'Дюна 3', { title: 'Дюна: Часть третья', year: 2026, source: 'tmdb-movie', sourceId: '1170608', release: { date: '2026-12-15', digital: null, out: false } }, []) as Title;
  expect(t).toMatchObject({ status: 'unreleased', releaseDate: '2026-12-15', digitalDate: null });
});
it('a game with no date at all is not out; an out film stays in the queue', () => {
  expect((buildTitle('game', 'TES 6', { title: 'TES VI', source: 'rawg', sourceId: '58781', release: { date: null, digital: null, out: false } }, []) as Title).status).toBe('unreleased');
  expect((buildTitle('movie', 'Одиссея', { title: 'Одиссея', year: 2026, source: 'tmdb-movie', sourceId: '1368337', release: { date: '2026-07-15', digital: '2026-11-17', out: true } }, []) as Title)).toMatchObject({ status: 'queue', digitalDate: '2026-11-17' });
});
it('a hand-made card and a pick whose details failed keep «В очереди»', () => {
  expect((buildTitle('movie', 'Кино', {}, []) as Title).status).toBe('queue');
  expect((buildTitle('movie', 'Кино', { title: 'Кино', source: 'tmdb-movie', sourceId: '5' }, []) as Title).status).toBe('queue');
});

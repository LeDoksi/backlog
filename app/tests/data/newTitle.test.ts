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

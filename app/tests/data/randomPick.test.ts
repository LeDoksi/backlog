import { describe, expect, it } from 'vitest';
import { randomCandidates, randomEmpty, randomLabel } from '../../src/data/randomPick';
import type { Title } from '../../src/lib/types';

const frieren: Title = { id: 'f', title: 'Фрирен', category: 'anime', status: 'in_progress', genres: [],
  parts: [{ name: 'S1' }, { name: 'S2' }, { name: 'S3', released: false }] };
const game: Title = { id: 'g', title: 'Игра', category: 'game', status: 'queue', genres: [] };
const soon: Title = { id: 'u', title: 'Скоро', category: 'movie', status: 'unreleased', genres: [] };
const done: Title = { id: 'd', title: 'Готово', category: 'movie', status: 'done', genres: [] };
const film: Title = { id: 'm', title: 'Фильм', category: 'movie', status: 'queue', genres: ['драма'] };

const none = () => [] as number[];

describe('randomCandidates', () => {
  it('skips a show whose released parts are all watched', () => {
    expect(randomCandidates([frieren], 'all', () => [0, 1])).toEqual([]);
    expect(randomCandidates([frieren], 'all', () => [0])).toEqual([frieren]);
  });
  it('skips games, unreleased and finished titles', () => {
    expect(randomCandidates([game, soon, done, film], 'all', none)).toEqual([film]);
  });
  it('respects the tab only, not genres or search', () => {
    expect(randomCandidates([frieren, film], 'movie', none)).toEqual([film]);
    expect(randomCandidates([frieren, film], 'all', none)).toHaveLength(2);
  });
  it('on the games tab picks only a game that is out and not finished', () => {
    const doneGame: Title = { ...game, id: 'g2', status: 'done' };
    const soonGame: Title = { ...game, id: 'g3', status: 'unreleased' };
    expect(randomCandidates([game, doneGame, soonGame, film], 'game', none)).toEqual([game]);
    expect(randomCandidates([doneGame, soonGame], 'game', none)).toEqual([]);
  });
  it('never picks a game on the other tabs', () => {
    expect(randomCandidates([game], 'all', none)).toEqual([]);
  });
  it('names the button and the empty note by tab', () => {
    expect(randomLabel('game')).toBe('Во что поиграть?');
    expect(randomLabel('all')).toBe('Что посмотреть?');
    expect(randomEmpty('game')).toBe('Тут всё пройдено');
    expect(randomEmpty('movie')).toBe('Тут всё посмотрено');
  });
});

import { describe, expect, it } from 'vitest';
import { byPriority, groupByKey, groupMatches, matchGroupText, statusWord, tabForStatus, titleKey } from '../../src/data/friendsOn';
import type { Match } from '../../src/lib/social';

describe('friends on titles', () => {
  it('keys a title like the server', () => {
    expect(titleKey({ id: 'batman-2022', source: 'tmdb-movie', sourceId: '414906' })).toBe('tmdb-movie:414906');
    expect(titleKey({ id: 'batman-2022', source: 'tmdb-movie', sourceId: null })).toBe('slug:batman-2022');
    expect(titleKey({ id: 'x' })).toBe('slug:x');
  });

  it('puts the friend watching first, then wanting, then finished', () => {
    const rows = [
      { title_key: 'k', friend_id: 'a', friend_name: 'Лёша', status: 'done' },
      { title_key: 'k', friend_id: 'b', friend_name: 'Вадим', status: 'queue' },
      { title_key: 'k', friend_id: 'c', friend_name: 'Даша', status: 'in_progress' }
    ];
    expect(byPriority(rows).map((r) => r.friend_name)).toEqual(['Даша', 'Вадим', 'Лёша']);
    expect(byPriority(undefined)).toEqual([]);
    expect(Object.keys(groupByKey(rows))).toEqual(['k']);
  });

  it('words and tabs', () => {
    expect(statusWord('done', 'movie')).toBe('завершено');
    expect(statusWord('in_progress', 'game')).toBe('играет');
    expect(statusWord('unreleased', 'movie')).toBe('хочет');
    expect(tabForStatus('in_progress')).toBe('watching');
    expect(tabForStatus('queue')).toBe('want');
  });

  it('matches of one title make one group, the one playing or watching first', () => {
    const m = (id: string, name: string, key: string, fr: string, my = 'queue', category = 'movie'): Match =>
      ({ friend_id: id, friend_name: name, title_key: key, title: key, category, cover: null, my_status: my, friend_status: fr });
    const groups = groupMatches([m('l', 'Лёша', 'k1', 'queue'), m('o', 'Оля', 'k2', 'queue'), m('v', 'Вадим', 'k1', 'in_progress')]);
    expect(groups.map((g) => g.title_key)).toEqual(['k1', 'k2']);
    expect(groups[0]!.friends.map((f) => f.name)).toEqual(['Вадим', 'Лёша']);
    expect(matchGroupText(groups[0]!)).toBe('Вадим смотрит, Лёша хочет');
    expect(matchGroupText(groupMatches([m('v', 'Вадим', 'g', 'in_progress', 'queue', 'game'), m('l', 'Лёша', 'g', 'queue', 'queue', 'game')])[0]!)).toBe('Вадим играет, Лёша хочет');
    expect(matchGroupText(groupMatches([m('v', 'Вадим', 'k', 'in_progress', 'in_progress')])[0]!)).toBe('Ты и Вадим оба смотрите');
    expect(matchGroupText(groupMatches([m('v', 'Вадим', 'k', 'queue')])[0]!)).toBe('Вадим хочет');
  });
});

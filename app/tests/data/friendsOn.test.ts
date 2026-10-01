import { describe, expect, it } from 'vitest';
import { byPriority, groupByKey, matchText, statusWord, tabForStatus, titleKey } from '../../src/data/friendsOn';
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

  it('match lines keep names in the nominative', () => {
    const m = (my: string, fr: string, category = 'movie'): Match => ({ friend_id: 'f', friend_name: 'Вадим', title_key: 'k', title: 'Бэтмен', category, cover: null, my_status: my, friend_status: fr });
    expect(matchText(m('queue', 'queue'))).toBe('Ты и Вадим оба хотите «Бэтмен»');
    expect(matchText(m('queue', 'in_progress'))).toBe('Вадим уже смотрит «Бэтмен»');
    expect(matchText(m('in_progress', 'queue'))).toBe('Вадим хочет «Бэтмен», а ты уже смотришь');
    expect(matchText(m('in_progress', 'in_progress', 'game'))).toBe('Ты и Вадим оба играете в «Бэтмен»');
  });
});

import { describe, expect, it } from 'vitest';
import { feedText, feedGroup, feedWhen, groupFeed, shelfTabFor, type FeedRow } from '../../src/data/feedFormat';

const row = (p: Partial<FeedRow>): FeedRow => ({
  actor_id: 'u', actor_name: 'Лёша', kind: 'completed', title_id: 't', workspace_id: 'w', title: 'Драйв', category: 'movie',
  cover: null, count: 1, covers: null, at: '2026-10-07T11:05:00Z', on_shared_board: false, ...p
});

describe('feed texts (no guessed verb gender)', () => {
  it('completed and started', () => {
    expect(feedText(row({}))).toBe('завершено «Драйв»');
    expect(feedText(row({ kind: 'started', title: 'Тед Лассо', category: 'series' }))).toBe('начато «Тед Лассо»');
  });

  it('parts decline сезон for series and anime, часть otherwise', () => {
    expect(feedText(row({ kind: 'parts', count: 1, title: 'Фрирен', category: 'anime' }))).toBe('1 сезон «Фрирен»');
    expect(feedText(row({ kind: 'parts', count: 2, title: 'Фрирен', category: 'anime' }))).toBe('2 сезона «Фрирен»');
    expect(feedText(row({ kind: 'parts', count: 5, title: 'Бойз', category: 'series' }))).toBe('5 сезонов «Бойз»');
    expect(feedText(row({ kind: 'parts', count: 2, title: 'Дюна', category: 'movie' }))).toBe('2 части «Дюна»');
  });

  it('added: one title by name, many as a count', () => {
    expect(feedText(row({ kind: 'added', count: 1, title: 'Суздаль' }))).toBe('добавлено «Суздаль»');
    expect(feedText(row({ kind: 'added', count: 12 }))).toBe('+12 тайтлов');
    expect(feedText(row({ kind: 'added', count: 21 }))).toBe('+21 тайтл');
  });
});

describe('feed grouping and times', () => {
  const now = new Date(2026, 9, 7, 18, 0); // Wed 7 Oct 2026, local time

  it('groups into today, this week (6 days back) and earlier', () => {
    expect(feedGroup(new Date(2026, 9, 7, 0, 1).toISOString(), now)).toBe('Сегодня');
    expect(feedGroup(new Date(2026, 9, 6, 23, 59).toISOString(), now)).toBe('На этой неделе');
    expect(feedGroup(new Date(2026, 9, 1, 0, 0).toISOString(), now)).toBe('На этой неделе');
    expect(feedGroup(new Date(2026, 8, 30, 23, 0).toISOString(), now)).toBe('Раньше');
  });

  it('shows the clock today, the weekday this week and the date earlier', () => {
    expect(feedWhen(new Date(2026, 9, 7, 14, 20).toISOString(), now)).toBe('14:20');
    expect(feedWhen(new Date(2026, 9, 6, 9, 0).toISOString(), now)).toBe('вторник');
    expect(feedWhen(new Date(2026, 8, 25, 9, 0).toISOString(), now)).toBe('25 сентября');
  });

  it('groupFeed keeps order and drops empty groups', () => {
    const rows = [row({ at: new Date(2026, 9, 7, 10).toISOString() }), row({ at: new Date(2026, 8, 20).toISOString() })];
    expect(groupFeed(rows, now).map((g) => [g.label, g.rows.length])).toEqual([['Сегодня', 1], ['Раньше', 1]]);
  });

  it('opens the friend shelf on the tab the event is about', () => {
    expect(shelfTabFor('completed')).toBe('done');
    expect(shelfTabFor('started')).toBe('watching');
    expect(shelfTabFor('parts')).toBe('watching');
    expect(shelfTabFor('added')).toBe('want');
  });
});

import { describe, expect, it } from 'vitest';
import { actionsText, batchFor, collapseFeed, feedText, type ActionTitle, feedGroup, feedWhen, groupFeed, shelfTabFor, type FeedRow } from '../../src/data/feedFormat';

const row = (p: Partial<FeedRow>): FeedRow => ({
  actor_id: 'u', actor_name: 'Лёша', kind: 'completed', title_id: 't', workspace_id: 'w', title: 'Драйв', category: 'movie',
  cover: null, count: 1, covers: null, at: '2026-10-07T11:05:00Z', on_shared_board: false, ...p
});

describe('feed texts (no guessed verb gender)', () => {
  it('completed and started', () => {
    expect(feedText(row({}))).toBe('завершено «Драйв»');
    expect(feedText(row({ kind: 'started', title: 'Тед Лассо', category: 'series' }))).toBe('начато «Тед Лассо»');
  });

  it('a completion carries the rating when there is one', () => {
    expect(feedText(row({ rating: 9 }))).toBe('завершено «Драйв» · оценка 9/10');
    expect(feedText(row({ rating: null }))).toBe('завершено «Драйв»');
  });

  it('parts say what was done and decline сезон for series and anime, часть otherwise', () => {
    expect(feedText(row({ kind: 'parts', count: 1, title: 'Фрирен', category: 'anime' }))).toBe('просмотрено 1 сезон «Фрирен»');
    expect(feedText(row({ kind: 'parts', count: 2, title: 'Фрирен', category: 'anime' }))).toBe('просмотрено 2 сезона «Фрирен»');
    expect(feedText(row({ kind: 'parts', count: 5, title: 'Бойз', category: 'series' }))).toBe('просмотрено 5 сезонов «Бойз»');
    expect(feedText(row({ kind: 'parts', count: 2, title: 'Ведьмак', category: 'game' }))).toBe('пройдено 2 части «Ведьмак»');
    expect(feedText(row({ kind: 'parts', count: 2, title: 'Дюна', category: 'movie' }))).toBe('просмотрено 2 части «Дюна»');
  });

  it('added: one title by name, many as a count', () => {
    expect(feedText(row({ kind: 'added', count: 1, title: 'Суздаль' }))).toBe('добавлено «Суздаль»');
    expect(feedText(row({ kind: 'added', count: 12 }))).toBe('добавлено 12 тайтлов');
    expect(feedText(row({ kind: 'added', count: 21 }))).toBe('добавлено 21 тайтл');
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

describe('a busy day folds into one line per friend', () => {
  const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString();

  it('says how many were added, started or completed in one go', () => {
    expect(feedText(row({ kind: 'started', count: 3 }))).toBe('начато 3 тайтла');
    expect(feedText(row({ kind: 'completed', count: 5, rating: 9 }))).toBe('завершено 5 тайтлов');
  });

  it('folds a friend\'s whole day, seasons included, where the latest event was', () => {
    const rows = [
      row({ kind: 'completed', title_id: 'c2', title: 'C2', cover: 'c2.jpg', at: at(7, 21), rating: 9 }),
      row({ actor_id: 'v', actor_name: 'Вадим', kind: 'started', title_id: 'v1', at: at(7, 20) }),
      row({ kind: 'parts', title_id: 'f', title: 'Фрирен', category: 'anime', count: 2, cover: 'f.jpg', at: at(7, 19) }),
      row({ kind: 'started', title_id: 'f', title: 'Фрирен', category: 'anime', cover: 'f.jpg', at: at(7, 12) }),
      row({ kind: 'parts', title_id: 'b', title: 'Бойз', category: 'series', count: 3, cover: null, at: at(7, 11) }),
      row({ kind: 'completed', title_id: 'c1', title: 'C1', cover: null, at: at(7, 10) }),
      row({ kind: 'parts', title_id: 'g', title: 'Игра', category: 'game', count: 1, cover: 'g.jpg', at: at(7, 9) })
    ];
    const out = collapseFeed(rows);
    expect(out.map((r) => [r.actor_id, r.kind])).toEqual([['u', 'day'], ['v', 'started']]);
    expect(out[1]).toBe(rows[1]);
    const day = out[0]!;
    expect(feedText(day)).toBe('начато 1 тайтл, завершено 2 тайтла, просмотрено 5 сезонов, пройдено 1 часть');
    expect(day).toMatchObject({ title_id: 'c2', at: at(7, 21), latest: 'completed', count: 5,
      title_ids: ['c2', 'f', 'b', 'c1', 'g'], covers: ['c2.jpg', 'f.jpg', null, null, 'g.jpg'] });
    expect(day.entries![1]!.actions).toEqual([{ kind: 'parts', count: 2 }, { kind: 'started', count: 1 }]);
    expect(batchFor(day)).toMatchObject({ heading: feedText(day), tab: 'done', mixed: true, ids: day.title_ids });
  });

  it('a day of one kind reads as before and leads to that shelf', () => {
    const day = collapseFeed([
      row({ kind: 'started', title_id: 's1', at: at(7, 19) }),
      row({ kind: 'started', title_id: 's0', at: at(7, 9) })
    ])[0]!;
    expect(feedText(day)).toBe('начато 2 тайтла');
    expect(batchFor(day)).toMatchObject({ tab: 'watching', mixed: false });
  });

  it('keeps different days apart', () => {
    const rows = [
      row({ kind: 'started', title_id: 'a', at: at(7, 0, 30) }),
      row({ kind: 'parts', title_id: 'b', count: 2, at: at(6, 23, 30) })
    ];
    expect(collapseFeed(rows)).toEqual(rows);
  });

  it('counts every addition, even those the server lists no cover for', () => {
    const rows = [
      row({ kind: 'added', title_id: 'a3', count: 2, covers: ['a3.jpg', 'a2.jpg'], title_ids: ['a3', 'a2'], at: at(7, 18) }),
      row({ kind: 'added', title_id: 'a1', count: 1, cover: null, covers: null, title_ids: null, at: at(7, 9) }),
      row({ kind: 'added', title_id: 'a0', count: 3, covers: null, title_ids: null, at: at(7, 8) })
    ];
    const [one, ...rest] = collapseFeed(rows);
    expect(rest).toEqual([]);
    expect(feedText(one!)).toBe('добавлено 6 тайтлов');
    expect(one).toMatchObject({ title_ids: ['a3', 'a2', 'a1'], covers: ['a3.jpg', 'a2.jpg', null] });
    expect(batchFor(one!).tab).toBe('want');
  });

  it('a line on a shared board stays marked only when every event was there', () => {
    const rows = [
      row({ kind: 'started', title_id: 'a', at: at(7, 12), on_shared_board: true }),
      row({ kind: 'started', title_id: 'b', at: at(7, 11), on_shared_board: false })
    ];
    expect(collapseFeed(rows)[0]!.on_shared_board).toBe(false);
  });
});

describe('what was done to a title on a folded day', () => {
  const t = (p: Partial<ActionTitle> = {}): ActionTitle => ({ category: 'series', parts: null, checked: [], rating: null, ...p });
  const four = [{}, {}, {}, {}];

  it('names the seasons: the last ones ticked, extras not counted', () => {
    expect(actionsText([{ kind: 'parts', count: 3 }], t({ parts: four, checked: [0, 1, 2, 3] }))).toBe('Просмотрены сезоны 2, 3, 4');
    expect(actionsText([{ kind: 'parts', count: 1 }], t({ parts: [{}, { extra: true }, {}], checked: [0, 1, 2] }))).toBe('Просмотрен сезон 2');
    expect(actionsText([{ kind: 'parts', count: 2 }], t({ category: 'movie', parts: four, checked: [0, 1] }))).toBe('Просмотрены части 1, 2');
    expect(actionsText([{ kind: 'parts', count: 1 }], t({ category: 'game', parts: four, checked: [0] }))).toBe('Пройдена часть 1');
  });

  it('says the count when the ticks do not add up', () => {
    expect(actionsText([{ kind: 'parts', count: 3 }], t({ parts: four, checked: [0] }))).toBe('Просмотрено 3 сезона');
  });

  it('puts the actions in the order they happen, with the rating', () => {
    expect(actionsText([{ kind: 'completed', count: 1 }, { kind: 'started', count: 1 }], t({ rating: 8 }))).toBe('Начато · завершено, оценка 8/10');
    expect(actionsText([{ kind: 'added', count: 1 }], t())).toBe('Добавлено');
  });
});

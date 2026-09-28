import { describe, expect, it } from 'vitest';
import { applyReviewSql, normalizeTitle, parseReview, pickUnique, reviewLine, updateSql, type Pending } from '../../tools/backfill-sources';
import type { Hit } from '../../src/data/enrichSearch';

const hit = (id: string, title: string, year: number | null, provider: Hit['provider'] = 'tmdb-movie'): Hit => ({ id, title, year, poster: '', provider });

describe('normalizeTitle', () => {
  it('ignores case, ё, punctuation, colons and dashes', () => {
    expect(normalizeTitle('Ёлки: Последние — «Новые»!')).toBe('елки последние новые');
    expect(normalizeTitle('Spider-Man: No Way Home')).toBe('spider man no way home');
    expect(normalizeTitle('  Фрирен,   провожающая в последний путь ')).toBe('фрирен провожающая в последний путь');
  });
});

describe('pickUnique', () => {
  const t: Pending = { id: 'drive-2011', title: 'Драйв', originalTitle: 'Drive', year: 2011, category: 'movie' };

  it('takes the one candidate whose name and year both match', () => {
    expect(pickUnique(t, [hit('64690', 'Драйв', 2011), hit('1', 'Драйв', 1997)])?.id).toBe('64690');
  });

  it('matches by the original title too', () => {
    expect(pickUnique(t, [hit('64690', 'Drive', 2011)])?.id).toBe('64690');
  });

  it('refuses when the year differs, when two match, or when the title has no year', () => {
    expect(pickUnique(t, [hit('1', 'Драйв', 2012)])).toBeNull();
    expect(pickUnique(t, [hit('1', 'Драйв', 2011), hit('2', 'Drive', 2011)])).toBeNull();
    expect(pickUnique({ ...t, year: null }, [hit('1', 'Драйв', null)])).toBeNull();
  });
});

describe('review file', () => {
  const t: Pending = { id: 'x-2020', title: 'Икс | два', originalTitle: null, year: 2020, category: 'series' };

  it('writes one table row per title with its candidates and an empty choice', () => {
    const line = reviewLine(t, [hit('5', 'Икс', 2020, 'tmdb-series'), hit('6', 'Икс 2', 2021, 'tmdb-series')]);
    expect(line).toBe('| x-2020 | Икс / два | 2020 | tmdb-series:5 Икс (2020) | tmdb-series:6 Икс 2 (2021) | выбор: ____ |');
  });

  it('reads back the owner’s choices, skipping blanks and «нет»', () => {
    const md = [
      '| id | название | год | кандидаты | выбор |',
      '| x-2020 | Икс | 2020 | tmdb-series:5 Икс (2020) | выбор: tmdb-series:5 |',
      '| y-2021 | Игрек | 2021 | shikimori:9 Игрек (2021) | выбор: ____ |',
      '| z-2022 | Зет | 2022 | steam:1 Зет (2022) | выбор: нет |'
    ].join('\n');
    expect(parseReview(md)).toEqual([{ id: 'x-2020', source: 'tmdb-series', sourceId: '5' }]);
  });
});

describe('SQL', () => {
  it('only fills titles that still have no source, on every board', () => {
    expect(updateSql([{ id: "it's-1", source: 'steam', sourceId: '10' }])).toBe(
      "update public.titles t set source = v.source, source_id = v.source_id from (values ('it''s-1', 'steam', '10')) as v(id, source, source_id)\n" +
      'where t.id = v.id and t.source is null;'
    );
    expect(updateSql([])).toBe('');
    expect(applyReviewSql('| a | A | 2020 | x | выбор: rawg:3 |')).toContain("('a', 'rawg', '3')");
  });
});

describe('throttled', () => {
  it('spaces calls at least 1/3 s apart', async () => {
    const { throttled } = await import('../../tools/backfill-sources');
    const waits: number[] = [];
    const f = throttled((() => Promise.resolve({ ok: true, json: () => Promise.resolve(null) })) as never, 3, (ms) => { waits.push(ms); return Promise.resolve(); });
    await Promise.all([f('a'), f('b'), f('c')]);
    expect(waits.length).toBe(2);
    expect(waits[1]! - waits[0]!).toBeGreaterThanOrEqual(333);
  });
});

import { describe, expect, it } from 'vitest';
import { buildRows, calcSql, verifyRows } from '../../tools/migrate-v2';

const WS = 'ws-1';
const base = { workspace_id: WS, genres: [], synopsis: '', cover: 'c.jpg', draft: false, airing_status: null,
  original_title: null, season_info: null, platforms: null, parts: null, rating: null, source: null, source_id: null };
const drafts = [
  { ...base, id: 'movie-2000', title: 'Movie', category: 'movie', status: 'queue', year: 2000, created_at: '2026-08-01T00:00:00Z' },
  { ...base, id: 'show-2019', title: 'Show', category: 'series', status: 'done', year: 2019, created_at: '2026-08-02T00:00:00Z',
    parts: [{ name: 'S1', released: true }, { name: 'S2', released: true }] },
  { ...base, id: 'anime-2023', title: 'Anime', category: 'anime', status: 'queue', year: 2023, created_at: '2026-08-03T00:00:00Z',
    parts: [{ name: 'S1', released: true }, { name: 'S2', released: false }] },
  { ...base, id: 'game-2011', title: 'Game', category: 'game', status: 'queue', year: 2011, created_at: '2026-08-04T00:00:00Z' },
  { ...base, id: 'rated-1999', title: 'Rated', category: 'movie', status: 'done', year: 1999, rating: 9, created_at: '2026-08-05T00:00:00Z' }
];
const nulls = { title: null, category: null, year: null, genres: null, synopsis: null, cover: null, original_title: null,
  season_info: null, platforms: null, parts: null, draft: null, rating: null, workspace_id: WS, updated_at: '2026-09-01T00:00:00Z' };
const overrides = [
  { ...nulls, id: 'movie-2000', status: 'in_progress' },
  { ...nulls, id: 'game-2011', status: null, title: 'Game GOTY', genres: ['RPG'], platforms: ['PC'], draft: true },
  { ...nulls, id: 'rated-1999', status: null, rating: 3 },
  { ...nulls, id: 'gone-1990', status: 'done' }
];
const parts = [
  { workspace_id: WS, id: 'show-2019', indices: [0], updated_at: '2026-09-10T00:00:00Z' },
  { workspace_id: WS, id: 'anime-2023', indices: [0, 0, -1, 1.5], updated_at: '2026-09-11T00:00:00Z' }
];

describe('migrate-v2', () => {
  it('builds titles rows with the client C effective state', async () => {
    const rows = await buildRows(drafts, overrides, parts);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(rows.map((r) => r.id)).toEqual(['movie-2000', 'show-2019', 'anime-2023', 'game-2011', 'rated-1999']);
    expect(by['movie-2000']).toMatchObject({ status: 'in_progress', manual_status: null, created_at: '2026-08-01T00:00:00Z', workspace_id: WS });
    // Hand-set «done» sits under the derived «in progress».
    expect(by['show-2019']).toMatchObject({ status: 'in_progress', manual_status: 'done', checked_parts: { 0: '2026-09-10T00:00:00Z' } });
    // Everything out is watched, more is announced: in progress, and the old «queue» waits underneath.
    expect(by['anime-2023']).toMatchObject({ status: 'in_progress', manual_status: 'queue', airing_status: 'ongoing', checked_parts: { 0: '2026-09-11T00:00:00Z' } });
    expect(by['game-2011']).toMatchObject({ title: 'Game GOTY', genres: ['RPG'], platforms: ['PC'], status: 'queue' });
    expect(by['game-2011']).not.toHaveProperty('draft');
    // Rating comes from drafts; the override's is dropped.
    expect(by['rated-1999']).toMatchObject({ rating: 9, status: 'done' });
  });

  it('verifyRows finds nothing when titles holds exactly the built rows', async () => {
    const rows = await buildRows(drafts, overrides, parts);
    expect(await verifyRows(drafts, overrides, parts, rows)).toEqual([]);
  });

  it('verifyRows reports missing rows, extra rows and field differences', async () => {
    const rows = await buildRows(drafts, overrides, parts);
    const tampered = rows.filter((r) => r.id !== 'game-2011').map((r) => r.id === 'show-2019' ? { ...r, checked_parts: {} } : r);
    tampered.push({ ...rows[0]!, id: 'extra-1' });
    const diffs = await verifyRows(drafts, overrides, parts, tampered);
    expect(diffs).toEqual(expect.arrayContaining([
      expect.stringContaining('game-2011: missing'),
      expect.stringContaining('extra-1: not in the old tables'),
      expect.stringContaining('show-2019: checked')
    ]));
  });

  it('calcSql lists only titles whose status the checklist decides', async () => {
    const rows = await buildRows(drafts, overrides, parts);
    const sql = calcSql(rows);
    expect(sql).toContain("('ws-1','show-2019','in_progress','done','completed')");
    expect(sql).toContain("('ws-1','anime-2023','in_progress','queue','ongoing')");
    expect(sql).not.toContain('movie-2000');
  });
});

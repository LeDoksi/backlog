import { describe, expect, it } from 'vitest';
import { checkedIndices, fromRow, patchColumns, toRow } from '../../src/lib/titleRow';
import type { Title } from '../../src/lib/types';

const title: Title = {
  id: 'show-2020', title: 'Show', category: 'series', status: 'in_progress', manualStatus: 'done',
  airingStatus: 'ongoing', year: 2020, genres: ['Драма'], synopsis: 's', cover: 'c.jpg',
  originalTitle: 'Orig', seasonInfo: 'info', platforms: null as unknown as string[], parts: [{ name: 'S1', released: true }],
  source: 'tmdb-tv', sourceId: '1', rating: 7
};

describe('titles row mapping', () => {
  it('round-trips a title and its checklist', () => {
    const row = toRow('b1', title, { 0: '2026-09-01T00:00:00Z' });
    expect(row).toMatchObject({ workspace_id: 'b1', id: 'show-2020', original_title: 'Orig', season_info: 'info',
      manual_status: 'done', airing_status: 'ongoing', source_id: '1', checked_parts: { 0: '2026-09-01T00:00:00Z' } });
    const back = fromRow({ ...row, created_at: '2026-01-01T00:00:00Z', completed_at: null, started_at: null, hidden: false });
    expect(back.title).toMatchObject(title);
    expect(back.checked).toEqual({ 0: '2026-09-01T00:00:00Z' });
  });

  it('reads checked indices sorted, ignoring junk keys', () => {
    expect(checkedIndices({ 2: 'a', 0: 'b', x: 'c', '-1': 'd' })).toEqual([0, 2]);
    expect(checkedIndices(null)).toEqual([]);
  });

  it('fills defaults for columns a row may lack', () => {
    const t = fromRow({ id: 'x', title: 'X', category: 'movie', status: 'queue' }).title;
    expect(t).toMatchObject({ genres: [], synopsis: '', parts: null, manualStatus: null, airingStatus: null, source: null, sourceId: null });
  });

  it('maps a patch to column names, only the given fields', () => {
    expect(patchColumns({ originalTitle: 'O', status: 'done', manualStatus: null, sourceId: '9' })).toEqual({
      original_title: 'O', status: 'done', manual_status: null, source_id: '9' });
  });
});

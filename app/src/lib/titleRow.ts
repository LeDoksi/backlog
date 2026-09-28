// titleRow.ts — one `titles` row ↔ the Title object the screens use.
// The checklist travels as `checked_parts`: part index → when it was ticked,
// the dates feeding «Итоги» by month and year.
import type { Title } from './types';

export type CheckedParts = Record<string, string>;

export interface TitleRow {
  workspace_id?: string;
  id: string;
  title: string;
  category: string;
  status: string;
  manual_status?: string | null;
  airing_status?: string | null;
  original_title?: string | null;
  year?: number | null;
  genres?: string[] | null;
  synopsis?: string | null;
  cover?: string | null;
  season_info?: string | null;
  platforms?: string[] | null;
  parts?: unknown[] | null;
  checked_parts?: CheckedParts | null;
  source?: string | null;
  source_id?: string | null;
  hidden?: boolean;
  rating?: number | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

// Title field → column, for the fields whose names differ.
const COLUMNS: Record<string, string> = {
  manualStatus: 'manual_status', airingStatus: 'airing_status', originalTitle: 'original_title',
  seasonInfo: 'season_info', sourceId: 'source_id', startedAt: 'started_at', completedAt: 'completed_at',
  createdAt: 'created_at'
};
// Fields a client may write. Dates belong to the titles_touch trigger.
const WRITABLE = ['title', 'category', 'status', 'manualStatus', 'airingStatus', 'originalTitle', 'year', 'genres',
  'synopsis', 'cover', 'seasonInfo', 'platforms', 'parts', 'source', 'sourceId', 'hidden', 'rating'];

export function checkedIndices(checked: CheckedParts | null | undefined): number[] {
  if (!checked || typeof checked !== 'object') return [];
  return Object.keys(checked)
    .filter((k) => /^\d+$/.test(k))
    .map(Number)
    .sort((a, b) => a - b);
}

export function fromRow(row: TitleRow): { title: Title; checked: CheckedParts } {
  const title = {
    id: row.id,
    title: row.title,
    category: row.category,
    status: row.status,
    manualStatus: row.manual_status ?? null,
    airingStatus: row.airing_status ?? null,
    originalTitle: row.original_title ?? null,
    year: row.year ?? null,
    genres: Array.isArray(row.genres) ? row.genres : [],
    synopsis: row.synopsis ?? '',
    cover: row.cover ?? undefined,
    seasonInfo: row.season_info ?? null,
    platforms: row.platforms ?? null,
    parts: row.parts ?? null,
    source: row.source ?? null,
    sourceId: row.source_id ?? null,
    hidden: !!row.hidden,
    rating: row.rating ?? null,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    createdAt: row.created_at
  } as Title;
  const checked = row.checked_parts && typeof row.checked_parts === 'object' ? { ...row.checked_parts } : {};
  return { title, checked };
}

export function patchColumns(patch: Partial<Title>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  (Object.keys(patch) as (keyof Title)[]).forEach((k) => {
    if (!WRITABLE.includes(k)) return;
    const v = patch[k];
    out[COLUMNS[k] ?? k] = v === undefined ? null : v;
  });
  return out;
}

export function toRow(boardId: string, t: Title, checked: CheckedParts): TitleRow {
  const cols = patchColumns(Object.fromEntries(WRITABLE.map((k) => [k, (t as unknown as Record<string, unknown>)[k]])) as Partial<Title>);
  return {
    ...(cols as unknown as TitleRow),
    workspace_id: boardId,
    id: t.id,
    genres: t.genres ?? [],
    synopsis: t.synopsis ?? '',
    hidden: !!t.hidden,
    checked_parts: checked
  };
}

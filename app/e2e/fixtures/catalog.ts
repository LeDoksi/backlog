import catalog from '../../tests/fixtures/catalog.json' with { type: 'json' };

// The fixture catalog as rows of the `titles` table, the shape the stub's
// `select` hands to lib/syncTitles.ts. The stub adds the board id and the
// ticked parts.
export function catalogRows(limit?: number, from = 0): Record<string, unknown>[] {
  const list = catalog.slice(from, limit === undefined ? undefined : from + limit);
  return list.map((t: Record<string, unknown>, i: number) => ({
    id: t.id, title: t.title, category: t.category, status: t.status, manual_status: null, year: t.year ?? null,
    genres: t.genres ?? [], rating: null, synopsis: 'Описание для проверки.', cover: t.cover, hidden: false,
    airing_status: t.airingStatus ?? null, original_title: t.originalTitle ?? null, season_info: null,
    platforms: t.platforms ?? null, parts: t.parts ?? null, source: null, source_id: null,
    started_at: null, completed_at: null,
    created_at: new Date(Date.UTC(2026, 0, 1, 0, from + i)).toISOString()
  }));
}

export const catalogTitles = catalog as { id: string; title: string; category: string; status: string; genres: string[]; parts?: { name: string; released?: boolean }[] }[];

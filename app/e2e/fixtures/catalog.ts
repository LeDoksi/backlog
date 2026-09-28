import catalog from '../../tests/fixtures/catalog.json' with { type: 'json' };

// The fixture catalog as rows of the `drafts` table, the shape the stub's
// `select` hands to lib/sync.ts.
export function catalogRows(limit?: number): Record<string, unknown>[] {
  const list = limit ? catalog.slice(0, limit) : catalog;
  return list.map((t: Record<string, unknown>, i: number) => ({
    id: t.id, title: t.title, category: t.category, status: t.status, year: t.year ?? null,
    genres: t.genres ?? [], rating: null, synopsis: 'Описание для проверки.', cover: t.cover, draft: false,
    airing_status: t.airingStatus ?? null, original_title: t.originalTitle ?? null, season_info: null,
    platforms: t.platforms ?? null, parts: t.parts ?? null,
    created_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()
  }));
}

export const catalogTitles = catalog as { id: string; title: string; category: string; status: string; genres: string[]; parts?: { name: string; released?: boolean }[] }[];

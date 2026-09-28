import { makeId, uniqueId } from '../lib/slug';
import type { Category, Title } from '../lib/types';

export const PLACEHOLDER_COVER = 'images/covers/_placeholder.svg';

interface Picked { title?: string; year?: number | null; genres?: string[]; synopsis?: string; cover?: string; platforms?: string[]; source?: string; sourceId?: string }

// A known year makes the id `slug-year`, the same id a re-add of the same
// title would produce, so a clash there is a real duplicate; without a year
// there is nothing to tell two entries apart by, so a suffix is added.
export function buildTitle(category: Category, typed: string, picked: Picked, existing: Title[]): Title | 'duplicate' {
  const name = (picked.title || typed).trim();
  if (picked.source && picked.sourceId && existing.some((t) => t.source === picked.source && t.sourceId === picked.sourceId)) return 'duplicate';
  const ids = existing.map((t) => t.id);
  const year = picked.year ?? null;
  const id = year != null ? makeId(name, year) : uniqueId(name, ids);
  if (year != null && ids.includes(id)) return 'duplicate';
  const t: Title = {
    id, title: name, category, status: 'queue', airingStatus: null, year,
    genres: picked.genres ?? [], rating: null, synopsis: picked.synopsis ?? '',
    cover: picked.cover || PLACEHOLDER_COVER, draft: false,
    source: picked.source ?? null, sourceId: picked.sourceId ?? null
  };
  if (category === 'game' && picked.platforms?.length) t.platforms = picked.platforms;
  return t;
}

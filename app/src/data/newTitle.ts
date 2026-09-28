import { makeId, slugify, uniqueId } from '../lib/slug';
import type { Category, Title } from '../lib/types';

export const PLACEHOLDER_COVER = 'images/covers/_placeholder.svg';

interface Picked { title?: string; year?: number | null; genres?: string[]; synopsis?: string; cover?: string; platforms?: string[]; source?: string; sourceId?: string }

// A known year makes the id `slug-year`, the same id a re-add of the same
// title would produce, so a clash with a title of the same category is a real
// duplicate; another category, or no year, gets a suffix instead. `leftover`
// are ids a deleted title left its status and checklist under: reusing one
// would bring them back, so those get a suffix too.
export function buildTitle(category: Category, typed: string, picked: Picked, existing: Title[], leftover: string[] = []): Title | 'duplicate' {
  const name = (picked.title || typed).trim();
  if (picked.source && picked.sourceId && existing.some((t) => t.source === picked.source && t.sourceId === picked.sourceId)) return 'duplicate';
  const taken = existing.map((t) => t.id).concat(leftover);
  const year = picked.year ?? null;
  // A name in a script slugify can't read (Japanese, say) still needs an id.
  const base = slugify(name) ? name : `${category} title`;
  let id = year != null ? makeId(base, year) : uniqueId(base, taken);
  if (year != null && existing.some((t) => t.id === id && t.category === category)) return 'duplicate';
  if (taken.includes(id)) id = uniqueId(`${base} ${year ?? ''}`, taken);
  const t: Title = {
    id, title: name, category, status: 'queue', airingStatus: null, year,
    genres: picked.genres ?? [], rating: null, synopsis: picked.synopsis ?? '',
    cover: picked.cover || PLACEHOLDER_COVER, draft: false,
    source: picked.source ?? null, sourceId: picked.sourceId ?? null
  };
  if (category === 'game' && picked.platforms?.length) t.platforms = picked.platforms;
  return t;
}

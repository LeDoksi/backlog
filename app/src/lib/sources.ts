// sources.ts — where each field of a title card comes from (spec 3.1,
// BL-93). Providers in lib/enrich only hand over raw fields; the card is
// put together here, the same way for search, the daily refresh and the
// one-time normalization: for every field, the first source in the table
// that has a good value.
//
// Change the order only together with the spec's table.
import { isLatin, type Details } from './enrich';
import type { Category } from './types';
import { MT_PREFIX } from './synopsis';

export type Field = 'title' | 'originalTitle' | 'synopsis' | 'cover' | 'genres' | 'year' | 'platforms';
export type SourceName = 'tmdb' | 'shikimori' | 'steam' | 'rawg' | 'steamTall' | 'sgdb' | 'wiki' | 'translate';
export type Raw = Partial<Details>;

const TMDB: Partial<Record<Field, SourceName[]>> = {
  title: ['tmdb'], originalTitle: ['tmdb'], synopsis: ['tmdb'], cover: ['tmdb'], genres: ['tmdb'], year: ['tmdb']
};

export const SOURCES: Record<Category, Partial<Record<Field, SourceName[]>>> = {
  movie: TMDB,
  series: TMDB,
  anime: { title: ['shikimori'], originalTitle: ['shikimori'], synopsis: ['shikimori'], cover: ['shikimori'], genres: ['shikimori'], year: ['shikimori'] },
  game: {
    title: ['steam', 'rawg'],
    originalTitle: ['steam', 'rawg'],
    // A Steam page with no Russian text is English: Wikipedia, then a
    // translation of RAWG's (or Steam's) English, and the English last.
    synopsis: ['steam', 'wiki', 'translate', 'rawg'],
    // Tall first; a landscape picture (RAWG, Steam's header) only when
    // nothing tall exists, and the tile then fits it on a blur.
    cover: ['steamTall', 'sgdb', 'rawg', 'steam'],
    genres: ['steam', 'rawg'],
    year: ['steam', 'rawg'],
    platforms: ['rawg', 'steam']
  }
};

export { MT_PREFIX };

function present(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/** A value worth taking as it is: a description must also be Russian. */
export function good(field: Field, v: unknown): boolean {
  if (!present(v)) return false;
  if (field === 'synopsis') return !isLatin(String(v).replace(MT_PREFIX, ''));
  return true;
}

const FIELDS: Field[] = ['title', 'originalTitle', 'year', 'genres', 'platforms', 'cover', 'synopsis'];

/**
 * The card from loaded sources: each field from the first source with a
 * good value, else the first with any value (an English description
 * beats none). `load` is asked lazily and once per source, in table order,
 * so Wikipedia is never asked about a game whose Steam page is Russian.
 */
export async function assemble(category: Category, load: (source: SourceName) => Promise<Raw | null>): Promise<Raw> {
  const table = SOURCES[category];
  const cache = new Map<SourceName, Promise<Raw | null>>();
  const get = (src: SourceName) => {
    if (!cache.has(src)) cache.set(src, load(src).catch(() => null));
    return cache.get(src)!;
  };
  const out: Raw = {};
  for (const field of FIELDS) {
    const order = table[field];
    if (!order) continue;
    let fallback: unknown;
    for (const src of order) {
      const v = (await get(src))?.[field];
      if (good(field, v)) { fallback = undefined; (out as Record<string, unknown>)[field] = v; break; }
      if (fallback === undefined && present(v)) fallback = v;
    }
    if (!(field in out) && fallback !== undefined) (out as Record<string, unknown>)[field] = fallback;
  }
  return out;
}

/** The same rule without loading: every source's raw fields already at hand. */
export function pick(category: Category, raw: Partial<Record<SourceName, Raw | null>>): Promise<Raw> {
  return assemble(category, (s) => Promise.resolve(raw[s] ?? null));
}


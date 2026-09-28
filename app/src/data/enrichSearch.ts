import * as Enrich from '../lib/enrich';
import { CORS_PROXY, RAWG_KEY, TMDB_KEY } from '../config';
import type { Category, FetchLike } from '../lib/types';

export type Provider = 'tmdb-movie' | 'tmdb-series' | 'shikimori' | 'steam' | 'rawg';
export interface Hit extends Enrich.Candidate { provider: Provider }
export type SearchResult = { ok: true; hits: Hit[] } | { ok: false; reason: 'no-fetch' | 'no-key' };

export const PROVIDER_LABEL: Record<Provider, string> = { 'tmdb-movie': 'TMDb', 'tmdb-series': 'TMDb', shikimori: 'Shikimori', steam: 'Steam', rawg: 'RAWG' };

export function providerFor(category: Category): Provider {
  if (category === 'movie') return 'tmdb-movie';
  if (category === 'series') return 'tmdb-series';
  if (category === 'anime') return 'shikimori';
  return 'steam';
}

function nativeFetch(): FetchLike | null {
  return typeof fetch === 'function' ? (fetch.bind(globalThis) as FetchLike) : null;
}

const tag = (provider: Provider) => (list: Enrich.Candidate[]): Hit[] => list.map((c) => ({ ...c, provider }));

// Never rejects: every provider call in lib/enrich already collapses failures
// to an empty list, so "offline" and "nothing found" both arrive as [].
export async function search(category: Category, query: string, fetchFn: FetchLike | null = nativeFetch()): Promise<SearchResult> {
  if (!fetchFn) return { ok: false, reason: 'no-fetch' };
  const provider = providerFor(category);
  if (provider === 'tmdb-movie' || provider === 'tmdb-series') {
    if (!TMDB_KEY) return { ok: false, reason: 'no-key' };
    return { ok: true, hits: tag(provider)(await Enrich.searchTmdb(fetchFn, CORS_PROXY, TMDB_KEY, provider === 'tmdb-series' ? 'series' : 'movie', query)) };
  }
  if (provider === 'shikimori') return { ok: true, hits: tag('shikimori')(await Enrich.searchShikimori(fetchFn, query)) };
  // Steam first for its Russian store pages; RAWG covers everything else.
  const steam = await Enrich.searchSteam(fetchFn, CORS_PROXY, query);
  if (steam.length) return { ok: true, hits: tag('steam')(steam) };
  if (!RAWG_KEY) return { ok: false, reason: 'no-key' };
  return { ok: true, hits: tag('rawg')(await Enrich.searchRawg(fetchFn, RAWG_KEY, query)) };
}

export async function details(hit: Hit, fetchFn: FetchLike | null = nativeFetch()): Promise<(Enrich.Details & { source: string; sourceId: string }) | null> {
  if (!fetchFn) return null;
  let d: Enrich.Details | null = null;
  if (hit.provider === 'tmdb-movie') d = await Enrich.fetchTmdbDetails(fetchFn, CORS_PROXY, TMDB_KEY, 'movie', hit.id);
  else if (hit.provider === 'tmdb-series') d = await Enrich.fetchTmdbDetails(fetchFn, CORS_PROXY, TMDB_KEY, 'series', hit.id);
  else if (hit.provider === 'shikimori') d = await Enrich.fetchShikimoriDetails(fetchFn, hit.id);
  else if (hit.provider === 'rawg') d = await Enrich.fetchRawgDetails(fetchFn, RAWG_KEY, hit.id);
  else if (hit.provider === 'steam') {
    d = await Enrich.fetchSteamDetails(fetchFn, CORS_PROXY, hit.id);
    // Steam reports only PC platforms; RAWG's top match fills in consoles.
    if (d && RAWG_KEY) {
      try {
        const [top] = await Enrich.searchRawg(fetchFn, RAWG_KEY, d.title);
        const rawg = top ? await Enrich.fetchRawgDetails(fetchFn, RAWG_KEY, top.id) : null;
        if (rawg?.platforms?.length) d.platforms = rawg.platforms;
      } catch { /* the supplement is best effort */ }
    }
  }
  return d ? { ...d, source: hit.provider, sourceId: String(hit.id) } : null;
}

// cardSources.ts — the card of a title from its sources (spec 3.1): what a
// search pick fills in, and what the refresh and the one-time
// normalization compare an existing title with. Network on one side
// (lib/enrich), the field table on the other (lib/sources).
import * as Enrich from '../lib/enrich';
import { assemble, MT_PREFIX, type Raw, type SourceName } from '../lib/sources';
import type { Category, FetchLike } from '../lib/types';

export interface SourceDeps {
  fetchFn: FetchLike;
  proxy: string;
  tmdbKey: string;
  rawgKey: string;
  /** Resolves true when the picture loads and is taller than wide. */
  loadImage: (url: string) => Promise<boolean>;
}

export type Card = Raw & { tmdbSeasons?: Enrich.TmdbSeasons };

/** In the browser: a portrait picture that actually loads. */
export function browserLoadImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') { resolve(false); return; }
    const img = new Image();
    const timer = setTimeout(() => resolve(false), 8000);
    img.onload = () => { clearTimeout(timer); resolve(img.naturalHeight > img.naturalWidth); };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src = url;
  });
}

const CATEGORY: Record<string, Category> = { 'tmdb-movie': 'movie', 'tmdb-series': 'series', shikimori: 'anime', steam: 'game', rawg: 'game' };

/** The source's category, or null for a source this app does not know. */
export function categoryOf(source: string | null | undefined): Category | null {
  return (source && CATEGORY[source]) || null;
}

function once<T>(f: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= f().catch(() => null as T));
}

/**
 * The assembled card of `source:sourceId`, or null when its own source
 * does not answer (nothing to build on: a removed Steam page, a dead id,
 * the network).
 */
export async function cardFor(source: string, sourceId: string, deps: SourceDeps): Promise<Card | null> {
  const { fetchFn, proxy } = deps;
  if (source === 'tmdb-movie' || source === 'tmdb-series') {
    const d = await Enrich.fetchTmdbDetails(fetchFn, proxy, deps.tmdbKey, source === 'tmdb-series' ? 'series' : 'movie', sourceId);
    if (!d) return null;
    const card: Card = await assemble(source === 'tmdb-series' ? 'series' : 'movie', (s) => Promise.resolve(s === 'tmdb' ? d : null));
    if (d.tmdbSeasons) card.tmdbSeasons = d.tmdbSeasons as Enrich.TmdbSeasons;
    return card;
  }
  if (source === 'shikimori') {
    const d = await Enrich.fetchShikimoriDetails(fetchFn, sourceId);
    return d ? assemble('anime', (s) => Promise.resolve(s === 'shikimori' ? d : null)) : null;
  }
  if (source !== 'steam' && source !== 'rawg') return null;

  const steam = once(() => (source === 'steam' ? Enrich.fetchSteamDetails(fetchFn, proxy, sourceId) : Promise.resolve(null)));
  const own = source === 'steam' ? await steam() : null;
  if (source === 'steam' && !own) return null;
  // A Steam game's RAWG entry is RAWG's top match for the name, taken only
  // when the names agree (it fills platforms, a fallback cover and text).
  const rawg = once(async () => {
    if (!deps.rawgKey) return null;
    if (source === 'rawg') return Enrich.fetchRawgDetails(fetchFn, deps.rawgKey, sourceId);
    const [top] = await Enrich.searchRawg(fetchFn, deps.rawgKey, own!.title);
    return top && Enrich.sameName(top.title, own!.title) ? Enrich.fetchRawgDetails(fetchFn, deps.rawgKey, top.id) : null;
  });
  if (source === 'rawg' && !(await rawg())) return null;
  const name = async () => own?.title || (await rawg())?.title || '';

  const loaders: Record<SourceName, () => Promise<Raw | null>> = {
    steam,
    rawg,
    steamTall: once(async () => {
      const url = source === 'steam' ? await Enrich.steamTallCover(sourceId, deps.loadImage) : null;
      return url ? { cover: url } : null;
    }),
    sgdb: once(async () => {
      const url = await Enrich.sgdbTallCover(fetchFn, proxy, { steamAppId: source === 'steam' ? sourceId : null, name: await name() });
      return url ? { cover: url } : null;
    }),
    wiki: once(async () => {
      const text = await Enrich.ruWikiSummary(fetchFn, await name());
      return text ? { synopsis: text } : null;
    }),
    translate: once(async () => {
      const english = [(await rawg())?.synopsis, own?.synopsis].find((t) => t && Enrich.isLatin(t));
      const text = english ? await Enrich.translateToRu(fetchFn, proxy, english) : null;
      return text ? { synopsis: MT_PREFIX + text } : null;
    }),
    tmdb: () => Promise.resolve(null),
    shikimori: () => Promise.resolve(null)
  };
  return assemble('game', (s) => loaders[s]());
}

import * as Enrich from '../lib/enrich';
import { CORS_PROXY, RAWG_KEY, TMDB_KEY } from '../config';
import { browserLoadImage, cardFor } from './cardSources';
import { franchiseLabel, isLoneWork, partsFromFranchise, partsFromTmdb } from '../lib/franchise';
import type { FreshPart } from '../lib/refresh';
import type { Category, FetchLike, Part } from '../lib/types';

export type Provider = 'tmdb-movie' | 'tmdb-series' | 'shikimori' | 'steam' | 'rawg';
export interface Hit extends Enrich.Candidate {
  provider: Provider;
  /** A franchise row (spec 2.3): «4 сезона, 1 фильм». */
  label?: string;
  /** Every part of the franchise, ready for the new title. */
  parts?: FreshPart[];
  /** `shiki:<id>` of every franchise entry, for «Уже в бэклоге». */
  refs?: string[];
}
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
  if (provider === 'shikimori') return { ok: true, hits: await groupByFranchise(fetchFn, tag('shikimori')(await Enrich.searchShikimori(fetchFn, query, 10))) };
  // Steam first for its Russian store pages; RAWG covers everything else.
  const steam = await Enrich.searchSteam(fetchFn, CORS_PROXY, query);
  if (steam.length) return { ok: true, hits: tag('steam')(steam) };
  if (!RAWG_KEY) return { ok: false, reason: 'no-key' };
  return { ok: true, hits: tag('rawg')(await Enrich.searchRawg(fetchFn, RAWG_KEY, query)) };
}

// What a franchise answer looked like, by any of its entries' ids: typing
// «атака» then «атака титанов» asks Shikimori once.
const franchiseCache = new Map<number, Enrich.Franchise | null>();
const ROWS = 5;
const MAX_FRANCHISE_CALLS = 3;
const SHIKIMORI_PAUSE_MS = 250;
const NOT_A_TITLE = ['music', 'cm', 'pv'];

/** Clears the franchise cache (tests). */
export function resetFranchiseCache() { franchiseCache.clear(); }

async function franchiseOf(fetchFn: FetchLike, id: number, pause: boolean): Promise<Enrich.Franchise | null> {
  if (franchiseCache.has(id)) return franchiseCache.get(id)!;
  if (pause) await new Promise((r) => setTimeout(r, SHIKIMORI_PAUSE_MS));
  const f = await Enrich.fetchShikimoriFranchise(fetchFn, id);
  // A failure is not cached: the next search tries again.
  if (f) f.nodes.forEach((n) => franchiseCache.set(n.id, f));
  return f;
}

// One row per franchise (spec 2.3): the first TV season's name and poster,
// its year, «N сезонов, M фильмов». Shikimori lists every season and film
// apart, so each franchise is asked for once, one request at a time, and
// all of its entries leave the list together. Past a few franchises the
// rest stay plain rows rather than keep Shikimori busy.
async function groupByFranchise(fetchFn: FetchLike, hits: Hit[]): Promise<Hit[]> {
  const pool = hits.filter((h) => !NOT_A_TITLE.includes(h.kind ?? ''));
  const rows: Hit[] = [];
  let calls = 0;
  while (pool.length && rows.length < ROWS) {
    const hit = pool.shift()!;
    const id = Number(hit.id);
    const cached = franchiseCache.has(id);
    const f = cached || calls < MAX_FRANCHISE_CALLS ? await franchiseOf(fetchFn, id, !cached && calls++ > 0) : null;
    const parts = f ? partsFromFranchise(f, new Date()) : [];
    if (!f || f.nodes.length < 2 || isLoneWork(parts)) { rows.push(hit); continue; }
    const ids = new Set(f.nodes.map((n) => n.id));
    const root = f.nodes.find((n) => n.id === f.rootId)!;
    const rootHit = [hit, ...pool].find((h) => Number(h.id) === root.id);
    for (let i = pool.length - 1; i >= 0; i--) if (ids.has(Number(pool[i]!.id))) pool.splice(i, 1);
    rows.push({
      ...hit,
      id: root.id,
      title: rootHit?.title || root.name,
      year: root.year ?? rootHit?.year ?? hit.year,
      poster: rootHit?.poster || root.image || hit.poster,
      kind: 'franchise',
      label: franchiseLabel(f),
      parts,
      refs: [...ids].map((n) => `shiki:${n}`)
    });
  }
  return rows;
}

/**
 * The hit is already on the board: the same source id, (anime) any entry of
 * its franchise, or (games) a game of the same name taken from another
 * source: one added from RAWG when Steam did not answer, or by hand.
 */
export function alreadyOnBoard(hit: Hit, titles: { source?: string | null; sourceId?: string | null; parts?: Part[] | null; title?: string; originalTitle?: string | null; category?: string }[]): boolean {
  const refs = new Set(hit.refs ?? (hit.provider === 'shikimori' ? [`shiki:${hit.id}`] : []));
  const game = hit.provider === 'steam' || hit.provider === 'rawg';
  return titles.some((t) => {
    if (t.source === hit.provider && t.sourceId === String(hit.id)) return true;
    if (game && t.category === 'game' && t.source !== hit.provider
      && [t.title, t.originalTitle].some((n) => !!n && Enrich.sameName(n, hit.title))) return true;
    if (!refs.size) return false;
    if (t.source === 'shikimori' && t.sourceId && refs.has(`shiki:${t.sourceId}`)) return true;
    return (t.parts ?? []).some((p) => !!p?.ref && refs.has(p.ref));
  });
}

export async function details(hit: Hit, fetchFn: FetchLike | null = nativeFetch(), loadImage: (url: string) => Promise<boolean> = browserLoadImage): Promise<(Enrich.Details & { source: string; sourceId: string; parts?: Part[] }) | null> {
  if (!fetchFn) return null;
  // Every field from its best source (spec 3.1, lib/sources).
  const d = await cardFor(hit.provider, String(hit.id), { fetchFn, proxy: CORS_PROXY, tmdbKey: TMDB_KEY, rawgKey: RAWG_KEY, loadImage }) as Enrich.Details | null;
  if (!d) return null;
  // The parts of the new title (BL-90): the franchise the row was built
  // from, or the seasons the series details already carry.
  let parts: Part[] | undefined;
  if (hit.parts?.length) parts = hit.parts.map(stripSeason);
  else if (hit.provider === 'tmdb-series' && d.tmdbSeasons) parts = partsFromTmdb((d.tmdbSeasons as Enrich.TmdbSeasons).seasons, new Date()).map(stripSeason);
  const { tmdbSeasons: _seasons, ...rest } = d;
  return { ...rest, ...(parts?.length ? { parts } : {}), source: hit.provider, sourceId: String(hit.id) } as Enrich.Details & { source: string; sourceId: string; parts?: Part[] };
}

function stripSeason({ season: _season, ...p }: FreshPart): Part { return p; }

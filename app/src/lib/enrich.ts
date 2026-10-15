// enrich.ts — search-and-pick auto-fill against TMDb (movies/series),
// Steam/RAWG (games — Steam primary, RAWG fallback and platform supplement,
// see app.js) and Shikimori (anime).
//
// Every function takes the `fetch`-like function as its first argument rather
// than reaching for the global `fetch` — same injection discipline lib/sync.js
// uses for the Supabase SDK, so tests hand in a fake and never touch the
// network. A `fetchFn` is anything shaped like `fetch`: called with a URL,
// returns a promise of `{ ok, json() }`.
//
// Nothing here ever rejects. A bad key, an offline tab, a non-200 response, a
// body that is not JSON — all of it collapses to "no results" (`[]`) for a
// search or "nothing found" (`null`) for a details fetch, exactly like
// lib/sync.js's own selectAll never lets a failed fetch become a thrown
// exception. app.js's UI layer is what turns that into the inline "не удалось
// найти" message; this module just never gives it a reason to crash.
//
// Response shapes below were confirmed against live requests (TMDb, RAWG,
// Shikimori) rather than assumed from memory.
import type { FetchLike } from './types';

// A search hit, before the owner picks one.
export interface Candidate {
  id: number | string;
  title: string;
  year: number | null;
  poster: string;
  /** Shikimori's kind (tv, movie, ova, music, cm…), where the source says. */
  kind?: string;
}

// The fields a picked hit fills in on the quick-add form.
export interface Details {
  title: string;
  /** The name the title was released under at home, where the source says. */
  originalTitle?: string;
  year: number | null;
  genres: string[];
  synopsis: string;
  cover: string;
  platforms?: string[];
  [extra: string]: unknown;
}

var MAX_CANDIDATES = 5;
var TMDB_IMG = 'https://image.tmdb.org/t/p/w500';

// Resolves to the parsed body, or null for absolutely anything that goes
// wrong: a rejected fetch, a thrown fetch, a non-ok response, a body that
// does not parse as JSON.
function safeFetch(fetchFn: any, url: string): Promise<any> {
  var result;
  try {
    result = fetchFn(url);
  } catch (e) {
    return Promise.resolve(null);
  }
  return Promise.resolve(result)
    .then(function (res) {
      if (!res || !res.ok) return null;
      return Promise.resolve(res.json()).catch(function () { return null; });
    })
    .catch(function () { return null; });
}

// Same as safeFetch, but a thrown/rejected fetch (a blocked or refused
// connection — DNS/ISP/firewall, not a legit non-2xx response from the
// API itself) gets one retry through `fallbackUrl` before giving up. A
// resolved-but-not-ok response (bad key, 404, ...) is NOT retried — the
// proxy would hit the same API with the same result. Used for TMDb, which
// some networks block outright but which normally needs no proxy,
// so the retry only fires for people who actually need it.
function safeFetchWithFallback(fetchFn: any, url: string, fallbackUrl: string | null): Promise<any> {
  var result;
  try {
    result = fetchFn(url);
  } catch (e) {
    return fallbackUrl ? safeFetch(fetchFn, fallbackUrl) : Promise.resolve(null);
  }
  return Promise.resolve(result)
    .then(function (res) {
      if (!res || !res.ok) return null;
      return Promise.resolve(res.json()).catch(function () { return null; });
    })
    .catch(function () {
      return fallbackUrl ? safeFetch(fetchFn, fallbackUrl) : null;
    });
}

function yearFromDate(dateStr: any) {
  return dateStr ? parseInt(String(dateStr).slice(0, 4), 10) : null;
}

function names(list: any) {
  return Array.isArray(list) ? list.map(function (g) { return g.name; }) : [];
}

// ── TMDb: movies/series ─────────────────────────────────────────────────

function tmdbEndpoint(category: any) { return category === 'series' ? 'tv' : 'movie'; }
function tmdbPoster(path: any) { return path ? TMDB_IMG + path : ''; }

function searchTmdb(fetchFn: FetchLike, proxyBase: string | null | undefined, key: string, category: string, query: string): Promise<Candidate[]> {
  var url = 'https://api.themoviedb.org/3/search/' + tmdbEndpoint(category) +
    '?query=' + encodeURIComponent(query) + '&api_key=' + key + '&language=ru-RU';
  return safeFetchWithFallback(fetchFn, url, proxyBase ? proxyBase + url : null).then(function (data) {
    if (!data || !Array.isArray(data.results)) return [];
    return data.results.slice(0, MAX_CANDIDATES).map(function (r: any) {
      return {
        id: r.id,
        title: r.title || r.name || '',
        year: yearFromDate(r.release_date || r.first_air_date),
        poster: tmdbPoster(r.poster_path)
      };
    });
  });
}

function fetchTmdbDetails(fetchFn: FetchLike, proxyBase: string | null | undefined, key: string, category: string, tmdbId: number | string): Promise<Details | null> {
  var url = 'https://api.themoviedb.org/3/' + tmdbEndpoint(category) + '/' + tmdbId +
    '?api_key=' + key + '&language=ru-RU';
  return safeFetchWithFallback(fetchFn, url, proxyBase ? proxyBase + url : null).then(function (d) {
    if (!d || d.id == null) return null;
    var out: Details = {
      title: d.title || d.name || '',
      originalTitle: d.original_title || d.original_name || '',
      year: yearFromDate(d.release_date || d.first_air_date),
      genres: names(d.genres),
      synopsis: d.overview || '',
      cover: tmdbPoster(d.poster_path)
    };
    // A series answer already lists its seasons: no second request on add.
    if (category === 'series' && Array.isArray(d.seasons)) out.tmdbSeasons = tmdbSeasons(d);
    return out;
  });
}

// ── TMDb seasons (wave 2) ────────────────────────────────────────────────
// Confirmed live 2026-10-14 (tests/fixtures/live/tmdb-tv-*.json): `/tv/{id}`
// carries `status` ("Ended", "Returning Series", …) and `seasons[]` with
// `season_number` (0 is «Спецматериалы»), `name` («Сезон 3»), `air_date`
// (null for an announced season with no date) and `episode_count`.
export interface TmdbSeason { number: number; name: string; year: number | null; airDate: string | null }
export interface TmdbSeasons { status: string | null; seasons: TmdbSeason[] }

function tmdbSeasons(d: any): TmdbSeasons {
  var list = Array.isArray(d.seasons) ? d.seasons : [];
  return {
    status: typeof d.status === 'string' ? d.status : null,
    seasons: list.filter(function (x: any) { return x && typeof x.season_number === 'number'; }).map(function (x: any) {
      return { number: x.season_number, name: x.name || '', year: yearFromDate(x.air_date), airDate: x.air_date || null };
    })
  };
}

function fetchTmdbSeasons(fetchFn: FetchLike, proxyBase: string | null | undefined, key: string, tvId: number | string): Promise<TmdbSeasons | null> {
  var url = 'https://api.themoviedb.org/3/tv/' + tvId + '?api_key=' + key + '&language=ru-RU';
  return safeFetchWithFallback(fetchFn, url, proxyBase ? proxyBase + url : null).then(function (d) {
    if (!d || d.id == null || !Array.isArray(d.seasons)) return null;
    return tmdbSeasons(d);
  });
}

// ── RAWG: games ──────────────────────────────────────────────────────────

function searchRawg(fetchFn: FetchLike, key: string, query: string): Promise<Candidate[]> {
  var url = 'https://api.rawg.io/api/games?search=' + encodeURIComponent(query) + '&key=' + key;
  return safeFetch(fetchFn, url).then(function (data) {
    if (!data || !Array.isArray(data.results)) return [];
    return data.results.slice(0, MAX_CANDIDATES).map(function (r: any) {
      return {
        id: r.id,
        title: r.name || '',
        year: yearFromDate(r.released),
        poster: r.background_image || ''
      };
    });
  });
}

function fetchRawgDetails(fetchFn: FetchLike, key: string, rawgId: number | string): Promise<Details | null> {
  var url = 'https://api.rawg.io/api/games/' + rawgId + '?key=' + key;
  return safeFetch(fetchFn, url).then(function (d) {
    if (!d || d.id == null) return null;
    return {
      title: d.name || '',
      originalTitle: d.name || '',
      year: yearFromDate(d.released),
      genres: names(d.genres),
      platforms: Array.isArray(d.platforms)
        ? d.platforms.map(function (p: any) { return p.platform.name; })
        : [],
      synopsis: d.description_raw || '',
      cover: d.background_image || ''
    };
  });
}

// ── Shikimori: anime ─────────────────────────────────────────────────────
//
// shikimori.one is a Russian anime-tracking site; unlike Jikan its content
// is already Russian, so — unlike the old Jikan integration — both the
// candidate list and the normalized details here carry a real `title`/
// `synopsis`. No API key, but its usage policy asks for a descriptive
// User-Agent header, and it rate-limits — shikimoriGet is the one place
// that header is attached, so every call site gets it for free.
//
// Confirmed live: search hits
// `/api/animes?search=` and returns a bare array (not `{ results: [...] }`
// like TMDb/RAWG) of `{ id, name, russian, image: { original, ... },
// aired_on, ... }`; details hits `/api/animes/{id}` and additionally
// returns `english: [...]`, `genres: [{ name, russian, ... }]` and a
// `description` that can contain BBCode-ish markup such as
// `[character=186854]Химмеля[/character]` — stripBBCode below removes just
// that ASCII `[tag]`/`[tag=value]`/`[/tag]` shape, deliberately leaving
// alone anything else in brackets (e.g. a literal Japanese name some
// descriptions include in square brackets).
//
// Base host is `shikimori.io`, not the more commonly documented
// `shikimori.one` — confirmed live that `.one` 301-redirects every request
// to `.io`, and that redirect response itself carries no
// `Access-Control-Allow-Origin` header (the final `.io` response does).
// Browsers apply the CORS check to that redirect hop, so a plain
// `fetch('https://shikimori.one/...')` fails with a CORS error even though
// the destination is fine — hitting `.io` directly skips the broken hop.

var SHIKIMORI_BASE = 'https://shikimori.io';
var SHIKIMORI_UA = 'backlog-app/1.0 (personal use)';

function shikimoriGet(fetchFn: any, url: any) {
  return safeFetch(function (u: any) {
    return fetchFn(u, { headers: { 'User-Agent': SHIKIMORI_UA } });
  }, url);
}

function shikimoriTitle(entry: any) {
  return entry.russian || entry.name || (Array.isArray(entry.english) && entry.english[0]) || '';
}

function shikimoriYear(entry: any) {
  return yearFromDate(entry.aired_on);
}

function shikimoriCover(image: any) {
  // «No picture» is a placeholder, not a cover.
  if (!image || !image.original || /\/assets\/globals\/missing/.test(image.original)) return '';
  return /^https?:\/\//.test(image.original) ? image.original : SHIKIMORI_BASE + image.original;
}

function shikimoriGenres(list: any) {
  return Array.isArray(list) ? list.map(function (g) { return g.russian || g.name; }) : [];
}

function stripBBCode(text: any) {
  return typeof text === 'string' ? text.replace(/\[\/?[a-z_]+(?:=[^\]]*)?\]/gi, '') : '';
}

function searchShikimori(fetchFn: FetchLike, query: string, limit: number = MAX_CANDIDATES): Promise<Candidate[]> {
  var url = SHIKIMORI_BASE + '/api/animes?search=' + encodeURIComponent(query) + '&limit=' + limit;
  return shikimoriGet(fetchFn, url).then(function (data) {
    if (!Array.isArray(data)) return [];
    return data.slice(0, limit).map(function (r) {
      return {
        id: r.id,
        title: shikimoriTitle(r),
        year: shikimoriYear(r),
        poster: shikimoriCover(r.image),
        kind: typeof r.kind === 'string' ? r.kind : undefined
      };
    });
  });
}

// ── Shikimori franchise (wave 2) ─────────────────────────────────────────
// Confirmed live 2026-10-14 (tests/fixtures/live/shiki-franchise-*.json):
// `/api/animes/{id}/franchise` is `{ nodes, links, current_id }`. A node is
// `{ id, date (unix seconds), name (Russian), image_url, url, year (null for
// an announcement), kind, weight }` with `kind` in Russian: «TV Сериал»,
// «TV Спецвыпуск», «Фильм», «OVA», «ONA», «Спецвыпуск», «Клип», «Реклама»,
// «Проморолик». A link is `{ source_id, target_id, relation }`, relation in
// sequel, prequel, side_story, spin_off, summary, full_story, parent_story,
// alternative_version, character, other. There is no «announced» flag: an
// announcement has `year: null` (its `date` is a placeholder) or a future
// date.
//
// The main list (spec 2.1, rule chosen on the live answers): the root is
// the franchise's earliest «TV Сериал»; main parts are the TV seasons, TV
// specials and films joined to it by sequel/prequel links — that is the
// story in order (Konosuba's film «Багровая легенда» sits between seasons 2
// and 3, Gintama's «Финал» closes it). OVAs, ONAs and specials stay extras
// even inside the chain (Re:Zero's «Memory Snow» is linked as a sequel, but
// nobody counts it as a season). Clips, ads and promos are not taken at all.
export interface FranchiseNode {
  id: number;
  name: string;
  kind: string;
  year: number | null;
  date: string | null;
  image: string;
  main: boolean;
}
export interface Franchise { rootId: number; nodes: FranchiseNode[] }

var NOT_WATCHABLE = ['Клип', 'Реклама', 'Проморолик'];
var MAIN_KINDS = ['TV Сериал', 'TV Спецвыпуск', 'Фильм'];

function franchiseFrom(data: any, askedId: number): Franchise | null {
  if (!data || !Array.isArray(data.nodes) || !data.nodes.length) return null;
  var nodes: FranchiseNode[] = data.nodes
    .filter(function (n: any) { return n && typeof n.id === 'number' && NOT_WATCHABLE.indexOf(n.kind) === -1; })
    .map(function (n: any) {
      var image = typeof n.image_url === 'string' ? n.image_url : '';
      return {
        id: n.id,
        name: typeof n.name === 'string' ? n.name : '',
        kind: typeof n.kind === 'string' ? n.kind : '',
        year: typeof n.year === 'number' ? n.year : null,
        date: typeof n.date === 'number' ? new Date(n.date * 1000).toISOString() : null,
        image: /missing/.test(image) ? '' : (/^https?:\/\//.test(image) ? image : (image ? SHIKIMORI_BASE + image : '')),
        main: false
      };
    });
  if (!nodes.length) return null;
  var byDate = function (a: FranchiseNode, b: FranchiseNode) { return (a.date || '9999').localeCompare(b.date || '9999') || a.id - b.id; };
  nodes.sort(byDate);
  var tv = nodes.filter(function (n) { return n.kind === 'TV Сериал'; });
  var root = (tv[0] || nodes.filter(function (n) { return n.id === askedId; })[0] || nodes[0]) as FranchiseNode;
  var next: Record<number, number[]> = {};
  (Array.isArray(data.links) ? data.links : []).forEach(function (l: any) {
    if (!l || (l.relation !== 'sequel' && l.relation !== 'prequel')) return;
    (next[l.source_id] = next[l.source_id] || []).push(l.target_id);
    (next[l.target_id] = next[l.target_id] || []).push(l.source_id);
  });
  var seen: Record<number, boolean> = {};
  var queue = [root.id];
  seen[root.id] = true;
  while (queue.length) {
    var id = queue.shift() as number;
    (next[id] || []).forEach(function (to) { if (!seen[to]) { seen[to] = true; queue.push(to); } });
  }
  nodes.forEach(function (n) { n.main = !!seen[n.id] && MAIN_KINDS.indexOf(n.kind) !== -1; });
  return { rootId: root.id, nodes: nodes };
}

function fetchShikimoriFranchise(fetchFn: FetchLike, id: number | string): Promise<Franchise | null> {
  var url = SHIKIMORI_BASE + '/api/animes/' + id + '/franchise';
  return shikimoriGet(fetchFn, url).then(function (d) { return franchiseFrom(d, Number(id)); });
}

function fetchShikimoriDetails(fetchFn: FetchLike, id: number | string): Promise<Details | null> {
  var url = SHIKIMORI_BASE + '/api/animes/' + id;
  return shikimoriGet(fetchFn, url).then(function (d) {
    if (!d || d.id == null) return null;
    return {
      title: shikimoriTitle(d),
      originalTitle: d.name || '',
      year: shikimoriYear(d),
      genres: shikimoriGenres(d.genres),
      synopsis: stripBBCode(d.description || ''),
      cover: shikimoriCover(d.image)
    };
  });
}

// ── Steam: games (primary; RAWG is the fallback/platform-supplement) ─────
//
// store.steampowered.com sends no `Access-Control-Allow-Origin` header on
// either endpoint used here (confirmed live — a plain browser
// `fetch` fails with "Failed to fetch" even though `curl` gets a normal
// 200), so every call is routed through a CORS relay whose base URL is
// passed in as `proxyBase` rather than hardcoded — the same "constant
// lives at the call site" discipline app.js already uses for TMDB_KEY/
// RAWG_KEY, so this module keeps working proxy-free if `proxyBase` is ever
// pointed at `''` (direct CORS support, should Valve ever add it).
//
// Confirmed live (2026-08-28, originally via `https://proxy.cors.sh/<url>` —
// that public relay later went fully dead, see app.js's CORS_PROXY comment;
// shapes below are unaffected by which relay actually sits at `proxyBase`):
// - `storesearch` returns `{ total, items: [{ id, name, tiny_image,
//   platforms: { windows, mac, linux }, ... }] }` — no release year
//   anywhere on a search hit, so `year` is `null` here and only filled in
//   by fetchSteamDetails, same "search is a thin list" pattern as every
//   other provider in this file.
// - `appdetails` returns `{ "<appid>": { success, data } }`; a bad/unknown
//   appid comes back `{ success: false }` with no `data` at all rather
//   than an HTTP error, so that has to be checked explicitly (an HTTP-level
//   failure is already handled by safeFetch below).
// - `data.release_date.date` is a localized, non-ISO string — e.g.
//   `"18 апр. 2011 г."` for a released game, `"Скоро выйдет"` ("coming
//   soon", no date at all) for an unannounced one — so year extraction
//   just looks for any 4-digit run rather than parsing a date, and quietly
//   returns `null` when there isn't one.
// - `data.genres[].description` is already the Russian genre name (the
//   `l=russian` query param this module always sends applies to it, same
//   as TMDb's `language=ru-RU`).
// - `data.detailed_description` contains raw HTML (`<br><br>`, etc.) —
//   this app renders `synopsis` via `.textContent`, so that markup would
//   show up as literal tag text. `data.short_description` is plain text
//   and was populated on every title checked, so it is what's used here;
//   the (rare) case it's empty falls back to `detailed_description` with
//   tags stripped rather than leaving the synopsis blank.
// - `data.platforms` is just `{ windows, mac, linux }` booleans — mapped
//   to a short `['PC', 'Mac', ...]` list here; app.js's RAWG platform
//   supplement is what adds real console platform names
//   for a Steam-sourced pick.

var STEAM_STORE = 'https://store.steampowered.com';

function yearFromSteamDate(dateStr: any) {
  var m = dateStr ? String(dateStr).match(/(\d{4})/) : null;
  return m ? parseInt(m[1]!, 10) : null;
}

function steamGenres(list: any) {
  return Array.isArray(list) ? list.map(function (g) { return g.description; }) : [];
}

function steamPlatforms(p: any) {
  if (!p) return [];
  var list: any[] = [];
  if (p.windows) list.push('PC');
  if (p.mac) list.push('Mac');
  if (p.linux) list.push('Linux');
  return list;
}

function stripHtml(html: any) {
  return typeof html === 'string' ? html.replace(/<[^>]*>/g, '') : '';
}

// `cc` picks the STORE REGION, not the display language — `l=russian`
// already gets Russian text on its own. `cc=RU` looked like the obvious
// choice, but Steam's Russian storefront is missing a real slice of
// Western titles (post-2022 publisher exits), and that region also filters
// *search results*, not just purchasability — "witcher 3" under cc=RU
// returned a single unrelated modding tool because the actual game isn't
// listed for that region at all. `cc=US` has no such gap and still returns
// full Russian-language text via `l=russian`.
function searchSteam(fetchFn: FetchLike, proxyBase: string, query: string): Promise<Candidate[]> {
  var url = proxyBase + STEAM_STORE + '/api/storesearch/?term=' + encodeURIComponent(query) +
    '&l=russian&cc=US';
  return safeFetch(fetchFn, url).then(function (data) {
    if (!data || !Array.isArray(data.items)) return [];
    return data.items.slice(0, MAX_CANDIDATES).map(function (item: any) {
      return {
        id: item.id,
        title: item.name || '',
        year: null,
        poster: item.tiny_image || ''
      };
    });
  });
}

function fetchSteamDetails(fetchFn: FetchLike, proxyBase: string, appid: number | string): Promise<Details | null> {
  // Same cc=US reasoning as searchSteam above — cc=RU returns
  // success:false for plenty of real, popular, region-restricted titles.
  var url = proxyBase + STEAM_STORE + '/api/appdetails?appids=' + appid + '&l=russian&cc=US';
  return safeFetch(fetchFn, url).then(function (body) {
    var entry = body && body[appid];
    if (!entry || !entry.success || !entry.data) return null;
    var d = entry.data;
    return {
      title: d.name || '',
      originalTitle: d.name || '',
      year: yearFromSteamDate(d.release_date && d.release_date.date),
      genres: steamGenres(d.genres),
      synopsis: d.short_description || stripHtml(d.detailed_description || ''),
      cover: d.header_image || '',
      platforms: steamPlatforms(d.platforms)
    };
  });
}

// ── Wave 3: tall game covers, Russian descriptions (BL-91, BL-92) ────────
//
// The cover slot is 2:3 and Steam's `header_image` is 460×215, so a game's
// cover is looked for in this order (spec 3.1, 3.2): Steam's library art
// (600×900), then SteamGridDB, and only then a landscape picture.

var STEAM_ASSETS = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/';

/** Steam's own tall cover, when the image actually loads as a portrait picture. */
async function steamTallCover(appid: number | string, loadImage: (url: string) => Promise<boolean>): Promise<string | null> {
  if (!/^\d+$/.test(String(appid))) return null;
  // The plain library_600x900.jpg is really 300×450; the _2x one is the
  // full 600×900 (checked live 2026-10-15: 45 of 58 games have it, a
  // missing one is a 404 with no placeholder picture).
  var url = STEAM_ASSETS + appid + '/library_600x900_2x.jpg';
  try {
    return (await loadImage(url)) ? url : null;
  } catch (e) {
    return null;
  }
}

var SGDB_API = 'https://www.steamgriddb.com/api/v2';

function firstGrid(body: any): string | null {
  if (!body || body.success === false || !Array.isArray(body.data)) return null;
  var hit = body.data.find(function (g: any) { return g && typeof g.url === 'string' && /^https:\/\//.test(g.url); });
  return hit ? hit.url : null;
}

/**
 * SteamGridDB's first tall grid (600×900), by Steam appid when the game has
 * one, else by name. Goes through the proxy, which adds the key; a proxy
 * without the key answers 503, which lands here as "nothing found".
 */
async function sgdbTallCover(fetchFn: FetchLike, proxyBase: string, query: { steamAppId?: string | null; name: string }): Promise<string | null> {
  var grids = '?dimensions=600x900&types=static&nsfw=false&humor=false';
  if (query.steamAppId && /^\d+$/.test(query.steamAppId)) {
    var bySteam = firstGrid(await safeFetch(fetchFn, proxyBase + SGDB_API + '/grids/steam/' + query.steamAppId + grids));
    if (bySteam) return bySteam;
  }
  if (!query.name || !query.name.trim()) return null;
  var found = await safeFetch(fetchFn, proxyBase + SGDB_API + '/search/autocomplete/' + encodeURIComponent(query.name.trim()));
  // Only a game of exactly this name: «Doom» is not «DOOM II».
  var game = found && Array.isArray(found.data)
    ? found.data.find(function (g: any) { return g && typeof g.name === 'string' && sameName(g.name, query.name); })
    : null;
  if (!game || game.id == null) return null;
  return firstGrid(await safeFetch(fetchFn, proxyBase + SGDB_API + '/grids/game/' + game.id + grids));
}

// Letters only: «Hogwarts Legacy — это…» is Russian, a Latin description
// with one Russian word is not.
function isLatin(text: string): boolean {
  var letters = (text || '').match(/\p{L}/gu) || [];
  if (!letters.length) return false;
  var latin = letters.filter(function (c) { return /[A-Za-z]/.test(c); }).length;
  return latin / letters.length > 0.6;
}

export function sameName(a: string, b: string): boolean {
  var norm = function (x: string) {
    return x.replace(/\s*\([^)]*\)\s*$/, '').replace(/[™®©]/g, '').toLowerCase().replace(/[ё]/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  };
  var x = norm(a);
  var y = norm(b);
  // Exact: «Hades II» or «Portal 2» is another game than «Hades» or «Portal».
  return !!x && x === y;
}

var RU_WIKI = 'https://ru.wikipedia.org/w/api.php';

// The first sentence says what the article is: «… — компьютерная игра»,
// «… — видеоигра». A film or a book «по мотивам компьютерных игр» names a
// film or a book first, and the plural «игр» is not «игра».
function aboutAGame(paragraph: string): boolean {
  var sentence = paragraph.replace(/\([^)]*\)/g, '').split(/[.!?]\s+(?=[А-ЯЁA-Z])/)[0] || '';
  var m = /(?<!\p{L})(?:видео)?игр[аыу](?!\p{L})|видеоигр[аыу]?(?!\p{L})/iu.exec(sentence);
  if (!m) return false;
  return !/(?<!\p{L})(?:фильм|кинофильм|мультфильм|роман|повесть|книга|сериал|телесериал|комикс|манга|аниме)(?!\p{L})/iu.test(sentence.slice(0, m.index));
}

/**
 * The first paragraph of the Russian Wikipedia article about the game
 * (spec 3.3), or null. An article counts only when its title is the game's
 * name and it is about a game: «(игра)» in the title or «игр…» in the first
 * paragraph, so a film or a book of the same name is never taken.
 * Wikipedia answers browsers directly with `origin=*`.
 */
async function ruWikiSummary(fetchFn: FetchLike, name: string): Promise<string | null> {
  if (!name || !name.trim()) return null;
  var found = await safeFetch(fetchFn, RU_WIKI + '?action=query&list=search&srsearch=' + encodeURIComponent(name.trim() + ' игра') +
    '&srlimit=5&format=json&origin=*');
  var hits = found && found.query && Array.isArray(found.query.search) ? found.query.search : [];
  var titles: string[] = hits.map(function (h: any) { return String(h.title || ''); })
    .filter(function (t: string) { return sameName(t, name); });
  // «Название (игра)» first.
  titles.sort(function (a, b) { return Number(/\(.*игр/i.test(b)) - Number(/\(.*игр/i.test(a)); });
  for (var i = 0; i < Math.min(titles.length, 2); i++) {
    var title = titles[i]!;
    var page = await safeFetch(fetchFn, RU_WIKI + '?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json&origin=*&titles=' +
      encodeURIComponent(title));
    var pages = page && page.query && page.query.pages ? Object.keys(page.query.pages).map(function (k) { return page.query.pages[k]; }) : [];
    var extract = pages[0] && typeof pages[0].extract === 'string' ? pages[0].extract : '';
    var first = extract.split('\n').map(function (l: string) { return l.trim(); }).filter(Boolean)[0] || '';
    // Pronunciation and stress leftovers: «( )», «(англ. )», doubled spaces.
    first = first.replace(/́/g, '').replace(/\s*\((?:[а-яё]+\.\s*)?[;,]?\s*\)/gi, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
    if (!first || first.length < 40) continue;
    if (/\(.*игр/i.test(title) || aboutAGame(first)) return first;
  }
  return null;
}

var MYMEMORY = 'https://api.mymemory.translated.net/get';
var TRANSLATE_MAX = 450;

/** The opening of a long description, cut at a sentence end, short enough for one free request. */
function opening(text: string): string {
  var para = (text || '').split(/\n+/).map(function (l) { return l.trim(); })
    .filter(function (l) { return l && !/^#/.test(l); })[0] || '';
  if (para.length <= TRANSLATE_MAX) return para;
  var cut = para.slice(0, TRANSLATE_MAX);
  var end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > 80 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…';
}

/**
 * English → Russian through MyMemory (free, no key, a daily limit). Null when the service is out of quota or says anything but
 * a translation, so the English text simply stays (spec 3.3).
 */
async function translateToRu(fetchFn: FetchLike, proxyBase: string, text: string): Promise<string | null> {
  var q = opening(text);
  if (!q) return null;
  // Direct first: the free quota is per address, and the proxy's address is
  // shared with everyone else on Cloudflare. A blocked request (CORS,
  // network) gets one retry through the proxy.
  var url = MYMEMORY + '?q=' + encodeURIComponent(q) + '&langpair=en|ru';
  var body = await safeFetchWithFallback(fetchFn, url, proxyBase ? proxyBase + url : null);
  if (!body || Number(body.responseStatus) !== 200 || body.quotaFinished) return null;
  var out = body.responseData && typeof body.responseData.translatedText === 'string' ? body.responseData.translatedText.trim() : '';
  if (!out || /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(out) || isLatin(out)) return null;
  return out;
}

export {
  steamTallCover,
  sgdbTallCover,
  ruWikiSummary,
  translateToRu,
  isLatin,
  opening,
  searchTmdb,
  fetchTmdbDetails,
  searchRawg,
  fetchRawgDetails,
  searchShikimori,
  fetchShikimoriDetails,
  fetchShikimoriFranchise,
  fetchTmdbSeasons,
  searchSteam,
  fetchSteamDetails
};

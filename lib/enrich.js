// lib/enrich.js — search-and-pick auto-fill against TMDb (movies/series),
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
// Shikimori) — see the Task 40/42 verification notes — rather than assumed
// from memory.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BacklogEnrich = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  var MAX_CANDIDATES = 5;
  var TMDB_IMG = 'https://image.tmdb.org/t/p/w500';

  // Resolves to the parsed body, or null for absolutely anything that goes
  // wrong: a rejected fetch, a thrown fetch, a non-ok response, a body that
  // does not parse as JSON.
  function safeFetch(fetchFn, url) {
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

  function yearFromDate(dateStr) {
    return dateStr ? parseInt(String(dateStr).slice(0, 4), 10) : null;
  }

  function names(list) {
    return Array.isArray(list) ? list.map(function (g) { return g.name; }) : [];
  }

  // ── TMDb: movies/series ─────────────────────────────────────────────────

  function tmdbEndpoint(category) { return category === 'series' ? 'tv' : 'movie'; }
  function tmdbPoster(path) { return path ? TMDB_IMG + path : ''; }

  function searchTmdb(fetchFn, key, category, query) {
    var url = 'https://api.themoviedb.org/3/search/' + tmdbEndpoint(category) +
      '?query=' + encodeURIComponent(query) + '&api_key=' + key + '&language=ru-RU';
    return safeFetch(fetchFn, url).then(function (data) {
      if (!data || !Array.isArray(data.results)) return [];
      return data.results.slice(0, MAX_CANDIDATES).map(function (r) {
        return {
          id: r.id,
          title: r.title || r.name || '',
          year: yearFromDate(r.release_date || r.first_air_date),
          poster: tmdbPoster(r.poster_path)
        };
      });
    });
  }

  function fetchTmdbDetails(fetchFn, key, category, tmdbId) {
    var url = 'https://api.themoviedb.org/3/' + tmdbEndpoint(category) + '/' + tmdbId +
      '?api_key=' + key + '&language=ru-RU';
    return safeFetch(fetchFn, url).then(function (d) {
      if (!d || d.id == null) return null;
      return {
        title: d.title || d.name || '',
        year: yearFromDate(d.release_date || d.first_air_date),
        genres: names(d.genres),
        synopsis: d.overview || '',
        cover: tmdbPoster(d.poster_path)
      };
    });
  }

  // ── RAWG: games ──────────────────────────────────────────────────────────

  function searchRawg(fetchFn, key, query) {
    var url = 'https://api.rawg.io/api/games?search=' + encodeURIComponent(query) + '&key=' + key;
    return safeFetch(fetchFn, url).then(function (data) {
      if (!data || !Array.isArray(data.results)) return [];
      return data.results.slice(0, MAX_CANDIDATES).map(function (r) {
        return {
          id: r.id,
          title: r.name || '',
          year: yearFromDate(r.released),
          poster: r.background_image || ''
        };
      });
    });
  }

  function fetchRawgDetails(fetchFn, key, rawgId) {
    var url = 'https://api.rawg.io/api/games/' + rawgId + '?key=' + key;
    return safeFetch(fetchFn, url).then(function (d) {
      if (!d || d.id == null) return null;
      return {
        title: d.name || '',
        year: yearFromDate(d.released),
        genres: names(d.genres),
        platforms: Array.isArray(d.platforms)
          ? d.platforms.map(function (p) { return p.platform.name; })
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
  // Confirmed live (see Task 42 verification): search hits
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

  function shikimoriGet(fetchFn, url) {
    return safeFetch(function (u) {
      return fetchFn(u, { headers: { 'User-Agent': SHIKIMORI_UA } });
    }, url);
  }

  function shikimoriTitle(entry) {
    return entry.russian || entry.name || (Array.isArray(entry.english) && entry.english[0]) || '';
  }

  function shikimoriYear(entry) {
    return yearFromDate(entry.aired_on);
  }

  function shikimoriCover(image) {
    if (!image || !image.original) return '';
    return /^https?:\/\//.test(image.original) ? image.original : SHIKIMORI_BASE + image.original;
  }

  function shikimoriGenres(list) {
    return Array.isArray(list) ? list.map(function (g) { return g.russian || g.name; }) : [];
  }

  function stripBBCode(text) {
    return typeof text === 'string' ? text.replace(/\[\/?[a-z_]+(?:=[^\]]*)?\]/gi, '') : '';
  }

  function searchShikimori(fetchFn, query) {
    var url = SHIKIMORI_BASE + '/api/animes?search=' + encodeURIComponent(query) + '&limit=' + MAX_CANDIDATES;
    return shikimoriGet(fetchFn, url).then(function (data) {
      if (!Array.isArray(data)) return [];
      return data.slice(0, MAX_CANDIDATES).map(function (r) {
        return {
          id: r.id,
          title: shikimoriTitle(r),
          year: shikimoriYear(r),
          poster: shikimoriCover(r.image)
        };
      });
    });
  }

  function fetchShikimoriDetails(fetchFn, id) {
    var url = SHIKIMORI_BASE + '/api/animes/' + id;
    return shikimoriGet(fetchFn, url).then(function (d) {
      if (!d || d.id == null) return null;
      return {
        title: shikimoriTitle(d),
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
  // either endpoint used here (confirmed live for Task 45 — a plain browser
  // `fetch` fails with "Failed to fetch" even though `curl` gets a normal
  // 200), so every call is routed through a CORS relay whose base URL is
  // passed in as `proxyBase` rather than hardcoded — the same "constant
  // lives at the call site" discipline app.js already uses for TMDB_KEY/
  // RAWG_KEY, so this module keeps working proxy-free if `proxyBase` is ever
  // pointed at `''` (direct CORS support, should Valve ever add it).
  //
  // Confirmed live (2026-08-28, via `https://proxy.cors.sh/<url>`, which
  // still works with no API key):
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
  //   supplement (Task 45 Step 3) is what adds real console platform names
  //   for a Steam-sourced pick.

  var STEAM_STORE = 'https://store.steampowered.com';

  function yearFromSteamDate(dateStr) {
    var m = dateStr ? String(dateStr).match(/(\d{4})/) : null;
    return m ? parseInt(m[1], 10) : null;
  }

  function steamGenres(list) {
    return Array.isArray(list) ? list.map(function (g) { return g.description; }) : [];
  }

  function steamPlatforms(p) {
    if (!p) return [];
    var list = [];
    if (p.windows) list.push('PC');
    if (p.mac) list.push('Mac');
    if (p.linux) list.push('Linux');
    return list;
  }

  function stripHtml(html) {
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
  function searchSteam(fetchFn, proxyBase, query) {
    var url = proxyBase + STEAM_STORE + '/api/storesearch/?term=' + encodeURIComponent(query) +
      '&l=russian&cc=US';
    return safeFetch(fetchFn, url).then(function (data) {
      if (!data || !Array.isArray(data.items)) return [];
      return data.items.slice(0, MAX_CANDIDATES).map(function (item) {
        return {
          id: item.id,
          title: item.name || '',
          year: null,
          poster: item.tiny_image || ''
        };
      });
    });
  }

  function fetchSteamDetails(fetchFn, proxyBase, appid) {
    // Same cc=US reasoning as searchSteam above — cc=RU returns
    // success:false for plenty of real, popular, region-restricted titles.
    var url = proxyBase + STEAM_STORE + '/api/appdetails?appids=' + appid + '&l=russian&cc=US';
    return safeFetch(fetchFn, url).then(function (body) {
      var entry = body && body[appid];
      if (!entry || !entry.success || !entry.data) return null;
      var d = entry.data;
      return {
        title: d.name || '',
        year: yearFromSteamDate(d.release_date && d.release_date.date),
        genres: steamGenres(d.genres),
        synopsis: d.short_description || stripHtml(d.detailed_description || ''),
        cover: d.header_image || '',
        platforms: steamPlatforms(d.platforms)
      };
    });
  }

  return {
    searchTmdb: searchTmdb,
    fetchTmdbDetails: fetchTmdbDetails,
    searchRawg: searchRawg,
    fetchRawgDetails: fetchRawgDetails,
    searchShikimori: searchShikimori,
    fetchShikimoriDetails: fetchShikimoriDetails,
    searchSteam: searchSteam,
    fetchSteamDetails: fetchSteamDetails
  };
}));

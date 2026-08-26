// lib/enrich.js — search-and-pick auto-fill against TMDb (movies/series), RAWG
// (games) and Jikan (anime).
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
// Response shapes below were confirmed against live requests (TMDb, RAWG) —
// see the Task 40 verification notes — rather than assumed from memory. Jikan's
// search endpoint (`/v4/anime?q=`) was down (504, MAL unreachable) at
// verification time; its shape is taken from the `/v4/anime/{id}` endpoint,
// which *did* answer live and — per Jikan's own v4 contract — wraps the same
// object shape, just under `data: [...]` instead of `data: {...}`.
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

  // ── Jikan: anime ─────────────────────────────────────────────────────────
  //
  // No `title`/`synopsis` in either normalized shape here — Jikan's strings
  // are English/romaji and this catalog's titles are Russian for everything
  // but games (see README/Task 40 plan notes). The candidate list below still
  // carries a display title (English/romaji is fine for telling two search
  // results apart in a picker) but fetchJikanDetails deliberately drops it.

  function jikanCover(images) {
    return (images && images.jpg && (images.jpg.large_image_url || images.jpg.image_url)) || '';
  }

  function jikanYear(entry) {
    if (entry.year) return entry.year;
    return yearFromDate(entry.aired && entry.aired.from);
  }

  function searchJikan(fetchFn, query) {
    var url = 'https://api.jikan.moe/v4/anime?q=' + encodeURIComponent(query) + '&limit=' + MAX_CANDIDATES;
    return safeFetch(fetchFn, url).then(function (body) {
      if (!body || !Array.isArray(body.data)) return [];
      return body.data.slice(0, MAX_CANDIDATES).map(function (r) {
        return {
          id: r.mal_id,
          title: r.title_english || r.title || '',
          year: jikanYear(r),
          poster: jikanCover(r.images)
        };
      });
    });
  }

  function fetchJikanDetails(fetchFn, malId) {
    var url = 'https://api.jikan.moe/v4/anime/' + malId;
    return safeFetch(fetchFn, url).then(function (body) {
      var d = body && body.data;
      if (!d || d.mal_id == null) return null;
      return {
        year: jikanYear(d),
        genres: names(d.genres),
        cover: jikanCover(d.images)
      };
    });
  }

  return {
    searchTmdb: searchTmdb,
    fetchTmdbDetails: fetchTmdbDetails,
    searchRawg: searchRawg,
    fetchRawgDetails: fetchRawgDetails,
    searchJikan: searchJikan,
    fetchJikanDetails: fetchJikanDetails
  };
}));

// tests/enrich.test.js
//
// Every test hands in a fake `fetchFn` — a function returning canned
// `{ ok, json: () => Promise.resolve(...) }` responses shaped like the real
// TMDb/RAWG bodies confirmed live during Task 40 and the real Shikimori
// bodies confirmed live during Task 42 (see lib/enrich.js's header comment).
// No real network calls. Same discipline as tests/sync.test.js faking the
// Supabase client.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  searchTmdb, fetchTmdbDetails,
  searchRawg, fetchRawgDetails,
  searchShikimori, fetchShikimoriDetails
} = require('../lib/enrich.js');

function okJson(body) {
  return function () {
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve(body); } });
  };
}

function httpError(status) {
  return function () {
    return Promise.resolve({ ok: false, status: status, json: function () { return Promise.resolve({}); } });
  };
}

function networkError() {
  return function () {
    return Promise.reject(new Error('network down'));
  };
}

// ── TMDb ─────────────────────────────────────────────────────────────────

test('searchTmdb normalizes a movie search result', async () => {
  var fetchFn = okJson({
    results: [
      { id: 346698, title: 'Барби', release_date: '2023-07-19', poster_path: '/kau707eF6UBvrHX3v5BSYckqSXm.jpg' }
    ]
  });
  var candidates = await searchTmdb(fetchFn, 'k', 'movie', 'barbie');
  assert.deepEqual(candidates, [
    { id: 346698, title: 'Барби', year: 2023, poster: 'https://image.tmdb.org/t/p/w500/kau707eF6UBvrHX3v5BSYckqSXm.jpg' }
  ]);
});

test('searchTmdb caps candidates at 5', async () => {
  var results = [];
  for (var i = 0; i < 8; i++) results.push({ id: i, title: 'T' + i, release_date: '2020-01-01', poster_path: null });
  var candidates = await searchTmdb(okJson({ results: results }), 'k', 'movie', 'x');
  assert.equal(candidates.length, 5);
});

test('searchTmdb resolves to [] on an HTTP error', async () => {
  assert.deepEqual(await searchTmdb(httpError(401), 'bad-key', 'movie', 'x'), []);
});

test('searchTmdb resolves to [] on a network failure', async () => {
  assert.deepEqual(await searchTmdb(networkError(), 'k', 'movie', 'x'), []);
});

test('fetchTmdbDetails normalizes a tv details response', async () => {
  var fetchFn = okJson({
    id: 76479,
    name: 'Пацаны',
    first_air_date: '2019-07-25',
    genres: [{ id: 10765, name: 'НФ и Фэнтези' }, { id: 10759, name: 'Боевик и Приключения' }],
    overview: 'Отряд мстителей без суперсил.',
    poster_path: '/3NqlBDpWI83TgQ9nmeFwTVxEmtZ.jpg'
  });
  var details = await fetchTmdbDetails(fetchFn, 'k', 'series', 76479);
  assert.deepEqual(details, {
    title: 'Пацаны',
    year: 2019,
    genres: ['НФ и Фэнтези', 'Боевик и Приключения'],
    synopsis: 'Отряд мстителей без суперсил.',
    cover: 'https://image.tmdb.org/t/p/w500/3NqlBDpWI83TgQ9nmeFwTVxEmtZ.jpg'
  });
});

test('fetchTmdbDetails resolves to null on a 404', async () => {
  assert.equal(await fetchTmdbDetails(httpError(404), 'k', 'movie', 999999), null);
});

// ── RAWG ─────────────────────────────────────────────────────────────────

test('searchRawg normalizes a game search result', async () => {
  var fetchFn = okJson({
    results: [
      { id: 324997, name: "Baldur's Gate III", released: '2023-08-03', background_image: 'https://media.rawg.io/x.jpg' }
    ]
  });
  var candidates = await searchRawg(fetchFn, 'k', 'baldurs gate 3');
  assert.deepEqual(candidates, [
    { id: 324997, title: "Baldur's Gate III", year: 2023, poster: 'https://media.rawg.io/x.jpg' }
  ]);
});

test('searchRawg resolves to [] when the response has no results array', async () => {
  assert.deepEqual(await searchRawg(okJson({}), 'k', 'x'), []);
});

test('searchRawg resolves to [] on a network failure', async () => {
  assert.deepEqual(await searchRawg(networkError(), 'k', 'x'), []);
});

test('fetchRawgDetails normalizes a game details response', async () => {
  var fetchFn = okJson({
    id: 324997,
    name: "Baldur's Gate III",
    released: '2023-08-03',
    genres: [{ id: 3, name: 'Adventure' }, { id: 5, name: 'RPG' }],
    platforms: [{ platform: { id: 4, name: 'PC' } }, { platform: { id: 187, name: 'PlayStation 5' } }],
    description_raw: 'Gather your party.',
    background_image: 'https://media.rawg.io/x.jpg'
  });
  var details = await fetchRawgDetails(fetchFn, 'k', 324997);
  assert.deepEqual(details, {
    title: "Baldur's Gate III",
    year: 2023,
    genres: ['Adventure', 'RPG'],
    platforms: ['PC', 'PlayStation 5'],
    synopsis: 'Gather your party.',
    cover: 'https://media.rawg.io/x.jpg'
  });
});

test('fetchRawgDetails resolves to null on an HTTP error', async () => {
  assert.equal(await fetchRawgDetails(httpError(403), 'bad-key', 324997), null);
});

// ── Shikimori ────────────────────────────────────────────────────────────
//
// Shapes below are trimmed copies of real responses from
// `https://shikimori.io/api/animes?search=frieren&limit=5` and
// `https://shikimori.io/api/animes/52991` (lib/enrich.js hits `.io` directly
// rather than the commonly-documented `.one`, which 301-redirects to `.io`
// via a CORS-header-less hop — see lib/enrich.js's header comment), confirmed
// live during Task 42 (a bare array from search — not `{ results: [...] }`
// like TMDb/RAWG — and Russian `russian`/`genres[].russian`/`description`
// fields already populated, unlike Jikan).

test('searchShikimori normalizes an anime search result (bare array response)', async () => {
  var fetchFn = okJson([
    {
      id: 52991,
      name: 'Sousou no Frieren',
      russian: 'Провожающая в последний путь Фрирен',
      image: { original: '/system/animes/original/52991.jpg?1710731127' },
      kind: 'tv',
      aired_on: '2023-09-29'
    }
  ]);
  var candidates = await searchShikimori(fetchFn, 'frieren');
  assert.deepEqual(candidates, [
    {
      id: 52991,
      title: 'Провожающая в последний путь Фрирен',
      year: 2023,
      poster: 'https://shikimori.io/system/animes/original/52991.jpg?1710731127'
    }
  ]);
});

test('searchShikimori falls back to romaji name when russian is empty', async () => {
  var fetchFn = okJson([
    { id: 1, name: 'Cowboy Bebop', russian: '', image: { original: '/system/animes/original/1.jpg' }, aired_on: '1998-04-03' }
  ]);
  var candidates = await searchShikimori(fetchFn, 'bebop');
  assert.equal(candidates[0].title, 'Cowboy Bebop');
});

test('searchShikimori resolves to [] on an empty search (no matches)', async () => {
  assert.deepEqual(await searchShikimori(okJson([]), 'zzzznotanything'), []);
});

test('searchShikimori resolves to [] on a network failure', async () => {
  assert.deepEqual(await searchShikimori(networkError(), 'x'), []);
});

test('fetchShikimoriDetails normalizes a details response, preferring Russian genre names and stripping BBCode', async () => {
  var fetchFn = okJson({
    id: 52991,
    name: 'Sousou no Frieren',
    russian: 'Провожающая в последний путь Фрирен',
    english: ["Frieren: Beyond Journey's End"],
    image: { original: '/system/animes/original/52991.jpg?1710731127' },
    aired_on: '2023-09-29',
    genres: [
      { id: 8, name: 'Drama', russian: 'Драма' },
      { id: 10, name: 'Fantasy', russian: 'Фэнтези' }
    ],
    description: 'Отряд героя [character=186854]Химмеля[/character] вернулся домой.'
  });
  var details = await fetchShikimoriDetails(fetchFn, 52991);
  assert.deepEqual(details, {
    title: 'Провожающая в последний путь Фрирен',
    year: 2023,
    genres: ['Драма', 'Фэнтези'],
    synopsis: 'Отряд героя Химмеля вернулся домой.',
    cover: 'https://shikimori.io/system/animes/original/52991.jpg?1710731127'
  });
});

test('fetchShikimoriDetails falls back to english[0] when russian and name are both empty', async () => {
  var fetchFn = okJson({
    id: 2, name: '', russian: '', english: ['Some Title'], image: {}, aired_on: null, genres: [], description: ''
  });
  var details = await fetchShikimoriDetails(fetchFn, 2);
  assert.equal(details.title, 'Some Title');
});

test('fetchShikimoriDetails resolves to null on an HTTP 404 (unknown id)', async () => {
  assert.equal(await fetchShikimoriDetails(httpError(404), 999999999), null);
});

test('fetchShikimoriDetails resolves to null on a network failure', async () => {
  assert.equal(await fetchShikimoriDetails(networkError(), 52991), null);
});

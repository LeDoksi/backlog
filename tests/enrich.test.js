// tests/enrich.test.js
//
// Every test hands in a fake `fetchFn` — a function returning canned
// `{ ok, json: () => Promise.resolve(...) }` responses shaped like the real
// TMDb/RAWG/Jikan bodies confirmed live during Task 40 (see lib/enrich.js's
// header comment). No real network calls. Same discipline as tests/sync.test.js
// faking the Supabase client.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  searchTmdb, fetchTmdbDetails,
  searchRawg, fetchRawgDetails,
  searchJikan, fetchJikanDetails
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

// ── Jikan ────────────────────────────────────────────────────────────────

test('searchJikan normalizes an anime search result without title/synopsis leaking into details', async () => {
  var fetchFn = okJson({
    data: [
      {
        mal_id: 52991,
        title: 'Sousou no Frieren',
        title_english: "Frieren: Beyond Journey's End",
        year: 2023,
        images: { jpg: { large_image_url: 'https://cdn.myanimelist.net/x.jpg' } }
      }
    ]
  });
  var candidates = await searchJikan(fetchFn, 'frieren');
  assert.deepEqual(candidates, [
    { id: 52991, title: "Frieren: Beyond Journey's End", year: 2023, poster: 'https://cdn.myanimelist.net/x.jpg' }
  ]);
});

test('searchJikan falls back to aired.from when year is absent', async () => {
  var fetchFn = okJson({
    data: [{ mal_id: 1, title: 'X', year: null, aired: { from: '2016-04-04T00:00:00+00:00' }, images: {} }]
  });
  var candidates = await searchJikan(fetchFn, 'x');
  assert.equal(candidates[0].year, 2016);
});

test('searchJikan resolves to [] on a 504 (Jikan/MAL unreachable)', async () => {
  assert.deepEqual(await searchJikan(httpError(504), 'x'), []);
});

test('fetchJikanDetails normalizes a details response and omits title/synopsis', async () => {
  var fetchFn = okJson({
    data: {
      mal_id: 52991,
      title: 'Sousou no Frieren',
      title_english: "Frieren: Beyond Journey's End",
      year: 2023,
      genres: [{ mal_id: 2, name: 'Adventure' }, { mal_id: 10, name: 'Fantasy' }],
      images: { jpg: { large_image_url: 'https://cdn.myanimelist.net/x.jpg' } },
      synopsis: 'During their decade-long quest…'
    }
  });
  var details = await fetchJikanDetails(fetchFn, 52991);
  assert.deepEqual(details, {
    year: 2023,
    genres: ['Adventure', 'Fantasy'],
    cover: 'https://cdn.myanimelist.net/x.jpg'
  });
  assert.equal('title' in details, false);
  assert.equal('synopsis' in details, false);
});

test('fetchJikanDetails resolves to null on a network failure', async () => {
  assert.equal(await fetchJikanDetails(networkError(), 52991), null);
});

# Бэклог тайтлов — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static, dark-themed, filterable/sortable gallery web page for tracking a personal backlog of games, series, movies and anime, seeded with an initial catalog derived from `показываю даше мир.xlsx`.

**Architecture:** Plain HTML/CSS/JS, no build step, no npm dependencies, no backend. Pure logic (slugging, filtering/sorting, localStorage overlay, validation) lives in small UMD-style modules under `lib/` that work unmodified in both the browser (`<script>` tag, global namespace) and Node (`require()`), so they can be unit-tested with Node's built-in test runner. `app.js` is a thin DOM layer wiring `lib/` functions to the page; it is verified manually in the browser rather than unit-tested, since it has no bundler-free way to run outside a real DOM. The base catalog lives in `data.js` (a plain JS array, not JSON, so it loads over `file://` without CORS issues); status/rating/deletion edits the user makes in the UI are stored as a `localStorage` overlay on top of it. See design spec: `docs/superpowers/specs/2026-08-16-backlog-design.md`.

**Tech Stack:** Vanilla HTML5, CSS3, ES5-compatible JavaScript, Node.js built-in test runner (`node --test`) for unit tests — nothing else, no `package.json`, no npm install.

## Global Constraints

- No external runtime dependencies of any kind (no npm packages, no CDN scripts, no frameworks) — plain HTML/CSS/JS only.
- `category` enum: `"game" | "series" | "movie" | "anime"`. Japanese animation is always `"anime"` regardless of movie/series format; non-Japanese animation goes to `"movie"` (feature-length) or `"series"` (multi-episode).
- `status` enum: `"queue" | "in_progress" | "done"`.
- `airingStatus` enum: `"ongoing" | "completed"` for `category` of `series`/`anime`; must be `null` for `game`/`movie`.
- Title id convention: `lib/slug.js`'s `makeId(title, year)` — lowercase, transliterated, hyphenated title + `-` + year (e.g. `frieren-beyond-journey-s-end-2023`).
- Posters are always downloaded into `images/covers/<id>.<ext>` and referenced by local relative path — never hotlinked to an external URL.
- `localStorage` keys: `backlog-overrides` (per-id status/rating patch object) and `backlog-deleted` (array of deleted ids) — see `lib/storage.js`.
- Visual direction: dark cinematic theme (Letterboxd/IGDB-like) — dark background, large poster art, hover elevation/glow, restrained accent color for status badges.
- After any UI-affecting task, verify manually in the browser (per project convention for frontend work) before considering the task done — automated tests only cover `lib/`.

---

## Phase A — Application (code, tests, seed data)

### Task 1: Slug utility

**Files:**
- Create: `lib/slug.js`
- Test: `tests/slug.test.js`

**Interfaces:**
- Produces: `BacklogSlug.slugify(text: string): string`, `BacklogSlug.makeId(title: string, year: number|null): string` — used by Task 4 (validate), Task 5 (seed data ids), and by anyone adding titles later (Phase B batches).

- [ ] **Step 1: Write the failing tests**

```js
// tests/slug.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { slugify, makeId } = require('../lib/slug.js');

test('slugify converts to lowercase hyphenated ascii', () => {
  assert.equal(slugify("Frieren: Beyond Journey's End"), 'frieren-beyond-journey-s-end');
});

test('slugify transliterates cyrillic', () => {
  assert.equal(slugify('Клаустрофобы'), 'klaustrofoby');
});

test('slugify trims leading/trailing hyphens', () => {
  assert.equal(slugify('  Alien!  '), 'alien');
});

test('makeId appends year when provided', () => {
  assert.equal(makeId('Barbie', 2023), 'barbie-2023');
});

test('makeId omits year when not provided', () => {
  assert.equal(makeId('Baby Driver', null), 'baby-driver');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/slug.test.js`
Expected: FAIL — `Cannot find module '../lib/slug.js'`

- [ ] **Step 3: Write the implementation**

```js
// lib/slug.js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BacklogSlug = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  var CYRILLIC_MAP = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
    и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
    щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
  };

  function transliterate(str) {
    return str.toLowerCase().split('').map(function (ch) {
      return Object.prototype.hasOwnProperty.call(CYRILLIC_MAP, ch) ? CYRILLIC_MAP[ch] : ch;
    }).join('');
  }

  function slugify(text) {
    return transliterate(text)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function makeId(title, year) {
    var base = slugify(title);
    return year ? base + '-' + year : base;
  }

  return { slugify: slugify, makeId: makeId };
}));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/slug.test.js`
Expected: PASS — 5 tests passing

- [ ] **Step 5: Commit**

```bash
git add lib/slug.js tests/slug.test.js
git commit -m "feat: add slug utility for title ids"
```

---

### Task 2: LocalStorage overlay (status/rating overrides + deletions)

**Files:**
- Create: `lib/storage.js`
- Test: `tests/storage.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `BacklogStorage.getOverrides(storage)`, `BacklogStorage.setOverride(storage, id, patch)`, `BacklogStorage.getDeleted(storage)`, `BacklogStorage.deleteTitle(storage, id)`, `BacklogStorage.applyOverlay(titles, storage): array` — `storage` is any object with `getItem(key)`/`setItem(key, value)` (browser passes `window.localStorage`, tests pass a fake). Used by Task 5 (seed rendering can rely on it), Task 7 (grid render), Task 10 (status/rating/delete actions).

- [ ] **Step 1: Write the failing tests**

```js
// tests/storage.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { setOverride, getDeleted, deleteTitle, applyOverlay } = require('../lib/storage.js');

function fakeStorage() {
  var data = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem: function (k, v) { data[k] = v; }
  };
}

test('applyOverlay merges status override into matching title', () => {
  var storage = fakeStorage();
  setOverride(storage, 'frieren-2023', { status: 'in_progress' });
  var titles = [{ id: 'frieren-2023', status: 'queue', title: 'Frieren' }];
  var result = applyOverlay(titles, storage);
  assert.equal(result[0].status, 'in_progress');
});

test('applyOverlay does not mutate the original title object', () => {
  var storage = fakeStorage();
  setOverride(storage, 'frieren-2023', { status: 'done' });
  var original = { id: 'frieren-2023', status: 'queue' };
  applyOverlay([original], storage);
  assert.equal(original.status, 'queue');
});

test('applyOverlay excludes deleted titles', () => {
  var storage = fakeStorage();
  deleteTitle(storage, 'barbie-2023');
  var titles = [{ id: 'barbie-2023', title: 'Barbie' }, { id: 'fight-club-1999', title: 'Fight Club' }];
  var result = applyOverlay(titles, storage);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'fight-club-1999');
});

test('deleteTitle is idempotent', () => {
  var storage = fakeStorage();
  deleteTitle(storage, 'x');
  deleteTitle(storage, 'x');
  assert.deepEqual(getDeleted(storage), ['x']);
});

test('setOverride merges patches across multiple calls', () => {
  var storage = fakeStorage();
  setOverride(storage, 'ted-lasso-2020', { status: 'in_progress' });
  setOverride(storage, 'ted-lasso-2020', { rating: 8 });
  var titles = [{ id: 'ted-lasso-2020', status: 'queue', rating: null }];
  var result = applyOverlay(titles, storage);
  assert.deepEqual({ status: result[0].status, rating: result[0].rating }, { status: 'in_progress', rating: 8 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/storage.test.js`
Expected: FAIL — `Cannot find module '../lib/storage.js'`

- [ ] **Step 3: Write the implementation**

```js
// lib/storage.js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BacklogStorage = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  var OVERRIDES_KEY = 'backlog-overrides';
  var DELETED_KEY = 'backlog-deleted';

  function readJSON(storage, key, fallback) {
    var raw = storage.getItem(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function getOverrides(storage) {
    return readJSON(storage, OVERRIDES_KEY, {});
  }

  function setOverride(storage, id, patch) {
    var overrides = getOverrides(storage);
    overrides[id] = Object.assign({}, overrides[id], patch);
    storage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
  }

  function getDeleted(storage) {
    return readJSON(storage, DELETED_KEY, []);
  }

  function deleteTitle(storage, id) {
    var deleted = getDeleted(storage);
    if (deleted.indexOf(id) === -1) {
      deleted.push(id);
      storage.setItem(DELETED_KEY, JSON.stringify(deleted));
    }
  }

  function applyOverlay(titles, storage) {
    var overrides = getOverrides(storage);
    var deleted = getDeleted(storage);
    return titles
      .filter(function (t) { return deleted.indexOf(t.id) === -1; })
      .map(function (t) {
        return overrides[t.id] ? Object.assign({}, t, overrides[t.id]) : t;
      });
  }

  return {
    getOverrides: getOverrides,
    setOverride: setOverride,
    getDeleted: getDeleted,
    deleteTitle: deleteTitle,
    applyOverlay: applyOverlay
  };
}));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/storage.test.js`
Expected: PASS — 5 tests passing

- [ ] **Step 5: Commit**

```bash
git add lib/storage.js tests/storage.test.js
git commit -m "feat: add localStorage overlay for status/rating/deletion"
```

---

### Task 3: Filter, search, sort and returning-flag logic

**Files:**
- Create: `lib/query.js`
- Test: `tests/query.test.js`

**Interfaces:**
- Consumes: nothing from other tasks (operates on plain title objects matching the schema in Global Constraints).
- Produces: `BacklogQuery.isReturning(title): boolean`, `BacklogQuery.matchesFilters(title, filters): boolean`, `BacklogQuery.matchesSearch(title, query): boolean`, `BacklogQuery.sortTitles(titles, sortKey): array`, `BacklogQuery.countProgress(titles): {done, total}`. Used by Task 7 (grid + counters) and Task 8 (filters/search/sort UI).

- [ ] **Step 1: Write the failing tests**

```js
// tests/query.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { isReturning, matchesFilters, matchesSearch, sortTitles, countProgress } = require('../lib/query.js');

test('isReturning is true only when done and airing ongoing', () => {
  assert.equal(isReturning({ status: 'done', airingStatus: 'ongoing' }), true);
  assert.equal(isReturning({ status: 'done', airingStatus: 'completed' }), false);
  assert.equal(isReturning({ status: 'queue', airingStatus: 'ongoing' }), false);
});

test('matchesFilters filters by category', () => {
  var title = { category: 'anime', status: 'queue', genres: ['драма'] };
  assert.equal(matchesFilters(title, { category: 'anime' }), true);
  assert.equal(matchesFilters(title, { category: 'movie' }), false);
});

test('matchesFilters "all" category matches everything', () => {
  var title = { category: 'anime', status: 'queue', genres: [] };
  assert.equal(matchesFilters(title, { category: 'all' }), true);
});

test('matchesFilters filters by genre', () => {
  var title = { category: 'movie', status: 'queue', genres: ['драма', 'триллер'] };
  assert.equal(matchesFilters(title, { genre: 'триллер' }), true);
  assert.equal(matchesFilters(title, { genre: 'комедия' }), false);
});

test('matchesFilters filters by returning flag', () => {
  var returning = { category: 'anime', status: 'done', airingStatus: 'ongoing', genres: [] };
  var notReturning = { category: 'anime', status: 'done', airingStatus: 'completed', genres: [] };
  assert.equal(matchesFilters(returning, { returning: true }), true);
  assert.equal(matchesFilters(notReturning, { returning: true }), false);
});

test('matchesSearch is a case-insensitive substring match', () => {
  assert.equal(matchesSearch({ title: "Frieren: Beyond Journey's End" }, 'journey'), true);
  assert.equal(matchesSearch({ title: 'Frieren' }, 'zzz'), false);
  assert.equal(matchesSearch({ title: 'Frieren' }, ''), true);
});

test('sortTitles by name ascending', () => {
  var titles = [{ title: 'Zorro' }, { title: 'Alien' }];
  var sorted = sortTitles(titles, 'name');
  assert.equal(sorted[0].title, 'Alien');
});

test('sortTitles by rating descending', () => {
  var titles = [{ title: 'A', rating: 5 }, { title: 'B', rating: 9 }];
  var sorted = sortTitles(titles, 'rating');
  assert.equal(sorted[0].title, 'B');
});

test('sortTitles does not mutate the input array', () => {
  var titles = [{ title: 'Zorro' }, { title: 'Alien' }];
  sortTitles(titles, 'name');
  assert.equal(titles[0].title, 'Zorro');
});

test('countProgress counts done vs total', () => {
  var titles = [{ status: 'done' }, { status: 'queue' }, { status: 'done' }];
  assert.deepEqual(countProgress(titles), { done: 2, total: 3 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/query.test.js`
Expected: FAIL — `Cannot find module '../lib/query.js'`

- [ ] **Step 3: Write the implementation**

```js
// lib/query.js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BacklogQuery = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  function isReturning(title) {
    return title.status === 'done' && title.airingStatus === 'ongoing';
  }

  function matchesFilters(title, filters) {
    filters = filters || {};
    if (filters.category && filters.category !== 'all' && title.category !== filters.category) return false;
    if (filters.status && filters.status !== 'all' && title.status !== filters.status) return false;
    if (filters.genre && filters.genre !== 'all' && title.genres.indexOf(filters.genre) === -1) return false;
    if (filters.returning && !isReturning(title)) return false;
    return true;
  }

  function matchesSearch(title, query) {
    if (!query) return true;
    return title.title.toLowerCase().indexOf(query.toLowerCase()) !== -1;
  }

  function sortTitles(titles, sortKey) {
    var copy = titles.slice();
    switch (sortKey) {
      case 'name':
        return copy.sort(function (a, b) { return a.title.localeCompare(b.title); });
      case 'year':
        return copy.sort(function (a, b) { return (b.year || 0) - (a.year || 0); });
      case 'rating':
        return copy.sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); });
      case 'added':
      default:
        return copy;
    }
  }

  function countProgress(titles) {
    var done = titles.filter(function (t) { return t.status === 'done'; }).length;
    return { done: done, total: titles.length };
  }

  return {
    isReturning: isReturning,
    matchesFilters: matchesFilters,
    matchesSearch: matchesSearch,
    sortTitles: sortTitles,
    countProgress: countProgress
  };
}));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/query.test.js`
Expected: PASS — 10 tests passing

- [ ] **Step 5: Commit**

```bash
git add lib/query.js tests/query.test.js
git commit -m "feat: add filter/search/sort/returning-flag logic"
```

---

### Task 4: Data validator + CLI

**Files:**
- Create: `lib/validate.js`
- Create: `tools/validate-data.js`
- Test: `tests/validate.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `BacklogValidate.validateTitle(title): string[]`, `BacklogValidate.validateCatalog(titles): string[]`. `tools/validate-data.js` is a Node CLI (`node tools/validate-data.js`) that requires `../data.js` and prints/exits based on `validateCatalog`. Used by Task 5 and every Phase B batch task to sanity-check `data.js` after edits.

- [ ] **Step 1: Write the failing tests**

```js
// tests/validate.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateTitle, validateCatalog } = require('../lib/validate.js');

function validTitle(overrides) {
  return Object.assign({
    id: 'frieren-2023',
    title: "Frieren: Beyond Journey's End",
    category: 'anime',
    status: 'done',
    airingStatus: 'ongoing',
    year: 2023,
    genres: ['драма', 'фэнтези'],
    rating: 9,
    synopsis: 'Эльфийка-магиня заново открывает для себя ценность недолгой человеческой жизни.',
    cover: 'images/covers/frieren-2023.jpg'
  }, overrides);
}

test('validateTitle accepts a fully valid title', () => {
  assert.deepEqual(validateTitle(validTitle()), []);
});

test('validateTitle rejects invalid category', () => {
  var errors = validateTitle(validTitle({ category: 'cartoon' }));
  assert.ok(errors.some(function (e) { return e.indexOf('category') !== -1; }));
});

test('validateTitle rejects invalid status', () => {
  var errors = validateTitle(validTitle({ status: 'watching' }));
  assert.ok(errors.some(function (e) { return e.indexOf('status') !== -1; }));
});

test('validateTitle requires airingStatus for anime', () => {
  var errors = validateTitle(validTitle({ airingStatus: null }));
  assert.ok(errors.some(function (e) { return e.indexOf('airingStatus') !== -1; }));
});

test('validateTitle requires airingStatus to be null for movies', () => {
  var errors = validateTitle(validTitle({ category: 'movie', airingStatus: 'ongoing' }));
  assert.ok(errors.some(function (e) { return e.indexOf('airingStatus') !== -1; }));
});

test('validateTitle rejects out-of-range rating', () => {
  var errors = validateTitle(validTitle({ rating: 11 }));
  assert.ok(errors.some(function (e) { return e.indexOf('rating') !== -1; }));
});

test('validateTitle accepts null rating', () => {
  assert.deepEqual(validateTitle(validTitle({ rating: null })), []);
});

test('validateCatalog flags duplicate ids', () => {
  var errors = validateCatalog([validTitle(), validTitle()]);
  assert.ok(errors.some(function (e) { return e.indexOf('duplicate id') !== -1; }));
});

test('validateCatalog returns no errors for a clean catalog', () => {
  var errors = validateCatalog([validTitle(), validTitle({ id: 'barbie-2023', category: 'movie', airingStatus: null })]);
  assert.deepEqual(errors, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/validate.test.js`
Expected: FAIL — `Cannot find module '../lib/validate.js'`

- [ ] **Step 3: Write the implementation**

```js
// lib/validate.js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BacklogValidate = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  var CATEGORIES = ['game', 'series', 'movie', 'anime'];
  var STATUSES = ['queue', 'in_progress', 'done'];
  var AIRING_STATUSES = ['ongoing', 'completed'];

  function validateTitle(title) {
    var errors = [];
    if (!title.id || typeof title.id !== 'string') errors.push('id is required and must be a string');
    if (!title.title || typeof title.title !== 'string') errors.push('title is required and must be a string');
    if (CATEGORIES.indexOf(title.category) === -1) errors.push('category must be one of: ' + CATEGORIES.join(', '));
    if (STATUSES.indexOf(title.status) === -1) errors.push('status must be one of: ' + STATUSES.join(', '));
    var needsAiring = title.category === 'series' || title.category === 'anime';
    if (needsAiring) {
      if (AIRING_STATUSES.indexOf(title.airingStatus) === -1) {
        errors.push('airingStatus must be one of: ' + AIRING_STATUSES.join(', ') + ' for series/anime');
      }
    } else if (title.airingStatus !== null && title.airingStatus !== undefined) {
      errors.push('airingStatus must be null for game/movie');
    }
    if (title.year !== null && typeof title.year !== 'number') errors.push('year must be a number or null');
    if (!Array.isArray(title.genres)) errors.push('genres must be an array');
    if (title.rating !== null && (typeof title.rating !== 'number' || title.rating < 1 || title.rating > 10)) {
      errors.push('rating must be null or a number between 1 and 10');
    }
    if (typeof title.synopsis !== 'string') errors.push('synopsis must be a string');
    if (!title.cover || typeof title.cover !== 'string') errors.push('cover is required and must be a string path');
    return errors;
  }

  function validateCatalog(titles) {
    var errors = [];
    var seenIds = {};
    titles.forEach(function (title, index) {
      var label = '[' + index + '] ' + (title.id || '(no id)');
      validateTitle(title).forEach(function (err) {
        errors.push(label + ': ' + err);
      });
      if (title.id) {
        if (seenIds[title.id]) errors.push(label + ': duplicate id');
        seenIds[title.id] = true;
      }
    });
    return errors;
  }

  return { validateTitle: validateTitle, validateCatalog: validateCatalog };
}));
```

```js
// tools/validate-data.js
const TITLES = require('../data.js');
const { validateCatalog } = require('../lib/validate.js');

const errors = validateCatalog(TITLES);
if (errors.length) {
  console.error('data.js validation failed with ' + errors.length + ' error(s):');
  errors.forEach(function (e) { console.error(' - ' + e); });
  process.exit(1);
} else {
  console.log('OK: ' + TITLES.length + ' titles, no errors.');
  process.exit(0);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/validate.test.js`
Expected: PASS — 9 tests passing

- [ ] **Step 5: Commit**

```bash
git add lib/validate.js tools/validate-data.js tests/validate.test.js
git commit -m "feat: add catalog validator and CLI"
```

---

### Task 5: Seed catalog (8 titles) with real posters

**Files:**
- Create: `data.js`
- Create: `images/covers/frieren-2023.jpg`, `images/covers/re-zero-starting-life-in-another-world-2016.jpg`, `images/covers/the-boys-2019.jpg`, `images/covers/ted-lasso-2020.jpg`, `images/covers/barbie-2023.jpg`, `images/covers/fight-club-1999.jpg`, `images/covers/it-takes-two-2021.jpg`, `images/covers/baldurs-gate-3-2023.jpg`

**Interfaces:**
- Consumes: `lib/validate.js` (Task 4) to self-check; id convention from `lib/slug.js` (Task 1).
- Produces: `data.js` exporting `TITLES` (array of 8 title objects, browser global `TITLES` + `module.exports` in Node) — consumed by Task 7 onward and by every Phase B batch task (which appends to this same array).

- [ ] **Step 1: Write `data.js`**

```js
// data.js
const TITLES = [
  {
    id: 'frieren-2023',
    title: "Frieren: Beyond Journey's End",
    category: 'anime',
    status: 'done',
    airingStatus: 'ongoing',
    year: 2023,
    genres: ['драма', 'фэнтези'],
    rating: null,
    synopsis: 'Эльфийка-магиня Фрирен, пережившая своих спутников по приключениям, заново открывает для себя, что значит ценить недолгую человеческую жизнь.',
    cover: 'images/covers/frieren-2023.jpg'
  },
  {
    id: 're-zero-starting-life-in-another-world-2016',
    title: 'Re:Zero − Starting Life in Another World',
    category: 'anime',
    status: 'done',
    airingStatus: 'ongoing',
    year: 2016,
    genres: ['фэнтези', 'триллер'],
    rating: null,
    synopsis: 'Субару переносится в фэнтезийный мир и обнаруживает, что может возвращаться в прошлое после смерти — но каждый раз платит за это дорогую цену.',
    cover: 'images/covers/re-zero-starting-life-in-another-world-2016.jpg'
  },
  {
    id: 'the-boys-2019',
    title: 'The Boys',
    category: 'series',
    status: 'done',
    airingStatus: 'ongoing',
    year: 2019,
    genres: ['сатира', 'боевик'],
    rating: null,
    synopsis: 'Группа мстителей без суперсил охотится на коррумпированных супергероев корпорации Vought.',
    cover: 'images/covers/the-boys-2019.jpg'
  },
  {
    id: 'ted-lasso-2020',
    title: 'Ted Lasso',
    category: 'series',
    status: 'queue',
    airingStatus: 'ongoing',
    year: 2020,
    genres: ['комедия', 'спорт'],
    rating: null,
    synopsis: 'Американский тренер по американскому футболу без опыта в футболе возглавляет английский клуб и меняет отношение команды друг к другу.',
    cover: 'images/covers/ted-lasso-2020.jpg'
  },
  {
    id: 'barbie-2023',
    title: 'Barbie',
    category: 'movie',
    status: 'done',
    airingStatus: null,
    year: 2023,
    genres: ['комедия', 'фэнтези'],
    rating: null,
    synopsis: 'Барби покидает идеальный Барбиленд и отправляется в реальный мир, где сталкивается с непростыми вопросами об идентичности.',
    cover: 'images/covers/barbie-2023.jpg'
  },
  {
    id: 'fight-club-1999',
    title: 'Fight Club',
    category: 'movie',
    status: 'queue',
    airingStatus: null,
    year: 1999,
    genres: ['драма', 'триллер'],
    rating: null,
    synopsis: 'Безымянный офисный работник и харизматичный продавец мыла Тайлер Дёрден основывают подпольный бойцовский клуб, который перерастает в нечто гораздо большее.',
    cover: 'images/covers/fight-club-1999.jpg'
  },
  {
    id: 'it-takes-two-2021',
    title: 'It Takes Two',
    category: 'game',
    status: 'done',
    airingStatus: null,
    year: 2021,
    genres: ['кооператив', 'платформер'],
    rating: null,
    synopsis: 'Разводящиеся родители превращаются в кукол и должны пройти изобретательные кооперативные головоломки, чтобы вернуть себе человеческий облик.',
    cover: 'images/covers/it-takes-two-2021.jpg'
  },
  {
    id: 'baldurs-gate-3-2023',
    title: "Baldur's Gate 3",
    category: 'game',
    status: 'queue',
    airingStatus: null,
    year: 2023,
    genres: ['ролевая игра', 'фэнтези'],
    rating: null,
    synopsis: 'Партийная RPG по мотивам D&D: отряд заражённых мозговым паразитом иллитидов пытается остановить вторжение разума в Забытых Королевствах.',
    cover: 'images/covers/baldurs-gate-3-2023.jpg'
  }
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TITLES;
}
```

- [ ] **Step 2: Download a real poster for each of the 8 titles**

For each title, web-search `<title> poster` (or use its Wikipedia/official page), then download the image into the matching `images/covers/<id>.jpg` path listed above. Example using curl:

```bash
mkdir -p images/covers
curl -L "https://<found-image-url>" -o images/covers/frieren-2023.jpg
```

Repeat for all 8. Keep each file under ~500KB (resize if the source is huge).

- [ ] **Step 3: Validate the catalog**

Run: `node tools/validate-data.js`
Expected: `OK: 8 titles, no errors.`

- [ ] **Step 4: Commit**

```bash
git add data.js images/covers
git commit -m "feat: seed catalog with 8 titles across all categories"
```

---

### Task 6: Page shell — dark theme HTML/CSS

**Files:**
- Create: `index.html`
- Create: `styles.css`

**Interfaces:**
- Consumes: nothing (static markup); Task 7 attaches behavior to the element ids/classes defined here.
- Produces: DOM structure that Task 7+ depend on — element ids: `#tabs`, `#grid`, `#search-input`, `#sort-select`, `#status-filter`, `#genre-filter`, `#returning-filter`, `#title-modal`, `#modal-cover`, `#modal-title`, `#modal-synopsis`, `#modal-meta`, `#modal-status`, `#modal-rating`, `#modal-delete`, `#modal-close`.

- [ ] **Step 1: Write `index.html`**

```html
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Бэклог</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="topbar">
    <h1 class="topbar__title">Бэклог</h1>
    <nav id="tabs" class="tabs">
      <button class="tabs__item" data-category="all">Всё</button>
      <button class="tabs__item" data-category="game">Игры</button>
      <button class="tabs__item" data-category="series">Сериалы</button>
      <button class="tabs__item" data-category="movie">Кино</button>
      <button class="tabs__item" data-category="anime">Аниме</button>
    </nav>
  </header>

  <section class="toolbar">
    <input id="search-input" class="toolbar__search" type="search" placeholder="Поиск по названию…">
    <select id="status-filter" class="toolbar__select">
      <option value="all">Любой статус</option>
      <option value="queue">В очереди</option>
      <option value="in_progress">В процессе</option>
      <option value="done">Пройдено</option>
    </select>
    <select id="genre-filter" class="toolbar__select">
      <option value="all">Любой жанр</option>
    </select>
    <label class="toolbar__checkbox">
      <input id="returning-filter" type="checkbox"> Ждут продолжения
    </label>
    <select id="sort-select" class="toolbar__select">
      <option value="added">По дате добавления</option>
      <option value="name">По названию</option>
      <option value="year">По году</option>
      <option value="rating">По оценке</option>
    </select>
  </section>

  <main id="grid" class="grid"></main>

  <div id="title-modal" class="modal" hidden>
    <div class="modal__backdrop"></div>
    <div class="modal__panel">
      <button id="modal-close" class="modal__close" aria-label="Закрыть">×</button>
      <img id="modal-cover" class="modal__cover" alt="">
      <div class="modal__body">
        <h2 id="modal-title" class="modal__title"></h2>
        <p id="modal-meta" class="modal__meta"></p>
        <p id="modal-synopsis" class="modal__synopsis"></p>
        <label class="modal__field">
          Статус
          <select id="modal-status">
            <option value="queue">В очереди</option>
            <option value="in_progress">В процессе</option>
            <option value="done">Пройдено</option>
          </select>
        </label>
        <label class="modal__field">
          Моя оценка
          <input id="modal-rating" type="number" min="1" max="10">
        </label>
        <button id="modal-delete" class="modal__delete">Удалить тайтл</button>
      </div>
    </div>
  </div>

  <script src="lib/slug.js"></script>
  <script src="lib/storage.js"></script>
  <script src="lib/query.js"></script>
  <script src="data.js"></script>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `styles.css`**

```css
/* styles.css */
:root {
  --bg: #0d0f14;
  --surface: #171a21;
  --surface-hover: #20242e;
  --text: #e8e9ec;
  --text-muted: #8a8f9c;
  --accent: #e94560;
  --accent-soft: rgba(233, 69, 96, 0.15);
  --border: #262a34;
  --radius: 10px;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 20px 32px;
  border-bottom: 1px solid var(--border);
}

.topbar__title {
  font-size: 20px;
  font-weight: 700;
  margin: 0;
}

.tabs { display: flex; gap: 8px; }

.tabs__item {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
  padding: 8px 16px;
  border-radius: 999px;
  cursor: pointer;
  font-size: 14px;
}

.tabs__item.is-active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 16px 32px;
}

.toolbar__search,
.toolbar__select {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 14px;
}

.toolbar__checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 14px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 20px;
  padding: 8px 32px 48px;
}

.card {
  background: var(--surface);
  border-radius: var(--radius);
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  position: relative;
}

.card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.4);
}

.card__cover {
  width: 100%;
  aspect-ratio: 2 / 3;
  object-fit: cover;
  display: block;
  background: var(--surface-hover);
}

.card__body { padding: 10px 12px; }

.card__title {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 6px;
  line-height: 1.3;
}

.badge {
  display: inline-block;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  margin-right: 4px;
}

.badge--returning { background: rgba(255, 191, 0, 0.15); color: #ffbf00; }

.modal {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.modal[hidden] { display: none; }

.modal__backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
}

.modal__panel {
  position: relative;
  background: var(--surface);
  border-radius: var(--radius);
  display: flex;
  gap: 24px;
  max-width: 720px;
  width: 90%;
  padding: 24px;
  z-index: 1;
}

.modal__cover {
  width: 220px;
  aspect-ratio: 2 / 3;
  object-fit: cover;
  border-radius: 8px;
}

.modal__body { flex: 1; }

.modal__title { margin: 0 0 8px; }

.modal__meta { color: var(--text-muted); font-size: 13px; }

.modal__synopsis { font-size: 14px; line-height: 1.5; }

.modal__field {
  display: block;
  font-size: 13px;
  color: var(--text-muted);
  margin: 12px 0;
}

.modal__field select,
.modal__field input {
  display: block;
  margin-top: 4px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 6px 10px;
  border-radius: 6px;
}

.modal__delete {
  background: transparent;
  border: 1px solid var(--accent);
  color: var(--accent);
  padding: 8px 14px;
  border-radius: 8px;
  cursor: pointer;
  margin-top: 12px;
}

.modal__close {
  position: absolute;
  top: 12px;
  right: 12px;
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 24px;
  cursor: pointer;
}
```

- [ ] **Step 3: Verify manually in the browser**

Open `index.html` directly (or via `preview_start`/browser tool). Expected: dark page with header, tabs, toolbar and an empty grid (no cards yet — `app.js` doesn't exist until Task 7). No console errors other than `app.js` 404 or `TITLES is not defined` if load order is off — check the `<script>` order matches the file above.

- [ ] **Step 4: Commit**

```bash
git add index.html styles.css
git commit -m "feat: add dark-theme page shell"
```

---

### Task 7: Render grid, category tabs, progress counters

**Files:**
- Create: `app.js`
- Modify: `index.html:` add a `<span>` progress counter into each `.tabs__item` (see Step 1)

**Interfaces:**
- Consumes: `TITLES` (Task 5, global), `BacklogStorage.applyOverlay` (Task 2), `BacklogQuery.countProgress`/`isReturning` (Task 3).
- Produces: `window.BacklogApp.getVisibleTitles()` (used by Task 8 to compose with filters), `window.BacklogApp.renderGrid(titles)`, `window.BacklogApp.refresh()` — Task 8/9/10 call `refresh()` after any state or storage change.

- [ ] **Step 1: Add progress counter spans to `index.html`**

Replace the `<nav id="tabs">` block in `index.html` with:

```html
<nav id="tabs" class="tabs">
  <button class="tabs__item is-active" data-category="all">Всё <span class="tabs__count" data-count="all"></span></button>
  <button class="tabs__item" data-category="game">Игры <span class="tabs__count" data-count="game"></span></button>
  <button class="tabs__item" data-category="series">Сериалы <span class="tabs__count" data-count="series"></span></button>
  <button class="tabs__item" data-category="movie">Кино <span class="tabs__count" data-count="movie"></span></button>
  <button class="tabs__item" data-category="anime">Аниме <span class="tabs__count" data-count="anime"></span></button>
</nav>
```

- [ ] **Step 2: Write `app.js` (grid rendering + tabs only for now)**

```js
// app.js
(function () {
  var state = { category: 'all' };

  function baseTitles() {
    return BacklogStorage.applyOverlay(TITLES, window.localStorage);
  }

  function titlesForCategory(category) {
    var all = baseTitles();
    if (category === 'all') return all;
    return all.filter(function (t) { return t.category === category; });
  }

  function renderCounters() {
    document.querySelectorAll('.tabs__count').forEach(function (el) {
      var category = el.getAttribute('data-count');
      var progress = BacklogQuery.countProgress(titlesForCategory(category));
      el.textContent = progress.done + '/' + progress.total;
    });
  }

  function cardHtml(title) {
    var returningBadge = BacklogQuery.isReturning(title)
      ? '<span class="badge badge--returning">Ждёт продолжения</span>'
      : '';
    return (
      '<img class="card__cover" src="' + title.cover + '" alt="' + title.title + '">' +
      '<div class="card__body">' +
      '<div class="card__title">' + title.title + '</div>' +
      '<span class="badge">' + title.status + '</span>' + returningBadge +
      '</div>'
    );
  }

  function renderGrid(titles) {
    var grid = document.getElementById('grid');
    grid.innerHTML = '';
    titles.forEach(function (title) {
      var card = document.createElement('article');
      card.className = 'card';
      card.dataset.id = title.id;
      card.innerHTML = cardHtml(title);
      grid.appendChild(card);
    });
  }

  function getVisibleTitles() {
    return titlesForCategory(state.category);
  }

  function refresh() {
    renderGrid(getVisibleTitles());
    renderCounters();
  }

  function onTabClick(event) {
    var button = event.target.closest('.tabs__item');
    if (!button) return;
    state.category = button.getAttribute('data-category');
    document.querySelectorAll('.tabs__item').forEach(function (b) { b.classList.remove('is-active'); });
    button.classList.add('is-active');
    refresh();
  }

  document.getElementById('tabs').addEventListener('click', onTabClick);
  refresh();

  window.BacklogApp = { getVisibleTitles: getVisibleTitles, renderGrid: renderGrid, refresh: refresh, state: state };
}());
```

- [ ] **Step 3: Verify manually in the browser**

Open `index.html`. Expected: 8 seed cards render in a grid with poster, title and status badge; "Всё" tab shows `8/8`... actually shows `done/total` e.g. `5/8` (5 seed titles have `status: 'done'`); clicking "Игры" shows only the 2 game cards and its own counter; no console errors.

- [ ] **Step 4: Commit**

```bash
git add app.js index.html
git commit -m "feat: render grid, category tabs and progress counters"
```

---

### Task 8: Filters, search and sort

**Files:**
- Modify: `app.js`

**Interfaces:**
- Consumes: `BacklogQuery.matchesFilters`/`matchesSearch`/`sortTitles` (Task 3); `getVisibleTitles`/`refresh` from Task 7.
- Produces: filtering/search/sort state merged into `BacklogApp.state`; `#genre-filter` populated dynamically from the current catalog's genres.

- [ ] **Step 1: Extend `app.js` state and wire the toolbar**

Add to the top of the IIFE in `app.js` (replacing the existing `state` declaration and `getVisibleTitles`/`refresh` functions):

```js
  var state = { category: 'all', status: 'all', genre: 'all', returning: false, search: '', sort: 'added' };
```

```js
  function populateGenreFilter() {
    var select = document.getElementById('genre-filter');
    var genres = {};
    baseTitles().forEach(function (t) { t.genres.forEach(function (g) { genres[g] = true; }); });
    Object.keys(genres).sort().forEach(function (g) {
      var option = document.createElement('option');
      option.value = g;
      option.textContent = g;
      select.appendChild(option);
    });
  }

  function getVisibleTitles() {
    var titles = titlesForCategory(state.category).filter(function (t) {
      return BacklogQuery.matchesFilters(t, { status: state.status, genre: state.genre, returning: state.returning })
        && BacklogQuery.matchesSearch(t, state.search);
    });
    return BacklogQuery.sortTitles(titles, state.sort);
  }

  function refresh() {
    renderGrid(getVisibleTitles());
    renderCounters();
  }

  document.getElementById('status-filter').addEventListener('change', function (e) {
    state.status = e.target.value;
    refresh();
  });
  document.getElementById('genre-filter').addEventListener('change', function (e) {
    state.genre = e.target.value;
    refresh();
  });
  document.getElementById('returning-filter').addEventListener('change', function (e) {
    state.returning = e.target.checked;
    refresh();
  });
  document.getElementById('sort-select').addEventListener('change', function (e) {
    state.sort = e.target.value;
    refresh();
  });
  document.getElementById('search-input').addEventListener('input', function (e) {
    state.search = e.target.value;
    refresh();
  });

  populateGenreFilter();
```

Keep the rest of `app.js` (`baseTitles`, `titlesForCategory`, `renderCounters`, `cardHtml`, `renderGrid`, `onTabClick`, the `tabs` click listener, the final `refresh()` call, and the `window.BacklogApp` export) as written in Task 7 — only the two functions above are replaced and the new listener/population block is added before the final `refresh()` call.

- [ ] **Step 2: Verify manually in the browser**

Reload `index.html`. Expected: genre `<select>` is populated with the seed catalog's genres (драма, фэнтези, сатира, боевик, комедия, спорт, триллер, кооператив, платформер, ролевая игра); typing "fri" in search shows only Frieren; setting status filter to "В очереди" hides `done` titles; checking "Ждут продолжения" shows only titles with `status: done` and `airingStatus: ongoing` (Frieren, Re:Zero, The Boys in the seed set); sort by "По оценке" doesn't error even though ratings are all `null`.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: add filters, search and sort"
```

---

### Task 9: Title detail modal (view)

**Files:**
- Modify: `app.js`

**Interfaces:**
- Consumes: modal DOM ids from Task 6; `getVisibleTitles`/card `data-id` from Task 7.
- Produces: `openTitleModal(id)` / `closeTitleModal()`, exported on `window.BacklogApp` for Task 10 to reuse when re-rendering after an edit.

- [ ] **Step 1: Add modal open/close logic to `app.js`**

Add these functions and the grid click listener, and extend the final `window.BacklogApp` export:

```js
  function findTitleById(id) {
    return baseTitles().filter(function (t) { return t.id === id; })[0];
  }

  function openTitleModal(id) {
    var title = findTitleById(id);
    if (!title) return;
    document.getElementById('modal-cover').src = title.cover;
    document.getElementById('modal-cover').alt = title.title;
    document.getElementById('modal-title').textContent = title.title;
    var meta = [title.year, title.genres.join(', ')].filter(Boolean).join(' · ');
    if (title.airingStatus) meta += ' · ' + (title.airingStatus === 'ongoing' ? 'выходит' : 'завершено');
    document.getElementById('modal-meta').textContent = meta;
    document.getElementById('modal-synopsis').textContent = title.synopsis;
    document.getElementById('modal-status').value = title.status;
    document.getElementById('modal-rating').value = title.rating || '';
    var modal = document.getElementById('title-modal');
    modal.dataset.id = id;
    modal.hidden = false;
  }

  function closeTitleModal() {
    document.getElementById('title-modal').hidden = true;
  }

  document.getElementById('grid').addEventListener('click', function (event) {
    var card = event.target.closest('.card');
    if (card) openTitleModal(card.dataset.id);
  });
  document.getElementById('modal-close').addEventListener('click', closeTitleModal);
  document.querySelector('.modal__backdrop').addEventListener('click', closeTitleModal);
```

Update the final export line to:

```js
  window.BacklogApp = {
    getVisibleTitles: getVisibleTitles,
    renderGrid: renderGrid,
    refresh: refresh,
    openTitleModal: openTitleModal,
    closeTitleModal: closeTitleModal,
    state: state
  };
```

- [ ] **Step 2: Verify manually in the browser**

Reload `index.html`, click a card. Expected: modal opens with poster, title, year/genres/airing-status line, synopsis, status `<select>` pre-set to the title's current status, rating input empty (seed ratings are all `null`); clicking the backdrop or the × closes it.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: add title detail modal"
```

---

### Task 10: Status change, rating, delete

**Files:**
- Modify: `app.js`

**Interfaces:**
- Consumes: `BacklogStorage.setOverride`/`deleteTitle` (Task 2); `refresh`/`openTitleModal`/`closeTitleModal` (Tasks 7/9).
- Produces: nothing new consumed by later tasks — this completes the interactive feature set.

- [ ] **Step 1: Wire modal controls to storage in `app.js`**

Add:

```js
  document.getElementById('modal-status').addEventListener('change', function (e) {
    var id = document.getElementById('title-modal').dataset.id;
    BacklogStorage.setOverride(window.localStorage, id, { status: e.target.value });
    refresh();
  });

  document.getElementById('modal-rating').addEventListener('change', function (e) {
    var id = document.getElementById('title-modal').dataset.id;
    var value = e.target.value ? parseInt(e.target.value, 10) : null;
    BacklogStorage.setOverride(window.localStorage, id, { rating: value });
    refresh();
  });

  document.getElementById('modal-delete').addEventListener('click', function () {
    var id = document.getElementById('title-modal').dataset.id;
    var title = findTitleById(id);
    if (!title) return;
    var confirmed = window.confirm('Удалить «' + title.title + '» из бэклога? Это действие нельзя отменить.');
    if (!confirmed) return;
    BacklogStorage.deleteTitle(window.localStorage, id);
    closeTitleModal();
    refresh();
  });
```

- [ ] **Step 2: Verify manually in the browser**

Reload `index.html`. Open "Fight Club" (seed `status: queue`), change status to "Пройдено", close modal, reload the page — expected: card still shows "Пройдено" (persisted via `localStorage`). Set a rating of 8 on any title, reopen its modal — expected: rating input shows `8`. Open a title, click "Удалить тайтл", confirm — expected: browser confirm dialog appears, card disappears from the grid and counters update; reload the page — expected: the deleted title stays gone.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: wire status/rating/delete to localStorage overlay"
```

---

### Task 11: Visual polish pass

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: Apply frontend-design guidance**

Invoke the `frontend-design` skill for direction, then refine `styles.css`: card hover glow/elevation timing, spacing rhythm between toolbar/grid/cards, typography scale (title/meta/synopsis sizes), focus-visible outlines on interactive elements (`.tabs__item`, `.card`, form controls) for keyboard accessibility, and a responsive breakpoint collapsing the toolbar to wrap cleanly under ~600px width.

- [ ] **Step 2: Verify manually in the browser**

Use the browser tool at desktop width (1280×800) and mobile width (375×812) — resize via `resize_window` — and take a screenshot at each. Expected: no horizontal scroll at either width, hover state visibly elevates cards, tab-key focus is visible on all interactive controls, dark palette meets WCAG contrast for `--text`/`--text-muted` against `--bg`/`--surface`.

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "style: polish dark cinematic visual design"
```

---

### Task 20: Quick-add title from the UI

> Added mid-execution at the user's request, placed here (after Task 11) because it's a UI feature that belongs before the README documents it. Numbered 20 to avoid renumbering already-completed tasks.

**Files:**
- Modify: `lib/slug.js`
- Modify: `tests/slug.test.js`
- Modify: `lib/storage.js`
- Modify: `tests/storage.test.js`
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `app.js`
- Create: `images/covers/_placeholder.svg`

**Interfaces:**
- Consumes: `BacklogSlug.slugify` (Task 1); `BacklogStorage`'s existing `getOverrides`/`setOverride`/`getDeleted`/`deleteTitle`/`applyOverlay` pattern (Task 2); `refresh`/`openTitleModal`/`cardHtml` (Tasks 7-9).
- Produces: `BacklogSlug.uniqueId(title, existingIds)`, `BacklogStorage.getAdded(storage)`, `BacklogStorage.addTitle(storage, title)`, `BacklogStorage.pruneAdded(storage, baseIds)`, `BacklogStorage.combineWithAdded(baseTitles, storage)` — nothing later depends on these beyond this task.

**Why this exists:** the user wants to add a title from the browser by typing just its name and picking a category — nothing else. Everything else (year, genres, synopsis, poster) still gets filled in later by asking Claude to edit `data.js` directly, exactly as before. Since `data.js` is a static file only Claude edits, a browser-added title can't land there directly — it's stored client-side in a third `localStorage` key, `backlog-added`, as a lightweight "draft" object with placeholder/empty enrichment fields and `draft: true`. `combineWithAdded` merges `TITLES` (from `data.js`) with the kept contents of `backlog-added`, and — critically — **a base-catalog entry always supersedes a same-id draft**: when Claude later adds a fully-enriched entry to `data.js` using the same id convention (`BacklogSlug.slugify(title)`, no year suffix needed to match since quick-add never has a year), the draft is automatically dropped from view and pruned out of `localStorage` on the next render. This is what closes the loop described in the design: "I'll ask you to add the rest" only works if the id Claude uses when enriching lines up with the id the quick-add form generated.

- [ ] **Step 1: Write the failing tests for `uniqueId`**

Append to `tests/slug.test.js`:

```js
test('uniqueId returns the plain slug when not taken', () => {
  assert.equal(uniqueId('Dune 3', []), 'dune-3');
});

test('uniqueId appends a numeric suffix on collision', () => {
  assert.equal(uniqueId('Dune 3', ['dune-3']), 'dune-3-2');
});

test('uniqueId keeps incrementing past multiple collisions', () => {
  assert.equal(uniqueId('Dune 3', ['dune-3', 'dune-3-2', 'dune-3-3']), 'dune-3-4');
});
```

Also change the `require` line at the top of `tests/slug.test.js` to pull in `uniqueId`:

```js
const { slugify, makeId, uniqueId } = require('../lib/slug.js');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/slug.test.js`
Expected: FAIL — `uniqueId is not a function`

- [ ] **Step 3: Add `uniqueId` to `lib/slug.js`**

Add this function inside the factory (after `makeId`), and add `uniqueId: uniqueId` to the returned object:

```js
  function uniqueId(title, existingIds) {
    var base = slugify(title);
    var candidate = base;
    var n = 2;
    while (existingIds.indexOf(candidate) !== -1) {
      candidate = base + '-' + n;
      n += 1;
    }
    return candidate;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/slug.test.js`
Expected: PASS — 8 tests passing (5 from Task 1 + 3 new)

- [ ] **Step 5: Write the failing tests for the added/draft storage functions**

Append to `tests/storage.test.js` (reuse the existing `fakeStorage()` helper already in that file):

```js
test('addTitle appends to the added list', () => {
  var storage = fakeStorage();
  addTitle(storage, { id: 'dune-3', title: 'Dune 3' });
  assert.deepEqual(getAdded(storage), [{ id: 'dune-3', title: 'Dune 3' }]);
});

test('combineWithAdded appends added titles after base titles', () => {
  var storage = fakeStorage();
  addTitle(storage, { id: 'dune-3', title: 'Dune 3' });
  var base = [{ id: 'barbie-2023', title: 'Barbie' }];
  var result = combineWithAdded(base, storage);
  assert.deepEqual(result.map(function (t) { return t.id; }), ['barbie-2023', 'dune-3']);
});

test('combineWithAdded drops an added draft once the base catalog adopts its id', () => {
  var storage = fakeStorage();
  addTitle(storage, { id: 'dune-3', title: 'Dune 3 (draft)' });
  var base = [{ id: 'dune-3', title: 'Dune 3', synopsis: 'real synopsis' }];
  var result = combineWithAdded(base, storage);
  assert.deepEqual(result, base);
  assert.deepEqual(getAdded(storage), []);
});

test('pruneAdded is a no-op when nothing to prune', () => {
  var storage = fakeStorage();
  addTitle(storage, { id: 'dune-3', title: 'Dune 3' });
  pruneAdded(storage, ['barbie-2023']);
  assert.equal(getAdded(storage).length, 1);
});
```

Also change the `require` line at the top of `tests/storage.test.js`:

```js
const { setOverride, getDeleted, deleteTitle, applyOverlay, addTitle, getAdded, pruneAdded, combineWithAdded } = require('../lib/storage.js');
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `node --test tests/storage.test.js`
Expected: FAIL — `addTitle is not a function`

- [ ] **Step 7: Add the added/draft functions to `lib/storage.js`**

Add near the top, alongside the existing `OVERRIDES_KEY`/`DELETED_KEY` constants:

```js
  var ADDED_KEY = 'backlog-added';
```

Add these functions (after `applyOverlay`), and add `getAdded: getAdded, addTitle: addTitle, pruneAdded: pruneAdded, combineWithAdded: combineWithAdded` to the returned object:

```js
  function getAdded(storage) {
    return readJSON(storage, ADDED_KEY, []);
  }

  function addTitle(storage, title) {
    var added = getAdded(storage);
    added.push(title);
    storage.setItem(ADDED_KEY, JSON.stringify(added));
  }

  function pruneAdded(storage, baseIds) {
    var added = getAdded(storage);
    var kept = added.filter(function (t) { return baseIds.indexOf(t.id) === -1; });
    if (kept.length !== added.length) {
      storage.setItem(ADDED_KEY, JSON.stringify(kept));
    }
    return kept;
  }

  function combineWithAdded(baseTitles, storage) {
    var baseIds = baseTitles.map(function (t) { return t.id; });
    var added = pruneAdded(storage, baseIds);
    return baseTitles.concat(added);
  }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `node --test tests/storage.test.js`
Expected: PASS — 9 tests passing (5 from Task 2 + 4 new)

- [ ] **Step 9: Create the placeholder cover**

Create `images/covers/_placeholder.svg` — a simple dark SVG matching the theme, shown on draft cards until a real poster is added:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600">
  <rect width="400" height="600" fill="#171a21"/>
  <rect x="0.5" y="0.5" width="399" height="599" fill="none" stroke="#262a34"/>
  <text x="200" y="290" text-anchor="middle" font-family="sans-serif" font-size="72" fill="#8a8f9c">?</text>
  <text x="200" y="340" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#8a8f9c">нет постера</text>
</svg>
```

- [ ] **Step 10: Add the quick-add form to `index.html`**

Add this new section directly after the closing `</section>` of the existing `.toolbar` block (before `<main id="grid" class="grid"></main>`):

```html
<form id="quick-add-form" class="quick-add">
  <input id="quick-add-title" class="quick-add__input" type="text" placeholder="Название нового тайтла…" required>
  <select id="quick-add-category" class="quick-add__select" required>
    <option value="" disabled selected>Категория…</option>
    <option value="game">Игра</option>
    <option value="series">Сериал</option>
    <option value="movie">Кино</option>
    <option value="anime">Аниме</option>
  </select>
  <button type="submit" class="quick-add__submit">+ Добавить</button>
</form>
```

- [ ] **Step 11: Style the quick-add form in `styles.css`**

Add rules for `.quick-add`, `.quick-add__input`, `.quick-add__select`, `.quick-add__submit`, and a `.badge--draft` variant (for the card badge added in Step 12). Match the existing dark theme exactly: reuse the CSS custom properties already defined (`--surface`, `--border`, `--text`, `--accent`, `--radius`, and the `--sp-*`/`--fs-*`/`--dur-*` tokens introduced in Task 11) rather than introducing new hard-coded colors. `.quick-add` should lay out as a single flex row that wraps sensibly at the existing ≤600px breakpoint, matching how `.toolbar` already wraps. `.badge--draft` should read as clearly "unfinished" (e.g. a muted/outlined treatment, distinct from the existing `.badge` and `.badge--returning` colors) without being alarming.

- [ ] **Step 12: Wire the form and the draft badge in `app.js`**

Change `baseTitles()` to combine base and added titles before applying the overlay:

```js
  function baseTitles() {
    var combined = BacklogStorage.combineWithAdded(TITLES, window.localStorage);
    return BacklogStorage.applyOverlay(combined, window.localStorage);
  }
```

In `cardHtml(title)`, add a draft badge alongside the existing returning badge:

```js
    var draftBadge = title.draft ? '<span class="badge badge--draft">Черновик</span>' : '';
```

...and include `draftBadge` in the returned markup next to `returningBadge`.

In `openTitleModal(title)`, when the title is a draft with no synopsis yet, show a helper line instead of an empty paragraph — replace the `document.getElementById('modal-synopsis').textContent = title.synopsis;` line with:

```js
    document.getElementById('modal-synopsis').textContent = title.draft
      ? 'Черновик — жанры, год, постер и описание ещё не заполнены. Просто попросите Claude дополнить «' + title.title + '».'
      : title.synopsis;
```

Add the form submit handler (anywhere among the other listeners, before the final `refresh()` call):

```js
  document.getElementById('quick-add-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var titleInput = document.getElementById('quick-add-title');
    var categorySelect = document.getElementById('quick-add-category');
    var name = titleInput.value.trim();
    var category = categorySelect.value;
    if (!name || !category) return;
    var existingIds = baseTitles().map(function (t) { return t.id; });
    var id = BacklogSlug.uniqueId(name, existingIds);
    BacklogStorage.addTitle(window.localStorage, {
      id: id,
      title: name,
      category: category,
      status: 'queue',
      airingStatus: (category === 'series' || category === 'anime') ? 'ongoing' : null,
      year: null,
      genres: [],
      rating: null,
      synopsis: '',
      cover: 'images/covers/_placeholder.svg',
      draft: true
    });
    titleInput.value = '';
    categorySelect.value = '';
    refresh();
  });
```

Also add `lib/slug.js` to the `<script>` load order in `index.html` if it is not already loaded before `app.js` (it should already be first per Task 6 — confirm, don't duplicate the tag).

- [ ] **Step 13: Verify manually in the browser**

Reload `index.html`. Add a new title via the form (e.g. name "Тестовый черновик", category "Кино") — expect: a new card appears immediately in "Кино" (and "Всё") with the placeholder cover, a "Черновик" badge, status "В очереди"; opening its modal shows the helper synopsis line and an empty rating; reloading the page keeps the draft (persisted in `localStorage['backlog-added']`); adding the same title name twice produces two distinct cards with ids `тестовый-черновик`-based-slug and a `-2` suffix on the second. Then simulate the "Claude enriches it" path: in the browser console, temporarily push a matching-id object into the in-memory `TITLES` array and call `BacklogApp.refresh()` — expect the draft badge and placeholder to disappear in favor of the enriched data, and `localStorage['backlog-added']` to no longer contain that id after the next `refresh()`.

- [ ] **Step 14: Commit**

```bash
git add lib/slug.js tests/slug.test.js lib/storage.js tests/storage.test.js index.html styles.css app.js images/covers/_placeholder.svg
git commit -m "feat: add quick-add-title form with draft/enrichment workflow"
```

---

### Task 21: Season info + backlog-first sorting

> Added mid-execution at the user's request: (1) series/anime need visible info about current/future seasons; (2) once the catalog fills up with dozens of "Пройдено" MCU entries in Phase B, the user doesn't want to scroll past all of them to find what's still in the backlog — needs a better default than sorting by add-order.

**Files:**
- Modify: `lib/query.js`
- Modify: `tests/query.test.js`
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `app.js`
- Modify: `data.js`

**Interfaces:**
- Consumes: existing `sortTitles(titles, sortKey)` (Task 3), `state`/`getVisibleTitles`/`refresh` (Tasks 7-8), `openTitleModal` (Task 9).
- Produces: `sortTitles(titles, 'status')` — nothing later depends on this beyond this task.

**Design notes:**
- **Season info** is a new, optional, unvalidated field: `seasonInfo: string | null`, meant for `category: "series" | "anime"` titles. It is NOT added to `lib/validate.js`'s required-field checks — it's free text Claude fills in when it knows something concrete ("2 сезона вышло, 3-й анонсирован на 2026"), and simply absent/`null` for everything else. Shown in the title modal only when present.
- **Backlog-first sorting**: a new `sortTitles` mode, `'status'`, orders `in_progress` first, `queue` second, `done` last (stable within each group). This becomes the new **default** sort (replacing `'added'`) so opening the app always surfaces active/queued titles first without the user having to change anything. A separate one-click **"Скрыть пройденное"** checkbox (same pattern as the existing "Ждут продолжения" checkbox) lets the user fully hide `done` titles when the list is long — this is an addition to `app.js`'s filter composition, not to `lib/query.js`'s `matchesFilters` (whose tested contract shouldn't change).

- [ ] **Step 1: Write the failing tests for `sortTitles(titles, 'status')`**

Append to `tests/query.test.js`:

```js
test('sortTitles by status puts in_progress first, queue second, done last', () => {
  var titles = [
    { title: 'A', status: 'done' },
    { title: 'B', status: 'queue' },
    { title: 'C', status: 'in_progress' }
  ];
  var sorted = sortTitles(titles, 'status');
  assert.deepEqual(sorted.map(function (t) { return t.title; }), ['C', 'B', 'A']);
});

test('sortTitles by status is stable for equal-priority items', () => {
  var titles = [
    { title: 'A', status: 'queue' },
    { title: 'B', status: 'queue' }
  ];
  var sorted = sortTitles(titles, 'status');
  assert.deepEqual(sorted.map(function (t) { return t.title; }), ['A', 'B']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/query.test.js`
Expected: FAIL — sorted order for the first new test comes back in original array order (`['A', 'B', 'C']`), not `['C', 'B', 'A']`, since `'status'` isn't a recognized `sortKey` yet and falls through to the `default`/`'added'` case.

- [ ] **Step 3: Add the `'status'` case to `sortTitles` in `lib/query.js`**

Add a `STATUS_PRIORITY` constant near the top of the factory function (alongside where `isReturning` etc. are defined), and a new `case` in the `switch` inside `sortTitles`, before the `case 'added':` line:

```js
  var STATUS_PRIORITY = { in_progress: 0, queue: 1, done: 2 };
```

```js
      case 'status':
        return copy.sort(function (a, b) { return STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]; });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/query.test.js`
Expected: PASS — 12 tests passing (10 from Task 3 + 2 new)

- [ ] **Step 5: Update `index.html`**

In `<select id="sort-select">`, add a new first option and make it the default-selected one (replace the existing block):

```html
    <select id="sort-select" class="toolbar__select">
      <option value="status" selected>Актуальное сначала</option>
      <option value="added">По дате добавления</option>
      <option value="name">По названию</option>
      <option value="year">По году</option>
      <option value="rating">По оценке</option>
    </select>
```

Add a second checkbox right after the existing "Ждут продолжения" one, inside `.toolbar`:

```html
    <label class="toolbar__checkbox">
      <input id="hide-done-filter" type="checkbox"> Скрыть пройденное
    </label>
```

In the modal body, add a new `<p>` between `#modal-meta` and `#modal-synopsis`:

```html
        <p id="modal-seasons" class="modal__seasons" hidden></p>
```

- [ ] **Step 6: Style `.modal__seasons` in `styles.css`**

Add a small rule reusing the existing muted-text treatment already used for `.modal__meta` (same font-size/color token, do not introduce a new hardcoded color) — e.g. matching `.modal__meta`'s `color: var(--text-muted)` and font-size, with a little top margin so it reads as a distinct line from the meta row above it and the synopsis below it.

- [ ] **Step 7: Wire it up in `app.js`**

Change the initial `state` line to default to the new sort and add the hide-done flag:

```js
  var state = { category: 'all', status: 'all', genre: 'all', returning: false, hideDone: false, search: '', sort: 'status' };
```

Change `getVisibleTitles` to also apply the hide-done filter (add the `.filter(...)` before the existing one, or fold the condition into the existing filter callback — either is fine as long as both conditions apply):

```js
  function getVisibleTitles() {
    var titles = titlesForCategory(state.category).filter(function (t) {
      if (state.hideDone && t.status === 'done') return false;
      return BacklogQuery.matchesFilters(t, { status: state.status, genre: state.genre, returning: state.returning })
        && BacklogQuery.matchesSearch(t, state.search);
    });
    return BacklogQuery.sortTitles(titles, state.sort);
  }
```

Add the new checkbox's listener alongside the existing `#returning-filter` one:

```js
  document.getElementById('hide-done-filter').addEventListener('change', function (e) {
    state.hideDone = e.target.checked;
    refresh();
  });
```

In `openTitleModal`, add season-info display right after the existing `modal-meta` block (after the `document.getElementById('modal-meta').textContent = meta;` line):

```js
    var seasonsEl = document.getElementById('modal-seasons');
    seasonsEl.textContent = title.seasonInfo ? 'Сезоны: ' + title.seasonInfo : '';
    seasonsEl.hidden = !title.seasonInfo;
```

- [ ] **Step 8: Add `seasonInfo` to the four series/anime titles already in `data.js`**

Add a `seasonInfo` field (a short Russian sentence) to each of the 4 existing `category: "series"`/`category: "anime"` seed entries — `frieren-2023`, `re-zero-starting-life-in-another-world-2016`, `the-boys-2019`, `ted-lasso-2020` — right after each one's `airingStatus` field. Use your own best current knowledge of each show's season status (how many seasons/parts have aired, whether/when a next one is confirmed) — this is exactly the kind of free-text enrichment the field exists for, so write real, reasonably accurate sentences rather than placeholders. Leave every other field on those 4 objects unchanged.

- [ ] **Step 9: Verify manually in the browser**

Reload `index.html`. Expected: the sort dropdown opens already on "Актуальное сначала" and the grid order reflects it (any `in_progress`/`queue` seed titles before `done` ones within the currently visible set); checking "Скрыть пройденное" immediately hides all `status: done` cards and unchecking restores them; opening a modal for one of the 4 enriched series/anime titles shows a "Сезоны: …" line between the meta line and the synopsis, while opening a movie/game title's modal shows no such line (element stays `hidden`).

- [ ] **Step 10: Commit**

```bash
git add lib/query.js tests/query.test.js index.html styles.css app.js data.js
git commit -m "feat: add season info display and backlog-first sorting"
```

---

### Task 12: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# Бэклог

Локальная галерея личного бэклога игр, сериалов, кино и аниме. Статический сайт — просто откройте `index.html` в браузере.

## Как это устроено

- `data.js` — базовый каталог тайтлов (редактируется вручную/через Claude).
- Статус просмотра, личная оценка и удаление тайтла редактируются прямо в интерфейсе и хранятся в `localStorage` вашего браузера (ключи `backlog-overrides`, `backlog-deleted`) поверх `data.js`.
- Чтобы сбросить все локальные правки и вернуться к состоянию `data.js` "as is", очистите эти два ключа в localStorage (DevTools → Application → Local Storage), либо в консоли браузера: `localStorage.removeItem('backlog-overrides'); localStorage.removeItem('backlog-deleted');`.

## Как добавить новый тайтл

Просто попросите Claude добавить тайтл по названию — он найдёт год/жанры/синопсис/постер, скачает постер в `images/covers/`, допишет объект в `data.js` по схеме ниже и проверит каталог через `node tools/validate-data.js`.

Схема одного тайтла (см. `lib/validate.js` для точных правил):

```js
{
  id: "slug-year",                              // lib/slug.js makeId(title, year)
  title: "Название",
  category: "game" | "series" | "movie" | "anime",
  status: "queue" | "in_progress" | "done",
  airingStatus: "ongoing" | "completed" | null,  // null для game/movie
  year: 2024,
  genres: ["жанр1", "жанр2"],
  rating: null,                                   // 1-10 или null, задаётся пользователем в UI
  synopsis: "Краткое описание.",
  cover: "images/covers/slug-year.jpg",
  seasonInfo: "Вышло 2 сезона, 3-й анонсирован на 2026."  // опционально, только для series/anime, не валидируется
}
```

Также можно быстро добавить тайтл прямо в интерфейсе (только название + категория) — он появится как «черновик» с плейсхолдером, а полные данные (жанры/год/постер/описание/seasonInfo) вы допишете тем же способом, попросив Claude, когда будете готовы — черновик автоматически исчезнет, как только в `data.js` появится тайтл с тем же id.

## Тесты

`lib/` — чистая логика (слаги, фильтры/сортировка, localStorage-оверлей, валидация) — покрыта тестами на встроенном тест-раннере Node (без установки зависимостей):

```bash
node --test tests/*.test.js
node tools/validate-data.js
```

(Note: the bare `node --test tests/` without a glob fails with `MODULE_NOT_FOUND` on this machine's Node version when run from this path — always use the `tests/*.test.js` glob form.)
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```

---

### Task 13: Full golden-path QA pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `node --test tests/*.test.js` (the bare `node --test tests/` without a glob fails with `MODULE_NOT_FOUND` on this machine — always use the glob form)
Expected: all tests pass (36 as of Task 20; count grows if later tasks add more).

Run: `node tools/validate-data.js`
Expected: `OK: 8 titles, no errors.`

- [ ] **Step 2: Manual browser walkthrough**

Using the browser tool, open `index.html` and verify, in order: (1) all 4 category tabs switch the grid and update their counters; (2) search narrows results by substring; (3) status/genre/"ждут продолжения" filters combine correctly with search; (4) sort by name/year/rating changes card order without erroring; (5) clicking a card opens the modal with correct data; (6) changing status and rating in the modal updates the card and survives a page reload; (7) delete asks for confirmation and, once confirmed, removes the card permanently (survives reload); (8) resizing to mobile width (375px) keeps the layout usable with no horizontal scroll.

- [ ] **Step 3: Fix any issues found, then commit**

```bash
git add -A
git commit -m "test: verify golden path end-to-end"
```

(Skip this commit if Step 2 found nothing to fix.)

---

## Phase B — Populate the full catalog

Phase A ships a fully working app with 8 real seed titles. The remaining ~110 titles from `показываю даше мир.xlsx` (plus the additions agreed with the user — see the design spec's mapping table) are populated in this phase, batched by category so each batch is an independently reviewable task. Every batch follows the same five-step recipe and is **not** pre-written with exact data, because getting accurate year/genre/synopsis/poster/airing-status requires a live web search per title — the batch tasks below specify exactly *which* titles and give a known-facts starting point, not placeholder content.

**Batch recipe (applies to every task in this phase):**

0. **The `title` field must be the Russian official/prokatny (theatrical/streaming distribution) title** — the name used on Кинопоиск, official Netflix/Wakanim/etc. Russian pages, or however it's officially known to a Russian-speaking audience (e.g. "Пацаны" not "The Boys", "Клинок, рассекающий демонов" not "Demon Slayer") — NOT the English/Japanese original. The only exception: games without any official Russian localized title keep their common English name (e.g. "Baldur's Gate 3"), since Russian gamers overwhelmingly use the English name for those. Verify the Russian title via web search per entry — don't guess or transliterate casually.
1. For each title in the task's list, web-search to confirm/find: the Russian title (per item 0), release year, 2-3 genre tags (Russian), a 1-2 sentence Russian synopsis, current `airingStatus` (`ongoing`/`completed`) if the category is `series`/`anime`, and a poster image.
2. For `series`/`anime` titles specifically, also fill in `seasonInfo` (a short free-text Russian sentence — see Task 21): how many seasons/parts have released and whether/when a next one is confirmed, e.g. `"Вышло 2 сезона, 3-й анонсирован на 2026."`. Omit the field (or set `null`) only if you genuinely can't find anything current — don't guess a date.
3. Compute `id` via the convention `lib/slug.js`'s `makeId(title, year)` (or by hand following the same rule: lowercase, transliterate Cyrillic, hyphenate).
4. Download the poster to `images/covers/<id>.jpg` (or `.png`/`.webp` matching the source) and append the title object to the `TITLES` array in `data.js`, matching the schema enforced by `lib/validate.js`.
5. Run `node tools/validate-data.js` — expected `OK: <N> titles, no errors.` Fix any reported errors before moving on.
6. Commit, e.g. `git commit -m "data: add anime batch"`.

Do not mark a title `status: "done"` if it has not actually released yet as of 2026-08-16 — for unreleased/announced-only entries, use `status: "queue"` regardless of what the batch note below says, since "done" means the user has already watched/played it.

### Task 14: Data batch — Аниме (18 titles)

All `status: done` (already watched) unless noted, all `category: anime`:

- Tengen Toppa Gurren Lagann (2007) — done, `airingStatus: completed`
- Demon Slayer: Kimetsu no Yaiba (2019) — done, `airingStatus: ongoing` (final-arc movies still releasing)
- Ride Your Wave (2019, movie) — done, `airingStatus: completed`
- Witch Hat Atelier (2025, only season 1 released) — done, `airingStatus: ongoing`
- Cyberpunk: Edgerunners (2022) — status: queue, `airingStatus: completed`
- A Silent Voice (2016, movie) — queue, `airingStatus: completed`
- Josee, the Tiger and the Fish (2020, movie) — queue, `airingStatus: completed`
- Your Name (2016, movie) — queue, `airingStatus: completed`
- Devil May Cry (2025, Netflix) — queue, `airingStatus: ongoing`
- Shaman King (2021 remake) — queue, `airingStatus: completed`
- JoJo's Bizarre Adventure — queue, `airingStatus: ongoing`
- Noragami — queue, `airingStatus: ongoing` (verify via search — may have changed)
- Violet Evergarden — queue, `airingStatus: completed`
- That Time I Got Reincarnated as a Slime — queue, `airingStatus: ongoing`
- Hell's Paradise: Jigokuraku — queue, `airingStatus: ongoing`
- Chainsmoker Cat (Яни Нэко / Chainsaw... note: working title "Табакошка", manga by NyanNyanFactory, anime adaptation by Bibury Animation Studios premiering July 2026) — queue, `airingStatus: ongoing`
- The title behind the working name "И наступит рассвет" — a newly announced/aired anime as of 2026; web-search this exact Russian phrase plus "аниме 2026" to identify its real title before adding it — queue, `airingStatus: ongoing`
- Suzume (2022, movie) — queue, `airingStatus: completed`

Follow the batch recipe above for all 18.

### Task 15: Data batch — Сериалы (8 titles)

All `category: series`, `status: queue` (not yet watched) unless noted:

- Avatar: The Last Airbender (2005, original animated series) — `airingStatus: completed`
- Avatar: The Last Airbender (2024, Netflix live-action) — `airingStatus: ongoing` (renewed)
- Castlevania + Castlevania: Nocturne (Netflix) — `airingStatus: ongoing`
- The Legend of Vox Machina — `airingStatus: ongoing`
- The Mighty Nein (Amazon, Critical Role campaign 2 adaptation) — `airingStatus: ongoing`
- Money Heist / La Casa de Papel — `airingStatus: completed`
- Gen V — `airingStatus: ongoing`
- Masters of the Universe: Revelation / Revolution (Netflix animated) — `airingStatus: completed`

Follow the batch recipe above for all 8. Note: give the two "Avatar: The Last Airbender" entries distinct ids (e.g. append `-2005` / `-2024`) since they'd otherwise slugify identically.

### Task 16: Data batch — Кино (29 titles)

All `category: movie`, `airingStatus: null`. Status `done` for the first two (Spider-Man entries — from the originally-marked-done "чп гарфилда" row); `queue` for the rest:

- The Amazing Spider-Man (2012) — done
- The Amazing Spider-Man 2 (2014) — done
- Superman (2025, dir. James Gunn) — queue (verify release date has passed; if not yet released by the time this task runs, keep `queue`)
- The Gentlemen (2019, dir. Guy Ritchie) — queue
- The Man from U.N.C.L.E. (2015) — queue
- EuroTrip (2004) — queue
- The Hobbit (trilogy, treat as one card) — queue
- Drive (2011) — queue
- The Batman (2022) — queue
- Bullet Train (2022) — queue
- Snatch (2000) — queue
- The Fountain of Youth (2025, dir. Guy Ritchie) — queue
- Jay and Silent Bob Strike Back (2001) — queue
- Masters of the Universe (2026 live-action) — queue (do not mark done if unreleased)
- The Village (2004, Russian title "Таинственный лес") — queue
- Orphan (2009) — queue
- Case 39 (2009) — queue
- House at the End of the Street (2012) — queue
- The Skeleton Key (2005) — queue
- Клаустрофобы (2018, Russian horror film) — queue
- Red Dragon (2002) — queue
- Hannibal (2001) — queue
- Hannibal Rising (2007) — queue
- The Big Lebowski (1998) — queue
- Alien (1979) — queue
- Major Payne (1995) — queue
- Tucker & Dale vs. Evil (2010) — queue
- Lilo & Stitch (2025 live-action) — queue
- Baby Driver (2017) — queue

Follow the batch recipe above for all 29.

### Task 17: Data batch — Игры (4 titles)

All `category: game`, `status: queue`, `airingStatus: null`:

- Split Fiction (2025)
- Unravel Two (2018)
- Divinity: Original Sin (2014)
- Divinity: Original Sin II (2017)

Follow the batch recipe above for all 4.

### Task 18: Data batch — Кино: MCU (партия внутри «Кино»)

Not a separate section or category — these are ordinary `category: "movie"` entries that land in the same "Кино" tab and grid as Task 16's titles, just split into their own task because of volume. The originally-marked-done "марвел" row is replaced by the full Marvel Cinematic Universe film catalog, all `category: movie`, `airingStatus: null`. Web-search "list of Marvel Cinematic Universe films" (e.g. Wikipedia) first to get the authoritative, current list — the list below (Iron Man 2008 through Deadpool & Wolverine 2024, plus 2025 releases known at spec time: Captain America: Brave New World, Thunderbolts*, The Fantastic Four: First Steps) is a starting reference, not exhaustive; add any films you find that are missing, and do **not** include unreleased/cancelled films (e.g. don't mark an announced-but-unreleased film as `status: done`).

For every released film in the confirmed list: `status: done`. For any film in the list that has not released as of 2026-08-16: `status: queue`.

Follow the batch recipe above. Given the size (~35+ films), split the web-research/entry work into a few sittings if needed, running `node tools/validate-data.js` and committing after each sitting rather than only once at the very end.

### Task 19: Data batch — Сериалы: MCU (партия внутри «Сериалы»)

Not a separate section or category — these are ordinary `category: "series"` entries that land in the same "Сериалы" tab and grid as Task 15's titles, just split into their own task because of volume. The Disney+ MCU series catalog, all `category: series`. Web-search "list of Marvel Cinematic Universe television series" first for the authoritative, current list — WandaVision, Loki (S1-S2), The Falcon and the Winter Soldier, Hawkeye, Moon Knight, Ms. Marvel, She-Hulk: Attorney at Law, Secret Invasion, Echo, Agatha All Along, Daredevil: Born Again, Ironheart, and any 2025/2026 additions found via search (e.g. Wonder Man, Marvel Zombies) are a starting reference, not exhaustive.

For each series, set `airingStatus` based on whether it has been renewed/has more seasons confirmed (`ongoing`) or is a concluded/limited series with no more seasons announced (`completed`) — verify per-title via search rather than guessing, since renewal status changes over time. `status: done` for already-released seasons the catalog implies were "watched" per the original excel `марвел = готово` mark; `status: queue` for anything not yet released as of 2026-08-16.

Follow the batch recipe above, committing incrementally.

---

## Phase C — UX refinements & data corrections

Added mid-execution from user feedback while Phase B was in progress. Independent of Phase B's remaining batches (18-19) — can run before, after, or interleaved with them.

### Task 22: Rating stars + status quick-actions

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `app.js`

**Why:** a `<select>` for a 1-10 rating and a `<select>` for status are functional but unpleasant — the user wants a star-click rating and small, clearly-labeled status buttons, including a way to change status **without opening a title's modal** (directly from its grid card).

- [ ] **Step 1: Replace the rating `<select>`/number input with a 10-star widget in the modal**

Replace the existing `<label class="modal__field">Моя оценка<input id="modal-rating" ...></label>` block in `index.html` with a row of 10 star buttons inside a container kept at id `modal-rating` (so `app.js` selectors referencing `#modal-rating` for reading/writing rating still resolve to something sensible — adjust the read/write logic accordingly, see Step 3):

```html
<div class="modal__field">
  Моя оценка
  <div id="modal-rating" class="star-rating" role="radiogroup" aria-label="Оценка от 1 до 10">
    <button type="button" class="star-rating__star" data-value="1" aria-label="1">★</button>
    <button type="button" class="star-rating__star" data-value="2" aria-label="2">★</button>
    <button type="button" class="star-rating__star" data-value="3" aria-label="3">★</button>
    <button type="button" class="star-rating__star" data-value="4" aria-label="4">★</button>
    <button type="button" class="star-rating__star" data-value="5" aria-label="5">★</button>
    <button type="button" class="star-rating__star" data-value="6" aria-label="6">★</button>
    <button type="button" class="star-rating__star" data-value="7" aria-label="7">★</button>
    <button type="button" class="star-rating__star" data-value="8" aria-label="8">★</button>
    <button type="button" class="star-rating__star" data-value="9" aria-label="9">★</button>
    <button type="button" class="star-rating__star" data-value="10" aria-label="10">★</button>
  </div>
</div>
```

- [ ] **Step 2: Replace the status `<select>` with 3 buttons in the modal**

Replace `<label class="modal__field">Статус<select id="modal-status">...</select></label>` with:

```html
<div class="modal__field">
  Статус
  <div id="modal-status" class="status-buttons" role="radiogroup" aria-label="Статус">
    <button type="button" class="status-buttons__btn" data-status="queue">В очереди</button>
    <button type="button" class="status-buttons__btn" data-status="in_progress">В процессе</button>
    <button type="button" class="status-buttons__btn" data-status="done">Готово</button>
  </div>
</div>
```

(The third label, "Готово", replaces "Пройдено" — see Task 23, which handles the rename everywhere else; if Task 23 hasn't run yet when you do this step, use "Готово" here anyway so the two tasks agree once both land — whichever runs second should find the other's label already matching and do nothing.)

- [ ] **Step 3: Update `app.js`'s modal logic for the new widgets**

Replace the rating-read/write and status-read/write logic. In `openTitleModal`, replace `document.getElementById('modal-status').value = title.status;` and `document.getElementById('modal-rating').value = title.rating || '';` with calls that visually reflect state on the new button/star widgets (e.g. toggle an `is-active`/`is-filled` class on the matching `.status-buttons__btn`/`.star-rating__star` elements based on `title.status`/`title.rating`). Replace the old `#modal-status` `change` listener and `#modal-rating` `change` listener with `click` listeners on `.status-buttons__btn` and `.star-rating__star` respectively:
  - Status button click: read `event.target.dataset.status`, call `BacklogStorage.setOverride(window.localStorage, id, { status: ... })`, update the button active-states in place (or just call `openTitleModal(id)` again to redraw), and call `refresh()`.
  - Star click: read `event.target.dataset.value` as an integer. If it equals the title's *current* rating, clear the rating (`setOverride(..., { rating: null })`) — this is a toggle-off so users can un-rate something; otherwise set it to the clicked value. Update the star fill states and call `refresh()`.

- [ ] **Step 4: Add status quick-actions to grid cards**

Add the same 3-button status control (or a visually compact variant — smaller buttons/icons, your design call) to each card in `cardHtml`/`renderGrid`, positioned so it doesn't visually compete with the poster (e.g. revealed on hover for desktop, always visible in a compact form for touch devices — mirror the `@media (hover: none)` pattern already established in `styles.css` from Task 11's touch-device work). Clicking a card's status button must call `event.stopPropagation()` (or otherwise avoid triggering the card's own click-to-open-modal handler) and must not require opening the modal — it should update `localStorage` and the card's own displayed status badge immediately via the existing `refresh()` mechanism.

- [ ] **Step 5: Design pass**

Invoke the `frontend-design` skill before finalizing the visual treatment of the stars, status buttons, and card hover overlay — match the dark cinematic system already established in Task 11 (reuse existing tokens, don't introduce a new color language). The star widget in particular should read as elegant, not like 10 default HTML buttons in a row — consider size, spacing, hover/fill color (likely the existing `--accent`/`--accent-bright` tokens), and transition polish consistent with the rest of the app.

- [ ] **Step 6: Verify manually in the browser**

Confirm: clicking a star sets the rating and fills stars up to that value; clicking the same star again clears the rating; clicking a status button in the modal changes status immediately and updates the card underneath; a card's own status buttons change its status without opening the modal; keyboard/focus states are visible on all new buttons; mobile layout (375px) still works with no horizontal scroll.

- [ ] **Step 7: Commit**

```bash
git add index.html styles.css app.js
git commit -m "feat: replace rating/status selects with stars and quick-action buttons"
```

---

### Task 23: Status label rename + genre filter scoped to category

**Files:**
- Modify: `app.js`
- Modify: `index.html`

**Why:** "Пройдено" reads oddly for a mixed games/movies/series/anime backlog (works for games, awkward for a movie). Separately, the genre `<select>` currently lists every genre in the whole catalog regardless of which category tab is active, so switching to "Игры" still offers "комедия" as a filter option even though no game in the catalog has that genre.

- [ ] **Step 1: Rename the "done" status label**

Replace every user-facing occurrence of "Пройдено" with **"Готово"** (short, neutral, works across games/movies/series/anime alike, and echoes the original spreadsheet's "готово" column) — in `app.js`'s `STATUS_LABELS` map, in `index.html`'s `#status-filter` `<option value="done">`, and in the status buttons markup from Task 22 Step 2 if that task hasn't landed yet (if it has, it already says "Готово" — nothing to do there).

- [ ] **Step 2: Scope the genre filter to the active category**

Change `populateGenreFilter()` in `app.js` to accept the current category and only collect genres from titles in that category:

```js
  function populateGenreFilter() {
    var select = document.getElementById('genre-filter');
    select.innerHTML = '<option value="all">Любой жанр</option>';
    var genres = {};
    titlesForCategory(state.category).forEach(function (t) { t.genres.forEach(function (g) { genres[g] = true; }); });
    Object.keys(genres).sort().forEach(function (g) {
      var option = document.createElement('option');
      option.value = g;
      option.textContent = g;
      select.appendChild(option);
    });
  }
```

Call `populateGenreFilter()` again whenever the category tab changes — add it to `onTabClick`, right after `state.category` is updated and before `refresh()`. Also reset the genre filter to "all" on category change, since a previously-selected genre may not exist in the new category's title set:

```js
    state.genre = 'all';
    populateGenreFilter();
```

(add these two lines to `onTabClick`, in that order, right after `state.category = button.getAttribute('data-category');`)

- [ ] **Step 3: Verify manually in the browser**

Confirm: the status filter dropdown and any status buttons now read "Готово" instead of "Пройдено" everywhere; switching to the "Игры" tab shows only genres that actually appear on game titles in the genre filter (e.g. "кооператив", "ролевая игра" — not "комедия" unless a game in the catalog genuinely has that tag); switching tabs resets the genre filter to "Любой жанр" rather than leaving a stale, now-invalid selection.

- [ ] **Step 4: Commit**

```bash
git add app.js index.html
git commit -m "fix: rename done status label, scope genre filter to active category"
```

---

### Task 24: Compact season-info format

**Files:**
- Modify: `styles.css`
- Modify: `app.js`
- Modify: `data.js`

**Why:** the current `seasonInfo` values are long prose paragraphs ("Вышло три сезона: первый в 2016-м, второй в 2020–2021-м..."). The user wants something scannable: a short season-count line, then one line per confirmed/upcoming season, e.g.:

```
4 сезона
Сезон 5 — дата выхода: март 2027
Сезон 6 — дата выхода ещё не анонсирована
```

- [ ] **Step 1: Render newlines in the season-info display**

In `styles.css`, add `white-space: pre-line;` to the existing `.modal__seasons` rule (this makes literal `\n` characters in the string render as line breaks, without needing any HTML changes).

- [ ] **Step 2: Drop the "Сезоны: " prefix in `app.js`**

In `openTitleModal`, change `seasonsEl.textContent = title.seasonInfo ? 'Сезоны: ' + title.seasonInfo : '';` to `seasonsEl.textContent = title.seasonInfo || '';` — the new format's first line already states the season count, so the old prefix is redundant.

- [ ] **Step 3: Reformat every existing `seasonInfo` value in `data.js`**

Every current non-null `seasonInfo` string in `data.js` (there are about two dozen as of this task) needs to be rewritten from a prose paragraph into the compact multi-line format: first line is a short season/part count (e.g. `"4 сезона"`, `"3 сезона и фильм"`, `"Полностью завершён, 3 сезона"` for concluded shows — adapt wording naturally per title), followed by one line per confirmed-but-unaired season with what's known about its release timing (`"Сезон 5 — дата выхода: март 2027"`, or `"Сезон 6 — дата выхода ещё не анонсирована"` when a season is confirmed but undated). Shows with no more seasons coming just get the one count line, nothing more. All the underlying facts are already present in the existing prose — this is a reformatting pass using information you already have in the file, not new research (though double-check anything that reads ambiguously). Use `\n` inside the JS string literal for line breaks (e.g. `seasonInfo: '4 сезона\nСезон 5 — премьера в марте 2027 года.'`).

- [ ] **Step 4: Validate and verify**

Run `node tools/validate-data.js` (schema doesn't care about the field's internal formatting, so this just confirms nothing else broke) and `node --test tests/*.test.js`. Open a few series/anime titles' modals in the browser and confirm the season info now renders as short stacked lines, not a paragraph.

- [ ] **Step 5: Commit**

```bash
git add styles.css app.js data.js
git commit -m "feat: compact multi-line season info format"
```

---

### Task 25: Poster crop/fit audit

**Files:** none pre-specified — this task edits `data.js`/`images/covers/` only for entries found to need a replacement image.

**Why:** cards display covers at a fixed 2:3 aspect ratio via `object-fit: cover`, which crops any image that isn't already close to 2:3. Posters sourced during Phase B batches weren't checked against this — some may be landscape stills, square thumbnails, or oddly-cropped, which look bad once forced into a portrait card.

- [ ] **Step 1: Visually audit every cover in the browser**

Open the app and inspect the full grid (all 4 category tabs) at desktop width. For each card, judge whether the poster reads as a natural, un-mutilated portrait image — faces/logos/key art not cut off awkwardly, no obvious "this was a 16:9 still forced into 2:3" look. Zoom in on any card that looks suspicious.

- [ ] **Step 2: Replace flagged covers**

For every title flagged in Step 1, web-search for a proper portrait/poster-format image for that specific title (most films/shows/anime have an official portrait poster even if the first image found wasn't one — search "<title> poster" rather than "<title> still" or "<title> screenshot"), download it to the same `images/covers/<id>.<ext>` path (overwriting the old file — update the extension in `data.js`'s `cover` field too if it changes), and re-check it in the browser.

- [ ] **Step 3: Verify and commit**

Run `node tools/validate-data.js` to confirm nothing broke. Re-open the grid and confirm all previously-flagged cards now look right. Commit any replaced images and `data.js` changes:

```bash
git add data.js images/covers
git commit -m "fix: replace poorly-cropped cover images"
```

(If nothing needed replacing, no commit is needed — just report that the audit found the existing covers acceptable.)

---

### Task 26: Data fixes — split combined franchise entries, resolve the 2026 Aang title

**Files:**
- Modify: `data.js`
- Create: new `images/covers/*` files for the split-off entries

**Why:** the user clarified two things: (1) "Кастлвания" and "Кастлвания: Ноктюрн" are different works in the same universe and should be separate cards, not one combined entry — same for "Властелины вселенной: Откровение"/"Революция"; (2) what they meant by "Легенда об Аанге" in the original spreadsheet was specifically **"Легенда об Аанге: Последний маг воздуха (2026)"** — a title not yet in the catalog.

- [ ] **Step 1: Split the Castlevania combined entry**

Find the `castlevania-2017` entry in `data.js` (currently titled "Кастлвания / Кастлвания: Ноктюрн", combining both shows). Replace it with two separate entries — one for the original *Castlevania* (2017-2021, 4 seasons, completed) and one for *Castlevania: Nocturne* (2023-, status per current renewal info — the existing combined entry's `seasonInfo` already has the research: Nocturne was in limbo as of early 2025 pending Netflix's renewal decision; re-verify via a quick search since time has passed). Give each its own `id` (e.g. `castlevania-2017` for the original, `castlevania-nocturne-2023` for the sequel), Russian `title`, `seasonInfo` (reformatted per Task 24's compact style if that task has landed, prose is fine otherwise), and its own poster (search for and download a distinct poster for each — do not reuse the same image for both).

- [ ] **Step 2: Split the Masters of the Universe combined entry**

Find the `masters-of-the-universe-revelation-2021` entry (currently titled "Властелины вселенной: Откровение / Революция"). Replace it with two separate entries — one for *Masters of the Universe: Revelation* (2021) and one for *Masters of the Universe: Revolution* (2024) — each with its own `id`, Russian title, and a distinct poster.

- [ ] **Step 3: Add "Легенда об Аанге: Последний маг воздуха (2026)"**

Web-search this exact title to confirm what it is (format/category — likely an animated film or series; the existing two Avatar entries in the catalog, the 2005 original series and the 2024 Netflix live-action series, are separately correct and should NOT be removed — this is a third, additional entry) and add it with real year/genres/synopsis/poster/status per the usual recipe (`status: "queue"` unless you confirm the user has actually already watched it, which is unlikely for a 2026 release added just now).

- [ ] **Step 4: Validate and verify**

Run `node tools/validate-data.js` and `node --test tests/*.test.js`. Open the grid in the browser and confirm: Castlevania and Castlevania: Nocturne appear as two distinct cards with two distinct posters; the two Masters of the Universe entries appear as two distinct cards with two distinct posters; the new Aang 2026 title appears alongside (not replacing) the existing two Avatar entries.

- [ ] **Step 5: Commit**

```bash
git add data.js images/covers
git commit -m "data: split Castlevania/MOTU into separate cards, add Легенда об Аанге (2026)"
```

---

## Phase D — New features, cross-device sync, and going live

Added at the user's request once the catalog was complete (143 titles) and the final whole-branch review passed. Four independent UI features (Tasks 27-30) can run in any order; Task 31 (Supabase sync) depends on the user having run the SQL schema in their own Supabase project; Task 32 (deploy) depends on 31.

**Global addition to constraints for this phase:** Task 31 introduces the project's first external runtime dependency (the Supabase JS client, loaded via `<script>` tag) — a deliberate, user-approved exception to the "no external dependencies" rule, needed because real cross-device sync requires a backend and this project has none.

### Task 27: "Что посмотреть?" random pick button

**Files:**
- Modify: `lib/query.js`
- Modify: `tests/query.test.js`
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `app.js`

**Why:** the single most common backlog problem — "I don't know what to pick" — deserves a one-click answer.

- [ ] **Step 1: Add `pickRandom` to `lib/query.js`**

Add a small pure function and export it:
```js
  function pickRandom(titles) {
    if (!titles.length) return null;
    return titles[Math.floor(Math.random() * titles.length)];
  }
```
Add to the returned object: `pickRandom: pickRandom`.

- [ ] **Step 2: Tests**

Append to `tests/query.test.js`:
```js
test('pickRandom returns null for an empty list', () => {
  assert.equal(pickRandom([]), null);
});

test('pickRandom always returns an element from the list', () => {
  var titles = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  for (var i = 0; i < 20; i++) {
    var picked = pickRandom(titles);
    assert.ok(titles.indexOf(picked) !== -1);
  }
});
```
Update the `require` line to include `pickRandom`.

- [ ] **Step 3: Add the button**

Add a button to `index.html`'s toolbar area (placement/label your call — something like `<button id="random-pick" class="toolbar__random" type="button">Что посмотреть?</button>`).

- [ ] **Step 4: Wire it up in `app.js`**

On click: pick randomly from titles in the currently active category tab (`titlesForCategory(state.category)`) whose `status !== 'done'` (candidates worth watching — include both `queue` and `in_progress`, since "what should I watch" also covers "which of these half-finished things should I get back to"). If there are no candidates, do something sensible (e.g. a brief inline message — your call, don't just silently no-op). Otherwise call `openTitleModal(picked.id)` — reuses the existing modal, so the payoff is immediate. Ignore the currently active filters (search/genre/status/returning) so the pool is never accidentally empty because of an unrelated filter the user forgot was on — category tab is the only scope that applies.

- [ ] **Step 5: Design pass + verify**

Style the button to fit the established system (reuse tokens, don't clash — a `frontend-design`-guided pass is worth it since this is a headline feature, but keep it proportionate: a button, not a new visual subsystem). Verify: click on "Всё" picks from the whole non-done catalog; click on "Игры" only picks games; repeated clicks vary the result; a category with zero non-done titles is handled gracefully.

- [ ] **Step 6: Commit**

```bash
git add lib/query.js tests/query.test.js index.html styles.css app.js
git commit -m "feat: add random-pick 'what to watch' button"
```

---

### Task 28: Multi-select genre filter

**Files:**
- Modify: `lib/query.js`
- Modify: `tests/query.test.js`
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `app.js`

**Why:** the genre filter currently only allows picking one genre at a time; the user wants to filter by several at once (e.g. "комедия" OR "драма").

- [ ] **Step 1: Change `matchesFilters`'s genre handling in `lib/query.js`**

`filters.genre` becomes an array of selected genres (empty array or `undefined`/`'all'` means no filter). A title matches if it has AT LEAST ONE of the selected genres (OR semantics — the standard, expected behavior for a multi-select genre filter). Update the function body's genre branch accordingly, keeping backward compatibility unnecessary (this app has one caller — `app.js` — update it too in Step 4, don't maintain two code paths).

- [ ] **Step 2: Tests**

Update/add tests in `tests/query.test.js` for the new array-based genre filter: matches when the title has any one of several selected genres; does not match when it has none of them; empty/absent genre filter matches everything (unchanged behavior). Keep the existing single-genre test passing by adapting it to pass a one-element array, or add new tests alongside — your call, just make sure the suite reflects the real new contract.

- [ ] **Step 3: Replace the genre `<select>` with a multi-select control in `index.html`**

Replace `<select id="genre-filter">` with something that supports picking multiple genres — a checkbox dropdown/popover, a multi-select `<select multiple>`, or pill-style toggle buttons are all reasonable; this is a design call (see Step 5). Whatever markup you choose, `populateGenreFilter()` in `app.js` needs updating to match (it currently builds `<option>` elements for a single-select).

- [ ] **Step 4: Update `app.js`**

`state.genre` becomes an array (default `[]`). `getVisibleTitles()` passes it straight through to `matchesFilters`. The genre-filter change handler collects the current set of selected genres (however your Step 3 markup exposes that) instead of reading one `.value`. `onTabClick`'s reset-on-category-change logic (currently `state.genre = 'all'`) becomes `state.genre = []`.

- [ ] **Step 5: Design pass + verify**

Style to fit the system. Verify: selecting two genres shows titles matching either; deselecting all shows everything again; switching category tabs still resets the selection and repopulates available genres (Task 23's scoping behavior must keep working); the control is keyboard-operable.

- [ ] **Step 6: Commit**

```bash
git add lib/query.js tests/query.test.js index.html styles.css app.js
git commit -m "feat: multi-select genre filter"
```

---

### Task 29: Stats dashboard

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `app.js`

**Why:** a personal-trophy-case view — how much you've actually gotten through, broken down by category and genre — is a satisfying, low-effort payoff for a backlog tracker.

- [ ] **Step 1: Add an entry point**

Add a button/nav item to open a stats view — a new modal (reuse the existing `.modal`/`.modal__backdrop` pattern from the title-detail modal, or a dedicated one, your call) or a dedicated section. Placement: somewhere in the header/toolbar area, clearly separate from the category tabs so it doesn't read as a 5th category.

- [ ] **Step 2: Compute the stats**

In `app.js`, compute from `baseTitles()`: per-category counts (done/in_progress/queue/total per game/series/movie/anime), a genre breakdown (count of `done` titles per genre, across the whole catalog or per-category — your call, whichever reads more useful), and an overall total-done count. No new `lib/` module is required for this — it's presentation logic, not reusable pure logic with edge cases worth unit-testing in isolation, so implement it directly in `app.js`.

- [ ] **Step 3: Render it**

No charting library (this project has zero external dependencies apart from Task 31's Supabase client — don't add one here). Simple CSS bar-lists (a labeled row with a proportionally-widthed `<div>` bar) or inline SVG are both fine and match the existing design system. Design freedom here — invoke `frontend-design` if useful, keep it consistent with the dark cinematic system (reuse tokens).

- [ ] **Step 4: Verify**

Confirm the numbers are actually correct against the real catalog (spot-check: does "Готово" count per category match what the tab counters already show?). Confirm it opens/closes cleanly and doesn't conflict with the title-detail modal if you reused that pattern. Mobile layout check.

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css app.js
git commit -m "feat: add stats dashboard"
```

---

### Task 30: PWA (installable, offline-capable)

**Files:**
- Create: `manifest.webmanifest`
- Create: `sw.js`
- Create: `images/icon-192.png`, `images/icon-512.png` (or similar — app icons)
- Modify: `index.html`

**Why:** the app is already fully static — making it installable and offline-capable is nearly free and turns it into something that behaves like a native app on a phone.

- [ ] **Step 1: Create app icons**

Generate two simple square PNG icons (192×192 and 512×512) in the dark cinematic style established by the app (reuse the `--bg`/`--accent` palette — e.g. a simple monogram or abstract mark on the dark background; doesn't need to be elaborate, just on-brand and recognizable at small sizes). Save to `images/icon-192.png` and `images/icon-512.png`.

- [ ] **Step 2: Write `manifest.webmanifest`**

Standard web app manifest: `name`, `short_name`, `start_url: "."`, `display: "standalone"`, `background_color`/`theme_color` matching `--bg`, and the two icons with their sizes/types.

- [ ] **Step 3: Write `sw.js`**

A service worker that precaches the app shell (`index.html`, `styles.css`, `app.js`, `data.js`, `lib/*.js`, `manifest.webmanifest`) on install, and caches poster images (`images/covers/*`) opportunistically as they're fetched (cache-first for images — they don't change once added; a simple stale-while-revalidate or network-first strategy for the app shell files is more appropriate, since those DO change as the catalog is updated — your call on exact strategy, but don't cache-first the app shell so aggressively that the user never sees updates after a new deploy).

- [ ] **Step 4: Wire it up in `index.html`**

Add `<link rel="manifest" href="manifest.webmanifest">` and register the service worker (a small inline script or in `app.js`: `if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');`).

- [ ] **Step 5: Verify**

Use the browser's install prompt (or DevTools' Application panel) to confirm the manifest is valid and the app is installable. Test offline: load the app once online, then simulate offline mode and reload — confirm it still works (grid renders, images load from cache). Confirm a normal online reload still picks up changes (the caching strategy isn't accidentally permanent).

- [ ] **Step 6: Commit**

```bash
git add manifest.webmanifest sw.js images/icon-192.png images/icon-512.png index.html
git commit -m "feat: add PWA manifest and service worker"
```

---

### Task 31: Supabase-backed cross-device sync

**Files:**
- Modify: `index.html`
- Create: `lib/sync.js`
- Modify: `app.js`
- Modify: `README.md`

**Prerequisite:** the user has already created a Supabase project and run the schema SQL (three tables: `overrides`, `deleted_titles`, `drafts`, with RLS policies allowing open read/write via the anon key, and realtime enabled on all three). The user will supply the Project URL and publishable/anon key — use exactly what they provide, don't fabricate placeholder credentials.

**Why:** the user and their partner both use this app from separate devices; `localStorage` is per-browser, so today their status/rating/deletions/quick-adds never see each other. This task makes the "overrides/deleted/drafts" layer (everything Tasks 2/10/20 built on top of `localStorage`) shared, while `data.js` stays exactly as-is (still a static file, still only edited by Claude) — the base catalog was never the problem.

**Design — keep `lib/storage.js` untouched.** Its pure `applyOverlay`/`combineWithAdded`/`isSupersededBy`/`pruneAdded`/`getOverrides`/`getDeleted`/`getAdded`/`setOverride`/`deleteTitle`/`addTitle` functions all operate against anything shaped like `localStorage` (`getItem`/`setItem`) — they don't need to know where the data ultimately comes from. So: keep `window.localStorage` as the thing `lib/storage.js` reads/writes (zero changes to that already-well-tested module), and add a new thin `lib/sync.js` layer that (a) on page load, fetches the current state from Supabase and writes it into `localStorage` as a local mirror before the first `refresh()`, (b) after every local write (status/rating/delete/quick-add), also pushes that change to Supabase, and (c) subscribes to Supabase realtime changes and, when a change arrives that didn't originate from this tab, updates `localStorage` and calls `refresh()`.

- [ ] **Step 1: Add the Supabase client to `index.html`**

Add a CDN script tag for the Supabase JS client (check the current stable version — e.g. `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js` or similar, verify the exact URL works) before `app.js`'s script tag. This is the project's first and only external dependency — note it in `README.md`.

- [ ] **Step 2: Write `lib/sync.js`**

A UMD-style module (matching the pattern of `lib/slug.js`/`lib/storage.js`) exposing functions along these lines (exact names/shapes are your call, but the responsibilities are fixed):
- `createClient(url, key)` — thin wrapper around `window.supabase.createClient(url, key)`, so this can be mocked in tests without a real network call.
- `pullState(client)` — fetches all rows from `overrides`, `deleted_titles`, `drafts` and returns them shaped exactly like what `lib/storage.js` expects to read from `localStorage` (i.e. build the `backlog-overrides` object, `backlog-deleted` array, `backlog-added` array) — this is the piece that lets you just `localStorage.setItem` the results and let `lib/storage.js` do the rest unmodified.
- `pushOverride(client, id, patch)`, `pushDelete(client, id, wasInDrafts)`, `pushDraft(client, title)`, `pushRemoveDraft(client, id)` — write-through functions mirroring `lib/storage.js`'s own function names/semantics, called right after (or instead of directly calling) the corresponding `lib/storage.js` write, so both the local mirror and the remote table stay in sync.
- `subscribe(client, onChange)` — sets up realtime subscriptions on the three tables and calls `onChange()` whenever a remote change lands (debounce if the underlying library fires multiple events per write — you decide).

Write unit tests for the parts of this that don't require a real network call (e.g. `pullState`'s reshaping logic, given a fake Supabase client object whose query methods return canned data) in a new `tests/sync.test.js`, following this project's existing pattern of testing against fakes rather than mocking a whole SDK.

- [ ] **Step 3: Wire it into `app.js`**

On load, before the first `refresh()`: create the Supabase client (embed the URL/anon key the user supplied — these are meant to be public, safe to commit), call `pullState`, write the result into `localStorage` via the same keys `lib/storage.js` already uses, then proceed with the existing `populateGenreFilter()`/`refresh()` startup sequence. After every existing `BacklogStorage.setOverride`/`deleteTitle`/`addTitle` call site in `app.js` (status change, rating change, delete, quick-add), also call the matching `lib/sync.js` push function so the change reaches Supabase. Subscribe to remote changes and re-pull + re-render on them (guard against reacting to your own just-made writes causing a redundant flicker — a simple approach is fine, this doesn't need to be perfect).

- [ ] **Step 4: Handle the offline/no-network case gracefully**

If Supabase is unreachable (network down, bad credentials, etc.), the app should still work locally against `localStorage` (don't let a failed fetch/push throw an uncaught error that breaks the page) — this also keeps Task 30's PWA offline mode meaningful. A console warning on failure is fine; no user-facing error UI is required unless you think it's warranted.

- [ ] **Step 5: Verify**

Test with two separate browser contexts (two tabs in a private/incognito pair, or two different browsers) pointed at the same served instance: change a status in one, confirm it appears in the other within a few seconds without a manual reload. Test the offline fallback (block the Supabase domain or use devtools network throttling → offline) still lets local status changes work. Run `node --test tests/*.test.js` and `node tools/validate-data.js` to confirm nothing in the existing suite broke.

- [ ] **Step 6: Update `README.md`**

Document that the app now syncs via Supabase, briefly explain the architecture (data.js is static/Claude-edited, the overrides/deleted/drafts layer is shared via Supabase), and note the credentials are intentionally public (protected by RLS + a private URL, not secrecy of the key).

- [ ] **Step 7: Commit**

```bash
git add index.html lib/sync.js tests/sync.test.js app.js README.md
git commit -m "feat: sync status/rating/deletions/drafts via Supabase"
```

---

### Task 32: Deploy to GitHub Pages

**Files:** none pre-specified — this is a deployment/ops task, not a code task.

**Prerequisite:** Tasks 27-31 complete and verified. A GitHub repository for this project (the user may need to create one, or already has one — ask if unclear rather than assuming).

- [ ] **Step 1: Confirm/create the GitHub repository**

If the local repo has no `origin` remote yet, this needs the user's input (they either already have a repo in mind, or need to create one on GitHub — this is not something Claude can do without the user's account access). Get the repo URL, add it as `origin`, push `master`/`main`.

- [ ] **Step 2: Enable GitHub Pages**

Via the repo's Settings → Pages, set the source to deploy from the branch (`master`/`main`), root directory (this is a static site with no build step, so "deploy from branch" is the simplest zero-config option — no GitHub Actions workflow needed unless a build step gets introduced later, which it hasn't).

- [ ] **Step 3: Verify the live site**

Once Pages finishes its first deploy (usually under a minute), open the published URL and run through the golden path: grid loads with all 143+ titles and real posters, filters/sort/search work, the modal opens, a status/rating change persists and (if two devices are tested) syncs via Supabase, the PWA install prompt appears, offline mode works after a first visit.

- [ ] **Step 4: Report the live URL back to the user**

No further action needed from Claude after this — future title additions go through the existing workflow (edit `data.js` locally, commit, push; GitHub Pages redeploys automatically on every push to the branch it's configured to serve from).

---

## Phase E — Labels, platforms, new titles, and season tracking

Added at the user's request while Phase D was in progress. Order matters: 33 before 35 (labels should be settled before more data uses them), 34 before 35 (platforms field should exist before new games are added), 36 before 37 (the season-tracking feature must exist before its data gets populated). 29-32 (stats/PWA/sync/deploy) remain queued after this phase.

### Task 33: Label renames, colored status indicators, "still airing" badge

**Files:**
- Modify: `app.js`
- Modify: `index.html`
- Modify: `styles.css`

**Why:** three small UX polish requests from the owner: (1) "Пройдено"/"Готово" reads better as **"Завершено"**, and the "Скрыть пройденное" checkbox should become **"Скрыть завершённое"**; (2) "В очереди" should become **"В бэклоге"**; (3) status badges/labels are currently all the same grey except the "Ждёт продолжения" badge — add distinct colors per status so they're scannable at a glance; (4) the "Ждёт продолжения" badge currently only shows when `status === 'done' && airingStatus === 'ongoing'` (i.e. only once the user has caught up) — broaden it to show on ANY title where `airingStatus === 'ongoing'`, regardless of the user's own watch status, and rename it to something like **"Всё ещё выходит"** (the franchise isn't over, independent of where the user personally is in it).

- [ ] **Step 1: Rename labels**

Grep for every occurrence of "Пройдено"/"Готово"/"пройдено" and "В очереди"/"queue" label text across `app.js`, `index.html` (status filter option, status buttons/segments, card status quick-actions, `STATUS_LABELS`, any status-related `aria-label`/`title` strings) and update to **"Завершено"** and **"В бэклоге"** respectively. Also rename the `#hide-done-filter` checkbox's visible label from "Скрыть пройденное" to **"Скрыть завершённое"** (the `id`/variable names can stay as-is internally — this is a copy change, not a schema change; don't rename the `status: "done"` enum value itself, only its Russian display text).

- [ ] **Step 2: Give each status its own color**

Add distinct accent-adjacent colors for the three statuses (в бэклоге / в процессе / завершено) to the badge/status-indicator styling in `styles.css`, reusing the existing token system's *hue* discipline (the app already has a warm gold `--signal`/`--star` token and the accent red/pink — pick colors that read as a coherent trio without clashing with the accent's "marker, never a fill" rule established in earlier tasks; muted/desaturated versions of a small palette work better here than saturated primaries, to stay consistent with the dark cinematic system). Apply consistently everywhere a status is shown: card status badge, card quick-action buttons (active state), modal status segments.

- [ ] **Step 3: Broaden and rename the "still airing" badge**

In `lib/query.js`, either repurpose `isReturning` or add a new function — your call, but the semantic changes from "user is done AND it's ongoing" to just "it's ongoing" (`airingStatus === 'ongoing'`), decoupled from the user's own `status`. Update its test(s) in `tests/query.test.js` to match the new (simpler) condition. Rename the badge text from "Ждёт продолжения" to **"Всё ещё выходит"** everywhere it's used (card badge in `cardHtml`, any filter checkbox label that references it — check `#returning-filter`'s label text too, since "Ждут продолжения" as a filter label should probably also update to match, e.g. "Всё ещё выходит").

- [ ] **Step 4: Verify**

Confirm all label text changes render correctly across the toolbar, cards, and modal. Confirm the "Всё ещё выходит" badge now appears on ongoing titles regardless of their status (e.g. a `queue` anime with `airingStatus: "ongoing"` should show it, which it didn't before). Confirm the three status colors are visually distinct and legible against the dark background (rough contrast sanity check, doesn't need a full audit). Run `node --test tests/*.test.js` and `node tools/validate-data.js`.

- [ ] **Step 5: Commit**

```bash
git add app.js index.html styles.css lib/query.js tests/query.test.js
git commit -m "feat: rename status labels, add colored status indicators, broaden 'still airing' badge"
```

---

### Task 34: Game platforms field

**Files:**
- Modify: `lib/validate.js` (optional field, not required — same pattern as `seasonInfo`)
- Modify: `index.html`
- Modify: `app.js`
- Modify: `data.js`

**Why:** the owner wants to see which platforms a game released/will release on.

- [ ] **Step 1: Add the field**

Add `platforms: string[]` as an optional field on `category: "game"` entries (not validated/required by `lib/validate.js`, same treatment as `seasonInfo` for series/anime — free-form, absent is fine). Use short, recognizable Russian or standard platform names (e.g. `["PC", "PS5", "Xbox Series X/S", "Nintendo Switch"]` — platform names are typically left untranslated/as their standard brand names, not translated to Russian).

- [ ] **Step 2: Display it**

Add a line to the title-detail modal (near the genres/year meta line, or its own line — your call) showing the platform list for games, hidden/absent for non-games (mirror the `seasonInfo` show/hide pattern already used).

- [ ] **Step 3: Populate for existing games**

The catalog currently has 10 game entries (It Takes Two, Baldur's Gate 3, Split Fiction, Unravel Two, Divinity: Original Sin, Divinity: Original Sin II — check `data.js` for the exact current list via `grep "category: 'game'"`). Web-search each one's actual release platforms and add the `platforms` field to each entry.

- [ ] **Step 4: Verify and commit**

Run `node tools/validate-data.js` and `node --test tests/*.test.js`. Open a few game titles' modals and confirm the platform list displays correctly.

```bash
git add lib/validate.js index.html app.js data.js
git commit -m "feat: add platforms field for games"
```

---

### Task 35: New titles — Supergirl movie + 15 games

**Files:**
- Modify: `data.js`
- Create: new cover images in `images/covers/`

**Recipe:** follow the standard batch recipe (Russian title for the movie; games keep English names per the established exception, verify each is real via search; `platforms` field per Task 34 for every game added here; real downloaded posters; `id` as `slugify(title)-year`; validate/test after).

- [ ] **Step 1: Add "Супергёрл" (Supergirl)**

Web-search to confirm — this is the upcoming DC Studios film (James Gunn's DCU), likely 2026. Confirm year/status (don't mark `done` if unreleased), Russian title, real poster.

- [ ] **Step 2: Add the 15 games**

Orbital (verify exact title — "Orbitals" may be a working/mis-remembered name, search to confirm), Haven, Stardew Valley, A Way Out, Operation: Tango, We Were Here (the owner said "несколько частей" — add each released entry in the series as a separate card: We Were Here, We Were Here Too, We Were Here Together, We Were Here Forever, and any others confirmed real via search), Portal 2, Rayman Legends (verify whether "Rayman Legends Retold" is a real distinct release or the owner meant the original Rayman Legends — search to confirm, don't fabricate a title that doesn't exist), Escape Simulator 2, The Dark Pictures Anthology (owner said "несколько игр" — add each released entry as a separate card: Man of Medan, Little Hope, House of Ashes, The Devil in Me, and any newer ones confirmed via search — this is an anthology of separate games, not seasons of one game, so no `seasonInfo`/parts tracking applies here, just ordinary separate `category: "game"` cards), Trine 4, Trine 5 (verify this exists — if not yet released or not real, don't fabricate it), Nobody Saves the World, Spiritfarer: Farewell Edition, Bokura (verify exact title/existence via search).

For each: verify it's a real, correctly-titled game via search before adding — the owner's list includes some names given from memory that may need correction (e.g. "Orbitals" vs the real title, "Rayman Legends Retold" vs "Rayman Legends", "Trine 5" existence). Flag anything you can't confirm rather than guessing.

- [ ] **Step 3: Validate and commit**

```bash
node tools/validate-data.js
node --test tests/*.test.js
git add data.js images/covers
git commit -m "data: add Supergirl and 15 games with platforms"
```

---

### Task 36: Season/part tracking — feature build

**Files:**
- Modify: `lib/validate.js`
- Modify: `lib/storage.js`
- Modify: `tests/storage.test.js`
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `app.js`
- Modify: `data.js` (a handful of titles, to prove the feature end-to-end — full population is Task 37)

**Why:** the owner wants, for series/anime specifically, a checklist of individual seasons/parts/films/OVAs (in release order) instead of a single done/in-progress/queue toggle — so they never lose the signal "I'm caught up on everything released, just waiting for more" by accidentally marking a whole ongoing franchise "завершено" before it actually is.

**Design (decided with the owner):**
- The checklist lives **inside the title detail modal** (not on the grid card).
- For `category: "series" | "anime"` titles, the checklist **replaces** the 3-button status control — status becomes a *derived* value, not something set directly, for these two categories. Movies and games keep the existing 3-button control unchanged.
- Applies to **every** series/anime title (not just currently-airing ones) — a fully concluded show still gets a checklist of all its seasons, just with every checkbox checkable and no locked/unreleased entries.
- Each **released** part is checkable/uncheckable freely. Each **unreleased** part is rendered but disabled/unchecked, not checkable, and does not count toward "can this go to завершено."
- Derived status: 0 checked → `queue`. Some (but not all released parts) checked → `in_progress`. **All released parts checked AND every part in the list is released** (nothing pending) → `done`. If all currently-released parts are checked but the list still has an unreleased entry, status stays `in_progress` — this is the core requirement: you can never reach `done` while something is still pending release, so the "waiting for more" signal is never lost.
- Parts render in release order.

- [ ] **Step 1: Extend the schema**

Add an optional `parts` field for series/anime titles: an array of objects, e.g.
```js
parts: [
  { name: "Сезон 1", year: 2016, released: true },
  { name: "Сезон 2", year: 2020, released: true },
  { name: "Сезон 3", year: 2026, released: false }
]
```
`name` is free text (so it can say "Сезон 1", "Фильм", "OVA", "Часть 2" etc. — whatever fits the franchise), `year` is a number or `null`, `released` is a boolean. Not required by `lib/validate.js` (same optional-field treatment as `seasonInfo`) — a title without `parts` falls back to the existing single-status behavior (this matters for Task 35's freshly-added titles and any future quick-adds, which won't have `parts` populated yet).

- [ ] **Step 2: Track watched parts in storage**

Add a new `localStorage` concern (or extend the existing overrides shape — your call on the cleanest fit within `lib/storage.js`'s existing patterns) to track which part *indices* (or names — indices are simpler and stable enough here since `parts` order won't change once written) are checked, per title id. Add pure helper functions to `lib/storage.js` (with tests in `tests/storage.test.js`) to: get/set the checked-parts array for a title, and compute the derived status from `(parts, checkedIndices)` per the rules above. This derived-status function is a good candidate for real unit tests since the "all released parts checked but one is still pending" edge case is exactly the bug this feature exists to prevent — test it explicitly.

- [ ] **Step 3: Build the UI**

In the title modal, when the open title has `category` of series/anime AND a non-empty `parts` array, render a checklist instead of the 3-button status control: one row per part, in array order, showing its name/year, a checkbox (disabled + visually muted for `released: false` entries), and derive/display the resulting status (reuse the existing status badge/label styling from Task 33). When a series/anime title has NO `parts` array, fall back to showing the existing 3-button control (don't break titles that haven't been migrated yet).

- [ ] **Step 4: Wire it up**

Checking/unchecking a part persists via your Step 2 storage functions, recomputes the derived status, persists that derived status through the existing `setOverride`/status-write path (so the card grid, badges, filters, and everything else built on `status` keeps working unchanged), and updates the checklist UI and the modal/card in place.

- [ ] **Step 5: Populate a handful of titles to prove it end-to-end**

Pick 3-4 titles already in the catalog that cover the interesting cases (a fully concluded show, a currently-airing show with a confirmed-but-unreleased next season, a show with mixed seasons+films) and add real `parts` data for them, verified via web search — Re:Zero is a good candidate here since the owner specifically flagged it as currently showing stale info (they believe it now has 4 seasons with the 4th in progress — verify this via a fresh search, don't trust prior memory, and build its `parts` array accordingly).

- [ ] **Step 6: Verify**

Open the modal for a populated title and confirm: parts render in order, unreleased parts are visibly disabled, checking all released parts (with nothing pending) reaches "Завершено", checking all released parts while one remains pending caps at "В процессе" and does NOT reach "Завершено", unchecking back down recomputes correctly, the change reflects in the card grid/badges immediately. Confirm an un-migrated series/anime title (no `parts`) still shows the normal 3-button control. Run `node --test tests/*.test.js` and `node tools/validate-data.js`.

- [ ] **Step 7: Commit**

```bash
git add lib/validate.js lib/storage.js tests/storage.test.js index.html styles.css app.js data.js
git commit -m "feat: per-season/part tracking for series and anime"
```

---

### Task 37: Season/part tracking — full data population + ongoing-shows audit

**Files:**
- Modify: `data.js`

**Why:** Task 36 built the feature and proved it on a handful of titles; this task populates `parts` for the remaining series/anime catalog (~45-50 titles), and folds in the owner's explicit request to re-verify — via live web search, not memory — the current airing status of every not-yet-concluded multi-season show, since some existing `seasonInfo`/`airingStatus` data has gone stale (Re:Zero was specifically flagged as wrong before Task 36's Step 5 fixed it).

- [ ] **Step 1: Enumerate every series/anime title without `parts`**

`grep "category: 'series'\|category: 'anime'"` in `data.js`, cross-reference against which ones Task 36 already populated, and work through the rest.

- [ ] **Step 2: For each title, research and build its `parts` array**

Web-search current, up-to-date information for each — season/part counts, individual release years, and whether anything confirmed-but-unreleased is coming (which becomes a `released: false` entry). Update the title's `airingStatus`/`status`/`seasonInfo` fields too if the research turns up something that's changed since they were last written (this task doubles as the "audit all ongoing shows" pass the owner asked for) — don't just add `parts` on top of stale surrounding data.

- [ ] **Step 3: Validate and verify incrementally**

Run `node tools/validate-data.js` periodically as you go (schema doesn't enforce `parts`' shape strictly, but sanity-check it yourself: `released: true` entries should have a real year, the array should be in chronological order). Commit incrementally (e.g. every 8-10 titles) given the batch size.

- [ ] **Step 4: Final verification**

Run the full test suite and validator. Spot-check several titles' modals in the browser to confirm the checklist renders correctly and derives sensible statuses given each title's actual current watch status (a title the user already marked "done" before this task ran should end up with all-released-parts checked after migration, not reset to unwatched — think through how to map an existing single `status` value onto initial checked-parts state sensibly per title, since this is a one-time migration of real user-relevant data, not just filling in blanks).

- [ ] **Step 5: Commit**

```bash
git add data.js
git commit -m "data: populate season/part tracking for remaining series and anime, refresh airing-status audit"
```

---

### Task 38: Original title in modal + rating indicator on grid card

**Files:**
- Modify: `lib/validate.js`
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `app.js`
- Modify: `data.js`

**Why:** two owner requests: (1) the grid card should keep showing only the Russian title (unchanged), but the title-detail modal should also show the original (usually English/Japanese) title, since the owner wants to know the source name without it cluttering the grid; (2) the grid should show, at a glance, whether a title has been rated and what the rating is — a small indicator on the poster itself, not buried in the modal.

**Part A — original title:**

- [ ] **Step 1: Add the field**

Add an optional `originalTitle: string` field to the schema (not validated/required by `lib/validate.js`, same treatment as `seasonInfo`/`platforms`). Relevant mainly for `movie`/`series`/`anime` — games already use their original (English) name as `title`, so `originalTitle` is generally not needed for games (leave absent).

- [ ] **Step 2: Display it in the modal only**

In the modal (`#modal-title` area in `index.html`/`app.js`), show `originalTitle` as a small subtitle under the Russian title when present (hidden when absent). Do NOT add it to the grid card — `cardHtml` in `app.js` stays showing only `title.title`, unchanged.

- [ ] **Step 3: Populate `originalTitle` for the catalog**

For every `movie`/`series`/`anime` entry currently missing it (essentially the whole non-game catalog, ~140 titles) — this is mostly a fast confirm-and-fill pass, not deep research: for most entries the original title is recoverable from the `id` (which was already slugified from the original/English title when each batch was populated) or from what you already know about the title. Spot-verify rather than exhaustively re-research each one; flag anything genuinely uncertain rather than guessing. Skip this step for the ~30 games (not needed) and for any title whose Russian `title` already IS the original (e.g. "Клаустрофобы" if there's truly no meaningfully different original name, or a Russian-made production).

**Part B — rating indicator on the grid card:**

- [ ] **Step 4: Design the indicator**

Add a small rating indicator directly on each grid card's poster (e.g. top corner) showing the current rating (`"8"` + a star glyph, or similar) when rated, and a distinct "not yet rated" visual state when `rating` is `null` (the owner suggested `"8★"` / `"?★"` as a rough example but said explicitly the exact execution is your design call — invoke `frontend-design` and make it genuinely fit the established dark cinematic system: reuse the star/gold token already established for the rating widget in the modal, keep it small and unobtrusive against the poster, legible over any cover art, consistent hover/interaction behavior with the rest of the card). This is purely a display indicator on the card — it does not need to be clickable/editable there (rating is still set via the modal's star widget); if you find a clean way to make it interactive too, that's a bonus, not a requirement.

- [ ] **Step 5: Wire it up**

Add the indicator to `cardHtml` in `app.js`, styled in `styles.css`. Make sure it updates immediately when a rating changes (via the existing in-place card-patch mechanism used for status changes, or a full re-render — whichever fits the existing pattern better; check how `patchCardStatus`/`applyStatusChange` work and follow the same "patch in place, don't force a jarring full re-render" discipline if practical, though a rating change is rare enough that reusing the simpler full-`refresh()` path may also be acceptable — your call).

- [ ] **Step 6: Verify**

Confirm: modal shows the original title correctly for populated entries, hidden for games/unpopulated entries. Grid cards show the rating indicator correctly for rated and unrated titles, legible against light and dark poster art, doesn't clash with the existing status quick-actions/badges/draft badge on the same card. Run `node --test tests/*.test.js` and `node tools/validate-data.js`.

- [ ] **Step 7: Commit**

```bash
git add lib/validate.js index.html styles.css app.js data.js
git commit -m "feat: show original title in modal, add rating indicator to grid cards"
```

---

## Self-review notes

- **Spec coverage:** architecture (Phase A tasks 6-7), data model + validator (Tasks 1-5), status/rating/delete editing in-UI via localStorage overlay (Tasks 2, 10), returning-flag (Task 3 `isReturning`, surfaced in Task 7 card badge and Task 8 filter), filters/search/sort/progress counters (Tasks 7-8), title detail modal (Task 9), visual style (Task 11), README (Task 12), Excel import + all clarified category mappings (Phase B, Tasks 14-19) — every design-spec section maps to at least one task.
- **Type consistency:** `id`/`category`/`status`/`airingStatus`/`genres`/`rating`/`synopsis`/`cover` field names and enums are identical across `lib/validate.js`, `data.js`, `app.js`, and the README schema block.
- **Scope:** Phase A is fully code+test driven and self-contained; Phase B is explicitly separated because it is a research/content task, not a code task — its batch tasks specify exact title lists and a fixed five-step recipe rather than pre-written data, since the actual field values require a live web search to get right.

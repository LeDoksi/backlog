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

## Self-review notes

- **Spec coverage:** architecture (Phase A tasks 6-7), data model + validator (Tasks 1-5), status/rating/delete editing in-UI via localStorage overlay (Tasks 2, 10), returning-flag (Task 3 `isReturning`, surfaced in Task 7 card badge and Task 8 filter), filters/search/sort/progress counters (Tasks 7-8), title detail modal (Task 9), visual style (Task 11), README (Task 12), Excel import + all clarified category mappings (Phase B, Tasks 14-19) — every design-spec section maps to at least one task.
- **Type consistency:** `id`/`category`/`status`/`airingStatus`/`genres`/`rating`/`synopsis`/`cover` field names and enums are identical across `lib/validate.js`, `data.js`, `app.js`, and the README schema block.
- **Scope:** Phase A is fully code+test driven and self-contained; Phase B is explicitly separated because it is a research/content task, not a code task — its batch tasks specify exact title lists and a fixed five-step recipe rather than pre-written data, since the actual field values require a live web search to get right.

// tests/sync.test.js
//
// Everything here runs against a fake Supabase client — an object with just
// enough of the query builder's surface to answer `from(t).select()`,
// `.upsert()` and `.delete().eq()`. Same discipline as tests/storage.test.js,
// which tests the overlay against a fake `localStorage` rather than a browser:
// the thing worth testing is the reshaping and the failure handling, and
// neither needs a network or an SDK.
const test = require('node:test');
const assert = require('node:assert/strict');
const sync = require('../lib/sync.js');
const storage = require('../lib/storage.js');

function fakeStorage(seed) {
  var data = Object.assign({}, seed);
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem: function (k, v) { data[k] = v; },
    _raw: data
  };
}

// `tables` maps a table name to the `{ data, error }` envelope supabase-js
// resolves a query to. A name that is absent answers like PostgREST does for a
// table that isn't there: no data, an error object, and no throw.
function fakeClient(tables) {
  var log = [];
  var client = {
    log: log,
    from: function (name) {
      return {
        select: function () {
          return Promise.resolve(
            Object.prototype.hasOwnProperty.call(tables, name)
              ? tables[name]
              : { data: null, error: { message: 'Could not find the table public.' + name } }
          );
        },
        upsert: function (row) {
          log.push({ op: 'upsert', table: name, row: row });
          return Promise.resolve({ data: null, error: null });
        },
        delete: function () {
          return {
            eq: function (column, value) {
              log.push({ op: 'delete', table: name, column: column, value: value });
              return Promise.resolve({ data: null, error: null });
            }
          };
        }
      };
    }
  };
  return client;
}

function rows(list) { return { data: list, error: null }; }

function fullClient(over) {
  return fakeClient(Object.assign({
    overrides: rows([]),
    deleted_titles: rows([]),
    drafts: rows([]),
    parts: rows([])
  }, over));
}

// ── pullState: reshaping ───────────────────────────────────────────────

test('pullState reshapes override rows into the backlog-overrides object', async () => {
  var client = fullClient({
    overrides: rows([
      { id: 'frieren-2023', status: 'in_progress', rating: 9, updated_at: 'x' },
      { id: 'barbie-2023', status: 'done', rating: 6, updated_at: 'x' }
    ])
  });
  var result = await sync.pullState(client);
  assert.deepEqual(result.state['backlog-overrides'], {
    'frieren-2023': { status: 'in_progress', rating: 9 },
    'barbie-2023': { status: 'done', rating: 6 }
  });
});

// A row written by a rating-only push carries status = null. Merging that key
// onto the base title (applyOverlay does Object.assign) would blank the
// catalog's own status, and every surface keyed off it — badge hue, status
// filter, the status sort — would then be reading null.
test('pullState drops a null status so it cannot clobber the catalog status', async () => {
  var client = fullClient({ overrides: rows([{ id: 'dune-2021', status: null, rating: 8 }]) });
  var result = await sync.pullState(client);
  assert.deepEqual(result.state['backlog-overrides'], { 'dune-2021': { rating: 8 } });
});

// The mirror image: a null *rating* is meaningful. Clicking the star you
// already gave un-rates the title, which is stored as rating: null, and that
// has to travel to the other device rather than being silently discarded.
test('pullState keeps a null rating so un-rating propagates', async () => {
  var client = fullClient({ overrides: rows([{ id: 'dune-2021', status: 'done', rating: null }]) });
  var result = await sync.pullState(client);
  assert.deepEqual(result.state['backlog-overrides'], { 'dune-2021': { status: 'done', rating: null } });
});

// ── Task 39: shapeOverrides forwards every editable card field ─────────

test('pullState forwards the newly-editable override fields as-is', async () => {
  var client = fullClient({
    overrides: rows([{
      id: 'the-boys-2019',
      status: 'in_progress',
      rating: 8,
      title: 'Пацаны',
      category: 'series',
      year: 2019,
      genres: ['сатира', 'боевик'],
      synopsis: 'Обновлённый синопсис.',
      cover: 'images/covers/the-boys-2019.jpg',
      platforms: ['PC'],
      parts: [{ name: 'Сезон 1', year: 2019, released: true }],
      updated_at: 'x'
    }])
  });
  var result = await sync.pullState(client);
  assert.deepEqual(result.state['backlog-overrides']['the-boys-2019'], {
    status: 'in_progress',
    rating: 8,
    title: 'Пацаны',
    category: 'series',
    year: 2019,
    genres: ['сатира', 'боевик'],
    synopsis: 'Обновлённый синопсис.',
    cover: 'images/covers/the-boys-2019.jpg',
    platforms: ['PC'],
    parts: [{ name: 'Сезон 1', year: 2019, released: true }]
  });
});

// `originalTitle`/`seasonInfo` are the two override columns whose SQL name
// differs from the JS field name, same convention as `airing_status` for
// drafts — this is the one place that mapping could get flipped unnoticed.
test('pullState maps original_title/season_info onto their camelCase fields', async () => {
  var client = fullClient({
    overrides: rows([{
      id: 'frieren-2023',
      original_title: 'Sousou no Frieren',
      season_info: 'Сезон 2 анонсирован.'
    }])
  });
  var result = await sync.pullState(client);
  assert.deepEqual(result.state['backlog-overrides']['frieren-2023'], {
    originalTitle: 'Sousou no Frieren',
    seasonInfo: 'Сезон 2 анонсирован.'
  });
});

// ── Task 45: a NULL in a newly-added column is not an override ─────────
//
// `add column if not exists` fills every existing row with a real SQL NULL, and
// PostgREST returns it — an untouched new column is indistinguishable from one
// somebody cleared. Shipping those as overrides is what put the literal string
// "null" on a dozen live cards: applyOverlay Object.assigns the patch onto the
// catalog title and escapeHtml(null) is "null", with `<img src="null">` beside
// it. Nothing in app.js's save handler writes null to these columns ('' for
// text, [] for lists, a real boolean for draft), so null can only be the
// migration artefact.

test('pullState drops a null in a migration-added column so it cannot clobber the catalog', async () => {
  var client = fullClient({
    overrides: rows([{
      id: 'barbie-2023',
      status: 'done',
      rating: 7,
      title: null,
      category: null,
      year: null,
      genres: null,
      synopsis: null,
      cover: null,
      original_title: null,
      season_info: null,
      platforms: null,
      parts: null,
      updated_at: 'x'
    }])
  });
  var result = await sync.pullState(client);
  assert.deepEqual(result.state['backlog-overrides']['barbie-2023'], { status: 'done', rating: 7 });
});

// The `draft` column from Task 43 is the same story, and `draft: false` is a
// real value that must still survive — only null is dropped.
test('pullState drops a null draft but keeps an explicit false', async () => {
  var client = fullClient({
    overrides: rows([
      { id: 'old-row', status: 'done', draft: null },
      { id: 'unmarked', status: 'done', draft: false }
    ])
  });
  var result = await sync.pullState(client);
  assert.deepEqual(result.state['backlog-overrides']['old-row'], { status: 'done' });
  assert.deepEqual(result.state['backlog-overrides']['unmarked'], { status: 'done', draft: false });
});

// Only null is excluded, never the field: a genuinely edited value still lands.
test('pullState still forwards a real value in a migration-added column', async () => {
  var client = fullClient({
    overrides: rows([{ id: 'barbie-2023', title: 'Барби', original_title: 'Barbie', genres: [], cover: '' }])
  });
  var result = await sync.pullState(client);
  assert.deepEqual(result.state['backlog-overrides']['barbie-2023'], {
    title: 'Барби',
    originalTitle: 'Barbie',
    genres: [],
    cover: ''
  });
});

// A column this row simply never set (undefined, not null) must not appear in
// the patch at all — applyOverlay would otherwise merge an explicit
// `undefined` onto the title, which JSON round-trips into the field vanishing
// outright rather than being left alone.
test('pullState omits an override field the row never set', async () => {
  var client = fullClient({ overrides: rows([{ id: 'fight-club-1999', status: 'done' }]) });
  var result = await sync.pullState(client);
  assert.deepEqual(result.state['backlog-overrides']['fight-club-1999'], { status: 'done' });
});

test('pullState reshapes deleted_titles into a flat id array', async () => {
  var client = fullClient({
    deleted_titles: rows([{ id: 'a', deleted_at: 'x' }, { id: 'b', deleted_at: 'x' }])
  });
  var result = await sync.pullState(client);
  assert.deepEqual(result.state['backlog-deleted'], ['a', 'b']);
});

test('pullState maps draft rows back to the camelCase title shape', async () => {
  var client = fullClient({
    drafts: rows([{
      id: 'dune-3', title: 'Dune 3', category: 'movie', status: 'queue',
      airing_status: null, year: null, genres: [], rating: null,
      synopsis: '', cover: 'images/covers/_placeholder.svg', draft: true,
      created_at: '2026-01-01T00:00:00Z'
    }])
  });
  var result = await sync.pullState(client);
  assert.deepEqual(result.state['backlog-added'], [{
    id: 'dune-3', title: 'Dune 3', category: 'movie', status: 'queue',
    airingStatus: null, year: null, genres: [], rating: null,
    synopsis: '', cover: 'images/covers/_placeholder.svg', draft: true
  }]);
});

// `backlog-added` is an ordered list — BacklogQuery.sortTitles('added') is
// literally "leave the array alone" — so the order has to be reconstructed
// from created_at rather than left to whatever order PostgREST returns.
test('pullState orders drafts by created_at', async () => {
  var client = fullClient({
    drafts: rows([
      { id: 'second', title: 'B', category: 'movie', status: 'queue', genres: [], synopsis: '', cover: 'c', draft: true, created_at: '2026-02-01T00:00:00Z' },
      { id: 'first', title: 'A', category: 'movie', status: 'queue', genres: [], synopsis: '', cover: 'c', draft: true, created_at: '2026-01-01T00:00:00Z' }
    ])
  });
  var result = await sync.pullState(client);
  assert.deepEqual(result.state['backlog-added'].map(function (t) { return t.id; }), ['first', 'second']);
});

test('pullState reshapes parts rows into the backlog-parts index map', async () => {
  var client = fullClient({ parts: rows([{ id: 'the-boys-2019', indices: [0, 2] }]) });
  var result = await sync.pullState(client);
  assert.deepEqual(result.state['backlog-parts'], { 'the-boys-2019': [0, 2] });
});

// ── pullState: failure handling ────────────────────────────────────────

// The `parts` table is the one the user may not have created yet. Its absence
// must cost exactly the parts key and nothing else.
test('pullState returns the tables that answered when one is missing', async () => {
  var client = fakeClient({
    overrides: rows([{ id: 'a', status: 'done', rating: null }]),
    deleted_titles: rows([]),
    drafts: rows([])
    // no `parts`
  });
  var result = await sync.pullState(client);
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.state).sort(), ['backlog-added', 'backlog-deleted', 'backlog-overrides']);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].table, 'parts');
});

// The whole point of the "only successful tables" contract: a key that failed
// to load must be absent from `state`, not present-and-empty. Present-and-empty
// is what would let a failed pull wipe local state on write-back.
test('pullState omits a failed table rather than reporting it empty', async () => {
  var client = fakeClient({ overrides: rows([]), deleted_titles: rows([]), parts: rows([]) });
  var result = await sync.pullState(client);
  assert.equal(Object.prototype.hasOwnProperty.call(result.state, 'backlog-added'), false);
});

test('pullState reports not-ok when every table fails', async () => {
  var result = await sync.pullState(fakeClient({}));
  assert.equal(result.ok, false);
  assert.deepEqual(result.state, {});
  assert.equal(result.errors.length, 4);
});

test('pullState resolves rather than rejecting when the client throws', async () => {
  var thrower = { from: function () { throw new Error('network down'); } };
  var result = await sync.pullState(thrower);
  assert.equal(result.ok, false);
  assert.deepEqual(result.state, {});
});

test('pullState resolves not-ok for a null client', async () => {
  var result = await sync.pullState(null);
  assert.equal(result.ok, false);
});

// ── applyState: writing the mirror ─────────────────────────────────────

// The contract that lets lib/storage.js stay untouched: whatever pullState
// produced, read back through storage.js's own getters, is the same data.
test('applyState writes state that lib/storage.js reads back unchanged', () => {
  var store = fakeStorage();
  sync.applyState(store, {
    'backlog-overrides': { 'a': { status: 'done', rating: 7 } },
    'backlog-deleted': ['b'],
    'backlog-added': [{ id: 'c', title: 'C' }],
    'backlog-parts': { 'd': [0, 1] }
  });
  assert.deepEqual(storage.getOverrides(store), { 'a': { status: 'done', rating: 7 } });
  assert.deepEqual(storage.getDeleted(store), ['b']);
  assert.deepEqual(storage.getAdded(store), [{ id: 'c', title: 'C' }]);
  assert.deepEqual(storage.getCheckedParts(store, 'd'), [0, 1]);
});

test('applyState leaves keys absent from the state untouched', () => {
  var store = fakeStorage({ 'backlog-parts': JSON.stringify({ 'kept': [3] }) });
  sync.applyState(store, { 'backlog-overrides': {} });
  assert.deepEqual(storage.getCheckedParts(store, 'kept'), [3]);
});

test('applyState ignores an unknown key rather than writing it', () => {
  var store = fakeStorage();
  sync.applyState(store, { 'backlog-overrides': {}, 'something-else': 1 });
  assert.equal(store.getItem('something-else'), null);
});

// ── applyState: the seed gate ──────────────────────────────────────────
//
// `state` holding only the tables that answered protects against a failed
// *read*. This is the other half: a failed *write*. A table's select can
// succeed while its upsert fails — an RLS policy granting select but not
// insert, a column mismatch on the batched seed, a transient 429 — and then
// the pull comes back with real, well-formed rows that have simply never heard
// of this browser's months of local history. Without the gate, applying them
// destroys exactly what the seed step exists to protect.

test('applyState skips a key whose table has not been confirmed seeded', () => {
  var store = fakeStorage();
  storage.setOverride(store, 'frieren-2023', { status: 'done', rating: 10 });
  storage.setCheckedParts(store, 'the-boys-2019', [0, 1]);

  // The remote answered for everything, but only `parts` was seeded.
  sync.applyState(store, {
    'backlog-overrides': {},
    'backlog-parts': { 'the-boys-2019': [0, 1] }
  }, { tables: ['parts'] });

  assert.deepEqual(storage.getOverrides(store), { 'frieren-2023': { status: 'done', rating: 10 } });
  assert.deepEqual(storage.getCheckedParts(store, 'the-boys-2019'), [0, 1]);
});

test('applyState applies every present key when every table is seeded', () => {
  var store = fakeStorage();
  storage.setOverride(store, 'local-only', { status: 'done' });
  var written = sync.applyState(store, {
    'backlog-overrides': { 'remote': { status: 'queue' } }
  }, { tables: sync.TABLES });
  assert.deepEqual(written, ['backlog-overrides']);
  // The remote id lands; the local-only one is kept rather than dropped — see
  // the merge tests below for why an id absent from a pull is never a deletion.
  assert.deepEqual(storage.getOverrides(store), {
    'local-only': { status: 'done' },
    'remote': { status: 'queue' }
  });
});

// Nothing confirmed seeded yet — the safe answer is to write nothing at all
// and let the next load retry the seed.
test('applyState writes nothing when no table is confirmed seeded', () => {
  var store = fakeStorage();
  storage.setOverride(store, 'a', { status: 'done' });
  var written = sync.applyState(store, { 'backlog-overrides': {} }, { tables: [] });
  assert.deepEqual(written, []);
  assert.deepEqual(storage.getOverrides(store), { 'a': { status: 'done' } });
});

// A caller that does no seeding at all (there isn't one in app.js today, but
// the option is optional) keeps the old unconditional behaviour.
test('applyState without the tables option applies everything present', () => {
  var store = fakeStorage();
  storage.setOverride(store, 'a', { status: 'done' });
  sync.applyState(store, {
    'backlog-overrides': { 'b': { status: 'queue' } },
    'backlog-deleted': ['gone']
  });
  assert.deepEqual(storage.getOverrides(store)['b'], { status: 'queue' });
  assert.deepEqual(storage.getDeleted(store), ['gone']);
});

// ── applyState: overrides merge, the other three keys replace ──────────
//
// Task 45. `shapeOverrides` omits a field whose column the row came back
// without, so before the Task 39/43 migration ran every pulled patch was
// narrower than the local one — and applyState's whole-key write turned that
// narrowness into data loss on the *same* device: untick «Черновик», reload,
// and the badge was back. These pin the fix down field by field.

test('applyState keeps a local override field the pulled patch never mentions (Task 45: the draft-reverts-on-refresh bug)', () => {
  var store = fakeStorage();
  // What the app had just written locally, before the `draft` column existed.
  storage.setOverride(store, 'the-boys-2019', { status: 'done', draft: false });

  // What the pull answers with when `overrides` has no `draft` column at all.
  sync.applyState(store, {
    'backlog-overrides': { 'the-boys-2019': { status: 'queue' } }
  }, { tables: sync.TABLES });

  assert.deepEqual(storage.getOverrides(store), {
    'the-boys-2019': { status: 'queue', draft: false }
  });
});

// The same thing end to end, through pullState, against a table whose rows
// simply do not carry the column — which is exactly what PostgREST returns
// before an `add column if not exists` migration is run.
test('a pull from an un-migrated overrides table no longer erases the local draft flag (Task 45)', async () => {
  var store = fakeStorage();
  storage.setOverride(store, 'the-boys-2019', { status: 'done', draft: false });

  var client = fullClient({
    overrides: rows([{ id: 'the-boys-2019', status: 'done', rating: 8, updated_at: 'x' }])
  });
  var pull = await sync.pullState(client);
  sync.applyState(store, pull.state, { tables: pull.tables });

  assert.deepEqual(storage.getOverrides(store), {
    'the-boys-2019': { status: 'done', rating: 8, draft: false }
  });
});

// The other half of the contract: a field the remote genuinely carries is a
// real edit from the other device and still wins outright.
test('applyState lets a pulled field overwrite the local one', () => {
  var store = fakeStorage();
  storage.setOverride(store, 'dune-2021', { status: 'queue', rating: 9 });
  sync.applyState(store, {
    'backlog-overrides': { 'dune-2021': { status: 'done', rating: 7 } }
  }, { tables: sync.TABLES });
  assert.deepEqual(storage.getOverrides(store), { 'dune-2021': { status: 'done', rating: 7 } });
});

// A null rating is this app's real "un-rated", not a missing value, so it has
// to beat the local number rather than be treated as nothing to say.
test('applyState lets a pulled null overwrite the local value', () => {
  var store = fakeStorage();
  storage.setOverride(store, 'dune-2021', { rating: 9 });
  sync.applyState(store, {
    'backlog-overrides': { 'dune-2021': { rating: null } }
  }, { tables: sync.TABLES });
  assert.deepEqual(storage.getOverrides(store), { 'dune-2021': { rating: null } });
});

test('applyState adds an override id that exists only in the pull', () => {
  var store = fakeStorage();
  storage.setOverride(store, 'local', { status: 'done' });
  sync.applyState(store, {
    'backlog-overrides': { 'remote': { rating: 5 } }
  }, { tables: sync.TABLES });
  assert.deepEqual(storage.getOverrides(store), {
    'local': { status: 'done' },
    'remote': { rating: 5 }
  });
});

// Two devices editing different fields of the same title is the ordinary case
// the merge has to survive: the remote's field lands, the local-only one stays.
test('applyState merges concurrent edits to different fields of one title', () => {
  var store = fakeStorage();
  storage.setOverride(store, 'frieren-2023', { seasonInfo: 'Сезон 2 анонсирован.' });
  sync.applyState(store, {
    'backlog-overrides': { 'frieren-2023': { rating: 10 } }
  }, { tables: sync.TABLES });
  assert.deepEqual(storage.getOverrides(store), {
    'frieren-2023': { seasonInfo: 'Сезон 2 анонсирован.', rating: 10 }
  });
});

// Scope guard. The merge is a property of `backlog-overrides`'s patch shape
// alone — the other three keys are whole values and a pull still replaces them,
// which is how a title deleted elsewhere ever becomes un-deleted here.
test('applyState still replaces deleted/added/parts wholesale', () => {
  var store = fakeStorage();
  storage.deleteTitle(store, 'gone');
  storage.setCheckedParts(store, 'the-boys-2019', [0, 1]);
  storage.addTitle(store, { id: 'local-draft', title: 'Local', category: 'movie' });

  sync.applyState(store, {
    'backlog-deleted': ['other'],
    'backlog-parts': { 'frieren-2023': [2] },
    'backlog-added': [{ id: 'remote-draft', title: 'Remote' }]
  }, { tables: sync.TABLES });

  assert.deepEqual(storage.getDeleted(store), ['other']);
  assert.deepEqual(storage.getCheckedParts(store, 'the-boys-2019'), []);
  assert.deepEqual(storage.getCheckedParts(store, 'frieren-2023'), [2]);
  assert.deepEqual(storage.getAdded(store).map(function (t) { return t.id; }), ['remote-draft']);
});

// The reported incident, end to end and in the order the app runs it: a row
// written before the migration, pulled after it, applied to the mirror, then
// overlaid onto the catalog. `title` has to still be the catalog's own string —
// a null here is what the grid rendered as the literal text "null".
test('a pre-migration override row no longer overwrites the catalog title with null (Task 45)', async () => {
  var store = fakeStorage();
  var client = fullClient({
    overrides: rows([{
      id: 'barbie-2023',
      status: 'done', rating: 7,
      title: null, category: null, year: null, genres: null, synopsis: null,
      cover: null, original_title: null, season_info: null, platforms: null,
      parts: null, draft: null, updated_at: 'x'
    }])
  });

  var pull = await sync.pullState(client);
  sync.applyState(store, pull.state, { tables: pull.tables });

  var catalog = [{
    id: 'barbie-2023', title: 'Барби', category: 'movie', status: 'queue',
    year: 2023, genres: ['комедия'], rating: null, synopsis: 'Синопсис.',
    cover: 'images/covers/barbie-2023.jpg', airingStatus: null
  }];
  var shown = storage.applyOverlay(catalog, store)[0];

  assert.equal(shown.title, 'Барби');
  assert.equal(shown.cover, 'images/covers/barbie-2023.jpg');
  assert.equal(shown.category, 'movie');
  assert.equal(shown.year, 2023);
  assert.deepEqual(shown.genres, ['комедия']);
  assert.equal(shown.draft, undefined);
  // …while the two fields that row really does assert still come through.
  assert.equal(shown.status, 'done');
  assert.equal(shown.rating, 7);
});

// The end-to-end shape of the bug, in the order app.js runs it: seed, then
// pull, then apply. `overrides` refuses the write and answers the read.
test('a pull cannot wipe local data for a table whose seed failed', async () => {
  var store = fakeStorage();
  storage.setOverride(store, 'frieren-2023', { status: 'done', rating: 10 });
  storage.setOverride(store, 'dune-2021', { rating: 8 });

  var client = fullClient();
  client.from = (function (inner) {
    return function (name) {
      var builder = inner(name);
      if (name === 'overrides') {
        builder.upsert = function () {
          return Promise.resolve({ data: null, error: { message: 'permission denied' } });
        };
      }
      return builder;
    };
  }(client.from));

  var seeded = await sync.seedLocal(client, store);
  assert.equal(seeded.indexOf('overrides'), -1, 'a refused write must leave the table unseeded');

  var pull = await sync.pullState(client);
  assert.equal(pull.ok, true);
  assert.equal(pull.tables.indexOf('overrides') !== -1, true, 'the read still succeeds — that is the trap');

  sync.applyState(store, pull.state, { tables: seeded });

  assert.deepEqual(storage.getOverrides(store), {
    'frieren-2023': { status: 'done', rating: 10 },
    'dune-2021': { rating: 8 }
  });
});

// ── push functions ─────────────────────────────────────────────────────

test('pushOverride upserts the patch under the title id', async () => {
  var client = fullClient();
  await sync.pushOverride(client, 'frieren-2023', { status: 'done' });
  assert.equal(client.log.length, 1);
  assert.equal(client.log[0].table, 'overrides');
  assert.equal(client.log[0].row.id, 'frieren-2023');
  assert.equal(client.log[0].row.status, 'done');
});

// A rating-only write must not carry a status key at all: PostgREST's upsert
// sets exactly the columns present in the payload, so an absent key leaves the
// stored status alone while an explicit null would erase it.
test('pushOverride sends only the keys in the patch', async () => {
  var client = fullClient();
  await sync.pushOverride(client, 'x', { rating: 9 });
  assert.deepEqual(Object.keys(client.log[0].row).sort(), ['id', 'rating', 'updated_at']);
});

test('pushOverride sends an explicit null rating so un-rating is stored', async () => {
  var client = fullClient();
  await sync.pushOverride(client, 'x', { rating: null });
  assert.equal(client.log[0].row.rating, null);
  assert.equal('rating' in client.log[0].row, true);
});

// Mirrors BacklogStorage.deleteTitle: a draft is removed, a catalog title is
// tombstoned. Tombstoning a draft would resurrect the exact bug the comment in
// lib/storage.js warns about, only now shared across every device.
test('pushDelete removes a draft instead of tombstoning it', async () => {
  var client = fullClient();
  await sync.pushDelete(client, 'dune-3', true);
  assert.deepEqual(client.log, [{ op: 'delete', table: 'drafts', column: 'id', value: 'dune-3' }]);
});

test('pushDelete tombstones a catalog title', async () => {
  var client = fullClient();
  await sync.pushDelete(client, 'barbie-2023', false);
  assert.equal(client.log[0].op, 'upsert');
  assert.equal(client.log[0].table, 'deleted_titles');
  assert.equal(client.log[0].row.id, 'barbie-2023');
});

test('pushDraft maps airingStatus onto the airing_status column', async () => {
  var client = fullClient();
  await sync.pushDraft(client, {
    id: 'dune-3', title: 'Dune 3', category: 'anime', status: 'queue',
    airingStatus: 'ongoing', year: null, genres: [], rating: null,
    synopsis: '', cover: 'p.svg', draft: true
  });
  var row = client.log[0].row;
  assert.equal(client.log[0].table, 'drafts');
  assert.equal(row.airing_status, 'ongoing');
  assert.equal('airingStatus' in row, false);
  assert.deepEqual(row.genres, []);
});

test('pushRemoveDraft deletes by id', async () => {
  var client = fullClient();
  await sync.pushRemoveDraft(client, 'dune-3');
  assert.deepEqual(client.log, [{ op: 'delete', table: 'drafts', column: 'id', value: 'dune-3' }]);
});

test('pushParts upserts the checked indices', async () => {
  var client = fullClient();
  await sync.pushParts(client, 'the-boys-2019', [2, 0]);
  assert.equal(client.log[0].table, 'parts');
  assert.deepEqual(client.log[0].row.indices, [2, 0]);
});

// ── push functions: never break the page ───────────────────────────────

test('push functions resolve to false rather than rejecting when the client throws', async () => {
  var thrower = { from: function () { throw new Error('offline'); } };
  assert.equal(await sync.pushOverride(thrower, 'a', { status: 'done' }), false);
  assert.equal(await sync.pushDelete(thrower, 'a', false), false);
  assert.equal(await sync.pushDraft(thrower, { id: 'a', title: 'A', category: 'movie', status: 'queue', genres: [], synopsis: '', cover: 'c', draft: true }), false);
  assert.equal(await sync.pushRemoveDraft(thrower, 'a'), false);
  assert.equal(await sync.pushParts(thrower, 'a', [0]), false);
});

test('push functions resolve to false when there is no client at all', async () => {
  assert.equal(await sync.pushOverride(null, 'a', { status: 'done' }), false);
  assert.equal(await sync.pushParts(undefined, 'a', [0]), false);
});

test('push functions resolve to false when the query returns an error envelope', async () => {
  var erroring = {
    from: function () {
      return { upsert: function () { return Promise.resolve({ data: null, error: { message: 'rls' } }); } };
    }
  };
  assert.equal(await sync.pushOverride(erroring, 'a', { status: 'done' }), false);
});

// ── seeding an existing local install ──────────────────────────────────
//
// The app has been in daily use against localStorage alone. The very first
// sync therefore meets a full local store and an empty remote, and a plain
// pull-then-overwrite at that moment would destroy every status, rating,
// deletion and ticked season the owner has ever set. So the first run pushes
// local state up before it pulls anything down.

function seededStore() {
  var store = fakeStorage();
  storage.setOverride(store, 'a', { status: 'done' });
  storage.deleteTitle(store, 'b');
  storage.addTitle(store, { id: 'c', title: 'C', category: 'movie', status: 'queue', genres: [], synopsis: '', cover: 'x', draft: true });
  storage.setCheckedParts(store, 'd', [0, 1]);
  return store;
}

test('seedLocal pushes every local row up', async () => {
  var client = fullClient();
  var seeded = await sync.seedLocal(client, seededStore());

  var byTable = client.log.map(function (e) { return e.table; }).sort();
  assert.deepEqual(byTable, ['deleted_titles', 'drafts', 'overrides', 'parts']);
  assert.deepEqual(seeded.slice().sort(), ['deleted_titles', 'drafts', 'overrides', 'parts']);
});

test('seedLocal seeds only the tables it is asked for', async () => {
  var client = fullClient();
  var seeded = await sync.seedLocal(client, seededStore(), { tables: ['parts'] });
  assert.deepEqual(client.log.map(function (e) { return e.table; }), ['parts']);
  assert.deepEqual(seeded, ['parts']);
});

// The reason the result is a list and not a boolean. `parts` is the table an
// older project has not created yet; its 404 must not stop the other three
// from being marked done (they would then be re-pushed on every load, and a
// re-push races ahead of the pull and resurrects rows the other device
// deleted), and it must leave `parts` itself unmarked so it is retried once
// the table finally exists.
test('seedLocal reports the tables that worked when one is missing', async () => {
  var client = fakeClient({ overrides: rows([]), deleted_titles: rows([]), drafts: rows([]) });
  client.from = (function (inner) {
    return function (name) {
      var builder = inner(name);
      if (name === 'parts') {
        builder.upsert = function () { return Promise.resolve({ data: null, error: { message: 'no such table' } }); };
      }
      return builder;
    };
  }(client.from));

  var seeded = await sync.seedLocal(client, seededStore());
  assert.deepEqual(seeded.slice().sort(), ['deleted_titles', 'drafts', 'overrides']);
});

test('seedLocal batches rows rather than sending one request per row', async () => {
  var client = fullClient();
  var store = fakeStorage();
  storage.setOverride(store, 'a', { status: 'done' });
  storage.setOverride(store, 'b', { status: 'queue' });
  storage.setOverride(store, 'c', { status: 'in_progress' });

  await sync.seedLocal(client, store);

  assert.equal(client.log.length, 1);
  assert.equal(Array.isArray(client.log[0].row), true);
  assert.equal(client.log[0].row.length, 3);
});

// A batch upsert sets the union of every key in the batch, so mixing a
// status-only row with a rating-only row would send `status: null` for the
// rating-only one and erase a status that had been set months ago.
test('seedLocal splits override rows so a batch never blanks a column', async () => {
  var client = fullClient();
  var store = fakeStorage();
  storage.setOverride(store, 'a', { status: 'done' });
  storage.setOverride(store, 'b', { rating: 8 });

  await sync.seedLocal(client, store);

  assert.equal(client.log.length, 2);
  client.log.forEach(function (entry) {
    var keys = Object.keys(entry.row[0]).sort().join(',');
    entry.row.forEach(function (row) {
      assert.equal(Object.keys(row).sort().join(','), keys);
    });
  });
});

// Nothing to send is still "reconciled" — the table is marked so the next load
// does not go looking again.
test('seedLocal sends nothing but marks every table on an empty local store', async () => {
  var client = fullClient();
  var seeded = await sync.seedLocal(client, fakeStorage());
  assert.deepEqual(client.log, []);
  assert.deepEqual(seeded.slice().sort(), ['deleted_titles', 'drafts', 'overrides', 'parts']);
});

test('seedLocal marks nothing at all when there is no client', async () => {
  var store = fakeStorage();
  storage.setOverride(store, 'a', { status: 'done' });
  assert.deepEqual(await sync.seedLocal(null, store), []);
});

// Offline on the very first load. The tables that had rows to send stay
// unmarked so the next online load retries them; the ones that had nothing to
// send are reconciled either way, because "push no rows" is a no-op whether or
// not the network is there.
test('seedLocal leaves a table unmarked when its rows could not be sent', async () => {
  var store = fakeStorage();
  storage.setOverride(store, 'a', { status: 'done' });
  storage.setCheckedParts(store, 'b', [0]);
  var seeded = await sync.seedLocal({ from: function () { throw new Error('offline'); } }, store);
  assert.equal(seeded.indexOf('overrides'), -1);
  assert.equal(seeded.indexOf('parts'), -1);
  assert.deepEqual(seeded.slice().sort(), ['deleted_titles', 'drafts']);
});

// ── The outbox ─────────────────────────────────────────────────────────
//
// Task 30 made this app usable offline, so edits made with no network are a
// normal event, not an edge case. They land in localStorage and their push
// fails. Without somewhere to remember them, the next online load pulls the
// remote — which never heard about them — and applyState writes that straight
// over the top, destroying work the owner watched succeed. The outbox is what
// makes "works offline" survive coming back online.

test('a failed push is remembered in the outbox', async () => {
  var store = fakeStorage();
  sync.useOutbox(store);
  await sync.pushOverride({ from: function () { throw new Error('offline'); } }, 'a', { status: 'done' });
  var queued = JSON.parse(store.getItem('backlog-sync-outbox'));
  assert.equal(queued.length, 1);
  assert.equal(queued[0].id, 'a');
  assert.deepEqual(queued[0].patch, { status: 'done' });
  sync.useOutbox(null);
});

test('a push that succeeds queues nothing', async () => {
  var store = fakeStorage();
  sync.useOutbox(store);
  await sync.pushOverride(fullClient(), 'a', { status: 'done' });
  assert.equal(store.getItem('backlog-sync-outbox'), null);
  sync.useOutbox(null);
});

// Two offline edits to the same title are one intention, not two: the second
// status supersedes the first. But a status and a rating are different fields
// and both have to survive, so same-title override entries merge rather than
// replace wholesale.
test('repeated offline overrides on one title collapse into a merged patch', async () => {
  var store = fakeStorage();
  var dead = { from: function () { throw new Error('offline'); } };
  sync.useOutbox(store);
  await sync.pushOverride(dead, 'a', { status: 'queue' });
  await sync.pushOverride(dead, 'a', { rating: 5 });
  await sync.pushOverride(dead, 'a', { status: 'done' });
  var queued = JSON.parse(store.getItem('backlog-sync-outbox'));
  assert.equal(queued.length, 1);
  assert.deepEqual(queued[0].patch, { status: 'done', rating: 5 });
  sync.useOutbox(null);
});

test('offline edits of different kinds are all remembered', async () => {
  var store = fakeStorage();
  var dead = { from: function () { throw new Error('offline'); } };
  sync.useOutbox(store);
  await sync.pushOverride(dead, 'a', { status: 'done' });
  await sync.pushDelete(dead, 'b', false);
  await sync.pushDraft(dead, { id: 'c', title: 'C', category: 'movie', status: 'queue', genres: [], synopsis: '', cover: 'x', draft: true });
  await sync.pushParts(dead, 'd', [0, 1]);
  var queued = JSON.parse(store.getItem('backlog-sync-outbox'));
  assert.deepEqual(queued.map(function (e) { return e.t; }), ['override', 'delete', 'draft', 'parts']);
  sync.useOutbox(null);
});

test('flushOutbox replays queued writes and empties the queue', async () => {
  var store = fakeStorage();
  var dead = { from: function () { throw new Error('offline'); } };
  sync.useOutbox(store);
  await sync.pushOverride(dead, 'a', { status: 'done' });
  await sync.pushParts(dead, 'd', [0]);

  var client = fullClient();
  var sent = await sync.flushOutbox(client);

  assert.equal(sent, 2);
  assert.deepEqual(JSON.parse(store.getItem('backlog-sync-outbox')), []);
  assert.deepEqual(client.log.map(function (e) { return e.table; }), ['overrides', 'parts']);
  sync.useOutbox(null);
});

// Still offline at replay time: the queue must survive intact rather than
// being consumed by the attempt.
test('flushOutbox keeps entries that still fail', async () => {
  var store = fakeStorage();
  var dead = { from: function () { throw new Error('offline'); } };
  sync.useOutbox(store);
  await sync.pushOverride(dead, 'a', { status: 'done' });

  var sent = await sync.flushOutbox(dead);

  assert.equal(sent, 0);
  var queued = JSON.parse(store.getItem('backlog-sync-outbox'));
  assert.equal(queued.length, 1);
  assert.deepEqual(queued[0].patch, { status: 'done' });
  sync.useOutbox(null);
});

test('flushOutbox is a no-op with an empty queue or no client', async () => {
  var store = fakeStorage();
  sync.useOutbox(store);
  assert.equal(await sync.flushOutbox(fullClient()), 0);
  assert.equal(await sync.flushOutbox(null), 0);
  sync.useOutbox(null);
});

test('a draft deleted offline replays as a removal, not a tombstone', async () => {
  var store = fakeStorage();
  sync.useOutbox(store);
  await sync.pushDelete({ from: function () { throw new Error('offline'); } }, 'dune-3', true);
  var client = fullClient();
  await sync.flushOutbox(client);
  assert.deepEqual(client.log, [{ op: 'delete', table: 'drafts', column: 'id', value: 'dune-3' }]);
  sync.useOutbox(null);
});

test('nothing is queued when no outbox storage has been supplied', async () => {
  sync.useOutbox(null);
  assert.equal(await sync.pushOverride({ from: function () { throw new Error('x'); } }, 'a', { status: 'done' }), false);
});

// ── The outbox stays durable during its own replay ─────────────────────
//
// A replay is exactly the moment the queue is most at risk, because it is the
// moment something is being taken off it. Two ways that used to go wrong, and
// both cost real edits:
//
//   the queue was emptied up front, so it lived only in memory for the length
//   of the replay — close the tab mid-flush and every queued edit was gone from
//   localStorage for good, with nothing left to retry;
//
//   and a module-level `replaying` flag made `enqueue` a no-op for the length
//   of the flush, which stops the replay double-queueing its own retries but
//   cannot tell those apart from the owner clicking a status on another title
//   while the flush is under way. That edit's push failed into nothing.

// The concurrent edit: queued offline work replays successfully, and during
// that very request the owner edits a different title whose own push fails.
// The new edit must be on disk when the dust settles — the pull that follows
// the flush in app.js is about to make the remote the authority.
test('an edit made during a replay is queued rather than swallowed', async () => {
  var store = fakeStorage();
  var dead = { from: function () { throw new Error('offline'); } };
  sync.useOutbox(store);
  await sync.pushOverride(dead, 'old-offline-edit', { status: 'done' });

  // Lands the queued op; the network is still down for anything else.
  var flaky = {
    from: function () {
      return {
        upsert: function (row) {
          if (row && row.id === 'old-offline-edit') {
            // Mid-flight, the owner clicks a status on another card.
            return sync.pushOverride(dead, 'new-edit', { status: 'queue' })
              .then(function () { return { data: null, error: null }; });
          }
          return Promise.resolve({ data: null, error: { message: 'offline' } });
        }
      };
    }
  };

  var sent = await sync.flushOutbox(flaky);

  assert.equal(sent, 1);
  var queued = JSON.parse(store.getItem('backlog-sync-outbox'));
  assert.deepEqual(queued.map(function (e) { return e.id; }), ['new-edit']);
  assert.deepEqual(queued[0].patch, { status: 'queue' });
  sync.useOutbox(null);
});

// An edit to a title that is itself mid-replay merges into the entry being
// retried, so the entry no longer describes work the remote has seen. It has to
// stay queued even though the request it was merged into succeeded.
test('an edit merged into the entry being replayed is not dropped by its success', async () => {
  var store = fakeStorage();
  var dead = { from: function () { throw new Error('offline'); } };
  sync.useOutbox(store);
  await sync.pushOverride(dead, 'a', { status: 'done' });

  var client = {
    from: function () {
      return {
        upsert: function () {
          // The owner rates the same title while the status write is in flight.
          return sync.pushOverride(dead, 'a', { rating: 9 })
            .then(function () { return { data: null, error: null }; });
        }
      };
    }
  };

  await sync.flushOutbox(client);

  var queued = JSON.parse(store.getItem('backlog-sync-outbox'));
  assert.equal(queued.length, 1);
  assert.deepEqual(queued[0].patch, { status: 'done', rating: 9 });
  sync.useOutbox(null);
});

// The tab is closed partway through. Everything the remote has not confirmed
// must still be in localStorage, because localStorage is all that is left.
test('an interrupted replay leaves every unconfirmed op in the queue', async () => {
  var store = fakeStorage();
  var dead = { from: function () { throw new Error('offline'); } };
  sync.useOutbox(store);
  await sync.pushOverride(dead, 'first', { status: 'done' });
  await sync.pushOverride(dead, 'second', { status: 'queue' });
  await sync.pushOverride(dead, 'third', { rating: 7 });

  // The second request never settles — this is the process going away.
  var hanging = {
    from: function () {
      return {
        upsert: function (row) {
          if (row && row.id === 'second') return new Promise(function () {});
          return Promise.resolve({ data: null, error: null });
        }
      };
    }
  };

  sync.flushOutbox(hanging); // deliberately not awaited
  for (var i = 0; i < 50; i++) await Promise.resolve();

  var queued = JSON.parse(store.getItem('backlog-sync-outbox'));
  assert.deepEqual(queued.map(function (e) { return e.id; }), ['second', 'third']);
  assert.deepEqual(queued[1].patch, { rating: 7 });
  sync.useOutbox(null);
});

// The queue shrinks one confirmed entry at a time, never in a batch at the end.
test('flushOutbox removes each entry as it is confirmed, not all at the end', async () => {
  var store = fakeStorage();
  var dead = { from: function () { throw new Error('offline'); } };
  sync.useOutbox(store);
  await sync.pushOverride(dead, 'a', { status: 'done' });
  await sync.pushOverride(dead, 'b', { status: 'done' });

  var seen = [];
  var client = {
    from: function () {
      return {
        upsert: function () {
          seen.push(JSON.parse(store.getItem('backlog-sync-outbox')).map(function (e) { return e.id; }));
          return Promise.resolve({ data: null, error: null });
        }
      };
    }
  };

  await sync.flushOutbox(client);

  assert.deepEqual(seen, [['a', 'b'], ['b']]);
  assert.deepEqual(JSON.parse(store.getItem('backlog-sync-outbox')), []);
  sync.useOutbox(null);
});

// The replay must not re-queue its own failure on top of the entry it is
// retrying — that was the job the `replaying` flag used to do badly.
test('a replay that fails again leaves exactly one entry, not two', async () => {
  var store = fakeStorage();
  var dead = { from: function () { throw new Error('offline'); } };
  sync.useOutbox(store);
  await sync.pushOverride(dead, 'a', { status: 'done' });
  await sync.pushParts(dead, 'd', [0]);

  var stillDead = {
    from: function () {
      return {
        upsert: function () { return Promise.resolve({ data: null, error: { message: 'offline' } }); }
      };
    }
  };
  assert.equal(await sync.flushOutbox(stillDead), 0);

  var queued = JSON.parse(store.getItem('backlog-sync-outbox'));
  assert.deepEqual(queued.map(function (e) { return e.t + ':' + e.id; }), ['override:a', 'parts:d']);
  sync.useOutbox(null);
});

// The flag used to leak: a replay that never finished left `replaying === true`
// for the rest of the page's life, and from then on *every* failed push was
// silently dropped instead of queued. Nothing is left set now.
test('a replay left in flight does not stop later edits from queueing', async () => {
  var store = fakeStorage();
  var dead = { from: function () { throw new Error('offline'); } };
  sync.useOutbox(store);
  await sync.pushOverride(dead, 'stuck', { status: 'done' });

  sync.flushOutbox({ from: function () { return { upsert: function () { return new Promise(function () {}); } }; } });
  for (var i = 0; i < 20; i++) await Promise.resolve();

  await sync.pushOverride(dead, 'later', { status: 'queue' });
  var ids = JSON.parse(store.getItem('backlog-sync-outbox')).map(function (e) { return e.id; });
  assert.equal(ids.indexOf('later') !== -1, true);
  sync.useOutbox(null);
});

// ── echo suppression ───────────────────────────────────────────────────
//
// A push comes back as a realtime event on the pushing tab too. Re-pulling and
// re-rendering off your own click is pure flicker, so each push leaves a mark
// that the matching event consumes on the way in.

test('a pushed row leaves an echo mark that the matching event consumes', async () => {
  sync._resetEchoes();
  await sync.pushOverride(fullClient(), 'frieren-2023', { status: 'done' });
  assert.equal(sync.consumeEcho('overrides', 'frieren-2023'), true);
});

test('an echo mark is consumed exactly once', async () => {
  sync._resetEchoes();
  await sync.pushOverride(fullClient(), 'a', { status: 'done' });
  sync.consumeEcho('overrides', 'a');
  assert.equal(sync.consumeEcho('overrides', 'a'), false);
});

test('a remote row this tab never wrote is not treated as an echo', async () => {
  sync._resetEchoes();
  await sync.pushOverride(fullClient(), 'a', { status: 'done' });
  assert.equal(sync.consumeEcho('overrides', 'b'), false);
  assert.equal(sync.consumeEcho('parts', 'a'), false);
});

// A mark left behind by a push whose event never arrived (dropped socket, a
// reconnect that swallowed it) must not silently eat a genuine remote change
// half an hour later.
test('an echo mark expires', async () => {
  sync._resetEchoes();
  await sync.pushOverride(fullClient(), 'a', { status: 'done' });
  assert.equal(sync.consumeEcho('overrides', 'a', Date.now() + 60000), false);
});

// ── subscribe ──────────────────────────────────────────────────────────

function fakeChannel() {
  var handlers = [];
  var channel = {
    handlers: handlers,
    subscribed: false,
    on: function (event, filter, handler) {
      handlers.push({ event: event, filter: filter, handler: handler });
      return channel;
    },
    subscribe: function () { channel.subscribed = true; return channel; }
  };
  return channel;
}

test('subscribe registers one postgres_changes listener per table and subscribes', () => {
  var channel = fakeChannel();
  var client = { channel: function () { return channel; } };
  sync.subscribe(client, function () {}, { tables: ['overrides', 'drafts'] });
  assert.deepEqual(channel.handlers.map(function (h) { return h.filter.table; }), ['overrides', 'drafts']);
  assert.equal(channel.handlers[0].event, 'postgres_changes');
  assert.equal(channel.handlers[0].filter.schema, 'public');
  assert.equal(channel.subscribed, true);
});

test('subscribe calls onChange for a remote row', async () => {
  sync._resetEchoes();
  var channel = fakeChannel();
  var calls = 0;
  sync.subscribe({ channel: function () { return channel; } }, function () { calls += 1; }, { tables: ['overrides'], debounceMs: 0 });
  channel.handlers[0].handler({ new: { id: 'remote-title' } });
  await new Promise(function (r) { setTimeout(r, 20); });
  assert.equal(calls, 1);
});

test('subscribe ignores an event this tab just caused', async () => {
  sync._resetEchoes();
  var channel = fakeChannel();
  var calls = 0;
  await sync.pushOverride(fullClient(), 'mine', { status: 'done' });
  sync.subscribe({ channel: function () { return channel; } }, function () { calls += 1; }, { tables: ['overrides'], debounceMs: 0 });
  channel.handlers[0].handler({ new: { id: 'mine' } });
  await new Promise(function (r) { setTimeout(r, 20); });
  assert.equal(calls, 0);
});

test('subscribe reads the id off payload.old for a delete event', async () => {
  sync._resetEchoes();
  var channel = fakeChannel();
  var calls = 0;
  await sync.pushDelete(fullClient(), 'gone', true);
  sync.subscribe({ channel: function () { return channel; } }, function () { calls += 1; }, { tables: ['drafts'], debounceMs: 0 });
  channel.handlers[0].handler({ old: { id: 'gone' } });
  await new Promise(function (r) { setTimeout(r, 20); });
  assert.equal(calls, 0);
});

test('subscribe collapses a burst of remote events into one onChange', async () => {
  sync._resetEchoes();
  var channel = fakeChannel();
  var calls = 0;
  sync.subscribe({ channel: function () { return channel; } }, function () { calls += 1; }, { tables: ['overrides'], debounceMs: 15 });
  channel.handlers[0].handler({ new: { id: 'a' } });
  channel.handlers[0].handler({ new: { id: 'b' } });
  channel.handlers[0].handler({ new: { id: 'c' } });
  await new Promise(function (r) { setTimeout(r, 60); });
  assert.equal(calls, 1);
});

test('subscribe returns null rather than throwing when realtime is unavailable', () => {
  assert.equal(sync.subscribe(null, function () {}), null);
  assert.equal(sync.subscribe({ channel: function () { throw new Error('no ws'); } }, function () {}), null);
});

// ── createClient ───────────────────────────────────────────────────────

test('createClient returns null when the SDK never loaded', () => {
  assert.equal(sync.createClient('https://x.supabase.co', 'key', null), null);
});

test('createClient passes url and key through to the SDK', () => {
  var seen = null;
  var sdk = { createClient: function (url, key) { seen = { url: url, key: key }; return { fake: true }; } };
  var client = sync.createClient('https://x.supabase.co', 'anon-key', sdk);
  assert.deepEqual(seen, { url: 'https://x.supabase.co', key: 'anon-key' });
  assert.deepEqual(client, { fake: true });
});

test('createClient returns null rather than throwing when the SDK throws', () => {
  var sdk = { createClient: function () { throw new Error('bad url'); } };
  assert.equal(sync.createClient('nonsense', 'key', sdk), null);
});

// tests/storage.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { setOverride, getDeleted, deleteTitle, applyOverlay, addTitle, getAdded, removeAdded, isSupersededBy, pruneAdded, combineWithAdded, getCheckedParts, setCheckedParts, setPartChecked, deriveStatus } = require('../lib/storage.js');

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

test('removeAdded drops only the matching draft', () => {
  var storage = fakeStorage();
  addTitle(storage, { id: 'dune-3', title: 'Dune 3' });
  addTitle(storage, { id: 'tron-ares', title: 'Tron Ares' });
  var kept = removeAdded(storage, 'dune-3');
  assert.deepEqual(kept.map(function (t) { return t.id; }), ['tron-ares']);
  assert.deepEqual(getAdded(storage).map(function (t) { return t.id; }), ['tron-ares']);
});

test('deleting a draft removes it from backlog-added and never tombstones it', () => {
  var storage = fakeStorage();
  addTitle(storage, { id: 'dune-3', title: 'Dune 3' });
  deleteTitle(storage, 'dune-3');
  assert.deepEqual(getAdded(storage), []);
  assert.deepEqual(getDeleted(storage), []);
});

test('a draft can be deleted and then re-added under the same id', () => {
  var storage = fakeStorage();
  var base = [{ id: 'barbie-2023', title: 'Barbie' }];

  addTitle(storage, { id: 'dune-3', title: 'Dune 3', draft: true });
  deleteTitle(storage, 'dune-3');
  assert.deepEqual(applyOverlay(combineWithAdded(base, storage), storage).map(function (t) { return t.id; }), ['barbie-2023']);

  // Same name typed again mints the same id, because the deleted draft is gone
  // from the existing-id set. It must come back, not be eaten by a tombstone.
  addTitle(storage, { id: 'dune-3', title: 'Dune 3', draft: true });
  var visible = applyOverlay(combineWithAdded(base, storage), storage);
  assert.deepEqual(visible.map(function (t) { return t.id; }), ['barbie-2023', 'dune-3']);
});

test('deleting a base-catalog title still tombstones it', () => {
  var storage = fakeStorage();
  addTitle(storage, { id: 'dune-3', title: 'Dune 3' });
  deleteTitle(storage, 'barbie-2023');
  assert.deepEqual(getDeleted(storage), ['barbie-2023']);
  assert.deepEqual(getAdded(storage).map(function (t) { return t.id; }), ['dune-3']);
  var visible = applyOverlay([{ id: 'barbie-2023', title: 'Barbie' }], storage);
  assert.deepEqual(visible, []);
});

test('isSupersededBy accepts an exact match or a four-digit year suffix', () => {
  assert.equal(isSupersededBy('dune-3', 'dune-3'), true);
  assert.equal(isSupersededBy('dune-3', 'dune-3-2026'), true);
  assert.equal(isSupersededBy('dune-3', 'dune-3000-2020'), false);
  assert.equal(isSupersededBy('dune-3', 'dune-3-remastered'), false);
  assert.equal(isSupersededBy('dune-3', 'dune-3-20261'), false);
  assert.equal(isSupersededBy('dune-3', 'barbie-2023'), false);
});

test('combineWithAdded drops a draft once data.js adds the same title with a year', () => {
  var storage = fakeStorage();
  addTitle(storage, { id: 'dune-3', title: 'Dune 3 (draft)', draft: true });
  var base = [{ id: 'dune-3-2026', title: 'Dune 3', synopsis: 'real synopsis' }];
  assert.deepEqual(combineWithAdded(base, storage), base);
  assert.deepEqual(getAdded(storage), []);
});

test('combineWithAdded keeps a draft when a prefix-matching but different title exists', () => {
  var storage = fakeStorage();
  addTitle(storage, { id: 'dune-3', title: 'Dune 3', draft: true });
  var base = [{ id: 'dune-3000-2020', title: 'Dune 3000' }];
  var result = combineWithAdded(base, storage);
  assert.deepEqual(result.map(function (t) { return t.id; }), ['dune-3000-2020', 'dune-3']);
  assert.equal(getAdded(storage).length, 1);
});

// ── Season/part tracking ─────────────────────────────────────────────────
//
// `parts` is catalog data (what exists, and whether it has come out yet);
// which of them the owner has seen is local state, so the two are stored
// apart — the checked indices live under their own `backlog-parts` key and
// only the *derived* status is written back through `setOverride`.

const RELEASED_ONLY = [
  { name: 'Сезон 1', year: 2019, released: true },
  { name: 'Сезон 2', year: 2020, released: true }
];

const ONE_PENDING = [
  { name: 'Сезон 1', year: 2019, released: true },
  { name: 'Сезон 2', year: 2020, released: true },
  { name: 'Сезон 3', year: 2027, released: false }
];

test('getCheckedParts is empty for a title that was never touched', () => {
  var storage = fakeStorage();
  assert.deepEqual(getCheckedParts(storage, 're-zero-2016'), []);
});

test('setPartChecked adds and removes a single index, per title', () => {
  var storage = fakeStorage();
  setPartChecked(storage, 're-zero-2016', 0, true);
  setPartChecked(storage, 're-zero-2016', 2, true);
  setPartChecked(storage, 'the-boys-2019', 1, true);
  assert.deepEqual(getCheckedParts(storage, 're-zero-2016'), [0, 2]);
  assert.deepEqual(getCheckedParts(storage, 'the-boys-2019'), [1]);

  setPartChecked(storage, 're-zero-2016', 0, false);
  assert.deepEqual(getCheckedParts(storage, 're-zero-2016'), [2]);
  assert.deepEqual(getCheckedParts(storage, 'the-boys-2019'), [1]);
});

test('setPartChecked is idempotent in both directions', () => {
  var storage = fakeStorage();
  setPartChecked(storage, 'x', 1, true);
  setPartChecked(storage, 'x', 1, true);
  assert.deepEqual(getCheckedParts(storage, 'x'), [1]);
  setPartChecked(storage, 'x', 1, false);
  setPartChecked(storage, 'x', 1, false);
  assert.deepEqual(getCheckedParts(storage, 'x'), []);
});

// Anything that is not a non-negative integer is dropped rather than coerced —
// including the string '2'. A JSON round-trip of this key can only ever produce
// numbers, so a string here means the payload was hand-edited or corrupt, and
// guessing at what it meant is worse than ignoring it.
test('checked indices are stored sorted, deduped and free of junk', () => {
  var storage = fakeStorage();
  setCheckedParts(storage, 'x', [3, 1, 1, '2', -1, 2.5, null, undefined, NaN]);
  assert.deepEqual(getCheckedParts(storage, 'x'), [1, 3]);
});

test('a corrupt backlog-parts payload reads as empty rather than throwing', () => {
  var storage = fakeStorage();
  storage.setItem('backlog-parts', '{not json');
  assert.deepEqual(getCheckedParts(storage, 'x'), []);
});

test('unchecking the last part leaves an explicit empty record, not a missing one', () => {
  var storage = fakeStorage();
  setPartChecked(storage, 'x', 0, true);
  setPartChecked(storage, 'x', 0, false);
  assert.deepEqual(JSON.parse(storage.getItem('backlog-parts')), { x: [] });
});

test('deriveStatus returns null when there is nothing to derive from', () => {
  assert.equal(deriveStatus(undefined, []), null);
  assert.equal(deriveStatus(null, []), null);
  assert.equal(deriveStatus([], []), null);
  assert.equal(deriveStatus('nonsense', []), null);
});

test('deriveStatus: nothing checked is queue', () => {
  assert.equal(deriveStatus(RELEASED_ONLY, []), 'queue');
  assert.equal(deriveStatus(ONE_PENDING, []), 'queue');
});

test('deriveStatus: some checked is in_progress', () => {
  assert.equal(deriveStatus(RELEASED_ONLY, [0]), 'in_progress');
  assert.equal(deriveStatus(ONE_PENDING, [1]), 'in_progress');
});

test('deriveStatus: every part checked with nothing pending is done', () => {
  assert.equal(deriveStatus(RELEASED_ONLY, [0, 1]), 'done');
});

// The reason this feature exists. "I have seen everything that is out" must
// never be spelled "завершено", or the "still waiting for more" signal is lost.
test('deriveStatus: all released parts checked but one still pending stays in_progress', () => {
  assert.equal(deriveStatus(ONE_PENDING, [0, 1]), 'in_progress');
});

test('deriveStatus: a pending part cannot be checked into done, however hard the state tries', () => {
  // Even a stored index pointing at the unreleased part — stale data, a hand-
  // edited localStorage — must not tip the list over into done.
  assert.equal(deriveStatus(ONE_PENDING, [0, 1, 2]), 'in_progress');
});

test('deriveStatus ignores checks on unreleased parts entirely', () => {
  // Only the pending part is ticked: nothing watchable has been watched, so
  // this is still an untouched backlog entry, not one in progress.
  assert.equal(deriveStatus(ONE_PENDING, [2]), 'queue');
});

test('deriveStatus ignores out-of-range indices', () => {
  assert.equal(deriveStatus(RELEASED_ONLY, [0, 1, 9]), 'done');
  assert.equal(deriveStatus(RELEASED_ONLY, [7]), 'queue');
});

test('deriveStatus: a list with nothing released yet is queue, never done', () => {
  // A show announced but not aired. There is nothing to have watched, so it
  // sits in the backlog — and it can never be done, because it is all pending.
  var announced = [{ name: 'Сезон 1', year: 2027, released: false }];
  assert.equal(deriveStatus(announced, []), 'queue');
  assert.equal(deriveStatus(announced, [0]), 'queue');
});

test('deriveStatus treats a missing released flag as released', () => {
  var loose = [{ name: 'Сезон 1', year: 2019 }, { name: 'Фильм', year: 2020 }];
  assert.equal(deriveStatus(loose, [0, 1]), 'done');
});

test('deriveStatus is a pure function of its arguments', () => {
  var parts = ONE_PENDING.slice();
  var checked = [0, 1];
  deriveStatus(parts, checked);
  assert.deepEqual(checked, [0, 1]);
  assert.deepEqual(parts, ONE_PENDING);
});

test('checked parts survive a status override write on the same title', () => {
  // The two concerns share an id but not a key, so writing the derived status
  // through the existing overrides path must not disturb the checklist.
  var storage = fakeStorage();
  setPartChecked(storage, 'the-boys-2019', 0, true);
  setOverride(storage, 'the-boys-2019', { status: 'in_progress', rating: 9 });
  assert.deepEqual(getCheckedParts(storage, 'the-boys-2019'), [0]);
  var visible = applyOverlay([{ id: 'the-boys-2019', status: 'queue', rating: null }], storage);
  assert.equal(visible[0].status, 'in_progress');
  // The checklist must not leak onto the title object — nothing downstream
  // (filters, sort, validation) knows what a checkedParts field would be.
  assert.equal('checkedParts' in visible[0], false);
});

test('the full check-everything-released round trip on a title with a pending part', () => {
  var storage = fakeStorage();
  var id = 're-zero-2016';
  assert.equal(deriveStatus(ONE_PENDING, getCheckedParts(storage, id)), 'queue');
  setPartChecked(storage, id, 0, true);
  assert.equal(deriveStatus(ONE_PENDING, getCheckedParts(storage, id)), 'in_progress');
  setPartChecked(storage, id, 1, true);
  assert.equal(deriveStatus(ONE_PENDING, getCheckedParts(storage, id)), 'in_progress');
  // …and back down again.
  setPartChecked(storage, id, 1, false);
  setPartChecked(storage, id, 0, false);
  assert.equal(deriveStatus(ONE_PENDING, getCheckedParts(storage, id)), 'queue');
});

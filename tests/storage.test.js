// tests/storage.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { getOverrides, setOverride, getDeleted, deleteTitle, applyOverlay, addTitle, getAdded, removeAdded, isSupersededBy, pruneAdded, combineWithAdded, getCheckedParts, setCheckedParts, setPartChecked, deriveStatus, deriveAiringStatus, partsProgress, hasPartsChecklist, effectiveStatus, withDerivedStatus } = require('../lib/storage.js');

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

// Task 50: this list used to derive to `queue`, which read as "available, just
// not started" for something that has not aired at all. It is `unreleased` now.
test('deriveStatus: a list with nothing released yet is unreleased, never done', () => {
  var announced = [{ name: 'Сезон 1', year: 2027, released: false }];
  assert.equal(deriveStatus(announced, []), 'unreleased');
  assert.equal(deriveStatus(announced, [0]), 'unreleased');
  // Any length, and a stray check on a pending part cannot promote it.
  var twoAnnounced = [
    { name: 'Сезон 1', year: 2027, released: false },
    { name: 'Сезон 2', year: 2028, released: false }
  ];
  assert.equal(deriveStatus(twoAnnounced, []), 'unreleased');
  assert.equal(deriveStatus(twoAnnounced, [0, 1]), 'unreleased');
  assert.equal(deriveStatus(twoAnnounced, [9]), 'unreleased');
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

// ── The status of a parts-bearing title is DERIVED, never written on read ──
//
// Review finding (Important): merely opening the modal used to reconcile a
// stale stored status by calling setOverride, so a pure view action destroyed
// the owner's own «Завершено» mark with no confirmation and no undo. The fix
// makes the derived status a *read-time* property of the title, so the card,
// the modal, the filters and the counters all agree without anything being
// persisted until the owner actually ticks a box. These tests pin that down.

const PARTS_TITLE = {
  id: 're-zero-2016',
  category: 'anime',
  status: 'queue',
  parts: ONE_PENDING
};

test('hasPartsChecklist is true only for a series/anime with a non-empty parts array', () => {
  assert.equal(hasPartsChecklist(PARTS_TITLE), true);
  assert.equal(hasPartsChecklist({ id: 'x', category: 'series', parts: RELEASED_ONLY }), true);
  assert.equal(hasPartsChecklist({ id: 'x', category: 'movie', parts: RELEASED_ONLY }), false);
  assert.equal(hasPartsChecklist({ id: 'x', category: 'anime', parts: [] }), false);
  assert.equal(hasPartsChecklist({ id: 'x', category: 'anime' }), false);
  assert.equal(hasPartsChecklist(null), false);
});

test('applyOverlay derives the status of a parts-bearing title from its checklist', () => {
  var storage = fakeStorage();
  setPartChecked(storage, 're-zero-2016', 0, true);
  var visible = applyOverlay([PARTS_TITLE], storage);
  assert.equal(visible[0].status, 'in_progress');
});

test('applyOverlay does NOT write the derived status back to storage', () => {
  // The regression this whole round exists for. A stored «Завершено» that
  // disagrees with an empty checklist is displayed as the derived value and
  // left in storage untouched, so nothing is lost and a later migration can
  // still see what the owner had actually marked.
  var storage = fakeStorage();
  setOverride(storage, 're-zero-2016', { status: 'done', rating: 10 });
  var before = storage.getItem('backlog-overrides');
  var visible = applyOverlay([PARTS_TITLE], storage);
  assert.equal(visible[0].status, 'queue');   // shown as derived…
  assert.equal(visible[0].rating, 10);        // …the rest of the override still applies
  assert.equal(storage.getItem('backlog-overrides'), before); // …and nothing was written
  assert.deepEqual(getOverrides(storage)['re-zero-2016'], { status: 'done', rating: 10 });
  // Reading twice must be just as inert as reading once.
  applyOverlay([PARTS_TITLE], storage);
  assert.equal(storage.getItem('backlog-overrides'), before);
});

test('applyOverlay does not mutate the parts-bearing title it derives for', () => {
  var storage = fakeStorage();
  setPartChecked(storage, 're-zero-2016', 0, true);
  applyOverlay([PARTS_TITLE], storage);
  assert.equal(PARTS_TITLE.status, 'queue');
});

test('applyOverlay leaves a title without a checklist on its stored status', () => {
  var storage = fakeStorage();
  setOverride(storage, 'frieren-2023', { status: 'done' });
  var visible = applyOverlay([{ id: 'frieren-2023', category: 'anime', status: 'queue' }], storage);
  assert.equal(visible[0].status, 'done');
});

test('effectiveStatus falls back to the stored status when there is nothing to derive from', () => {
  var storage = fakeStorage();
  assert.equal(effectiveStatus(storage, { id: 'x', category: 'movie', status: 'done' }), 'done');
  assert.equal(effectiveStatus(storage, { id: 'x', category: 'anime', parts: [], status: 'done' }), 'done');
});

test('partsProgress ignores a checked index that is out of range', () => {
  // Minor #3: the counter used to read `!isReleased(parts[9])` → `!undefined`
  // → true, so a stale index inflated «Просмотрено N из M» next to a badge
  // that (correctly) had not moved. Counting by walking `parts` rather than
  // the checked list makes that impossible by construction.
  var p = partsProgress(ONE_PENDING, [9]);
  assert.deepEqual(p, { released: 2, pending: 1, watched: 0 });
  assert.equal(deriveStatus(ONE_PENDING, [9]), 'queue');
});

test('partsProgress does not count a check on an unreleased part as watched', () => {
  assert.deepEqual(partsProgress(ONE_PENDING, [0, 2]), { released: 2, pending: 1, watched: 1 });
});

test('partsProgress and deriveStatus can never disagree — they share one count', () => {
  var cases = [[], [0], [0, 1], [0, 1, 2], [2], [5], [-1], [0, 0]];
  cases.forEach(function (checked) {
    var p = partsProgress(ONE_PENDING, checked);
    var status = deriveStatus(ONE_PENDING, checked);
    if (p.watched === 0) assert.equal(status, 'queue');
    else assert.equal(status, 'in_progress'); // pending > 0, so done is unreachable
    assert.ok(p.watched <= p.released);
  });
});

// ── Task 50: the airing badge is derived from `parts` too ──────────────────
//
// `airingStatus` used to be hand-maintained on every title, and on a
// parts-bearing one it drifted stale against the very list that already says
// what is out and what is coming. For those titles it is now derived on read,
// exactly like `status` — same read-only discipline, same one place.

const ALL_PENDING = [
  { name: 'Сезон 1', year: 2027, released: false },
  { name: 'Сезон 2', year: 2028, released: false }
];

test('deriveAiringStatus: mixed is ongoing, everything else is completed', () => {
  assert.equal(deriveAiringStatus(ONE_PENDING), 'ongoing');   // 2 out, 1 to come
  assert.equal(deriveAiringStatus(RELEASED_ONLY), 'completed'); // nothing left
  assert.equal(deriveAiringStatus(ALL_PENDING), 'completed');   // inert: see below
  assert.equal(deriveAiringStatus([{ name: 'Сезон 1', year: 2019, released: true }]), 'completed');
});

test('deriveAiringStatus returns null when there is nothing to derive from', () => {
  assert.equal(deriveAiringStatus(undefined), null);
  assert.equal(deriveAiringStatus(null), null);
  assert.equal(deriveAiringStatus([]), null);
  assert.equal(deriveAiringStatus('nonsense'), null);
});

test('deriveAiringStatus is a pure function of its argument', () => {
  var parts = ONE_PENDING.slice();
  deriveAiringStatus(parts);
  assert.deepEqual(parts, ONE_PENDING);
});

test('withDerivedStatus corrects a stale airingStatus on a mixed parts list', () => {
  var storage = fakeStorage();
  var title = { id: 're-zero-2016', category: 'anime', status: 'queue', airingStatus: 'completed', parts: ONE_PENDING };
  var out = withDerivedStatus(storage, title);
  assert.equal(out.airingStatus, 'ongoing');
  assert.equal(out.status, 'queue');
  assert.notEqual(out, title);          // a copy was needed…
  assert.equal(title.airingStatus, 'completed'); // …and the original is untouched
});

test('withDerivedStatus leaves an already-correct mixed title as the same object', () => {
  var storage = fakeStorage();
  var title = { id: 're-zero-2016', category: 'anime', status: 'queue', airingStatus: 'ongoing', parts: ONE_PENDING };
  var out = withDerivedStatus(storage, title);
  assert.equal(out, title); // nothing differs, so nothing is cloned
  assert.equal(out.airingStatus, 'ongoing');
});

test('withDerivedStatus clones for airingStatus alone when only that field differs', () => {
  // status already matches the derived value, airingStatus does not: the clone
  // must still happen, and must carry the corrected badge.
  var storage = fakeStorage();
  var title = { id: 're-zero-2016', category: 'anime', status: 'queue', airingStatus: 'completed', parts: ONE_PENDING };
  var out = withDerivedStatus(storage, title);
  assert.notEqual(out, title);
  assert.deepEqual({ status: out.status, airingStatus: out.airingStatus }, { status: 'queue', airingStatus: 'ongoing' });
});

// The double-signal rule, tested through the function that owns it. An
// all-pending title derives to `unreleased`, and the badge must be off — the
// status chip already says «Ещё не вышло», so «Всё ещё выходит» next to it
// would be redundant and contradictory. This holds no matter what the stored
// airingStatus claimed.
test('withDerivedStatus on an all-pending list derives unreleased AND forces the badge off', () => {
  var storage = fakeStorage();
  var title = { id: 'upcoming-2027', category: 'anime', status: 'queue', airingStatus: 'ongoing', parts: ALL_PENDING };
  var out = withDerivedStatus(storage, title);
  assert.equal(out.status, 'unreleased');
  assert.equal(out.airingStatus, 'completed');
});

test('a stray check on an unreleased part cannot bring the badge back', () => {
  // Nothing a viewer (or corrupt storage) can do reaches the badge: it is a
  // fact about the parts list, and the unreleased clamp sits above it anyway.
  var storage = fakeStorage();
  setPartChecked(storage, 'upcoming-2027', 0, true);
  setPartChecked(storage, 'upcoming-2027', 9, true);
  var title = { id: 'upcoming-2027', category: 'anime', status: 'done', airingStatus: 'ongoing', parts: ALL_PENDING };
  var out = withDerivedStatus(storage, title);
  assert.equal(out.status, 'unreleased');
  assert.equal(out.airingStatus, 'completed');
});

test('withDerivedStatus never derives ongoing for a fully released parts list', () => {
  var storage = fakeStorage();
  // done: everything released, everything checked.
  setCheckedParts(storage, 'wrapped-2019', [0, 1]);
  var done = withDerivedStatus(storage, { id: 'wrapped-2019', category: 'series', status: 'queue', airingStatus: 'ongoing', parts: RELEASED_ONLY });
  assert.deepEqual({ status: done.status, airingStatus: done.airingStatus }, { status: 'done', airingStatus: 'completed' });

  // in_progress: everything released, not everything watched — the ordinary
  // "I'm midway through a finished show" state, and plainly reachable.
  var storage2 = fakeStorage();
  setCheckedParts(storage2, 'wrapped-2019', [0]);
  var mid = withDerivedStatus(storage2, { id: 'wrapped-2019', category: 'series', status: 'queue', airingStatus: 'ongoing', parts: RELEASED_ONLY });
  assert.deepEqual({ status: mid.status, airingStatus: mid.airingStatus }, { status: 'in_progress', airingStatus: 'completed' });

  // queue: everything released, nothing watched.
  var storage3 = fakeStorage();
  var untouched = withDerivedStatus(storage3, { id: 'wrapped-2019', category: 'series', status: 'queue', airingStatus: 'ongoing', parts: RELEASED_ONLY });
  assert.deepEqual({ status: untouched.status, airingStatus: untouched.airingStatus }, { status: 'queue', airingStatus: 'completed' });
});

test('withDerivedStatus leaves airingStatus alone on a title without a parts checklist', () => {
  var storage = fakeStorage();
  // No parts at all.
  var movie = { id: 'barbie-2023', category: 'movie', status: 'done', airingStatus: 'ongoing' };
  assert.equal(withDerivedStatus(storage, movie), movie);
  assert.equal(withDerivedStatus(storage, movie).airingStatus, 'ongoing');

  // A series with no parts list: still hand-maintained, still untouched.
  var series = { id: 'frieren-2023', category: 'series', status: 'queue', airingStatus: 'ongoing' };
  assert.equal(withDerivedStatus(storage, series), series);

  // Empty parts array — hasPartsChecklist is false, so same again.
  var empty = { id: 'x', category: 'anime', status: 'queue', airingStatus: 'completed', parts: [] };
  assert.equal(withDerivedStatus(storage, empty), empty);

  // Wrong category with a real parts array: the checklist gate is what decides,
  // and a movie is never parts-bearing however its data looks.
  var oddMovie = { id: 'y', category: 'movie', status: 'queue', airingStatus: 'completed', parts: ONE_PENDING };
  assert.equal(withDerivedStatus(storage, oddMovie), oddMovie);
  assert.equal(withDerivedStatus(storage, oddMovie).airingStatus, 'completed');

  // …and a null airingStatus is a value like any other: not invented, not filled in.
  var noBadge = { id: 'z', category: 'game', status: 'queue', airingStatus: null };
  assert.equal(withDerivedStatus(storage, noBadge), noBadge);
});

test('applyOverlay hands the derived airingStatus to consumers', () => {
  // The badge renderer and the "returning" filter read title.airingStatus and
  // nothing else, so this is the whole integration surface.
  var storage = fakeStorage();
  var visible = applyOverlay([
    { id: 're-zero-2016', category: 'anime', status: 'queue', airingStatus: 'completed', parts: ONE_PENDING },
    { id: 'upcoming-2027', category: 'anime', status: 'queue', airingStatus: 'ongoing', parts: ALL_PENDING },
    { id: 'barbie-2023', category: 'movie', status: 'done', airingStatus: 'ongoing' }
  ], storage);
  assert.deepEqual(visible.map(function (t) { return [t.status, t.airingStatus]; }), [
    ['queue', 'ongoing'],
    ['unreleased', 'completed'],
    ['done', 'ongoing']
  ]);
  // Still a pure read: nothing was persisted for any of them.
  assert.equal(storage.getItem('backlog-overrides'), null);
});

// ── Brute force: prove the claims rather than assert them ──────────────────
//
// Two things this task must not get wrong, swept over every parts list of
// length 1-4 and every subset of checked indices (plus a stray out-of-range
// one): (1) moving the `released === 0` check to the top of deriveStatus
// changes NO existing outcome, and (2) an `unreleased` title never carries an
// `ongoing` badge, whatever the stored fields said.

function legacyDeriveStatus(parts, checkedIndices) {
  // deriveStatus exactly as it stood before Task 50.
  if (!Array.isArray(parts) || parts.length === 0) return null;
  var p = partsProgress(parts, checkedIndices);
  if (p.watched === 0) return 'queue';
  if (p.watched === p.released && p.pending === 0) return 'done';
  return 'in_progress';
}

function everyPartsList(maxLen) {
  var lists = [];
  for (var len = 1; len <= maxLen; len += 1) {
    for (var mask = 0; mask < (1 << len); mask += 1) {
      var parts = [];
      for (var i = 0; i < len; i += 1) {
        parts.push({ name: 'Часть ' + (i + 1), released: (mask & (1 << i)) !== 0 });
      }
      lists.push(parts);
    }
  }
  return lists;
}

function everyCheckedSubset(len) {
  var subsets = [];
  for (var mask = 0; mask < (1 << len); mask += 1) {
    var checked = [];
    for (var i = 0; i < len; i += 1) if (mask & (1 << i)) checked.push(i);
    subsets.push(checked);
    subsets.push(checked.concat([len + 5])); // …and the same with a stale index
  }
  return subsets;
}

test('deriveStatus is byte-for-byte unchanged for every list with a released part', () => {
  var checkedCases = 0;
  everyPartsList(4).forEach(function (parts) {
    everyCheckedSubset(parts.length).forEach(function (checked) {
      var p = partsProgress(parts, checked);
      if (p.released > 0) {
        assert.equal(deriveStatus(parts, checked), legacyDeriveStatus(parts, checked));
        checkedCases += 1;
      } else {
        // The one new case — and the old code said `queue` for all of it,
        // because released === 0 forces watched === 0.
        assert.equal(p.watched, 0);
        assert.equal(legacyDeriveStatus(parts, checked), 'queue');
        assert.equal(deriveStatus(parts, checked), 'unreleased');
      }
    });
  });
  assert.ok(checkedCases > 100); // the sweep actually ran
});

test('a derived unreleased title can never carry an ongoing badge', () => {
  ['ongoing', 'completed', null, undefined].forEach(function (stored) {
    everyPartsList(4).forEach(function (parts) {
      everyCheckedSubset(parts.length).forEach(function (checked) {
        var storage = fakeStorage();
        setCheckedParts(storage, 'sweep', checked);
        var out = withDerivedStatus(storage, {
          id: 'sweep', category: 'anime', status: 'queue', airingStatus: stored, parts: parts
        });
        var p = partsProgress(parts, checked);
        assert.equal(out.status, deriveStatus(parts, checked));
        assert.ok(!(out.status === 'unreleased' && out.airingStatus === 'ongoing'));
        assert.equal(out.airingStatus, (p.released > 0 && p.pending > 0) ? 'ongoing' : 'completed');
      });
    });
  });
});

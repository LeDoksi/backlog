// @ts-nocheck — ported verbatim from v1's node:test suite. The fixtures are
// deliberately partial or malformed to exercise the modules' defensive paths,
// so they are run, not type-checked.
import assert from 'node:assert/strict';
import { deriveStatus, deriveAiringStatus, partsProgress, hasPartsChecklist, isCaughtUp } from '../../src/lib/storage';

const RELEASED_ONLY = [
  { name: 'Сезон 1', year: 2019, released: true },
  { name: 'Сезон 2', year: 2020, released: true }
];

const ONE_PENDING = [
  { name: 'Сезон 1', year: 2019, released: true },
  { name: 'Сезон 2', year: 2020, released: true },
  { name: 'Сезон 3', year: 2027, released: false }
];

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

test('isCaughtUp: every released part watched and more announced', () => {
  var anime = { id: 'frieren-2023', category: 'anime', status: 'queue', parts: [
    { name: 'Сезон 1', released: true }, { name: 'Сезон 2', released: true }, { name: 'Сезон 3', released: false }
  ] };
  assert.equal(isCaughtUp(anime, [0, 1]), true);
  assert.equal(isCaughtUp(anime, [0]), false);
  assert.equal(isCaughtUp(anime, []), false);
});

test('isCaughtUp: false without pending parts, without released parts, or without a checklist', () => {
  var finished = { id: 'a', category: 'series', parts: [{ name: 'S1', released: true }] };
  var future = { id: 'b', category: 'series', parts: [{ name: 'S1', released: false }] };
  var movie = { id: 'c', category: 'movie', status: 'queue' };
  assert.equal(isCaughtUp(finished, [0]), false);
  assert.equal(isCaughtUp(future, []), false);
  assert.equal(isCaughtUp(movie, []), false);
});

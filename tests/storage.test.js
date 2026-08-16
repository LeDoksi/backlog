// tests/storage.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { setOverride, getDeleted, deleteTitle, applyOverlay, addTitle, getAdded, pruneAdded, combineWithAdded } = require('../lib/storage.js');

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

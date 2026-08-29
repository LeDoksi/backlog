// tests/slug.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { slugify, makeId, uniqueId } = require('../lib/slug.js');

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

test('uniqueId returns the plain slug when not taken', () => {
  assert.equal(uniqueId('Dune 3', []), 'dune-3');
});

test('uniqueId appends a numeric suffix on collision', () => {
  assert.equal(uniqueId('Dune 3', ['dune-3']), 'dune-3-2');
});

test('uniqueId keeps incrementing past multiple collisions', () => {
  assert.equal(uniqueId('Dune 3', ['dune-3', 'dune-3-2', 'dune-3-3']), 'dune-3-4');
});

test('uniqueId suffixes when the bare slug would be superseded by an existing slug-year id', () => {
  // A genuinely different work (the original 2001 Shaman King) sharing a
  // franchise name with an already-cataloged entry (the 2021 remake,
  // shaman-king-2021) must not mint the same bare id — that id would vanish
  // the moment pruneAdded ran, mistaken for a draft the 2021 entry already
  // covers. Mirrors BacklogStorage.isSupersededBy's own collision rule.
  assert.equal(uniqueId('Shaman King', ['shaman-king-2021']), 'shaman-king-2');
});

test('uniqueId does not treat an unrelated longer id as a collision', () => {
  // "dune-3000-2020" must not block "dune-3": it is not "dune-3" plus a
  // four-digit year suffix, just a longer id that happens to start the same.
  assert.equal(uniqueId('Dune 3', ['dune-3000-2020']), 'dune-3');
});

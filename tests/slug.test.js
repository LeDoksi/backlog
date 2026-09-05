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

test('uniqueId no longer suffixes when the bare slug matches an existing slug-year id', () => {
  // A genuinely different work (the original 2001 Shaman King) sharing a
  // franchise name with an already-cataloged entry (the 2021 remake,
  // shaman-king-2021) mints its own clean id now — there is only one id
  // source left (the drafts table), so "shaman-king" and "shaman-king-2021"
  // are simply two different strings, never a collision.
  assert.equal(uniqueId('Shaman King', ['shaman-king-2021']), 'shaman-king');
});

test('uniqueId does not treat an unrelated longer id as a collision', () => {
  // "dune-3000-2020" must not block "dune-3": it is not "dune-3" plus a
  // four-digit year suffix, just a longer id that happens to start the same.
  assert.equal(uniqueId('Dune 3', ['dune-3000-2020']), 'dune-3');
});

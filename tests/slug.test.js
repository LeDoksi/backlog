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

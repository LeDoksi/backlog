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

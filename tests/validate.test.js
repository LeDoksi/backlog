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

// tests/query.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { isReturning, matchesFilters, matchesSearch, sortTitles, countProgress } = require('../lib/query.js');

test('isReturning is true only when done and airing ongoing', () => {
  assert.equal(isReturning({ status: 'done', airingStatus: 'ongoing' }), true);
  assert.equal(isReturning({ status: 'done', airingStatus: 'completed' }), false);
  assert.equal(isReturning({ status: 'queue', airingStatus: 'ongoing' }), false);
});

test('matchesFilters filters by category', () => {
  var title = { category: 'anime', status: 'queue', genres: ['драма'] };
  assert.equal(matchesFilters(title, { category: 'anime' }), true);
  assert.equal(matchesFilters(title, { category: 'movie' }), false);
});

test('matchesFilters "all" category matches everything', () => {
  var title = { category: 'anime', status: 'queue', genres: [] };
  assert.equal(matchesFilters(title, { category: 'all' }), true);
});

test('matchesFilters filters by genre', () => {
  var title = { category: 'movie', status: 'queue', genres: ['драма', 'триллер'] };
  assert.equal(matchesFilters(title, { genre: 'триллер' }), true);
  assert.equal(matchesFilters(title, { genre: 'комедия' }), false);
});

test('matchesFilters filters by returning flag', () => {
  var returning = { category: 'anime', status: 'done', airingStatus: 'ongoing', genres: [] };
  var notReturning = { category: 'anime', status: 'done', airingStatus: 'completed', genres: [] };
  assert.equal(matchesFilters(returning, { returning: true }), true);
  assert.equal(matchesFilters(notReturning, { returning: true }), false);
});

test('matchesSearch is a case-insensitive substring match', () => {
  assert.equal(matchesSearch({ title: "Frieren: Beyond Journey's End" }, 'journey'), true);
  assert.equal(matchesSearch({ title: 'Frieren' }, 'zzz'), false);
  assert.equal(matchesSearch({ title: 'Frieren' }, ''), true);
});

test('sortTitles by name ascending', () => {
  var titles = [{ title: 'Zorro' }, { title: 'Alien' }];
  var sorted = sortTitles(titles, 'name');
  assert.equal(sorted[0].title, 'Alien');
});

test('sortTitles by rating descending', () => {
  var titles = [{ title: 'A', rating: 5 }, { title: 'B', rating: 9 }];
  var sorted = sortTitles(titles, 'rating');
  assert.equal(sorted[0].title, 'B');
});

test('sortTitles does not mutate the input array', () => {
  var titles = [{ title: 'Zorro' }, { title: 'Alien' }];
  sortTitles(titles, 'name');
  assert.equal(titles[0].title, 'Zorro');
});

test('countProgress counts done vs total', () => {
  var titles = [{ status: 'done' }, { status: 'queue' }, { status: 'done' }];
  assert.deepEqual(countProgress(titles), { done: 2, total: 3 });
});

test('sortTitles by status puts in_progress first, queue second, done last', () => {
  var titles = [
    { title: 'A', status: 'done' },
    { title: 'B', status: 'queue' },
    { title: 'C', status: 'in_progress' }
  ];
  var sorted = sortTitles(titles, 'status');
  assert.deepEqual(sorted.map(function (t) { return t.title; }), ['C', 'B', 'A']);
});

test('sortTitles by status is stable for equal-priority items', () => {
  var titles = [
    { title: 'A', status: 'queue' },
    { title: 'B', status: 'queue' }
  ];
  var sorted = sortTitles(titles, 'status');
  assert.deepEqual(sorted.map(function (t) { return t.title; }), ['A', 'B']);
});

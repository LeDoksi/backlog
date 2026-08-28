// lib/query.js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BacklogQuery = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  // unreleased sorts last: it is the least actionable state (nothing to do
  // with it yet) and the one worth seeing least of when sorting "by status".
  var STATUS_PRIORITY = { in_progress: 0, queue: 1, unreleased: 2, done: 3 };

  // "Still airing" is a fact about the title, not about the viewer: the franchise
  // has more coming whether or not you have caught up with it. This used to be
  // `isReturning` — done AND ongoing — which hid the flag on precisely the titles
  // it matters most on, the ones you are part-way through and might be waiting on
  // an episode of. Decoupled from `status`, it is now a plain property of the
  // title, which is also why nothing needs to recompute it when a status changes.
  function isStillAiring(title) {
    return title.airingStatus === 'ongoing';
  }

  function matchesFilters(title, filters) {
    filters = filters || {};
    if (filters.category && filters.category !== 'all' && title.category !== filters.category) return false;
    if (filters.status && filters.status !== 'all' && title.status !== filters.status) return false;
    // Genres are OR, not AND: picking "комедия" and "драма" asks for everything
    // that is either one, so each added genre widens the wall rather than
    // narrowing it to the titles tagged with both. An empty array means "no
    // genre filter" — the state the app sits in on load and after every
    // category switch — so it must fall through, not match nothing.
    if (filters.genre && filters.genre !== 'all' && filters.genre.length) {
      var wanted = filters.genre;
      var hit = wanted.some(function (genre) { return (title.genres || []).indexOf(genre) !== -1; });
      if (!hit) return false;
    }
    // `returning` is the toolbar checkbox's long-standing state key (and the
    // #returning-filter id it is bound to); what it selects for is now simply
    // "still airing".
    if (filters.returning && !isStillAiring(title)) return false;
    return true;
  }

  function matchesSearch(title, query) {
    if (!query) return true;
    return title.title.toLowerCase().indexOf(query.toLowerCase()) !== -1;
  }

  function sortTitles(titles, sortKey) {
    var copy = titles.slice();
    switch (sortKey) {
      case 'name':
        return copy.sort(function (a, b) { return a.title.localeCompare(b.title); });
      case 'year':
        return copy.sort(function (a, b) { return (b.year || 0) - (a.year || 0); });
      case 'rating':
        return copy.sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); });
      case 'status':
        return copy.sort(function (a, b) { return STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]; });
      case 'added':
      default:
        return copy;
    }
  }

  function countProgress(titles) {
    var done = titles.filter(function (t) { return t.status === 'done'; }).length;
    return { done: done, total: titles.length };
  }

  function pickRandom(titles) {
    if (!titles.length) return null;
    return titles[Math.floor(Math.random() * titles.length)];
  }

  return {
    isStillAiring: isStillAiring,
    matchesFilters: matchesFilters,
    matchesSearch: matchesSearch,
    sortTitles: sortTitles,
    countProgress: countProgress,
    pickRandom: pickRandom
  };
}));

// lib/query.js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BacklogQuery = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  var STATUS_PRIORITY = { in_progress: 0, queue: 1, done: 2 };

  function isReturning(title) {
    return title.status === 'done' && title.airingStatus === 'ongoing';
  }

  function matchesFilters(title, filters) {
    filters = filters || {};
    if (filters.category && filters.category !== 'all' && title.category !== filters.category) return false;
    if (filters.status && filters.status !== 'all' && title.status !== filters.status) return false;
    if (filters.genre && filters.genre !== 'all' && title.genres.indexOf(filters.genre) === -1) return false;
    if (filters.returning && !isReturning(title)) return false;
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
    isReturning: isReturning,
    matchesFilters: matchesFilters,
    matchesSearch: matchesSearch,
    sortTitles: sortTitles,
    countProgress: countProgress,
    pickRandom: pickRandom
  };
}));

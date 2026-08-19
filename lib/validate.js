(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BacklogValidate = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  var CATEGORIES = ['game', 'series', 'movie', 'anime'];
  var STATUSES = ['queue', 'in_progress', 'done'];
  var AIRING_STATUSES = ['ongoing', 'completed'];

  // A few optional, free-form fields exist on titles but are intentionally not
  // validated here: `seasonInfo` (series/anime), `platforms` (game, a string[]
  // of release platform names), `originalTitle` (the source-language name, see
  // below) and `parts` (series/anime, see below). Absent is fine; when present
  // their shape is not enforced — same treatment for all four.
  //
  // `originalTitle` is the name the title was released under at home — English
  // for most of the catalogue, romaji for anime. It exists because `title` is
  // the Russian localisation and the two are often unrecognisably different
  // («Большой куш» / Snatch). Shown only in the modal, as a subtitle, and only
  // when it actually differs from `title` — a game named the same in both
  // places, or a Russian production, simply leaves it out.
  //
  // `parts` is the season/part checklist: the seasons, films and OVAs a
  // series/anime is made of, in release order, as
  //   [{ name: 'Сезон 1', year: 2016, released: true }, …]
  // `name` is free text (a season, a film, an OVA, a split cour — whatever fits
  // the franchise), `year` is a number or null, `released` is a boolean and is
  // the only part of the shape anything downstream reads: `released: false`
  // renders the row disabled and keeps the title from ever deriving to `done`
  // (BacklogStorage.deriveStatus). A title with no `parts` keeps the plain
  // three-state control, which is what every un-migrated entry relies on.

  function validateTitle(title) {
    var errors = [];
    if (!title.id || typeof title.id !== 'string') errors.push('id is required and must be a string');
    if (!title.title || typeof title.title !== 'string') errors.push('title is required and must be a string');
    if (CATEGORIES.indexOf(title.category) === -1) errors.push('category must be one of: ' + CATEGORIES.join(', '));
    if (STATUSES.indexOf(title.status) === -1) errors.push('status must be one of: ' + STATUSES.join(', '));
    var needsAiring = title.category === 'series' || title.category === 'anime';
    if (needsAiring) {
      if (AIRING_STATUSES.indexOf(title.airingStatus) === -1) {
        errors.push('airingStatus must be one of: ' + AIRING_STATUSES.join(', ') + ' for series/anime');
      }
    } else if (title.airingStatus !== null && title.airingStatus !== undefined) {
      errors.push('airingStatus must be null for game/movie');
    }
    if (title.year !== null && typeof title.year !== 'number') errors.push('year must be a number or null');
    if (!Array.isArray(title.genres)) errors.push('genres must be an array');
    if (title.rating !== null && (typeof title.rating !== 'number' || title.rating < 1 || title.rating > 10)) {
      errors.push('rating must be null or a number between 1 and 10');
    }
    if (typeof title.synopsis !== 'string') errors.push('synopsis must be a string');
    if (!title.cover || typeof title.cover !== 'string') errors.push('cover is required and must be a string path');
    return errors;
  }

  function validateCatalog(titles) {
    var errors = [];
    var seenIds = {};
    titles.forEach(function (title, index) {
      var label = '[' + index + '] ' + (title.id || '(no id)');
      validateTitle(title).forEach(function (err) {
        errors.push(label + ': ' + err);
      });
      if (title.id) {
        if (seenIds[title.id]) errors.push(label + ': duplicate id');
        seenIds[title.id] = true;
      }
    });
    return errors;
  }

  return { validateTitle: validateTitle, validateCatalog: validateCatalog };
}));

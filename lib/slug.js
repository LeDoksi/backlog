// lib/slug.js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BacklogSlug = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  var CYRILLIC_MAP = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
    и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
    щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
  };

  function transliterate(str) {
    return str.toLowerCase().split('').map(function (ch) {
      return Object.prototype.hasOwnProperty.call(CYRILLIC_MAP, ch) ? CYRILLIC_MAP[ch] : ch;
    }).join('');
  }

  function slugify(text) {
    return transliterate(text)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function makeId(title, year) {
    var base = slugify(title);
    return year ? base + '-' + year : base;
  }

  // A bare candidate collides not only when some existing id equals it
  // outright, but also when an existing id is that candidate plus a
  // four-digit year suffix (`shaman-king` vs. an already-cataloged
  // `shaman-king-2021`) — the exact pattern BacklogStorage.isSupersededBy
  // uses to decide a draft is covered by a catalog entry. Left unchecked, a
  // brand-new draft for a genuinely different work (the original 2001 Shaman
  // King, say, next to the existing 2021 remake) would mint the same bare
  // slug and then vanish the moment pruneAdded ran, mistaken for a draft the
  // catalog had already absorbed. Suffixing here, symmetrically with that
  // check, keeps the two title-minting paths from disagreeing about whether
  // an id is "the same title" or just "the same first few letters."
  function collidesWithExisting(id, existingIds) {
    if (existingIds.indexOf(id) !== -1) return true;
    var prefix = id + '-';
    return existingIds.some(function (existing) {
      return existing.indexOf(prefix) === 0 && /^\d{4}$/.test(existing.slice(prefix.length));
    });
  }

  function uniqueId(title, existingIds) {
    var base = slugify(title);
    var candidate = base;
    var n = 2;
    while (collidesWithExisting(candidate, existingIds)) {
      candidate = base + '-' + n;
      n += 1;
    }
    return candidate;
  }

  return { slugify: slugify, makeId: makeId, uniqueId: uniqueId };
}));

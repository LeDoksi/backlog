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

  // The drafts table is the only place an id is ever minted from now on, so a
  // plain existing-id check is correct and sufficient: two titles that share a
  // slug but differ by year already get different ids from makeId (see
  // applyQuickAddPick in app.js, which uses makeId whenever a year is known),
  // and a genuine re-add of the same title+year produces the same id and lands
  // here rather than being suffixed into a second, duplicate entry.
  function uniqueId(title, existingIds) {
    var base = slugify(title);
    var candidate = base;
    var n = 2;
    while (existingIds.indexOf(candidate) !== -1) {
      candidate = base + '-' + n;
      n += 1;
    }
    return candidate;
  }

  return { slugify: slugify, makeId: makeId, uniqueId: uniqueId };
}));

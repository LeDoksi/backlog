// lib/storage.js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BacklogStorage = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  var OVERRIDES_KEY = 'backlog-overrides';
  var DELETED_KEY = 'backlog-deleted';
  var ADDED_KEY = 'backlog-added';

  function readJSON(storage, key, fallback) {
    var raw = storage.getItem(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function getOverrides(storage) {
    return readJSON(storage, OVERRIDES_KEY, {});
  }

  function setOverride(storage, id, patch) {
    var overrides = getOverrides(storage);
    overrides[id] = Object.assign({}, overrides[id], patch);
    storage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
  }

  function getDeleted(storage) {
    return readJSON(storage, DELETED_KEY, []);
  }

  // A locally added draft is deleted by dropping it from `backlog-added`, not by
  // tombstoning it in `backlog-deleted`. Tombstoning a draft would be permanent:
  // its object stays in `backlog-added` forever while its id sits in the deleted
  // list, so re-adding the same title (which mints the same slug id again, the
  // old one no longer being in the "existing ids" set) would be filtered right
  // back out by the stale tombstone and the card would silently never appear.
  function deleteTitle(storage, id) {
    var isDraft = getAdded(storage).some(function (t) { return t.id === id; });
    if (isDraft) {
      removeAdded(storage, id);
      return;
    }
    var deleted = getDeleted(storage);
    if (deleted.indexOf(id) === -1) {
      deleted.push(id);
      storage.setItem(DELETED_KEY, JSON.stringify(deleted));
    }
  }

  function applyOverlay(titles, storage) {
    var overrides = getOverrides(storage);
    var deleted = getDeleted(storage);
    return titles
      .filter(function (t) { return deleted.indexOf(t.id) === -1; })
      .map(function (t) {
        return overrides[t.id] ? Object.assign({}, t, overrides[t.id]) : t;
      });
  }

  function getAdded(storage) {
    return readJSON(storage, ADDED_KEY, []);
  }

  function addTitle(storage, title) {
    var added = getAdded(storage);
    added.push(title);
    storage.setItem(ADDED_KEY, JSON.stringify(added));
  }

  function removeAdded(storage, id) {
    var kept = getAdded(storage).filter(function (t) { return t.id !== id; });
    storage.setItem(ADDED_KEY, JSON.stringify(kept));
    return kept;
  }

  // Is a locally added draft superseded by this base-catalog entry?
  //
  // The two id conventions differ on purpose: quick-add has no year field, so it
  // mints a bare slug (`dune-3`), while `data.js` entries are `slug-year`
  // (`dune-3-2026`). A draft is therefore considered superseded either by an
  // exact id match or by a base id that is the draft id plus a four-digit year
  // suffix. The digit test is what keeps `dune-3` from matching an unrelated
  // `dune-3000-2020`.
  function isSupersededBy(draftId, baseId) {
    if (draftId === baseId) return true;
    var prefix = draftId + '-';
    return baseId.indexOf(prefix) === 0 && /^\d{4}$/.test(baseId.slice(prefix.length));
  }

  function pruneAdded(storage, baseIds) {
    var added = getAdded(storage);
    var kept = added.filter(function (t) {
      return !baseIds.some(function (b) { return isSupersededBy(t.id, b); });
    });
    if (kept.length !== added.length) {
      storage.setItem(ADDED_KEY, JSON.stringify(kept));
    }
    return kept;
  }

  function combineWithAdded(baseTitles, storage) {
    var baseIds = baseTitles.map(function (t) { return t.id; });
    var added = pruneAdded(storage, baseIds);
    return baseTitles.concat(added);
  }

  return {
    getOverrides: getOverrides,
    setOverride: setOverride,
    getDeleted: getDeleted,
    deleteTitle: deleteTitle,
    applyOverlay: applyOverlay,
    getAdded: getAdded,
    addTitle: addTitle,
    removeAdded: removeAdded,
    isSupersededBy: isSupersededBy,
    pruneAdded: pruneAdded,
    combineWithAdded: combineWithAdded
  };
}));

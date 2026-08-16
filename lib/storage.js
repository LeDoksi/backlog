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

  function deleteTitle(storage, id) {
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

  function pruneAdded(storage, baseIds) {
    var added = getAdded(storage);
    var kept = added.filter(function (t) { return baseIds.indexOf(t.id) === -1; });
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
    pruneAdded: pruneAdded,
    combineWithAdded: combineWithAdded
  };
}));

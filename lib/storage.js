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
  var PARTS_KEY = 'backlog-parts';

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
        var merged = overrides[t.id] ? Object.assign({}, t, overrides[t.id]) : t;
        // Derived last, and read-only: for a title with a parts checklist the
        // checklist outranks any stored status, and it does so without writing
        // anything back. See the note above `effectiveStatus`.
        return withDerivedStatus(storage, merged);
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

  // ── Season/part tracking ───────────────────────────────────────────────
  //
  // A series/anime title may carry `parts`: the seasons, films and OVAs it is
  // made of, in release order, each flagged `released: true|false`. That is
  // catalog data — it says what exists, not what the owner has watched.
  //
  // Which parts they *have* watched is local state, and it gets its own key
  // rather than a field on `backlog-overrides`. Two reasons. First, overrides
  // are merged straight onto the title object by `applyOverlay`, so a
  // `checkedParts` field there would ride along into every consumer — filters,
  // sort, the validator, the card renderer — none of which know what it is.
  // Second, the checklist and the status are different kinds of fact: the
  // checklist is the input, the status is the output. Only the output belongs
  // on the title, and it is written through the existing `setOverride` path so
  // that every surface already built on `status` keeps working untouched.
  //
  // Shape: { "<title id>": [0, 2, 3] } — the indices of the checked parts.
  // Indices, not names: `parts` is written once in release order and only ever
  // appended to (a season that has aired does not un-air), so an index is
  // stable, while a name is free text that may well get retitled.

  function getPartsState(storage) {
    var state = readJSON(storage, PARTS_KEY, {});
    return (state && typeof state === 'object' && !Array.isArray(state)) ? state : {};
  }

  // Anything that is not a non-negative integer is not an index into `parts`,
  // and duplicates would make "how many are checked" a lie. Sorted so the
  // stored value is stable and diffable, whatever order the clicks came in.
  function normalizeIndices(indices) {
    if (!Array.isArray(indices)) return [];
    var seen = {};
    var out = [];
    indices.forEach(function (n) {
      if (typeof n !== 'number' || !isFinite(n) || n < 0 || Math.floor(n) !== n) return;
      if (seen[n]) return;
      seen[n] = true;
      out.push(n);
    });
    return out.sort(function (a, b) { return a - b; });
  }

  function getCheckedParts(storage, id) {
    return normalizeIndices(getPartsState(storage)[id]);
  }

  function setCheckedParts(storage, id, indices) {
    var state = getPartsState(storage);
    // Written even when empty, on purpose: "nothing checked" is a decision the
    // owner made, and it has to be distinguishable from "never opened".
    state[id] = normalizeIndices(indices);
    storage.setItem(PARTS_KEY, JSON.stringify(state));
    return state[id];
  }

  function setPartChecked(storage, id, index, checked) {
    var current = getCheckedParts(storage, id);
    var at = current.indexOf(index);
    if (checked && at === -1) current.push(index);
    else if (!checked && at !== -1) current.splice(at, 1);
    return setCheckedParts(storage, id, current);
  }

  // How much of a `parts` list has been watched. Counted by walking `parts`,
  // never the checked list — an index that is out of range or points at an
  // unreleased part simply never comes up, so it cannot inflate the count.
  // `deriveStatus` and the modal's «Просмотрено N из M» line both read from
  // here, which is what makes it impossible for the badge and the counter to
  // tell two different stories (they previously could: a stale index of 9 in a
  // 3-part list read `!parts[9].released` → `!undefined` → "watched").
  function partsProgress(parts, checkedIndices) {
    var checked = normalizeIndices(checkedIndices);
    var out = { released: 0, pending: 0, watched: 0 };
    if (!Array.isArray(parts)) return out;
    parts.forEach(function (part, index) {
      if (part && part.released === false) { out.pending += 1; return; }
      out.released += 1;
      if (checked.indexOf(index) !== -1) out.watched += 1;
    });
    return out;
  }

  // The whole point of the feature lives in this function.
  //
  //   nothing checked                          → queue
  //   every released part checked, none pending → done
  //   anything else                            → in_progress
  //
  // "Anything else" is doing the load-bearing work: a list where every part
  // that has actually come out is ticked but one is still unreleased lands
  // here, *not* on done. Marking such a show "завершено" is exactly the signal
  // loss this replaces — you are caught up, you are not finished.
  //
  // Unreleased parts are inert in every direction: they cannot be counted
  // toward completion, and a stray check on one (stale storage, a season that
  // was pushed back after being ticked) is ignored rather than promoting the
  // title. A part is treated as released unless it says `released: false`, so
  // a missing flag fails toward "watchable" rather than silently locking a
  // show at in_progress with no visible reason.
  //
  // Returns null when there is no list to derive from — the caller falls back
  // to the plain three-state control for titles not yet migrated.
  function deriveStatus(parts, checkedIndices) {
    if (!Array.isArray(parts) || parts.length === 0) return null;
    var p = partsProgress(parts, checkedIndices);
    if (p.watched === 0) return 'queue';
    if (p.watched === p.released && p.pending === 0) return 'done';
    return 'in_progress';
  }

  // The one rule for "does this title use a checklist instead of the
  // three-button control", shared by the renderer and by the status
  // derivation so the two can never be gated differently.
  function hasPartsChecklist(title) {
    return !!title
      && (title.category === 'series' || title.category === 'anime')
      && Array.isArray(title.parts) && title.parts.length > 0;
  }

  // The status of a parts-bearing title is COMPUTED ON READ, never written on
  // read.
  //
  // The first cut of this feature reconciled a disagreeing stored status by
  // calling setOverride when the modal opened. That made a pure view action
  // destructive: a title the owner had marked «Завершено» by hand was silently
  // rewritten to «В бэклоге» just by being looked at, with no confirmation and
  // no undo, because an untouched checklist derives to `queue`. At the scale of
  // the full data population that is a mass wipe of real watch history, and a
  // read that mutates state is also unworkable under last-write-wins sync — a
  // device with a stale `backlog-parts` would push its stale derivation over a
  // good value the moment someone opened the title.
  //
  // So the derived value is a *view* of the title, and `backlog-overrides` is
  // written only when the owner actually ticks a box. The stored status stays
  // exactly as they left it underneath, which is also what keeps a future
  // one-time migration (pre-tick the parts of everything marked done) possible
  // at all — that information would otherwise already be gone.
  function effectiveStatus(storage, title) {
    if (!hasPartsChecklist(title)) return title ? title.status : undefined;
    return deriveStatus(title.parts, getCheckedParts(storage, title.id)) || title.status;
  }

  function withDerivedStatus(storage, title) {
    var status = effectiveStatus(storage, title);
    return status === title.status ? title : Object.assign({}, title, { status: status });
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
    combineWithAdded: combineWithAdded,
    getCheckedParts: getCheckedParts,
    setCheckedParts: setCheckedParts,
    setPartChecked: setPartChecked,
    partsProgress: partsProgress,
    deriveStatus: deriveStatus,
    hasPartsChecklist: hasPartsChecklist,
    effectiveStatus: effectiveStatus,
    withDerivedStatus: withDerivedStatus
  };
}));

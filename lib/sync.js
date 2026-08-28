// lib/sync.js — cross-device sync for the edits layer.
//
// ── What this module is, and what it deliberately is not ───────────────
//
// `lib/storage.js` is the whole edit model of this app, and it is well tested
// against a fake `localStorage`. Nothing in it knows or cares where its bytes
// come from — it reads and writes four keys through `getItem`/`setItem` and
// that is the entire contract. So sync is built *around* it rather than
// through it: this module keeps `window.localStorage` as the single thing
// storage.js talks to, and treats Supabase as a mirror of those same four
// keys.
//
//   on load   remote → localStorage (pullState + applyState), then the
//             existing startup sequence runs against a warm local store and
//             notices nothing
//   on write  app.js calls the storage.js function it always called, and then
//             the matching push* here
//   on remote realtime fires, app.js re-pulls and re-renders
//
// The upshot is that `lib/storage.js` did not have to change by one line, and
// every test written against it still describes the shipped behaviour.
//
// ── Table ↔ key map ───────────────────────────────────────────────────
//
//   overrides       ↔ backlog-overrides   { id: { status, rating } }
//   deleted_titles  ↔ backlog-deleted     [ id, … ]
//   drafts          ↔ backlog-added       [ title object, … ]
//   parts           ↔ backlog-parts       { id: [ index, … ] }
//
// One table per key, on purpose: it makes `pullState` four independent
// reshapes with no cross-talk, which is why a table that is missing or
// unreadable costs exactly its own key and leaves the other three alone.
//
// `parts` is the newest of the four and the one an install may not have yet
// (the first three were created before season tracking existed). Everything
// here treats its absence as a normal, survivable condition — see README.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BacklogSync = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  var OVERRIDES_KEY = 'backlog-overrides';
  var DELETED_KEY = 'backlog-deleted';
  var ADDED_KEY = 'backlog-added';
  var PARTS_KEY = 'backlog-parts';

  var T_OVERRIDES = 'overrides';
  var T_DELETED = 'deleted_titles';
  var T_DRAFTS = 'drafts';
  var T_PARTS = 'parts';

  var ALL_TABLES = [T_OVERRIDES, T_DELETED, T_DRAFTS, T_PARTS];

  // Every column of `drafts` that is not `created_at`, in the order the quick-
  // add form builds them. `airingStatus` is the only name that differs between
  // the JS object and the SQL column, so it is the only one listed twice.
  var DRAFT_FIELDS = ['id', 'title', 'category', 'status', 'year', 'genres', 'rating', 'synopsis', 'cover', 'draft'];

  // Task 39: every field the in-UI card editor can write, beyond the
  // status/rating pair `overrides` already carried. `status` is not in this
  // list — it keeps the one rule that is not shared with the rest (see
  // shapeOverrides below) — but every other override column, old or new,
  // flows through the same generic loop.
  // `draft` (Task 43) is on this list because the pull has to be able to read
  // back every column a push can write, and the edit form has written `draft`
  // through the same setOverride/pushOverride pair as everything else since it
  // shipped. Leaving it off meant the column was write-only: unticking
  // «Черновик» reached Supabase and was then dropped on the way back down, so
  // the badge came back on the next load — on this device before the applyState
  // merge below, and on the other device regardless of it. `unreleased` is
  // deliberately *not* here: it is not a column, it is translated into a
  // `status` write by the save handler.
  var EDITABLE_OVERRIDE_FIELDS = ['title', 'category', 'year', 'genres', 'rating', 'synopsis', 'cover', 'originalTitle', 'seasonInfo', 'platforms', 'parts', 'draft'];
  var OVERRIDE_FIELDS = ['status'].concat(EDITABLE_OVERRIDE_FIELDS);

  // `originalTitle`/`seasonInfo` are the only override fields whose SQL column
  // name differs from the JS field name — same convention as `airing_status`
  // in DRAFT_FIELDS/shapeDrafts.
  var OVERRIDE_COLUMNS = { originalTitle: 'original_title', seasonInfo: 'season_info' };
  function overrideColumn(field) { return OVERRIDE_COLUMNS[field] || field; }

  function warn(what, detail) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[sync] ' + what, detail || '');
    }
  }

  // ── createClient ─────────────────────────────────────────────────────
  //
  // The SDK is injected rather than reached for, so the tests can hand in a
  // two-line stand-in and this file never needs a network or a bundler. In the
  // browser the default is the UMD global the CDN tag defines; if that tag
  // failed to load (offline first visit, blocked CDN) the global is simply not
  // there and this returns null — which every other function in this module
  // treats as "no sync today", not as an error.
  function createClient(url, key, sdk) {
    var lib = sdk !== undefined ? sdk : (typeof window !== 'undefined' ? window.supabase : null);
    if (!lib || typeof lib.createClient !== 'function') {
      warn('supabase-js not loaded — running local-only');
      return null;
    }
    try {
      return lib.createClient(url, key);
    } catch (e) {
      warn('could not create client — running local-only', e && e.message);
      return null;
    }
  }

  // ── Reading ──────────────────────────────────────────────────────────

  // Resolves to `{ data, error }` for any input, including a client that
  // throws synchronously. Never rejects: a pull is best-effort by definition.
  function selectAll(client, table) {
    try {
      return Promise.resolve(client.from(table).select('*'))
        .then(function (res) { return res || { data: null, error: { message: 'empty response' } }; })
        .catch(function (e) { return { data: null, error: e || { message: 'unknown' } }; });
    } catch (e) {
      return Promise.resolve({ data: null, error: e });
    }
  }

  // An override row is a *patch*, so the only question this function answers is
  // which of a row's columns the remote is actually asserting something about.
  // A column it is not gets left out entirely — applyOverlay merges the patch
  // straight onto the catalog title with Object.assign, so anything that lands
  // in here overwrites the real data.js value.
  //
  // `undefined` is the easy case: the column does not exist on this row at all.
  //
  // `null` is the one that cost a production incident. `alter table overrides
  // add column if not exists …` gives every pre-existing row a real SQL NULL for
  // each new column, and PostgREST returns that NULL — there is no shape of
  // migration that makes an untouched column come back as absent instead. So the
  // moment the Task 39/43 columns were added, every override row written before
  // that day started reporting `title: null, cover: null, category: null, …`,
  // this function shipped them as genuine overrides, and applyOverlay wrote them
  // over the catalog: cards rendered the literal text "null" as their title
  // (escapeHtml does String(v)) with a broken `<img src="null">` beside it.
  //
  // Nothing the app writes can produce a null for those columns, which is what
  // makes "treat null as absent" safe rather than merely convenient: the edit
  // form sends '' for an empty text field, [] for an empty list and a real
  // boolean for `draft` (see the save handler in app.js). A null in one of those
  // columns can therefore only ever be the migration artefact.
  //
  //   rating   the exception, and the reason this rule was not the original one:
  //            clicking the star you already gave un-rates a title, and null is
  //            how that is stored. A real edit, and it has to travel.
  //   status   excluded when null for its own, older reason: a status-less row
  //            exists only to carry some other field, and merging its null would
  //            blank the catalog's status and take the badge, the status filter
  //            and the status sort down with it. Same outcome as the rule below,
  //            so the two collapse into one line.
  //   year     the known cost. Clearing the year field writes a genuine null, and
  //            that particular edit no longer reaches the other device (it does
  //            persist locally — setOverride wrote it, and applyState now merges
  //            rather than replaces). Indistinguishable on the wire from the
  //            migration's null, and a year that fails to sync is a far smaller
  //            harm than a dozen cards titled "null".
  //
  // This rule only ever sees data coming *from* the remote, so on its own it
  // stops new corruption without repairing a mirror that already took some —
  // which is every device that loaded the app between the migration and this
  // fix, the reported incident included. `scrubArtifactNulls` below is the
  // other half, and the two together are what make the repair automatic.
  function shapeOverrides(rows) {
    var out = {};
    (rows || []).forEach(function (row) {
      if (!row || !row.id) return;
      var patch = {};
      OVERRIDE_FIELDS.forEach(function (field) {
        var value = row[overrideColumn(field)];
        if (value === undefined) return;
        if (value === null && field !== 'rating') return;
        patch[field] = value;
      });
      out[row.id] = patch;
    });
    return out;
  }

  function shapeDeleted(rows) {
    return (rows || [])
      .filter(function (row) { return row && row.id; })
      .map(function (row) { return row.id; });
  }

  // Ordered by created_at because `backlog-added` is an ordered list:
  // BacklogQuery.sortTitles('added') is literally "return the array as it
  // stands", so the insertion order is the sort and it has to survive the
  // round trip. PostgREST makes no ordering promise of its own.
  function shapeDrafts(rows) {
    return (rows || [])
      .filter(function (row) { return row && row.id; })
      .slice()
      .sort(function (a, b) { return String(a.created_at || '').localeCompare(String(b.created_at || '')); })
      .map(function (row) {
        var title = {};
        DRAFT_FIELDS.forEach(function (field) { title[field] = row[field]; });
        title.airingStatus = row.airing_status === undefined ? null : row.airing_status;
        return title;
      });
  }

  function shapeParts(rows) {
    var out = {};
    (rows || []).forEach(function (row) {
      if (!row || !row.id) return;
      out[row.id] = Array.isArray(row.indices) ? row.indices : [];
    });
    return out;
  }

  var SHAPERS = [
    { table: T_OVERRIDES, key: OVERRIDES_KEY, shape: shapeOverrides },
    { table: T_DELETED, key: DELETED_KEY, shape: shapeDeleted },
    { table: T_DRAFTS, key: ADDED_KEY, shape: shapeDrafts },
    { table: T_PARTS, key: PARTS_KEY, shape: shapeParts }
  ];

  // Resolves to { ok, state, errors, tables }.
  //
  // `state` holds only the keys whose table actually answered. That is the
  // load-bearing detail of this function: a key that failed is *absent*, never
  // present-and-empty, so `applyState` below physically cannot mistake a
  // failed fetch for "the remote says you have nothing" and wipe the local
  // mirror. Offline, `state` is `{}` and localStorage is left exactly as the
  // owner left it.
  function pullState(client) {
    if (!client || typeof client.from !== 'function') {
      return Promise.resolve({
        ok: false,
        state: {},
        tables: [],
        errors: ALL_TABLES.map(function (t) { return { table: t, message: 'no client' }; })
      });
    }
    return Promise.all(SHAPERS.map(function (s) { return selectAll(client, s.table); }))
      .then(function (results) {
        var state = {};
        var tables = [];
        var errors = [];
        results.forEach(function (res, i) {
          var s = SHAPERS[i];
          if (res.error || !Array.isArray(res.data)) {
            errors.push({ table: s.table, message: (res.error && res.error.message) || 'no rows' });
            return;
          }
          state[s.key] = s.shape(res.data);
          tables.push(s.table);
        });
        if (errors.length) warn('could not read ' + errors.map(function (e) { return e.table; }).join(', '), errors[0].message);
        return { ok: tables.length > 0, state: state, errors: errors, tables: tables };
      });
  }

  var WRITABLE_KEYS = [OVERRIDES_KEY, DELETED_KEY, ADDED_KEY, PARTS_KEY];

  function keyForTable(table) {
    var found = null;
    SHAPERS.forEach(function (s) { if (s.table === table) found = s.key; });
    return found;
  }

  // `backlog-overrides` is the one key whose pulled value is *merged* into the
  // mirror rather than written over it, and it is merged at two levels: per id,
  // and per field inside an id. The other three keys are whole values — a flat
  // list of tombstoned ids, an ordered list of drafts, a map of id → ticked
  // indices — where the remote rows *are* the value and replacing is the only
  // sane read. An override row is not a value, it is a patch, and a patch is
  // only ever as wide as the columns the table happens to have.
  //
  // That is the bug this exists to close. `shapeOverrides` deliberately omits a
  // field the row came back without (its "present, not merely non-null" rule),
  // so a column that does not exist yet — each of the ten Task 39/43 columns,
  // before that migration was run — makes every pulled patch narrower than the
  // local one. Replacing then erased a field the owner had just set *on this
  // device*: untick «Черновик», which writes `draft: false` into the mirror and
  // fails its push, then reload — `flushOutbox` fails again, `pullIntoMirror`
  // pulls a patch with no `draft` key at all, and the whole-key write drops the
  // edit. No second device involved; a plain refresh reverted it.
  //
  // Merging per field fixes it without weakening sync: a field the remote
  // genuinely carries still wins, `null` included (a null rating is this app's
  // real "un-rated", not a missing value), so a rating cleared on the phone
  // still lands on the laptop. Only a field the remote never mentions — no
  // column, or an id whose override is status-only and has never heard of
  // `genres` — leaves the local value alone.
  //
  // An id missing from the pull entirely is kept for the same reason absence is
  // load-bearing everywhere else in this module: nothing ever deletes an
  // `overrides` row (a removed title is a `deleted_titles` tombstone, and
  // `setOverride` only ever adds), so a missing id means the remote has nothing
  // to say about it, never that it was cleared.
  // The local half of the null repair, and the reason the merge above does not
  // preserve corruption forever.
  //
  // `shapeOverrides` only ever sees the pull, so it cannot reach a mirror that
  // was already poisoned by an *earlier* pull — and merge-not-replace means a
  // field the fixed pull now correctly omits is exactly a field whose stale
  // local value is kept. Left alone, the two fixes would cancel out on the one
  // device that actually hit the incident: it would render "null" forever.
  //
  // So the same rule runs over the local patch before it is merged. A null in
  // the mirror for any field but `rating`/`year` cannot have come from this app
  // — the save handler writes '' for empty text, [] for an empty list and a
  // real boolean for `draft` — so it can only be a pre-fix pull of the
  // migration's artefact NULLs, and dropping it restores the catalog value.
  //
  //   rating  a real un-rating, same exemption as in shapeOverrides.
  //   year    exempt here too, and for a different reason: clearing the year
  //           field does write a genuine null, and unlike the remote side there
  //           is no pull about to re-assert it, so scrubbing would quietly undo
  //           a deliberate local edit. The cost is that a poisoned `year` stays
  //           null on an affected device until that title is edited again —
  //           cosmetic, since a null year simply drops out of the card's meta
  //           line (`filter(Boolean)` in app.js), not the "null" text the
  //           incident was about.
  function scrubArtifactNulls(patch) {
    var out = {};
    Object.keys(patch || {}).forEach(function (field) {
      if (patch[field] === null && field !== 'rating' && field !== 'year') return;
      out[field] = patch[field];
    });
    return out;
  }

  function mergeOverrides(storage, pulled) {
    var local = {};
    try {
      var raw = JSON.parse(storage.getItem(OVERRIDES_KEY) || '{}');
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        Object.keys(raw).forEach(function (id) { local[id] = scrubArtifactNulls(raw[id]); });
      }
    } catch (e) {
      warn('could not read local overrides to merge into', e && e.message);
    }
    var merged = Object.assign({}, local);
    Object.keys(pulled || {}).forEach(function (id) {
      merged[id] = Object.assign({}, local[id], pulled[id]);
    });
    return merged;
  }

  // Writes a pulled state into the mirror. Only the four known keys, only the
  // ones present — see the note on pullState about why absence matters.
  //
  // `options.tables` narrows that further, and it is the second half of the
  // seed guarantee. Seeding is what protects pre-sync local history: it pushes
  // months of local overrides, ratings, deletions and ticked seasons up before
  // the remote is ever allowed to become the authority. But a table's *write*
  // can fail while its *read* succeeds — an RLS policy that grants select and
  // not insert, a column mismatch on the batched upsert, a transient 429 — and
  // then the pull would answer with real, well-formed remote rows that have
  // simply never heard of this device's local edits, and applying them would
  // wipe exactly the history the seed exists to save. So the caller passes the
  // tables it has *confirmed* seeded, and a key whose table is not on that list
  // is left alone: the local data survives untouched and the seed is retried on
  // the next load (it stays unmarked in `backlog-sync-seeded`). Omitting the
  // option applies everything present, which is what a caller that does no
  // seeding at all wants.
  function applyState(storage, state, options) {
    if (!storage || !state) return [];
    options = options || {};
    var allowed = null;
    if (options.tables) {
      allowed = {};
      options.tables.forEach(function (table) {
        var key = keyForTable(table);
        if (key) allowed[key] = true;
      });
    }
    var written = [];
    WRITABLE_KEYS.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(state, key)) return;
      if (allowed && !allowed[key]) return;
      try {
        var value = key === OVERRIDES_KEY ? mergeOverrides(storage, state[key]) : state[key];
        storage.setItem(key, JSON.stringify(value));
        written.push(key);
      } catch (e) {
        warn('could not write ' + key, e && e.message);
      }
    });
    return written;
  }

  // ── Echo suppression ─────────────────────────────────────────────────
  //
  // Supabase delivers a realtime event to every subscriber including the tab
  // that caused it, so without this every click would re-pull and re-render
  // off its own write. Each push leaves a `table:id` mark; the matching event
  // consumes it and returns early.
  //
  // Marks expire. A push whose event never arrives (socket dropped mid-flight,
  // a reconnect that swallowed the frame) would otherwise leave a mark sitting
  // there forever, ready to eat a genuine remote edit to that same title an
  // hour later — a silent, one-off sync failure, which is worse than one
  // redundant repaint.
  var ECHO_TTL_MS = 10000;
  var echoes = {};

  function echoKey(table, id) { return table + '\x00' + id; }

  function markEcho(table, id) {
    if (!id) return;
    echoes[echoKey(table, id)] = Date.now() + ECHO_TTL_MS;
  }

  function consumeEcho(table, id, now) {
    var key = echoKey(table, id);
    var expiry = echoes[key];
    if (expiry === undefined) return false;
    delete echoes[key];
    return expiry > (now === undefined ? Date.now() : now);
  }

  function _resetEchoes() { echoes = {}; }

  // ── The outbox ───────────────────────────────────────────────────────
  //
  // Task 30 made this app work offline, which means edits with no network are
  // an ordinary event. Such an edit lands in localStorage and its push fails.
  // Without a record of it, the next online load pulls a remote that never
  // heard about it and `applyState` writes that over the top — quietly
  // destroying a change the owner watched succeed on screen. That would make
  // sync a net loss against the localStorage-only app it replaced.
  //
  // So a failed push is remembered, and the queue is replayed *before* the
  // next pull. Ordering is the entire point: flush, then pull, so the remote
  // already knows about the offline work by the time it becomes the authority.
  //
  // ── Why the queue is never held in memory ────────────────────────────
  //
  // The queue is the only record of an edit the remote has not accepted yet, so
  // the moment it exists anywhere *but* localStorage it is one closed tab away
  // from being gone. Two rules follow, and both are load-bearing:
  //
  //   1. Nothing is removed from the persisted queue until the remote has
  //      confirmed that exact operation. Not "before the replay starts", not
  //      "once the batch is under way" — after each individual success, and
  //      only that one entry. An interrupted replay therefore costs nothing:
  //      whatever has not been confirmed is still sitting in localStorage for
  //      the next load to retry.
  //   2. Enqueueing is never suppressed. An earlier version set a module-level
  //      `replaying` flag to stop a failed replay from re-queueing itself, but
  //      a flag cannot tell a retry apart from the owner clicking a status on
  //      another title mid-flush, so it silently swallowed genuine edits — and
  //      leaked its `true` into every later call if a replay never finished.
  //      The replay now calls push variants that simply do not self-enqueue
  //      (`queueOnFail === false`), which is a property of the call rather than
  //      of global state, so a real concurrent edit queues normally.
  var OUTBOX_KEY = 'backlog-sync-outbox';
  var outboxStorage = null;

  function useOutbox(storage) { outboxStorage = storage; }

  function readOutbox() {
    if (!outboxStorage) return [];
    try {
      var parsed = JSON.parse(outboxStorage.getItem(OUTBOX_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function writeOutbox(list) {
    if (!outboxStorage) return;
    try {
      outboxStorage.setItem(OUTBOX_KEY, JSON.stringify(list));
    } catch (e) {
      warn('could not write the outbox', e && e.message);
    }
  }

  // Repeated offline edits to one title are one intention, so they collapse
  // rather than pile up. Overrides merge their patches instead of replacing:
  // setting a status and then a rating is two different fields, and a plain
  // "last one wins" would drop the first.
  function enqueue(op) {
    if (!outboxStorage) return;
    var list = readOutbox();
    var existing = null;
    var kept = list.filter(function (e) {
      if (e.t === op.t && e.id === op.id) { existing = e; return false; }
      return true;
    });
    if (op.t === 'override' && existing) {
      op = { t: 'override', id: op.id, patch: Object.assign({}, existing.patch, op.patch) };
    }
    kept.push(op);
    writeOutbox(kept);
  }

  // `enqueue` collapses by kind-and-title, so at most one entry in the queue
  // ever answers to a given `t`+`id` pair and that pair identifies an entry.
  function sameOp(a, b) { return !!a && !!b && a.t === b.t && a.id === b.id; }

  function findOp(list, op) {
    var found = null;
    list.forEach(function (e) { if (sameOp(e, op)) found = e; });
    return found;
  }

  // Removes one confirmed-sent entry from the persisted queue — and nothing
  // else, which is the whole point.
  //
  // `snapshot` is the JSON of the entry as it stood when it was handed to the
  // remote. If what is in the queue now still matches it, this entry is exactly
  // the work that just landed and it can go. If it does not match, the owner
  // edited that same title while the request was in flight and `enqueue` merged
  // the new fields in: the entry now describes work the remote has *not* seen,
  // so it stays and the next flush sends it. Comparing the text rather than the
  // fields is deliberately conservative — the failure mode of a false mismatch
  // is one redundant re-send, and the failure mode of a false match is a lost
  // edit.
  function forgetOp(op, snapshot) {
    var list = readOutbox();
    var next = list.filter(function (e) {
      return !(sameOp(e, op) && JSON.stringify(e) === snapshot);
    });
    if (next.length !== list.length) writeOutbox(next);
  }

  // ── Writing ──────────────────────────────────────────────────────────

  // Every push funnels through here, and here is the only place that decides
  // what a failed write means: a warning, `false`, and nothing else. A push is
  // an optimistic extra — localStorage was already written by the time it
  // runs, so the app is correct whether or not this succeeds, and it must
  // never be able to reject into an unhandled rejection or break a click.
  function attempt(label, run) {
    try {
      return Promise.resolve(run())
        .then(function (res) {
          if (res && res.error) {
            warn(label + ' failed', res.error.message || res.error);
            return false;
          }
          return true;
        })
        .catch(function (e) {
          warn(label + ' failed', e && e.message);
          return false;
        });
    } catch (e) {
      warn(label + ' failed', e && e.message);
      return Promise.resolve(false);
    }
  }

  function usable(client) {
    return !!client && typeof client.from === 'function';
  }

  // `patch` carries exactly the fields the owner just changed, and it is sent
  // exactly as given: PostgREST's upsert sets only the columns present in the
  // payload, so a status-only write leaves a stored rating untouched and vice
  // versa. Sending the missing field as null instead would make every status
  // click quietly erase the rating.
  // Every push follows the same shape: try it, and if it did not land, hand the
  // operation to the outbox so it can be replayed when the network comes back.
  //
  // `queueOnFail` is false for exactly one caller — flushOutbox replaying an
  // entry that is already in the queue. Without it the replay would re-queue
  // its own failure on top of the entry it is retrying. It is a per-call
  // argument rather than a module flag on purpose: a flag would also silence
  // the owner's genuine edits for the duration of the flush. See the outbox
  // note above.
  function pushed(result, op, queueOnFail) {
    return result.then(function (ok) {
      if (!ok && queueOnFail) enqueue(op);
      return ok;
    });
  }

  function sendOverride(client, id, patch, queueOnFail) {
    var op = { t: 'override', id: id, patch: patch || {} };
    if (!usable(client)) { if (queueOnFail) enqueue(op); return Promise.resolve(false); }
    var row = { id: id, updated_at: new Date().toISOString() };
    // Through `overrideColumn`, not straight across: `originalTitle` and
    // `seasonInfo` are the two fields whose SQL column is spelled differently,
    // and the read path has always mapped them. Writing the JS name sent
    // PostgREST a column that does not exist — a 400 on every such edit, which
    // `attempt` turns into a queued outbox entry that then retries forever.
    Object.keys(patch || {}).forEach(function (k) { row[overrideColumn(k)] = patch[k]; });
    markEcho(T_OVERRIDES, id);
    return pushed(attempt('pushOverride ' + id, function () {
      return client.from(T_OVERRIDES).upsert(row);
    }), op, queueOnFail);
  }

  function pushOverride(client, id, patch) {
    return sendOverride(client, id, patch, true);
  }

  // Mirrors BacklogStorage.deleteTitle exactly, including its central rule: a
  // locally added draft is deleted by *removing the row*, never by tombstoning
  // it. A tombstone on a draft id would be permanent and shared — re-adding
  // the same title mints the same slug again and the stale tombstone would
  // filter the new card out on every device at once. See the long comment
  // above deleteTitle in lib/storage.js.
  function sendDelete(client, id, wasDraft, queueOnFail) {
    if (wasDraft) return sendRemoveDraft(client, id, queueOnFail);
    var op = { t: 'delete', id: id };
    if (!usable(client)) { if (queueOnFail) enqueue(op); return Promise.resolve(false); }
    markEcho(T_DELETED, id);
    return pushed(attempt('pushDelete ' + id, function () {
      return client.from(T_DELETED).upsert({ id: id, deleted_at: new Date().toISOString() });
    }), op, queueOnFail);
  }

  function pushDelete(client, id, wasDraft) {
    return sendDelete(client, id, wasDraft, true);
  }

  function draftRow(title) {
    var row = {};
    DRAFT_FIELDS.forEach(function (field) { row[field] = title[field]; });
    row.airing_status = title.airingStatus === undefined ? null : title.airingStatus;
    return row;
  }

  function sendDraft(client, title, queueOnFail) {
    if (!title || !title.id) return Promise.resolve(false);
    var op = { t: 'draft', id: title.id, title: title };
    if (!usable(client)) { if (queueOnFail) enqueue(op); return Promise.resolve(false); }
    markEcho(T_DRAFTS, title.id);
    return pushed(attempt('pushDraft ' + title.id, function () {
      return client.from(T_DRAFTS).upsert(draftRow(title));
    }), op, queueOnFail);
  }

  function pushDraft(client, title) {
    return sendDraft(client, title, true);
  }

  function sendRemoveDraft(client, id, queueOnFail) {
    var op = { t: 'removeDraft', id: id };
    if (!usable(client)) { if (queueOnFail) enqueue(op); return Promise.resolve(false); }
    markEcho(T_DRAFTS, id);
    return pushed(attempt('pushRemoveDraft ' + id, function () {
      return client.from(T_DRAFTS).delete().eq('id', id);
    }), op, queueOnFail);
  }

  function pushRemoveDraft(client, id) {
    return sendRemoveDraft(client, id, true);
  }

  // The whole checked list is sent, not a delta: `setCheckedParts` already
  // normalizes and rewrites the array wholesale, so the row is a snapshot of
  // the same value the mirror holds and last-write-wins reads sanely.
  function sendParts(client, id, indices, queueOnFail) {
    var list = Array.isArray(indices) ? indices : [];
    var op = { t: 'parts', id: id, indices: list };
    if (!usable(client)) { if (queueOnFail) enqueue(op); return Promise.resolve(false); }
    markEcho(T_PARTS, id);
    return pushed(attempt('pushParts ' + id, function () {
      return client.from(T_PARTS).upsert({
        id: id,
        indices: list,
        updated_at: new Date().toISOString()
      });
    }), op, queueOnFail);
  }

  function pushParts(client, id, indices) {
    return sendParts(client, id, indices, true);
  }

  // Replays the queue, in the order the edits were made, and resolves to how
  // many landed. Anything that fails again is simply left where it is — still
  // offline is not the same as done.
  //
  // Sequential rather than parallel: two queued edits to the same title have to
  // reach the remote in the order the owner made them, or last-write-wins picks
  // the wrong winner.
  //
  // The queue in localStorage is the authority throughout, and it only ever
  // shrinks by one already-confirmed entry at a time. Kill the process at any
  // point in this loop — close the tab, lose the phone's browser to the OS —
  // and every edit the remote has not acknowledged is still on disk. The list
  // read here is only the *agenda*: which entries this pass intends to visit.
  // Each one is re-read from the queue immediately before it is sent, so an
  // edit the owner merged into it in the meantime travels with it instead of
  // being overwritten by a stale copy.
  //
  // An edit made to a title that is *not* on the agenda queues normally and is
  // left for the next flush: sending it here would mean replaying a moving
  // target. It is on disk, which is what matters.
  function flushOutbox(client) {
    if (!usable(client) || !outboxStorage) return Promise.resolve(0);
    var agenda = readOutbox();
    if (!agenda.length) return Promise.resolve(0);
    var sent = 0;
    return agenda.reduce(function (chain, queuedOp) {
      return chain.then(function () {
        var live = findOp(readOutbox(), queuedOp);
        // Gone already — nothing here to replay.
        if (!live) return;
        var snapshot = JSON.stringify(live);
        return replayOne(client, live).then(function (ok) {
          if (!ok) return;
          sent += 1;
          forgetOp(live, snapshot);
        });
      });
    }, Promise.resolve()).then(function () {
      if (sent) warn('replayed ' + sent + ' offline edit(s)');
      return sent;
    }).catch(function (e) {
      // Nothing above should be able to reject, and if something does the queue
      // is already in a correct state: everything unconfirmed is still on disk.
      warn('outbox replay failed', e && e.message);
      return sent;
    });
  }

  // Deliberately the non-queueing variants: this operation is already in the
  // outbox, and re-queueing it on failure would stack a duplicate on top of the
  // entry being retried.
  function replayOne(client, op) {
    switch (op.t) {
      case 'override': return sendOverride(client, op.id, op.patch, false);
      case 'delete': return sendDelete(client, op.id, false, false);
      case 'draft': return sendDraft(client, op.title, false);
      case 'removeDraft': return sendRemoveDraft(client, op.id, false);
      case 'parts': return sendParts(client, op.id, op.indices, false);
      default: return Promise.resolve(true);
    }
  }

  // ── First run: seed the remote from the local mirror ─────────────────
  //
  // This app was used for months against localStorage alone, so the first tab
  // to ever sync meets a full local store and an empty remote. Pulling first
  // would answer "the shared state is empty", write that over the mirror, and
  // destroy every status, rating, deletion and ticked season the owner has
  // set. So the first run pushes local rows up before it pulls anything down;
  // upserts mean this merges with (rather than overwrites) whatever the
  // partner's device already put there, and a title edited on both simply
  // resolves last-write-wins.
  //
  // Seeding must happen exactly once per table, which is why this reports back
  // *which* tables it managed rather than a bare boolean. Re-seeding a table
  // that has already been reconciled is not merely wasteful, it is wrong: this
  // device's local rows would be pushed up again ahead of the pull, resurrecting
  // whatever the other device had since changed or deleted. Per-table also means
  // a table that does not exist yet (`parts` on an older project) is retried on
  // the next load instead of being written off, and its absence never blocks the
  // other three from being marked done.
  // Batched one upsert per table rather than one per row: a store holding a
  // few hundred edits (this app has 168 titles and season checklists on most
  // of the series) would otherwise open a few hundred connections on the very
  // first load, which is both slow and a good way to get rate-limited on the
  // one request that matters most.
  // `batches` is a list of row arrays; the table counts as seeded only if every
  // one of them landed. A table with nothing local to send is seeded trivially.
  function seedTable(client, table, batches) {
    var real = batches.filter(function (rows) { return rows.length; });
    if (!real.length) return Promise.resolve(table);
    return Promise.all(real.map(function (rows) {
      rows.forEach(function (row) { markEcho(table, row.id); });
      return attempt('seed ' + table, function () { return client.from(table).upsert(rows); });
    })).then(function (results) {
      return results.every(function (ok) { return ok; }) ? table : null;
    });
  }

  // Resolves to the list of table names that are now seeded.
  function seedLocal(client, storage, options) {
    options = options || {};
    var wanted = options.tables || ALL_TABLES;
    if (!usable(client) || !storage) return Promise.resolve([]);
    var now = new Date().toISOString();
    var overrideRows, deletedRows, draftRows, partRows;
    try {
      var overrides = JSON.parse(storage.getItem(OVERRIDES_KEY) || '{}');
      overrideRows = Object.keys(overrides).map(function (id) {
        // Scrubbed and column-mapped for the same reasons as the two write
        // paths above: seeding a poisoned mirror would push the artefact NULLs
        // back up, and a camelCase column name fails the whole batch — which,
        // because a failed seed leaves the table unseeded, would then make
        // `applyState`'s gate skip `overrides` on every subsequent load.
        var patch = scrubArtifactNulls(overrides[id]);
        var row = { id: id, updated_at: now };
        Object.keys(patch).forEach(function (k) { row[overrideColumn(k)] = patch[k]; });
        return row;
      });
      deletedRows = JSON.parse(storage.getItem(DELETED_KEY) || '[]').map(function (id) {
        return { id: id, deleted_at: now };
      });
      draftRows = JSON.parse(storage.getItem(ADDED_KEY) || '[]')
        .filter(function (t) { return t && t.id; })
        .map(draftRow);
      var parts = JSON.parse(storage.getItem(PARTS_KEY) || '{}');
      partRows = Object.keys(parts).map(function (id) {
        return { id: id, indices: Array.isArray(parts[id]) ? parts[id] : [], updated_at: now };
      });
    } catch (e) {
      warn('could not read local state to seed', e && e.message);
      return Promise.resolve([]);
    }
    // A batch upsert sets the union of the keys across its rows, so a
    // rating-only override in the same batch as a status-only one would send
    // `status: null` for the first and blank it. Split by key signature so
    // every batch carries a single column set.
    var overrideBatches = {};
    overrideRows.forEach(function (row) {
      var signature = Object.keys(row).sort().join(',');
      (overrideBatches[signature] = overrideBatches[signature] || []).push(row);
    });

    var plan = {};
    plan[T_OVERRIDES] = Object.keys(overrideBatches).map(function (s) { return overrideBatches[s]; });
    plan[T_DELETED] = [deletedRows];
    plan[T_DRAFTS] = [draftRows];
    plan[T_PARTS] = [partRows];

    var tables = ALL_TABLES.filter(function (t) { return wanted.indexOf(t) !== -1; });
    return Promise.all(tables.map(function (table) {
      return seedTable(client, table, plan[table]);
    })).then(function (results) {
      return results.filter(Boolean);
    });
  }

  // ── Realtime ─────────────────────────────────────────────────────────
  //
  // One channel, one listener per table, one debounced `onChange`. The
  // callback is told nothing about *what* changed on purpose: the handler in
  // app.js re-pulls the whole state anyway, which is four small queries
  // against four small tables and is far simpler to reason about than merging
  // individual events into the mirror by hand.
  //
  // `options.tables` exists so the caller can subscribe only to the tables
  // that actually answered the initial pull — asking realtime for a table that
  // does not exist is a good way to take the whole channel down with it.
  function subscribe(client, onChange, options) {
    options = options || {};
    if (!client || typeof client.channel !== 'function') return null;
    var tables = options.tables || ALL_TABLES;
    var debounceMs = options.debounceMs === undefined ? 300 : options.debounceMs;
    var timer = null;

    function fire() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        try {
          onChange();
        } catch (e) {
          warn('onChange threw', e && e.message);
        }
      }, debounceMs);
    }

    try {
      var channel = client.channel('backlog-sync');
      tables.forEach(function (table) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table: table }, function (payload) {
          // `new` for insert/update, `old` for delete — the id is all that is
          // needed, and only to answer "did this tab cause it".
          var row = (payload && (payload.new || payload.old)) || {};
          if (row.id && consumeEcho(table, row.id)) return;
          fire();
        });
      });
      channel.subscribe();
      return channel;
    } catch (e) {
      warn('realtime unavailable — changes from other devices need a reload', e && e.message);
      return null;
    }
  }

  return {
    KEYS: {
      overrides: OVERRIDES_KEY,
      deleted: DELETED_KEY,
      added: ADDED_KEY,
      parts: PARTS_KEY
    },
    TABLES: ALL_TABLES,
    createClient: createClient,
    pullState: pullState,
    applyState: applyState,
    pushOverride: pushOverride,
    pushDelete: pushDelete,
    pushDraft: pushDraft,
    pushRemoveDraft: pushRemoveDraft,
    pushParts: pushParts,
    seedLocal: seedLocal,
    useOutbox: useOutbox,
    flushOutbox: flushOutbox,
    subscribe: subscribe,
    consumeEcho: consumeEcho,
    _resetEchoes: _resetEchoes
  };
}));

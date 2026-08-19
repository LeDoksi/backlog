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

  // A status of null means "this row exists only to carry a rating" and must
  // not be merged onto the title — applyOverlay Object.assigns the override
  // straight on, so a null would blank the catalog's own status and take the
  // badge, the status filter and the status sort down with it.
  //
  // A rating of null is the opposite: it is a real value the owner set by
  // clicking the star they had already given, and dropping it would make
  // un-rating the one edit that never reaches the other device. Safe to carry
  // because every entry in data.js ships `rating: null` — an override can only
  // ever restore that field to what it already was.
  function shapeOverrides(rows) {
    var out = {};
    (rows || []).forEach(function (row) {
      if (!row || !row.id) return;
      var patch = {};
      if (row.status !== null && row.status !== undefined) patch.status = row.status;
      if (row.rating !== undefined) patch.rating = row.rating;
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

  // Writes a pulled state into the mirror. Only the four known keys, only the
  // ones present — see the note on pullState about why absence matters.
  function applyState(storage, state) {
    if (!storage || !state) return [];
    var written = [];
    WRITABLE_KEYS.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(state, key)) return;
      try {
        storage.setItem(key, JSON.stringify(state[key]));
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

  function echoKey(table, id) { return table + ' ' + id; }

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
  var OUTBOX_KEY = 'backlog-sync-outbox';
  var outboxStorage = null;
  // Set while replaying, so a replay that fails again is re-queued once by
  // flushOutbox itself rather than twice — once here and once by the push.
  var replaying = false;

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
    if (!outboxStorage || replaying) return;
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
  function pushed(result, op) {
    return result.then(function (ok) {
      if (!ok) enqueue(op);
      return ok;
    });
  }

  function pushOverride(client, id, patch) {
    var op = { t: 'override', id: id, patch: patch || {} };
    if (!usable(client)) { enqueue(op); return Promise.resolve(false); }
    var row = { id: id, updated_at: new Date().toISOString() };
    Object.keys(patch || {}).forEach(function (k) { row[k] = patch[k]; });
    markEcho(T_OVERRIDES, id);
    return pushed(attempt('pushOverride ' + id, function () {
      return client.from(T_OVERRIDES).upsert(row);
    }), op);
  }

  // Mirrors BacklogStorage.deleteTitle exactly, including its central rule: a
  // locally added draft is deleted by *removing the row*, never by tombstoning
  // it. A tombstone on a draft id would be permanent and shared — re-adding
  // the same title mints the same slug again and the stale tombstone would
  // filter the new card out on every device at once. See the long comment
  // above deleteTitle in lib/storage.js.
  function pushDelete(client, id, wasDraft) {
    if (wasDraft) return pushRemoveDraft(client, id);
    var op = { t: 'delete', id: id };
    if (!usable(client)) { enqueue(op); return Promise.resolve(false); }
    markEcho(T_DELETED, id);
    return pushed(attempt('pushDelete ' + id, function () {
      return client.from(T_DELETED).upsert({ id: id, deleted_at: new Date().toISOString() });
    }), op);
  }

  function draftRow(title) {
    var row = {};
    DRAFT_FIELDS.forEach(function (field) { row[field] = title[field]; });
    row.airing_status = title.airingStatus === undefined ? null : title.airingStatus;
    return row;
  }

  function pushDraft(client, title) {
    if (!title || !title.id) return Promise.resolve(false);
    var op = { t: 'draft', id: title.id, title: title };
    if (!usable(client)) { enqueue(op); return Promise.resolve(false); }
    markEcho(T_DRAFTS, title.id);
    return pushed(attempt('pushDraft ' + title.id, function () {
      return client.from(T_DRAFTS).upsert(draftRow(title));
    }), op);
  }

  function pushRemoveDraft(client, id) {
    var op = { t: 'removeDraft', id: id };
    if (!usable(client)) { enqueue(op); return Promise.resolve(false); }
    markEcho(T_DRAFTS, id);
    return pushed(attempt('pushRemoveDraft ' + id, function () {
      return client.from(T_DRAFTS).delete().eq('id', id);
    }), op);
  }

  // The whole checked list is sent, not a delta: `setCheckedParts` already
  // normalizes and rewrites the array wholesale, so the row is a snapshot of
  // the same value the mirror holds and last-write-wins reads sanely.
  function pushParts(client, id, indices) {
    var list = Array.isArray(indices) ? indices : [];
    var op = { t: 'parts', id: id, indices: list };
    if (!usable(client)) { enqueue(op); return Promise.resolve(false); }
    markEcho(T_PARTS, id);
    return pushed(attempt('pushParts ' + id, function () {
      return client.from(T_PARTS).upsert({
        id: id,
        indices: list,
        updated_at: new Date().toISOString()
      });
    }), op);
  }

  // Replays the queue, in the order the edits were made, and resolves to how
  // many landed. Anything that fails again goes back on the queue rather than
  // being consumed by the attempt — still offline is not the same as done.
  //
  // Sequential rather than parallel: two queued edits to the same title have to
  // reach the remote in the order the owner made them, or last-write-wins picks
  // the wrong winner.
  function flushOutbox(client) {
    if (!usable(client) || !outboxStorage) return Promise.resolve(0);
    var list = readOutbox();
    if (!list.length) return Promise.resolve(0);
    writeOutbox([]);
    replaying = true;
    var failed = [];
    var sent = 0;
    return list.reduce(function (chain, op) {
      return chain.then(function () {
        return replayOne(client, op).then(function (ok) {
          if (ok) sent += 1; else failed.push(op);
        });
      });
    }, Promise.resolve()).then(function () {
      replaying = false;
      writeOutbox(failed);
      if (sent) warn('replayed ' + sent + ' offline edit(s)');
      return sent;
    }).catch(function (e) {
      replaying = false;
      writeOutbox(failed.concat(list.slice(sent + failed.length)));
      warn('outbox replay failed', e && e.message);
      return sent;
    });
  }

  function replayOne(client, op) {
    switch (op.t) {
      case 'override': return pushOverride(client, op.id, op.patch);
      case 'delete': return pushDelete(client, op.id, false);
      case 'draft': return pushDraft(client, op.title);
      case 'removeDraft': return pushRemoveDraft(client, op.id);
      case 'parts': return pushParts(client, op.id, op.indices);
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
        var patch = overrides[id] || {};
        var row = { id: id, updated_at: now };
        Object.keys(patch).forEach(function (k) { row[k] = patch[k]; });
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

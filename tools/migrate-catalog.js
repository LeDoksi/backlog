// tools/migrate-catalog.js
//
// Разовый скрипт. Печатает SQL для вставки в drafts то, что владелец сейчас
// реально видит в браузере — не наивную сумму data.js + существующих drafts
// (часть drafts сегодня физически лежит в базе, но никогда не рендерится,
// см. lib/storage.js's pruneAdded/isSupersededBy до Task 9). Не переписывает
// эту логику — вызывает существующий lib/storage.js напрямую.
const TITLES = require('../data.js');
const storage = require('../lib/storage.js');

// Вставить сюда реальный экспорт текущих `backlog-overrides`/`backlog-added`/
// `backlog-parts` владельца (через Table Editor в Supabase-дашборде или
// временный curl к анонимному REST-эндпоинту — таблицы ещё открыты до Task 2,
// Step 3). Формат — тот же JSON, что storage.js кладёт в localStorage.
const currentOverrides = require('./catalog-migration-input/overrides.json');
const currentAdded = require('./catalog-migration-input/added.json');
const currentParts = require('./catalog-migration-input/parts.json');

function fakeStorage(overrides, added, parts) {
  var data = {
    'backlog-overrides': JSON.stringify(overrides),
    'backlog-added': JSON.stringify(added),
    'backlog-parts': JSON.stringify(parts)
  };
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem: function () {}
  };
}

var fake = fakeStorage(currentOverrides, currentAdded, currentParts);

// The exact logic app.js's baseTitles() ran before Task 9: data.js's own
// entries plus whatever locally-added drafts survive pruneAdded, then
// overrides/derived-status on top. Reproduced here (not imported) because
// Task 9 already deleted combineWithAdded/pruneAdded from lib/storage.js —
// they cannot be called after that task lands, so this is the last place
// their pre-Task-9 behavior needs to be spelled out at all, and only to
// compute this one migration's input.
function isSupersededBy(draftId, baseId) {
  if (draftId === baseId) return true;
  var prefix = draftId + '-';
  return baseId.indexOf(prefix) === 0 && /^\d{4}$/.test(baseId.slice(prefix.length));
}
var baseIds = TITLES.map(function (t) { return t.id; });
var survivingAdded = currentAdded.filter(function (t) {
  return !baseIds.some(function (b) { return isSupersededBy(t.id, b); });
});
var combined = TITLES.concat(survivingAdded);

var visible = storage.applyOverlay(combined, fake);

console.log('-- ' + visible.length + ' titles (expected: ' + TITLES.length + ' from data.js + ' + survivingAdded.length + ' surviving drafts, ' + (currentAdded.length - survivingAdded.length) + ' ghost draft(s) dropped)');
console.log('do $$');
console.log('declare');
console.log('  owner_workspace uuid;');
console.log('begin');
// Not `profiles` — that row only exists after a REAL Google login (the
// handle_new_user trigger from Task 1), which is Task 13, still ahead of this
// task in the plan. `allowed_emails.workspace_id` was set directly by Task
// 2's migration SQL and needs no login to exist, so it is available now.
console.log("  select workspace_id into owner_workspace from allowed_emails where email = 'shakov.georgy@gmail.com';");
console.log("  if owner_workspace is null then raise exception 'owner not found in allowed_emails, run Task 2 migration first'; end if;");
visible.forEach(function (t) {
  var checked = (storage.getCheckedParts(fake, t.id) || []);
  console.log('  insert into drafts (id, title, category, status, year, genres, rating, synopsis, cover, draft, original_title, season_info, platforms, parts, airing_status, workspace_id) values (' +
    sqlString(t.id) + ', ' + sqlString(t.title) + ', ' + sqlString(t.category) + ', ' + sqlString(t.status) + ', ' +
    (t.year == null ? 'null' : t.year) + ', ' + sqlJson(t.genres || []) + ', ' + (t.rating == null ? 'null' : t.rating) + ', ' +
    sqlString(t.synopsis || '') + ', ' + sqlString(t.cover || '') + ', ' + (!!t.draft) + ', ' +
    sqlString(t.originalTitle || null) + ', ' + sqlString(t.seasonInfo || null) + ', ' + sqlJson(t.platforms || null) + ', ' +
    sqlJson(t.parts || null) + ', ' + sqlString(t.airingStatus || null) + ', owner_workspace) on conflict (id) do nothing;');
});
console.log('end $$;');

function sqlString(v) { return v == null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'"; }
function sqlJson(v) { return v == null ? 'null' : "'" + JSON.stringify(v).replace(/'/g, "''") + "'::jsonb"; }

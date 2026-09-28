// migrate-v2.ts — moves each board's titles from drafts + overrides + parts
// into the single `titles` table, and checks the result.
//
// The effective titles are built by the code client C runs (sync.ts pull
// shapes + storage.ts overlay), so "what the app showed" and "what gets
// migrated" cannot drift apart. Works on a JSON export of the old tables
// (the same shape as the backup: { drafts, overrides, parts, … }), since the
// service key never leaves the Supabase dashboard:
//
//   npx vite-node tools/migrate-v2-cli.ts dry-run <export.json>
//   npx vite-node tools/migrate-v2-cli.ts sql <export.json> > titles.sql
//   npx vite-node tools/migrate-v2-cli.ts verify <export.json> <titles.json>
//
// `sql` prints one statement for the SQL editor / MCP: every column comes
// from the old tables with the same null-as-absent overlay rule, and the
// statuses a parts checklist decides come from derive.ts as a VALUES list.
// `verify` then compares every built row with what `titles` holds; any
// difference is printed and the exit code is 1.
import { readFileSync } from 'node:fs';
import * as Storage from '../src/lib/storage';
import * as Sync from '../src/lib/sync';
import { checkedIndices, toRow, type TitleRow } from '../src/lib/titleRow';
import type { StorageLike, Title } from '../src/lib/types';

type Row = Record<string, any>;
export interface ExportDump { drafts: Row[]; overrides: Row[]; parts: Row[]; [k: string]: unknown }

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
}

function fakeClient(tables: Record<string, Row[]>) {
  return { from: (t: string) => ({ select: () => Promise.resolve({ data: tables[t] ?? [], error: null }) }) };
}

// Exactly what client C held for one board: the pulled mirror, overlaid.
async function effective(drafts: Row[], overrides: Row[], parts: Row[]) {
  const storage = memoryStorage();
  const pulled = await Sync.pullState(fakeClient({ drafts, overrides, parts }));
  Sync.applyState(storage, pulled.state);
  const added = Storage.getAdded(storage);
  const overlay = Storage.getOverrides(storage);
  return added.map((raw: Title) => {
    const merged = overlay[raw.id] ? { ...raw, ...overlay[raw.id] } : raw;
    return {
      pre: merged.status,
      title: Storage.withDerivedStatus(storage, merged as Title),
      checked: Storage.getCheckedParts(storage, raw.id)
    };
  });
}

export async function buildRows(drafts: Row[], overrides: Row[], parts: Row[]): Promise<TitleRow[]> {
  const draftById = new Map(drafts.map((d) => [d.id, d]));
  const tickedAt = new Map(parts.map((p) => [p.id, p.updated_at as string]));
  const list = await effective(drafts, overrides, parts);
  return list.map(({ pre, title, checked }) => {
    const draft = draftById.get(title.id)!;
    const manual = Storage.hasPartsChecklist(title) && pre !== title.status ? pre : null;
    const ticks = Object.fromEntries(checked.map((i) => [String(i), tickedAt.get(title.id)!]));
    const row = toRow(draft.workspace_id, { ...title, manualStatus: manual, rating: draft.rating ?? null, hidden: false }, ticks);
    return { ...row, created_at: draft.created_at };
  });
}

const COMPARED = ['title', 'category', 'status', 'manual_status', 'airing_status', 'original_title', 'year', 'genres',
  'synopsis', 'cover', 'season_info', 'platforms', 'parts', 'source', 'source_id', 'rating', 'created_at'];

function same(a: unknown, b: unknown, key: string): boolean {
  if (key === 'created_at') return new Date(a as string).getTime() === new Date(b as string).getTime();
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export async function verifyRows(drafts: Row[], overrides: Row[], parts: Row[], actual: Row[]): Promise<string[]> {
  const expected = await buildRows(drafts, overrides, parts);
  const got = new Map(actual.map((r) => [r.id, r]));
  const diffs: string[] = [];
  expected.forEach((e) => {
    const a = got.get(e.id);
    got.delete(e.id);
    if (!a) { diffs.push(`${e.id}: missing from titles`); return; }
    COMPARED.forEach((k) => {
      const ev = (e as Row)[k];
      const av = a[k];
      if (!same(ev, av, k)) diffs.push(`${e.id}: ${k} expected ${JSON.stringify(ev)} got ${JSON.stringify(av)}`);
    });
    const ec = checkedIndices(e.checked_parts);
    const ac = checkedIndices(a.checked_parts);
    if (JSON.stringify(ec) !== JSON.stringify(ac)) diffs.push(`${e.id}: checked ${JSON.stringify(ec)} got ${JSON.stringify(ac)}`);
  });
  got.forEach((_, id) => diffs.push(`${id}: not in the old tables`));
  return diffs;
}

const q = (v: string | null | undefined) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

// Statuses only the checklist can decide; for everything else SQL applies
// the plain overlay (override status if set, else the draft's).
export function calcSql(rows: TitleRow[]): string {
  const derived = rows.filter((r) => Array.isArray(r.parts) && r.parts.length && (r.category === 'series' || r.category === 'anime'));
  return derived.map((r) => `(${q(r.workspace_id)},${q(r.id)},${q(r.status)},${q(r.manual_status)},${q(r.airing_status)})`).join(',\n');
}

export function insertSql(rows: TitleRow[]): string {
  const values = calcSql(rows);
  const ov = (col: string) => `coalesce(o.${col}, d.${col})`;
  return `-- Generated by app/tools/migrate-v2.ts sql. Re-runnable: rows are upserted.
with calc (workspace_id, id, status, manual_status, airing_status) as (values
${values || "(null::uuid, null::text, null::text, null::text, null::text)"}
), ticks as (
  select p.workspace_id, p.id,
         coalesce(jsonb_object_agg(e.v::text, p.updated_at) filter (where e.v is not null), '{}'::jsonb) as checked
  from public.parts p
  left join lateral (
    select distinct (x #>> '{}')::int as v from jsonb_array_elements(p.indices) x
    where jsonb_typeof(x) = 'number' and (x #>> '{}')::numeric >= 0 and (x #>> '{}')::numeric = floor((x #>> '{}')::numeric)
  ) e on true
  group by p.workspace_id, p.id
)
insert into public.titles (workspace_id, id, title, original_title, category, status, manual_status, airing_status, year, genres,
  synopsis, cover, season_info, platforms, parts, checked_parts, source, source_id, hidden, rating, created_at)
select d.workspace_id, d.id, ${ov('title')}, ${ov('original_title')}, ${ov('category')},
  coalesce(c.status, o.status, d.status), c.manual_status, case when c.id is null then d.airing_status else c.airing_status end,
  ${ov('year')}, ${ov('genres')}, ${ov('synopsis')}, ${ov('cover')}, ${ov('season_info')}, ${ov('platforms')}, ${ov('parts')},
  coalesce(t.checked, '{}'::jsonb), d.source, d.source_id, false, d.rating, d.created_at
from public.drafts d
left join public.overrides o on o.workspace_id = d.workspace_id and o.id = d.id
left join ticks t on t.workspace_id = d.workspace_id and t.id = d.id
left join calc c on c.workspace_id = d.workspace_id::text and c.id = d.id
on conflict (workspace_id, id) do update set
  title = excluded.title, original_title = excluded.original_title, category = excluded.category, status = excluded.status,
  manual_status = excluded.manual_status, airing_status = excluded.airing_status, year = excluded.year, genres = excluded.genres,
  synopsis = excluded.synopsis, cover = excluded.cover, season_info = excluded.season_info, platforms = excluded.platforms,
  parts = excluded.parts, checked_parts = excluded.checked_parts, source = excluded.source, source_id = excluded.source_id,
  rating = excluded.rating, created_at = excluded.created_at;
`;
}

function byWorkspace(rows: Row[]): Map<string, Row[]> {
  const m = new Map<string, Row[]>();
  rows.forEach((r) => { m.set(r.workspace_id, [...(m.get(r.workspace_id) ?? []), r]); });
  return m;
}

export async function allRows(dump: ExportDump): Promise<TitleRow[]> {
  const d = byWorkspace(dump.drafts ?? []);
  const o = byWorkspace(dump.overrides ?? []);
  const p = byWorkspace(dump.parts ?? []);
  const out: TitleRow[] = [];
  for (const ws of d.keys()) out.push(...await buildRows(d.get(ws)!, o.get(ws) ?? [], p.get(ws) ?? []));
  return out;
}

export async function main(argv: string[]): Promise<number> {
  const [mode, dumpPath, titlesPath] = argv;
  if (!mode || !dumpPath) { console.error('usage: migrate-v2.ts dry-run|sql|verify <export.json> [titles.json]'); return 2; }
  const dump = JSON.parse(readFileSync(dumpPath, 'utf8')) as ExportDump;
  const rows = await allRows(dump);
  if (mode === 'sql') { process.stdout.write(insertSql(rows)); return 0; }
  if (mode === 'dry-run') {
    const bad = rows.filter((r) => !['game', 'series', 'movie', 'anime'].includes(r.category));
    byWorkspace(rows as Row[]).forEach((list, ws) => {
      console.log(`${ws}: ${list.length} titles, ${list.filter((r) => Array.isArray(r.parts) && r.parts.length).length} with parts, ` +
        `${list.filter((r) => r.manual_status).length} with manual_status`);
      list.slice(0, 5).forEach((r) => console.log(`  ${r.id} | ${r.category} | ${r.status} | manual ${r.manual_status ?? '-'} | ticks ${checkedIndices(r.checked_parts).join(',') || '-'}`));
    });
    const live = new Set(rows.map((r) => `${r.workspace_id}/${r.id}`));
    const orphans = (dump.overrides ?? []).filter((o) => !live.has(`${o.workspace_id}/${o.id}`)).length +
      (dump.parts ?? []).filter((p) => !live.has(`${p.workspace_id}/${p.id}`)).length;
    console.log(`total ${rows.length}; bad categories ${bad.length}; override/parts rows of deleted titles (not migrated) ${orphans}`);
    return bad.length ? 1 : 0;
  }
  if (mode === 'verify') {
    if (!titlesPath) { console.error('verify needs titles.json'); return 2; }
    const actual = JSON.parse(readFileSync(titlesPath, 'utf8')) as Row[];
    const d = byWorkspace(dump.drafts ?? []);
    const a = byWorkspace(actual);
    let total = 0;
    for (const ws of new Set([...d.keys(), ...a.keys()])) {
      const diffs = await verifyRows(d.get(ws) ?? [], byWorkspace(dump.overrides ?? []).get(ws) ?? [],
        byWorkspace(dump.parts ?? []).get(ws) ?? [], a.get(ws) ?? []);
      console.log(`${ws}: ${(d.get(ws) ?? []).length} old, ${(a.get(ws) ?? []).length} in titles, ${diffs.length} differences`);
      diffs.forEach((x) => console.log('  ' + x));
      total += diffs.length;
    }
    console.log(total ? `FAIL: ${total} differences` : 'OK: 0 differences');
    return total ? 1 : 0;
  }
  console.error('unknown mode ' + mode);
  return 2;
}

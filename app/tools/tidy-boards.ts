// tidy-boards.ts — brings every board to what the app would make of it
// today, at once, without waiting for each owner to open theirs (BL-113,
// Georgy's ask of 2026-10-16: "у меня и у друзей чтобы всё было приведено
// в нормальный вид"). For each board, in this order:
//
//   1. the one-time normalization (data/normalizeJob): name, cover,
//      description, genres and year from the title's own source;
//   2. the daily refresh (data/refreshJob): seasons filled in and appended,
//      franchise duplicates merged, game covers and descriptions;
//   3. every season list still made by hand (from the old site, or edited)
//      built again from TMDb or Shikimori, ticks carried over by count
//      (refreshJob.rebuildSeasons); the list is no longer marked manual;
//   4. game platforms and genres in one spelling (lib/gameNames).
//
//   npx vite-node tools/tidy-boards-cli.ts run <titles.json> [out-dir]
//     → <out-dir>/tidy.sql and <out-dir>/tidy-review.md
//
// <titles.json> is `select json_agg(t) from titles t`. The jobs run as they
// do in the browser, with a client that only writes down what they would
// send; tidy.sql sends the same apply_title_refresh() calls, quietly (no
// feed), as a member of each board, one title per call where it can so a
// title edited since the export is the only one skipped.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CORS_PROXY, RAWG_KEY, TMDB_KEY } from '../src/config';
import { runNormalize } from '../src/data/normalizeJob';
import { rebuildSeasons, runDailyRefresh } from '../src/data/refreshJob';
import { canonicalGenres, canonicalPlatforms } from '../src/lib/gameNames';
import { checkedIndices, type TitleRow } from '../src/lib/titleRow';
import type { FetchLike, StorageLike } from '../src/lib/types';

export interface Call { board: string; updates: Record<string, unknown>[]; deletes: Record<string, unknown>[] }
export interface Direct { board: string; id: string; set: Record<string, unknown>; where: Record<string, unknown> }
export interface BoardResult { calls: Call[]; direct: Direct[]; review: string[] }

export interface TidyEnv {
  fetchFn: FetchLike;
  now: Date;
  tmdbKey: string;
  rawgKey: string;
  proxy: string | null;
  loadImage: (url: string) => Promise<boolean>;
  pause?: (ms: number) => Promise<void>;
  log?: (s: string) => void;
}

function memory(): StorageLike {
  const data: Record<string, string> = {};
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
}

/** A client that writes nothing: it notes the call and says every row was taken. */
function recorder(board: string, calls: Call[]) {
  return {
    rpc: async (name: string, args: { p_updates?: Record<string, unknown>[]; p_deletes?: Record<string, unknown>[] }) => {
      if (name !== 'apply_title_refresh') throw new Error(`unexpected rpc ${name}`);
      const updates = args.p_updates ?? [];
      const deletes = args.p_deletes ?? [];
      calls.push({ board, updates, deletes });
      return { data: updates.length + deletes.length, error: null };
    }
  };
}

const legacyList = (r: TitleRow) => Array.isArray(r.parts) && r.parts.length > 0
  && (!!r.parts_manual || r.parts.some((p) => !(p as { ref?: string })?.ref));

const partsLine = (r: TitleRow) => {
  const parts = (r.parts ?? []) as { name?: string; extra?: boolean; released?: boolean }[];
  const ticked = new Set(checkedIndices(r.checked_parts ?? {}));
  return parts.map((p, i) => `${ticked.has(i) ? '✓' : '·'}${p.name ?? '?'}${p.released === false ? ' (не вышло)' : ''}`).join(', ') || '—';
};

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export async function tidyBoard(board: string, input: TitleRow[], env: TidyEnv): Promise<BoardResult> {
  const calls: Call[] = [];
  const direct: Direct[] = [];
  const client = recorder(board, calls);
  const rows = new Map(input.map((r) => [r.id, { ...r }]));
  const before = new Map(input.map((r) => [r.id, r]));
  const rebuilt = new Set<string>();
  const land = (changes: { id: string; cols: Partial<TitleRow> | null }[]) => changes.forEach((c) => {
    if (!c.cols) rows.delete(c.id);
    else rows.set(c.id, { ...rows.get(c.id)!, ...c.cols });
  });
  const log = env.log ?? (() => {});
  const common = { fetchFn: env.fetchFn, tmdbKey: env.tmdbKey, proxy: env.proxy, rawgKey: env.rawgKey, loadImage: env.loadImage, pause: env.pause };

  log(`${board}: normalization of ${rows.size} titles`);
  await runNormalize({ ...common, proxy: env.proxy ?? '', board, rows: [...rows.values()], pendingIds: new Set(), client, storage: memory(), onChanges: land });
  log(`${board}: daily refresh`);
  const daily = await runDailyRefresh({ ...common, board, rows: [...rows.values()], pendingIds: new Set(), client, storage: memory(), now: env.now });
  land(daily.changes);
  for (const r of [...rows.values()].filter(legacyList)) {
    if (r.category !== 'series' && r.category !== 'anime') continue;
    if (env.pause) await env.pause(250);
    const res = await rebuildSeasons({ board, row: r, fetchFn: env.fetchFn, client, now: env.now, tmdbKey: env.tmdbKey, proxy: env.proxy });
    if (typeof res === 'string') continue;
    land([{ id: r.id, cols: res.cols }]);
    rebuilt.add(r.id);
    if (r.parts_manual) direct.push({ board, id: r.id, set: { parts_manual: false }, where: { parts: res.cols.parts, parts_manual: true } });
  }
  for (const r of rows.values()) {
    if (r.category !== 'game') continue;
    const platforms = canonicalPlatforms(r.platforms as string[] | null);
    const genres = Array.isArray(r.genres) ? canonicalGenres(r.genres as string[]) : r.genres;
    const set: Record<string, unknown> = {};
    if (!same(platforms, r.platforms)) set.platforms = platforms;
    if (!same(genres, r.genres)) set.genres = genres;
    if (Object.keys(set).length) direct.push({ board, id: r.id, set, where: { platforms: r.platforms ?? null, genres: r.genres ?? null } });
  }

  const review: string[] = [];
  for (const [id, was] of before) {
    const now = rows.get(id);
    if (!now) { review.push(`- «${was.title}»: склеен с другим тайтлом франшизы`); continue; }
    const notes: string[] = [];
    if (now.title !== was.title) notes.push(`название «${was.title}» → «${now.title}»`);
    if (now.cover !== was.cover) notes.push('новая обложка');
    if (now.synopsis !== was.synopsis) notes.push('новое описание');
    if (!same(now.genres, was.genres)) notes.push(`жанры ${JSON.stringify(now.genres)}`);
    if (now.year !== was.year) notes.push(`год ${was.year ?? '—'} → ${now.year ?? '—'}`);
    if (now.status !== was.status) notes.push(`статус ${was.status} → ${now.status}`);
    if (!same(now.parts, was.parts) || !same(now.checked_parts, was.checked_parts)) {
      notes.push(`${rebuilt.has(id) ? 'список пересобран' : 'части'}: [${partsLine(was)}] → [${partsLine(now)}]`);
    }
    const d = direct.find((x) => x.id === id && ('platforms' in x.set || 'genres' in x.set));
    if (d?.set.platforms) notes.push(`платформы ${JSON.stringify(d.set.platforms)}`);
    if (notes.length) review.push(`- «${was.title}» (${id}): ${notes.join('; ')}`);
  }
  return { calls, direct, review };
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const json = (v: unknown) => `$tidy$${JSON.stringify(v)}$tidy$::jsonb`;

/** One apply_title_refresh() per title where nothing is deleted: a stale title skips only itself. */
function split(c: Call): Call[] {
  return c.deletes.length ? [c] : c.updates.map((u) => ({ board: c.board, updates: [u], deletes: [] }));
}

export function tidySql(results: BoardResult[]): string {
  const out = [
    '-- tidy-boards (BL-113): every board brought to what the app makes of it today.',
    '-- Quiet: nothing reaches the feed. Each call runs as a member of its board.',
    'begin;',
    'create temp table tidy_log (board uuid, ids text, n int) on commit drop;'
  ];
  for (const r of results) {
    const board = r.calls[0]?.board ?? r.direct[0]?.board;
    if (!board) continue;
    out.push('', `-- board ${board}`);
    out.push(`select set_config('request.jwt.claims', json_build_object('sub', (select user_id from public.workspace_members where workspace_id = ${lit(board)} order by user_id limit 1), 'role', 'authenticated')::text, true);`);
    r.calls.flatMap(split).forEach((c) => {
      const ids = [...c.updates, ...c.deletes].map((u) => String(u.id)).join(',');
      out.push(`insert into tidy_log select ${lit(board)}, ${lit(ids)}, public.apply_title_refresh(${lit(board)}, ${json(c.updates)}, ${json(c.deletes)});`);
    });
    if (r.direct.length) {
      out.push(`select set_config('bl.quiet', '1', true);`);
      r.direct.forEach((d) => {
        const set = Object.entries(d.set).map(([k, v]) => k === 'parts_manual' ? `${k} = ${v ? 'true' : 'false'}` : `${k} = ${json(v)}`).join(', ');
        const where = Object.entries(d.where).map(([k, v]) => k === 'parts_manual' ? `${k} = ${v ? 'true' : 'false'}` : `${k} is not distinct from ${v === null ? 'null' : json(v)}`).join(' and ');
        out.push(`update public.titles set ${set} where workspace_id = ${lit(board)} and id = ${lit(d.id)} and ${where};`);
      });
      out.push(`select set_config('bl.quiet', '', true);`);
    }
  }
  out.push('', `select set_config('request.jwt.claims', '', true);`);
  out.push('select board, count(*) filter (where n > 0) as changed, count(*) filter (where n = 0) as already, count(*) filter (where n < 0) as skipped_stale from tidy_log group by board order by board;');
  out.push('commit;', '');
  return out.join('\n');
}

/** A picture loads when its address answers with an image. */
async function nodeLoadImage(url: string): Promise<boolean> {
  try {
    const r = await fetch(url);
    return r.ok && (r.headers.get('content-type') ?? '').startsWith('image/');
  } catch {
    return false;
  }
}

export async function main(argv: string[], fetchFn: FetchLike = fetch.bind(globalThis) as FetchLike): Promise<number> {
  const [mode, file, outDir = '.'] = argv;
  if (mode !== 'run' || !file) {
    console.error('usage: run <titles.json> [out-dir]');
    return 2;
  }
  const all = JSON.parse(readFileSync(file, 'utf8')) as TitleRow[];
  const boards = new Map<string, TitleRow[]>();
  all.forEach((r) => { const b = String(r.workspace_id); boards.set(b, [...(boards.get(b) ?? []), r]); });
  const env: TidyEnv = { fetchFn, now: new Date(), tmdbKey: TMDB_KEY, rawgKey: RAWG_KEY, proxy: CORS_PROXY, loadImage: nodeLoadImage, log: (s) => console.log(s) };
  const results: BoardResult[] = [];
  const review: string[] = ['# tidy-boards: что изменится', ''];
  for (const [board, rows] of boards) {
    const r = await tidyBoard(board, rows, env);
    results.push(r);
    review.push(`## ${board} (${rows.length} тайтлов, изменится ${r.review.length})`, '', ...r.review, '');
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'tidy.sql'), tidySql(results));
  writeFileSync(join(outDir, 'tidy-review.md'), review.join('\n'));
  console.log(`boards: ${results.length}, calls: ${results.reduce((n, r) => n + r.calls.length, 0)}, direct: ${results.reduce((n, r) => n + r.direct.length, 0)}`);
  return 0;
}

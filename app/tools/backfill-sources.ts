// backfill-sources.ts — gives old titles an external id (`source`,
// `source_id`), so duplicates and later matching between friends work for
// them too. Titles added since C already carry one.
//
// For each title without a source, searches the category's provider (the
// same search Quick add uses, src/data/enrichSearch.ts). An id is written
// automatically only when exactly one candidate has the same normalized name
// (or original name) and the same year; everything else goes to a review
// file for the owner:
//
//   npx vite-node tools/backfill-sources-cli.ts run <titles.json> [out-dir]
//     → <out-dir>/sources-auto.sql and <out-dir>/sources-review.md
//   npx vite-node tools/backfill-sources-cli.ts apply-review <sources-review.md>
//     → SQL for the rows where the owner filled in «выбор: provider:id»
//
// <titles.json> is `select json_agg(t) from titles t` (see README). The SQL
// only touches rows whose source is still empty, so re-running is safe.
// Requests go out at most 3 per second.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { search, type Hit } from '../src/data/enrichSearch';
import type { Category, FetchLike } from '../src/lib/types';

export interface Pending { id: string; title: string; originalTitle: string | null; year: number | null; category: Category }
export interface Pick { id: string; source: string; sourceId: string }

export function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function pickUnique(t: Pending, hits: Hit[]): Hit | null {
  if (t.year === null) return null;
  const names = [t.title, t.originalTitle].filter((x): x is string => !!x).map(normalizeTitle);
  const matches = hits.filter((h) => h.year === t.year && names.includes(normalizeTitle(h.title)));
  return matches.length === 1 ? matches[0]! : null;
}

const cell = (s: string) => s.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

export function reviewLine(t: Pending, hits: Hit[]): string {
  const cands = hits.map((h) => cell(`${h.provider}:${h.id} ${h.title} (${h.year ?? '?'})`));
  return `| ${[t.id, cell(t.title), t.year ?? '?', ...(cands.length ? cands : ['нет кандидатов']), 'выбор: ____'].join(' | ')} |`;
}

export function parseReview(md: string): Pick[] {
  const out: Pick[] = [];
  for (const line of md.split('\n')) {
    const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
    const choice = cells[cells.length - 1]?.match(/^выбор:\s*([a-z-]+):(\S+)$/);
    if (cells.length < 2 || !choice) continue;
    out.push({ id: cells[0]!, source: choice[1]!, sourceId: choice[2]! });
  }
  return out;
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function updateSql(picks: Pick[]): string {
  if (!picks.length) return '';
  const values = picks.map((p) => `(${lit(p.id)}, ${lit(p.source)}, ${lit(p.sourceId)})`).join(', ');
  return `update public.titles t set source = v.source, source_id = v.source_id from (values ${values}) as v(id, source, source_id)\n` +
    'where t.id = v.id and t.source is null;';
}

export function applyReviewSql(md: string): string {
  return updateSql(parseReview(md));
}

// One entry per id: the same title on two boards is the same work.
export function pendingTitles(rows: Record<string, unknown>[]): Pending[] {
  const seen = new Map<string, Pending>();
  for (const r of rows) {
    if (r.source || seen.has(String(r.id))) continue;
    seen.set(String(r.id), {
      id: String(r.id), title: String(r.title), originalTitle: (r.original_title as string | null) ?? null,
      year: typeof r.year === 'number' ? r.year : null, category: r.category as Category
    });
  }
  return [...seen.values()];
}

// Every call to a provider waits its turn: at most `perSecond` a second.
export function throttled(fetchFn: FetchLike, perSecond: number, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): FetchLike {
  let next = 0;
  return (async (...args: Parameters<FetchLike>) => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + Math.ceil(1000 / perSecond);
    if (at > now) await sleep(at - now);
    return fetchFn(...args);
  }) as FetchLike;
}

async function candidates(t: Pending, fetchFn: FetchLike): Promise<Hit[]> {
  const first = await search(t.category, t.title, fetchFn);
  const hits = first.ok ? first.hits : [];
  if (pickUnique(t, hits) || !t.originalTitle || normalizeTitle(t.originalTitle) === normalizeTitle(t.title)) return hits;
  const second = await search(t.category, t.originalTitle, fetchFn);
  const more = second.ok ? second.hits.filter((h) => !hits.some((x) => x.provider === h.provider && String(x.id) === String(h.id))) : [];
  return [...hits, ...more];
}

export async function run(rows: Record<string, unknown>[], fetchFn: FetchLike, log = console.error): Promise<{ picks: Pick[]; review: string[] }> {
  const picks: Pick[] = [];
  const review: string[] = [];
  const list = pendingTitles(rows);
  for (const [i, t] of list.entries()) {
    const hits = await candidates(t, fetchFn);
    const one = pickUnique(t, hits);
    if (one) picks.push({ id: t.id, source: one.provider, sourceId: String(one.id) });
    else review.push(reviewLine(t, hits));
    if ((i + 1) % 20 === 0) log(`${i + 1}/${list.length}`);
  }
  return { picks, review };
}

const REVIEW_HEAD = [
  '# Внешние ID: что проверить',
  '',
  'Для этих тайтлов не нашлось однозначного совпадения (название и год). Впиши в последнюю колонку',
  '`выбор: провайдер:id` из кандидатов или `выбор: нет`, остальное оставь как есть.',
  '',
  '| id | название | год | кандидаты … | выбор |',
  '|---|---|---|---|---|'
];

export async function main(argv: string[], fetchFn: FetchLike = fetch.bind(globalThis) as FetchLike): Promise<number> {
  const [mode, file, outDir = '.'] = argv;
  if (mode === 'apply-review' && file) {
    const sql = applyReviewSql(readFileSync(file, 'utf8'));
    console.log(sql || '-- nothing chosen');
    return 0;
  }
  if (mode === 'run' && file) {
    const rows = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>[];
    const { picks, review } = await run(rows, throttled(fetchFn, 3));
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'sources-auto.sql'), updateSql(picks) + '\n');
    writeFileSync(join(outDir, 'sources-review.md'), [...REVIEW_HEAD, ...review, ''].join('\n'));
    console.log(`auto: ${picks.length}, review: ${review.length}`);
    return 0;
  }
  console.error('usage: run <titles.json> [out-dir] | apply-review <sources-review.md>');
  return 2;
}

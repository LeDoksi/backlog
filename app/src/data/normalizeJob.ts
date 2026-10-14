// normalizeJob.ts — once per board, titles that came over from the old
// site are brought to what search gives today (Georgy's decision of
// 2026-10-14, wave 3 plan task 5a): name, original name, cover,
// description, genres and year from the title's own source, by the rules
// of lib/refresh cardFixes. A cover someone chose stays.
//
// A board holds a few hundred titles and every one is asked about, one at
// a time, so the work is written in small batches through the same quiet
// apply_title_refresh() call as the daily refresh: closing the tab halfway
// loses at most one batch, and the next open goes on from there.
import { cardFor, categoryOf, type SourceDeps } from './cardSources';
import { cardBase } from './refreshJob';
import { cardFixes } from '../lib/refresh';
import type { TitleRow } from '../lib/titleRow';
import type { StorageLike, SupabaseLike } from '../lib/types';

export interface NormalizeDeps extends SourceDeps {
  board: string;
  rows: TitleRow[];
  pendingIds: Set<string>;
  client: SupabaseLike | null;
  storage: StorageLike;
  pause?: (ms: number) => Promise<void>;
  /** Lands what the server took, batch by batch. */
  onChanges: (changes: { id: string; cols: Partial<TitleRow> }[]) => void;
}

export interface NormalizeResult { ran: boolean; done: boolean; updated: number; skipped: number }

const BATCH = 10;
const PAUSE_MS = 250;
const key = (board: string) => `normalize:${board}`;

interface Progress { done: Set<string>; fails: Record<string, number> }

function seen(storage: StorageLike, board: string): Progress | 'done' {
  try {
    const v = storage.getItem(key(board));
    if (v === 'done') return 'done';
    const o = v ? JSON.parse(v) : {};
    return { done: new Set(Array.isArray(o.done) ? o.done.map(String) : []), fails: o.fails && typeof o.fails === 'object' ? o.fails : {} };
  } catch {
    return { done: new Set(), fails: {} };
  }
}

function save(storage: StorageLike, board: string, value: Progress | 'done') {
  try { storage.setItem(key(board), value === 'done' ? 'done' : JSON.stringify({ done: [...value.done], fails: value.fails })); } catch { /* it goes on next open */ }
}

/** A title whose source has not answered on this many opens is left as it is. */
const GIVE_UP = 3;

export function normalizedAlready(storage: StorageLike, board: string): boolean {
  return seen(storage, board) === 'done';
}

export async function runNormalize(deps: NormalizeDeps): Promise<NormalizeResult> {
  const { board, storage } = deps;
  const none: NormalizeResult = { ran: false, done: false, updated: 0, skipped: 0 };
  const progress = seen(storage, board);
  if (!deps.client || progress === 'done') return none;
  const { done, fails } = progress;
  const pause = deps.pause ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  const todo = deps.rows.filter((r) => r.source && r.source_id && categoryOf(r.source) && !done.has(r.id));
  let updated = 0;
  let skipped = 0;
  let asked = 0;
  const failed = new Map<string, number>();
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const updates: Record<string, unknown>[] = [];
    const changes: { id: string; cols: Partial<TitleRow> }[] = [];
    const finished: string[] = [];
    for (const r of batch) {
      // An edit still waiting to be sent: this title is left for the next open.
      if (deps.pendingIds.has(r.id) || (failed.get(r.source!) ?? 0) >= 3) continue;
      if (asked++) await pause(PAUSE_MS);
      const card = await cardFor(r.source!, r.source_id!, deps);
      // A source that does not answer is asked again on a later open; one
      // that fails three times now is down, and its titles wait.
      if (!card) {
        skipped++;
        failed.set(r.source!, (failed.get(r.source!) ?? 0) + 1);
        fails[r.id] = (fails[r.id] ?? 0) + 1;
        if (fails[r.id]! >= GIVE_UP) finished.push(r.id);
        continue;
      }
      const cols = cardFixes(r, card, 'normalize');
      finished.push(r.id);
      if (!cols) continue;
      updates.push({ id: r.id, base: cardBase(r, cols), ...cols });
      changes.push({ id: r.id, cols });
    }
    if (updates.length) {
      let res: { data: unknown; error: unknown };
      try {
        res = await deps.client.rpc('apply_title_refresh', { p_workspace: board, p_updates: updates, p_deletes: [] });
      } catch (e) {
        res = { data: null, error: e };
      }
      // Stale or failed: stop here, the next open starts again from this batch.
      if (res.error || typeof res.data !== 'number' || res.data < 0) return { ran: true, done: false, updated, skipped };
      updated += updates.length;
      deps.onChanges(changes);
    }
    finished.forEach((id) => done.add(id));
    save(storage, board, progress);
  }
  const all = deps.rows.every((r) => !r.source || !r.source_id || !categoryOf(r.source) || done.has(r.id));
  if (all) save(storage, board, 'done');
  return { ran: true, done: all, updated, skipped };
}

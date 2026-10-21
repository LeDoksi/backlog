// faceJob.ts — every card added from search looks as its source does today
// (spec 2026-10-21 part 2, BL-117): once a week its poster, name, original
// name, description, genres, year and (games) platforms are taken from its
// source again by the rules of lib/refresh cardFixes('weekly'), and a film
// or game gets its release dates and «Ещё не вышло» from there. Films and
// games not out yet, and films in cinemas waiting for their digital
// release, are asked every day.
//
// One card at a time with a pause (Shikimori asks for at most 5 requests a
// second), each in its own quiet apply_title_refresh() write: a card someone
// changed meanwhile is simply skipped until its next turn, and closing the
// tab halfway loses nothing. Hand-made cards are never asked about.
import { cardForRetry, categoryOf, type SourceDeps } from './cardSources';
import { cardBase } from './refreshJob';
import { cardFixes } from '../lib/refresh';
import { cinemaLabel, IN_CINEMA, localDay } from '../lib/release';
import type { TitleRow } from '../lib/titleRow';
import type { StorageLike, SupabaseLike } from '../lib/types';

export interface FaceDeps extends SourceDeps {
  board: string;
  /** The board's rows as mirrored when the job starts. */
  rows: TitleRow[];
  /** Titles with edits still waiting to be sent: left for another time. */
  pendingIds: Set<string>;
  client: SupabaseLike | null;
  storage: StorageLike;
  now: Date;
  pause?: (ms: number) => Promise<void>;
  /** Lands what the server took, card by card. */
  onChanges: (changes: { id: string; cols: Partial<TitleRow> }[]) => void;
  /** Called once the cards asked about every day are through (the «Вышло» note follows). */
  onDailyDone?: () => void;
}

export interface FaceResult { asked: number; updated: number; skipped: number }

const PAUSE_MS = 250;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Failures in a row after which a source is left alone until the next run. */
const SOURCE_DOWN = 4;
const key = (board: string) => `face:${board}`;

/** When each title's source last answered, ms. */
function load(storage: StorageLike, board: string): Record<string, number> {
  try {
    const o = JSON.parse(storage.getItem(key(board)) ?? '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

function save(storage: StorageLike, board: string, asked: Record<string, number>) {
  try { storage.setItem(key(board), JSON.stringify(asked)); } catch { /* asked again next time */ }
}

/** A film or game whose release may change any day. */
export function dailyDue(r: TitleRow, today: string): boolean {
  if (r.category !== 'movie' && r.category !== 'game') return false;
  if (r.status === 'unreleased') return true;
  return cinemaLabel({ category: r.category, releaseDate: r.release_date, digitalDate: r.digital_date }, today) === IN_CINEMA;
}

export async function runFaceJob(deps: FaceDeps): Promise<FaceResult> {
  const { board, storage, now } = deps;
  const result: FaceResult = { asked: 0, updated: 0, skipped: 0 };
  if (!deps.client) { deps.onDailyDone?.(); return result; }
  const pause = deps.pause ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const today = localDay(now);
  const asked = load(storage, board);
  // Titles gone from the board are forgotten.
  const ids = new Set(deps.rows.map((r) => r.id));
  Object.keys(asked).forEach((id) => { if (!ids.has(id)) delete asked[id]; });

  const cards = deps.rows.filter((r) => r.source && r.source_id && categoryOf(r.source) && !deps.pendingIds.has(r.id));
  const daily = cards.filter((r) => dailyDue(r, today) && localDay(new Date(asked[r.id] ?? 0)) !== today);
  const weekly = cards.filter((r) => !daily.includes(r) && now.getTime() - (asked[r.id] ?? 0) >= WEEK_MS);

  const failedInRow = new Map<string, number>();
  const ask = async (r: TitleRow) => {
    if ((failedInRow.get(r.source!) ?? 0) >= SOURCE_DOWN) { result.skipped++; return; }
    if (result.asked++) await pause(PAUSE_MS);
    const card = await cardForRetry(r.source!, r.source_id!, { ...deps, today }, pause);
    // A source that did not answer is asked again on the next run.
    if (!card) { result.skipped++; failedInRow.set(r.source!, (failedInRow.get(r.source!) ?? 0) + 1); return; }
    failedInRow.set(r.source!, 0);
    asked[r.id] = now.getTime();
    const cols = cardFixes(r, card, 'weekly', today);
    if (cols) {
      let res: { data: unknown; error: unknown };
      try {
        res = await deps.client.rpc('apply_title_refresh', { p_workspace: board, p_updates: [{ id: r.id, base: cardBase(r, cols), ...cols }], p_deletes: [] });
      } catch (e) {
        res = { data: null, error: e };
      }
      // Stale (someone changed it meanwhile) or a failed write: asked again tomorrow.
      if (res.error || typeof res.data !== 'number' || res.data < 0) delete asked[r.id];
      else { result.updated++; deps.onChanges([{ id: r.id, cols }]); }
    }
    save(storage, board, asked);
  };

  for (const r of daily) await ask(r);
  deps.onDailyDone?.();
  for (const r of weekly) await ask(r);
  save(storage, board, asked);
  return result;
}

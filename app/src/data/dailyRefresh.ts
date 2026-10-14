// Starts the daily refresh (data/refreshJob.ts) after a board's first good
// pull of the day, and lands what the server took in the mirror. After it,
// once per board, the old site's titles are brought to what search gives
// (data/normalizeJob.ts).
import { CORS_PROXY, RAWG_KEY, TMDB_KEY } from '../config';
import type { FetchLike } from '../lib/types';
import type { TitleRow } from '../lib/titleRow';
import { browserLoadImage } from './cardSources';
import { getSupabase } from './supabase';
import { mirror, outbox, useTitles } from './titlesStore';
import { refreshedToday, runDailyRefresh } from './refreshJob';
import { normalizedAlready, runNormalize } from './normalizeJob';

const running = new Set<string>();
/** Boards the one-time pass was started for in this tab: a failure waits for the next open. */
const normalizing = new Set<string>();

function land(board: string, changes: { id: string; cols: Partial<TitleRow> | null }[]) {
  changes.forEach((c) => useTitles.getState().applyChange(board, c.cols
    ? { type: 'upsert', id: c.id, row: { ...c.cols, id: c.id } as TitleRow }
    : { type: 'delete', id: c.id, row: null }));
}

function normalizeOnce(board: string): void {
  if (normalizing.has(board) || normalizedAlready(mirror, board) || typeof fetch !== 'function') return;
  normalizing.add(board);
  const store = useTitles.getState();
  void runNormalize({
    board, rows: store.boardRows(), pendingIds: outbox.pendingIds(board), client: getSupabase(), storage: mirror,
    fetchFn: fetch.bind(globalThis) as FetchLike, proxy: CORS_PROXY, tmdbKey: TMDB_KEY, rawgKey: RAWG_KEY, loadImage: browserLoadImage,
    onChanges: (changes) => land(board, changes)
  }).catch((e) => console.warn('[refresh] normalization failed', e));
}

export function refreshBoardDaily(board: string): void {
  if (running.has(board) || typeof fetch !== 'function') return;
  if (refreshedToday(mirror, board, new Date())) { normalizeOnce(board); return; }
  running.add(board);
  const store = useTitles.getState();
  void runDailyRefresh({
    board, rows: store.boardRows(), pendingIds: outbox.pendingIds(board), fetchFn: fetch.bind(globalThis) as FetchLike,
    client: getSupabase(), storage: mirror, now: new Date(), tmdbKey: TMDB_KEY, proxy: CORS_PROXY, rawgKey: RAWG_KEY, loadImage: browserLoadImage
  }).then((res) => land(board, res.changes))
    .catch((e) => console.warn('[refresh] daily refresh failed', e))
    .finally(() => { running.delete(board); normalizeOnce(board); });
}

// Starts the daily refresh (data/refreshJob.ts) after a board's first good
// pull of the day, and lands what the server took in the mirror.
import { CORS_PROXY, TMDB_KEY } from '../config';
import type { FetchLike } from '../lib/types';
import type { TitleRow } from '../lib/titleRow';
import { getSupabase } from './supabase';
import { mirror, outbox, useTitles } from './titlesStore';
import { refreshedToday, runDailyRefresh } from './refreshJob';

const running = new Set<string>();

export function refreshBoardDaily(board: string): void {
  if (running.has(board) || typeof fetch !== 'function' || refreshedToday(mirror, board, new Date())) return;
  running.add(board);
  const store = useTitles.getState();
  void runDailyRefresh({
    board, rows: store.boardRows(), pendingIds: outbox.pendingIds(board), fetchFn: fetch.bind(globalThis) as FetchLike,
    client: getSupabase(), storage: mirror, now: new Date(), tmdbKey: TMDB_KEY, proxy: CORS_PROXY
  }).then((res) => {
    res.changes.forEach((c) => useTitles.getState().applyChange(board, c.cols
      ? { type: 'upsert', id: c.id, row: { ...c.cols, id: c.id } as TitleRow }
      : { type: 'delete', id: c.id, row: null }));
  }).catch((e) => console.warn('[refresh] daily refresh failed', e)).finally(() => running.delete(board));
}

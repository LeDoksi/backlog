// Starts the daily refresh (data/refreshJob.ts) after a board's first good
// pull of the day, and lands what the server took in the mirror. After it
// the cards from search are checked against their sources (data/faceJob.ts,
// BL-117: releases daily, faces weekly), and what came out since the last
// visit gets a note; once per board, the old site's titles are brought to
// what search gives (data/normalizeJob.ts).
import { CORS_PROXY, RAWG_KEY, TMDB_KEY } from '../config';
import type { FetchLike } from '../lib/types';
import type { TitleRow } from '../lib/titleRow';
import { browserLoadImage } from './cardSources';
import { getSupabase } from './supabase';
import { mirror, outbox, useTitles } from './titlesStore';
import { refreshedToday, runDailyRefresh } from './refreshJob';
import { normalizedAlready, runNormalize } from './normalizeJob';
import { runFaceJob } from './faceJob';
import { localDay, releaseEvents, releaseToast } from '../lib/release';
import { openTitle, useUi } from './ui';

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
  const store = useTitles.getState();
  // The rows at hand are the open board's: another board waits for its own pull.
  if (store.boardId !== board) return;
  normalizing.add(board);
  void runNormalize({
    board, rows: store.boardRows(), pendingIds: outbox.pendingIds(board), client: getSupabase(), storage: mirror,
    fetchFn: fetch.bind(globalThis) as FetchLike, proxy: CORS_PROXY, tmdbKey: TMDB_KEY, rawgKey: RAWG_KEY, loadImage: browserLoadImage,
    onChanges: (changes) => land(board, changes)
  }).catch((e) => console.warn('[refresh] normalization failed', e));
}

/** Board → the day this tab last started its card check. */
const faced = new Map<string, string>();

/** «Вышло: …» for what came out on the open board since this browser last looked (spec 2.3). */
export function announceReleases(board: string): void {
  const store = useTitles.getState();
  if (store.boardId !== board) return;
  const today = localDay(new Date());
  const key = `releases-seen:${board}`;
  let seen: string | null = null;
  try { seen = mirror.getItem(key); mirror.setItem(key, today); } catch { return; }
  // A first visit marks the day only: nothing old is announced.
  if (!seen || seen >= today) return;
  const note = releaseToast(releaseEvents(store.titles, seen, today));
  if (!note) return;
  const id = note.id;
  useUi.getState().showToast(note.text, id ? { label: 'Открыть', run: () => openTitle(id) } : undefined);
}

function faceOnce(board: string): void {
  const today = localDay(new Date());
  const store = useTitles.getState();
  if (faced.get(board) === today || store.boardId !== board || typeof fetch !== 'function') { normalizeOnce(board); return; }
  faced.set(board, today);
  void runFaceJob({
    board, rows: store.boardRows(), pendingIds: outbox.pendingIds(board), client: getSupabase(), storage: mirror, now: new Date(),
    fetchFn: fetch.bind(globalThis) as FetchLike, proxy: CORS_PROXY, tmdbKey: TMDB_KEY, rawgKey: RAWG_KEY, loadImage: browserLoadImage,
    onChanges: (changes) => land(board, changes), onDailyDone: () => announceReleases(board)
  }).catch((e) => console.warn('[refresh] card check failed', e))
    .finally(() => normalizeOnce(board));
}

export function refreshBoardDaily(board: string): void {
  if (running.has(board) || typeof fetch !== 'function') return;
  if (refreshedToday(mirror, board, new Date())) { faceOnce(board); return; }
  running.add(board);
  const store = useTitles.getState();
  void runDailyRefresh({
    board, rows: store.boardRows(), pendingIds: outbox.pendingIds(board), fetchFn: fetch.bind(globalThis) as FetchLike,
    client: getSupabase(), storage: mirror, now: new Date(), tmdbKey: TMDB_KEY, proxy: CORS_PROXY
  }).then((res) => land(board, res.changes))
    .catch((e) => console.warn('[refresh] daily refresh failed', e))
    .finally(() => { running.delete(board); faceOnce(board); });
}

import { pullTitles, subscribeTitles, type Outbox } from '../lib/syncTitles';
import type { StorageLike, SupabaseLike } from '../lib/types';
import type { StoreApi } from 'zustand';
import type { TitlesState } from './titlesStore';

export interface SyncEngineDeps {
  store: StoreApi<TitlesState>;
  storage: StorageLike;
  outbox: Outbox;
  client: () => SupabaseLike | null;
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

// Client C's mirror of the old tables. Dropped after the first good pull of
// `titles`, never before: offline, it is the only copy this device has.
const LEGACY_KEYS = ['backlog-added', 'backlog-overrides', 'backlog-parts', 'backlog-sync-outbox', 'backlog-sync-seeded'];

// Order, per board: send the queue, then read, then listen. An edit made
// offline lives only in the mirror and the queue, so a read that won the race
// would overwrite it with a state that never heard of it; while the queue
// cannot be sent the mirror is the truth and the read waits.
export function startSync(deps: SyncEngineDeps): () => void {
  const { store, storage, outbox } = deps;
  const win = deps.win ?? (typeof window === 'undefined' ? undefined : window);
  const client = deps.client();
  let stopped = false;
  let listening: { board: string; sub: { unsubscribe(): void } } | null = null;
  let legacyCleared = false;

  const pendingNow = () => store.setState({ pending: outbox.length() });

  function listen(board: string) {
    if (!client || stopped || listening?.board === board) return;
    listening?.sub.unsubscribe();
    listening = { board, sub: subscribeTitles(client, board, (change) => { if (!stopped) store.getState().applyChange(board, change); }) };
  }

  async function syncBoard(board: string) {
    if (!client) { store.setState({ loading: false }); return; }
    await store.getState().flush();
    if (stopped) return;
    pendingNow();
    if (outbox.list().some((o) => o.board === board)) { store.setState({ loading: false }); return; }
    const res = await pullTitles(client, board);
    // The board may have changed, or sign-out may have cleared the mirror,
    // while the request was out.
    if (stopped || store.getState().boardId !== board) return;
    if (!res.ok) { store.setState({ loading: false }); return; }
    store.getState().applyPulled(board, res.rows);
    if (!legacyCleared) { LEGACY_KEYS.forEach((k) => storage.removeItem?.(k)); legacyCleared = true; }
    listen(board);
  }

  function current() {
    const board = store.getState().boardId;
    if (board) void syncBoard(board).catch((e) => { console.warn('[sync] board sync failed', e); store.setState({ loading: false }); });
  }

  const unwatch = store.subscribe((s, prev) => {
    if (s.boardId === prev.boardId) return;
    if (listening && listening.board !== s.boardId) { listening.sub.unsubscribe(); listening = null; }
    current();
  });

  async function onOnline() {
    store.setState({ online: true });
    current();
  }
  const onOffline = () => store.setState({ online: false });
  win?.addEventListener('online', onOnline);
  win?.addEventListener('offline', onOffline);

  if (!client) store.setState({ loading: false });
  current();

  return () => {
    stopped = true;
    unwatch();
    win?.removeEventListener('online', onOnline);
    win?.removeEventListener('offline', onOffline);
    listening?.sub.unsubscribe();
    listening = null;
  };
}

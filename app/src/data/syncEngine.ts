import * as Sync from '../lib/sync';
import type { StorageLike, SupabaseLike } from '../lib/types';
import type { StoreApi } from 'zustand';
import type { TitlesState } from './titlesStore';

export interface SyncEngineDeps {
  store: StoreApi<TitlesState>;
  storage: StorageLike;
  client: () => SupabaseLike | null;
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

// v2's mirror starts empty and only ever holds pulled rows plus its own
// edits, which were pushed or queued. So unlike v1 there is no local history
// to seed first: flushing the queue before the pull is the whole guarantee.
async function pullIntoMirror(client: SupabaseLike, storage: StorageLike): Promise<Sync.PullResult> {
  const result = await Sync.pullState(client);
  if (result.ok) Sync.applyState(storage, result.state);
  return result;
}

export function startSync(deps: SyncEngineDeps): () => void {
  const { store, storage } = deps;
  const win = deps.win ?? (typeof window === 'undefined' ? undefined : window);
  const client = deps.client();
  let stopped = false;
  let channel: unknown = null;

  const done = () => store.setState({ loading: false, pending: Sync.outboxLength() });

  async function onRemoteChange() {
    if (!client) return;
    const result = await pullIntoMirror(client, storage);
    if (!stopped && result.ok) store.getState().refresh();
  }

  async function onOnline() {
    store.setState({ online: true });
    if (!client) return;
    await Sync.flushOutbox(client);
    store.setState({ pending: Sync.outboxLength() });
    await onRemoteChange();
  }
  const onOffline = () => store.setState({ online: false });

  win?.addEventListener('online', onOnline);
  win?.addEventListener('offline', onOffline);

  if (!client) {
    done();
  } else {
    void (async () => {
      try {
        // Before the pull, never after: an edit made offline lives only in
        // the mirror and the queue, and a pull that won first would overwrite
        // it with a state that never heard of it.
        await Sync.flushOutbox(client);
        const result = await pullIntoMirror(client, storage);
        if (stopped) return;
        // Forced: the first real data should land even if a panel opened
        // while it was loading.
        if (result.ok) store.getState().refresh(true);
        done();
        // Only tables that answered: realtime for a missing table takes the
        // whole channel down with it.
        if (result.ok) channel = Sync.subscribe(client, () => { void onRemoteChange(); }, { tables: result.tables });
      } catch (e) {
        console.warn('[sync] startup failed, running from the mirror', e);
        done();
      }
    })();
  }

  return () => {
    stopped = true;
    win?.removeEventListener('online', onOnline);
    win?.removeEventListener('offline', onOffline);
    if (channel && client && typeof client.removeChannel === 'function') client.removeChannel(channel);
  };
}

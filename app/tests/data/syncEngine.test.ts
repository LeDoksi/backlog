import { beforeEach, describe, expect, it } from 'vitest';
import { createTitlesStore } from '../../src/data/titlesStore';
import { startSync } from '../../src/data/syncEngine';
import { busy } from '../../src/data/busy';
import * as Sync from '../../src/lib/sync';
import { fakeClient, fakeStorage, tick } from './fakes';

beforeEach(() => { busy._reset(); Sync._resetEchoes(); });

async function settle() { for (let i = 0; i < 6; i++) await tick(); }

describe('startSync', () => {
  it('flushes the queue before it pulls', async () => {
    const storage = fakeStorage({ 'backlog-sync-outbox': [{ t: 'override', id: 'a', patch: { status: 'done' } }] });
    const client = fakeClient({ drafts: [{ id: 'a', title: 'A', category: 'movie', status: 'queue', genres: [] }] });
    const store = createTitlesStore({ storage, client: () => client });
    const stop = startSync({ store, storage, client: () => client, win: new EventTarget() as unknown as Window });
    await settle();
    const firstUpsert = client.log.findIndex((e) => e.op === 'upsert');
    const firstSelect = client.log.findIndex((e) => e.op === 'select');
    expect(firstUpsert).toBeGreaterThanOrEqual(0);
    expect(firstUpsert).toBeLessThan(firstSelect);
    expect(store.getState().pending).toBe(0);
    expect(store.getState().loading).toBe(false);
    expect(client.log.some((e) => e.op === 'subscribe')).toBe(true);
    stop();
  });

  it('offline start keeps the mirror and stops loading', async () => {
    const storage = fakeStorage({ 'backlog-added': [{ id: 'a', title: 'A', category: 'movie', status: 'queue', genres: [] }] });
    const client = fakeClient();
    client.state.offline = true;
    const store = createTitlesStore({ storage, client: () => client });
    startSync({ store, storage, client: () => client, win: new EventTarget() as unknown as Window });
    await settle();
    expect(store.getState().titles).toHaveLength(1);
    expect(store.getState().loading).toBe(false);
  });

  it('coming online flushes queued edits and clears pending', async () => {
    const storage = fakeStorage({ 'backlog-added': [{ id: 'a', title: 'A', category: 'movie', status: 'queue', genres: [] }] });
    const client = fakeClient({ drafts: [{ id: 'a', title: 'A', category: 'movie', status: 'queue', genres: [] }] });
    client.state.offline = true;
    const win = new EventTarget() as unknown as Window;
    const store = createTitlesStore({ storage, client: () => client });
    startSync({ store, storage, client: () => client, win });
    await settle();
    store.getState().setStatus('a', 'done');
    win.dispatchEvent(new Event('offline'));
    await settle();
    expect(store.getState().pending).toBe(1);
    expect(store.getState().online).toBe(false);
    client.state.offline = false;
    win.dispatchEvent(new Event('online'));
    await settle();
    expect(store.getState().pending).toBe(0);
    expect(store.getState().online).toBe(true);
    expect(store.getState().titles[0]!.status).toBe('done');
  });
});

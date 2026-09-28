import { beforeEach, describe, expect, it } from 'vitest';
import { createTitlesStore } from '../../src/data/titlesStore';
import { startSync } from '../../src/data/syncEngine';
import { busy } from '../../src/data/busy';
import { createOutbox } from '../../src/lib/syncTitles';
import { fakeStorage, tick } from './fakes';
import { fakeTitlesClient } from './titlesFakes';

beforeEach(() => { busy._reset(); });

async function settle() { for (let i = 0; i < 8; i++) await tick(); }
const row = (id: string, extra: Record<string, unknown> = {}) =>
  ({ workspace_id: 'b1', id, title: id.toUpperCase(), category: 'movie', status: 'queue', genres: [], checked_parts: {}, ...extra });

function setup(opts: { seed?: Record<string, unknown>; server?: Record<string, ReturnType<typeof row>[]>; offline?: boolean } = {}) {
  const storage = fakeStorage(opts.seed ?? {});
  const client = fakeTitlesClient(opts.server ?? { b1: [] });
  client.state.offline = !!opts.offline;
  const outbox = createOutbox(storage);
  const store = createTitlesStore({ storage, client: () => client, outbox });
  const win = new EventTarget() as unknown as Window;
  const start = () => startSync({ store, storage, outbox, client: () => client, win });
  return { storage, client, outbox, store, win, start };
}

describe('startSync', () => {
  it('flushes the queue before it pulls, then listens', async () => {
    const { client, outbox, store, start } = setup({ server: { b1: [row('a')] } });
    outbox.add({ kind: 'patch', board: 'b1', id: 'a', cols: { status: 'done' } });
    store.getState().setBoard('b1');
    const stop = start();
    await settle();
    const ops = client.log.map((e) => e.op);
    expect(ops.indexOf('update')).toBeGreaterThanOrEqual(0);
    expect(ops.indexOf('update')).toBeLessThan(ops.indexOf('select'));
    expect(store.getState().titles[0]!.status).toBe('done');
    expect(store.getState()).toMatchObject({ pending: 0, loading: false });
    expect(client.log.find((e) => e.op === 'on')!.filters).toEqual({ filter: 'workspace_id=eq.b1' });
    stop();
  });

  it('offline start keeps the mirror and stops loading', async () => {
    const { store, start } = setup({ seed: { 'titles:b1': [row('a')] }, offline: true });
    store.getState().setBoard('b1');
    start();
    await settle();
    expect(store.getState().titles).toHaveLength(1);
    expect(store.getState().loading).toBe(false);
  });

  it('coming online flushes queued edits and clears pending', async () => {
    const { client, store, win, start } = setup({ seed: { 'titles:b1': [row('a')] }, server: { b1: [row('a')] }, offline: true });
    store.getState().setBoard('b1');
    start();
    await settle();
    store.getState().setStatus('a', 'done');
    win.dispatchEvent(new Event('offline'));
    await settle();
    expect(store.getState()).toMatchObject({ pending: 1, online: false });
    client.state.offline = false;
    win.dispatchEvent(new Event('online'));
    await settle();
    expect(store.getState()).toMatchObject({ pending: 0, online: true });
    expect(client.tables.b1![0]!.status).toBe('done');
  });

  it('opened offline, starts realtime once the network is back', async () => {
    const { client, store, win, start } = setup({ offline: true });
    store.getState().setBoard('b1');
    start();
    await settle();
    expect(client.log.some((e) => e.op === 'subscribe')).toBe(false);
    client.state.offline = false;
    win.dispatchEvent(new Event('online'));
    await settle();
    expect(client.log.some((e) => e.op === 'subscribe')).toBe(true);
  });

  it('applies another device\'s change straight from the event', async () => {
    const { client, store, start } = setup({ server: { b1: [row('a')] } });
    store.getState().setBoard('b1');
    start();
    await settle();
    client.emit('b1', { eventType: 'UPDATE', new: row('a', { status: 'done' }), old: {} });
    expect(store.getState().titles[0]!.status).toBe('done');
    client.emit('b1', { eventType: 'DELETE', new: {}, old: { workspace_id: 'b1', id: 'a' } });
    expect(store.getState().titles).toEqual([]);
  });

  it('a remote change does not hide a title whose send is still queued', async () => {
    const { client, store, start } = setup();
    store.getState().setBoard('b1');
    start();
    await settle();
    client.state.offline = true;
    store.getState().addTitle({ id: 'new', title: 'New', category: 'movie', status: 'queue', genres: [] });
    await settle();
    client.emit('b1', { eventType: 'DELETE', new: {}, old: { workspace_id: 'b1', id: 'new' } });
    expect(store.getState().titles.map((t) => t.id)).toEqual(['new']);
    expect(store.getState().pending).toBe(1);
  });

  it('switching boards pulls the new board and moves the subscription', async () => {
    const { client, store, start } = setup({ server: { b1: [row('a')], b2: [row('z', { workspace_id: 'b2' })] } });
    store.getState().setBoard('b1');
    start();
    await settle();
    store.getState().setBoard('b2');
    await settle();
    expect(store.getState().titles.map((t) => t.id)).toEqual(['z']);
    expect(client.log.filter((e) => e.op === 'removeChannel')).toHaveLength(1);
    expect(client.log.filter((e) => e.op === 'on').map((e) => e.filters)).toEqual([{ filter: 'workspace_id=eq.b1' }, { filter: 'workspace_id=eq.b2' }]);
  });

  it('starts pulling once a board is chosen', async () => {
    const { store, start } = setup({ server: { b1: [row('a')] } });
    start();
    await settle();
    expect(store.getState().loading).toBe(true);
    store.getState().setBoard('b1');
    await settle();
    expect(store.getState().titles).toHaveLength(1);
  });

  it('first good pull clears the old-schema mirror', async () => {
    const seed = { 'backlog-added': [{ id: 'x' }], 'backlog-overrides': {}, 'backlog-parts': {}, 'backlog-sync-outbox': [] };
    const { storage, store, start } = setup({ seed, server: { b1: [row('a')] } });
    store.getState().setBoard('b1');
    start();
    await settle();
    ['backlog-added', 'backlog-overrides', 'backlog-parts', 'backlog-sync-outbox'].forEach((k) => expect(storage.getItem(k)).toBeNull());
  });

  it('a pull that lands after stop does not write the mirror', async () => {
    const { storage, store, start } = setup({ server: { b1: [row('a')] } });
    store.getState().setBoard('b1');
    const stop = start();
    stop();
    await settle();
    expect(storage.getItem('titles:b1')).toBeNull();
  });
});

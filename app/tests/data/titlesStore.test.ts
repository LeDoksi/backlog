import { beforeEach, describe, expect, it } from 'vitest';
import { createTitlesStore } from '../../src/data/titlesStore';
import { busy } from '../../src/data/busy';
import { createOutbox } from '../../src/lib/syncTitles';
import { fakeStorage, tick } from './fakes';
import { fakeTitlesClient } from './titlesFakes';

const frieren = {
  workspace_id: 'b1', id: 'frieren-2023', title: 'Фрирен', category: 'anime', status: 'queue', genres: ['фэнтези'],
  parts: [{ name: 'Сезон 1' }, { name: 'Сезон 2' }, { name: 'Сезон 3', released: false }], checked_parts: {},
  created_at: '2026-01-01T00:00:00Z'
};
const drive = { workspace_id: 'b1', id: 'drive-2011', title: 'Драйв', category: 'movie', status: 'queue', genres: ['драма'], year: 2011,
  checked_parts: {}, created_at: '2026-01-02T00:00:00Z' };

async function settle() { for (let i = 0; i < 6; i++) await tick(); }

function setup(offline = false) {
  const storage = fakeStorage({ 'titles:b1': [frieren, drive] });
  const client = fakeTitlesClient({ b1: [frieren, drive] });
  client.state.offline = offline;
  const outbox = createOutbox(storage);
  const store = createTitlesStore({ storage, client: () => client, outbox, now: () => '2026-09-28T12:00:00.000Z' });
  store.getState().setBoard('b1');
  const title = (id: string) => store.getState().titles.find((t) => t.id === id)!;
  const writes = () => client.log.filter((e) => e.op !== 'select');
  return { storage, client, store, outbox, title, writes };
}

beforeEach(() => { busy._reset(); });

describe('titles store', () => {
  it('reads the active board from its mirror', () => {
    const { store } = setup();
    expect(store.getState().titles.map((t) => t.id)).toEqual(['frieren-2023', 'drive-2011']);
    expect(store.getState().boardId).toBe('b1');
  });

  it('setStatus changes titles at once and sends one update', async () => {
    const { store, title, client } = setup();
    store.getState().setStatus('drive-2011', 'done');
    expect(title('drive-2011').status).toBe('done');
    await settle();
    expect(client.log.find((e) => e.op === 'update')).toMatchObject({ values: { status: 'done' }, filters: { workspace_id: 'b1', id: 'drive-2011' } });
    expect(store.getState().pending).toBe(0);
  });

  it('marking done stamps completedAt on this device only; the server sets its own', async () => {
    const { store, title, client } = setup(true);
    store.getState().setStatus('drive-2011', 'done');
    expect(title('drive-2011').completedAt).toBe('2026-09-28T12:00:00.000Z');
    store.getState().setStatus('drive-2011', 'queue');
    expect(title('drive-2011').completedAt).toBeNull();
    client.state.offline = false;
    await store.getState().flush();
    const update = client.log.find((e) => e.op === 'update') as { values: Record<string, unknown> } | undefined;
    expect(update?.values).not.toHaveProperty('completed_at');
  });

  it('a failed send grows pending and keeps the edit', async () => {
    const { store, title } = setup(true);
    store.getState().setStatus('drive-2011', 'done');
    await settle();
    expect(store.getState().pending).toBe(1);
    expect(title('drive-2011').status).toBe('done');
  });

  it('addTitle refuses an id that already exists and writes nothing', async () => {
    const { store, writes } = setup();
    expect(store.getState().addTitle({ id: 'drive-2011', title: 'Драйв', category: 'movie', status: 'queue', genres: [] })).toBe('duplicate');
    await settle();
    expect(writes()).toHaveLength(0);
  });

  it('addTitle inserts a full row into the active board', async () => {
    const { store, client } = setup();
    expect(store.getState().addTitle({ id: 'x-2020', title: 'X', category: 'movie', status: 'queue', genres: [], draft: true })).toBe('ok');
    expect(store.getState().titles.map((t) => t.id)).toContain('x-2020');
    await settle();
    const ins = client.log.find((e) => e.op === 'upsert')!;
    expect(ins.values).toMatchObject({ workspace_id: 'b1', id: 'x-2020', title: 'X', category: 'movie', status: 'queue', checked_parts: {} });
    expect(ins.values).not.toHaveProperty('draft');
  });

  it('editTitle sends only the fields that changed', async () => {
    const { store, client } = setup();
    store.getState().editTitle('drive-2011', { title: 'Драйв!', year: 2011, genres: ['драма'] });
    await settle();
    expect(client.log.filter((e) => e.op === 'update').map((e) => e.values)).toEqual([{ title: 'Драйв!' }]);
  });

  it('editTitle with nothing changed sends nothing', async () => {
    const { store, writes } = setup();
    store.getState().editTitle('drive-2011', { title: 'Драйв' });
    await settle();
    expect(writes()).toHaveLength(0);
  });

  it('ticking a part writes the checklist and the status it derives, in one update', async () => {
    const { store, client, title } = setup();
    store.getState().setPartChecked('frieren-2023', 0, true);
    expect(title('frieren-2023').status).toBe('in_progress');
    expect(store.getState().checked['frieren-2023']).toEqual([0]);
    await settle();
    const ups = client.log.filter((e) => e.op === 'update');
    expect(ups).toHaveLength(1);
    expect(ups[0]!.values).toEqual({ checked_parts: { 0: '2026-09-28T12:00:00.000Z' }, status: 'in_progress', manual_status: 'queue', airing_status: 'ongoing' });
  });

  it('setAllReleasedChecked ticks released parts only', () => {
    const { store, title } = setup();
    store.getState().setAllReleasedChecked('frieren-2023');
    expect(store.getState().checked['frieren-2023']).toEqual([0, 1]);
    // Caught up but a season is still coming: in progress, not done.
    expect(title('frieren-2023').status).toBe('in_progress');
  });

  it('keeps the date a part was ticked when ticking another', () => {
    const { store } = setup();
    store.getState().setPartChecked('frieren-2023', 0, true);
    store.getState().setPartChecked('frieren-2023', 1, true);
    expect(store.getState().checkedAt['frieren-2023']).toEqual({ 0: '2026-09-28T12:00:00.000Z', 1: '2026-09-28T12:00:00.000Z' });
  });

  it('editTitle carries watched parts across a removed part', async () => {
    const { store, title } = setup();
    store.getState().setAllReleasedChecked('frieren-2023');
    // Season 1 removed: season 2 is now index 0 and stays watched.
    store.getState().editTitle('frieren-2023', { parts: [{ name: 'Сезон 2' }, { name: 'Сезон 3', released: false }] }, [0]);
    expect(store.getState().checked['frieren-2023']).toEqual([0]);
    expect(title('frieren-2023').status).toBe('in_progress');
  });

  it('removing all parts brings the hand-set status back', () => {
    const { store, title } = setup();
    store.getState().setAllReleasedChecked('frieren-2023');
    store.getState().editTitle('frieren-2023', { parts: [] }, []);
    expect(title('frieren-2023').status).toBe('queue');
    expect(title('frieren-2023').manualStatus).toBeNull();
  });

  it('deleteTitle removes the row and sends the delete', async () => {
    const { store, client } = setup();
    store.getState().deleteTitle('drive-2011');
    expect(store.getState().titles.map((t) => t.id)).toEqual(['frieren-2023']);
    await settle();
    expect(client.log.some((e) => e.op === 'delete' && e.filters?.id === 'drive-2011')).toBe(true);
  });

  it('a remote change while busy waits until busy.leave', () => {
    const { store, title } = setup();
    busy.enter('sheet');
    store.getState().applyChange('b1', { type: 'upsert', id: 'drive-2011', row: { ...drive, status: 'done' } });
    expect(title('drive-2011').status).toBe('queue');
    busy.leave('sheet');
    expect(title('drive-2011').status).toBe('done');
  });

  it('a remote change never overwrites a title with an edit still queued', async () => {
    const { store, title } = setup(true);
    store.getState().setStatus('drive-2011', 'done');
    store.getState().applyChange('b1', { type: 'upsert', id: 'drive-2011', row: { ...drive, status: 'in_progress' } });
    expect(title('drive-2011').status).toBe('done');
  });

  it('a pulled board replaces the mirror but keeps queued edits', () => {
    const { store, title } = setup(true);
    store.getState().setStatus('drive-2011', 'done');
    store.getState().applyPulled('b1', [{ ...frieren, title: 'Frieren' }, { ...drive }]);
    expect(title('frieren-2023').title).toBe('Frieren');
    expect(title('drive-2011').status).toBe('done');
  });

  it('switching boards shows the other board and keeps each mirror', () => {
    const { store, storage } = setup();
    storage.setItem('titles:b2', JSON.stringify([{ ...drive, workspace_id: 'b2', id: 'other-1', title: 'Other' }]));
    store.getState().setBoard('b2');
    expect(store.getState().titles.map((t) => t.id)).toEqual(['other-1']);
    store.getState().setBoard('b1');
    expect(store.getState().titles).toHaveLength(2);
  });

  it('with no board yet it is loading and empty', () => {
    const storage = fakeStorage();
    const store = createTitlesStore({ storage, client: () => null, outbox: createOutbox(storage) });
    expect(store.getState()).toMatchObject({ titles: [], loading: true, boardId: null });
    store.getState().setBoard(null);
    expect(store.getState().loading).toBe(false);
  });
});

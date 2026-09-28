import { beforeEach, describe, expect, it } from 'vitest';
import { createTitlesStore } from '../../src/data/titlesStore';
import { busy } from '../../src/data/busy';
import * as Sync from '../../src/lib/sync';
import type { Title } from '../../src/lib/types';
import { fakeClient, fakeStorage, tick } from './fakes';

const frieren: Title = {
  id: 'frieren-2023', title: 'Фрирен', category: 'anime', status: 'queue', genres: ['фэнтези'],
  parts: [{ name: 'Сезон 1' }, { name: 'Сезон 2' }, { name: 'Сезон 3', released: false }]
};
const drive: Title = { id: 'drive-2011', title: 'Драйв', category: 'movie', status: 'queue', genres: ['драма'], year: 2011 };

function setup(offline = false) {
  const storage = fakeStorage({ 'backlog-added': [frieren, drive] });
  const client = fakeClient();
  client.state.offline = offline;
  const store = createTitlesStore({ storage, client: () => client });
  return { storage, client, store };
}

beforeEach(() => { busy._reset(); Sync._resetEchoes(); });

describe('titles store', () => {
  it('setStatus changes titles at once, writes the override and pushes it', async () => {
    const { store, storage, client } = setup();
    store.getState().setStatus('drive-2011', 'done');
    expect(store.getState().titles.find((t) => t.id === 'drive-2011')!.status).toBe('done');
    expect(storage.json('backlog-overrides')['drive-2011']).toEqual({ status: 'done' });
    expect(client.log.some((e) => e.op === 'upsert' && e.table === 'overrides')).toBe(true);
    await tick();
    expect(store.getState().pending).toBe(0);
  });

  it('a failed push grows pending', async () => {
    const { store } = setup(true);
    store.getState().setStatus('drive-2011', 'done');
    await tick(); await tick();
    expect(store.getState().pending).toBe(1);
  });

  it('addTitle refuses an id that already exists and writes nothing', () => {
    const { store, client } = setup();
    expect(store.getState().addTitle({ ...drive })).toBe('duplicate');
    expect(client.log).toHaveLength(0);
    expect(store.getState().titles).toHaveLength(2);
  });

  it('addTitle stores the row with draft=false and pushes it', () => {
    const { store, client } = setup();
    const res = store.getState().addTitle({ id: 'x-2020', title: 'X', category: 'movie', status: 'queue', genres: [], draft: true });
    expect(res).toBe('ok');
    const up = client.log.find((e) => e.op === 'upsert' && e.table === 'drafts')!;
    expect((up.row as { draft: boolean }).draft).toBe(false);
    expect(store.getState().titles.map((t) => t.id)).toContain('x-2020');
  });

  it('editTitle sends only the fields that changed', () => {
    const { store, client } = setup();
    store.getState().editTitle('drive-2011', { title: 'Драйв!', year: 2011, genres: ['драма'] });
    const up = client.log.find((e) => e.op === 'upsert' && e.table === 'overrides')!;
    const row = up.row as Record<string, unknown>;
    expect(row.title).toBe('Драйв!');
    expect('year' in row).toBe(false);
    expect('genres' in row).toBe(false);
  });

  it('editTitle with nothing changed sends nothing', () => {
    const { store, client } = setup();
    store.getState().editTitle('drive-2011', { title: 'Драйв' });
    expect(client.log).toHaveLength(0);
  });

  it('ticking a part derives the status and pushes both parts and status', () => {
    const { store, client } = setup();
    store.getState().setPartChecked('frieren-2023', 0, true);
    expect(store.getState().titles.find((t) => t.id === 'frieren-2023')!.status).toBe('in_progress');
    expect(store.getState().checked['frieren-2023']).toEqual([0]);
    expect(client.log.filter((e) => e.op === 'upsert').map((e) => e.table)).toEqual(['parts', 'overrides']);
  });

  it('setAllReleasedChecked ticks released parts only', () => {
    const { store } = setup();
    store.getState().setAllReleasedChecked('frieren-2023');
    expect(store.getState().checked['frieren-2023']).toEqual([0, 1]);
    // Caught up but a season is still coming: in progress, not done.
    expect(store.getState().titles.find((t) => t.id === 'frieren-2023')!.status).toBe('in_progress');
  });

  it('deleteTitle removes the row and pushes the delete', () => {
    const { store, client } = setup();
    store.getState().deleteTitle('drive-2011');
    expect(store.getState().titles.map((t) => t.id)).toEqual(['frieren-2023']);
    expect(client.log.some((e) => e.op === 'delete' && e.value === 'drive-2011')).toBe(true);
  });

  it('a remote refresh while busy waits until busy.leave', () => {
    const { store, storage } = setup();
    busy.enter('sheet');
    storage.setItem('backlog-overrides', JSON.stringify({ 'drive-2011': { status: 'done' } }));
    store.getState().refresh();
    expect(store.getState().titles.find((t) => t.id === 'drive-2011')!.status).toBe('queue');
    busy.leave('sheet');
    expect(store.getState().titles.find((t) => t.id === 'drive-2011')!.status).toBe('done');
  });
});

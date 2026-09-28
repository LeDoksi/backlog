import { describe, expect, it } from 'vitest';
import { createBoardsStore, pickDefault } from '../../src/data/boardsStore';
import { fakeStorage } from './fakes';

const personal = (count: number) => ({ id: 'p', kind: 'personal' as const, visibility: 'private', title_count: count, members: [] });
const shared = { id: 's', kind: 'shared' as const, visibility: 'private', title_count: 222, members: [] };

function rpc(data: unknown) {
  return { rpc: () => Promise.resolve(data === undefined ? { data: null, error: { message: 'offline' } } : { data, error: null }) };
}

describe('boards store', () => {
  it('first choice: the personal board if it has titles, else the shared one', () => {
    expect(pickDefault([personal(3), shared])).toBe('p');
    expect(pickDefault([personal(0), shared])).toBe('s');
    expect(pickDefault([personal(0)])).toBe('p');
    expect(pickDefault([])).toBeNull();
  });

  it('refresh loads boards, picks one and tells the titles store', async () => {
    const storage = fakeStorage();
    const chosen: (string | null)[] = [];
    const store = createBoardsStore({ storage, client: () => rpc([personal(0), shared]), onActive: (id) => chosen.push(id) });
    await store.getState().refresh();
    expect(store.getState()).toMatchObject({ activeId: 's', loaded: true });
    expect(chosen).toEqual(['s']);
    expect(storage.json('board')).toBe('s');
  });

  it('keeps the chosen board across launches and works offline from the cache', async () => {
    const storage = fakeStorage({ boards: [personal(0), shared], board: 'p' });
    const chosen: (string | null)[] = [];
    const store = createBoardsStore({ storage, client: () => rpc(undefined), onActive: (id) => chosen.push(id) });
    expect(chosen).toEqual(['p']);
    await store.getState().refresh();
    expect(store.getState()).toMatchObject({ activeId: 'p', boards: [personal(0), shared] });
  });

  it('a board that is gone (left the shared board) falls back', async () => {
    const storage = fakeStorage({ boards: [personal(0), shared], board: 's' });
    const store = createBoardsStore({ storage, client: () => rpc([personal(0)]), onActive: () => {} });
    await store.getState().refresh();
    expect(store.getState().activeId).toBe('p');
  });

  it('setActive switches and remembers', () => {
    const storage = fakeStorage({ boards: [personal(1), shared], board: 'p' });
    const chosen: (string | null)[] = [];
    const store = createBoardsStore({ storage, client: () => null, onActive: (id) => chosen.push(id) });
    store.getState().setActive('s');
    expect(store.getState().activeId).toBe('s');
    expect(storage.json('board')).toBe('s');
    expect(chosen).toEqual(['p', 's']);
  });
});

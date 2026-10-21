import { describe, expect, it } from 'vitest';
import { createOtherStore } from '../../src/data/otherStore';
import { otherErrorText } from '../../src/lib/other';

const line = (id: string, title = id) => ({ id, category: 'Книги', title, description: '', links: [], status: 'want', rating: null, created_at: '2026-10-20T10:00:00Z', mine: true });

// A fake server: other_items per board, save and delete, or offline.
function server(boards: Record<string, ReturnType<typeof line>[]>, opts: { offline?: boolean } = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (opts.offline) return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } });
      const list = boards[String(args.p_workspace)] ??= [];
      if (name === 'other_items') return Promise.resolve({ data: list.slice(), error: null });
      if (name === 'save_other_item') {
        const it = { ...line('new'), ...(args.p_item as object), mine: true } as ReturnType<typeof line>;
        const at = list.findIndex((x) => x.id === it.id);
        if (at >= 0) list[at] = it; else list.unshift(it);
        return Promise.resolve({ data: it, error: null });
      }
      if (name === 'delete_other_item') {
        boards[String(args.p_workspace)] = list.filter((x) => x.id !== args.p_id);
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }
  };
  return { client, calls, boards };
}

describe('other store', () => {
  it('reads a board, never showing the previous board\'s lines', async () => {
    const srv = server({ a: [line('1')], b: [line('2')] });
    const store = createOtherStore(() => srv.client);
    await store.getState().fetch('a');
    expect(store.getState()).toMatchObject({ boardId: 'a', load: 'ready' });
    const next = store.getState().fetch('b');
    expect(store.getState().items).toEqual([]);
    await next;
    expect(store.getState().items.map((i) => i.id)).toEqual(['2']);
  });

  it('offline: an error, but a list already shown stays on a quiet re-read', async () => {
    const srv = server({ a: [line('1')] });
    let offline = false;
    const store = createOtherStore(() => (offline ? server({}, { offline: true }).client : srv.client));
    await store.getState().fetch('a');
    offline = true;
    await store.getState().fetch('a');
    expect(store.getState()).toMatchObject({ load: 'ready' });
    expect(store.getState().items).toHaveLength(1);
    await store.getState().fetch('b');
    expect(store.getState().load).toBe('error');
  });

  it('save adds and changes, remove deletes, restore brings it back', async () => {
    const srv = server({ a: [] });
    const store = createOtherStore(() => srv.client);
    await store.getState().fetch('a');
    expect(await store.getState().save({ id: 'k', title: 'Дюна', category: 'Книги', description: '', links: [], status: 'want', rating: null })).toEqual({ ok: true });
    await store.getState().save({ ...store.getState().items[0]!, status: 'done' });
    expect(store.getState().items).toHaveLength(1);
    expect(store.getState().items[0]!.status).toBe('done');
    const gone = await store.getState().remove('k');
    expect(gone?.title).toBe('Дюна');
    expect(store.getState().items).toEqual([]);
    expect(await store.getState().restore(gone!)).toBe(true);
    expect(store.getState().items.map((i) => i.id)).toEqual(['k']);
    const restoreCall = srv.calls.filter((c) => c.name === 'save_other_item').at(-1)!;
    expect(restoreCall.args.p_item).not.toHaveProperty('mine');
  });

  it('server errors read as sentences', () => {
    expect(otherErrorText('not_author')).toMatch(/только тот/);
    expect(otherErrorText('bad_links')).toMatch(/Проверь поля/);
    expect(otherErrorText('Failed to fetch')).toMatch(/сеть/);
  });
});

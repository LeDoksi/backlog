import { describe, expect, it } from 'vitest';
import { createOutbox, pullTitles, pushTitleDelete, pushTitleInsert, pushTitlePatch, subscribeTitles, isPermanent } from '../../src/lib/syncTitles';
import { fakeStorage } from '../data/fakes';
import { fakeTitlesClient } from '../data/titlesFakes';

const row = (id: string, extra: Record<string, unknown> = {}) => ({ workspace_id: 'b1', id, title: id, category: 'movie', status: 'queue', ...extra });

describe('titles requests', () => {
  it('pulls one board, oldest first', async () => {
    const client = fakeTitlesClient({ b1: [row('a'), row('b')], b2: [row('c')] });
    const res = await pullTitles(client, 'b1');
    expect(res.ok).toBe(true);
    expect(res.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(client.log[0]).toMatchObject({ op: 'select', filters: { workspace_id: 'b1' }, order: 'created_at' });
  });

  it('a failed pull is not an empty board', async () => {
    const client = fakeTitlesClient({ b1: [row('a')] });
    client.state.offline = true;
    expect(await pullTitles(client, 'b1')).toEqual({ ok: false, rows: [] });
    expect(await pullTitles(null, 'b1')).toEqual({ ok: false, rows: [] });
  });

  it('patch is an update of the given columns only, returning the server row', async () => {
    const client = fakeTitlesClient({ b1: [row('a')] });
    const res = await pushTitlePatch(client, 'b1', 'a', { status: 'done' });
    expect(res).toMatchObject({ ok: true, permanent: false, row: { id: 'a', status: 'done' } });
    expect(client.log[0]).toMatchObject({ op: 'update', values: { status: 'done' }, filters: { workspace_id: 'b1', id: 'a' } });
  });

  it('insert upserts the full row; delete deletes by board and id', async () => {
    const client = fakeTitlesClient({ b1: [] });
    expect((await pushTitleInsert(client, row('n'))).ok).toBe(true);
    expect(client.tables.b1!.map((r) => r.id)).toEqual(['n']);
    expect((await pushTitleDelete(client, 'b1', 'n')).ok).toBe(true);
    expect(client.tables.b1).toEqual([]);
  });

  it('tells a server refusal from a network failure', () => {
    expect(isPermanent({ message: 'new row violates row-level security', code: '42501' })).toBe(true);
    expect(isPermanent({ message: 'TypeError: Failed to fetch', code: '' })).toBe(false);
    expect(isPermanent({ message: 'offline' })).toBe(false);
  });

  it('subscribes to one board and passes changes on', () => {
    const client = fakeTitlesClient({ b1: [] });
    const seen: unknown[] = [];
    const sub = subscribeTitles(client, 'b1', (e) => seen.push(e));
    client.emit('b1', { eventType: 'UPDATE', new: row('a', { status: 'done' }), old: {} });
    client.emit('b1', { eventType: 'DELETE', new: {}, old: { workspace_id: 'b1', id: 'a' } });
    client.emit('b1', { eventType: 'DELETE', new: {}, old: { workspace_id: 'b2', id: 'z' } });
    expect(seen).toEqual([
      { type: 'upsert', id: 'a', row: expect.objectContaining({ status: 'done' }) },
      { type: 'delete', id: 'a', row: null }
    ]);
    sub.unsubscribe();
    expect(client.log.some((e) => e.op === 'removeChannel')).toBe(true);
  });
});

describe('outbox', () => {
  it('merges patches of one title and survives a reload', () => {
    const storage = fakeStorage();
    const box = createOutbox(storage);
    box.add({ kind: 'patch', board: 'b1', id: 'a', cols: { status: 'done' } });
    box.add({ kind: 'patch', board: 'b1', id: 'a', cols: { title: 'A' } });
    expect(createOutbox(storage).list()).toEqual([{ kind: 'patch', board: 'b1', id: 'a', cols: { status: 'done', title: 'A' } }]);
  });

  it('folds a patch into a queued insert, and a delete cancels a queued insert', () => {
    const box = createOutbox(fakeStorage());
    box.add({ kind: 'insert', board: 'b1', id: 'n', row: row('n') });
    box.add({ kind: 'patch', board: 'b1', id: 'n', cols: { status: 'done' } });
    expect(box.list()).toEqual([{ kind: 'insert', board: 'b1', id: 'n', row: row('n', { status: 'done' }) }]);
    box.add({ kind: 'delete', board: 'b1', id: 'n' });
    expect(box.list()).toEqual([]);
  });

  it('flushes in order and stops at the first network failure', async () => {
    const client = fakeTitlesClient({ b1: [row('a'), row('b')] });
    const box = createOutbox(fakeStorage());
    box.add({ kind: 'patch', board: 'b1', id: 'a', cols: { status: 'done' } });
    box.add({ kind: 'patch', board: 'b1', id: 'b', cols: { status: 'done' } });
    client.state.failNext = 1;
    const first = await box.flush(client);
    expect(first).toMatchObject({ sent: 0, left: 2 });
    const second = await box.flush(client);
    expect(second.sent).toBe(2);
    expect(second.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(box.length()).toBe(0);
  });

  it('drops an op the server refuses, so one bad edit cannot block the rest', async () => {
    const client = fakeTitlesClient({ b1: [row('b')] });
    client.state.refuse = 'a';
    const box = createOutbox(fakeStorage());
    box.add({ kind: 'patch', board: 'b1', id: 'a', cols: { status: 'done' } });
    box.add({ kind: 'patch', board: 'b1', id: 'b', cols: { status: 'done' } });
    const res = await box.flush(client);
    expect(res).toMatchObject({ sent: 1, dropped: 1, left: 0 });
  });

  it('an op in flight is still pending and still counted', async () => {
    const client = fakeTitlesClient({ b1: [row('a')] });
    const storage = fakeStorage();
    const box = createOutbox(storage);
    box.add({ kind: 'patch', board: 'b1', id: 'a', cols: { status: 'done' } });
    const p = box.flush(client);
    expect(box.pendingIds('b1')).toEqual(new Set(['a']));
    expect(createOutbox(storage).length()).toBe(1);
    await p;
    expect(box.length()).toBe(0);
  });
});

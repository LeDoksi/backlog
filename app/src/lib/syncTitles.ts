// syncTitles.ts — the `titles` table as seen from one device: read a board,
// write one title, hear about other devices' writes, and queue what could
// not be sent.
//
// The guarantees are the ones sync.ts gave the old tables: the queue goes out
// before anything is read, a failed read is never taken for an empty board,
// and nothing here throws. What changed is the shape: one row per title, so
// a write is one request and an edit made offline is one queued op.
import type { StorageLike, SupabaseLike } from './types';
import type { TitleRow } from './titleRow';

const TABLE = 'titles';

export interface PushResult { ok: boolean; permanent: boolean; row: TitleRow | null }
export type TitleChange = { type: 'upsert'; id: string; row: TitleRow } | { type: 'delete'; id: string; row: null };

interface Err { message?: string; code?: string }

// A PostgREST/Postgres error carries a code (42501 RLS, 23505 unique, …): the
// server saw the request and said no, and sending it again will not help.
// A network failure has no code, and is worth another try later.
export function isPermanent(error: Err | null | undefined): boolean {
  return !!error && typeof error.code === 'string' && error.code !== '';
}

async function run(build: () => PromiseLike<{ data: unknown; error: Err | null }>): Promise<{ data: unknown; error: Err | null }> {
  try {
    const res = await build();
    return res ?? { data: null, error: { message: 'empty response' } };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : 'unknown' } };
  }
}

function firstRow(data: unknown): TitleRow | null {
  if (Array.isArray(data)) return (data[0] as TitleRow) ?? null;
  return data && typeof data === 'object' ? data as TitleRow : null;
}

function result(res: { data: unknown; error: Err | null }): PushResult {
  if (res.error) return { ok: false, permanent: isPermanent(res.error), row: null };
  return { ok: true, permanent: false, row: firstRow(res.data) };
}

export async function pullTitles(client: SupabaseLike | null, boardId: string): Promise<{ ok: boolean; rows: TitleRow[] }> {
  if (!client) return { ok: false, rows: [] };
  const res = await run(() => client.from(TABLE).select('*').eq('workspace_id', boardId).order('created_at'));
  if (res.error || !Array.isArray(res.data)) return { ok: false, rows: [] };
  return { ok: true, rows: res.data as TitleRow[] };
}

export async function pushTitleInsert(client: SupabaseLike | null, row: TitleRow): Promise<PushResult> {
  if (!client) return { ok: false, permanent: false, row: null };
  return result(await run(() => client.from(TABLE).upsert(row, { onConflict: 'workspace_id,id' }).select()));
}

// An update, not an upsert: a patch lacks the NOT NULL columns an insert
// needs, and a title deleted on another device should stay deleted.
export async function pushTitlePatch(client: SupabaseLike | null, boardId: string, id: string, cols: Record<string, unknown>): Promise<PushResult> {
  if (!client) return { ok: false, permanent: false, row: null };
  return result(await run(() => client.from(TABLE).update(cols).eq('workspace_id', boardId).eq('id', id).select()));
}

export async function pushTitleDelete(client: SupabaseLike | null, boardId: string, id: string): Promise<PushResult> {
  if (!client) return { ok: false, permanent: false, row: null };
  return result(await run(() => client.from(TABLE).delete().eq('workspace_id', boardId).eq('id', id)));
}

// Realtime cannot filter deletes by column, so a delete from another board
// can arrive here; it is dropped by its workspace_id.
export function subscribeTitles(client: SupabaseLike | null, boardId: string, onChange: (c: TitleChange) => void): { unsubscribe(): void } {
  if (!client || typeof client.channel !== 'function') return { unsubscribe() {} };
  try {
    const channel = client
      .channel(`titles:${boardId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: `workspace_id=eq.${boardId}` },
        (p: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => {
          if (p.eventType === 'DELETE') {
            const old = p.old ?? {};
            if (old.workspace_id && old.workspace_id !== boardId) return;
            if (typeof old.id === 'string') onChange({ type: 'delete', id: old.id, row: null });
            return;
          }
          const row = p.new as unknown as TitleRow;
          if (row && row.id && (!row.workspace_id || row.workspace_id === boardId)) onChange({ type: 'upsert', id: row.id, row });
        })
      .subscribe();
    return { unsubscribe() { try { client.removeChannel?.(channel); } catch { /* already gone */ } } };
  } catch {
    return { unsubscribe() {} };
  }
}

// ── Outbox ──────────────────────────────────────────────────────────────

export type Op =
  | { kind: 'insert'; board: string; id: string; row: TitleRow }
  | { kind: 'patch'; board: string; id: string; cols: Record<string, unknown> }
  | { kind: 'delete'; board: string; id: string };

interface Saved { inflight: Op | null; queue: Op[] }

export interface FlushResult { sent: number; dropped: number; left: number; rows: TitleRow[] }

const OUTBOX_KEY = 'outbox:v2';

export function createOutbox(storage: StorageLike) {
  function read(): Saved {
    try {
      const raw = JSON.parse(storage.getItem(OUTBOX_KEY) || 'null');
      if (raw && Array.isArray(raw.queue)) return { inflight: raw.inflight ?? null, queue: raw.queue };
    } catch { /* unreadable: start empty */ }
    return { inflight: null, queue: [] };
  }
  function write(s: Saved) {
    try { storage.setItem(OUTBOX_KEY, JSON.stringify(s)); } catch { /* quota: the op stays in memory only */ }
  }
  let flushing: Promise<FlushResult> | null = null;

  const box = {
    list(): Op[] {
      const s = read();
      return s.inflight ? [s.inflight, ...s.queue] : s.queue;
    },
    length(): number { return box.list().length; },
    pendingIds(board: string): Set<string> {
      return new Set(box.list().filter((o) => o.board === board).map((o) => o.id));
    },
    // The op in flight is never merged into: it may already have reached the
    // server, and folding a later edit into it would lose that edit.
    add(op: Op): void {
      const s = read();
      const same = (o: Op) => o.board === op.board && o.id === op.id;
      if (op.kind === 'delete') {
        const hadInsert = s.queue.some((o) => same(o) && o.kind === 'insert');
        s.queue = s.queue.filter((o) => !same(o));
        const insertInFlight = s.inflight && same(s.inflight) && s.inflight.kind === 'insert';
        if (!hadInsert || insertInFlight) s.queue.push(op);
      } else if (op.kind === 'patch') {
        const last = [...s.queue].reverse().find(same);
        if (last && last.kind === 'insert') last.row = { ...last.row, ...op.cols } as TitleRow;
        else if (last && last.kind === 'patch') last.cols = { ...last.cols, ...op.cols };
        else if (!last || last.kind !== 'delete') s.queue.push(op);
      } else {
        s.queue.push(op);
      }
      write(s);
    },
    async flush(client: SupabaseLike | null): Promise<FlushResult> {
      if (flushing) await flushing;
      flushing = (async () => {
        const out: FlushResult = { sent: 0, dropped: 0, left: 0, rows: [] };
        for (;;) {
          const s = read();
          const op = s.inflight ?? s.queue.shift();
          if (!op) break;
          write({ inflight: op, queue: s.queue });
          const res = op.kind === 'insert' ? await pushTitleInsert(client, op.row)
            : op.kind === 'patch' ? await pushTitlePatch(client, op.board, op.id, op.cols)
              : await pushTitleDelete(client, op.board, op.id);
          const now = read();
          if (!res.ok && !res.permanent) break;
          write({ inflight: null, queue: now.queue });
          if (res.ok) { out.sent += 1; if (res.row) out.rows.push(res.row); } else out.dropped += 1;
        }
        out.left = box.length();
        return out;
      })();
      try { return await flushing; } finally { flushing = null; }
    },
    clear(): void { storage.removeItem?.(OUTBOX_KEY); }
  };
  return box;
}
export type Outbox = ReturnType<typeof createOutbox>;

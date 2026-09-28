import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { materialize } from '../lib/derive';
import * as Storage from '../lib/storage';
import { prefixedStorage } from '../lib/prefixedStorage';
import { checkedIndices, fromRow, patchColumns, toRow, type CheckedParts, type TitleRow } from '../lib/titleRow';
import { createOutbox, type Outbox, type TitleChange } from '../lib/syncTitles';
import type { Status, StorageLike, SupabaseLike, Title } from '../lib/types';
import { busy } from './busy';
import { getSupabase } from './supabase';

export interface TitlesState {
  boardId: string | null;
  titles: Title[];
  checked: Record<string, number[]>;
  /** Part index → when it was ticked, per title (for «Итоги»). */
  checkedAt: Record<string, CheckedParts>;
  loading: boolean;
  pending: number;
  online: boolean;
  setBoard(id: string | null): void;
  setStatus(id: string, status: Status): void;
  setPartChecked(id: string, index: number, checked: boolean): void;
  setAllReleasedChecked(id: string): void;
  addTitle(t: Title): 'ok' | 'duplicate';
  /** `checked` carries watched parts across a reorder or removal of parts. */
  editTitle(id: string, patch: Partial<Title>, checked?: number[]): void;
  deleteTitle(id: string): void;
  /** Kept for QuickAdd: v2 deletes a title whole, so no id is left behind. */
  leftoverIds(): string[];
  /** A pulled board, replacing its mirror (queued edits stay on top). */
  applyPulled(boardId: string, rows: TitleRow[]): void;
  /** One title changed on another device, or the server's copy of our write. */
  applyChange(boardId: string, change: TitleChange): void;
  /** Send the queue; resolves when it is empty or the network failed. */
  flush(): Promise<void>;
  /** Re-read the mirror; deferred while `busy` unless forced. */
  refresh(force?: boolean): void;
}

export interface TitlesDeps {
  storage: StorageLike;
  client: () => SupabaseLike | null;
  outbox?: Outbox;
  now?: () => string;
}

const mirrorKey = (board: string) => `titles:${board}`;

export function createTitlesStore(deps: TitlesDeps): UseBoundStore<StoreApi<TitlesState>> {
  const { storage } = deps;
  const outbox = deps.outbox ?? createOutbox(storage);
  const now = deps.now ?? (() => new Date().toISOString());
  let stale = false;

  function readRows(board: string | null): TitleRow[] {
    if (!board) return [];
    try {
      const raw = JSON.parse(storage.getItem(mirrorKey(board)) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }
  function writeRows(board: string, rows: TitleRow[]) {
    try { storage.setItem(mirrorKey(board), JSON.stringify(rows)); } catch { /* quota: memory only until reload */ }
  }

  function view(board: string | null) {
    const titles: Title[] = [];
    const checked: Record<string, number[]> = {};
    const checkedAt: Record<string, CheckedParts> = {};
    readRows(board).forEach((row) => {
      const r = fromRow(row);
      titles.push(r.title);
      checked[r.title.id] = checkedIndices(r.checked);
      checkedAt[r.title.id] = r.checked;
    });
    return { titles, checked, checkedAt, pending: outbox.length() };
  }

  const store = create<TitlesState>()((set, get) => {
    function compute() {
      stale = false;
      set(view(get().boardId));
    }

    function flush(): Promise<void> {
      return outbox.flush(deps.client()).then((res) => {
        // The server's copy carries what only it knows (dates, defaults).
        res.rows.forEach((row) => {
          if (row.workspace_id) get().applyChange(row.workspace_id, { type: 'upsert', id: row.id, row });
        });
        set({ pending: outbox.length() });
      });
    }

    function row(id: string): TitleRow | undefined {
      return readRows(get().boardId).find((r) => r.id === id);
    }

    // The titles_touch trigger's dates, mirrored so «Итоги» count a title
    // finished offline at once. They stay local: the server stamps its own
    // and the next pull or echo replaces these.
    function localDates(r: TitleRow, cols: Record<string, unknown>): Partial<TitleRow> {
      if (!('status' in cols) || cols.status === r.status) return {};
      if (cols.status === 'done') return { completed_at: now() };
      if (r.status === 'done') return { completed_at: null };
      if (cols.status === 'in_progress' && !r.started_at) return { started_at: now() };
      return {};
    }

    // Local first, then the queue: the screen never waits for the network.
    function patch(id: string, cols: Record<string, unknown>) {
      const board = get().boardId;
      if (!board || !Object.keys(cols).length) return;
      writeRows(board, readRows(board).map((r) => (r.id === id ? { ...r, ...cols, ...localDates(r, cols) } as TitleRow : r)));
      outbox.add({ kind: 'patch', board, id, cols });
      compute();
      void flush();
    }

    // Status, manual status and "still airing" always travel with the
    // checklist and the parts they are derived from.
    function derived(title: Title, ticks: CheckedParts): Record<string, unknown> {
      const m = materialize(title, checkedIndices(ticks));
      return { checked_parts: ticks, status: m.status, manual_status: m.manualStatus, airing_status: m.airingStatus };
    }

    function setTicks(id: string, indices: number[]) {
      const current = get().titles.find((t) => t.id === id);
      const before = get().checkedAt[id] ?? {};
      if (!current) return;
      const stamp = now();
      const ticks: CheckedParts = {};
      [...new Set(indices)].filter((i) => Number.isInteger(i) && i >= 0).sort((a, b) => a - b)
        .forEach((i) => { ticks[String(i)] = before[String(i)] ?? stamp; });
      patch(id, derived(current, ticks));
    }

    return {
      boardId: null,
      titles: [],
      checked: {},
      checkedAt: {},
      loading: true,
      pending: outbox.length(),
      online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,

      setBoard(id) {
        // No board at all (the list could not be read on a first, offline
        // launch) is an empty screen, not an endless skeleton.
        if (id === get().boardId) { if (!id) set({ loading: false }); return; }
        const cached = id ? storage.getItem(mirrorKey(id)) !== null : false;
        set({ boardId: id, loading: id ? !cached : false, ...view(id) });
      },

      setStatus(id, status) {
        patch(id, { status });
      },

      setPartChecked(id, index, on) {
        const current = get().checked[id] ?? [];
        setTicks(id, on ? [...current, index] : current.filter((i) => i !== index));
      },

      setAllReleasedChecked(id) {
        const title = get().titles.find((t) => t.id === id);
        if (!title || !Storage.hasPartsChecklist(title)) return;
        const released = title.parts.map((p, i) => (p && p.released === false ? -1 : i)).filter((i) => i >= 0);
        setTicks(id, [...(get().checked[id] ?? []), ...released]);
      },

      addTitle(t) {
        const board = get().boardId;
        if (!board || get().titles.some((x) => x.id === t.id)) return 'duplicate';
        const m = materialize(t, []);
        const full = toRow(board, { ...t, status: m.status, manualStatus: m.manualStatus, airingStatus: m.airingStatus }, {});
        writeRows(board, [...readRows(board), { ...full, created_at: now() }]);
        outbox.add({ kind: 'insert', board, id: t.id, row: full });
        compute();
        void flush();
        return 'ok';
      },

      editTitle(id, next, checked) {
        const current = get().titles.find((t) => t.id === id);
        if (!current) return;
        const changed: Partial<Title> = {};
        (Object.keys(next) as (keyof Title)[]).forEach((k) => {
          if (JSON.stringify(next[k] ?? null) !== JSON.stringify(current[k] ?? null)) (changed as Record<string, unknown>)[k] = next[k];
        });
        const touchesDerived = 'parts' in changed || 'category' in changed || checked !== undefined;
        if (!Object.keys(changed).length && !touchesDerived) return;
        let cols = patchColumns(changed);
        if (touchesDerived) {
          const merged = { ...current, ...changed } as Title;
          // Dates follow the ticks in order: after a reorder or a removal the
          // n-th ticked part keeps the n-th date, so «Итоги» do not count a
          // season again as if it was watched today.
          const oldDates = checkedIndices(get().checkedAt[id]).map((i) => get().checkedAt[id]![String(i)]!);
          const indices = checked ?? get().checked[id] ?? [];
          const ticks: CheckedParts = {};
          [...indices].sort((a, b) => a - b).forEach((i, n) => { ticks[String(i)] = oldDates[n] ?? now(); });
          const d = derived(merged, ticks);
          // Only what actually changes goes over the wire.
          const was = row(id);
          Object.entries(d).forEach(([k, v]) => {
            if (JSON.stringify(v ?? null) !== JSON.stringify((was as Record<string, unknown> | undefined)?.[k] ?? null)) cols[k] = v;
          });
          if (!Object.keys(cols).length) return;
        }
        patch(id, cols);
      },

      deleteTitle(id) {
        const board = get().boardId;
        if (!board) return;
        writeRows(board, readRows(board).filter((r) => r.id !== id));
        outbox.add({ kind: 'delete', board, id });
        compute();
        void flush();
      },

      leftoverIds() {
        return [];
      },

      applyPulled(board, rows) {
        const queued = outbox.list().filter((o) => o.board === board);
        let next = rows.slice();
        queued.forEach((op) => {
          if (op.kind === 'delete') next = next.filter((r) => r.id !== op.id);
          else if (op.kind === 'insert') next = next.some((r) => r.id === op.id) ? next : [...next, { ...op.row, created_at: now() }];
          else next = next.map((r) => (r.id === op.id ? { ...r, ...op.cols } as TitleRow : r));
        });
        writeRows(board, next);
        if (board === get().boardId) {
          set({ loading: false });
          get().refresh();
        }
      },

      applyChange(board, change) {
        // Our own queued edit is newer than anything the server says now.
        if (outbox.pendingIds(board).has(change.id)) return;
        const rows = readRows(board);
        if (change.type === 'delete') {
          if (!rows.some((r) => r.id === change.id)) return;
          writeRows(board, rows.filter((r) => r.id !== change.id));
        } else {
          const at = rows.findIndex((r) => r.id === change.id);
          if (at >= 0) rows[at] = { ...rows[at], ...change.row }; else rows.push(change.row);
          writeRows(board, rows);
        }
        if (board === get().boardId) get().refresh();
      },

      flush,

      refresh(force) {
        if (!force && busy.isBusy()) { stale = true; set({ pending: outbox.length() }); return; }
        compute();
      }
    };
  });

  busy.onIdle(() => { if (stale) store.getState().refresh(true); });
  return store;
}

// Everything v2 keeps on the device lives under its own prefix.
export const mirror: StorageLike = typeof localStorage === 'undefined'
  ? { getItem: () => null, setItem: () => {} }
  : prefixedStorage(localStorage, 'bl2:');

export const outbox = createOutbox(mirror);
export const useTitles = createTitlesStore({ storage: mirror, client: getSupabase, outbox });

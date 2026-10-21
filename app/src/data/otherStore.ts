import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { deleteOtherItem, otherItems, saveOtherItem, type OtherDraft, type OtherItem } from '../lib/otherApi';
import type { SupabaseLike } from '../lib/types';
import { getSupabase } from './supabase';

// «Другое» (BL-119), online only: no mirror and no queue. The list is read
// when the tab is on and the board changes or the app comes back to the
// foreground; every change waits for the server's answer.
export type OtherLoad = 'idle' | 'loading' | 'ready' | 'error';

export interface OtherState {
  boardId: string | null;
  items: OtherItem[];
  load: OtherLoad;
  /** The open line (its sheet), by id. */
  openId: string | null;
  /** The form: a new line (`{}`) or a change to one (`{ id }`). */
  form: { id?: string } | null;
  /** Reads the board's lines; the same board again re-reads quietly. */
  fetch(board: string | null): Promise<void>;
  save(draft: OtherDraft): Promise<{ ok: boolean; error?: string }>;
  /** Gone from the server at once; the line is kept for «Отменить». */
  remove(id: string): Promise<OtherItem | null>;
  /** Brings back a line deleted a moment ago, under its old id and date. */
  restore(item: OtherItem): Promise<boolean>;
  open(id: string | null): void;
  openForm(form: { id?: string } | null): void;
  reset(): void;
}

export function createOtherStore(client: () => SupabaseLike | null): UseBoundStore<StoreApi<OtherState>> {
  let run = 0;
  return create<OtherState>()((set, get) => {
    const upsert = (item: OtherItem) => set((st) => ({
      items: st.items.some((i) => i.id === item.id) ? st.items.map((i) => (i.id === item.id ? item : i)) : [item, ...st.items]
    }));
    return {
      boardId: null,
      items: [],
      load: 'idle',
      openId: null,
      form: null,

      async fetch(board) {
        const n = ++run;
        if (!board) { set({ boardId: null, items: [], load: 'idle' }); return; }
        const same = board === get().boardId;
        // Another board: its lines only, never a flash of the previous one.
        set(same ? { load: get().load === 'ready' ? 'ready' : 'loading' } : { boardId: board, items: [], load: 'loading', openId: null, form: null });
        const rows = await otherItems(client(), board);
        if (n !== run) return;
        if (rows) set({ items: rows, load: 'ready' });
        else if (!same || get().load !== 'ready') set({ load: 'error' });
      },

      async save(draft) {
        const board = get().boardId;
        if (!board) return { ok: false, error: 'no_board' };
        const res = await saveOtherItem(client(), board, draft);
        if (!res.ok) return { ok: false, error: res.error };
        if (get().boardId === board) upsert(res.item);
        return { ok: true };
      },

      async remove(id) {
        const board = get().boardId;
        const item = get().items.find((i) => i.id === id);
        if (!board || !item) return null;
        const ok = await deleteOtherItem(client(), board, id);
        if (!ok) return null;
        if (get().boardId === board) set((st) => ({ items: st.items.filter((i) => i.id !== id), openId: st.openId === id ? null : st.openId }));
        return item;
      },

      async restore(item) {
        const { mine: _mine, ...draft } = item;
        return (await get().save(draft)).ok;
      },

      open: (id) => set({ openId: id }),
      openForm: (form) => set({ form }),
      reset: () => { run++; set({ boardId: null, items: [], load: 'idle', openId: null, form: null }); }
    };
  });
}

export const useOther = createOtherStore(getSupabase);

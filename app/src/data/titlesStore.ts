import { create, type StoreApi, type UseBoundStore } from 'zustand';
import * as Storage from '../lib/storage';
import * as Sync from '../lib/sync';
import { prefixedStorage } from '../lib/prefixedStorage';
import type { Status, StorageLike, SupabaseLike, Title } from '../lib/types';
import { busy } from './busy';
import { getSupabase } from './supabase';

export interface TitlesState {
  titles: Title[];
  checked: Record<string, number[]>;
  loading: boolean;
  pending: number;
  online: boolean;
  setStatus(id: string, status: Status): void;
  setPartChecked(id: string, index: number, checked: boolean): void;
  setAllReleasedChecked(id: string): void;
  addTitle(t: Title): 'ok' | 'duplicate';
  editTitle(id: string, patch: Partial<Title>): void;
  deleteTitle(id: string): void;
  /** Re-read the mirror; deferred while `busy` unless forced. */
  refresh(force?: boolean): void;
}

export interface TitlesDeps {
  storage: StorageLike;
  client: () => SupabaseLike | null;
}

function readChecked(storage: StorageLike): Record<string, number[]> {
  try {
    const raw = JSON.parse(storage.getItem(Sync.KEYS.parts) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

export function createTitlesStore(deps: TitlesDeps): UseBoundStore<StoreApi<TitlesState>> {
  const { storage } = deps;
  let stale = false;
  // Registered before any client exists, so an edit made while sync never
  // came up is still remembered for the next load.
  Sync.useOutbox(storage);

  const store = create<TitlesState>()((set, get) => {
    function compute() {
      stale = false;
      set({
        titles: Storage.applyOverlay(Storage.getAdded(storage), storage),
        checked: readChecked(storage),
        pending: Sync.outboxLength()
      });
    }

    // Every push resolves (never rejects); a failure lands in the outbox, and
    // the badge has to learn about it without waiting for the next edit.
    function settle(p: Promise<boolean>) {
      void p.then(() => set({ pending: Sync.outboxLength() }));
    }

    function find(id: string): Title | undefined {
      return get().titles.find((t) => t.id === id);
    }

    // The checklist is the input and the status the output, so both travel:
    // sending only the indices would leave the other device deriving from its
    // own copy, and sending only the status would let its empty checklist
    // shadow the value it was just sent.
    function commitParts(id: string, after: number[]) {
      settle(Sync.pushParts(deps.client(), id, after));
      const title = find(id);
      const derived = title ? Storage.deriveStatus(title.parts, after) : null;
      if (derived) {
        Storage.setOverride(storage, id, { status: derived });
        settle(Sync.pushOverride(deps.client(), id, { status: derived }));
      }
      compute();
    }

    return {
      titles: Storage.applyOverlay(Storage.getAdded(storage), storage),
      checked: readChecked(storage),
      loading: Storage.getAdded(storage).length === 0,
      pending: 0,
      online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,

      setStatus(id, status) {
        Storage.setOverride(storage, id, { status });
        settle(Sync.pushOverride(deps.client(), id, { status }));
        compute();
      },

      setPartChecked(id, index, checked) {
        commitParts(id, Storage.setPartChecked(storage, id, index, checked));
      },

      setAllReleasedChecked(id) {
        const title = find(id);
        if (!title || !Storage.hasPartsChecklist(title)) return;
        const released = title.parts.map((p, i) => (p && p.released === false ? -1 : i)).filter((i) => i >= 0);
        const current = Storage.getCheckedParts(storage, id);
        commitParts(id, Storage.setCheckedParts(storage, id, current.concat(released)));
      },

      addTitle(t) {
        if (Storage.getAdded(storage).some((x) => x.id === t.id)) return 'duplicate';
        // "Черновик" no longer exists as a concept; v1 still reads the column.
        const row: Title = { ...t, draft: false };
        Storage.addTitle(storage, row);
        settle(Sync.pushDraft(deps.client(), row));
        compute();
        return 'ok';
      },

      editTitle(id, patch) {
        const current = find(id);
        if (!current) return;
        const changed: Record<string, unknown> = {};
        (Object.keys(patch) as (keyof Title)[]).forEach((k) => {
          if (JSON.stringify(patch[k] ?? null) !== JSON.stringify(current[k] ?? null)) changed[k] = patch[k];
        });
        if (!Object.keys(changed).length) return;
        Storage.setOverride(storage, id, changed as Partial<Title>);
        settle(Sync.pushOverride(deps.client(), id, changed));
        compute();
      },

      deleteTitle(id) {
        Storage.deleteTitle(storage, id);
        settle(Sync.pushRemoveDraft(deps.client(), id));
        compute();
      },

      refresh(force) {
        if (!force && busy.isBusy()) { stale = true; set({ pending: Sync.outboxLength() }); return; }
        compute();
      }
    };
  });

  busy.onIdle(() => { if (stale) store.getState().refresh(true); });
  return store;
}

// v1 and v2 share one origin during the transition, so v2's mirror lives
// under its own prefix and never touches v1's keys.
export const mirror: StorageLike = typeof localStorage === 'undefined'
  ? { getItem: () => null, setItem: () => {} }
  : prefixedStorage(localStorage, 'bl2:');

export const useTitles = createTitlesStore({ storage: mirror, client: getSupabase });

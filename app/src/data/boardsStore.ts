import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { myBoards, type BoardRow } from '../lib/auth';
import type { StorageLike, SupabaseLike } from '../lib/types';
import { getSupabase } from './supabase';
import { mirror, useTitles } from './titlesStore';

export type Board = BoardRow;

export interface BoardsState {
  boards: Board[];
  activeId: string | null;
  /** The list came from the server at least once this session. */
  loaded: boolean;
  setActive(id: string): void;
  refresh(): Promise<void>;
  reset(): void;
}

export interface BoardsDeps {
  storage: StorageLike;
  client: () => SupabaseLike | null;
  onActive: (id: string | null) => void;
}

const BOARDS_KEY = 'boards';
const ACTIVE_KEY = 'board';

// Where to land the first time: people who shared a space before boards
// existed have all their titles in the shared board and an empty personal
// one, and opening the empty one would look like everything was lost.
export function pickDefault(boards: Board[]): string | null {
  const personal = boards.find((b) => b.kind === 'personal');
  const shared = boards.find((b) => b.kind === 'shared');
  if (personal && personal.title_count > 0) return personal.id;
  return (shared ?? personal)?.id ?? null;
}

function read<T>(storage: StorageLike, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function createBoardsStore(deps: BoardsDeps): UseBoundStore<StoreApi<BoardsState>> {
  const { storage } = deps;
  const save = (key: string, v: unknown) => { try { storage.setItem(key, JSON.stringify(v)); } catch { /* memory only */ } };
  const cachedBoards = read<Board[]>(storage, BOARDS_KEY, []);
  const cachedActive = read<string | null>(storage, ACTIVE_KEY, null);
  const initial = cachedBoards.some((b) => b.id === cachedActive) ? cachedActive : pickDefault(cachedBoards);

  const store = create<BoardsState>()((set, get) => ({
    boards: cachedBoards,
    activeId: initial,
    loaded: false,

    setActive(id) {
      if (id === get().activeId || !get().boards.some((b) => b.id === id)) return;
      save(ACTIVE_KEY, id);
      set({ activeId: id });
      deps.onActive(id);
    },

    async refresh() {
      const rows = await myBoards(deps.client());
      if (!rows) {
        set({ loaded: true });
        if (!get().activeId) deps.onActive(null);
        return;
      }
      save(BOARDS_KEY, rows);
      const keep = rows.some((b) => b.id === get().activeId) ? get().activeId : pickDefault(rows);
      const changed = keep !== get().activeId;
      set({ boards: rows, activeId: keep, loaded: true });
      if (keep) save(ACTIVE_KEY, keep);
      if (changed || !keep) deps.onActive(keep);
    },

    reset() {
      storage.removeItem?.(BOARDS_KEY);
      storage.removeItem?.(ACTIVE_KEY);
      set({ boards: [], activeId: null, loaded: false });
      deps.onActive(null);
    }
  }));
  if (initial) deps.onActive(initial);
  return store;
}

export const useBoards = createBoardsStore({
  storage: mirror,
  client: getSupabase,
  onActive: (id) => useTitles.getState().setBoard(id)
});

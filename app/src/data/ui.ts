import { create } from 'zustand';

// Which overlay is up. Panels have no URL of their own (Back closes them via
// the Sheet's history entry), so this store is the only place they live.
interface UiState {
  openTitleId: string | null;
  editTitleId: string | null;
  quickAddOpen: boolean;
  openTitle(id: string): void;
  closeTitle(): void;
  openEdit(id: string): void;
  closeEdit(): void;
  setQuickAdd(open: boolean): void;
}

export const useUi = create<UiState>()((set) => ({
  openTitleId: null,
  editTitleId: null,
  quickAddOpen: false,
  openTitle: (id) => set({ openTitleId: id }),
  closeTitle: () => set({ openTitleId: null }),
  openEdit: (id) => set({ editTitleId: id }),
  closeEdit: () => set({ editTitleId: null }),
  setQuickAdd: (open) => set({ quickAddOpen: open })
}));

export const openTitle = (id: string) => useUi.getState().openTitle(id);

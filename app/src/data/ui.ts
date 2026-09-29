import { create } from 'zustand';
import type { Section } from '../ui/TabBar';

// Which overlay is up. Panels have no URL of their own (Back closes them via
// the Sheet's history entry), so this store is the only place they live.
interface UiState {
  section: Section;
  setSection(section: Section): void;
  openTitleId: string | null;
  editTitleId: string | null;
  quickAddOpen: boolean;
  openTitle(id: string): void;
  closeTitle(): void;
  openEdit(id: string): void;
  closeEdit(): void;
  setQuickAdd(open: boolean): void;
  /** A friend's page, over whatever section is open. */
  friend: { id: string; tab: 'done' | 'watching' | 'want' } | null;
  openFriend(id: string, tab?: 'done' | 'watching' | 'want'): void;
  closeFriend(): void;
  /** A short note at the bottom of the screen (the invite link outcome). */
  toast: string | null;
  showToast(text: string | null): void;
  /** Asked from elsewhere (the leaderboard): Profile opens its privacy panel and clears this. */
  privacyRequested: boolean;
  openPrivacy(): void;
  clearPrivacyRequest(): void;
}

export const useUi = create<UiState>()((set) => ({
  section: 'backlog',
  setSection: (section) => { set({ section }); window.scrollTo(0, 0); },
  openTitleId: null,
  editTitleId: null,
  quickAddOpen: false,
  openTitle: (id) => set({ openTitleId: id }),
  closeTitle: () => set({ openTitleId: null }),
  openEdit: (id) => set({ editTitleId: id }),
  closeEdit: () => set({ editTitleId: null }),
  setQuickAdd: (open) => set({ quickAddOpen: open }),
  friend: null,
  openFriend: (id, tab = 'done') => set({ friend: { id, tab } }),
  closeFriend: () => set({ friend: null }),
  toast: null,
  showToast: (text) => set({ toast: text }),
  privacyRequested: false,
  openPrivacy: () => { set({ section: 'profile', privacyRequested: true }); window.scrollTo(0, 0); },
  clearPrivacyRequest: () => set({ privacyRequested: false })
}));

export const openTitle = (id: string) => useUi.getState().openTitle(id);

import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { matchesFilters, matchesSearch, sortTitles, isStillAiring } from '../lib/query';
import { isCaughtUp } from '../lib/storage';
import type { Category, Status, Title } from '../lib/types';

/** A status chip: the four statuses and «Ждёт продолжения» (in progress, caught up). */
export type StatusFilter = Status | 'waiting';

export type SortKey = 'status' | 'added' | 'name' | 'year';

export interface FilterState {
  category: 'all' | Category;
  statuses: StatusFilter[];
  genres: string[];
  stillAiring: boolean;
  hideDone: boolean;
  search: string;
  sort: SortKey;
}

export const DEFAULT_FILTERS: FilterState = {
  category: 'all', statuses: [], genres: [], stillAiring: false, hideDone: false, search: '', sort: 'status'
};

const KEY = 'bl2:filters';
const CATEGORIES: ('all' | Category)[] = ['all', 'anime', 'movie', 'series', 'game'];
const STATUSES: StatusFilter[] = ['queue', 'in_progress', 'waiting', 'done', 'unreleased'];
const SORTS: SortKey[] = ['status', 'added', 'name', 'year'];

// Search is deliberately not persisted: coming back to a half-typed query
// from yesterday reads as "my titles are gone".
function load(): FilterState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      ...DEFAULT_FILTERS,
      category: CATEGORIES.includes(raw.category) ? raw.category : 'all',
      statuses: Array.isArray(raw.statuses) ? raw.statuses.filter((s: StatusFilter) => STATUSES.includes(s)) : [],
      genres: Array.isArray(raw.genres) ? raw.genres.filter((g: unknown) => typeof g === 'string') : [],
      stillAiring: raw.stillAiring === true,
      hideDone: raw.hideDone === true,
      sort: SORTS.includes(raw.sort) ? raw.sort : 'status'
    };
  } catch {
    return { ...DEFAULT_FILTERS };
  }
}

function save(f: FilterState) {
  try {
    const { search: _search, ...rest } = f;
    localStorage.setItem(KEY, JSON.stringify(rest));
  } catch { /* private mode: filters just won't persist */ }
}

type FiltersStore = FilterState & { set(p: Partial<FilterState>): void; reset(): void };

export const useFilters: UseBoundStore<StoreApi<FiltersStore>> = create<FiltersStore>()((set, get) => ({
  ...(typeof localStorage === 'undefined' ? DEFAULT_FILTERS : load()),
  set(p) {
    // Genres belong to a category; carrying them across tabs would leave a
    // filter active that the new tab's genre list does not even show.
    const patch = p.category !== undefined && p.category !== get().category && p.genres === undefined ? { ...p, genres: [] } : p;
    set(patch);
    save({ ...get() });
  },
  reset() {
    const { category, sort } = get();
    set({ ...DEFAULT_FILTERS, category, sort });
    save({ ...get() });
  }
}));

/** Watched everything that is out and more is coming (spec 2.4): «Ждёт продолжения». */
export function isWaiting(t: Title, checked: number[] | undefined): boolean {
  return t.status === 'in_progress' && isCaughtUp(t, checked ?? []);
}

export function visibleTitles(titles: Title[], f: FilterState, checked: Record<string, number[]> = {}): Title[] {
  const waiting = (t: Title) => isWaiting(t, checked[t.id]);
  const list = titles.filter((t) => {
    if (f.category !== 'all' && t.category !== f.category) return false;
    if (f.hideDone && t.status === 'done') return false;
    if (f.statuses.length && !f.statuses.includes(waiting(t) ? 'waiting' : t.status)) return false;
    return matchesFilters(t, { genre: f.genres, returning: f.stillAiring }) && matchesSearch(t, f.search.trim());
  });
  return sortTitles(list, f.sort, waiting);
}

/** How many filters beyond category and search are narrowing the grid. */
export function activeFilterCount(f: FilterState): number {
  return (f.statuses.length ? 1 : 0) + (f.genres.length ? 1 : 0) + (f.stillAiring ? 1 : 0) + (f.hideDone ? 1 : 0);
}

export function categoryCounts(titles: Title[]): Record<'all' | Category, { done: number; total: number }> {
  const out = Object.fromEntries(CATEGORIES.map((c) => [c, { done: 0, total: 0 }])) as Record<'all' | Category, { done: number; total: number }>;
  titles.forEach((t) => {
    for (const key of ['all', t.category] as const) {
      out[key].total += 1;
      if (t.status === 'done') out[key].done += 1;
    }
  });
  return out;
}

/** Genres present in a category, most used first, for the genre panel. */
export function genreCounts(titles: Title[], category: 'all' | Category): { genre: string; count: number }[] {
  const counts = new Map<string, number>();
  titles.forEach((t) => {
    if (category !== 'all' && t.category !== category) return;
    (t.genres || []).forEach((g) => counts.set(g, (counts.get(g) ?? 0) + 1));
  });
  return [...counts].map(([genre, count]) => ({ genre, count })).sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre, 'ru'));
}

export { isStillAiring };

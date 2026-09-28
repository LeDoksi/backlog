export type Category = 'game' | 'series' | 'movie' | 'anime';
export type Status = 'queue' | 'in_progress' | 'done' | 'unreleased';
export type AiringStatus = 'ongoing' | 'completed' | null;

export interface Part {
  name: string;
  year?: number | null;
  released?: boolean;
}

export interface Title {
  id: string;
  title: string;
  category: Category;
  status: Status;
  airingStatus?: AiringStatus;
  year?: number | null;
  genres: string[];
  rating?: number | null;
  synopsis?: string;
  cover?: string;
  originalTitle?: string;
  seasonInfo?: string;
  platforms?: string[];
  parts?: Part[];
  draft?: boolean;
  source?: string | null;
  sourceId?: string | null;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

// The Supabase SDK client, or a test fake shaped like the few calls these
// modules make. Kept structural on purpose: the modules never trust the
// client to exist or to behave, so they are written against "anything".
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SupabaseLike = any;

// Anything shaped like `fetch`: called with a URL, returns `{ ok, json() }`.
export type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;

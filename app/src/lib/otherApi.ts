// «Другое» (BL-119): hand-made lines for what search does not cover. The
// server keeps them in a table of their own, reached only through the
// functions below; like lib/auth.ts, nothing here throws, and a failed call
// is `null` (or `{ ok: false }`), distinct from any answer the server gives.
// The form's checks and the filters are in lib/other.ts, loaded with the tab.
import { callRpc } from './auth';
import type { SupabaseLike } from './types';

export type OtherStatus = 'want' | 'done';

export interface OtherItem {
  id: string;
  category: string;
  title: string;
  description: string;
  links: string[];
  status: OtherStatus;
  rating: number | null;
  created_at: string;
  /** I wrote it (or its author is gone): I may change the text and delete it. */
  mine: boolean;
}

/** What the form edits; `id` and `created_at` only when changing or bringing back a line. */
export interface OtherDraft {
  id?: string;
  category: string;
  title: string;
  description: string;
  links: string[];
  status: OtherStatus;
  rating: number | null;
  created_at?: string;
}

export function otherItems(client: SupabaseLike, board: string): Promise<OtherItem[] | null> {
  return callRpc(client, 'other_items', { p_workspace: board }).then((res) =>
    !res.error && Array.isArray(res.data) ? (res.data as OtherItem[]) : null);
}

export function saveOtherItem(client: SupabaseLike, board: string, item: OtherDraft): Promise<{ ok: true; item: OtherItem } | { ok: false; error: string }> {
  return callRpc(client, 'save_other_item', { p_workspace: board, p_item: item }).then((res) =>
    !res.error && res.data && typeof res.data === 'object'
      ? { ok: true as const, item: res.data as OtherItem }
      : { ok: false as const, error: res.error?.message || 'unknown' });
}

export function deleteOtherItem(client: SupabaseLike, board: string, id: string): Promise<boolean> {
  return callRpc(client, 'delete_other_item', { p_workspace: board, p_id: id }).then((res) => !res.error);
}

export function setShowOther(client: SupabaseLike, on: boolean): Promise<boolean> {
  return callRpc(client, 'set_show_other', { p_on: on }).then((res) => !res.error);
}


import type { Page } from '@playwright/test';
import { materialize } from '../../src/lib/derive';
import type { Title } from '../../src/lib/types';

type Row = Record<string, unknown>;

export interface StubUser { id: string; name: string; nickname: string }
export interface StubInvite { id: number; from_id: string; from_name: string; from_nickname: string }

export interface StubOptions {
  signedIn: boolean;
  /** false: the account was never invited (complete_signup → not_invited). */
  hasProfile?: boolean;
  /** null sends a new account to the nickname screen. */
  nickname?: string | null;
  /** Rows of the personal board, `titles`-shaped (see catalog.ts). */
  titles?: Row[];
  /** Rows of a shared board; the board exists only when this is given. */
  sharedTitles?: Row[];
  /** Who else is on the shared board. */
  sharedWith?: StubUser[];
  /** Ticked parts, applied to the rows above with their status derived as the client would write it. */
  parts?: { id: string; indices: number[] }[];
  /** People find_user_by_nick knows. */
  users?: StubUser[];
  /** Incoming shared-board invites. */
  invites?: StubInvite[];
}

export const E2E_USER = '00000000-0000-4000-8000-000000000001';
export const PERSONAL = '00000000-0000-4000-8000-0000000000b1';
export const SHARED = '00000000-0000-4000-8000-0000000000b2';

// The status column is written by the client from the checklist, so a
// fixture with ticks carries the status the client would have stored.
function withParts(rows: Row[] | undefined, board: string, parts: StubOptions['parts']): Row[] {
  return (rows ?? []).map((r) => {
    const ticks = parts?.find((p) => p.id === r.id)?.indices ?? [];
    const checked = Object.fromEntries(ticks.map((i) => [String(i), '2026-09-01T00:00:00.000Z']));
    const m = materialize({ ...(r as unknown as Title), manualStatus: (r.manual_status as Title['manualStatus']) ?? null, airingStatus: (r.airing_status as Title['airingStatus']) ?? null }, ticks);
    return { ...r, workspace_id: board, checked_parts: checked, status: m.status, manual_status: m.manualStatus, airing_status: m.airingStatus };
  });
}

// Stands in for supabase-js in the `--mode e2e` build (see data/supabase.ts):
// the same calls lib/auth.ts, lib/boards.ts and lib/syncTitles.ts make,
// answered from fixtures, so the tests never reach the network or a real
// Google sign-in. Writes land in window.__writes and RPCs in window.__rpcCalls.
export async function installStub(page: Page, options: StubOptions): Promise<void> {
  const prepared = {
    ...options,
    titles: withParts(options.titles, PERSONAL, options.parts),
    sharedTitles: options.sharedTitles ? withParts(options.sharedTitles, SHARED, options.parts) : null,
    ids: { user: E2E_USER, personal: PERSONAL, shared: SHARED }
  };
  await page.addInitScript((opts: typeof prepared) => {
    const { user: userId, personal, shared } = opts.ids;
    const w = window as unknown as { __writes?: Row[]; __rpcCalls?: Row[]; __blSupabaseStub: unknown };
    const invited = opts.hasProfile !== false;
    const me = { id: userId, email: 'e2e@example.com', display_name: 'E2E', nickname: opts.nickname === undefined ? 'e2e' : opts.nickname,
      // The account's theme outlives a reload, as on the server.
      theme: sessionStorage.getItem('e2e:theme') ?? 'system' };
    const titles: Row[] = [...opts.titles, ...(opts.sharedTitles ?? [])];
    let sharedMembers: { id: string; name: string; nickname: string | null }[] | null = opts.sharedTitles
      ? [{ id: userId, name: me.display_name, nickname: me.nickname }, ...(opts.sharedWith ?? [])]
      : null;
    let invites = (opts.invites ?? []).slice();

    const offline = () => ({ data: null, error: { message: 'Failed to fetch' } });
    const log = (entry: Row) => { (w.__writes ??= []).push(entry); };

    function query(table: string) {
      const filters: [string, unknown][] = [];
      let op: 'select' | 'upsert' | 'update' | 'delete' = 'select';
      let payload: Row | null = null;
      const match = (r: Row) => filters.every(([c, v]) => r[c] === v);
      const run = () => {
        if (table !== 'titles') return { data: [], error: null };
        if (op !== 'select' && !navigator.onLine) return offline();
        if (op === 'select') return { data: titles.filter(match), error: null };
        if (op === 'upsert') {
          const row = { created_at: new Date().toISOString(), ...payload } as Row;
          const at = titles.findIndex((t) => t.workspace_id === row.workspace_id && t.id === row.id);
          if (at >= 0) titles[at] = { ...titles[at], ...row }; else titles.push(row);
          log({ op, table, row: payload });
          return { data: [row], error: null };
        }
        if (op === 'update') {
          const hit = titles.filter(match);
          hit.forEach((t) => Object.assign(t, payload));
          log({ op, table, id: filters.find(([c]) => c === 'id')?.[1], row: payload });
          return { data: hit, error: null };
        }
        const keep = titles.filter((t) => !match(t));
        log({ op, table, id: filters.find(([c]) => c === 'id')?.[1] });
        titles.splice(0, titles.length, ...keep);
        return { data: null, error: null };
      };
      const q = {
        select() { return q; },
        order() { return q; },
        eq(col: string, val: unknown) { filters.push([col, val]); return q; },
        upsert(row: Row) { op = 'upsert'; payload = row; return q; },
        update(cols: Row) { op = 'update'; payload = cols; return q; },
        delete() { op = 'delete'; return q; },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return Promise.resolve(run()).then(resolve, reject);
        }
      };
      return q;
    }

    function boards(): Row[] {
      const count = (b: string) => titles.filter((t) => t.workspace_id === b).length;
      const list: Row[] = [{ id: personal, kind: 'personal', visibility: 'private', title_count: count(personal), members: [{ id: userId, name: me.display_name, nickname: me.nickname }] }];
      if (sharedMembers) list.push({ id: shared, kind: 'shared', visibility: 'private', title_count: count(shared), members: sharedMembers });
      return list;
    }

    const fail = (message: string) => ({ data: null, error: { message, code: 'P0001' } });
    const rpcs: Record<string, (a: Row) => { data: unknown; error: unknown }> = {
      complete_signup: () => ({ data: { status: invited ? 'exists' : 'not_invited' }, error: null }),
      my_profile: () => ({ data: me, error: null }),
      my_boards: () => ({ data: boards(), error: null }),
      nickname_available: (a) => ({ data: a.p_nickname !== 'taken', error: null }),
      set_profile: (a) => { me.display_name = String(a.p_display_name); me.nickname = String(a.p_nickname); return { data: null, error: null }; },
      set_theme: (a) => { sessionStorage.setItem('e2e:theme', String(a.p_theme)); return { data: null, error: null }; },
      invite_email: () => ({ data: null, error: null }),
      find_user_by_nick: (a) => ({ data: (opts.users ?? []).filter((u) => u.nickname === a.p_nickname), error: null }),
      invite_to_shared_board: (a) => sharedMembers?.some((m) => m.id === a.p_user) ? fail('already_member') : { data: null, error: null },
      my_board_invites: () => ({ data: invites, error: null }),
      respond_board_invite: (a) => {
        const inv = invites.find((i) => i.id === a.p_id);
        if (!inv) return fail('not_found');
        invites = invites.filter((i) => i !== inv);
        if (a.p_accept) sharedMembers = [{ id: inv.from_id, name: inv.from_name, nickname: inv.from_nickname }, { id: userId, name: me.display_name, nickname: me.nickname }];
        return { data: null, error: null };
      },
      leave_shared_board: () => { sharedMembers = null; return { data: null, error: null }; },
      remove_board_member: (a) => { sharedMembers = sharedMembers?.filter((m) => m.id !== a.p_user) ?? null; return { data: null, error: null }; },
      copy_title: (a) => {
        const src = titles.find((t) => t.workspace_id === a.p_from && t.id === a.p_title_id);
        if (!src) return fail('not_found');
        if (titles.some((t) => t.workspace_id === a.p_to && t.id === src.id)) return fail('duplicate');
        titles.push({ ...src, workspace_id: a.p_to, status: src.status === 'unreleased' ? 'unreleased' : 'queue', manual_status: null, checked_parts: {} });
        return { data: null, error: null };
      }
    };

    const session = opts.signedIn ? { user: { id: userId, email: 'e2e@example.com' } } : null;
    const client = {
      auth: {
        getSession: () => Promise.resolve({ data: { session }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signInWithOAuth: () => Promise.resolve({ data: null, error: null }),
        signOut: () => Promise.resolve({ error: null })
      },
      from: query,
      rpc: (name: string, args: Row = {}) => {
        (w.__rpcCalls ??= []).push({ name, args });
        if (!navigator.onLine) return Promise.resolve(offline());
        const fn = rpcs[name];
        return Promise.resolve(fn ? fn(args) : { data: null, error: null });
      },
      channel() {
        const ch = { on() { return ch; }, subscribe() { return ch; } };
        return ch;
      },
      removeChannel() {}
    };
    w.__blSupabaseStub = { createClient: () => client };
  }, prepared);
}

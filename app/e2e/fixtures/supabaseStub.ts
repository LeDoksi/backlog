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
  /** Rows feed() returns (see data/feedFormat.ts). */
  feed?: Row[];
  /** Incoming friend requests. */
  friendRequests?: { id: number; user_id: string; name: string; nickname: string }[];
  /** People search_users() knows (with their flags). */
  people?: { id: string; name: string; nickname: string; is_friend?: boolean; requested?: boolean; incoming?: boolean }[];
  /** What complete_signup says the invite link did, when called with one. */
  inviteOutcome?: Row;
  /** friend_shelf rows by user and tab. */
  shelves?: Record<string, Partial<Record<'done' | 'watching' | 'want', Row[]>>>;
  /** taste_match answers by user. */
  taste?: Record<string, Row>;
  /** Friends my_friends() returns. */
  friends?: { id: string; name: string; nickname: string; since: string }[];
  /** Rows matches() returns. */
  matches?: Row[];
  /** friends_on_titles rows; the stub returns those whose title_key was asked for. */
  friendsOn?: Row[];
  /** leaderboard answers by category; missing categories are an empty board. `off` when I do not take part. */
  leaderboard?: Record<string, Row> | 'off';
}

export const E2E_USER = '00000000-0000-4000-8000-000000000001';
export const PERSONAL = '00000000-0000-4000-8000-0000000000b1';
export const SHARED = '00000000-0000-4000-8000-0000000000b2';

// The status column is written by the client from the checklist, so a
// fixture with ticks carries the status the client would have stored.
function withParts(rows: Row[] | undefined, board: string, parts: StubOptions['parts']): Row[] {
  return (rows ?? []).map((r) => {
    const ticks = parts?.find((p) => p.id === r.id)?.indices ?? [];
    const checked = Object.fromEntries(ticks.map((i) => [String(i), '2025-01-01T00:00:00.000Z']));
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
    const visibility: Record<string, string> = { [personal]: 'private', [shared]: 'private' };
    const privacy = { in_leaderboard: false, share_activity: true, share_matches: true, findable_by_nick: true };
    Object.assign(me, privacy);
    let feedSeen = false;
    let sharedInLeaderboard = false;
    let friendRequests = (opts.friendRequests ?? []).map((r) => ({ ...r, at: new Date().toISOString() }));
    let friends = (opts.friends ?? []).slice();
    const inbox = () => ({
      friend_requests: friendRequests,
      board_invites: invites.map((i) => ({ id: i.id, user_id: i.from_id, name: i.from_name, nickname: i.from_nickname, at: new Date().toISOString() }))
    });

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
      const list: Row[] = [{ id: personal, kind: 'personal', visibility: visibility[personal], title_count: count(personal), members: [{ id: userId, name: me.display_name, nickname: me.nickname }], in_leaderboard: false }];
      if (sharedMembers) list.push({ id: shared, kind: 'shared', visibility: visibility[shared], title_count: count(shared), members: sharedMembers, in_leaderboard: sharedInLeaderboard });
      return list;
    }

    const fail = (message: string) => ({ data: null, error: { message, code: 'P0001' } });
    const rpcs: Record<string, (a: Row) => { data: unknown; error: unknown }> = {
      complete_signup: (a) => ({ data: { status: invited ? 'exists' : 'not_invited', ...(a.invite_token && opts.inviteOutcome ? { invite: opts.inviteOutcome } : {}) }, error: null }),
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
      set_board_visibility: (a) => { visibility[String(a.p_workspace)] = String(a.p_visibility); return { data: null, error: null }; },
      set_board_leaderboard: (a) => { sharedInLeaderboard = !!a.p_on; return { data: null, error: null }; },
      set_privacy: (a) => {
        Object.assign(me, { in_leaderboard: a.p_in_leaderboard, share_activity: a.p_share_activity, share_matches: a.p_share_matches, findable_by_nick: a.p_findable_by_nick });
        return { data: null, error: null };
      },
      my_hidden_titles: () => ({ data: titles.filter((t) => t.hidden).map((t) => ({ workspace_id: t.workspace_id, id: t.id, title: t.title, category: t.category, year: t.year, cover: t.cover })), error: null }),
      create_invite_link: () => ({ data: { token: 'g7k2q4m9x1', expires_at: new Date(Date.now() + 7 * 864e5).toISOString() }, error: null }),
      search_users: (a) => ({
        data: (opts.people ?? []).filter((p) => p.nickname.startsWith(String(a.p_prefix)))
          .map((p) => ({ is_friend: false, requested: false, incoming: false, ...p })), error: null
      }),
      send_friend_request: (a) => {
        const p = (opts.people ?? []).find((x) => x.id === a.p_user);
        if (!p) return { data: { status: 'not_found' }, error: null };
        if (p.incoming) { friends.push({ id: p.id, name: p.name, nickname: p.nickname, since: new Date().toISOString() }); return { data: { status: 'friends' }, error: null }; }
        return { data: { status: 'requested' }, error: null };
      },
      respond_friend_request: (a) => {
        const r = friendRequests.find((x) => x.id === a.p_id);
        friendRequests = friendRequests.filter((x) => x !== r);
        if (r && a.p_accept) friends.push({ id: r.user_id, name: r.name, nickname: r.nickname, since: new Date().toISOString() });
        return { data: null, error: null };
      },
      remove_friend: (a) => { friends = friends.filter((f) => f.id !== a.p_user); return { data: null, error: null }; },
      friend_profile: (a) => {
        const f = friends.find((x) => x.id === a.p_user);
        return { data: f ? { id: f.id, name: f.name, nickname: f.nickname, is_friend: true, since: f.since } : null, error: null };
      },
      friend_shelf: (a) => ({ data: opts.shelves?.[String(a.p_user)]?.[a.p_status as 'done'] ?? [], error: null }),
      taste_match: (a) => ({ data: opts.taste?.[String(a.p_user)] ?? { status: 'not_enough' }, error: null }),
      feed: () => ({ data: opts.feed ?? [], error: null }),
      mark_feed_seen: () => { feedSeen = true; return { data: null, error: null }; },
      badge_count: () => ({ data: (feedSeen ? 0 : (opts.feed ?? []).length) + friendRequests.length + invites.length, error: null }),
      my_inbox: () => ({ data: inbox(), error: null }),
      my_friends: () => ({ data: friends, error: null }),
      leaderboard: (a) => {
        if (opts.leaderboard === 'off' && !(me as Row).in_leaderboard && !sharedInLeaderboard) return { data: { status: 'off' }, error: null };
        const board = opts.leaderboard && opts.leaderboard !== 'off' ? opts.leaderboard[String(a.p_category)] : undefined;
        return { data: board ?? { status: 'ok', rows: [], mine: [{ board_id: personal, kind: 'personal', name: me.display_name, score: 0, place: null }] }, error: null };
      },
      matches: () => ({ data: opts.matches ?? [], error: null }),
      friends_on_titles: (a) => ({ data: (opts.friendsOn ?? []).filter((r) => (a.p_keys as string[]).includes(String(r.title_key))), error: null }),
      copy_from_friend: (a) => {
        const shelf = opts.shelves?.[String(a.p_owner)] ?? {};
        const src = [...(shelf.done ?? []), ...(shelf.watching ?? []), ...(shelf.want ?? [])].find((r) => r.id === a.p_title_id);
        if (!src) return fail('not_found');
        if (titles.some((t) => t.workspace_id === a.p_to && t.id === src.id)) return fail('duplicate');
        titles.push({ id: src.id, workspace_id: a.p_to, title: src.title, category: src.category, year: src.year, cover: src.cover, status: 'queue', genres: [], hidden: false, checked_parts: {}, manual_status: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
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

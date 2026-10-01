// social.ts — friends, invite links, privacy and the social reads.
// Wrappers over security-definer RPCs with the auth.ts contract: they never
// throw, and a failed call is `null` (or `false`), never mistaken for an
// empty answer from the server.
import { callRpc, type SignupStatus } from './auth';
import { normalizeNick } from './boards';
import type { SupabaseLike } from './types';
import type { FeedRow } from '../data/feedFormat';

export type InviteStatus = 'requested' | 'friends' | 'already_friends' | 'self' | 'expired';
export interface InviteOutcome { status: InviteStatus; from_name?: string | null }
export interface Signup { status: SignupStatus; invite: InviteOutcome | null }
export interface InviteLink { token: string; expires_at: string }
export interface FoundPerson { id: string; name: string; nickname: string; is_friend: boolean; requested: boolean; incoming: boolean }
export type RequestStatus = 'requested' | 'friends' | 'already_friends' | 'self' | 'not_found';
export interface InboxItem { id: number; user_id: string; name: string; nickname: string | null; at: string }
export interface Inbox { friend_requests: InboxItem[]; board_invites: InboxItem[] }
export interface Friend { id: string; name: string; nickname: string | null; since: string }

const SIGNUP: SignupStatus[] = ['created', 'exists', 'not_invited'];

function data<T>(res: { data: unknown; error: unknown }): T | null {
  return !res.error && res.data !== null && res.data !== undefined ? res.data as T : null;
}

export async function completeSignup(client: SupabaseLike, token?: string | null): Promise<Signup | null> {
  const res = await callRpc(client, 'complete_signup', token ? { invite_token: token } : undefined);
  const body = data<{ status?: string; invite?: InviteOutcome }>(res);
  if (!body || !SIGNUP.includes(body.status as SignupStatus)) return null;
  return { status: body.status as SignupStatus, invite: body.invite ?? null };
}

export async function createInviteLink(client: SupabaseLike): Promise<InviteLink | null> {
  const link = data<InviteLink>(await callRpc(client, 'create_invite_link'));
  return link && typeof link.token === 'string' ? link : null;
}

export async function redeemInvite(client: SupabaseLike, token: string): Promise<InviteOutcome | null> {
  return data<InviteOutcome>(await callRpc(client, 'redeem_invite', { p_token: token }));
}

/** Searches from two characters; shorter input is answered locally with nobody. */
export async function searchUsers(client: SupabaseLike, raw: string): Promise<FoundPerson[] | null> {
  const prefix = normalizeNick(raw);
  if (prefix.length < 2) return [];
  const rows = data<FoundPerson[]>(await callRpc(client, 'search_users', { p_prefix: prefix }));
  return Array.isArray(rows) ? rows : null;
}

export async function sendFriendRequest(client: SupabaseLike, userId: string): Promise<RequestStatus | null> {
  return data<{ status: RequestStatus }>(await callRpc(client, 'send_friend_request', { p_user: userId }))?.status ?? null;
}

export async function respondFriendRequest(client: SupabaseLike, id: number, accept: boolean): Promise<boolean> {
  return !(await callRpc(client, 'respond_friend_request', { p_id: id, p_accept: accept })).error;
}

export async function removeFriend(client: SupabaseLike, userId: string): Promise<boolean> {
  return !(await callRpc(client, 'remove_friend', { p_user: userId })).error;
}

export async function myInbox(client: SupabaseLike): Promise<Inbox | null> {
  const inbox = data<Inbox>(await callRpc(client, 'my_inbox'));
  return inbox && Array.isArray(inbox.friend_requests) ? inbox : null;
}

export async function myFriends(client: SupabaseLike): Promise<Friend[] | null> {
  const rows = data<Friend[]>(await callRpc(client, 'my_friends'));
  return Array.isArray(rows) ? rows : null;
}

// ── Privacy ────────────────────────────────────────────────────────────

export type Visibility = 'private' | 'friends' | 'everyone';
export interface PrivacySwitches { in_leaderboard: boolean; share_activity: boolean; share_matches: boolean; findable_by_nick: boolean }
export interface HiddenTitle { workspace_id: string; id: string; title: string; category: string; year: number | null; cover: string | null }

export async function setBoardVisibility(client: SupabaseLike, boardId: string, visibility: Visibility): Promise<boolean> {
  return !(await callRpc(client, 'set_board_visibility', { p_workspace: boardId, p_visibility: visibility })).error;
}

export async function setBoardLeaderboard(client: SupabaseLike, boardId: string, on: boolean): Promise<boolean> {
  return !(await callRpc(client, 'set_board_leaderboard', { p_workspace: boardId, p_on: on })).error;
}

export async function setPrivacy(client: SupabaseLike, p: PrivacySwitches): Promise<boolean> {
  return !(await callRpc(client, 'set_privacy', {
    p_in_leaderboard: p.in_leaderboard, p_share_activity: p.share_activity,
    p_share_matches: p.share_matches, p_findable_by_nick: p.findable_by_nick
  })).error;
}

export async function myHiddenTitles(client: SupabaseLike): Promise<HiddenTitle[] | null> {
  const rows = data<HiddenTitle[]>(await callRpc(client, 'my_hidden_titles'));
  return Array.isArray(rows) ? rows : null;
}

// ── Feed and badge ─────────────────────────────────────────────────────


export async function feed(client: SupabaseLike, tz: string, before?: string): Promise<FeedRow[] | null> {
  const rows = data<FeedRow[]>(await callRpc(client, 'feed', { p_before: before ?? new Date().toISOString(), p_limit: 60, p_tz: tz }));
  return Array.isArray(rows) ? rows : null;
}

export async function markFeedSeen(client: SupabaseLike): Promise<boolean> {
  return !(await callRpc(client, 'mark_feed_seen')).error;
}

export async function badgeCount(client: SupabaseLike): Promise<number | null> {
  const n = data<number>(await callRpc(client, 'badge_count'));
  return typeof n === 'number' ? n : null;
}

// ── A friend's page ────────────────────────────────────────────────────

export interface FriendPage { id: string; name: string; nickname: string | null; is_friend: boolean; since: string | null }
export interface ShelfItem { id: string; title: string; category: string; year: number | null; cover: string | null; common: boolean }
export type Taste =
  | { status: 'ok'; percent: number; common: number; both_want: number; genres: string[] }
  | { status: 'not_enough' | 'disabled' };

/** `null` when the call failed; `'none'` when there is no page to show. */
export async function friendProfile(client: SupabaseLike, userId: string): Promise<FriendPage | 'none' | null> {
  const res = await callRpc(client, 'friend_profile', { p_user: userId });
  if (res.error) return null;
  return res.data && typeof res.data === 'object' ? res.data as FriendPage : 'none';
}

export async function friendShelf(client: SupabaseLike, userId: string, tab: 'done' | 'watching' | 'want'): Promise<ShelfItem[] | null> {
  const rows = data<ShelfItem[]>(await callRpc(client, 'friend_shelf', { p_user: userId, p_status: tab }));
  return Array.isArray(rows) ? rows : null;
}

export async function tasteMatch(client: SupabaseLike, userId: string): Promise<Taste | null> {
  const t = data<Taste>(await callRpc(client, 'taste_match', { p_user: userId }));
  return t && typeof t.status === 'string' ? t : null;
}

// ── Matches and friends on a title ─────────────────────────────────────

export interface Match { friend_id: string; friend_name: string; title_key: string; title: string; category: string; cover: string | null; my_status: string; friend_status: string }
export interface FriendOn { title_key: string; friend_id: string; friend_name: string; status: string }

export async function matches(client: SupabaseLike): Promise<Match[] | null> {
  const rows = data<Match[]>(await callRpc(client, 'matches'));
  return Array.isArray(rows) ? rows : null;
}

export async function friendsOnTitles(client: SupabaseLike, keys: string[]): Promise<FriendOn[] | null> {
  if (!keys.length) return [];
  const rows = data<FriendOn[]>(await callRpc(client, 'friends_on_titles', { p_keys: keys }));
  return Array.isArray(rows) ? rows : null;
}

// ── Leaderboard ────────────────────────────────────────────────────────

/** One board: a personal one is its owner, a shared one «Гоша + Даша». */
export interface Leader { board_id: string; kind: 'personal' | 'shared'; name: string; members: string[]; score: number; place: number; mine: boolean }
export interface MyLeaderBoard { board_id: string; kind: 'personal' | 'shared'; name: string; score: number; place: number | null }
export type Leaderboard =
  | { status: 'ok'; rows: Leader[]; mine: MyLeaderBoard[] | null }
  | { status: 'off' };

/** `{status: 'off'}` when I do not take part; `null` when the call failed. */
export async function leaderboard(client: SupabaseLike, category: string, period: 'month' | 'year' | 'all'): Promise<Leaderboard | null> {
  const b = data<Leaderboard>(await callRpc(client, 'leaderboard', { p_category: category, p_period: period }));
  return b && (b.status === 'off' || (b.status === 'ok' && Array.isArray(b.rows))) ? b : null;
}

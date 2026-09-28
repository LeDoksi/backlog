// boards.ts — shared-board invites, membership and copying between boards.
// Wrappers over security-definer RPCs; like auth.ts they never throw, and
// a failure comes back as the server's reason (`target_has_shared`,
// `duplicate`, …) for the screen to translate.
import { callRpc } from './auth';
import type { SupabaseLike } from './types';

export interface FoundUser { id: string; name: string; nickname: string }
export interface BoardInvite { id: number; from_id: string; from_name: string; from_nickname: string | null; created_at: string }
export interface Outcome { ok: boolean; error: string | null }

function outcome(res: { error: { message?: string } | null }): Outcome {
  return res.error ? { ok: false, error: res.error.message || 'unknown' } : { ok: true, error: null };
}

export function normalizeNick(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase();
}

export async function findUserByNick(client: SupabaseLike, nickname: string): Promise<FoundUser | null> {
  const res = await callRpc(client, 'find_user_by_nick', { p_nickname: normalizeNick(nickname) });
  return !res.error && Array.isArray(res.data) && res.data.length ? res.data[0] as FoundUser : null;
}

export async function inviteToSharedBoard(client: SupabaseLike, userId: string): Promise<Outcome> {
  return outcome(await callRpc(client, 'invite_to_shared_board', { p_user: userId }));
}

export async function myBoardInvites(client: SupabaseLike): Promise<BoardInvite[]> {
  const res = await callRpc(client, 'my_board_invites');
  return !res.error && Array.isArray(res.data) ? res.data as BoardInvite[] : [];
}

export async function respondBoardInvite(client: SupabaseLike, id: number, accept: boolean): Promise<Outcome> {
  return outcome(await callRpc(client, 'respond_board_invite', { p_id: id, p_accept: accept }));
}

export async function leaveSharedBoard(client: SupabaseLike): Promise<Outcome> {
  return outcome(await callRpc(client, 'leave_shared_board'));
}

export async function removeBoardMember(client: SupabaseLike, userId: string): Promise<Outcome> {
  return outcome(await callRpc(client, 'remove_board_member', { p_user: userId }));
}

export async function copyTitle(client: SupabaseLike, titleId: string, from: string, to: string): Promise<Outcome> {
  return outcome(await callRpc(client, 'copy_title', { p_title_id: titleId, p_from: from, p_to: to }));
}

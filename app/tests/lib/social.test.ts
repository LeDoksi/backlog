import { describe, expect, it } from 'vitest';
import * as Social from '../../src/lib/social';

function rpcClient(reply: (name: string, args: unknown) => unknown) {
  const calls: { name: string; args: unknown }[] = [];
  return {
    calls,
    client: { rpc(name: string, args?: unknown) { calls.push({ name, args }); return Promise.resolve(reply(name, args)); } }
  };
}
const ok = (data: unknown = null) => () => ({ data, error: null });
const fail = () => ({ data: null, error: { message: 'Failed to fetch' } });

describe('social RPC wrappers', () => {
  it('completeSignup passes the token and returns status with the invite outcome', async () => {
    const r = rpcClient(ok({ status: 'created', invite: { status: 'requested', from_name: 'Георгий' } }));
    expect(await Social.completeSignup(r.client, 'abc123xyz0')).toEqual({ status: 'created', invite: { status: 'requested', from_name: 'Георгий' } });
    expect(r.calls[0]).toEqual({ name: 'complete_signup', args: { invite_token: 'abc123xyz0' } });
  });

  it('completeSignup without a token calls with no arguments; failures are null', async () => {
    const r = rpcClient(ok({ status: 'exists' }));
    expect(await Social.completeSignup(r.client)).toEqual({ status: 'exists', invite: null });
    expect(r.calls[0]).toEqual({ name: 'complete_signup', args: undefined });
    expect(await Social.completeSignup(rpcClient(fail).client)).toBeNull();
    expect(await Social.completeSignup(rpcClient(ok({ status: 'weird' })).client)).toBeNull();
    expect(await Social.completeSignup(null)).toBeNull();
  });

  it('createInviteLink returns token and expiry, null on failure', async () => {
    expect(await Social.createInviteLink(rpcClient(ok({ token: 'abc', expires_at: 'x' })).client)).toEqual({ token: 'abc', expires_at: 'x' });
    expect(await Social.createInviteLink(rpcClient(fail).client)).toBeNull();
  });

  it('redeemInvite returns the outcome', async () => {
    const r = rpcClient(ok({ status: 'already_friends', from_name: 'Г' }));
    expect(await Social.redeemInvite(r.client, 'tok')).toEqual({ status: 'already_friends', from_name: 'Г' });
    expect(r.calls[0]).toEqual({ name: 'redeem_invite', args: { p_token: 'tok' } });
    expect(await Social.redeemInvite(rpcClient(fail).client, 'tok')).toBeNull();
  });

  it('searchUsers sends the normalized prefix and skips short input without a call', async () => {
    const rows = [{ id: 'u', name: 'Катя', nickname: 'katya', is_friend: false, requested: false, incoming: false }];
    const r = rpcClient(ok(rows));
    expect(await Social.searchUsers(r.client, ' @Kat ')).toEqual(rows);
    expect(r.calls[0]).toEqual({ name: 'search_users', args: { p_prefix: 'kat' } });
    const short = rpcClient(ok(rows));
    expect(await Social.searchUsers(short.client, '@k')).toEqual([]);
    expect(short.calls).toEqual([]);
    expect(await Social.searchUsers(rpcClient(fail).client, 'kat')).toBeNull();
  });

  it('sendFriendRequest returns the status or null', async () => {
    const r = rpcClient(ok({ status: 'friends' }));
    expect(await Social.sendFriendRequest(r.client, 'u2')).toBe('friends');
    expect(r.calls[0]).toEqual({ name: 'send_friend_request', args: { p_user: 'u2' } });
    expect(await Social.sendFriendRequest(rpcClient(fail).client, 'u2')).toBeNull();
  });

  it('respondFriendRequest and removeFriend report success', async () => {
    const r = rpcClient(ok());
    expect(await Social.respondFriendRequest(r.client, 5, false)).toBe(true);
    expect(await Social.removeFriend(r.client, 'u9')).toBe(true);
    expect(r.calls).toEqual([
      { name: 'respond_friend_request', args: { p_id: 5, p_accept: false } },
      { name: 'remove_friend', args: { p_user: 'u9' } }
    ]);
    expect(await Social.removeFriend(rpcClient(fail).client, 'u9')).toBe(false);
  });

  it('myInbox and myFriends read lists, null on failure', async () => {
    const inbox = { friend_requests: [{ id: 1, user_id: 'u', name: 'К', nickname: 'k', at: 't' }], board_invites: [] };
    expect(await Social.myInbox(rpcClient(ok(inbox)).client)).toEqual(inbox);
    expect(await Social.myInbox(rpcClient(fail).client)).toBeNull();
    const friends = [{ id: 'u', name: 'К', nickname: 'k', since: 't' }];
    expect(await Social.myFriends(rpcClient(ok(friends)).client)).toEqual(friends);
    expect(await Social.myFriends(rpcClient(fail).client)).toBeNull();
  });
});

describe('privacy wrappers', () => {
  it('setBoardVisibility and setPrivacy send every value', async () => {
    const r = rpcClient(ok());
    expect(await Social.setBoardVisibility(r.client, 'b1', 'friends')).toBe(true);
    expect(await Social.setPrivacy(r.client, { in_leaderboard: true, share_activity: false, share_matches: true, findable_by_nick: false })).toBe(true);
    expect(r.calls).toEqual([
      { name: 'set_board_visibility', args: { p_workspace: 'b1', p_visibility: 'friends' } },
      { name: 'set_privacy', args: { p_in_leaderboard: true, p_share_activity: false, p_share_matches: true, p_findable_by_nick: false } }
    ]);
    expect(await Social.setBoardVisibility(rpcClient(fail).client, 'b1', 'friends')).toBe(false);
  });

  it('myHiddenTitles lists rows, null on failure', async () => {
    const rows = [{ workspace_id: 'b1', id: 'x', title: 'X', category: 'movie', year: 2000, cover: null }];
    expect(await Social.myHiddenTitles(rpcClient(ok(rows)).client)).toEqual(rows);
    expect(await Social.myHiddenTitles(rpcClient(fail).client)).toBeNull();
  });
});

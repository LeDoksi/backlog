import { describe, expect, it } from 'vitest';
import * as Boards from '../../src/lib/boards';

function rpcClient(reply: (name: string, args: unknown) => unknown) {
  const calls: { name: string; args: unknown }[] = [];
  return {
    calls,
    client: { rpc(name: string, args?: unknown) { calls.push({ name, args }); return Promise.resolve(reply(name, args)); } }
  };
}
const ok = (data: unknown = null) => () => ({ data, error: null });

describe('board RPC wrappers', () => {
  it('findUserByNick returns the match or null', async () => {
    const hit = rpcClient(ok([{ id: 'u2', name: 'Даша', nickname: 'dasha' }]));
    expect(await Boards.findUserByNick(hit.client, '@Dasha ')).toEqual({ id: 'u2', name: 'Даша', nickname: 'dasha' });
    expect(hit.calls[0]).toEqual({ name: 'find_user_by_nick', args: { p_nickname: 'dasha' } });
    expect(await Boards.findUserByNick(rpcClient(ok([])).client, 'nobody')).toBeNull();
  });

  it('inviteToSharedBoard reports the server reason', async () => {
    const r = rpcClient(() => ({ data: null, error: { message: 'target_has_shared' } }));
    expect(await Boards.inviteToSharedBoard(r.client, 'u2')).toEqual({ ok: false, error: 'target_has_shared' });
    expect(r.calls[0]).toEqual({ name: 'invite_to_shared_board', args: { p_user: 'u2' } });
  });

  it('myBoardInvites lists incoming invites, empty on failure', async () => {
    const rows = [{ id: 1, from_id: 'u1', from_name: 'Г', from_nickname: 'g', created_at: 'x' }];
    expect(await Boards.myBoardInvites(rpcClient(ok(rows)).client)).toEqual(rows);
    expect(await Boards.myBoardInvites(null)).toEqual([]);
  });

  it('respondBoardInvite sends id and answer', async () => {
    const r = rpcClient(ok());
    expect(await Boards.respondBoardInvite(r.client, 7, true)).toEqual({ ok: true, error: null });
    expect(r.calls[0]).toEqual({ name: 'respond_board_invite', args: { p_id: 7, p_accept: true } });
  });

  it('leaveSharedBoard and removeBoardMember call their RPCs', async () => {
    const r = rpcClient(ok());
    await Boards.leaveSharedBoard(r.client);
    await Boards.removeBoardMember(r.client, 'u3');
    expect(r.calls).toEqual([
      { name: 'leave_shared_board', args: undefined },
      { name: 'remove_board_member', args: { p_user: 'u3' } }
    ]);
  });

  it('copyTitle maps duplicate', async () => {
    const r = rpcClient(() => ({ data: null, error: { message: 'duplicate' } }));
    expect(await Boards.copyTitle(r.client, 't1', 'b1', 'b2')).toEqual({ ok: false, error: 'duplicate' });
    expect(r.calls[0]).toEqual({ name: 'copy_title', args: { p_title_id: 't1', p_from: 'b1', p_to: 'b2' } });
  });
});

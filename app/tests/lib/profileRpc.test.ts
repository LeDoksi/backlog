import { describe, expect, it } from 'vitest';
import * as Auth from '../../src/lib/auth';

function rpcClient(reply: (name: string, args: unknown) => unknown) {
  const calls: { name: string; args: unknown }[] = [];
  const client = {
    rpc(name: string, args?: unknown) {
      calls.push({ name, args });
      return Promise.resolve(reply(name, args));
    }
  };
  return { client, calls };
}

describe('profile RPC wrappers', () => {
  it('completeSignup returns the status the server reported', async () => {
    const { client, calls } = rpcClient(() => ({ data: { status: 'created' }, error: null }));
    expect(await Auth.completeSignup(client)).toBe('created');
    expect(calls).toEqual([{ name: 'complete_signup', args: undefined }]);
  });

  it('completeSignup is null when the call fails, so a blip is not "not invited"', async () => {
    const { client } = rpcClient(() => ({ data: null, error: { message: 'offline' } }));
    expect(await Auth.completeSignup(client)).toBeNull();
    expect(await Auth.completeSignup(null)).toBeNull();
    expect(await Auth.completeSignup({ rpc() { throw new Error('boom'); } })).toBeNull();
  });

  it('nicknameAvailable passes the nickname and reads the boolean', async () => {
    const { client, calls } = rpcClient(() => ({ data: false, error: null }));
    expect(await Auth.nicknameAvailable(client, 'dasha')).toBe(false);
    expect(calls[0]).toEqual({ name: 'nickname_available', args: { p_nickname: 'dasha' } });
  });

  it('nicknameAvailable is null when unknown', async () => {
    const { client } = rpcClient(() => ({ data: null, error: { message: 'x' } }));
    expect(await Auth.nicknameAvailable(client, 'dasha')).toBeNull();
  });

  it('setProfile maps the server error codes', async () => {
    const { client, calls } = rpcClient(() => ({ data: null, error: { message: 'nickname_taken' } }));
    expect(await Auth.setProfile(client, 'Даша', 'dasha')).toEqual({ ok: false, error: 'nickname_taken' });
    expect(calls[0]).toEqual({ name: 'set_profile', args: { p_display_name: 'Даша', p_nickname: 'dasha' } });
    const ok = rpcClient(() => ({ data: null, error: null }));
    expect(await Auth.setProfile(ok.client, 'Даша', 'dasha')).toEqual({ ok: true, error: null });
  });

  it('setTheme sends the theme', async () => {
    const { client, calls } = rpcClient(() => ({ data: null, error: null }));
    expect(await Auth.setTheme(client, 'dark')).toBe(true);
    expect(calls[0]).toEqual({ name: 'set_theme', args: { p_theme: 'dark' } });
  });

  it('myProfile reads the profile object', async () => {
    const profile = { id: 'u', email: 'u@x', display_name: 'U', nickname: null, theme: 'system' };
    const { client } = rpcClient(() => ({ data: profile, error: null }));
    expect(await Auth.myProfile(client)).toEqual(profile);
  });

  it('myBoards returns rows, or null when the call fails', async () => {
    const rows = [{ id: 'b1', kind: 'personal', visibility: 'private', title_count: 3, members: [] }];
    expect(await Auth.myBoards(rpcClient(() => ({ data: rows, error: null })).client)).toEqual(rows);
    expect(await Auth.myBoards(rpcClient(() => ({ data: null, error: { message: 'x' } })).client)).toBeNull();
  });

  it('inviteEmail only grants access to the app now', async () => {
    const { client, calls } = rpcClient(() => ({ data: null, error: null }));
    expect((await Auth.inviteEmail(client, 'a@b.c')).error).toBeNull();
    expect(calls[0]).toEqual({ name: 'invite_email', args: { target_email: 'a@b.c' } });
  });
});

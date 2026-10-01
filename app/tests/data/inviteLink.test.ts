import { describe, expect, it } from 'vitest';
import { captureInvite, clearInvite, inviteMessage, inviteUrl, parseInviteHash, readInvite } from '../../src/data/inviteLink';

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, m };
}

describe('invite link', () => {
  it('parses #f/<token> and ignores anything else', () => {
    expect(parseInviteHash('#f/abc123xyz0')).toBe('abc123xyz0');
    expect(parseInviteHash('#f/ABC123XYZ0')).toBe('abc123xyz0');
    expect(parseInviteHash('#f/abc')).toBeNull();
    expect(parseInviteHash('#f/abc123xyz0/extra')).toBeNull();
    expect(parseInviteHash('#access_token=abc&refresh_token=x')).toBeNull();
    expect(parseInviteHash('')).toBeNull();
  });

  it('keeps the token until sign-in and takes it off the address', () => {
    const storage = memory();
    const replaced: string[] = [];
    const win = { location: { hash: '#f/abc123xyz0', pathname: '/backlog/', search: '' }, history: { replaceState: (_s: unknown, _t: string, url: string) => { replaced.push(url); } } };
    expect(captureInvite(win, storage)).toBe(true);
    expect(readInvite(storage)).toBe('abc123xyz0');
    expect(replaced).toEqual(['/backlog/']);
    clearInvite(storage);
    expect(readInvite(storage)).toBeNull();
  });

  it('leaves other addresses alone', () => {
    const storage = memory();
    const replaced: string[] = [];
    const win = { location: { hash: '#access_token=x', pathname: '/backlog/', search: '' }, history: { replaceState: () => { replaced.push('x'); } } };
    expect(captureInvite(win, storage)).toBe(false);
    expect(replaced).toEqual([]);
    expect(readInvite(storage)).toBeNull();
  });

  it('builds the address to share', () => {
    expect(inviteUrl('https://ledoksi.github.io', '/backlog/', 'abc123xyz0')).toBe('https://ledoksi.github.io/backlog/#f/abc123xyz0');
  });

  it('says what the link did', () => {
    expect(inviteMessage({ status: 'requested', from_name: 'Георгий' })).toBe('Георгий зовёт в друзья: заявка ждёт в «Друзьях»');
    expect(inviteMessage({ status: 'friends', from_name: 'Георгий' })).toBe('Георгий теперь в друзьях');
    expect(inviteMessage({ status: 'already_friends', from_name: 'Георгий' })).toBe('Георгий уже в друзьях');
    expect(inviteMessage({ status: 'expired' })).toBe('Ссылка-приглашение устарела. Попроси новую.');
    expect(inviteMessage({ status: 'self' })).toBe('Это твоя ссылка: отправь её другу');
  });
});

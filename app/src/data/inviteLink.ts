// A friend's link: `…/backlog/#f/<token>`. The token is kept from the moment
// the page opens until sign-in has used it, because signing in with Google
// leaves the page and comes back to a clean address.
import type { StorageLike } from '../lib/types';
import type { InviteOutcome } from '../lib/social';

const KEY = 'invite';
const HASH = /^#f\/([a-z0-9]{10})$/i;

export function parseInviteHash(hash: string): string | null {
  const m = HASH.exec(hash);
  return m ? m[1]!.toLowerCase() : null;
}

interface WinLike {
  location: { hash: string; pathname: string; search: string };
  history: { replaceState(state: unknown, title: string, url: string): void };
}

export function captureInvite(win: WinLike, storage: StorageLike): boolean {
  const token = parseInviteHash(win.location.hash);
  if (!token) return false;
  try { storage.setItem(KEY, token); } catch { /* private mode: the link then works only in this tab's session */ }
  win.history.replaceState(null, '', win.location.pathname + win.location.search);
  return true;
}

export function readInvite(storage: StorageLike): string | null {
  try { return storage.getItem(KEY); } catch { return null; }
}

export function clearInvite(storage: StorageLike): void {
  try { storage.removeItem?.(KEY); } catch { /* nothing to clear */ }
}

export function inviteUrl(origin: string, base: string, token: string): string {
  return `${origin}${base.replace(/\/?$/, '/')}#f/${token}`;
}

// Names are not declined ("от Георгия" would need a guess at the case).
export function inviteMessage(o: InviteOutcome): string {
  const name = o.from_name || 'Друг';
  switch (o.status) {
    case 'requested': return `${name} зовёт в друзья: заявка ждёт в «Друзьях»`;
    case 'friends': return `${name} теперь в друзьях`;
    case 'already_friends': return `${name} уже в друзьях`;
    case 'self': return 'Это твоя ссылка: отправь её другу';
    default: return 'Ссылка-приглашение устарела. Попроси новую.';
  }
}

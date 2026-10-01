import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabase } from './supabase';
import * as Auth from '../lib/auth';
import * as Social from '../lib/social';
import { clearInvite, inviteMessage, readInvite } from './inviteLink';
import { mirror } from './titlesStore';
import { useUi } from './ui';
import { applyTheme, readTheme, rememberTheme } from '../design/theme';

export type SessionState = 'loading' | 'signedOut' | 'blocked' | 'onboarding' | 'ready';

// `null` means the check itself failed (offline, a token refresh
// mid-flight). That is not evidence of "not invited", and treating it as such
// would bounce an invited user to a screen whose only button signs them out.
// Row-level security still guards the data, so letting them in is the safe
// side of the mistake.
export function resolveSessionState(x: {
  hasClient: boolean;
  userId: string | null;
  signup: Auth.SignupStatus | null;
  profile: Auth.Profile | null;
}): Exclude<SessionState, 'loading'> {
  if (!x.hasClient || !x.userId) return 'signedOut';
  if (x.signup === 'not_invited') return 'blocked';
  if (x.profile && !x.profile.nickname) return 'onboarding';
  return 'ready';
}

// Every profile starts at 'system', so before anyone picks a theme on the
// new profile the account knows nothing: a light or dark choice this device
// already made is kept and becomes the account's.
export function reconcileTheme(account: Auth.Theme, device: Auth.Theme): { apply: Auth.Theme; upload: boolean } {
  if (account === 'system' && device !== 'system') return { apply: device, upload: true };
  return { apply: account, upload: false };
}

// A starting point for the nickname field; the person can change it.
export function suggestNickname(email: string): string {
  const local = (email.split('@')[0] ?? '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);
  return /^[a-z0-9_]{3,20}$/.test(local) ? local : '';
}

export function useSession() {
  const [state, setState] = useState<SessionState>('loading');
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<Auth.Profile | null>(null);
  const [linkExpired, setLinkExpired] = useState(false);
  // Evaluations overlap (mount, INITIAL_SESSION, token refresh, sign-out);
  // only the latest one may write, or a slow earlier check could reopen the
  // app for someone who has just signed out.
  const latest = useRef(0);

  const evaluate = useCallback(async () => {
    const run = ++latest.current;
    const sb = getSupabase();
    if (!sb) { setState('signedOut'); return; }
    const res = await Auth.getSession(sb);
    const id = res?.data?.session?.user?.id ?? null;
    const mail = res?.data?.session?.user?.email ?? null;
    // Sets up profile, personal board and membership if any is missing, and
    // uses a friend's link the page was opened with.
    const token = id ? readInvite(mirror) : null;
    const done = id ? await Social.completeSignup(sb, token) : null;
    const signup = done ? done.status : null;
    // Kept until the server has answered, so a failed call retries it.
    if (token && done) clearInvite(mirror);
    const me = id && signup !== 'not_invited' ? await Auth.myProfile(sb) : null;
    if (run !== latest.current) return;
    setUserId(id);
    setEmail(mail);
    setProfile(me);
    setLinkExpired(signup === 'not_invited' && done?.invite?.status === 'expired');
    if (done?.invite && signup !== 'not_invited') useUi.getState().showToast(inviteMessage(done.invite));
    // The theme follows the account across devices; the local copy only
    // exists so the first paint does not flash.
    if (me && me.theme) {
      const theme = reconcileTheme(me.theme, readTheme());
      if (theme.upload) { void Auth.setTheme(sb, theme.apply); me.theme = theme.apply; }
      else if (theme.apply !== readTheme()) { rememberTheme(theme.apply); applyTheme(theme.apply); }
    }
    setState(resolveSessionState({ hasClient: true, userId: id, signup, profile: me }));
  }, []);

  useEffect(() => {
    void evaluate();
    const sub = Auth.onAuthStateChange(getSupabase(), (event) => {
      // A token refresh changes nothing about who is signed in.
      if (event === 'TOKEN_REFRESHED') return;
      void evaluate();
    });
    return () => sub.unsubscribe();
  }, [evaluate]);

  return {
    state,
    userId,
    email,
    profile,
    /** Sign-in came through a friend's link that has run out. */
    linkExpired,
    /** After the nickname screen or a profile edit. */
    setProfile: (p: Auth.Profile) => { setProfile(p); if (p.nickname) setState('ready'); },
    signIn: () => { void Auth.signInWithGoogle(getSupabase(), window.location.origin + import.meta.env.BASE_URL); },
    signOut: (): Promise<void> => Auth.signOut(getSupabase()).then(evaluate)
  };
}

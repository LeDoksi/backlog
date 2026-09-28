import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabase } from './supabase';
import * as Auth from '../lib/auth';

export type SessionState = 'loading' | 'signedOut' | 'blocked' | 'ready';

// `hasProfile: null` means the profile check itself failed (offline, a token
// refresh mid-flight). That is not evidence of "not invited", and treating it
// as such would bounce an invited user to a screen whose only button signs
// them out. Row-level security still guards the data, so letting them in is
// the safe side of the mistake.
export function resolveSessionState(x: { hasClient: boolean; userId: string | null; hasProfile: boolean | null }): Exclude<SessionState, 'loading'> {
  if (!x.hasClient || !x.userId) return 'signedOut';
  return x.hasProfile === false ? 'blocked' : 'ready';
}

async function checkProfile(sb: NonNullable<ReturnType<typeof getSupabase>>, userId: string): Promise<boolean | null> {
  try {
    const res = await sb.from('profiles').select('id').eq('id', userId).maybeSingle();
    if (res.error) return null;
    return !!res.data;
  } catch {
    return null;
  }
}

export function useSession() {
  const [state, setState] = useState<SessionState>('loading');
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
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
    const ok = id ? await checkProfile(sb, id) : false;
    if (run !== latest.current) return;
    setUserId(id);
    setEmail(mail);
    setState(resolveSessionState({ hasClient: true, userId: id, hasProfile: ok }));
  }, []);

  useEffect(() => {
    void evaluate();
    const sub = Auth.onAuthStateChange(getSupabase(), () => { void evaluate(); });
    return () => sub.unsubscribe();
  }, [evaluate]);

  return {
    state,
    userId,
    email,
    signIn: () => { void Auth.signInWithGoogle(getSupabase(), window.location.origin + import.meta.env.BASE_URL); },
    signOut: (): Promise<void> => Auth.signOut(getSupabase()).then(evaluate)
  };
}

import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from './supabase';
import * as Auth from '../lib/auth';

export type SessionState = 'loading' | 'signedOut' | 'blocked' | 'ready';

export function resolveSessionState(x: { hasClient: boolean; userId: string | null; hasProfile: boolean }): Exclude<SessionState, 'loading'> {
  if (!x.hasClient || !x.userId) return 'signedOut';
  return x.hasProfile ? 'ready' : 'blocked';
}

export function useSession() {
  const [state, setState] = useState<SessionState>('loading');
  const [userId, setUserId] = useState<string | null>(null);

  const evaluate = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) { setState('signedOut'); return; }
    const res = await Auth.getSession(sb);
    const id = res?.data?.session?.user?.id ?? null;
    setUserId(id);
    const ok = id ? await Auth.hasProfile(sb, id) : false;
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
    signIn: () => { void Auth.signInWithGoogle(getSupabase(), window.location.origin + import.meta.env.BASE_URL); },
    signOut: () => { void Auth.signOut(getSupabase()).then(evaluate); }
  };
}

import { mirror, outbox, useTitles } from './titlesStore';
import { useBoards } from './boardsStore';
import { getSupabase } from './supabase';

// Signing out must not leave one person's titles in the next person's
// mirror. Theme and filters are device settings and stay.
export function clearMirror(): void {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('bl2:titles:')) keys.push(k.slice('bl2:'.length));
    }
  } catch { /* storage unavailable: nothing was mirrored either */ }
  keys.forEach((k) => mirror.removeItem?.(k));
  outbox.clear();
  useBoards.getState().reset();
  useTitles.setState({ loading: true });
  useTitles.getState().refresh(true);
}

// The queue holds edits that never reached the cloud; clearing without one
// last try would drop them. Whatever still fails is lost, which the sign-out
// confirm warns about.
export async function flushQueue(): Promise<void> {
  if (getSupabase() && outbox.length()) await useTitles.getState().flush();
}

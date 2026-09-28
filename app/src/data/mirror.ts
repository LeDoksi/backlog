import * as Sync from '../lib/sync';
import { mirror } from './titlesStore';
import { getSupabase } from './supabase';

// Signing out, or leaving the shared space, must not leave one person's
// titles in the next person's mirror. Theme and filters are device settings
// and stay.
export function clearMirror(): void {
  [Sync.KEYS.overrides, Sync.KEYS.added, Sync.KEYS.parts, 'backlog-sync-outbox'].forEach((k) => mirror.removeItem?.(k));
}

// The queue holds edits that never reached the cloud; clearing without one
// last try would drop them. Whatever still fails is lost, which the sign-out
// confirm warns about.
export async function flushQueue(): Promise<void> {
  const client = getSupabase();
  if (client && Sync.outboxLength()) await Sync.flushOutbox(client);
}

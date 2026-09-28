import * as Sync from '../lib/sync';
import { mirror } from './titlesStore';

// Signing out, or leaving the shared space, must not leave one person's
// titles in the next person's mirror. Theme and filters are device settings
// and stay.
export function clearMirror(): void {
  [Sync.KEYS.overrides, Sync.KEYS.added, Sync.KEYS.parts, 'backlog-sync-outbox'].forEach((k) => mirror.removeItem?.(k));
}

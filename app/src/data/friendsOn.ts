// Which friends have a title, matched the way the server does: by the
// provider id when there is one, else by the board's slug id.
import type { FriendOn, Match } from '../lib/social';
import type { ShelfTab } from './feedFormat';

export function titleKey(t: { id: string; source?: string | null; sourceId?: string | null }): string {
  return t.source && t.sourceId ? `${t.source}:${t.sourceId}` : `slug:${t.id}`;
}

const RANK: Record<string, number> = { in_progress: 0, queue: 1, unreleased: 1, done: 2 };

/** Friends on one title, the one watching it first, then wanting, then finished. */
export function byPriority(list: FriendOn[] | undefined): FriendOn[] {
  return [...(list ?? [])].sort((a, b) => (RANK[a.status] ?? 3) - (RANK[b.status] ?? 3) || a.friend_name.localeCompare(b.friend_name, 'ru'));
}

export function groupByKey(rows: FriendOn[]): Record<string, FriendOn[]> {
  const out: Record<string, FriendOn[]> = {};
  rows.forEach((r) => { (out[r.title_key] ??= []).push(r); });
  return out;
}

export function statusWord(status: string, category: string): string {
  if (status === 'done') return 'завершено';
  if (status === 'in_progress') return category === 'game' ? 'играет' : 'смотрит';
  return 'хочет';
}

export function tabForStatus(status: string): ShelfTab {
  if (status === 'done') return 'done';
  return status === 'in_progress' ? 'watching' : 'want';
}

/** One title in Matches, with every friend it matched (spec 1.4). */
export interface MatchGroup {
  title_key: string; title: string; category: string; cover: string | null; my_status: string;
  friends: { id: string; name: string; status: string }[];
}

/** Groups in the order their titles first came; inside, the one watching first, then wanting. */
export function groupMatches(rows: Match[]): MatchGroup[] {
  const byKey = new Map<string, MatchGroup>();
  rows.forEach((m) => {
    let g = byKey.get(m.title_key);
    if (!g) {
      g = { title_key: m.title_key, title: m.title, category: m.category, cover: m.cover, my_status: m.my_status, friends: [] };
      byKey.set(m.title_key, g);
    }
    if (!g.friends.some((f) => f.id === m.friend_id)) g.friends.push({ id: m.friend_id, name: m.friend_name, status: m.friend_status });
  });
  return [...byKey.values()].map((g) => ({
    ...g,
    friends: byPriority(g.friends.map((f) => ({ title_key: g.title_key, friend_id: f.id, friend_name: f.name, status: f.status })))
      .map((f) => ({ id: f.friend_id, name: f.friend_name, status: f.status }))
  }));
}

/** «Вадим смотрит, Лёша хочет»; «Ты и Вадим оба смотрите» when it is just the two of us at it. */
export function matchGroupText(g: MatchGroup): string {
  const only = g.friends.length === 1 ? g.friends[0]! : null;
  if (only && only.status === 'in_progress' && g.my_status === 'in_progress') {
    return `Ты и ${only.name} оба ${g.category === 'game' ? 'играете' : 'смотрите'}`;
  }
  return g.friends.map((f) => `${f.name} ${statusWord(f.status, g.category)}`).join(', ');
}

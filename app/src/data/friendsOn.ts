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

// Names stay in the nominative: "Ты и Вадим", not "Вы с Вадимом".
export function matchText(m: Match): string {
  const doing = m.category === 'game' ? 'играете в' : 'смотрите';
  const doesIt = m.category === 'game' ? 'играет в' : 'смотрит';
  const youDo = m.category === 'game' ? 'играешь' : 'смотришь';
  if (m.my_status === 'in_progress' && m.friend_status === 'in_progress') return `Ты и ${m.friend_name} оба ${doing} «${m.title}»`;
  if (m.friend_status === 'in_progress') return `${m.friend_name} уже ${doesIt} «${m.title}»`;
  if (m.my_status === 'in_progress') return `${m.friend_name} хочет «${m.title}», а ты уже ${youDo}`;
  return `Ты и ${m.friend_name} оба хотите «${m.title}»`;
}

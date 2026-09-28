import { isCaughtUp } from '../lib/storage';
import { pickRandom } from '../lib/query';
import type { Category, Title } from '../lib/types';

// Only what can be started right now: not finished, not unannounced, not a
// game (nobody "watches" one tonight), and not a show whose every released
// part is already watched while more is still coming.
export function randomCandidates(titles: Title[], category: 'all' | Category, checked: (id: string) => number[]): Title[] {
  return titles.filter((t) =>
    (category === 'all' || t.category === category) &&
    t.category !== 'game' && t.status !== 'done' && t.status !== 'unreleased' &&
    !isCaughtUp(t, checked(t.id)));
}

export function pickNext(titles: Title[], category: 'all' | Category, checked: (id: string) => number[]): Title | null {
  return pickRandom(randomCandidates(titles, category, checked)) ?? null;
}

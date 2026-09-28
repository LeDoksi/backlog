import { hasPartsChecklist, isCaughtUp, partsProgress } from '../lib/storage';
import type { Category, Title } from '../lib/types';

export interface Stats {
  done: number;
  total: number;
  inProgress: number;
  queue: number;
  waiting: number;
  byCategory: Record<Category, { done: number; seasons?: number }>;
  genres: { genre: string; count: number }[];
  recentDone: Title[];
}

// Series and anime are counted in seasons, since a long show is many evenings
// and one "done" would undersell it. A finished show without a parts list
// still counts as one season rather than vanishing from the tile.
export function computeStats(titles: Title[], checked: (id: string) => number[]): Stats {
  const byCategory: Stats['byCategory'] = { movie: { done: 0 }, series: { done: 0, seasons: 0 }, anime: { done: 0, seasons: 0 }, game: { done: 0 } };
  const genreMap = new Map<string, number>();
  let done = 0, inProgress = 0, waiting = 0;
  titles.forEach((t) => {
    if (t.status === 'done') {
      done += 1;
      byCategory[t.category].done += 1;
      t.genres.forEach((g) => genreMap.set(g, (genreMap.get(g) ?? 0) + 1));
    }
    if (t.status === 'in_progress') inProgress += 1;
    if (isCaughtUp(t, checked(t.id))) waiting += 1;
    if (t.category === 'series' || t.category === 'anime') {
      const seasons = hasPartsChecklist(t) ? partsProgress(t.parts, checked(t.id)).watched : t.status === 'done' ? 1 : 0;
      byCategory[t.category].seasons! += seasons;
    }
  });
  const genres = [...genreMap].map(([genre, count]) => ({ genre, count })).sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre, 'ru'));
  const queue = titles.filter((t) => t.status === 'queue').length;
  // Without completion dates "recent" is the latest added of the finished ones.
  const recentDone = titles.filter((t) => t.status === 'done').slice(-3).reverse();
  return { done, total: titles.length, inProgress, queue, waiting, byCategory, genres, recentDone };
}

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
      (t.genres ?? []).forEach((g) => genreMap.set(g, (genreMap.get(g) ?? 0) + 1));
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
  return { done, total: titles.length, inProgress, queue, waiting, byCategory, genres };
}

/** `n` finished titles with a real cover, drawn at random so each visit shows a new set. */
export function showcase(titles: Title[], n: number, rand: () => number = Math.random): Title[] {
  const pool = titles.filter((t) => t.status === 'done' && t.cover && !t.cover.includes('_placeholder'));
  // Partial Fisher–Yates: only the first n places need shuffling.
  for (let i = 0; i < Math.min(n, pool.length); i++) {
    const j = i + Math.floor(rand() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, n);
}

export type Period = 'month' | 'year' | 'all';
type Ticks = (id: string) => Record<string, string>;

export interface PeriodStats {
  label: string;
  done: number;
  /** Finished in the period before; null for all time. */
  previous: number | null;
  byCategory: Stats['byCategory'];
  genres: Stats['genres'];
  /** Finished in this period, for the poster fan. */
  finished: Title[];
}

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

// Calendar periods in the device's own time zone: [from, to).
function range(period: 'month' | 'year', now: Date, back = 0): [number, number] {
  if (period === 'month') return [new Date(now.getFullYear(), now.getMonth() - back, 1).getTime(), new Date(now.getFullYear(), now.getMonth() - back + 1, 1).getTime()];
  return [new Date(now.getFullYear() - back, 0, 1).getTime(), new Date(now.getFullYear() - back + 1, 0, 1).getTime()];
}

const within = (iso: string | null | undefined, [from, to]: [number, number]) => {
  if (!iso) return false;
  const t = Date.parse(iso);
  return t >= from && t < to;
};

const finishedIn = (titles: Title[], r: [number, number]) => titles.filter((t) => t.status === 'done' && within(t.completedAt, r));

// A month or a year counts by dates: titles by completed_at and seasons by
// the day each was ticked. Titles migrated without dates count only for all
// time, since when they were finished is unknown.
export function periodStats(titles: Title[], ticks: Ticks, period: Period, now: Date = new Date()): PeriodStats {
  if (period === 'all') {
    const all = computeStats(titles, (id) => Object.keys(ticks(id)).filter((k) => /^\d+$/.test(k)).map(Number));
    return { label: 'За всё время', done: all.done, previous: null, byCategory: all.byCategory, genres: all.genres, finished: titles.filter((t) => t.status === 'done') };
  }
  const r = range(period, now);
  const finished = finishedIn(titles, r);
  const byCategory: Stats['byCategory'] = { movie: { done: 0 }, series: { done: 0, seasons: 0 }, anime: { done: 0, seasons: 0 }, game: { done: 0 } };
  const genreMap = new Map<string, number>();
  finished.forEach((t) => {
    byCategory[t.category].done += 1;
    (t.genres ?? []).forEach((g) => genreMap.set(g, (genreMap.get(g) ?? 0) + 1));
  });
  titles.forEach((t) => {
    if (t.category !== 'series' && t.category !== 'anime') return;
    byCategory[t.category].seasons! += hasPartsChecklist(t)
      ? Object.values(ticks(t.id)).filter((d) => within(d, r)).length
      : finished.includes(t) ? 1 : 0;
  });
  const genres = [...genreMap].map(([genre, count]) => ({ genre, count })).sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre, 'ru'));
  return {
    label: period === 'month' ? MONTHS[now.getMonth()]! : String(now.getFullYear()),
    done: finished.length,
    previous: finishedIn(titles, range(period, now, 1)).length,
    byCategory,
    genres,
    finished
  };
}

export function comparison(p: { done: number; previous: number | null }, period: Period): string | null {
  if (p.previous === null || period === 'all') return null;
  const when = period === 'month' ? 'в прошлом месяце' : 'в прошлом году';
  const diff = p.done - p.previous;
  if (diff === 0) return `Столько же, сколько ${when}`;
  return `На ${Math.abs(diff)} ${diff > 0 ? 'больше' : 'меньше'}, чем ${when}`;
}

/** The month when anything was finished or ticked in it, otherwise all time. */
export function defaultPeriod(titles: Title[], ticks: Ticks, now: Date = new Date()): Period {
  const m = periodStats(titles, ticks, 'month', now);
  return m.done > 0 || (m.byCategory.series.seasons ?? 0) + (m.byCategory.anime.seasons ?? 0) > 0 ? 'month' : 'all';
}

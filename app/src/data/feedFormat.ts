// Feed lines as text. The verb's gender cannot be told from a name, so the
// lines are written without one: «Лёша · завершено «Драйв»».
import { plural } from './labels';

export type FeedKind = 'added' | 'started' | 'completed' | 'parts';
export interface FeedRow {
  actor_id: string;
  actor_name: string;
  kind: FeedKind;
  title_id: string;
  workspace_id: string;
  title: string;
  category: string;
  cover: string | null;
  count: number;
  /** A line of several titles: their covers, newest first; `null` where a title has none. */
  covers: (string | null)[] | null;
  at: string;
  on_shared_board: boolean;
  /** A completion's rating at the time the feed was read. */
  rating?: number | null;
  /** A line of several titles: the title behind each of `covers`, in the same order. */
  title_ids?: string[] | null;
}
export type ShelfTab = 'done' | 'watching' | 'want';

export function feedText(r: FeedRow): string {
  switch (r.kind) {
    case 'completed':
      if (r.count > 1) return batchText('completed', r.count);
      return r.rating ? `завершено «${r.title}» · оценка ${r.rating}/10` : `завершено «${r.title}»`;
    case 'started': return r.count > 1 ? batchText('started', r.count) : `начато «${r.title}»`;
    case 'parts': {
      const seasons = r.category === 'series' || r.category === 'anime';
      const unit = seasons ? plural(r.count, 'сезон', 'сезона', 'сезонов') : plural(r.count, 'часть', 'части', 'частей');
      return `${r.category === 'game' ? 'пройдено' : 'просмотрено'} ${r.count} ${unit} «${r.title}»`;
    }
    case 'added':
      return r.count > 1 ? batchText('added', r.count) : `добавлено «${r.title}»`;
  }
}

export type BatchKind = Exclude<FeedKind, 'parts'>;
const BATCH_VERB: Record<BatchKind, string> = { added: 'добавлено', started: 'начато', completed: 'завершено' };

/** A line of several titles of one kind: «начато 3 тайтла». */
export function batchText(kind: BatchKind, count: number): string {
  return `${BATCH_VERB[kind]} ${count} ${plural(count, 'тайтл', 'тайтла', 'тайтлов')}`;
}

/** A line that stands for several titles and opens them as a list. */
export function isBatch(r: FeedRow): r is FeedRow & { kind: BatchKind } {
  return r.kind !== 'parts' && r.count > 1;
}

// One busy friend should not fill the feed: whatever one person started,
// completed or added on one calendar day (by this device's clock) becomes
// one line, at the place of the day's latest event. Seasons stay one line
// per title. Rows come newest first and stay in that order.
export function collapseFeed(rows: FeedRow[]): FeedRow[] {
  const days = new Map<string, FeedRow[]>();
  const keyOf = (r: FeedRow) => {
    if (r.kind === 'parts' || !r.at) return null;
    const d = new Date(r.at);
    return `${r.actor_id}|${r.kind}|${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };
  rows.forEach((r) => {
    const k = keyOf(r);
    if (!k) return;
    const day = days.get(k);
    if (day) day.push(r); else days.set(k, [r]);
  });
  const out: FeedRow[] = [];
  rows.forEach((r) => {
    const k = keyOf(r);
    const day = k ? days.get(k)! : [r];
    if (day.length === 1) { out.push(r); return; }
    if (day[0] !== r) return;
    const covers: (string | null)[] = [];
    const ids: string[] = [];
    day.forEach((e) => {
      if (e.kind === 'added') {
        // An additions line from the server lists only the titles that have a cover.
        (e.title_ids ?? (e.count === 1 ? [e.title_id] : [])).forEach((id, i) => { ids.push(id); covers.push(e.covers?.[i] ?? null); });
      } else {
        ids.push(e.title_id);
        covers.push(e.cover);
      }
    });
    out.push({
      ...r,
      count: day.reduce((n, e) => n + (e.kind === 'added' ? e.count : 1), 0),
      covers, title_ids: ids, rating: null,
      on_shared_board: day.every((e) => e.on_shared_board)
    });
  });
  return out;
}

const DAY = 24 * 60 * 60 * 1000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// Days back from today by the calendar, not by 24-hour spans.
function daysAgo(at: string, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(new Date(at))) / DAY);
}

export function feedGroup(at: string, now = new Date()): 'Сегодня' | 'На этой неделе' | 'Раньше' {
  const d = daysAgo(at, now);
  if (d <= 0) return 'Сегодня';
  return d < 7 ? 'На этой неделе' : 'Раньше';
}

export function feedWhen(at: string, now = new Date()): string {
  const t = new Date(at);
  const d = daysAgo(at, now);
  if (d <= 0) return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  if (d < 7) return WEEKDAYS[t.getDay()]!;
  return `${t.getDate()} ${MONTHS[t.getMonth()]}`;
}

export function groupFeed(rows: FeedRow[], now = new Date()): { label: string; rows: FeedRow[] }[] {
  const groups: { label: string; rows: FeedRow[] }[] = [];
  rows.forEach((r) => {
    const label = feedGroup(r.at, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(r); else groups.push({ label, rows: [r] });
  });
  return groups;
}

export function shelfTabFor(kind: FeedKind): ShelfTab {
  if (kind === 'completed') return 'done';
  return kind === 'added' ? 'want' : 'watching';
}

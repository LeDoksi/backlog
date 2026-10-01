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
  covers: string[] | null;
  at: string;
  on_shared_board: boolean;
}
export type ShelfTab = 'done' | 'watching' | 'want';

export function feedText(r: FeedRow): string {
  switch (r.kind) {
    case 'completed': return `завершено «${r.title}»`;
    case 'started': return `начато «${r.title}»`;
    case 'parts': {
      const seasons = r.category === 'series' || r.category === 'anime';
      const unit = seasons ? plural(r.count, 'сезон', 'сезона', 'сезонов') : plural(r.count, 'часть', 'части', 'частей');
      return `${r.count} ${unit} «${r.title}»`;
    }
    case 'added':
      return r.count > 1 ? `+${r.count} ${plural(r.count, 'тайтл', 'тайтла', 'тайтлов')}` : `добавлено «${r.title}»`;
  }
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

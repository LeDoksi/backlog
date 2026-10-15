// Feed lines as text. The verb's gender cannot be told from a name, so the
// lines are written without one: «Лёша · завершено «Драйв»».
import { plural } from './labels';

export type EventKind = 'added' | 'started' | 'completed' | 'parts';
/** `day`: everything one friend did on one day, folded into one line. */
export type FeedKind = EventKind | 'day';

/** One thing done to a title on a folded day; `count` is the parts ticked. */
export interface DayAction { kind: EventKind; count: number }
/** A title on a folded day, newest first, with what was done to it. */
export interface DayEntry { title_id: string; title: string; category: string; cover: string | null; actions: DayAction[] }

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
  /** A folded day: its titles, and the text of the line. */
  entries?: DayEntry[];
  summary?: string;
  /** A folded day: the kind of its latest event, for the friend's shelf. */
  latest?: EventKind;
}
export type ShelfTab = 'done' | 'watching' | 'want';

const titles = (n: number) => plural(n, 'тайтл', 'тайтла', 'тайтлов');
const isSeasons = (category: string) => category === 'series' || category === 'anime';
const partsVerb = (category: string) => category === 'game' ? 'пройдено' : 'просмотрено';
const partsUnit = (category: string, n: number) =>
  isSeasons(category) ? plural(n, 'сезон', 'сезона', 'сезонов') : plural(n, 'часть', 'части', 'частей');

export function feedText(r: FeedRow): string {
  switch (r.kind) {
    case 'day': return r.summary ?? '';
    case 'completed':
      if (r.count > 1) return batchText('completed', r.count);
      return r.rating ? `завершено «${r.title}» · оценка ${r.rating}/10` : `завершено «${r.title}»`;
    case 'started': return r.count > 1 ? batchText('started', r.count) : `начато «${r.title}»`;
    case 'parts': return `${partsVerb(r.category)} ${r.count} ${partsUnit(r.category, r.count)} «${r.title}»`;
    case 'added':
      return r.count > 1 ? batchText('added', r.count) : `добавлено «${r.title}»`;
  }
}

export type BatchKind = 'added' | 'started' | 'completed';
const BATCH_VERB: Record<BatchKind, string> = { added: 'добавлено', started: 'начато', completed: 'завершено' };

/** A line of several titles of one kind: «начато 3 тайтла». */
export function batchText(kind: BatchKind, count: number): string {
  return `${BATCH_VERB[kind]} ${count} ${titles(count)}`;
}

/** A line that stands for several titles and opens them as a list. */
export function isBatch(r: FeedRow): boolean {
  return r.kind === 'day' || (r.kind === 'added' && r.count > 1);
}

/** What the list panel behind a line of several titles needs. */
export interface FeedBatch {
  owner: string; name: string; ids: string[];
  /** The panel's heading after the name: «начато 3 тайтла». */
  heading: string;
  /** What was done to each title, by id, when the line is a folded day. */
  actions?: Record<string, DayAction[]>;
  /** The friend's shelf one tap away; `mixed` when the day spans several. */
  tab: ShelfTab; mixed?: boolean;
}

export function batchFor(r: FeedRow): FeedBatch {
  const base = { owner: r.actor_id, name: r.actor_name, ids: r.title_ids ?? [] };
  if (r.kind !== 'day' || !r.entries) return { ...base, heading: batchText('added', r.count), tab: 'want' };
  const tabs = new Set(r.entries.flatMap((e) => e.actions.map((a) => shelfTabFor(a.kind))));
  return {
    ...base, heading: r.summary ?? '',
    actions: Object.fromEntries(r.entries.map((e) => [e.title_id, e.actions])),
    tab: shelfTabFor(r.latest ?? 'added'), mixed: tabs.size > 1
  };
}

/** The bits of a friend's title that say what a folded day's actions were. */
export interface ActionTitle { category: string; parts: { extra?: boolean }[] | null; checked: number[]; rating: number | null }

const ACTION_ORDER: EventKind[] = ['added', 'started', 'parts', 'completed'];

// The line under a title in a folded day's list: «Начато · просмотрены
// сезоны 2, 3». The feed only knows how many parts were ticked that day, so
// their numbers are taken as the last ones ticked, counting main parts only;
// when that does not add up, the count is said instead.
export function actionsText(actions: DayAction[], t: ActionTitle): string {
  const out = [...actions].sort((a, b) => ACTION_ORDER.indexOf(a.kind) - ACTION_ORDER.indexOf(b.kind)).map((a) => {
    switch (a.kind) {
      case 'added': return 'добавлено';
      case 'started': return 'начато';
      case 'completed': return t.rating ? `завершено, оценка ${t.rating}/10` : 'завершено';
      case 'parts': {
        const main = (t.parts ?? []).flatMap((p, i) => p.extra ? [] : [i]);
        const ticked = main.filter((i) => t.checked.includes(i));
        if (ticked.length < a.count) return `${partsVerb(t.category)} ${a.count} ${partsUnit(t.category, a.count)}`;
        const nums = ticked.slice(-a.count).map((i) => main.indexOf(i) + 1).join(', ');
        const one = a.count === 1;
        const verb = t.category === 'game' ? (one ? 'пройден' : 'пройдены') : (one ? 'просмотрен' : 'просмотрены');
        if (isSeasons(t.category)) return `${verb} ${one ? 'сезон' : 'сезоны'} ${nums}`;
        return `${one ? verb + 'а' : verb} ${one ? 'часть' : 'части'} ${nums}`;
      }
    }
  }).join(' · ');
  return out.charAt(0).toUpperCase() + out.slice(1);
}

// «начато 2 тайтла, просмотрено 5 сезонов». Titles count once per kind;
// parts add up, seasons apart from other parts. Additions are counted by
// the caller: the server lists only those with a cover.
function daySummary(entries: DayEntry[], added: number): string {
  const n = { started: 0, completed: 0, added };
  const parts = new Map<string, { verb: string; seasons: boolean; count: number }>();
  entries.forEach((e) => e.actions.forEach((a) => {
    if (a.kind === 'added') return;
    if (a.kind !== 'parts') { n[a.kind] += a.count; return; }
    const key = `${partsVerb(e.category)}|${isSeasons(e.category)}`;
    const p = parts.get(key) ?? { verb: partsVerb(e.category), seasons: isSeasons(e.category), count: 0 };
    p.count += a.count;
    parts.set(key, p);
  }));
  const out: string[] = [];
  if (n.started) out.push(batchText('started', n.started));
  if (n.completed) out.push(batchText('completed', n.completed));
  parts.forEach((p) => out.push(`${p.verb} ${p.count} ${p.seasons ? plural(p.count, 'сезон', 'сезона', 'сезонов') : plural(p.count, 'часть', 'части', 'частей')}`));
  if (n.added) out.push(batchText('added', n.added));
  return out.join(', ');
}

// One busy friend should not fill the feed: everything one person did on
// one calendar day (by this device's clock) becomes one line, at the place
// of the day's latest event. A day with a single line stays that line.
// Rows come newest first and stay in that order.
export function collapseFeed(rows: FeedRow[]): FeedRow[] {
  const days = new Map<string, FeedRow[]>();
  const keyOf = (r: FeedRow) => {
    if (!r.at || r.kind === 'day') return null;
    const d = new Date(r.at);
    return `${r.actor_id}|${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
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
    const byTitle = new Map<string, DayEntry>();
    const act = (e: FeedRow, id: string, cover: string | null, a: DayAction, title = e.title, category = e.category) => {
      const entry = byTitle.get(id) ?? { title_id: id, title, category, cover, actions: [] };
      entry.cover ??= cover;
      const same = entry.actions.find((x) => x.kind === a.kind);
      if (same) same.count += a.count; else entry.actions.push(a);
      byTitle.set(id, entry);
    };
    let added = 0;
    day.forEach((e) => {
      if (e.kind === 'day') return;
      if (e.kind === 'added') {
        added += e.count;
        const ids = e.title_ids ?? (e.count === 1 ? [e.title_id] : []);
        ids.forEach((id, i) => act(e, id, e.covers?.[i] ?? null, { kind: 'added', count: 1 }, id === e.title_id ? e.title : '', e.category));
      } else {
        act(e, e.title_id, e.cover, { kind: e.kind, count: e.kind === 'parts' ? e.count : 1 });
      }
    });
    const entries = [...byTitle.values()];
    const summary = daySummary(entries, added);
    out.push({
      ...r, kind: 'day',
      count: entries.length,
      covers: entries.map((e) => e.cover), title_ids: entries.map((e) => e.title_id), rating: null,
      entries, summary, latest: r.kind as EventKind,
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

export function shelfTabFor(kind: EventKind): ShelfTab {
  if (kind === 'completed') return 'done';
  return kind === 'added' ? 'want' : 'watching';
}

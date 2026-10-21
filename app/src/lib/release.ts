// release.ts — when a film or game comes out (spec 2026-10-21 part 2,
// BL-117), with no network: the sources' raw answers in, dates and «out or
// not» out, and what the card and the «Вышло» note say about it.
//
// Live answers (tests/fixtures/live, 2026-10-21): TMDb's `status` says
// «Released» for films out in one country only or not out anywhere yet, so
// only dates count. A film's release is its first theatrical release in any
// country (types 2 and 3; many films have no Russian date at all); digital
// dates (type 4) are often missing, hence the 90 days.
import type { Category, Status, Title } from './types';

/** Dates are `YYYY-MM-DD`. `digital` is a film's first digital release. */
export interface Release { date: string | null; digital: string | null; out: boolean }

const DAY = (s: unknown) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
const earliest = (list: (string | null)[]) => list.filter((d): d is string => !!d).sort()[0] ?? null;

/** TMDb `/movie/{id}?append_to_response=release_dates`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function movieRelease(d: any, today: string): Release {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: { type: number; date: string | null }[] = (Array.isArray(d?.release_dates?.results) ? d.release_dates.results : []).flatMap((c: any) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Array.isArray(c?.release_dates) ? c.release_dates : []).map((r: any) => ({ type: Number(r?.type), date: DAY(r?.release_date) })));
  const date = earliest(all.filter((r) => r.type === 2 || r.type === 3).map((r) => r.date)) ?? DAY(d?.release_date);
  const digital = earliest(all.filter((r) => r.type === 4).map((r) => r.date));
  return { date, digital, out: !!date && date <= today };
}

const MONTHS: [RegExp, number][] = [
  [/^(янв|jan)/, 1], [/^(фев|feb)/, 2], [/^(мар|mar)/, 3], [/^(апр|apr)/, 4], [/^(ма[йя]|may)/, 5], [/^(июн|jun)/, 6],
  [/^(июл|jul)/, 7], [/^(авг|aug)/, 8], [/^(сен|sep)/, 9], [/^(окт|oct)/, 10], [/^(ноя|nov)/, 11], [/^(дек|dec)/, 12]
];
const monthOf = (word: string) => MONTHS.find(([re]) => re.test(word.toLowerCase()))?.[1] ?? null;
const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * Steam's `release_date.date` with `l=russian`: «22 окт. 2026 г.», «14 мая.
 * 2026 г.»; English «Sep 4, 2025» or «4 Sep, 2025» too. A month, a quarter,
 * a year or words alone («Скоро выйдет») are no day: null.
 */
export function parseSteamDate(s: string | null | undefined): string | null {
  const text = (s ?? '').trim();
  let m = /^(\d{1,2})\s+([a-zа-яё]+)\.?,?\s+(\d{4})/i.exec(text);
  if (m && monthOf(m[2]!)) return ymd(Number(m[3]), monthOf(m[2]!)!, Number(m[1]));
  m = /^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/i.exec(text);
  if (m && monthOf(m[1]!)) return ymd(Number(m[3]), monthOf(m[1]!)!, Number(m[2]));
  return null;
}

/** Steam `appdetails` data: out once Steam stops saying «coming soon» and the day, when known, has come. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function steamRelease(d: any, today: string): Release {
  const soon = d?.release_date?.coming_soon === true;
  const date = parseSteamDate(d?.release_date?.date);
  return { date, digital: null, out: !soon && (!date || date <= today) };
}

/** RAWG game details: out when dated, not TBA, and the day has come. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rawgRelease(d: any, today: string): Release {
  const date = DAY(d?.released);
  return { date, digital: null, out: d?.tba !== true && !!date && date <= today };
}

/**
 * Out, or dated nowhere but known from an earlier year: an old film or
 * game a source keeps no date for is not «not out yet».
 */
export function isOut(rel: Release, year: number | null | undefined, today: string): boolean {
  return rel.out || (!rel.date && year != null && year < Number(today.slice(0, 4)));
}

/** The badge goes only on «В очереди», and only the badge comes off: started or finished stays. */
export function releaseStatus(status: Status, out: boolean): Status {
  if (!out && status === 'queue') return 'unreleased';
  if (out && status === 'unreleased') return 'queue';
  return status;
}

const SEARCH_SOURCES = ['tmdb-movie', 'tmdb-series', 'shikimori', 'steam', 'rawg'];

/** A card added from search: its face comes from its source. */
export function isSearchCard(t: { source?: string | null; sourceId?: string | null }): boolean {
  return !!t.source && !!t.sourceId && SEARCH_SOURCES.includes(t.source);
}

const daysFrom = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

export const IN_CINEMA = 'Сейчас в кино';
export const OUT_DIGITAL = 'Вышло в цифре';
/** Without a digital date a film reads «в кино» this long after its premiere. */
export const CINEMA_DAYS = 90;
export const DIGITAL_DAYS = 30;

/** The line under a film's name: in cinemas until the digital release, then «Вышло в цифре» for 30 days. */
export function cinemaLabel(t: { category: Category; releaseDate?: string | null; digitalDate?: string | null }, today: string): string | null {
  if (t.category !== 'movie' || !t.releaseDate || t.releaseDate > today) return null;
  if (t.digitalDate && t.digitalDate <= today) return daysFrom(t.digitalDate, today) < DIGITAL_DAYS ? OUT_DIGITAL : null;
  if (t.digitalDate) return IN_CINEMA;
  return daysFrom(t.releaseDate, today) < CINEMA_DAYS ? IN_CINEMA : null;
}

/** The local calendar day of `d`. */
export const localDay = (d: Date) => ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());

export interface ReleaseEvent { id: string; title: string; kind: 'cinema' | 'digital' | 'game' }

/**
 * What came out after `seenDay` up to `today`, on titles added before it
 * did and not finished: someone who added a film after its premiere, or
 * has seen it, needs no note.
 */
export function releaseEvents(titles: Title[], seenDay: string, today: string): ReleaseEvent[] {
  const fresh = (date: string | null | undefined, t: Title) => !!date && date > seenDay && date <= today && (t.createdAt ?? '').slice(0, 10) < date;
  const out: ReleaseEvent[] = [];
  titles.forEach((t) => {
    if (t.status === 'done') return;
    if (t.category === 'movie') {
      if (fresh(t.releaseDate, t)) out.push({ id: t.id, title: t.title, kind: 'cinema' });
      else if (fresh(t.digitalDate, t)) out.push({ id: t.id, title: t.title, kind: 'digital' });
    } else if (t.category === 'game' && fresh(t.releaseDate, t)) out.push({ id: t.id, title: t.title, kind: 'game' });
  });
  return out;
}

const PREFIX: Record<ReleaseEvent['kind'], string> = { cinema: 'Вышло в кино', digital: 'Вышло в цифре', game: 'Вышло' };

/** The note: one title by its kind (and it opens), several as «Вышло: X и ещё N». */
export function releaseToast(events: ReleaseEvent[]): { text: string; id: string | null } | null {
  if (!events.length) return null;
  const [first] = events;
  if (events.length === 1) return { text: `${PREFIX[first!.kind]}: ${first!.title}`, id: first!.id };
  return { text: `Вышло: ${first!.title} и ещё ${events.length - 1}`, id: null };
}

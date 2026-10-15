// franchise.ts — provider answers (TMDb seasons, a Shikimori franchise) as
// parts of one title (spec 2.1–2.3). No network: lib/enrich.ts fetches.
import type { Franchise, FranchiseNode, TmdbSeason } from './enrich';
import type { FreshPart } from './refresh';
import type { Part } from './types';
import { plural } from './plural';

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * TMDb seasons in order, «Спецматериалы» (season 0) at the end as an extra.
 * A season with no date, or a date still ahead, is not out yet.
 */
export function partsFromTmdb(seasons: TmdbSeason[], today: Date): FreshPart[] {
  const t = day(today);
  const part = (s: TmdbSeason): FreshPart => {
    const out: FreshPart = {
      name: s.number > 0 && (!s.name || /^сезон\s+\d+$/i.test(s.name.trim())) ? `Сезон ${s.number}` : (s.name || `Сезон ${s.number}`),
      year: s.year ?? null,
      released: !!s.airDate && s.airDate.slice(0, 10) <= t,
      ref: `tmdb-season:${s.number}`
    };
    if (s.number > 0) out.season = s.number; else out.extra = true;
    return out;
  };
  const main = seasons.filter((s) => s.number > 0).sort((a, b) => a.number - b.number).map(part);
  const extra = seasons.filter((s) => s.number === 0).map(part);
  return [...main, ...extra];
}

const released = (n: FranchiseNode, t: string) => n.year != null && !!n.date && n.date.slice(0, 10) <= t;

/** A franchise's main story by date, then its extras by date. `season` counts the TV seasons of the main story. */
export function partsFromFranchise(f: Franchise, today: Date): FreshPart[] {
  const t = day(today);
  let tv = 0;
  const main = f.nodes.filter((n) => n.main).map((n): FreshPart => {
    const p: FreshPart = { name: n.name, year: n.year, released: released(n, t), ref: `shiki:${n.id}` };
    if (n.kind === 'TV Сериал') p.season = ++tv;
    return p;
  });
  const extra = f.nodes.filter((n) => !n.main).map((n): FreshPart => ({ name: n.name, year: n.year, released: released(n, t), ref: `shiki:${n.id}`, extra: true }));
  return [...main, ...extra];
}

/**
 * A film (or an OVA) on its own: no TV season in the main story and at most
 * one main part. A checklist of one part says nothing, so such a title gets
 * no list (and in search it stays its own row).
 */
export function isLoneWork(parts: FreshPart[]): boolean {
  const main = parts.filter((p) => !p.extra);
  return main.length <= 1 && !main.some((p) => p.season);
}

/** «4 сезона, 1 фильм» for a search row: main parts only. */
export function franchiseLabel(f: Franchise): string {
  const main = f.nodes.filter((n) => n.main);
  const seasons = main.filter((n) => n.kind === 'TV Сериал').length;
  const films = main.filter((n) => n.kind === 'Фильм').length;
  const other = main.length - seasons - films;
  return [
    seasons ? `${seasons} ${plural(seasons, 'сезон', 'сезона', 'сезонов')}` : '',
    films ? `${films} ${plural(films, 'фильм', 'фильма', 'фильмов')}` : '',
    other ? `${other} ${plural(other, 'спецвыпуск', 'спецвыпуска', 'спецвыпусков')}` : ''
  ].filter(Boolean).join(', ');
}

/** Every ref a title with these parts stands for, plus its own source id. */
export function refsOf(t: { source?: string | null; sourceId?: string | null; parts?: Part[] | null }): Set<string> {
  const out = new Set<string>();
  if (t.source === 'shikimori' && t.sourceId) out.add(`shiki:${t.sourceId}`);
  (t.parts ?? []).forEach((p) => { if (p?.ref) out.add(p.ref); });
  return out;
}

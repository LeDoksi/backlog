// refresh.ts — the daily refresh's rules (spec 2.5), with no network and no
// React: how a fresh list of parts from TMDb or Shikimori lands on a title
// that may already have one, and how duplicates of a franchise on one board
// merge into one title.
//
// The one invariant: ticks are stored by part index, so parts already on a
// title are never reordered or removed here. New parts only ever go on the
// end.
import { checkedIndices, type CheckedParts, type TitleRow } from './titleRow';
import { isLandscapeCover } from './covers';
import { good, type Raw } from './sources';
import { MT_PREFIX } from './synopsis';
import type { Part, Status, Title } from './types';

/** A part as a provider sees it: `season` is the n-th main season (1-based) for lining up hand-made lists. */
export interface FreshPart extends Part { ref: string; season?: number }

// «1», «Сезон 1», «1 сезон», «Сезон 3 «Золотые земли»», «Сезон 5 (финальный)»:
// a hand-made name that means "season N" and nothing else. «Сезон 5, часть 1»,
// «Книга 1: Вода», «OVA» or a film do not, and a list holding one of those is
// not lined up automatically.
export function seasonNumber(name: string): number | null {
  const m = /^\s*(?:(?:сезон|season)\s*(\d{1,3})|(\d{1,3})(?:\s*(?:-?й)?\s*сезон)?)\s*(?:«[^»]*»|\([^)]*\))?\s*$/i.exec(name ?? '');
  if (!m) return null;
  return Number(m[1] ?? m[2]);
}

// A hand-made part that is a side piece by its name: «OVA «Memory Snow»»,
// «ONA», «Спешл», «Спецвыпуск», «Special».
const SIDE_NAME = /^\s*(?:ova|ona|oad|спешл|спецвыпуск|special)(?![a-zа-яё])/i;

function clean(p: FreshPart): Part {
  const out: Part = { name: p.name, year: p.year ?? null, released: p.released !== false, ref: p.ref };
  if (p.extra) out.extra = true;
  return out;
}

function sameFacts(a: Part, b: Part): boolean {
  return (a.released !== false) === (b.released !== false) && (a.year ?? null) === (b.year ?? null) && !!a.extra === !!b.extra;
}

export interface MergeResult { parts: Part[]; changed: boolean }

/**
 * Brings `fresh` into `current`. Parts with a ref take the provider's
 * released flag and year; parts the provider has and the title does not go
 * on the end. A hand-made list without refs gets them when it reads exactly
 * «season 1, season 2, … season k» and the provider has those seasons;
 * otherwise it is left alone. `lineUp: false` never lines up (Shikimori
 * counts the halves of a season as two TV entries, so its «season N» is not
 * the one people mean). `manual` (the list was edited by hand) allows only
 * the released flags to move.
 */
export function mergeParts(current: Part[] | null | undefined, fresh: FreshPart[], opts: { manual?: boolean; lineUp?: boolean } = {}): MergeResult {
  const cur = Array.isArray(current) ? current.filter(Boolean) : [];
  if (!fresh.length) return { parts: cur, changed: false };
  if (!cur.length) return opts.manual ? { parts: cur, changed: false } : { parts: fresh.map(clean), changed: true };

  const byRef = new Map(fresh.map((f) => [f.ref, f]));
  let out: Part[] = cur.map((p) => ({ ...p }));
  const hasRefs = out.some((p) => p.ref);

  if (!hasRefs) {
    if (opts.manual) return { parts: cur, changed: false };
    // OVAs and specials in a hand-made list go to the extras block (the
    // flag moves nothing, ticks stay on their parts).
    const sided = out.map((p) => (!p.extra && SIDE_NAME.test(p.name ?? '') ? { ...p, extra: true } : p));
    const unchanged = sided.every((p, i) => p === out[i]);
    if (opts.lineUp === false) return unchanged ? { parts: cur, changed: false } : { parts: sided, changed: true };
    // Line up «season N» names with the provider's seasons: 1, 2, … k in
    // order, so nothing the provider has falls between them.
    const refs: string[] = [];
    for (const [i, p] of out.entries()) {
      const f = seasonNumber(p.name) === i + 1 ? fresh.find((x) => !x.extra && x.season === i + 1) : undefined;
      if (!f) return unchanged ? { parts: cur, changed: false } : { parts: sided, changed: true };
      refs.push(f.ref);
    }
    out = out.map((p, i) => ({ ...p, ref: refs[i] }));
    const last = Math.max(...refs.map((r) => fresh.findIndex((f) => f.ref === r)));
    const tail = fresh.slice(last + 1).filter((f) => !refs.includes(f.ref));
    out = out.map((p) => { const f = byRef.get(p.ref!); return f ? { ...p, released: f.released !== false, year: f.year ?? p.year ?? null } : p; });
    out.push(...tail.map(clean));
    return { parts: out, changed: true };
  }

  let changed = false;
  out = out.map((p) => {
    const f = p.ref ? byRef.get(p.ref) : undefined;
    if (!f) return p;
    // A part the provider now counts as a side piece moves to the extras;
    // never the other way (a part appended there on purpose stays).
    const next = opts.manual ? { ...p, released: f.released !== false }
      : { ...p, released: f.released !== false, year: f.year ?? p.year ?? null, ...(f.extra || p.extra ? { extra: true } : {}) };
    if (!sameFacts(p, next)) changed = true;
    return next;
  });
  if (!opts.manual) {
    const have = new Set(out.map((p) => p.ref).filter(Boolean));
    fresh.forEach((f, i) => {
      if (have.has(f.ref)) return;
      // A main part that turns up between parts already on the list (a film
      // linked late) goes to the extras: appended after them it would read
      // as the next thing to watch and un-finish a finished title.
      const between = !f.extra && fresh.slice(i + 1).some((x) => !x.extra && have.has(x.ref));
      out.push(between ? { ...clean(f), extra: true } : clean(f));
      changed = true;
    });
  }
  return { parts: changed ? out : (current as Part[]), changed };
}

/** A finished title that just got its list: every released main part ticked, so the status stays «Завершено». */
export function fillTicksForDone(parts: Part[], status: Status): number[] {
  if (status !== 'done') return [];
  return parts.map((p, i) => (p.released === false || p.extra ? -1 : i)).filter((i) => i >= 0);
}

/** Ticks as stored, from indices: dates kept where they were, `stamp` for new ones. */
export function ticksWith(before: CheckedParts | undefined, indices: number[], stamp: string): CheckedParts {
  const out: CheckedParts = {};
  [...new Set([...checkedIndices(before), ...indices])].sort((a, b) => a - b).forEach((i) => {
    out[String(i)] = before?.[String(i)] ?? stamp;
  });
  return out;
}

export interface MergePlan {
  keep: string;
  absorb: string[];
  /** Indices of the keep's parts to tick for absorbed titles that were finished. */
  ticks: number[];
  rating: number | null;
}

/**
 * Duplicates of one franchise on one board (spec 2.5 p.3). `franchise`
 * maps a title id to its franchise key, the ref of its own entry
 * (`shiki:<id>`) and whether that entry is in the main story; `firstTv` is
 * the ref of each franchise's first TV season. The keep is the title
 * holding the first TV season, else the main-story title added first.
 *
 * Only what can land whole is absorbed, so nothing is deleted with progress
 * that has nowhere to go: a main-story entry that the keep's parts carry,
 * not yet started or finished (a finished one ticks its part). Anything
 * else (a spin-off, a title in progress or with its own ticks) stays on
 * the board as it is.
 */
export function planMerge(
  board: Title[],
  franchise: Record<string, { key: string; ref: string; main?: boolean }>,
  firstTv: Record<string, string>,
  partsAfter: Record<string, Part[]>,
  ticked: Set<string> = new Set()
): MergePlan[] {
  const groups = new Map<string, Title[]>();
  board.forEach((t) => {
    const f = franchise[t.id];
    if (!f) return;
    groups.set(f.key, [...(groups.get(f.key) ?? []), t]);
  });
  const plans: MergePlan[] = [];
  groups.forEach((list, key) => {
    if (list.length < 2) return;
    const byAdded = [...list].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id));
    const keep = list.find((t) => franchise[t.id]!.ref === firstTv[key]) ?? byAdded.find((t) => franchise[t.id]!.main);
    if (!keep) return;
    const parts = partsAfter[keep.id] ?? keep.parts ?? [];
    const absorb: Title[] = [];
    const ticks: number[] = [];
    for (const t of byAdded) {
      if (t.id === keep.id || !franchise[t.id]!.main) continue;
      const at = parts.findIndex((p) => p.ref === franchise[t.id]!.ref);
      if (at < 0 || parts[at]!.extra) continue;
      if (t.status === 'done') ticks.push(at);
      else if (ticked.has(t.id) || (t.status !== 'queue' && t.status !== 'unreleased')) continue;
      absorb.push(t);
    }
    if (!absorb.length) return;
    const ratings = [keep, ...absorb].map((t) => t.rating).filter((r): r is number => typeof r === 'number');
    plans.push({ keep: keep.id, absorb: absorb.map((t) => t.id), ticks, rating: ratings.length ? Math.max(...ratings) : null });
  });
  return plans;
}

// ── Card fields (wave 3: spec 3.4 and the one-time normalization) ───────

/**
 * A cover nobody chose: none, the placeholder, a file of the old site
 * (`images/covers/…`, github.io), Shikimori's «no picture», or a wide
 * Steam/RAWG picture. Anything else (an upload, a pasted link, a poster
 * from search) was chosen and is never replaced.
 */
export function replaceableCover(cover: string | null | undefined): boolean {
  const c = (cover ?? '').trim();
  if (!c) return true;
  if (/^images\/covers\//.test(c) || /\.github\.io\//.test(c)) return true;
  if (/shikimori\.[a-z]+\/assets\/globals\/missing/.test(c)) return true;
  return isLandscapeCover(c);
}

const RU = (s: string | null | undefined) => good('synopsis', s);

/**
 * What a title's card should change to, given its sources' card, or null.
 * `daily` (games, spec 3.4): a wide or missing cover becomes a tall one;
 * an English or empty description becomes a Russian one. `normalize`
 * (titles moved from the old site, once): name, original name, cover,
 * description, genres and year as search gives them, except that a cover
 * someone chose stays, a tall cover never gives way to a wide one, and a
 * Russian description never gives way to a machine translation.
 */
export function cardFixes(row: TitleRow, card: Raw, mode: 'daily' | 'normalize'): Partial<TitleRow> | null {
  const out: Partial<TitleRow> = {};
  const cover = card.cover?.trim();
  // A source's «no picture» is never a cover.
  if (cover && !/\/assets\/globals\/missing|_placeholder\./.test(cover) && cover !== row.cover && replaceableCover(row.cover)) {
    const none = !(row.cover ?? '').trim() || /_placeholder\.|\/assets\/globals\/missing/.test(row.cover ?? '');
    // Tall beats anything replaceable; a wide picture only fills a gap
    // (an old-site file is tall, another wide one is no better).
    if (!isLandscapeCover(cover) || none) out.cover = cover;
  }
  const syn = card.synopsis?.trim();
  if (syn && syn !== (row.synopsis ?? '').trim()) {
    const cur = (row.synopsis ?? '').trim();
    const machine = syn.startsWith(MT_PREFIX.trim());
    if (!cur) out.synopsis = syn;
    else if (RU(syn) && !RU(cur)) out.synopsis = syn;
    else if (mode === 'normalize' && RU(syn) && !machine) out.synopsis = syn;
    else if (mode === 'normalize' && !RU(syn) && !RU(cur)) out.synopsis = syn;
  }
  if (mode === 'normalize') {
    const title = card.title?.trim();
    if (title && title !== row.title) out.title = title;
    const name = title || row.title;
    const orig = card.originalTitle?.trim();
    if (orig && orig !== name && orig !== (row.original_title ?? '')) out.original_title = orig;
    if (Array.isArray(card.genres) && card.genres.length && JSON.stringify(card.genres) !== JSON.stringify(row.genres ?? [])) out.genres = card.genres;
    if (typeof card.year === 'number' && card.year !== (row.year ?? null)) out.year = card.year;
  }
  return Object.keys(out).length ? out : null;
}

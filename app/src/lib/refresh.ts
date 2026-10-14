// refresh.ts — the daily refresh's rules (spec 2.5), with no network and no
// React: how a fresh list of parts from TMDb or Shikimori lands on a title
// that may already have one, and how duplicates of a franchise on one board
// merge into one title.
//
// The one invariant: ticks are stored by part index, so parts already on a
// title are never reordered or removed here. New parts only ever go on the
// end.
import { checkedIndices, type CheckedParts } from './titleRow';
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

function clean(p: FreshPart): Part {
  const out: Part = { name: p.name, year: p.year ?? null, released: p.released !== false, ref: p.ref };
  if (p.extra) out.extra = true;
  return out;
}

function sameFacts(a: Part, b: Part): boolean {
  return (a.released !== false) === (b.released !== false) && (a.year ?? null) === (b.year ?? null);
}

export interface MergeResult { parts: Part[]; changed: boolean }

/**
 * Brings `fresh` into `current`. Parts with a ref take the provider's
 * released flag and year; parts the provider has and the title does not go
 * on the end. A hand-made list without refs gets them when every part reads
 * as «season N» and the provider has those seasons; otherwise it is left
 * alone. `manual` (the list was edited by hand) allows only the released
 * flags to move.
 */
export function mergeParts(current: Part[] | null | undefined, fresh: FreshPart[], opts: { manual?: boolean } = {}): MergeResult {
  const cur = Array.isArray(current) ? current.filter(Boolean) : [];
  if (!fresh.length) return { parts: cur, changed: false };
  if (!cur.length) return opts.manual ? { parts: cur, changed: false } : { parts: fresh.map(clean), changed: true };

  const byRef = new Map(fresh.map((f) => [f.ref, f]));
  let out: Part[] = cur.map((p) => ({ ...p }));
  const hasRefs = out.some((p) => p.ref);

  if (!hasRefs) {
    if (opts.manual) return { parts: cur, changed: false };
    // Line up «season N» names with the provider's seasons.
    const refs: string[] = [];
    for (const p of out) {
      const n = seasonNumber(p.name);
      const f = n == null ? undefined : fresh.find((x) => !x.extra && x.season === n);
      if (!f || refs.includes(f.ref)) return { parts: cur, changed: false };
      refs.push(f.ref);
    }
    out = out.map((p, i) => ({ ...p, ref: refs[i] }));
    // Only what comes after the last lined-up part is added: a film from
    // between two seasons would land after them, out of order.
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
    const next = opts.manual ? { ...p, released: f.released !== false } : { ...p, released: f.released !== false, year: f.year ?? p.year ?? null };
    if (!sameFacts(p, next)) changed = true;
    return next;
  });
  if (!opts.manual) {
    const have = new Set(out.map((p) => p.ref).filter(Boolean));
    fresh.forEach((f) => { if (!have.has(f.ref)) { out.push(clean(f)); changed = true; } });
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
 * maps a title id to its franchise key and the ref of its own entry
 * (`shiki:<id>`); `firstTv` is the ref of each franchise's first TV season.
 * The keep is the title holding the first TV season, else the one added
 * first. An absorbed title that was finished ticks the keep's part with its
 * ref; when the keep's parts do not have that ref the group is left alone,
 * so nothing is ever deleted without its ticks landing somewhere.
 */
export function planMerge(
  board: Title[],
  franchise: Record<string, { key: string; ref: string }>,
  firstTv: Record<string, string>,
  partsAfter: Record<string, Part[]>
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
    const keep = list.find((t) => franchise[t.id]!.ref === firstTv[key]) ?? byAdded[0]!;
    const parts = partsAfter[keep.id] ?? keep.parts ?? [];
    const absorb = byAdded.filter((t) => t.id !== keep.id);
    const ticks: number[] = [];
    for (const t of absorb) {
      const at = parts.findIndex((p) => p.ref === franchise[t.id]!.ref);
      if (at < 0) return;
      if (t.status === 'done') ticks.push(at);
    }
    const ratings = list.map((t) => t.rating).filter((r): r is number => typeof r === 'number');
    plans.push({ keep: keep.id, absorb: absorb.map((t) => t.id), ticks, rating: ratings.length ? Math.max(...ratings) : null });
  });
  return plans;
}

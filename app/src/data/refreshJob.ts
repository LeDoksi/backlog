// refreshJob.ts — once a day, on the first open of a board, its series and
// anime are checked against TMDb and Shikimori (spec 2.5, BL-94, BL-95,
// BL-109): missing seasons are filled in, new ones appended, duplicates of
// a franchise merged; games get a tall cover and a Russian description in
// place of a wide or missing one and an English or empty one (spec 3.4).
// Everything goes to the server in one quiet
// apply_title_refresh() call, so friends see none of it in the feed.
import * as Enrich from '../lib/enrich';
import { materialize } from '../lib/derive';
import { isLoneWork, partsFromFranchise, partsFromTmdb } from '../lib/franchise';
import { cardForRetry } from './cardSources';
import { isLandscapeCover } from '../lib/covers';
import { good } from '../lib/sources';
import { cardFixes, fillTicksForDone, mergeParts, planMerge, sourceKnowsLess, ticksWith, type FreshPart } from '../lib/refresh';
import { checkedIndices, fromRow, type CheckedParts, type TitleRow } from '../lib/titleRow';
import type { FetchLike, Part, StorageLike, SupabaseLike, Title } from '../lib/types';

export interface RefreshDeps {
  board: string;
  /** The board's rows as the mirror holds them: what the server is asked to change from. */
  rows: TitleRow[];
  /** Titles with edits still waiting to be sent: left for another day. */
  pendingIds: Set<string>;
  fetchFn: FetchLike;
  client: SupabaseLike | null;
  storage: StorageLike;
  now: Date;
  tmdbKey: string;
  proxy: string | null;
  /** Games (wave 3): RAWG's key and a check that a picture loads tall. */
  rawgKey?: string;
  loadImage?: (url: string) => Promise<boolean>;
  pause?: (ms: number) => Promise<void>;
}

export interface RefreshResult {
  ran: boolean;
  updated: number;
  merged: number;
  skipped: number;
  /** Rows to write locally (the server took them). */
  changes: { id: string; cols: Partial<TitleRow> | null }[];
}

const PAUSE_MS = 250;
/** After a failed write the next try waits this long (every good pull would otherwise refetch the board). */
const RETRY_MS = 30 * 60 * 1000;
/** The date of a tick the refresh adds for a title finished on no known day: before every period but «за всё время». */
const UNDATED = '1970-01-01T00:00:00.000Z';
// The rules version is in the key: a fix to them runs again the same day.
const key = (board: string) => `refresh:3:${board}`;
const retryKey = (board: string) => `refresh-retry:${board}`;
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function refreshedToday(storage: StorageLike, board: string, now: Date): boolean {
  try { return storage.getItem(key(board)) === localDay(now); } catch { return false; }
}

function markDone(storage: StorageLike, board: string, now: Date) {
  try { storage.setItem(key(board), localDay(now)); } catch { /* quota: it runs again next open */ }
}

const base = (r: TitleRow) => ({ parts: r.parts ?? null, checked_parts: r.checked_parts ?? {}, status: r.status });
/** The base also names every card field the update changes: an edit made meanwhile makes the write stale. */
export function cardBase(r: TitleRow, cols: Partial<TitleRow>) {
  const out: Record<string, unknown> = base(r);
  Object.keys(cols).forEach((k) => { out[k] = (r as unknown as Record<string, unknown>)[k] ?? null; });
  return out;
}

/**
 * A game whose card the daily pass may improve (spec 3.4): a wide or
 * missing cover, an English or empty description. An old-site file is
 * tall already: that is the one-time normalization's to replace.
 */
export function gameNeedsCard(r: TitleRow): boolean {
  const cover = (r.cover ?? '').trim();
  const wideOrNone = !cover || /_placeholder\./.test(cover) || isLandscapeCover(cover);
  return wideOrNone || !good('synopsis', r.synopsis ?? '');
}

export async function runDailyRefresh(deps: RefreshDeps): Promise<RefreshResult> {
  const none: RefreshResult = { ran: false, updated: 0, merged: 0, skipped: 0, changes: [] };
  const { board, storage, now } = deps;
  if (!deps.client || refreshedToday(storage, board, now)) return none;
  try {
    const failed = Date.parse(storage.getItem(retryKey(board)) ?? '');
    if (now.getTime() - failed < RETRY_MS) return none;
  } catch { /* no storage: try */ }
  const pause = deps.pause ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  const rows = deps.rows.filter((r) => (r.category === 'series' || r.category === 'anime') && r.source_id
    && (r.source === 'tmdb-series' || r.source === 'shikimori') && !deps.pendingIds.has(r.id));
  const fresh: Record<string, FreshPart[]> = {};
  const franchise: Record<string, { key: string; ref: string; main: boolean }> = {};
  const firstTv: Record<string, string> = {};
  const franchises = new Map<number, Enrich.Franchise>();
  let skipped = 0;
  let asked = 0;

  // One request at a time (Shikimori asks for at most 5 a second).
  for (const r of rows) {
    const id = Number(r.source_id);
    if (r.source === 'tmdb-series') {
      if (asked++) await pause(PAUSE_MS);
      const s = await Enrich.fetchTmdbSeasons(deps.fetchFn, deps.proxy, deps.tmdbKey, r.source_id!);
      if (!s || !s.seasons.length) { skipped++; continue; }
      fresh[r.id] = partsFromTmdb(s.seasons, now);
    } else {
      let f = franchises.get(id);
      if (!f) {
        if (asked++) await pause(PAUSE_MS);
        f = (await Enrich.fetchShikimoriFranchise(deps.fetchFn, id)) ?? undefined;
        if (!f) { skipped++; continue; }
        f.nodes.forEach((n) => franchises.set(n.id, f!));
      }
      fresh[r.id] = partsFromFranchise(f, now);
      franchise[r.id] = { key: String(f.rootId), ref: `shiki:${id}`, main: !!f.nodes.find((n) => n.id === id)?.main };
      firstTv[String(f.rootId)] = `shiki:${f.rootId}`;
    }
  }

  const titles = new Map<string, { row: TitleRow; title: Title; ticks: CheckedParts }>();
  rows.forEach((row) => { const { title, checked } = fromRow(row); titles.set(row.id, { row, title, ticks: checked }); });

  // New parts per title.
  const partsAfter: Record<string, Part[]> = {};
  Object.keys(fresh).forEach((id) => {
    const t = titles.get(id)!;
    const f = fresh[id]!;
    const have = t.title.parts ?? [];
    if (isLoneWork(f)) {
      // A film on its own gets no list; one this pass gave it earlier
      // (every part from the provider, not edited by hand) is taken back.
      const ours = have.length > 0 && !t.row.parts_manual && have.every((p) => p?.ref && f.some((x) => x.ref === p.ref));
      if (ours) partsAfter[id] = [];
      return;
    }
    if (!have.length) {
      // A first list only where the status survives it (spec 2.5 p.1):
      // a lone OVA or recap film is not the franchise; a later season
      // being watched or finished («Атака титанов 3») does not say where in
      // the franchise someone is; a finished show whose seasons all read as
      // not out yet would turn «Не вышло». «Смотрю» on the show itself gets
      // the list with nothing ticked and stays «Смотрю» until something is.
      const later = franchise[id] && franchise[id]!.key !== franchise[id]!.ref.slice('shiki:'.length);
      if (franchise[id] && !franchise[id]!.main) return;
      if (later && t.title.status !== 'queue' && t.title.status !== 'unreleased') return;
      if (t.title.status === 'done' && !f.some((p) => !p.extra && p.released !== false)) return;
    }
    // A hand-made list on a title nobody started gives way to the provider's.
    // (Not for a side piece: an OVA's own list is not the franchise's.)
    const untouched = !checkedIndices(t.ticks).length && (t.title.status === 'queue' || t.title.status === 'unreleased')
      && !(franchise[id] && !franchise[id]!.main);
    const m = mergeParts(t.title.parts, f, { manual: !!t.row.parts_manual, lineUp: t.row.source === 'tmdb-series', untouched });
    partsAfter[id] = m.parts;
  });

  // A keep left without new parts would lose what the duplicates carry: no merge then.
  const ticked = new Set([...titles].filter(([, t]) => checkedIndices(t.ticks).length).map(([id]) => id));
  const plans = planMerge(rows.filter((r) => franchise[r.id]).map((r) => titles.get(r.id)!.title), franchise, firstTv, partsAfter, ticked)
    .filter((p) => partsAfter[p.keep]);
  const absorbed = new Set(plans.flatMap((p) => p.absorb));

  const updates: Record<string, unknown>[] = [];
  const changes: RefreshResult['changes'] = [];
  for (const [id, parts] of Object.entries(partsAfter)) {
    if (absorbed.has(id)) continue;
    const { row, title, ticks } = titles.get(id)!;
    let next = parts.length ? ticks : {};
    // A finished title that just got its list keeps «Завершено» (spec 2.5 p.1).
    if (!(title.parts ?? []).length && title.status === 'done') next = ticksWith(next, fillTicksForDone(parts, 'done'), title.completedAt ?? UNDATED);
    const plan = plans.find((p) => p.keep === id);
    let rating = title.rating ?? null;
    if (plan) {
      // Each finished duplicate ticks its own part, dated when it was finished.
      plan.absorb.forEach((a) => {
        const gone = titles.get(a)!.title;
        const tick = parts.findIndex((p) => p.ref === franchise[a]!.ref);
        if (gone.status === 'done' && tick >= 0) next = ticksWith(next, [tick], gone.completedAt ?? UNDATED);
      });
      rating = plan.rating;
    }
    const m = materialize({ ...title, parts }, checkedIndices(next));
    // «Смотрю» with nothing ticked yet stays «Смотрю» (the list alone would read «В очереди»).
    const status = m.status === 'queue' && row.status === 'in_progress' && !checkedIndices(next).length ? 'in_progress' : m.status;
    const cols = { parts, checked_parts: next, status, manual_status: m.manualStatus, airing_status: m.airingStatus, rating };
    const same = JSON.stringify([row.parts ?? null, row.checked_parts ?? {}, row.status, row.manual_status ?? null, row.airing_status ?? null, row.rating ?? null])
      === JSON.stringify([cols.parts, cols.checked_parts, cols.status, cols.manual_status, cols.airing_status, cols.rating]);
    if (same) continue;
    updates.push({ id, base: base(row), ...cols });
    changes.push({ id, cols });
  }
  const deletes = [...absorbed].map((id) => ({ id, base: base(titles.get(id)!.row) }));
  deletes.forEach((d) => changes.push({ id: d.id, cols: null }));

  if (!updates.length && !deletes.length) {
    markDone(storage, board, now);
    const games = await refreshGames(deps, pause, asked > 0);
    return { ran: true, updated: games.length, merged: 0, skipped, changes: games };
  }

  let res: { data: unknown; error: unknown };
  try {
    res = await deps.client.rpc('apply_title_refresh', { p_workspace: board, p_updates: updates, p_deletes: deletes });
  } catch (e) {
    res = { data: null, error: e };
  }
  // -1: a row changed meanwhile; an error: the network or the server. Either
  // way nothing was written and the next open tries again.
  if (res.error || typeof res.data !== 'number' || res.data < 0) {
    try { storage.setItem(retryKey(board), now.toISOString()); } catch { /* it tries on the next pull */ }
    return { ...none, ran: true, skipped };
  }
  // A source that did not answer is skipped until tomorrow (spec 2.5).
  markDone(storage, board, now);
  // Games go after the seasons and in a write of their own: their sources
  // are slow, and a stale game must not cost the seasons their write.
  const games = await refreshGames(deps, pause, true);
  return { ran: true, updated: updates.length + games.length, merged: deletes.length, skipped, changes: [...changes, ...games] };
}

const gamesKey = (board: string) => `refresh-games:${board}`;
/** A game asked about is asked again only after a week: nothing better usually stays so. */
const GAME_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Games (spec 3.4): a wide or missing cover becomes a tall one, an English
 * or empty description a Russian one. One game at a time, each at most
 * once a week; the rows are the board as it was when the refresh started,
 * and a game edited since makes the write stale (its base names the
 * fields), which is simply tried next week.
 */
async function refreshGames(deps: RefreshDeps, pause: (ms: number) => Promise<void>, pauseFirst: boolean): Promise<RefreshResult['changes']> {
  const { board, storage, now } = deps;
  let asked: Record<string, number> = {};
  try { asked = JSON.parse(storage.getItem(gamesKey(board)) ?? '{}') ?? {}; } catch { /* start over */ }
  const games = deps.rows.filter((r) => r.category === 'game' && r.source_id && (r.source === 'steam' || r.source === 'rawg')
    && !deps.pendingIds.has(r.id) && gameNeedsCard(r) && !(now.getTime() - (asked[r.id] ?? 0) < GAME_EVERY_MS));
  if (!games.length) return [];
  const updates: Record<string, unknown>[] = [];
  const changes: RefreshResult['changes'] = [];
  let first = !pauseFirst;
  for (const r of games) {
    if (!first) await pause(PAUSE_MS);
    first = false;
    const card = await cardForRetry(r.source!, r.source_id!, {
      fetchFn: deps.fetchFn, proxy: deps.proxy ?? '', tmdbKey: deps.tmdbKey, rawgKey: deps.rawgKey ?? '', loadImage: deps.loadImage ?? (async () => false)
    }, pause);
    // A game whose source did not answer is asked again tomorrow, not in a week.
    if (card) asked[r.id] = now.getTime();
    const cols = card ? cardFixes(r, card, 'daily') : null;
    if (!cols) continue;
    updates.push({ id: r.id, base: cardBase(r, cols), ...cols });
    changes.push({ id: r.id, cols });
  }
  try { storage.setItem(gamesKey(board), JSON.stringify(asked)); } catch { /* asked again tomorrow */ }
  if (!updates.length || !deps.client) return [];
  let res: { data: unknown; error: unknown };
  try {
    res = await deps.client.rpc('apply_title_refresh', { p_workspace: board, p_updates: updates, p_deletes: [] });
  } catch (e) {
    res = { data: null, error: e };
  }
  return res.error || typeof res.data !== 'number' || res.data < 0 ? [] : changes;
}

export interface RebuildDeps {
  board: string;
  row: TitleRow;
  fetchFn: FetchLike;
  client: SupabaseLike | null;
  now: Date;
  tmdbKey: string;
  proxy: string | null;
}

/**
 * The one-time tidy of every board (BL-113, tools/tidy-boards): the
 * title's list of parts built again from its source, for a list the daily
 * refresh leaves alone (made by hand on the old site, with progress on it). The ticks are carried over by count:
 * someone who had 4 main parts ticked has the first 4 released main parts
 * of the new list ticked, with the same dates, and checks them after; a
 * finished title stays finished. Quiet, like the daily refresh: friends see
 * nothing in the feed. 'none': the source has no list for it (a film on
 * its own, an OVA whose list is its own), knows fewer parts than the list
 * (lib/refresh sourceKnowsLess) or did not answer; 'stale': the title
 * changed meanwhile.
 */
export async function rebuildSeasons(deps: RebuildDeps): Promise<{ cols: Partial<TitleRow> } | 'none' | 'stale'> {
  const { row, now } = deps;
  if (!deps.client || !row.source_id || (row.source !== 'tmdb-series' && row.source !== 'shikimori')) return 'none';
  let fresh: FreshPart[];
  if (row.source === 'tmdb-series') {
    const s = await Enrich.fetchTmdbSeasons(deps.fetchFn, deps.proxy, deps.tmdbKey, row.source_id);
    if (!s || !s.seasons.length) return 'none';
    fresh = partsFromTmdb(s.seasons, now);
  } else {
    const f = await Enrich.fetchShikimoriFranchise(deps.fetchFn, Number(row.source_id));
    if (!f || !f.nodes.find((n) => n.id === Number(row.source_id))?.main) return 'none';
    fresh = partsFromFranchise(f, now);
  }
  if (!fresh.length || isLoneWork(fresh)) return 'none';

  const { title, checked } = fromRow(row);
  const old = title.parts ?? [];
  if (sourceKnowsLess(old, fresh)) return 'none';
  // The same order as `fresh` (every part is new here).
  const parts = mergeParts(undefined, fresh).parts;
  const before = checkedIndices(checked).filter((i) => old[i] && !old[i]!.extra);
  const dates = before.map((i) => checked[String(i)]!).sort();
  const main = parts.map((p, i) => (p.extra || p.released === false ? -1 : i)).filter((i) => i >= 0);
  // The old site counted seasons: the ticks go to the TV seasons first, so a
  // film between seasons («Магическая битва 0») does not take a season's tick.
  const seasons = main.filter((i) => fresh[i]?.season);
  const onto = seasons.length >= before.length ? seasons : main;
  let next: CheckedParts = {};
  if (title.status === 'done') next = ticksWith({}, fillTicksForDone(parts, 'done'), title.completedAt ?? UNDATED);
  else onto.slice(0, before.length).forEach((i, n) => { next[String(i)] = dates[n] ?? now.toISOString(); });
  const m = materialize({ ...title, parts }, checkedIndices(next));
  const status = m.status === 'queue' && row.status === 'in_progress' && !checkedIndices(next).length ? 'in_progress' : m.status;
  const cols: Partial<TitleRow> = { parts, checked_parts: next, status, manual_status: m.manualStatus, airing_status: m.airingStatus, rating: title.rating ?? null };
  let res: { data: unknown; error: unknown };
  try {
    res = await deps.client.rpc('apply_title_refresh', { p_workspace: deps.board, p_updates: [{ id: row.id, base: base(row), ...cols }], p_deletes: [] });
  } catch (e) {
    res = { data: null, error: e };
  }
  if (res.error || typeof res.data !== 'number') return 'none';
  return res.data < 0 ? 'stale' : { cols };
}

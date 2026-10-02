// storage.ts
//
// Season/part tracking: the rules that turn a `parts` list and the ticked
// indices into a status. The local overlay that used to live here (overrides,
// added titles and ticks in localStorage, synced to the drafts/overrides/parts
// tables) went with those tables; titles and their ticks now live in the
// `titles` table (see data/titlesStore.ts). The name stayed so imports did not
// have to move.
import type { AiringStatus, Part, Status, Title } from './types';

// A series/anime title may carry `parts`: the seasons, films and OVAs it is
// made of, in release order, each flagged `released: true|false`. Which parts
// the owner has watched is a list of indices into it. Indices, not names:
// `parts` is written once in release order and only ever appended to, so an
// index is stable, while a name is free text that may well get retitled.

// Anything that is not a non-negative integer is not an index into `parts`,
// and duplicates would make "how many are checked" a lie. Sorted so the
// stored value is stable and diffable, whatever order the clicks came in.
function normalizeIndices(indices: unknown): number[] {
  if (!Array.isArray(indices)) return [];
  var seen: Record<number, boolean> = {};
  var out: number[] = [];
  indices.forEach(function (n) {
    if (typeof n !== 'number' || !isFinite(n) || n < 0 || Math.floor(n) !== n) return;
    if (seen[n]) return;
    seen[n] = true;
    out.push(n);
  });
  return out.sort(function (a, b) { return a - b; });
}

// How much of a `parts` list has been watched. Counted by walking `parts`,
// never the checked list — an index that is out of range or points at an
// unreleased part simply never comes up, so it cannot inflate the count.
// `deriveStatus` and the modal's «Просмотрено N из M» line both read from
// here, which is what makes it impossible for the badge and the counter to
// tell two different stories (they previously could: a stale index of 9 in a
// 3-part list read `!parts[9].released` → `!undefined` → "watched").
export interface PartsProgress { released: number; pending: number; watched: number }

function partsProgress(parts: Part[] | null | undefined, checkedIndices: unknown): PartsProgress {
  var checked = normalizeIndices(checkedIndices);
  var out = { released: 0, pending: 0, watched: 0 };
  if (!Array.isArray(parts)) return out;
  parts.forEach(function (part: Part | null, index: number) {
    if (part && part.released === false) { out.pending += 1; return; }
    out.released += 1;
    if (checked.indexOf(index) !== -1) out.watched += 1;
  });
  return out;
}

// The whole point of the feature lives in this function.
//
//   nothing checked                          → queue
//   every released part checked, none pending → done
//   anything else                            → in_progress
//
// "Anything else" is doing the load-bearing work: a list where every part
// that has actually come out is ticked but one is still unreleased lands
// here, *not* on done. Marking such a show "завершено" is exactly the signal
// loss this replaces — you are caught up, you are not finished.
//
// Unreleased parts are inert in every direction: they cannot be counted
// toward completion, and a stray check on one (stale storage, a season that
// was pushed back after being ticked) is ignored rather than promoting the
// title. A part is treated as released unless it says `released: false`, so
// a missing flag fails toward "watchable" rather than silently locking a
// show at in_progress with no visible reason.
//
// A list where *nothing* has come out yet is `unreleased`, not `queue`: "В
// бэклоге" reads as "available, just not started", which is exactly the
// misread the fourth status exists to fix. The check runs first, but
// it cannot shadow any existing case — `partsProgress` only ever counts a
// part as watched if it was counted as released, so `released === 0` forces
// `watched === 0` and the old code would have said `queue` here anyway. For
// every list with at least one released part this branch never fires and the
// three branches below behave exactly as they always have.
//
// Returns null when there is no list to derive from — the caller falls back
// to the plain three-state control for titles not yet migrated.
function deriveStatus(parts: Part[] | null | undefined, checkedIndices: unknown): Status | null {
  if (!Array.isArray(parts) || parts.length === 0) return null;
  var p = partsProgress(parts, checkedIndices);
  if (p.released === 0) return 'unreleased';
  if (p.watched === 0) return 'queue';
  if (p.watched === p.released && p.pending === 0) return 'done';
  return 'in_progress';
}

// "Всё ещё выходит" derived from the same list. For a parts-bearing title the
// `parts` array already IS the ground truth about what is out and what is
// coming, so `airingStatus` has no business being maintained by hand there —
// it only ever drifted stale (a season marked `completed` before it aired, a
// wrapped show still flagged ongoing).
//
// Mixed list (something out, something still coming) → ongoing. Everything
// else → completed. That "everything else" covers the all-pending list too;
// that value is inert, because such a title derives to the `unreleased`
// status and `withDerivedStatus` forces the badge off for it regardless of
// what this function said. Checked indices are irrelevant here — this is a
// fact about the franchise, not about the viewer — so it is called with [].
function deriveAiringStatus(parts: Part[] | null | undefined): AiringStatus {
  if (!Array.isArray(parts) || parts.length === 0) return null;
  var p = partsProgress(parts, []);
  return (p.pending > 0 && p.released > 0) ? 'ongoing' : 'completed';
}

// The one rule for "does this title use a checklist instead of the
// three-button control", shared by the renderer and by the status
// derivation so the two can never be gated differently.
function hasPartsChecklist(title: Title | null | undefined): title is Title & { parts: Part[] } {
  return !!title
    && (title.category === 'series' || title.category === 'anime')
    && Array.isArray(title.parts) && title.parts.length > 0;
}

// Watched everything that is out, but more is announced: by the numbers the
// title is "in progress", yet there is nothing to watch right now. The random
// pick has to skip these or it suggests something the owner cannot start.
function isCaughtUp(title: Title, checkedIndices: unknown): boolean {
  if (!hasPartsChecklist(title)) return false;
  var p = partsProgress(title.parts, checkedIndices);
  return p.released > 0 && p.pending > 0 && p.watched === p.released;
}

export {
  partsProgress,
  deriveStatus,
  deriveAiringStatus,
  hasPartsChecklist,
  isCaughtUp
};

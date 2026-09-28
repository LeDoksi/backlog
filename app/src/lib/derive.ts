// derive.ts — the status of a title with a parts checklist, computed when it
// is WRITTEN (v2 stores it in `titles.status`), from the same rules v1
// applied on read (see storage.ts: deriveStatus, deriveAiringStatus).
//
// The status someone set by hand is never thrown away: while the checklist
// drives the status it waits in `manualStatus`, and it comes back when the
// parts are removed.
import { deriveAiringStatus, deriveStatus, hasPartsChecklist } from './storage';
import type { AiringStatus, Category, Part, Status, Title } from './types';

export interface Materialized { status: Status; manualStatus: Status | null; airingStatus: AiringStatus }

export function materialize(
  t: { category: Category; parts?: Part[] | null; status: Status; manualStatus?: Status | null; airingStatus?: AiringStatus },
  checked: number[]
): Materialized {
  if (hasPartsChecklist(t as Title)) {
    const status = deriveStatus(t.parts, checked) as Status;
    return {
      status,
      manualStatus: t.manualStatus ?? t.status,
      airingStatus: status === 'unreleased' ? 'completed' : deriveAiringStatus(t.parts)
    };
  }
  return { status: t.manualStatus ?? t.status, manualStatus: null, airingStatus: t.airingStatus ?? null };
}

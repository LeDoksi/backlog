/** Prefix of a machine-translated description (spec 3.3; no column of its own). */
export const MT_PREFIX = '[mt] ';

/** The description to show, without the machine-translation mark, and whether it had one. */
export function synopsisText(text: string | null | undefined): { text: string; machine: boolean } {
  const t = (text ?? '').trim();
  return t.startsWith(MT_PREFIX.trim()) ? { text: t.slice(MT_PREFIX.trim().length).trim(), machine: true } : { text: t, machine: false };
}

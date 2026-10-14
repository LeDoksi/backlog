import type { Category, Status } from '../lib/types';
import { STATUS_CARD_WAITING, statusLabel } from '../data/labels';
import s from './StatusPill.module.css';

const VAR: Record<Status, string> = { queue: 'queue', in_progress: 'progress', done: 'done', unreleased: 'unreleased' };

/** `waiting`: caught up, more is coming — «Ждёт продолжения» in the colour of «Ещё не вышло». */
export function StatusPill({ status, category, onPoster = false, waiting = false }: { status: Status; category: Category; onPoster?: boolean; waiting?: boolean }) {
  const v = waiting ? VAR.unreleased : VAR[status];
  return (
    <span className={onPoster ? `${s.pill} ${s.onPoster}` : s.pill}
      style={{ color: `var(--st-${v})`, background: onPoster ? undefined : `var(--st-${v}-soft, transparent)` }}>
      <span className={s.dot} style={{ background: `var(--st-${v})` }} />{waiting ? STATUS_CARD_WAITING : statusLabel(status, category)}
    </span>
  );
}

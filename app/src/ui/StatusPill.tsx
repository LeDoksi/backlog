import type { Category, Status } from '../lib/types';
import { statusLabel } from '../data/labels';
import s from './StatusPill.module.css';

const VAR: Record<Status, string> = { queue: 'queue', in_progress: 'progress', done: 'done', unreleased: 'unreleased' };

export function StatusPill({ status, category, onPoster = false }: { status: Status; category: Category; onPoster?: boolean }) {
  const v = VAR[status];
  return (
    <span className={onPoster ? `${s.pill} ${s.onPoster}` : s.pill}
      style={{ color: `var(--st-${v})`, background: onPoster ? undefined : `var(--st-${v}-soft, transparent)` }}>
      <span className={s.dot} style={{ background: `var(--st-${v})` }} />{statusLabel(status, category)}
    </span>
  );
}

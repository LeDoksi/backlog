import type { Status } from '../lib/types';
import s from './StatusPill.module.css';

const LABEL: Record<Status, string> = { queue: 'В бэклоге', in_progress: 'Смотрю', done: 'Завершено', unreleased: 'Ещё не вышло' };
const VAR: Record<Status, string> = { queue: 'queue', in_progress: 'progress', done: 'done', unreleased: 'unreleased' };

export function StatusPill({ status, onPoster = false }: { status: Status; onPoster?: boolean }) {
  const v = VAR[status];
  return (
    <span className={onPoster ? `${s.pill} ${s.onPoster}` : s.pill}
      style={{ color: `var(--st-${v})`, background: onPoster ? undefined : `var(--st-${v}-soft, transparent)` }}>
      <span className={s.dot} style={{ background: `var(--st-${v})` }} />{LABEL[status]}
    </span>
  );
}

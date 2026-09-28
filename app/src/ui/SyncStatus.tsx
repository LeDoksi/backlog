import { CloudArrowUp, CloudSlash } from '@phosphor-icons/react';
import { useTitles } from '../data/titlesStore';
import { plural } from '../data/labels';
import s from './SyncStatus.module.css';

// Silent while everything has reached the server; speaks only when the
// person's edits are waiting, so a healthy app shows nothing at all.
export function SyncStatus() {
  const pending = useTitles((t) => t.pending);
  const online = useTitles((t) => t.online);
  if (online && pending === 0) return null;
  return (
    <div className={s.wrap} role="status">
      {!online ? (
        <span className={`${s.pill} ${s.offline}`}><CloudSlash size={16} aria-hidden="true" />Нет сети, правки сохранятся{pending > 0 && ` · ${pending}`}</span>
      ) : (
        <span className={`${s.pill} ${s.pending}`}><CloudArrowUp size={16} aria-hidden="true" />Не сохранено: {pending} {plural(pending, 'правка', 'правки', 'правок')}</span>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { CloudArrowUp, CloudSlash } from '@phosphor-icons/react';
import { useTitles } from '../data/titlesStore';
import { plural } from '../data/labels';
import s from './SyncStatus.module.css';

/** An edit normally reaches the server well within this; only one still waiting after it is worth a word. */
export const SAVE_GRACE_MS = 4000;

// Silent while everything has reached the server; speaks only when the
// person's edits are stuck, so a healthy app shows nothing at all. Being
// offline is said at once; an edit merely on its way is not.
export function SyncStatus() {
  const pending = useTitles((t) => t.pending);
  const online = useTitles((t) => t.online);
  const [stuck, setStuck] = useState(false);
  const waiting = online && pending > 0;
  useEffect(() => {
    setStuck(false);
    if (!waiting) return;
    const t = setTimeout(() => setStuck(true), SAVE_GRACE_MS);
    return () => clearTimeout(t);
  }, [waiting]);
  if (online && (pending === 0 || !stuck)) return null;
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

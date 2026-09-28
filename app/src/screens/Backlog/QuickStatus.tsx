import { Check, ListChecks, Queue, Play } from '@phosphor-icons/react';
import { useTitles } from '../../data/titlesStore';
import { openTitle } from '../../data/ui';
import { STATUS_CARD } from '../../data/labels';
import { hasPartsChecklist } from '../../lib/storage';
import type { Status, Title } from '../../lib/types';
import s from './QuickStatus.module.css';

const ACTIONS: { status: Status; icon: typeof Check }[] = [
  { status: 'queue', icon: Queue },
  { status: 'in_progress', icon: Play },
  { status: 'done', icon: Check }
];

interface Props { title: Title; open: boolean; onDone: () => void; onChange: () => void }

// Three statuses over the poster; a title with a parts checklist derives its
// status, so it gets the checklist shortcuts instead.
export function QuickStatus({ title, open, onDone, onChange }: Props) {
  const setStatus = useTitles((t) => t.setStatus);
  const setAllReleased = useTitles((t) => t.setAllReleasedChecked);
  const vibrate = () => navigator.vibrate?.(10);

  if (hasPartsChecklist(title)) {
    return (
      <div role="group" aria-label={`Быстрые действия: ${title.title}`} className={open ? `${s.quick} ${s.open} ${s.column}` : `${s.quick} ${s.column}`}>
        <button type="button" className={s.wide} onClick={() => { onChange(); setAllReleased(title.id); vibrate(); onDone(); }}>
          <Check size={18} aria-hidden="true" />Все вышедшие
        </button>
        <button type="button" className={s.wide} onClick={() => { onDone(); openTitle(title.id); }}>
          <ListChecks size={18} aria-hidden="true" />Открыть сезоны
        </button>
      </div>
    );
  }
  return (
    <div role="group" aria-label={`Статус: ${title.title}`} className={open ? `${s.quick} ${s.open}` : s.quick}>
      {ACTIONS.map(({ status, icon: Icon }) => (
        <button key={status} type="button" aria-pressed={title.status === status} aria-label={STATUS_CARD[status]} title={STATUS_CARD[status]}
          className={title.status === status ? `${s.btn} ${s.on}` : s.btn}
          onClick={() => { onChange(); setStatus(title.id, status); vibrate(); onDone(); }}>
          <Icon size={20} weight={title.status === status ? 'bold' : 'regular'} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

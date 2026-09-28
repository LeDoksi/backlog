import { Check } from '@phosphor-icons/react';
import type { Status } from '../../lib/types';
import { STATUS_CARD } from '../../data/labels';
import s from './TitleSheet.module.css';

const OPTIONS: Status[] = ['queue', 'in_progress', 'done'];

export function StatusControl({ value, onChange }: { value: Status; onChange: (s: Status) => void }) {
  return (
    <div role="radiogroup" aria-label="Статус" className={s.status}>
      {OPTIONS.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={o === value} className={o === value ? `${s.seg} ${s.segOn}` : s.seg}
          onClick={() => onChange(o)}>
          {o === value && <Check size={16} weight="bold" aria-hidden="true" />}{STATUS_CARD[o]}
        </button>
      ))}
    </div>
  );
}

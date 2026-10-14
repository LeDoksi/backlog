import { useState } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import { partsProgress } from '../../lib/storage';
import type { Part } from '../../lib/types';
import { plural } from '../../data/labels';
import s from './TitleSheet.module.css';

interface Props {
  parts: Part[]; checked: number[]; onToggle?: (index: number, checked: boolean) => void; onAllReleased?: () => void;
  /** Someone else's ticks: shown, not changed. */
  readOnly?: boolean;
}

export function progressLine(parts: Part[], checked: number[]): string {
  const p = partsProgress(parts, checked);
  const base = `Просмотрено ${p.watched} из ${p.released}`;
  return p.pending ? `${base}, впереди ещё ${p.pending}` : base;
}

export function PartsChecklist({ parts, checked, onToggle, onAllReleased, readOnly = false }: Props) {
  const p = partsProgress(parts, checked);
  const canMarkAll = !readOnly && p.watched < p.released;
  // OVA and specials (spec 2.2): folded under the main list, ticked the same
  // way, counted nowhere.
  const [extrasOpen, setExtrasOpen] = useState(false);
  const extras = parts.map((part, i) => ({ part, i })).filter((x) => x.part?.extra);
  const row = (part: Part, i: number) => {
    const released = part.released !== false;
    const on = released && checked.includes(i);
    return (
      <label key={i} className={[s.part, !released && s.partSoon, readOnly && s.partReadOnly].filter(Boolean).join(' ')}>
        <input type="checkbox" checked={on} disabled={!released || readOnly} onChange={(e) => onToggle?.(i, e.target.checked)} />
        <span className={s.partName}>{part.name}</span>
        <span className={s.partYear}>{released ? part.year ?? '' : part.year ? `выйдет в ${part.year}` : 'ещё не вышел'}</span>
      </label>
    );
  };
  return (
    <section className={s.section} aria-labelledby="parts-title">
      <div className={s.sectionHead}>
        <h3 id="parts-title" className={s.sectionTitle}>Сезоны и части</h3>
        <span className={s.sectionNote}>{progressLine(parts, checked)}</span>
      </div>
      {parts.map((part, i) => (part && !part.extra ? row(part, i) : null))}
      {canMarkAll && (
        <button type="button" className={s.markAll} onClick={() => onAllReleased?.()}>
          Отметить все вышедшие ({p.released - p.watched} {plural(p.released - p.watched, 'часть', 'части', 'частей')})
        </button>
      )}
      {extras.length > 0 && (
        <>
          <button type="button" className={s.extrasToggle} aria-expanded={extrasOpen} aria-controls="parts-extras" onClick={() => setExtrasOpen((o) => !o)}>
            Ещё {extras.length}: OVA и спешлы
            <CaretDown size={16} weight="bold" aria-hidden="true" className={extrasOpen ? s.caretOpen : s.caret} />
          </button>
          {extrasOpen && <div id="parts-extras" className={s.extras}>{extras.map(({ part, i }) => row(part, i))}</div>}
        </>
      )}
    </section>
  );
}

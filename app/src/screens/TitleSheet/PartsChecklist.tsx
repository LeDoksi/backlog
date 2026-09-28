import { partsProgress } from '../../lib/storage';
import type { Part } from '../../lib/types';
import { plural } from '../../data/labels';
import s from './TitleSheet.module.css';

interface Props { parts: Part[]; checked: number[]; onToggle: (index: number, checked: boolean) => void; onAllReleased: () => void }

export function progressLine(parts: Part[], checked: number[]): string {
  const p = partsProgress(parts, checked);
  const base = `Просмотрено ${p.watched} из ${p.released}`;
  return p.pending ? `${base}, впереди ещё ${p.pending}` : base;
}

export function PartsChecklist({ parts, checked, onToggle, onAllReleased }: Props) {
  const p = partsProgress(parts, checked);
  const canMarkAll = p.watched < p.released;
  return (
    <section className={s.section} aria-labelledby="parts-title">
      <div className={s.sectionHead}>
        <h3 id="parts-title" className={s.sectionTitle}>Сезоны и части</h3>
        <span className={s.sectionNote}>{progressLine(parts, checked)}</span>
      </div>
      {parts.map((part, i) => {
        const released = part.released !== false;
        const on = released && checked.includes(i);
        return (
          <label key={i} className={released ? s.part : `${s.part} ${s.partSoon}`}>
            <input type="checkbox" checked={on} disabled={!released} onChange={(e) => onToggle(i, e.target.checked)} />
            <span className={s.partName}>{part.name}</span>
            <span className={s.partYear}>{released ? part.year ?? '' : part.year ? `выйдет в ${part.year}` : 'ещё не вышел'}</span>
          </label>
        );
      })}
      {canMarkAll && (
        <button type="button" className={s.markAll} onClick={onAllReleased}>
          Отметить все вышедшие ({p.released - p.watched} {plural(p.released - p.watched, 'часть', 'части', 'частей')})
        </button>
      )}
    </section>
  );
}

import { Reorder, useDragControls } from 'motion/react';
import { DotsSixVertical, Plus, X } from '@phosphor-icons/react';
import { newPart, type FormPart } from './editForm';
import s from './EditTitle.module.css';
import p from './PartsEditor.module.css';

interface Props { parts: FormPart[]; onChange: (v: FormPart[]) => void; error?: string }

export function PartsEditor({ parts, onChange, error }: Props) {
  const released = parts.filter((x) => x.released && (x.name.trim() || x.year.trim())).length;
  const filled = parts.filter((x) => x.name.trim() || x.year.trim()).length;
  const update = (key: number, patch: Partial<FormPart>) => onChange(parts.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  return (
    <div className={s.field}>
      <div className={p.head}>
        <span className={s.label}>Сезоны и части</span>
        {filled > 0 && <span className={p.note}>{released} из {filled} вышло</span>}
      </div>
      <Reorder.Group axis="y" values={parts} onReorder={onChange} className={p.list} as="ul">
        {parts.map((part, i) => <Row key={part.key} part={part} index={i} onPatch={(x) => update(part.key, x)} onRemove={() => onChange(parts.filter((x) => x.key !== part.key))} />)}
      </Reorder.Group>
      {error && <span role="alert" className={s.error}>{error}</span>}
      <button type="button" className={p.add} onClick={() => onChange([...parts, newPart()])}><Plus size={18} aria-hidden="true" />Добавить часть</button>
    </div>
  );
}

function Row({ part, index, onPatch, onRemove }: { part: FormPart; index: number; onPatch: (p: Partial<FormPart>) => void; onRemove: () => void }) {
  const drag = useDragControls();
  return (
    <Reorder.Item value={part} dragListener={false} dragControls={drag} className={part.released ? p.row : `${p.row} ${p.soon}`} as="li">
      <button type="button" className={p.handle} aria-label="Перетащить" onPointerDown={(e) => drag.start(e)}><DotsSixVertical size={20} /></button>
      <input className={p.name} placeholder="Название части" aria-label={`Название части ${index + 1}`} value={part.name} onChange={(e) => onPatch({ name: e.target.value })} />
      <input className={p.yearInput} inputMode="numeric" placeholder="Год" aria-label={`Год части ${index + 1}`} value={part.year} onChange={(e) => onPatch({ year: e.target.value })} />
      <button type="button" aria-pressed={part.released} className={part.released ? `${p.toggle} ${p.out}` : p.toggle} onClick={() => onPatch({ released: !part.released })}>
        {part.released ? 'вышел' : 'не вышел'}
      </button>
      <button type="button" className={p.remove} aria-label={`Удалить часть ${index + 1}`} onClick={onRemove}><X size={16} /></button>
    </Reorder.Item>
  );
}

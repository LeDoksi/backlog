import { useState } from 'react';
import { X } from '@phosphor-icons/react';
import s from './EditTitle.module.css';
import g from './GenresField.module.css';

export function GenresField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  function commit() {
    const name = draft.trim().toLowerCase();
    if (name && !value.includes(name)) onChange([...value, name]);
    setDraft('');
  }

  return (
    <div className={s.field}>
      <span className={s.label} id="genres-label">Жанры</span>
      <div className={g.list} role="group" aria-labelledby="genres-label">
        {value.map((genre) => (
          <span key={genre} className={g.chip}>
            {genre}
            <button type="button" className={g.remove} aria-label={`Убрать жанр ${genre}`} onClick={() => onChange(value.filter((x) => x !== genre))}><X size={14} weight="bold" /></button>
          </span>
        ))}
        {adding ? (
          <input autoFocus className={g.input} placeholder="жанр" aria-label="Новый жанр" value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
              if (e.key === 'Escape') { e.stopPropagation(); setDraft(''); setAdding(false); }
            }}
            onBlur={() => { commit(); setAdding(false); }} />
        ) : (
          <button type="button" className={g.add} onClick={() => setAdding(true)}>+ жанр</button>
        )}
      </div>
    </div>
  );
}

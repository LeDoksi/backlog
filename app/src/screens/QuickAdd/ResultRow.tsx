import { Image, Plus } from '@phosphor-icons/react';
import { CATEGORY_LABEL } from '../../data/labels';
import type { Hit } from '../../data/enrichSearch';
import type { Category } from '../../lib/types';
import s from './QuickAdd.module.css';

export function ResultRow({ hit, category, busy, onAdd }: { hit: Hit; category: Category; busy: boolean; onAdd: () => void }) {
  const name = hit.title || 'Без названия';
  return (
    <div className={s.row}>
      {hit.poster ? <img className={s.poster} src={hit.poster} alt="" loading="lazy" /> : <div className={s.poster}><Image size={20} aria-hidden="true" /></div>}
      <div className={s.rowText}>
        <span className={s.rowTitle}>{name}</span>
        <span className={s.rowMeta}>{[CATEGORY_LABEL[category], hit.year].filter(Boolean).join(', ')}</span>
      </div>
      <button type="button" className={s.add} aria-label={`Добавить «${name}»`} disabled={busy} onClick={onAdd}><Plus size={22} weight="bold" /></button>
    </div>
  );
}

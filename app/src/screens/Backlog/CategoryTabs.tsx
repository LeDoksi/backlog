import { useMemo } from 'react';
import { useFilters, categoryCounts } from '../../data/filters';
import { useTitles } from '../../data/titlesStore';
import { CATEGORY_TAB } from '../../data/labels';
import type { Category } from '../../lib/types';
import s from './CategoryTabs.module.css';

const ORDER: ('all' | Category)[] = ['all', 'anime', 'movie', 'series', 'game'];

export function CategoryTabs() {
  const titles = useTitles((t) => t.titles);
  const category = useFilters((f) => f.category);
  const setFilters = useFilters((f) => f.set);
  const counts = useMemo(() => categoryCounts(titles), [titles]);
  return (
    <nav aria-label="Категории" className={s.row}>
      {ORDER.map((c) => (
        <button key={c} type="button" aria-pressed={c === category} className={c === category ? `${s.tab} ${s.on}` : s.tab}
          onClick={() => setFilters({ category: c })}>
          {CATEGORY_TAB[c]}<span className={s.count}>{counts[c].total}</span>
        </button>
      ))}
    </nav>
  );
}

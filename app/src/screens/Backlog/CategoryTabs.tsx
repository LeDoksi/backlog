import { useMemo } from 'react';
import { useFilters, categoryCounts } from '../../data/filters';
import { useTitles } from '../../data/titlesStore';
import { useOther } from '../../data/otherStore';
import { CATEGORY_TAB } from '../../data/labels';
import type { BoardTab } from '../../data/filters';
import s from './CategoryTabs.module.css';

const ORDER: BoardTab[] = ['all', 'anime', 'movie', 'series', 'game'];

/** `tab` is the one shown: a remembered «Другое» reads as «Всё» once the tab is switched off. */
export function CategoryTabs({ tab, showOther }: { tab: BoardTab; showOther: boolean }) {
  const titles = useTitles((t) => t.titles);
  const setFilters = useFilters((f) => f.set);
  const other = useOther((o) => (o.load === 'ready' ? o.items.length : null));
  const counts = useMemo(() => categoryCounts(titles), [titles]);
  const tabs = showOther ? [...ORDER, 'other' as const] : ORDER;
  return (
    <nav aria-label="Категории" className={s.row}>
      {tabs.map((c) => (
        <button key={c} type="button" aria-pressed={c === tab} className={c === tab ? `${s.tab} ${s.on}` : s.tab}
          onClick={() => setFilters({ category: c })}>
          {CATEGORY_TAB[c]}{c === 'other' ? other !== null && <span className={s.count}>{other}</span> : <span className={s.count}>{counts[c].total}</span>}
        </button>
      ))}
    </nav>
  );
}

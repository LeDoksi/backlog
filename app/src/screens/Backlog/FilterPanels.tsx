import { useMemo } from 'react';
import { Chip } from '../../ui/Chip';
import { Switch } from '../../ui/Switch';
import { Segmented } from '../../ui/Segmented';
import { useFilters, genreCounts, type SortKey } from '../../data/filters';
import { useTitles } from '../../data/titlesStore';
import { STATUS_FILTER } from '../../data/labels';
import type { Status } from '../../lib/types';
import s from './FilterPanels.module.css';

export const SORT_LABEL: Record<SortKey, string> = { status: 'Актуальное', added: 'Добавлено', name: 'Название', year: 'Год' };
const SORTS: SortKey[] = ['status', 'added', 'name', 'year'];
const STATUSES: Status[] = ['in_progress', 'queue', 'done', 'unreleased'];

export function GenresPanel() {
  const titles = useTitles((t) => t.titles);
  const category = useFilters((f) => f.category);
  const selected = useFilters((f) => f.genres);
  const setFilters = useFilters((f) => f.set);
  const list = useMemo(() => genreCounts(titles, category), [titles, category]);
  const toggle = (g: string) => setFilters({ genres: selected.includes(g) ? selected.filter((x) => x !== g) : [...selected, g] });
  return (
    <>
      <div className={s.head}>
        <h2 id="genres-title" className={s.title}>Жанры</h2>
        <span className={s.hint}>любой из выбранных</span>
      </div>
      {list.length === 0 ? <p className={s.empty}>На этой вкладке жанров пока нет.</p> : (
        <div role="group" aria-label="Жанры" className={s.chips}>
          {list.map(({ genre, count }) => (
            <Chip key={genre} selected={selected.includes(genre)} count={count} onClick={() => toggle(genre)} className={s.chip}>{genre}</Chip>
          ))}
        </div>
      )}
    </>
  );
}

export function FiltersPanel({ withSort }: { withSort: boolean }) {
  const f = useFilters();
  const toggle = (st: Status) => f.set({ statuses: f.statuses.includes(st) ? f.statuses.filter((x) => x !== st) : [...f.statuses, st] });
  return (
    <>
      <div className={s.head}><h2 id="filters-title" className={s.title}>Фильтры</h2></div>
      <h3 className={s.section}>Статус</h3>
      <div role="group" aria-label="Статус" className={s.chips}>
        {STATUSES.map((st) => <Chip key={st} selected={f.statuses.includes(st)} onClick={() => toggle(st)} className={s.chip}>{STATUS_FILTER[st]}</Chip>)}
      </div>
      <div className={s.switches}>
        <Switch label="Ещё выходит" hint="Есть анонсированные сезоны" checked={f.stillAiring} onChange={(v) => f.set({ stillAiring: v })} />
        <Switch label="Скрыть завершённое" checked={f.hideDone} onChange={(v) => f.set({ hideDone: v })} />
      </div>
      {withSort && (
        <>
          <h3 className={s.section}>Сортировка</h3>
          <Segmented label="Сортировка" value={f.sort} onChange={(v) => f.set({ sort: v })}
            options={SORTS.map((v) => ({ value: v, label: SORT_LABEL[v] }))} />
        </>
      )}
    </>
  );
}

export function SortList({ onPick }: { onPick: () => void }) {
  const sort = useFilters((f) => f.sort);
  const setFilters = useFilters((f) => f.set);
  return (
    <div role="radiogroup" aria-label="Сортировка" className={s.sortList}>
      {SORTS.map((v) => (
        <button key={v} type="button" role="radio" aria-checked={v === sort} className={v === sort ? `${s.sortItem} ${s.sortOn}` : s.sortItem}
          onClick={() => { setFilters({ sort: v }); onPick(); }}>{SORT_LABEL[v]}</button>
      ))}
    </div>
  );
}

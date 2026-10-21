import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useOther } from '../../data/otherStore';
import { useFilters } from '../../data/filters';
import { plural } from '../../data/labels';
import { OTHER_STATUS_LABEL, otherCategories, visibleOther, type OtherItem, type OtherStatus } from '../../lib/other';
import { Chip } from '../../ui/Chip';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Skeleton } from '../../ui/Skeleton';
import { OtherSheet } from './OtherSheet';
import { OtherForm } from './OtherForm';
import s from './Other.module.css';

const STATUSES: OtherStatus[] = ['want', 'done'];

export function OtherPill({ status }: { status: OtherStatus }) {
  return <span className={`${s.pill} ${status === 'done' ? s.done : s.want}`}><span className={s.pillDot} />{OTHER_STATUS_LABEL[status]}</span>;
}

function Row({ item, onOpen }: { item: OtherItem; onOpen(): void }) {
  const meta = [item.category, item.rating != null ? `оценка ${item.rating}` : null].filter(Boolean).join(' · ');
  return (
    <button type="button" className={s.row} onClick={onOpen}>
      <span className={s.rowText}>
        <span className={s.rowTitle}>{item.title}</span>
        <span className={s.rowMeta}>{meta}</span>
      </span>
      <OtherPill status={item.status} />
    </button>
  );
}

// «Другое» (BL-119): hand-made lines, filtered by the board's own
// categories (from two on) and by «Хочу»/«Готово». The board's search field
// works here too.
export function OtherTab() {
  const items = useOther((o) => o.items);
  const load = useOther((o) => o.load);
  const boardId = useOther((o) => o.boardId);
  const search = useFilters((f) => f.search);
  const [category, setCategory] = useState<string | null>(null);
  const [status, setStatus] = useState<OtherStatus | null>(null);
  const reduce = useReducedMotion();

  const categories = useMemo(() => otherCategories(items), [items]);
  // A category whose last line went away stops filtering.
  const cat = category && categories.some((c) => c.name.toLowerCase() === category.toLowerCase()) ? category : null;
  const inCategory = cat ? items.filter((i) => i.category.toLowerCase() === cat.toLowerCase()) : items;
  const shown = useMemo(() => visibleOther(items, { category: cat, status, search }), [items, cat, status, search]);
  const add = () => useOther.getState().openForm({});

  let content;
  if (load === 'loading' || (load === 'idle' && items.length === 0)) {
    content = <div className={s.rows}>{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} kind="row" />)}</div>;
  } else if (load === 'error') {
    content = <EmptyState title="Не получилось загрузить" text="«Другое» работает только с сетью. Проверь её и попробуй ещё раз."
      action={<Button variant="tonal" onClick={() => void useOther.getState().fetch(boardId)}>Повторить</Button>} />;
  } else if (items.length === 0) {
    content = <EmptyState title="Здесь пока пусто" text="Сюда можно записать то, чего нет в поиске: книги, рестораны, спектакли."
      action={<Button onClick={add}>Добавить запись</Button>} />;
  } else if (shown.length === 0) {
    content = <EmptyState title="Ничего не нашлось" text="Попробуй другой запрос или сбрось фильтры."
      action={<Button variant="tonal" onClick={() => { setCategory(null); setStatus(null); useFilters.getState().set({ search: '' }); }}>Сбросить фильтры</Button>} />;
  } else {
    content = (
      <ul className={s.list} aria-label="Записи" key={`${boardId}:${cat}:${status}`}>
        {shown.map((item, i) => (
          <motion.li key={item.id} initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.26, delay: Math.min(i, 12) * 0.02 }}>
            <Row item={item} onOpen={() => useOther.getState().open(item.id)} />
          </motion.li>
        ))}
      </ul>
    );
  }

  return (
    <>
      {load === 'ready' && items.length > 0 && (
        <div className={s.chips} role="group" aria-label="Фильтры «Другого»">
          {categories.length >= 2 && (
            <>
              {categories.map((c) => {
                const on = cat?.toLowerCase() === c.name.toLowerCase();
                return <Chip key={c.name} selected={on} count={c.count} onClick={() => setCategory(on ? null : c.name)}>{c.name}</Chip>;
              })}
              <span className={s.sep} aria-hidden="true" />
            </>
          )}
          {STATUSES.map((st) => (
            <Chip key={st} selected={status === st} count={inCategory.filter((i) => i.status === st).length}
              onClick={() => setStatus(status === st ? null : st)}>{OTHER_STATUS_LABEL[st]}</Chip>
          ))}
        </div>
      )}
      <p className="sr-only" aria-live="polite">Показано {shown.length} {plural(shown.length, 'запись', 'записи', 'записей')}</p>
      {content}
      <OtherSheet />
      <OtherForm />
    </>
  );
}

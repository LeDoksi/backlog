import { useMemo } from 'react';
import { useTitles } from '../../data/titlesStore';
import { useFilters, visibleTitles } from '../../data/filters';
import { useUi } from '../../data/ui';
import { plural } from '../../data/labels';
import { EmptyState } from '../../ui/EmptyState';
import { Skeleton } from '../../ui/Skeleton';
import { Button } from '../../ui/Button';
import { BacklogHeader } from './BacklogHeader';
import { CategoryTabs } from './CategoryTabs';
import { FilterChips } from './FilterChips';
import { TitleGrid } from './TitleGrid';
import s from './Backlog.module.css';

export function Backlog() {
  const titles = useTitles((t) => t.titles);
  const loading = useTitles((t) => t.loading);
  const boardId = useTitles((t) => t.boardId);
  const filters = useFilters();
  const setQuickAdd = useUi((u) => u.setQuickAdd);
  const shown = useMemo(() => visibleTitles(titles, filters), [titles, filters]);

  let content;
  if (loading && titles.length === 0) {
    content = <div className={s.skeletons}>{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} kind="card" />)}</div>;
  } else if (titles.length === 0) {
    content = <EmptyState title="Здесь пока пусто" text="Добавь первый фильм, сериал, аниме или игру."
      action={<Button onClick={() => setQuickAdd(true)}>Добавить тайтл</Button>} />;
  } else if (shown.length === 0) {
    content = <EmptyState title="Ничего не нашлось" text="Попробуй другой запрос или сбрось фильтры."
      action={<Button variant="tonal" onClick={() => filters.reset()}>Сбросить фильтры</Button>} />;
  } else {
    content = <TitleGrid titles={shown} animateKey={`${boardId}:${filters.category}`} />;
  }

  return (
    <div className={s.screen}>
      <div className={s.glow} aria-hidden="true" />
      <header className={s.header}>
        <BacklogHeader />
        <CategoryTabs />
        <FilterChips shown={shown.length} />
      </header>
      <p className="sr-only" aria-live="polite">Показано {shown.length} {plural(shown.length, 'тайтл', 'тайтла', 'тайтлов')}</p>
      {content}
    </div>
  );
}

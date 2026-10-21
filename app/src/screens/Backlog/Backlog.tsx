import { lazy, Suspense, useEffect, useMemo } from 'react';
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
import { FriendsColumn } from './FriendsColumn';
import { useSocial } from '../../data/socialStore';
import { titleKey } from '../../data/friendsOn';
import { useMediaQuery } from '../../ui/useMediaQuery';
import { useOther } from '../../data/otherStore';
import s from './Backlog.module.css';

// «Другое» loads on first open: most people never switch it on.
const OtherTab = lazy(() => import('../Other/OtherTab').then((m) => ({ default: m.OtherTab })));

export function Backlog({ showOther = false }: { showOther?: boolean }) {
  const titles = useTitles((t) => t.titles);
  const checked = useTitles((t) => t.checked);
  const loading = useTitles((t) => t.loading);
  const boardId = useTitles((t) => t.boardId);
  const filters = useFilters();
  const tab = filters.category === 'other' && !showOther ? 'all' : filters.category;
  const setQuickAdd = useUi((u) => u.setQuickAdd);
  const shown = useMemo(() => visibleTitles(titles, { ...filters, category: tab }, checked), [titles, filters, tab, checked]);
  const wide = useMediaQuery('(min-width: 1280px)');
  // One request for the whole board, not per filter: the store skips a key set it already has.
  const keys = useMemo(() => titles.map(titleKey), [titles]);
  useEffect(() => { if (keys.length) void useSocial.getState().loadFriendsOn(keys); }, [keys]);
  // «Другое» is read online only: on board change and when the app comes back.
  useEffect(() => {
    const other = useOther.getState();
    if (!showOther) { other.reset(); return; }
    const read = () => { if (document.visibilityState === 'visible') void useOther.getState().fetch(boardId); };
    read();
    document.addEventListener('visibilitychange', read);
    return () => document.removeEventListener('visibilitychange', read);
  }, [showOther, boardId]);

  let content;
  if (tab === 'other') {
    content = <Suspense fallback={<div className={s.rows}>{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} kind="row" />)}</div>}><OtherTab /></Suspense>;
  } else if (loading && titles.length === 0) {
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

  const main = (
    <div className={s.screen}>
      <div className={s.glow} aria-hidden="true" />
      <header className={s.header}>
        <BacklogHeader />
        <CategoryTabs tab={tab} showOther={showOther} />
        {tab !== 'other' && <FilterChips shown={shown.length} />}
      </header>
      {tab !== 'other' && <p className="sr-only" aria-live="polite">Показано {shown.length} {plural(shown.length, 'тайтл', 'тайтла', 'тайтлов')}</p>}
      {content}
    </div>
  );
  if (!wide) return main;
  return <div className={s.layout}><div className={s.main}>{main}</div><FriendsColumn /></div>;
}

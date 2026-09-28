import { useRef, useState } from 'react';
import { ArrowsDownUp, DiceFive, SlidersHorizontal } from '@phosphor-icons/react';
import { Chip } from '../../ui/Chip';
import { Sheet } from '../../ui/Sheet';
import { Popover } from '../../ui/Popover';
import { Button } from '../../ui/Button';
import { useIsDesktop } from '../../ui/useMediaQuery';
import { useFilters, activeFilterCount } from '../../data/filters';
import { useTitles } from '../../data/titlesStore';
import { pickNext } from '../../data/randomPick';
import { openTitle } from '../../data/ui';
import { plural } from '../../data/labels';
import { FiltersPanel, GenresPanel, SortList, SORT_LABEL } from './FilterPanels';
import s from './FilterChips.module.css';

type Panel = 'genres' | 'filters' | 'sort' | null;

export function FilterChips({ shown }: { shown: number }) {
  const f = useFilters();
  const titles = useTitles((t) => t.titles);
  const checked = useTitles((t) => t.checked);
  const desktop = useIsDesktop();
  const [panel, setPanel] = useState<Panel>(null);
  const [randomNote, setRandomNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const genresRef = useRef<HTMLDivElement>(null);
  const filtersRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

  const inCategory = titles.filter((t) => f.category === 'all' || t.category === f.category);
  const inProgress = inCategory.filter((t) => t.status === 'in_progress').length;
  const progressOn = f.statuses.length === 1 && f.statuses[0] === 'in_progress';
  const games = f.category === 'game';
  const count = activeFilterCount(f);

  function flash(text: string) {
    setRandomNote(text);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setRandomNote(null), 1800);
  }

  function random() {
    if (games) { flash('Игры не смотрят'); return; }
    const pick = pickNext(titles, f.category, (id) => checked[id] ?? []);
    if (!pick) { flash('Тут всё посмотрено'); return; }
    openTitle(pick.id);
  }

  const close = () => setPanel(null);
  const showN = `Показать ${shown}`;
  const footer = (
    <>
      <Button variant="neutral" className={s.footBtn} onClick={() => (panel === 'genres' ? f.set({ genres: [] }) : f.reset())}>Сбросить</Button>
      <Button className={s.footBtn} onClick={close}>{showN}</Button>
    </>
  );

  return (
    <div className={s.row}>
      <div className={s.chips}>
        <Chip tone="accent" icon={<DiceFive size={18} aria-hidden="true" />} onClick={random}
          aria-disabled={games || undefined} title={games ? 'Игры не смотрят' : undefined} className={games ? s.dim : undefined}>
          <span aria-live="polite">{randomNote ?? 'Что посмотреть?'}</span>
        </Chip>
        <Chip selected={progressOn} onClick={() => f.set({ statuses: progressOn ? [] : ['in_progress'] })}>В процессе {inProgress}</Chip>
        <Chip selected={f.stillAiring} onClick={() => f.set({ stillAiring: !f.stillAiring })}>Ещё выходит</Chip>
        <div className={s.anchor} ref={genresRef}>
          <Chip selected={f.genres.length > 0} aria-haspopup="dialog" aria-expanded={panel === 'genres'}
            onClick={() => setPanel(panel === 'genres' ? null : 'genres')}>
            Жанры{f.genres.length > 0 && ` · ${f.genres.length}`}
          </Chip>
          {desktop && (
            <Popover open={panel === 'genres'} onClose={close} anchor={genresRef} label="Жанры" footer={footer}><GenresPanel /></Popover>
          )}
        </div>
        <div className={s.anchor} ref={filtersRef}>
          <Chip selected={count > 0} aria-haspopup="dialog" aria-expanded={panel === 'filters'} aria-label={count ? `Фильтры, активно ${count}` : 'Фильтры'}
            icon={<SlidersHorizontal size={18} aria-hidden="true" />} onClick={() => setPanel(panel === 'filters' ? null : 'filters')}>
            {count > 0 ? String(count) : null}
          </Chip>
          {desktop && (
            <Popover open={panel === 'filters'} onClose={close} anchor={filtersRef} label="Фильтры" footer={footer}><FiltersPanel withSort={false} /></Popover>
          )}
        </div>
      </div>
      {desktop && (
        <div className={s.right}>
          <span className={s.shown}>{shown} {plural(shown, 'тайтл', 'тайтла', 'тайтлов')}</span>
          <div className={s.anchor} ref={sortRef}>
            <button type="button" className={s.sortBtn} aria-haspopup="dialog" aria-expanded={panel === 'sort'} onClick={() => setPanel(panel === 'sort' ? null : 'sort')}>
              <ArrowsDownUp size={18} aria-hidden="true" />{SORT_LABEL[f.sort]}
            </button>
            <Popover open={panel === 'sort'} onClose={close} anchor={sortRef} label="Сортировка" align="end"><SortList onPick={close} /></Popover>
          </div>
        </div>
      )}
      {!desktop && (
        <>
          <Sheet open={panel === 'genres'} onClose={close} labelledBy="genres-title" footer={footer}><GenresPanel /></Sheet>
          <Sheet open={panel === 'filters'} onClose={close} labelledBy="filters-title" footer={footer}><FiltersPanel withSort /></Sheet>
        </>
      )}
    </div>
  );
}

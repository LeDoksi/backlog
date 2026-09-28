import { useEffect, useRef, useState } from 'react';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { useFilters } from '../../data/filters';
import { useBoards } from '../../data/boardsStore';
import { BoardSwitch } from './BoardSwitch';
import s from './BacklogHeader.module.css';

// The field keeps its own value and hands it to the filter store after a
// pause, so a fast typist does not rebuild the grid on every key.
const DEBOUNCE_MS = 200;

export function BacklogHeader() {
  const search = useFilters((f) => f.search);
  const setFilters = useFilters((f) => f.set);
  const [open, setOpen] = useState(search !== '');
  const [value, setValue] = useState(search);
  const input = useRef<HTMLInputElement>(null);
  const twoBoards = useBoards((b) => b.boards.length > 1);
  const pushed = useRef(search);

  // "Сбросить фильтры" clears the search from outside; the field follows.
  useEffect(() => {
    if (search === pushed.current) return;
    pushed.current = search;
    setValue(search);
  }, [search]);

  useEffect(() => {
    if (value === pushed.current) return;
    const id = setTimeout(() => { pushed.current = value; setFilters({ search: value }); }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [value, setFilters]);

  useEffect(() => { if (open) input.current?.focus(); }, [open]);

  function close() {
    pushed.current = '';
    setValue('');
    setFilters({ search: '' });
    setOpen(false);
  }

  return (
    <div className={s.row}>
      {open ? (
        <div className={s.field}>
          <MagnifyingGlass size={20} aria-hidden="true" className={s.fieldIcon} />
          <input ref={input} type="search" className={s.input} placeholder="Найти в бэклоге" aria-label="Поиск по названию"
            value={value} onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') close(); }} />
          <button type="button" className={s.clear} aria-label="Закрыть поиск" onClick={close}><X size={18} /></button>
        </div>
      ) : (
        <>
          {twoBoards ? <><h1 className="sr-only">Бэклог</h1><BoardSwitch /></> : <h1 className={s.title}>Бэклог</h1>}
          <button type="button" className={s.round} aria-label="Поиск" onClick={() => setOpen(true)}><MagnifyingGlass size={21} /></button>
        </>
      )}
    </div>
  );
}

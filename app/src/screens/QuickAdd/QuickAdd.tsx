import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { useUi } from '../../data/ui';
import { useTitles } from '../../data/titlesStore';
import { busy } from '../../data/busy';
import { search, details, providerFor, PROVIDER_LABEL, type Hit } from '../../data/enrichSearch';
import { buildTitle } from '../../data/newTitle';
import { useHistoryEntry } from '../../ui/history';
import { useVisualViewport } from '../../ui/useVisualViewport';
import { lockScroll } from '../../ui/scrollLock';
import { useIsDesktop } from '../../ui/useMediaQuery';
import type { Category } from '../../lib/types';
import { CATEGORY_OPTIONS } from '../../data/labels';
import { ResultRow } from './ResultRow';
import s from './QuickAdd.module.css';

const DEBOUNCE_MS = 350;

export function QuickAdd() {
  const open = useUi((u) => u.quickAddOpen);
  const reduce = useReducedMotion();
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div key="qa" className={s.root} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.18 }}>
          <Panel />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

type State = { kind: 'idle' } | { kind: 'loading' } | { kind: 'hits'; hits: Hit[] } | { kind: 'error'; text: string };

function Panel() {
  const setQuickAdd = useUi((u) => u.setQuickAdd);
  const close = () => setQuickAdd(false);
  const addTitle = useTitles((t) => t.addTitle);
  const [category, setCategory] = useState<Category>('movie');
  const [query, setQuery] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const token = useRef(0);
  const vv = useVisualViewport();
  const desktop = useIsDesktop();
  const reduce = useReducedMotion();

  useHistoryEntry(true, close);
  useEffect(() => {
    busy.enter('quick-add');
    input.current?.focus({ preventScroll: true });
    const unlock = lockScroll();
    return () => { busy.leave('quick-add'); unlock(); };
  }, []);

  // Every new query or category supersedes the one in flight; a slow older
  // response must never paint over a fresher one.
  useEffect(() => {
    const q = query.trim();
    const run = ++token.current;
    if (q.length < 2) { setState({ kind: 'idle' }); return; }
    setState({ kind: 'loading' });
    const id = setTimeout(async () => {
      const res = await search(category, q);
      if (run !== token.current) return;
      if (!res.ok) setState({ kind: 'error', text: 'Поиск сейчас недоступен. Можно добавить вручную.' });
      else setState({ kind: 'hits', hits: res.hits.slice(0, 5) });
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query, category]);

  function done(name: string) {
    setNote({ text: `Добавлено: «${name}»`, tone: 'ok' });
    setQuery('');
    input.current?.focus();
  }

  function add(built: ReturnType<typeof buildTitle>) {
    if (built === 'duplicate' || addTitle(built) === 'duplicate') {
      setNote({ text: 'Этот тайтл уже есть в бэклоге', tone: 'error' });
      return;
    }
    done(built.title);
  }

  async function pick(hit: Hit) {
    const key = `${hit.provider}:${hit.id}`;
    setBusyId(key);
    setNote(null);
    const d = await details(hit);
    setBusyId(null);
    // Details can fail on their own (a proxy hiccup): the hit itself still
    // carries a name, year and poster worth keeping.
    const picked = d ?? { title: hit.title, year: hit.year, cover: hit.poster, source: hit.provider, sourceId: String(hit.id) };
    add(buildTitle(category, query, picked, useTitles.getState().titles, useTitles.getState().leftoverIds()));
  }

  function manual() {
    const name = query.trim();
    if (!name) return;
    setNote(null);
    add(buildTitle(category, name, {}, useTitles.getState().titles, useTitles.getState().leftoverIds()));
  }

  const style = desktop ? undefined : { top: vv.offsetTop + 44, maxHeight: Math.max(240, vv.height - 56) };

  return (
    <>
      <div className={s.scrim} onClick={close} />
      <motion.div role="dialog" aria-modal="true" aria-labelledby="qa-title" className={s.panel} style={style}
        initial={reduce ? false : { y: -16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}>
        <div className={s.head}>
          <h2 id="qa-title" className={s.title}>Добавить тайтл</h2>
          <button type="button" className={s.close} aria-label="Закрыть" onClick={close}><X size={20} /></button>
        </div>
        <div role="radiogroup" aria-label="Категория" className={s.cats}>
          {CATEGORY_OPTIONS.map((c) => (
            <button key={c.value} type="button" role="radio" aria-checked={c.value === category}
              className={c.value === category ? `${s.cat} ${s.catOn}` : s.cat}
              onClick={() => { setCategory(c.value); input.current?.focus(); }}>{c.label}</button>
          ))}
        </div>
        <form className={s.field} onSubmit={(e) => { e.preventDefault(); manual(); }}>
          <MagnifyingGlass size={20} aria-hidden="true" className={s.fieldIcon} />
          <input ref={input} className={s.input} aria-label="Название" placeholder="Название" enterKeyHint="done"
            value={query} onChange={(e) => { setQuery(e.target.value); setNote(null); }} />
          <span className={s.provider}>{PROVIDER_LABEL[providerFor(category)]}</span>
        </form>
        <p className={note?.tone === 'error' ? `${s.note} ${s.noteError}` : s.note} role={note?.tone === 'error' ? 'alert' : 'status'}>{note?.text ?? ''}</p>
        <div className={s.results}>
          {state.kind === 'loading' && <p className={s.muted}>Ищу…</p>}
          {state.kind === 'error' && <p className={s.muted}>{state.text}</p>}
          {state.kind === 'hits' && state.hits.length === 0 && <p className={s.muted}>Ничего не нашлось.</p>}
          {state.kind === 'hits' && state.hits.map((h) => (
            <ResultRow key={`${h.provider}:${h.id}`} hit={h} category={category} busy={busyId === `${h.provider}:${h.id}`} onAdd={() => void pick(h)} />
          ))}
          {query.trim() && (
            <button type="button" className={s.manual} onClick={manual}>Нет нужного? Добавить «{query.trim()}» вручную</button>
          )}
        </div>
      </motion.div>
    </>
  );
}

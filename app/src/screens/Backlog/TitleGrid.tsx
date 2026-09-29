import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useTitles } from '../../data/titlesStore';
import type { Title } from '../../lib/types';
import { TitleCard } from './TitleCard';
import { useSocial } from '../../data/socialStore';
import { byPriority, titleKey } from '../../data/friendsOn';
import s from './TitleGrid.module.css';

// A quick status change can move a card (the default sort is by status), and
// moving cards under a resting pointer or finger is how the next tap lands on
// a title nobody aimed at. So after a change from inside the grid, the order
// and membership are held until the person leaves the grid.
export function TitleGrid({ titles, animateKey }: { titles: Title[]; animateKey: string }) {
  const all = useTitles((t) => t.titles);
  const checked = useTitles((t) => t.checked);
  const friendsOn = useSocial((st) => st.friendsOn);
  const [held, setHeld] = useState<string[] | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const shownRef = useRef<Title[]>(titles);

  const shown = useMemo(() => {
    if (!held) return titles;
    const byId = new Map(all.map((t) => [t.id, t]));
    return held.map((id) => byId.get(id)).filter((t): t is Title => !!t);
  }, [held, titles, all]);
  shownRef.current = shown;

  const hold = useCallback(() => setHeld((h) => h ?? shownRef.current.map((t) => t.id)), []);

  useEffect(() => {
    if (!held) return;
    const release = () => setHeld(null);
    const onDown = (e: PointerEvent) => { if (!grid.current?.contains(e.target as Node)) release(); };
    const el = grid.current;
    const onLeave = (e: PointerEvent) => { if (e.pointerType === 'mouse') release(); };
    const onFocusOut = (e: FocusEvent) => { if (e.relatedTarget && !el?.contains(e.relatedTarget as Node)) release(); };
    document.addEventListener('pointerdown', onDown);
    el?.addEventListener('pointerleave', onLeave);
    el?.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      el?.removeEventListener('pointerleave', onLeave);
      el?.removeEventListener('focusout', onFocusOut);
    };
  }, [held]);

  return (
    <div ref={grid} className={s.grid} key={animateKey}>
      {shown.map((t, i) => (
        <motion.div key={t.id} initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.26, delay: Math.min(i, 12) * 0.02 }}>
          <TitleCard title={t} checked={checked[t.id]} friend={byPriority(friendsOn[titleKey(t)])[0]} onQuickChange={hold} />
        </motion.div>
      ))}
    </div>
  );
}

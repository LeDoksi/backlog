import { useEffect } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useUi } from '../data/ui';
import s from './Toast.module.css';

const SHOW_MS = 6000;

export function Toast() {
  const text = useUi((u) => u.toast);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!text) return;
    const t = window.setTimeout(() => useUi.getState().showToast(null), SHOW_MS);
    return () => window.clearTimeout(t);
  }, [text]);
  return (
    <div className={s.wrap} role="status" aria-live="polite">
      <AnimatePresence>
        {text && (
          <motion.button type="button" key={text} className={s.toast} onClick={() => useUi.getState().showToast(null)}
            initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduce ? 0 : 16 }}
            transition={{ duration: reduce ? 0 : 0.2 }}>
            {text}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

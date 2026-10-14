import { useEffect } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { TOAST_MS, useUi } from '../data/ui';
import s from './Toast.module.css';

export function Toast() {
  const toast = useUi((u) => u.toast);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => useUi.getState().showToast(null), TOAST_MS);
    return () => window.clearTimeout(t);
  }, [toast]);
  const hide = () => useUi.getState().showToast(null);
  return (
    <div className={s.wrap} role="status" aria-live="polite">
      <AnimatePresence>
        {toast && (
          <motion.div key={toast.n} className={toast.action ? `${s.toast} ${s.withAction}` : s.toast}
            initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduce ? 0 : 16 }}
            transition={{ duration: reduce ? 0 : 0.2 }}>
            <button type="button" className={s.text} onClick={hide}>{toast.text}</button>
            {toast.action && (
              <button type="button" className={s.action} onClick={() => { toast.action!.run(); hide(); }}>{toast.action.label}</button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

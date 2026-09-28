import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import s from './Sheet.module.css';

interface Props { open: boolean; onClose: () => void; labelledBy: string; children: ReactNode; footer?: ReactNode }

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])';

// Pops this module triggered itself while tearing a sheet down. Their
// popstate arrives asynchronously, possibly after another sheet (or the same
// one, remounted by StrictMode) has registered its listener, and must not be
// read as the user pressing Back.
let selfPops = 0;
let lastPopWasSelf = false;
// Registered at import, so it runs before any sheet's own listener and the
// count drains even when no sheet is open to hear the pop.
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    lastPopWasSelf = selfPops > 0;
    if (lastPopWasSelf) selfPops -= 1;
  });
}

export function Sheet({ open, onClose, labelledBy, children, footer }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const reduce = useReducedMotion();

  // Keyed on `open` only: callers pass inline `onClose` arrows, and re-running
  // this on every render would pop and re-push history while the sheet is up.
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();
    document.body.style.overflow = 'hidden';
    history.pushState({ sheet: true }, '');
    const onPop = () => {
      if (!lastPopWasSelf) close.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      document.body.style.overflow = '';
      if (history.state && history.state.sheet) { selfPops += 1; history.back(); }
      opener.current?.focus();
    };
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab' || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0]!, last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className={s.root} onKeyDown={onKeyDown}>
          <motion.div className={s.scrim} onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.2 }} />
          <motion.div ref={panel} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} className={s.panel}
            initial={reduce ? false : { y: '100%' }} animate={{ y: 0 }} exit={reduce ? { opacity: 0 } : { y: '100%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            drag={reduce ? false : 'y'} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => { if (info.offset.y > 120) onClose(); }}>
            <div className={s.handle} aria-hidden="true" />
            <div className={s.body}>{children}</div>
            {footer && <div className={s.footer}>{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import s from './Popover.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLElement | null>;
  label: string;
  align?: 'start' | 'end';
  children: ReactNode;
  footer?: ReactNode;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

// The desktop stand-in for a bottom sheet: anchored under the chip that
// opened it, closed by Esc or a click anywhere outside it and the chip.
export function Popover({ open, onClose, anchor, label, align = 'start', children, footer }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      close.current();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close.current(); } };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      if (panel.current?.contains(document.activeElement) || document.activeElement === document.body) opener?.focus();
    };
  }, [open, anchor]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div ref={panel} role="dialog" aria-label={label} className={`${s.pop} ${align === 'end' ? s.end : ''}`}
          initial={reduce ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.16 }}>
          <div className={s.body}>{children}</div>
          {footer && <div className={s.footer}>{footer}</div>}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

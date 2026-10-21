import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useHistoryEntry } from './history';
import { useIsDesktop } from './useMediaQuery';
import { lockScroll } from './scrollLock';
import { useVisualViewport, type ViewportSize } from './useVisualViewport';
import s from './Sheet.module.css';

interface Props { open: boolean; onClose: () => void; labelledBy: string; children: ReactNode; footer?: ReactNode }

/**
 * With the on-screen keyboard up (iOS keeps the window full height and
 * shrinks only the visual viewport), a panel pinned to the window bottom
 * sits behind the keyboard and Safari pans the page to the focused field,
 * pushing the panel's top out of view. So while a keyboard is up the panel
 * is laid over exactly what is visible: its fields scroll inside it and the
 * buttons rest on the keyboard. Same measure as QuickAdd's layout.
 */
export function keyboardPanelStyle(v: ViewportSize): { top: number; bottom: 'auto'; maxHeight: number } | undefined {
  const keyboard = v.layoutHeight - v.height - v.offsetTop;
  if (keyboard <= 120) return undefined;
  return { top: v.offsetTop + 8, bottom: 'auto', maxHeight: v.height - 8 };
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])';

export function Sheet({ open, onClose, labelledBy, children, footer }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const reduce = useReducedMotion();
  // A centred modal slid down by its own height is still half on screen, so
  // on desktop the panel fades and settles instead of sliding.
  const desktop = useIsDesktop();
  const vv = useVisualViewport();
  const keyboardStyle = desktop ? undefined : keyboardPanelStyle(vv);
  const motionProps = reduce
    ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0 } }
    : desktop
      ? { initial: { opacity: 0, scale: 0.96, y: 16 }, animate: { opacity: 1, scale: 1, y: 0 }, exit: { opacity: 0, scale: 0.96, y: 16 }, transition: { duration: 0.18, ease: 'easeOut' as const } }
      : { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' }, transition: { type: 'spring' as const, stiffness: 420, damping: 34 } };

  useHistoryEntry(open, () => close.current());

  // The panel just shrank to the space above the keyboard: keep the field being typed in on screen.
  const keyboardTop = keyboardStyle?.top;
  useEffect(() => {
    if (keyboardTop === undefined) return;
    const el = document.activeElement;
    if (el instanceof HTMLElement && panel.current?.contains(el)) el.scrollIntoView({ block: 'nearest' });
  }, [keyboardTop]);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    // Without preventScroll, iOS pans the page to where the field is at this
    // moment, below the screen at the start of the slide-in; the panel then
    // settles above the visible area (BL-119: «Название» out of view).
    (first ?? panel.current)?.focus({ preventScroll: true });
    const unlock = lockScroll();
    return () => {
      unlock();
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
          <motion.div ref={panel} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} className={s.panel} style={keyboardStyle}
            {...motionProps}
            drag={reduce || desktop ? false : 'y'} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }}
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

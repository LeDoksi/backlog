import { useRef, type PointerEvent as RPointerEvent, type MouseEvent as RMouseEvent } from 'react';

interface Options { ms?: number; moveTolerance?: number }

// A long press that yields to scrolling: the moment the finger travels more
// than a few pixels the press is a scroll, not a hold. After it fires, the
// click the browser sends on release is swallowed, so a hold never also
// opens whatever a tap would have opened.
export function useLongPress(onLongPress: () => void, { ms = 500, moveTolerance = 10 }: Options = {}) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cb = useRef(onLongPress);
  cb.current = onLongPress;

  const cancel = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    start.current = null;
  };

  return {
    onPointerDown(e: RPointerEvent) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        fired.current = true;
        start.current = null;
        cb.current();
      }, ms);
    },
    onPointerMove(e: RPointerEvent) {
      if (!start.current) return;
      if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > moveTolerance) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClickCapture(e: RMouseEvent) {
      if (fired.current) { e.preventDefault(); e.stopPropagation(); fired.current = false; }
    },
    onContextMenu(e: RMouseEvent) {
      // Touch browsers open their own long-press menu on images and links.
      if (start.current || fired.current) e.preventDefault();
    }
  };
}

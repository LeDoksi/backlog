// iOS Safari ignores `overflow: hidden` on the body for touch, so a swipe on
// a panel's backdrop (or on a panel with nothing to scroll) moves the page
// behind it. While any panel is open, touch scrolling is cancelled unless the
// finger is on something that can scroll by itself, like a list inside the
// panel. The body style still covers the mouse wheel on desktop.
let locks = 0;

function canScroll(el: Element | null): boolean {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return true;
  }
  return false;
}

function onTouchMove(e: Event) {
  if (!canScroll(e.target instanceof Element ? e.target : null)) e.preventDefault();
}

/** Blocks page scrolling until every returned release has been called. */
export function lockScroll(): () => void {
  if (locks++ === 0) {
    document.body.style.overflow = 'hidden';
    document.addEventListener('touchmove', onTouchMove, { passive: false });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--locks === 0) {
      document.body.style.overflow = '';
      document.removeEventListener('touchmove', onTouchMove);
    }
  };
}

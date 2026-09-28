export interface ViewportSize { layoutHeight: number; height: number; offsetTop: number }
export interface QuickAddLayout { top: number; keyboard: number; compact: boolean }

// iOS keeps the window full height under the keyboard and shrinks only the
// visual viewport, so what lies below the visual viewport is the keyboard.
// The panel hugs the top of what is visible; with a keyboard up it drops its
// heading row and lets the results run on behind the keyboard, padded by the
// keyboard's height so any row can be scrolled up into view.
export function quickAddLayout(v: ViewportSize): QuickAddLayout {
  const keyboard = Math.max(0, Math.round(v.layoutHeight - v.height - v.offsetTop));
  return { top: v.offsetTop + 8, keyboard, compact: keyboard > 120 };
}

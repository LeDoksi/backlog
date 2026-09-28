import { useEffect, useRef } from 'react';

// An open panel owns one history entry, so the phone's Back button closes the
// panel instead of leaving the app. Panels have no URL of their own.
//
// Pops this module triggers itself while tearing a panel down arrive
// asynchronously, possibly after another panel (or the same one, remounted by
// StrictMode) has registered its listener, and must not read as Back.
let selfPops = 0;
let lastPopWasSelf = false;
// Open panels, innermost last. Back closes only the innermost one, so an edit
// form over a title sheet steps back to the sheet rather than closing both.
const stack: number[] = [];
let nextId = 1;
// Registered at import, so it runs before any panel's own listener and the
// count drains even when no panel is open to hear the pop.
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    lastPopWasSelf = selfPops > 0;
    if (lastPopWasSelf) selfPops -= 1;
  });
}

/** Push a history entry while `open`; call `onBack` when Back pops it. */
export function useHistoryEntry(open: boolean, onBack: () => void): void {
  const back = useRef(onBack);
  back.current = onBack;
  // Keyed on `open` only: callers pass inline arrows, and re-running on every
  // render would pop and re-push history while the panel is up.
  useEffect(() => {
    if (!open) return;
    const id = nextId++;
    stack.push(id);
    history.pushState({ sheet: id }, '');
    const onPop = () => { if (!lastPopWasSelf && stack[stack.length - 1] === id) back.current(); };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      stack.splice(stack.indexOf(id), 1);
      // Only our own entry is ours to pop: after a real Back the current
      // entry already belongs to the panel underneath.
      if (history.state && history.state.sheet === id) { selfPops += 1; history.back(); }
    };
  }, [open]);
}

/** Put the entry back after a Back press the panel decided not to honour. */
export function rearmHistoryEntry(): void {
  const id = stack[stack.length - 1];
  if (id !== undefined) history.pushState({ sheet: id }, '');
}

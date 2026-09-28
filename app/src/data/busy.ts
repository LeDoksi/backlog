// A remote change is somebody else's click on another device, so it never
// outranks what the person here is doing: while a panel or form is open the
// store takes the data into the mirror but holds the repaint until they are
// done. Reasons are counted so two overlapping panels do not release early.
type Listener = () => void;

const reasons = new Map<string, number>();
const idleListeners = new Set<Listener>();

export const busy = {
  enter(reason: string): void {
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  },
  leave(reason: string): void {
    const n = reasons.get(reason) ?? 0;
    if (n <= 1) reasons.delete(reason);
    else reasons.set(reason, n - 1);
    if (reasons.size === 0) idleListeners.forEach((fn) => fn());
  },
  isBusy(): boolean {
    return reasons.size > 0;
  },
  onIdle(fn: Listener): () => void {
    idleListeners.add(fn);
    return () => { idleListeners.delete(fn); };
  },
  _reset(): void {
    reasons.clear();
  }
};

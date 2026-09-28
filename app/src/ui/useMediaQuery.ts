import { useSyncExternalStore } from 'react';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof matchMedia !== 'function') return () => {};
      const m = matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => typeof matchMedia === 'function' && matchMedia(query).matches,
    () => false
  );
}

export const DESKTOP = '(min-width: 1024px)';
export const useIsDesktop = () => useMediaQuery(DESKTOP);

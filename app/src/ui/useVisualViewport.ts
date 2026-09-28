import { useEffect, useState } from 'react';

const read = () => ({
  height: window.visualViewport?.height ?? window.innerHeight,
  offsetTop: window.visualViewport?.offsetTop ?? 0
});

// iOS Safari keeps the layout viewport full height when the keyboard opens and
// only shrinks the visual one, so anything that must stay above the keyboard
// has to be placed against visualViewport, not against the window.
export function useVisualViewport(): { height: number; offsetTop: number } {
  const [vv, setVv] = useState(read);
  useEffect(() => {
    const v = window.visualViewport;
    const on = () => setVv(read());
    v?.addEventListener('resize', on);
    v?.addEventListener('scroll', on);
    window.addEventListener('resize', on);
    return () => {
      v?.removeEventListener('resize', on);
      v?.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
    };
  }, []);
  return vv;
}

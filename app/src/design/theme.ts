export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'bl2:theme';

export function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(pref: ThemePref, root: HTMLElement = document.documentElement): void {
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

export function rememberTheme(pref: ThemePref): void {
  try { localStorage.setItem(KEY, pref); } catch { /* private mode: theme just won't persist */ }
}

export function setTheme(pref: ThemePref): void {
  rememberTheme(pref);
  applyTheme(pref);
}

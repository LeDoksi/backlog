import { readTheme, setTheme, applyTheme } from '../../src/design/theme';

beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme'); });

test('defaults to system and leaves the attribute off', () => {
  expect(readTheme()).toBe('system');
  applyTheme('system');
  expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
});
test('manual choice is stored and applied', () => {
  setTheme('dark');
  expect(localStorage.getItem('bl2:theme')).toBe('dark');
  expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  setTheme('system');
  expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
});
test('garbage in storage reads as system', () => {
  localStorage.setItem('bl2:theme', 'purple');
  expect(readTheme()).toBe('system');
});

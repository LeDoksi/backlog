import { afterEach, expect, it } from 'vitest';
import { lockScroll } from '../../src/ui/scrollLock';

const unlocks: (() => void)[] = [];
afterEach(() => { unlocks.splice(0).forEach((u) => u()); document.body.innerHTML = ''; });

function touchmove(target: Element): boolean {
  const e = new Event('touchmove', { bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e.defaultPrevented;
}

function scroller(): HTMLElement {
  const el = document.createElement('div');
  el.style.overflowY = 'auto';
  Object.defineProperty(el, 'scrollHeight', { value: 500 });
  Object.defineProperty(el, 'clientHeight', { value: 100 });
  const child = document.createElement('p');
  el.appendChild(child);
  document.body.appendChild(el);
  return child;
}

it('while locked, a swipe on anything that cannot scroll does not move the page', () => {
  const plain = document.body.appendChild(document.createElement('div'));
  unlocks.push(lockScroll());
  expect(touchmove(plain)).toBe(true);
  expect(document.body.style.overflow).toBe('hidden');
});

it('a list inside a panel still scrolls under the finger', () => {
  const inList = scroller();
  unlocks.push(lockScroll());
  expect(touchmove(inList)).toBe(false);
});

it('nested panels: the page stays locked until the last one closes', () => {
  const plain = document.body.appendChild(document.createElement('div'));
  const outer = lockScroll();
  const inner = lockScroll();
  inner();
  inner();
  expect(touchmove(plain)).toBe(true);
  outer();
  expect(touchmove(plain)).toBe(false);
  expect(document.body.style.overflow).toBe('');
});

import { expect, it } from 'vitest';
import { quickAddLayout } from '../../src/screens/QuickAdd/layout';

it('without a keyboard the panel sits near the top and is not compact', () => {
  expect(quickAddLayout({ layoutHeight: 844, height: 844, offsetTop: 0 })).toEqual({ top: 8, keyboard: 0, compact: false });
});
it('iOS keyboard: the visual viewport shrinks, so the gap below it is the keyboard', () => {
  expect(quickAddLayout({ layoutHeight: 844, height: 400, offsetTop: 0 })).toEqual({ top: 8, keyboard: 444, compact: true });
});
it('follows the visual viewport when iOS scrolls it', () => {
  expect(quickAddLayout({ layoutHeight: 844, height: 400, offsetTop: 30 })).toEqual({ top: 38, keyboard: 414, compact: true });
});
it('Android resizes the window instead, so there is nothing to pad', () => {
  expect(quickAddLayout({ layoutHeight: 500, height: 500, offsetTop: 0 })).toEqual({ top: 8, keyboard: 0, compact: false });
});

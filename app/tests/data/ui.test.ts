import { beforeEach, expect, it } from 'vitest';
import { useUi } from '../../src/data/ui';

beforeEach(() => useUi.setState({ openTitleId: null, sharedTitleId: null }));

// Only the card named here carries the shared poster id, so closing a panel
// animates one card instead of re-projecting every card in the grid.
it('opening a title makes it the one card that shares its poster', () => {
  useUi.getState().openTitle('a');
  expect(useUi.getState().sharedTitleId).toBe('a');
});
it('closing keeps the shared card so the poster can fly back to it', () => {
  useUi.getState().openTitle('a');
  useUi.getState().closeTitle();
  expect(useUi.getState().openTitleId).toBeNull();
  expect(useUi.getState().sharedTitleId).toBe('a');
});
it('opening another title moves the shared poster to it', () => {
  useUi.getState().openTitle('a');
  useUi.getState().openTitle('b');
  expect(useUi.getState().sharedTitleId).toBe('b');
});

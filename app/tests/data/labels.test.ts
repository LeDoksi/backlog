import { expect, it } from 'vitest';
import { statusLabel } from '../../src/data/labels';

it('a game in progress is played, everything else is watched', () => {
  expect(statusLabel('in_progress', 'game')).toBe('Играю');
  expect(statusLabel('in_progress', 'series')).toBe('Смотрю');
  expect(statusLabel('done', 'game')).toBe('Завершено');
});

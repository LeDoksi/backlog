import { expect, it } from 'vitest';
import { fitWithin } from '../../src/lib/imageDownscale';

it('caps the long side at 900 and keeps the ratio', () => {
  expect(fitWithin(1800, 2700)).toEqual({ width: 600, height: 900 });
  expect(fitWithin(3000, 1000)).toEqual({ width: 900, height: 300 });
});

it('never upscales a small picture', () => {
  expect(fitWithin(300, 450)).toEqual({ width: 300, height: 450 });
});

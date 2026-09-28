import { avatarSlot } from '../../src/ui/Avatar';

test('same user always gets the same color slot, within 1..6', () => {
  const a = avatarSlot('4f7c2b9e-0000-0000-0000-000000000001');
  expect(a).toBe(avatarSlot('4f7c2b9e-0000-0000-0000-000000000001'));
  expect(a).toBeGreaterThanOrEqual(1);
  expect(a).toBeLessThanOrEqual(6);
});

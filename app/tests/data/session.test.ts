import { resolveSessionState } from '../../src/data/session';

test('no client means signed out, never an endless loader', () => {
  expect(resolveSessionState({ hasClient: false, userId: null, hasProfile: false })).toBe('signedOut');
});
test('signed in without a profile is blocked, with a profile is ready', () => {
  expect(resolveSessionState({ hasClient: true, userId: 'u', hasProfile: false })).toBe('blocked');
  expect(resolveSessionState({ hasClient: true, userId: 'u', hasProfile: true })).toBe('ready');
});
test('a failed profile check is not read as "not invited"', () => {
  expect(resolveSessionState({ hasClient: true, userId: 'u', hasProfile: null })).toBe('ready');
});

import { resolveSessionState, suggestNickname } from '../../src/data/session';

const profile = (nickname: string | null) => ({ id: 'u', email: 'u@x', display_name: 'U', nickname, theme: 'system' as const });

test('no client means signed out, never an endless loader', () => {
  expect(resolveSessionState({ hasClient: false, userId: null, signup: null, profile: null })).toBe('signedOut');
});
test('not invited is blocked', () => {
  expect(resolveSessionState({ hasClient: true, userId: 'u', signup: 'not_invited', profile: null })).toBe('blocked');
});
test('a profile without a nickname goes through onboarding first', () => {
  expect(resolveSessionState({ hasClient: true, userId: 'u', signup: 'created', profile: profile(null) })).toBe('onboarding');
  expect(resolveSessionState({ hasClient: true, userId: 'u', signup: 'exists', profile: profile(null) })).toBe('onboarding');
  expect(resolveSessionState({ hasClient: true, userId: 'u', signup: 'exists', profile: profile('ledoksi') })).toBe('ready');
});
test('a failed check is not read as "not invited", and offline opens the app', () => {
  expect(resolveSessionState({ hasClient: true, userId: 'u', signup: null, profile: null })).toBe('ready');
  expect(resolveSessionState({ hasClient: true, userId: 'u', signup: 'exists', profile: null })).toBe('ready');
});
test('suggests a nickname from the email', () => {
  expect(suggestNickname('Shakov.Georgy@gmail.com')).toBe('shakov_georgy');
  expect(suggestNickname('a@b.c')).toBe('');
  expect(suggestNickname('very-long-name-that-goes-on-and-on@x.y')).toBe('very_long_name_that_');
});

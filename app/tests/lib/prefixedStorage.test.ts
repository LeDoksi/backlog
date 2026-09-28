import { prefixedStorage } from '../../src/lib/prefixedStorage';

function memory() {
  const data: Record<string, string> = {};
  return { data, getItem: (k: string) => (k in data ? data[k]! : null), setItem: (k: string, v: string) => { data[k] = v; }, removeItem: (k: string) => { delete data[k]; } };
}

test('keys are namespaced and never touch unprefixed keys', () => {
  const raw = memory();
  raw.setItem('backlog-added', '[1]');
  const s = prefixedStorage(raw, 'bl2:');
  expect(s.getItem('backlog-added')).toBeNull();
  s.setItem('backlog-added', '[2]');
  expect(raw.data['bl2:backlog-added']).toBe('[2]');
  expect(raw.data['backlog-added']).toBe('[1]');
  s.removeItem!('backlog-added');
  expect(raw.data['bl2:backlog-added']).toBeUndefined();
});

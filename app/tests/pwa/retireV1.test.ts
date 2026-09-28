import { expect, it } from 'vitest';
import { activate } from './fakeWorker';

// v2's worker takes over v1's registration (same sw.js URL at /backlog/).
it('drops v1 caches and reloads tabs still running v1', async () => {
  const r = await activate('public/sw-retire-v1.js', ['backlog-shell-v1', 'backlog-covers-v1', 'bl2-covers'], ['https://x/backlog/']);
  expect(r.caches).toEqual(['bl2-covers']);
  expect(r.navigated).toEqual(['https://x/backlog/']);
});
it('reloads nothing on later updates, once v1 is gone', async () => {
  const r = await activate('public/sw-retire-v1.js', ['bl2-covers'], ['https://x/backlog/']);
  expect(r.caches).toEqual(['bl2-covers']);
  expect(r.navigated).toEqual([]);
});

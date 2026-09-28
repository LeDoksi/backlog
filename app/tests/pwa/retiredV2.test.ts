import { expect, it } from 'vitest';
import { activate } from './fakeWorker';

// Published at /backlog/v2/sw.js after the switch, replacing the old v2 worker
// for anyone who still has it (a home-screen icon, a bookmark).
it('drops only the old /backlog/v2/ caches, unregisters and sends tabs to the root', async () => {
  const r = await activate('retired-v2/sw.js', [
    'workbox-precache-v2-https://ledoksi.github.io/backlog/v2/',
    'workbox-precache-v2-https://ledoksi.github.io/backlog/',
    'bl2-covers'
  ], ['https://ledoksi.github.io/backlog/v2/']);
  expect(r.caches).toEqual(['workbox-precache-v2-https://ledoksi.github.io/backlog/', 'bl2-covers']);
  expect(r.unregistered).toBe(true);
  expect(r.navigated).toEqual(['/backlog/']);
});

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

// A home-screen icon saved from the old address keeps opening /backlog/v2/.
// The root worker answers it itself, so it works offline too.
it('sends the old /backlog/v2 address to the root, even offline', async () => {
  const r = await activate('public/sw-retire-v1.js', [], []);
  for (const url of ['https://x/backlog/v2/', 'https://x/backlog/v2', 'https://x/backlog/v2/index.html']) {
    const res = r.navigate(url);
    expect(res?.status, url).toBe(302);
    expect(res?.headers.get('location'), url).toBe('https://x/backlog/');
  }
  expect(r.navigate('https://x/backlog/')).toBeUndefined();
  expect(r.navigate('https://x/backlog/v2x')).toBeUndefined();
});

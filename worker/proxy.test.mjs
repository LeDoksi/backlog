// node --test worker/proxy.test.mjs — the relay's allowlist and key handling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './proxy.js';

const BASE = 'https://backlog-proxy.example.workers.dev/';
let seen = [];
globalThis.fetch = async (url, init) => {
  seen.push({ url, init });
  return new Response(JSON.stringify({ success: true, echo: init?.headers ?? {} }), {
    status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'a=b' }
  });
};
const APP = 'https://ledoksi.github.io';
const call = (target, env = {}, method = 'GET', origin = APP) => {
  seen = [];
  return worker.fetch(new Request(BASE + target, { method, headers: origin ? { Origin: origin } : {} }), env);
};

test('a host off the list is refused', async () => {
  const res = await call('https://example.com/x');
  assert.equal(res.status, 403);
  assert.equal(seen.length, 0);
});

test('plain http and other methods are refused', async () => {
  assert.equal((await call('http://store.steampowered.com/api/appdetails?appids=1')).status, 403);
  assert.equal((await call('https://store.steampowered.com/api/appdetails?appids=1', {}, 'POST')).status, 405);
});

test('SteamGridDB gets the key from the environment', async () => {
  const res = await call('https://www.steamgriddb.com/api/v2/grids/steam/620?dimensions=600x900', { SGDB_KEY: 'secret-key' });
  assert.equal(res.status, 200);
  assert.equal(seen[0].url, 'https://www.steamgriddb.com/api/v2/grids/steam/620?dimensions=600x900');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer secret-key');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(res.headers.get('Set-Cookie'), null);
});

test('no key: 503, and nothing is sent upstream', async () => {
  const res = await call('https://www.steamgriddb.com/api/v2/search/autocomplete/x');
  assert.equal(res.status, 503);
  assert.equal(seen.length, 0);
});

test('other hosts never see the key', async () => {
  await call('https://api.mymemory.translated.net/get?q=hi&langpair=en|ru', { SGDB_KEY: 'secret-key' });
  assert.equal(seen[0].init.headers.Authorization, undefined);
  await call('https://store.steampowered.com/api/appdetails?appids=620', { SGDB_KEY: 'secret-key' });
  assert.equal(seen[0].init.headers.Authorization, undefined);
});

test('the key goes only to the app, and only to the grid search', async () => {
  const env = { SGDB_KEY: 'secret-key' };
  assert.equal((await call('https://www.steamgriddb.com/api/v2/grids/steam/620', env, 'GET', 'https://evil.example')).status, 403);
  assert.equal((await call('https://www.steamgriddb.com/api/v2/grids/steam/620', env, 'GET', null)).status, 403);
  assert.equal((await call('https://www.steamgriddb.com/api/v2/users/me', env)).status, 403);
  assert.equal((await call('https://www.steamgriddb.com/api/v2/grids/game/123?dimensions=600x900', env)).status, 200);
  assert.equal((await call('https://www.steamgriddb.com/api/v2/search/autocomplete/Grand%20Theft%20Auto', env)).status, 200);
  assert.equal(seen.length, 1);
});

test('/__status says whether the key works, never what it is', async () => {
  const ok = await (await call('__status', { SGDB_KEY: 'secret-key' }, 'GET', null)).text();
  assert.equal(ok, '{"steamgriddb":"ok"}');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer secret-key');
  assert.equal(await (await call('__status', {}, 'GET', null)).text(), '{"steamgriddb":"missing"}');
});

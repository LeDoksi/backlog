// Cloudflare Worker — CORS relay for the backlog app's own third-party
// API calls (TMDb fallback, Steam, SteamGridDB, MyMemory fallback; see
// app/src/lib/enrich.ts and CORS_PROXY in app/src/config.ts). Deployed by
// hand via the Cloudflare dashboard's code editor (Workers & Pages → your
// worker → Edit code) — this file is the source of truth, paste its
// contents in whenever it changes.
//
// URL shape matches the old proxy.cors.sh convention so the app needs no
// other changes: GET https://<worker>.workers.dev/<full target URL>
//
// Host allowlist exists because this is a public, unauthenticated URL —
// without it, anyone who finds it could use it as a free open proxy for
// arbitrary traffic and burn through the daily request quota.
//
// Keys (wave 3): SteamGridDB needs one. It lives in the worker's
// environment (Settings → Variables and Secrets, a Secret named SGDB_KEY),
// never in the repository or the browser. The worker adds it on the way
// out; without it, SteamGridDB requests answer 503 and the app treats that
// as "no tall cover".
const ALLOWED_HOSTS = new Set([
  'api.themoviedb.org',
  'store.steampowered.com',
  'www.steamgriddb.com',
  'api.mymemory.translated.net'
]);

// Host → the environment variable holding its bearer key, the only paths
// the key goes to, and the only sites allowed to ask. A key is spent on the
// owner's account, so the relay does not lend it to anyone who finds the
// URL: browsers always send Origin on these cross-site requests, and a
// script that fakes it still only reaches the read-only grid search.
const KEYED_HOSTS = {
  'www.steamgriddb.com': { env: 'SGDB_KEY', paths: /^\/api\/v2\/(grids\/(steam|game)\/\d+|search\/autocomplete\/[^/]+)$/ }
};
const APP_ORIGINS = /^(https:\/\/ledoksi\.github\.io|http:\/\/localhost(:\d+)?|http:\/\/127\.0\.0\.1(:\d+)?)$/;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*'
  };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders() });
    }

    var url = new URL(request.url);
    // A check that can be opened in a browser: is the SteamGridDB key there,
    // and does SteamGridDB take it? The key itself is never shown.
    if (url.pathname === '/__status') {
      var status = 'missing';
      if (env && env.SGDB_KEY) {
        try {
          var probe = await fetch('https://www.steamgriddb.com/api/v2/grids/steam/620?dimensions=600x900', { headers: { Authorization: 'Bearer ' + env.SGDB_KEY } });
          status = probe.ok ? 'ok' : probe.status === 401 || probe.status === 403 ? 'rejected' : 'error ' + probe.status;
        } catch (e) {
          status = 'unreachable';
        }
      }
      return new Response(JSON.stringify({ steamgriddb: status }), { headers: Object.assign(corsHeaders(), { 'Content-Type': 'application/json' }) });
    }
    var targetUrl = url.pathname.slice(1) + url.search;
    var target;
    try {
      target = new URL(targetUrl);
    } catch (e) {
      return new Response('Bad request', { status: 400, headers: corsHeaders() });
    }
    if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
      return new Response('Forbidden host', { status: 403, headers: corsHeaders() });
    }

    var init = { headers: {} };
    var keyed = KEYED_HOSTS[target.hostname];
    if (keyed) {
      if (!keyed.paths.test(target.pathname) || !APP_ORIGINS.test(request.headers.get('Origin') || '')) {
        return new Response('Forbidden', { status: 403, headers: corsHeaders() });
      }
      var key = env && env[keyed.env];
      if (!key) return new Response('Not configured', { status: 503, headers: corsHeaders() });
      init.headers.Authorization = 'Bearer ' + key;
    }

    var upstream;
    try {
      upstream = await fetch(target.toString(), init);
    } catch (e) {
      return new Response('Upstream fetch failed', { status: 502, headers: corsHeaders() });
    }

    // Only the body and its type go back: no upstream header (cookies, the
    // echoed request) can carry the key to the browser.
    var body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers: Object.assign(corsHeaders(), {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/octet-stream'
      })
    });
  }
};

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

// Host → the environment variable holding its bearer key.
const KEYED_HOSTS = {
  'www.steamgriddb.com': 'SGDB_KEY'
};

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
    var keyName = KEYED_HOSTS[target.hostname];
    if (keyName) {
      var key = env && env[keyName];
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

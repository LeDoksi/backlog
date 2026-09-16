// Cloudflare Worker — CORS relay for the backlog app's own third-party
// API calls (TMDb fallback + Steam, see lib/enrich.js / app.js's
// CORS_PROXY). Deployed by hand via the Cloudflare dashboard's code
// editor (Workers & Pages → your worker → Edit code) — this file is the
// source of truth, paste its contents in whenever it changes.
//
// URL shape matches the old proxy.cors.sh convention so the app needs no
// other changes: GET https://<worker>.workers.dev/<full target URL>
//
// Host allowlist exists because this is a public, unauthenticated URL —
// without it, anyone who finds it could use it as a free open proxy for
// arbitrary traffic and burn through the daily request quota.
const ALLOWED_HOSTS = new Set([
  'api.themoviedb.org',
  'store.steampowered.com'
]);

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*'
  };
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    var url = new URL(request.url);
    var targetUrl = url.pathname.slice(1) + url.search;
    var target;
    try {
      target = new URL(targetUrl);
    } catch (e) {
      return new Response('Bad request', { status: 400, headers: corsHeaders() });
    }
    if (!ALLOWED_HOSTS.has(target.hostname)) {
      return new Response('Forbidden host', { status: 403, headers: corsHeaders() });
    }

    var upstream;
    try {
      upstream = await fetch(target.toString());
    } catch (e) {
      return new Response('Upstream fetch failed', { status: 502, headers: corsHeaders() });
    }

    var body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers: Object.assign(corsHeaders(), {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/octet-stream'
      })
    });
  }
};

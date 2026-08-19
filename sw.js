// sw.js — service worker for offline support and installability.
//
// Two independent strategies, chosen for two very different kinds of file:
//
// 1. App shell (index.html, styles.css, app.js, data.js, lib/*.js, the
//    manifest) — network-first. The catalog and the code both change with
//    every deploy (new titles land in data.js regularly), so caching them
//    cache-first would risk trapping a returning visitor on a stale copy
//    forever, since a cache-first strategy never even asks the network once
//    something is cached. Network-first instead always tries the network
//    first and only falls back to the cache when the network is unreachable
//    (offline) — so a normal online visit always sees the latest deploy, and
//    only a genuinely offline visit sees the last-known-good snapshot.
//
// 2. Poster covers (images/covers/*) — cache-first. A cover, once added for
//    a title, never changes — there is no "update" to miss — so the fastest
//    and most offline-friendly answer is "serve it straight from cache once
//    we've fetched it before, and stash a copy of whatever we do fetch."
//
// Everything else (other origins, non-GET requests) is left alone and falls
// straight through to the network, untouched by this worker.

var SHELL_CACHE = 'backlog-shell-v1';
var COVERS_CACHE = 'backlog-covers-v1';
var CURRENT_CACHES = [SHELL_CACHE, COVERS_CACHE];

// Resolved relative to this script's own URL (the app's root), so this works
// whether the app is served from a domain root or a sub-path.
var SHELL_FILES = [
  '.',
  'index.html',
  'styles.css',
  'app.js',
  'data.js',
  'lib/slug.js',
  'lib/storage.js',
  'lib/query.js',
  'manifest.webmanifest'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(function (cache) { return cache.addAll(SHELL_FILES); })
      // Take over from any previous worker as soon as this one has a shell
      // cached, rather than waiting for every open tab to close first —
      // network-first below means a stale shell is never actually served to
      // an online visitor anyway, so there is nothing to lose by switching
      // over promptly.
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) { return CURRENT_CACHES.indexOf(key) === -1; })
            .map(function (key) { return caches.delete(key); })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

function isCoverRequest(url) {
  return url.pathname.indexOf('/images/covers/') !== -1;
}

// Cache-first: a cached response is used unconditionally. A miss falls
// through to the network, and a successful response is stashed for next
// time. An offline miss (no cache, no network) simply fails — there is
// nothing offline-safe to show for a poster that was never fetched before.
function cacheFirst(request) {
  return caches.open(COVERS_CACHE).then(function (cache) {
    return cache.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        if (response && response.ok) cache.put(request, response.clone());
        return response;
      });
    });
  });
}

// Network-first: always try the network, and only reach for the cache when
// the network request itself fails (offline, DNS down, etc). A successful
// network response also refreshes the cache, so the offline fallback keeps
// catching up every time the app is used online.
function networkFirst(request) {
  return caches.open(SHELL_CACHE).then(function (cache) {
    return fetch(request)
      .then(function (response) {
        if (response && response.ok) cache.put(request, response.clone());
        return response;
      })
      .catch(function () {
        return cache.match(request).then(function (cached) {
          if (cached) return cached;
          // A navigation with no cached exact match (e.g. a request for "/"
          // when the shell was cached under "index.html") falls back to the
          // cached document itself.
          if (request.mode === 'navigate') return cache.match('index.html');
          throw new Error('offline and not cached: ' + request.url);
        });
      });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isCoverRequest(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else same-origin — the shell's own files, and top-level
  // navigations to the app itself — goes through network-first.
  event.respondWith(networkFirst(request));
});

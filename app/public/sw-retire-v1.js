// Pulled into the root build's service worker (workbox importScripts). v2
// replaced v1 at /backlog/ and registers the same sw.js URL, so browsers treat it as an
// update of v1's worker. On activation this drops v1's caches and, the one
// time they were still there, reloads any tab still running v1 so it picks
// up v2. Later updates find no v1 cache and reload nothing.
self.addEventListener('activate', function (event) {
  event.waitUntil(
    Promise.all([caches.delete('backlog-shell-v1'), caches.delete('backlog-covers-v1')]).then(function (dropped) {
      if (!dropped[0]) return;
      return self.clients.claim()
        .then(function () { return self.clients.matchAll({ type: 'window' }); })
        .then(function (tabs) {
          // Not awaited: the reload goes through this worker, which can't
          // answer it until activation (this waitUntil) has finished.
          tabs.forEach(function (tab) { tab.navigate(tab.url).catch(function () {}); });
        });
    })
  );
});

// The old /backlog/v2/ address (a home-screen icon saved from there keeps
// opening it) is answered here, so it lands on the app even offline instead
// of needing the redirect page from the network.
self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.mode !== 'navigate') return;
  if (!/^\/backlog\/v2(\/|$)/.test(new URL(request.url).pathname)) return;
  event.respondWith(Response.redirect(self.registration.scope, 302));
});

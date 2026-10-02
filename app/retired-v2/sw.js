// Published at /backlog/v2/sw.js after v2 moved to /backlog/. Anyone whose
// browser still runs the old v2 worker (a home-screen icon, a bookmark) gets
// this one on its next update check: it drops the old v2 caches (cache names
// are shared across the site, so only ones carrying /backlog/v2/ go), removes
// itself and sends open tabs to the new address. The redirect page that used
// to sit next to it is gone (2026-10-02); this file stays, because a browser
// whose update check gets a 404 keeps the old worker and its stale app.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (names) {
        return Promise.all(names.filter(function (n) { return n.indexOf('/backlog/v2/') !== -1; }).map(function (n) { return caches.delete(n); }));
      })
      .then(function () { return self.clients.claim(); })
      .then(function () { return self.clients.matchAll({ type: 'window' }); })
      .then(function (tabs) {
        return self.registration.unregister().then(function () {
          // Not awaited: waiting for a navigation inside activation can stall it.
          tabs.forEach(function (tab) { tab.navigate('/backlog/').catch(function () {}); });
        });
      })
  );
});

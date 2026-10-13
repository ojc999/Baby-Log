/* Offline shell. Caches only this app's own files so it opens with no signal.
   Everything else — above all the GitHub API — always goes to the network, so a
   stale reply can never be mistaken for a saved entry. */

var CACHE = 'baby-log-v2';   /* bumped so the old shell is cleared once */
var SHELL = [
  './', './index.html', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(SHELL); })
      .catch(function () { /* one missing file must not block install */ })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

/* The page asks for this when a new worker is waiting, so an update does not sit behind
   a tab that never fully closes. */
self.addEventListener('message', function (e) {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // never touch api.github.com

  // Network first so a deploy is picked up, cache as the fallback when offline.
  //
  // `cache: 'no-cache'` is load-bearing and was missing. A plain fetch() goes through the
  // browser's own HTTP cache, and GitHub Pages serves these files with max-age=600 - so
  // for ten minutes after any load this "network first" returned the browser's cached
  // copy without touching the network, and a deploy did not arrive however many times you
  // reloaded. 'no-cache' still uses the cache but revalidates with the server every time,
  // so an unchanged file costs a 304 and a changed one actually arrives.
  e.respondWith(
    fetch(req.url, { cache: 'no-cache' })
      .then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
        }
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('./index.html');
        });
      })
  );
});

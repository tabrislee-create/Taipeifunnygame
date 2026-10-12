// Pass-through service worker: makes the page installable as an app but caches nothing.
// Requests bypass the browser HTTP cache too (cache: 'no-store'), because the static file server may send only Last-Modified,
// which lets browsers keep old game files for hours.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request, { cache: 'no-store' }));
});

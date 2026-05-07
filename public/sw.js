const CACHE_NAME = 'tonight-nyc-v10';
const STATIC_ASSETS = [
  '/',
  '/app.min.js',
  '/style.min.css',
  '/favicon.svg',
  '/manifest.json'
];

self.addEventListener('install', event => {
  // Non-fatal pre-cache: any failed asset just gets skipped. addAll() rejects atomically — that's
  // probably what wedged v8 if even one asset 404'd during install.
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(STATIC_ASSETS.map(url => cache.add(url).catch(() => null)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Network-first for data files (always fresh lineups)
  if (url.pathname.startsWith('/data/')) {
    event.respondWith(
      fetch(event.request)
        .then(resp => {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return resp;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for photos (immutable)
  if (url.pathname.startsWith('/photos/')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(resp => {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return resp;
        });
      })
    );
    return;
  }

  // Cache-first for static assets, network fallback
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

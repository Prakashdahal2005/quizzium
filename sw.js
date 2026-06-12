const CACHE_NAME = 'recall-v2';
const STATIC_ASSETS = [
  './',
  './index.html',          // explicitly add your HTML file
  './manifest.json',
  './icon1.png',
  './icon2.png'
];

// Install: cache all static assets (including the main HTML)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await cache.addAll(STATIC_ASSETS);
      // Also cache the current page's exact URL
      const url = self.location.origin + '/';
      await cache.add(url);
    })
  );
  self.skipWaiting();
});

// Fetch: cache-first for everything (offline-first)
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // Skip non-GET or cross-origin requests
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      // Fallback to network, then cache for next time
      return fetch(request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        // If both cache and network fail, return a basic offline page
        return caches.match('./index.html') || new Response('Offline – please reconnect', { status: 503 });
      });
    })
  );
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});
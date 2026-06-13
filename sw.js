const CACHE_NAME = 'recall-v5';   // Bump version to force update
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon1.png',
  './icon2.png',
  './core/style.css',
  './core/main.js',
  './core/appjs',
  './modules/study.html',
  './modules/library.html',
  './modules/stats.html',
  './modules/store.html'
];

// Install: cache static assets (including a copy of index.html for offline fallback)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await cache.addAll(STATIC_ASSETS);
      // Also cache the root URL explicitly
      const rootUrl = self.location.origin + '/';
      try {
        const response = await fetch(rootUrl);
        if (response.ok) await cache.put(rootUrl, response);
      } catch (e) {
        // If offline during install, just use the already cached index.html
        console.log('Install: could not fetch root, using cached assets');
      }
    })
  );
  self.skipWaiting();
});

// Fetch: network‑first for HTML / navigation, stale‑while‑revalidate for other assets
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // Skip non-GET or cross-origin requests
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    event.respondWith(fetch(request));
    return;
  }

  // ---- Navigation (HTML) requests: network first, fallback to cache ----
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          // Cache the fresh HTML for offline use
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          // Offline: try to serve the cached index.html
          const cached = await caches.match('./index.html');
          return cached || new Response('Offline – please reconnect', { status: 503 });
        })
    );
    return;
  }

  // ---- Static assets (CSS, JS, images, etc.): stale‑while‑revalidate ----
  event.respondWith(
    caches.match(request).then(cachedResponse => {
      const fetchPromise = fetch(request)
        .then(networkResponse => {
          if (networkResponse.ok) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(error => {
          console.warn('Network failed for asset:', request.url, error);
          // If both cache and network fail, return a basic offline response
          if (!cachedResponse) {
            return new Response('Asset not available offline', { status: 404 });
          }
          // Otherwise propagate the cache error? Actually we return cached below
        });

      // Return cached version immediately, then update in background
      return cachedResponse || fetchPromise;
    })
  );
});

// Activate: clean up old caches and take control immediately
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

// ---------- NOTIFICATION CLICK HANDLER ----------
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'close') {
    // User tapped Dismiss – do nothing
    return;
  }

  // Otherwise (including 'study' action or tap on body) open the app
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // If a window is already open, focus it
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus();
          }
        }
        // Otherwise open a new window
        return clients.openWindow('./');
      })
  );
});
/**
 * Setu P2P - Progressive Web App Service Worker
 * Enables offline loading, instant caching, and standalone PWA installation.
 * Zero tracking, zero telemetry, 100% client-side privacy.
 * Zero emojis in code and comments.
 */

const CACHE_NAME = 'setu-p2p-v3';

const STATIC_SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  'assets/css/app.css',
  'assets/icons/icon.svg',
  'assets/icons/icon-192.svg',
  'assets/icons/icon-512.svg',
  'assets/js/storage.js',
  'assets/js/sound.js',
  'assets/js/signaling.js',
  'assets/js/room-signaling.js',
  'assets/js/identity.js',
  'assets/js/webrtc.js',
  'assets/js/presence.js',
  'assets/js/chat.js',
  'assets/js/file-transfer.js',
  'assets/js/recording.js',
  'assets/js/diagnostics.js',
  'assets/js/qr-exchange.js',
  'assets/js/shared-page.js',
  'assets/js/privacy.js',
  'assets/js/connection-ui.js',
  'assets/js/meeting.js',
  'assets/js/remote-control.js',
  'assets/js/device-test.js',
  'assets/js/schedule.js',
  'assets/js/app.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Use individual caching to prevent a single missing asset from failing the entire install
      for (const asset of STATIC_SHELL_ASSETS) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn('[ServiceWorker] Failed to precache asset:', asset, err);
        }
      }
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only handle GET requests
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Bypass external APIs, WebSocket protocols, MQTT brokers, STUN/TURN queries
  if (
    url.protocol === 'ws:' ||
    url.protocol === 'wss:' ||
    url.hostname.includes('broker.') ||
    url.hostname.includes('mqtt') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com')
  ) {
    return;
  }

  // Handle HTML document navigation requests (Network-first with offline cache fallback)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          return caches.match('./index.html');
        })
    );
    return;
  }

  // Handle local static assets (Stale-While-Revalidate)
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const clone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      })
    );
  }
});


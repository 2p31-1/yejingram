/* global self, clients */

// Legacy service worker stub.
// This repository now uses two separate service workers:
// - /sw-cache.js (scope '/') for caching /__binary/* responses
// - /sw-push.js (scope '/push/') for push notifications
//
// Keep this file as a no-op to avoid hard-breaking older clients that
// already registered /sw.js. New code registers the split workers.
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients && self.clients.claim ? self.clients.claim() : Promise.resolve());
});

// Serve cached binaries (persisted in Cache Storage) via a stable URL.
// Note: the app can populate this cache from window context; SW makes it usable via fetch as well.
self.addEventListener('fetch', (event) => {
    try {
        const url = new URL(event.request.url);
        if (url.origin !== self.location.origin) return;

        if (url.pathname.startsWith('/__binary/')) {
            event.respondWith(
                (async () => {
                    const cache = await caches.open(BINARY_CACHE_NAME);
                    const cached = await cache.match(event.request);
                    if (cached) return cached;
                    return new Response('Not found', { status: 404 });
                })()
            );
        }
    } catch {
        // ignore
    }
});

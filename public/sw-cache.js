/* global self */

const BINARY_CACHE_NAME = 'yejingram-binary-v1';

// Serve cached binaries (persisted in Cache Storage) via a stable URL.
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

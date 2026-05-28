const CACHE_NAME = 'noga-pwa-cache-v2';

// We don't pre-cache everything since we want the network-first strategy to fetch the latest.
// We just cache basic offline fallback pages if necessary.
const OFFLINE_URLS = [
    // '/' could be added here if we wanted an offline fallback, but we'll use network-first for it.
];

self.addEventListener('install', (event) => {
    // Perform install steps
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Opened cache');
                return cache.addAll(OFFLINE_URLS);
            })
    );
    self.skipWaiting(); // Force the waiting service worker to become the active service worker
});

self.addEventListener('activate', (event) => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim()) // Become available to all pages
    );
});

// Network First strategy
self.addEventListener('fetch', (event) => {
    // Only handle GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // If response is valid, cache a copy and return it
                if (!response || response.status !== 200 || response.type !== 'basic') {
                    return response;
                }
                const responseToCache = response.clone();
                caches.open(CACHE_NAME)
                    .then((cache) => {
                        // Don't cache API calls or socket.io to avoid weird behaviors
                        if (!event.request.url.includes('/api/') && !event.request.url.includes('/socket.io/')) {
                            cache.put(event.request, responseToCache);
                        }
                    });
                return response;
            })
            .catch(() => {
                // Network failed, try to serve from cache
                return caches.match(event.request);
            })
    );
});

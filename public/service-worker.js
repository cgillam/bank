const FILES_TO_CACHE = [
    '/',
    '/index.html',
    '/styles.css',
    '/index.js',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png',
    'https://stackpath.bootstrapcdn.com/font-awesome/4.7.0/css/font-awesome.min.css',
    'https://cdn.jsdelivr.net/npm/chart.js@2.8.0'
];

const STATIC_CACHE = "static-v1"
const DATA_CACHE = "data-v1"

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(STATIC_CACHE)
            .then((cache) => cache.addAll(FILES_TO_CACHE))
            .then(() => self.skipWaiting())
    )
})

self.addEventListener("activate", (event) => {
    const currentCaches = [STATIC_CACHE, DATA_CACHE]
    event.waitUntil(
        caches
            .keys()
            .then((cacheNames) => cacheNames.filter((cacheName) => !currentCaches.includes(cacheName)))
            .then((cachesToDelete) => Promise.all(
                cachesToDelete.map((cache) => caches.delete(cache))
            ))
            .then(() => self.clients.claim())
    )
});

const fetchTimeout = (url, options, timeout = 2000) => {
    return Promise.race([
        fetch(url, options),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), timeout)
        )
    ]);
}

const fetchAndCache = (cacheName, request) => {
    return caches.open(cacheName).then(cache => {
        return fetch(request)
            .then(response => {
                cache.put(request, response.clone());
                return response;
            })
            .catch(() => {
                return cache.match(request);
            })
    })
}

self.addEventListener('fetch', event => {
    if (FILES_TO_CACHE.some(path => event.request.url.endsWith(path))) {
        const response = fetchAndCache(STATIC_CACHE, event.request);
        return (response ? event.respondWith(response) : undefined)
    }
    if (event.request.method === "GET" && event.request.url.endsWith("/api/transaction")) {
        const response = fetchAndCache(DATA_CACHE, event.request);
        return (response ? event.respondWith(response) : undefined)
    }
});
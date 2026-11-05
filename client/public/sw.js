/* Chicago Pizza service worker.
 *
 * Strategy:
 *  - Navigations: network-first with an offline fallback page, so customers
 *    always get fresh prices when online but still see something useful on a
 *    flaky mobile connection.
 *  - Static assets: stale-while-revalidate.
 *  - API calls: never cached — prices, cart and order status must be live.
 */

/* The registrar appends `?v=<build id>`. A fixed cache name would have meant
 * the offline page and the manifest never updated again — including across a
 * redesign — because nothing ever evicted them. */
const BUILD_ID = new URL(self.location.href).searchParams.get('v') ?? 'dev';
const CACHE_VERSION = `chicago-pizza-${BUILD_ID}`;
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/manifest.webmanifest'];

function cacheableResponse(response) {
  return (
    !/\b(private|no-store)\b/i.test(response.headers.get('cache-control') ?? '') &&
    !/text\/x-component/i.test(response.headers.get('content-type') ?? '')
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      // `reload` bypasses the HTTP cache, so a fresh cache cannot be filled
      // with the copies the browser kept from the previous build.
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Live data must never be served from cache.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;

  // App Router flight responses contain the current locale and user state.
  // Their URL can repeat after a cookie changes, so runtime cache entries
  // must never answer an RSC request, even if an older worker stored one.
  if (
    request.headers.has('RSC') ||
    request.headers.has('Next-Router-Prefetch') ||
    request.headers.has('Next-Router-Segment-Prefetch') ||
    url.searchParams.has('_rsc')
  )
    return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      // Entries written by an older worker may contain private flight data.
      const usableCache = cached && cacheableResponse(cached) ? cached : undefined;
      const network = fetch(request)
        .then((response) => {
          if (response.ok && cacheableResponse(response)) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => usableCache);

      return usableCache || network;
    }),
  );
});

/* Web Push — the notifications service stores subscriptions; wiring a real
 * push provider (FCM/VAPID) only needs keys, the handler is already here. */
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const payload = (() => {
    try {
      return event.data.json();
    } catch {
      return { title: 'Chicago Pizza', body: event.data.text() };
    }
  })();

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Chicago Pizza', {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: payload.url ?? '/orders' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data?.url ?? '/'));
});

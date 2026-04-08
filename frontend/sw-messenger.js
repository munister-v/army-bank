/* Army Bank Messenger — Service Worker */
const CACHE = 'msng-v1';
const STATIC = [
  '/messenger',
  '/css/messenger.css',
  '/js/messenger.js',
  '/manifest-messenger.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Never cache API calls
  if (url.pathname.startsWith('/api/')) return;

  // Network-first for HTML (always fresh)
  if (request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      fetch(request).catch(() => caches.match('/messenger'))
    );
    return;
  }

  // Cache-first for static assets
  e.respondWith(
    caches.match(request).then(cached => cached || fetch(request))
  );
});

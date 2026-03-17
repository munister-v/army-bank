/* Army Bank — Service Worker v2 */
const CACHE = 'army-bank-v2';
const STATIC = [
  '/',
  '/css/styles.css',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800;900&display=swap',
];

/* Install — cache shell */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

/* Activate — clear old caches */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* Fetch — network-first for API, cache-first for static */
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  /* Always bypass for API calls */
  if (url.pathname.startsWith('/api/')) return;

  /* Network-first strategy */
  e.respondWith(
    fetch(e.request)
      .then(res => {
        /* Cache successful GET responses */
        if (e.request.method === 'GET' && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

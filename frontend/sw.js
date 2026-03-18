/* Army Bank — Service Worker v3 */
const CACHE = 'army-bank-v3';
const STATIC = [
  '/',
  '/css/styles.css',
  '/manifest.json',
];

/* ── Install ── */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(STATIC))
      .then(() => self.skipWaiting())
  );
});

/* ── Activate: clean old caches ── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ── Fetch: stale-while-revalidate for shell, bypass API ── */
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/') || url.hostname.includes('onrender.com')) return;

  /* Fonts — cache-first */
  if (url.hostname.includes('fonts.g') || url.pathname.endsWith('.woff2')) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }))
    );
    return;
  }

  /* App shell — stale-while-revalidate */
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(e.request);
      const fresh = fetch(e.request).then(res => {
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});

/* ── Push: show notification ── */
self.addEventListener('push', e => {
  let data = { title: 'Army Bank', body: 'Нове повідомлення', url: '/dashboard' };
  try { if (e.data) data = { ...data, ...e.data.json() }; } catch (_) {}

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-72.png',
      tag: 'army-bank-push',
      renotify: true,
      vibrate: [200, 100, 200],
      data: { url: data.url },
    })
  );
});

/* ── Notification click: focus or open tab ── */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = e.notification.data?.url || '/dashboard';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => new URL(c.url).origin === self.location.origin);
      if (existing) return existing.focus().then(w => w.navigate(target));
      return clients.openWindow(target);
    })
  );
});

/* ── Message from page ── */
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

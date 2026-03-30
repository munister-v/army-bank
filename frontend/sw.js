/* Army Bank — Service Worker v21 */
const CACHE = 'army-bank-v21';

/* Assets to pre-cache on install */
const PRECACHE = [
  '/css/styles.css?v=31',
  '/css/overrides.css?v=22',
  '/manifest.json?v=2',
  '/js/api.js?v=2',
  '/js/app.js?v=42',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/offline.html',
];

/* ── Install: pre-cache assets, skip waiting immediately ── */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

/* ── Activate: wipe old caches, claim all clients ── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      .then(() => {
        return self.clients.matchAll({ type: 'window' }).then(clients => {
          clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' }));
        });
      })
  );
});

/* ── Fetch ── */
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (e.request.method !== 'GET') return;

  // Bypass API calls and push subscriptions
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/push')) return;

  // Bypass external backends (Render)
  if (url.hostname.includes('onrender.com')) return;

  // Google Fonts — cache-first (rarely change)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com' || url.pathname.endsWith('.woff2')) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }))
    );
    return;
  }

  // HTML navigation — network-first, offline fallback to cached /
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) {
            caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          }
          return res;
        })
        .catch(() => caches.match(e.request).then(hit => hit || caches.match('/offline.html')))
    );
    return;
  }

  // Icons — cache-first (static assets, never change)
  if (url.pathname.startsWith('/icons/')) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }))
    );
    return;
  }

  // CSS / JS / manifest — network-first to surface new versions immediately.
  if (
    url.pathname.endsWith('.css')
    || url.pathname.endsWith('.js')
    || url.pathname.endsWith('/manifest.json')
  ) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() =>
        caches.match(e.request).then(hit => hit || caches.match('/'))
      )
    );
    return;
  }

  // Default for other same-origin assets — stale-while-revalidate.
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(e.request);
      const fetchPromise = fetch(e.request).then(res => {
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

/* ── Push: show notification ── */
self.addEventListener('push', e => {
  let data = { title: 'Army Bank', body: 'Нове повідомлення', url: '/dashboard', type: 'default' };
  try { if (e.data) data = { ...data, ...e.data.json() }; } catch (_) {}

  const options = {
    body: data.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    tag: `army-bank-${data.type || 'push'}`,
    renotify: true,
    vibrate: [200, 100, 200, 100, 200],
    silent: false,
    data: { url: data.url },
    actions: [
      { action: 'open', title: '📱 Відкрити' },
      { action: 'dismiss', title: 'Закрити' },
    ],
  };

  e.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

/* ── Notification click ── */
self.addEventListener('notificationclick', e => {
  e.notification.close();

  if (e.action === 'dismiss') return;

  const target = e.notification.data?.url || '/dashboard';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => {
        try { return new URL(c.url).origin === self.location.origin; } catch { return false; }
      });
      if (existing) {
        return existing.focus().then(w => {
          try { w.navigate(target); } catch (_) {}
          return w;
        });
      }
      return clients.openWindow(target);
    })
  );
});

/* ── Message from page ── */
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

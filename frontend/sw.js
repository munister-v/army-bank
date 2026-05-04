/* Army Bank — Service Worker v117 */
const SW_VERSION = '2026-05-04-05';
const CACHE = `army-bank-v${SW_VERSION}`;

/* Keep precache minimal to reduce stale-asset risk */
const PRECACHE = [
  '/offline.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

function asNoStore(request) {
  return new Request(request, { cache: 'no-store' });
}

function isStaticCodeOrManifest(pathname) {
  return pathname.endsWith('.css')
    || pathname.endsWith('.js')
    || pathname.endsWith('.mjs')
    || pathname.endsWith('/manifest.json');
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // Non-fatal: precache failures (offline.html missing, icon 404) must NOT block activation
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));

    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (_) {}
    }

    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach((client) => client.postMessage({
      type: 'SW_UPDATED',
      swVersion: SW_VERSION,
      cacheName: CACHE,
      at: Date.now(),
    }));
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  if (e.request.method !== 'GET') return;

  // Never proxy API/push in SW.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/push')) return;

  // Ignore external backend origin directly.
  if (url.hostname.includes('onrender.com')) return;

  // Google Fonts: cache-first.
  if (
    url.hostname === 'fonts.googleapis.com'
    || url.hostname === 'fonts.gstatic.com'
    || url.pathname.endsWith('.woff2')
  ) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((cache) => cache.put(e.request, clone));
        return res;
      }))
    );
    return;
  }

  // App navigations: always try fresh HTML first (no-store).
  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const preloaded = await e.preloadResponse;
        if (preloaded) {
          const cache = await caches.open(CACHE);
          cache.put(e.request, preloaded.clone());
          return preloaded;
        }

        const fresh = await fetch(asNoStore(e.request));
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE);
          cache.put(e.request, fresh.clone());
        }
        return fresh;
      } catch (_) {
        const cached = await caches.match(e.request);
        return cached || caches.match('/offline.html');
      }
    })());
    return;
  }

  // Icons: cache-first (stable assets).
  if (url.pathname.startsWith('/icons/')) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        if (res.ok) caches.open(CACHE).then((cache) => cache.put(e.request, res.clone()));
        return res;
      }))
    );
    return;
  }

  // CSS/JS/manifest: network-first + no-store to avoid stale bundles.
  if (url.origin === self.location.origin && isStaticCodeOrManifest(url.pathname)) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(asNoStore(e.request));
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE);
          cache.put(e.request, fresh.clone());
        }
        return fresh;
      } catch (_) {
        const cached = await caches.match(e.request);
        return cached || Response.error();
      }
    })());
    return;
  }

  // Default: stale-while-revalidate for other same-origin assets.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(e.request);

    const update = fetch(e.request)
      .then((res) => {
        if (res && res.ok) cache.put(e.request, res.clone());
        return res;
      })
      .catch(() => cached);

    return cached || update;
  })());
});

self.addEventListener('push', (e) => {
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

  e.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  if (e.action === 'dismiss') return;

  const target = e.notification.data?.url || '/dashboard';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const existing = list.find((client) => {
        try { return new URL(client.url).origin === self.location.origin; }
        catch { return false; }
      });

      if (existing) {
        return existing.focus().then((client) => {
          try { client.navigate(target); } catch (_) {}
          return client;
        });
      }
      return clients.openWindow(target);
    })
  );
});

self.addEventListener('message', (e) => {
  const msg = e.data || {};
  if (msg.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (msg.type === 'GET_SW_VERSION') {
    try {
      e.source?.postMessage({ type: 'SW_VERSION', swVersion: SW_VERSION, cacheName: CACHE });
    } catch (_) {}
    return;
  }

  if (msg.type === 'CLEAR_RUNTIME_CACHES') {
    e.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clients.forEach((client) => client.postMessage({ type: 'SW_CACHE_CLEARED', cacheName: CACHE }));
    })());
  }
});

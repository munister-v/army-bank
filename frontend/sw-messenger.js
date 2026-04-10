/* Army Bank Messenger — Service Worker */
const SW_VERSION = new URL(self.location.href).searchParams.get('v') || '37';
const CACHE = `msng-v${SW_VERSION}`;
const SCOPE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, '');
const withBase = (path) => `${SCOPE_PATH}${path}`.replace(/\/{2,}/g, '/');
const withVersion = (path) => `${withBase(path)}?v=${encodeURIComponent(SW_VERSION)}`;
const STATIC = [
  withBase('/messenger'),
  withVersion('/css/messenger.css'),
  withVersion('/js/messenger.js'),
  withVersion('/manifest-messenger.json'),
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
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // Never cache API calls
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith(withBase('/api/'))) return;

  const isHtml = request.headers.get('accept')?.includes('text/html');
  const isCoreStatic = isSameOrigin && (
    url.pathname.startsWith('/css/') ||
    url.pathname.startsWith('/js/') ||
    url.pathname.startsWith(withBase('/css/')) ||
    url.pathname.startsWith(withBase('/js/')) ||
    url.pathname === '/manifest-messenger.json' ||
    url.pathname === withBase('/manifest-messenger.json') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith(withBase('/icons/'))
  );

  // Network-first for html + core static (prevents stale UI)
  if (isHtml || isCoreStatic) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const fresh = await fetch(request);
        if (isSameOrigin) await cache.put(request, fresh.clone());
        return fresh;
      } catch (err) {
        const cached = await cache.match(request);
        if (cached) return cached;
        if (isHtml) {
          const shell = await cache.match(withBase('/messenger'));
          if (shell) return shell;
        }
        throw err;
      }
    })());
    return;
  }

  // Cache-first fallback for other safe assets
  e.respondWith(
    caches.match(request).then(cached => cached || fetch(request))
  );
});

self.addEventListener('push', event => {
  const fallback = {
    title: 'Army Bank',
    body: 'Нове сповіщення',
    url: '/messenger',
    type: 'default',
  };

  let payload = fallback;
  try {
    const data = event.data?.json?.();
    if (data && typeof data === 'object') payload = { ...fallback, ...data };
  } catch (_) {}

  event.waitUntil(
    self.registration.showNotification(String(payload.title || fallback.title), {
      body: String(payload.body || ''),
      icon: '/icons/chat-icon-180.png',
      badge: '/icons/chat-icon-32.png',
      tag: payload.type ? `ab-${String(payload.type)}` : 'ab-default',
      renotify: true,
      data: {
        url: String(payload.url || '/messenger'),
        type: String(payload.type || 'default'),
      },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetPath = String(event.notification?.data?.url || '/messenger');
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const targetUrl = new URL(targetPath, self.location.origin).href;
    for (const client of allClients) {
      if (client.url === targetUrl && 'focus' in client) {
        await client.focus();
        return;
      }
    }
    if (allClients.length && 'focus' in allClients[0]) {
      await allClients[0].focus();
      return;
    }
    if ('openWindow' in self.clients) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});

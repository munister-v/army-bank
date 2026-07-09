/* ARM CRM Messenger — Service Worker */
const SW_VERSION = new URL(self.location.href).searchParams.get('v') || '43';
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

function normalizePushPayload(rawPayload) {
  const fallback = {
    title: 'ARM CRM',
    body: 'Нове сповіщення',
    url: '/messenger',
    type: 'default',
  };
  if (!rawPayload || typeof rawPayload !== 'object') return fallback;
  return { ...fallback, ...rawPayload };
}

function buildNotificationDescriptor(payload) {
  const type = String(payload.type || 'default');
  const convId = Number(payload.conversation_id || 0) || 0;
  const callId = Number(payload.call_id || 0) || 0;
  const convSuffix = convId > 0 ? `?conv=${convId}` : '';

  const sharedData = {
    url: String(payload.url || '/messenger'),
    type,
    conversation_id: convId || undefined,
    call_id: callId || undefined,
  };

  const base = {
    title: String(payload.title || 'ARM CRM'),
    body: String(payload.body || ''),
    icon: '/icons/chat-icon-180.png',
    badge: '/icons/chat-icon-32.png',
    renotify: true,
    requireInteraction: false,
    data: sharedData,
    tag: 'ab-default',
    actions: [
      { action: 'open_messenger', title: 'Відкрити' },
    ],
  };

  if (type === 'call_incoming') {
    return {
      ...base,
      title: String(payload.title || '📞 Вхідний дзвінок'),
      body: String(payload.body || 'Відкрийте Messenger, щоб відповісти.'),
      tag: callId ? `ab-call-incoming-${callId}` : 'ab-call-incoming',
      requireInteraction: true,
      vibrate: [250, 120, 250, 120, 550],
      data: { ...sharedData, url: `/messenger${convSuffix}` || '/messenger' },
      actions: [
        { action: 'open_call', title: 'Відповісти' },
        { action: 'open_messenger', title: 'Чат' },
      ],
    };
  }

  if (type === 'call_missed') {
    return {
      ...base,
      title: String(payload.title || 'Пропущений дзвінок'),
      tag: 'ab-call-missed',
      vibrate: [160, 80, 160, 80, 160],
      actions: [{ action: 'open_call', title: 'Передзвонити' }],
    };
  }

  if (type === 'call_answered') {
    return {
      ...base,
      title: String(payload.title || 'Дзвінок прийнято'),
      tag: callId ? `ab-call-answered-${callId}` : 'ab-call-answered',
      vibrate: [100, 40, 100],
      actions: [{ action: 'open_call', title: 'Відкрити дзвінок' }],
    };
  }

  if (type === 'call_rejected') {
    return {
      ...base,
      title: String(payload.title || 'Дзвінок відхилено'),
      tag: 'ab-call-rejected',
      vibrate: [90, 45, 90],
    };
  }

  if (type === 'call_ended') {
    return {
      ...base,
      title: String(payload.title || 'Дзвінок завершено'),
      tag: 'ab-call-ended',
      vibrate: [80],
    };
  }

  if (type === 'assistant_reply') {
    return {
      ...base,
      title: String(payload.title || 'ARM Bank Assistant ✅'),
      tag: convId ? `ab-assistant-${convId}` : 'ab-assistant',
      vibrate: [70, 35, 70],
      actions: [{ action: 'open_chat', title: 'Відкрити чат' }],
    };
  }

  if (type === 'push_test') {
    return {
      ...base,
      title: String(payload.title || '🔔 ARM CRM'),
      body: String(payload.body || 'Тестове push-сповіщення'),
      tag: 'ab-push-test',
      vibrate: [80, 50, 80, 50, 160],
      actions: [{ action: 'open_messenger', title: 'Відкрити Messenger' }],
    };
  }

  if (type === 'message_voice') {
    return {
      ...base,
      title: String(payload.title || 'ARM CRM'),
      body: String(payload.body || '🎤 Голосове повідомлення'),
      tag: convId ? `ab-msg-voice-${convId}` : 'ab-msg-voice',
      vibrate: [120, 60, 120],
      actions: [{ action: 'open_chat', title: 'Прослухати' }],
    };
  }

  if (type === 'message_image') {
    return {
      ...base,
      title: String(payload.title || 'ARM CRM'),
      body: String(payload.body || '🖼️ Нове фото'),
      tag: convId ? `ab-msg-image-${convId}` : 'ab-msg-image',
      vibrate: [100, 50, 100],
      actions: [{ action: 'open_chat', title: 'Переглянути' }],
    };
  }

  if (type === 'message_text') {
    return {
      ...base,
      tag: convId ? `ab-msg-text-${convId}` : 'ab-msg-text',
      vibrate: [90, 45, 90],
      actions: [
        { action: 'open_chat', title: 'Відкрити чат' },
        { action: 'open_messenger', title: 'Усі чати' },
      ],
    };
  }

  return base;
}

self.addEventListener('push', event => {
  let payload = null;
  try {
    payload = event.data?.json?.();
  } catch (_) {
    payload = null;
  }

  const normalized = normalizePushPayload(payload);
  const descriptor = buildNotificationDescriptor(normalized);
  event.waitUntil(
    self.registration.showNotification(descriptor.title, {
      body: descriptor.body,
      icon: descriptor.icon,
      badge: descriptor.badge,
      tag: descriptor.tag,
      renotify: !!descriptor.renotify,
      requireInteraction: !!descriptor.requireInteraction,
      vibrate: descriptor.vibrate,
      actions: Array.isArray(descriptor.actions) ? descriptor.actions : [],
      data: descriptor.data || {},
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const clickAction = String(event.action || 'open_messenger');
  const info = event.notification?.data || {};
  const convId = Number(info.conversation_id || 0) || 0;
  const callId = Number(info.call_id || 0) || 0;

  let targetPath = String(info.url || '/messenger');
  if ((clickAction === 'open_chat' || clickAction === 'open_call') && convId > 0) {
    targetPath = `/messenger?conv=${convId}`;
  } else if (clickAction === 'open_call' && callId > 0) {
    targetPath = `/messenger?call=${callId}`;
  }

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

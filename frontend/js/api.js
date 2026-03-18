// Army Bank — REST API клієнт
// При розміщенні на сайті під /bank (наприклад munister.com.ua/bank) використовується window.ARMY_BANK_BASE.
const BASE = (typeof window !== 'undefined' && window.ARMY_BANK_BASE) || '';

const api = {
  // ── Token ──────────────────────────────────────────────────────────────────
  // Читаємо з localStorage — зберігається назавжди до явного виходу
  token: localStorage.getItem('army_bank_token') || '',

  setToken(token) {
    this.token = token || '';
    if (this.token) {
      localStorage.setItem('army_bank_token', this.token);
    } else {
      localStorage.removeItem('army_bank_token');
    }
  },

  // ── HTTP ───────────────────────────────────────────────────────────────────
  async request(url, options = {}) {
    const fullUrl = (url.startsWith('http') || url.startsWith('//')) ? url : BASE + url;
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const response = await fetch(fullUrl, { ...options, headers });

    // Автооновлення токену — якщо сервер повернув X-Refresh-Token
    const refreshed = response.headers.get('X-Refresh-Token');
    if (refreshed && refreshed !== this.token) {
      this.setToken(refreshed);
    }

    let payload;
    try {
      const text = await response.text();
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(response.ok ? 'Помилка читання відповіді.' : 'Помилка сервера. Спробуйте пізніше.');
    }

    if (!response.ok || payload.ok === false) {
      // При 401 — очищаємо токен щоб не ходити з невалідним
      if (response.status === 401) {
        this.setToken('');
      }
      throw new Error(payload.error || 'Помилка запиту до сервера.');
    }

    return payload.data ?? payload;
  },

  // ── Web Push ───────────────────────────────────────────────────────────────
  VAPID_PUBLIC_KEY: 'BBkDBdD-nffWa34kkN60vFPKbsiUhz4htDfdAQUp7eVrlLIiaAveTB_qd5xGxGaUrTOXsSk50GmdYnmOARV9wJs',

  _urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  },

  async subscribePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: this._urlBase64ToUint8Array(this.VAPID_PUBLIC_KEY),
        });
      }
      const key = sub.getKey('p256dh');
      const auth = sub.getKey('auth');
      await this.request('/api/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({
          endpoint: sub.endpoint,
          p256dh: btoa(String.fromCharCode(...new Uint8Array(key))),
          auth:   btoa(String.fromCharCode(...new Uint8Array(auth))),
        }),
      });
      return true;
    } catch (_) {
      return false;
    }
  },

  async requestPushPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return this.subscribePush();
    if (Notification.permission === 'denied') return false;
    const perm = await Notification.requestPermission();
    if (perm === 'granted') return this.subscribePush();
    return false;
  },
};

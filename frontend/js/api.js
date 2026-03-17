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
};

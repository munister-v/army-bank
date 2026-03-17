// Базовий клієнт для роботи з REST API Army Bank.
// При розміщенні на сайті під /bank (наприклад munister.com.ua/bank) використовується window.ARMY_BANK_BASE.
const BASE = (typeof window !== 'undefined' && window.ARMY_BANK_BASE) || '';

const api = {
  token: localStorage.getItem('army_bank_token') || '',

  setToken(token) {
    this.token = token || '';
    if (this.token) {
      localStorage.setItem('army_bank_token', this.token);
    } else {
      localStorage.removeItem('army_bank_token');
    }
  },

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
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || 'Помилка запиту до сервера.');
    }
    return payload.data ?? payload;
  },
};

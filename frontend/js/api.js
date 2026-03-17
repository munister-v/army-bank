// Базовий клієнт для роботи з REST API Army Bank.
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
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const response = await fetch(url, { ...options, headers });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || 'Помилка запиту до сервера.');
    }
    return payload.data ?? payload;
  },
};

// Army Bank — головний фронтенд
const state = {
  user: null,
  account: null,
  paymentTemplates: [],
  _pollTimer: null,
  _lastBalance: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function showToast(message, type = '') {
  const toast = $('#toast');
  toast.textContent = message;
  toast.className = type ? `toast ${type}` : 'toast';
  toast.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add('hidden'), 3200);
}

/* ── Auto-refresh balance every 40 s ── */
async function _pollBalance() {
  if (!api.token || !state.account) return;
  try {
    const fresh = await api.request('/api/accounts/main');
    const prev = state._lastBalance;
    state._lastBalance = fresh.balance;
    state.account = fresh;

    // Update balance display without full page reload
    const bal = formatMoney(fresh.balance);
    const heroBalEl = $('#heroBalance');
    if (heroBalEl) heroBalEl.textContent = bal;
    const balVal = $('#balanceValue');
    if (balVal) balVal.textContent = bal;

    // Toast if balance grew
    if (prev !== null && fresh.balance > prev + 0.01) {
      const diff = fresh.balance - prev;
      showToast(`💰 +${formatMoney(diff)} нараховано!`, 'success');
    }
  } catch (_) {}
}

function startPolling() {
  stopPolling();
  state._pollTimer = setInterval(_pollBalance, 40_000);
}

function stopPolling() {
  if (state._pollTimer) {
    clearInterval(state._pollTimer);
    state._pollTimer = null;
  }
  state._lastBalance = null;
}

function setAuthenticated(authenticated) {
  $('#authScreen').classList.toggle('hidden', authenticated);
  $('#appScreen').classList.toggle('hidden', !authenticated);
  // sidebar = bottom-nav (id reused for compat)
  $('#sidebar')?.classList.toggle('hidden', !authenticated);
  document.body.classList.toggle('auth-mode', !authenticated);
}

function formatMoney(value) {
  return `₴${Number(value || 0).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function setListLoading(containerSelector, loading) {
  const container = $(containerSelector);
  if (!container) return;
  container.classList.toggle('loading', !!loading);
}

function setButtonLoading(button, loading) {
  if (!button) return;
  if (loading) {
    button.disabled = true;
    button.dataset.originalText = button.textContent;
    button.textContent = 'Завантаження…';
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || button.textContent;
  }
}

function renderList(containerSelector, items, renderer, emptyText) {
  const container = $(containerSelector);
  if (!container) return;
  container.classList.remove('loading');
  if (!items.length) {
    container.innerHTML = `<div class="empty-state"><strong>Нічого немає</strong>${emptyText || 'Даних поки немає.'}</div>`;
    return;
  }
  container.innerHTML = items.map(renderer).join('');
}

function renderTransactions(list, container = '#transactionsList') {
  renderList(container, list, (tx) => `
    <div class="item">
      <div class="item-header">
        <strong>${tx.description}</strong>
        <span class="amount ${tx.direction}">${tx.direction === 'in' ? '+' : '−'}${formatMoney(tx.amount)}</span>
      </div>
      <div class="muted">${tx.tx_type} · ${tx.created_at}${tx.related_account ? ` · ${tx.related_account}` : ''}</div>
    </div>
  `, 'Транзакцій поки немає.');
}

function renderSimpleList(container, list, mapFn, emptyText) {
  renderList(container, list, mapFn, emptyText);
}

function getBasePath() {
  return (typeof window !== 'undefined' && window.ARMY_BANK_BASE) || '';
}

function getScreenIdFromPath() {
  let path = window.location.pathname;
  const base = getBasePath();
  if (base) path = path.replace(new RegExp('^' + base.replace(/\//g, '\\/')), '') || '/';
  path = path.replace(/^\//, '') || 'dashboard';
  const allowed = ['dashboard', 'transactions', 'payouts', 'donations', 'savings', 'contacts'];
  return allowed.includes(path) ? path : 'dashboard';
}

function switchScreen(screenId) {
  const id = ['dashboard', 'transactions', 'payouts', 'donations', 'savings', 'contacts'].includes(screenId)
    ? screenId : 'dashboard';

  $$('.screen').forEach((s) => s.classList.remove('active-screen'));
  const el = $(`#${id}`);
  if (el) el.classList.add('active-screen');

  // Update nav active state (bottom-nav + desktop sidebar nav)
  $$('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.screen === id);
  });
  // Also update legacy .menu-btn if any
  $$('.menu-btn:not(.nav-item)').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.screen === id);
  });

  if (id === 'transactions') loadTransactionsWithFilters();
}

async function refreshProfile() {
  state.user = await api.request('/api/auth/me');
  state.account = await api.request('/api/accounts/main');

  // Header info
  const nameEl = $('#userName');
  if (nameEl) nameEl.textContent = state.user.full_name;

  const roleLabels = { soldier: 'Клієнт', operator: 'Оператор', admin: 'Адміністратор', platform_admin: 'Платформа' };
  const metaEl = $('#userMeta');
  if (metaEl) metaEl.textContent = `${roleLabels[state.user.role] || state.user.role} · ${state.user.email}`;

  // Avatar initials
  const avatarEl = $('#userAvatar');
  if (avatarEl && state.user.full_name) {
    const parts = state.user.full_name.trim().split(' ');
    avatarEl.textContent = (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
  }

  // Balance display
  const balance = formatMoney(state.account.balance);
  const heroBalEl = $('#heroBalance');
  if (heroBalEl) heroBalEl.textContent = balance;
  const heroAccEl = $('#heroAccount');
  if (heroAccEl) heroAccEl.textContent = `Рахунок: ${state.account.account_number || '—'}`;

  // Legacy hidden elements
  const balVal = $('#balanceValue');
  if (balVal) balVal.textContent = balance;
  const accNum = $('#accountNumber');
  if (accNum) accNum.textContent = `Рахунок: ${state.account.account_number}`;

  // Show admin/operator nav items
  const adminLink = $('.nav-admin');
  const operatorLink = $('.nav-operator');
  const platformLink = $('.nav-platform');
  if (adminLink) adminLink.classList.toggle('hidden', state.user.role !== 'admin' && state.user.role !== 'platform_admin');
  if (operatorLink) operatorLink.classList.toggle('hidden', !['operator','admin','platform_admin'].includes(state.user.role));
  if (platformLink) platformLink.classList.toggle('hidden', state.user.role !== 'platform_admin');
}

async function loadPaymentTemplates() {
  try {
    state.paymentTemplates = await api.request('/api/payment-templates');
  } catch (_) {
    state.paymentTemplates = [];
  }
  const sel = $('#transferTemplateSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Обрати шаблон —</option>' +
    state.paymentTemplates.map((t) =>
      `<option value="${t.id}" data-account="${t.recipient_account || ''}" data-amount="${t.amount || ''}" data-desc="${(t.description || '').replace(/"/g, '&quot;')}">${t.name}</option>`
    ).join('');
}

async function loadTransactionsWithFilters() {
  const container = $('#transactionsList');
  if (container) setListLoading('#transactionsList', true);
  const form = $('#transactionsFilters');
  let url = '/api/transactions/history';
  if (form) {
    const fd = new FormData(form);
    const params = new URLSearchParams();
    if (fd.get('from_date')) params.set('from_date', fd.get('from_date'));
    if (fd.get('to_date'))   params.set('to_date',   fd.get('to_date'));
    if (fd.get('tx_type'))   params.set('tx_type',   fd.get('tx_type'));
    if (fd.get('direction')) params.set('direction', fd.get('direction'));
    const q = params.toString();
    if (q) url += '?' + q;
  }
  try {
    const list = await api.request(url);
    renderTransactions(list, '#transactionsList');
  } catch (e) {
    renderTransactions([], '#transactionsList');
  } finally {
    if (container) setListLoading('#transactionsList', false);
  }
}

async function refreshAllData() {
  ['#recentTransactions','#transactionsList','#payoutsList','#donationsList','#goalsList','#contactsList']
    .forEach((s) => setListLoading(s, true));

  await refreshProfile();
  await loadPaymentTemplates();

  try {
    const [transactions, payouts, donations, goals, contacts] = await Promise.all([
      api.request('/api/transactions/history'),
      api.request('/api/payouts'),
      api.request('/api/donations'),
      api.request('/api/savings-goals'),
      api.request('/api/family-contacts'),
    ]);

    renderTransactions(transactions.slice(0, 5), '#recentTransactions');
    renderTransactions(transactions, '#transactionsList');

    renderSimpleList('#payoutsList', payouts, (row) => `
      <div class="item">
        <div class="item-header"><strong>${row.title}</strong><span class="amount in">+${formatMoney(row.amount)}</span></div>
        <div class="muted">${row.payout_type} · ${row.status} · ${row.created_at}</div>
      </div>
    `, 'Виплат поки немає.');

    renderSimpleList('#donationsList', donations, (row) => `
      <div class="item">
        <div class="item-header"><strong>${row.fund_name}</strong><span class="amount out">−${formatMoney(row.amount)}</span></div>
        <div class="muted">${row.comment || 'Без коментаря'} · ${row.created_at}</div>
      </div>
    `, 'Донатів поки немає.');

    renderSimpleList('#goalsList', goals, (row) => {
      const pct = row.target_amount > 0 ? Math.min(100, Math.round(row.current_amount / row.target_amount * 100)) : 0;
      return `
        <div class="item">
          <div class="item-header"><strong>${row.title}</strong><span>${formatMoney(row.current_amount)} / ${formatMoney(row.target_amount)}</span></div>
          <div class="muted">${row.status}${row.deadline ? ` · до ${row.deadline}` : ''} · ${pct}%</div>
        </div>
      `;
    }, 'Цілей накопичення поки немає.');

    renderSimpleList('#contactsList', contacts, (row) => `
      <div class="item">
        <div class="item-header"><strong>${row.contact_name}</strong><span>${row.relation_type}</span></div>
        <div class="muted">${row.phone || 'Телефон не вказано'}${row.account_number ? ` · ${row.account_number}` : ''}</div>
      </div>
    `, 'Контактів поки немає.');

  } finally {
    ['#recentTransactions','#transactionsList','#payoutsList','#donationsList','#goalsList','#contactsList']
      .forEach((s) => setListLoading(s, false));
  }
}

async function handleAuth(form, endpoint) {
  const formData = Object.fromEntries(new FormData(form).entries());
  const result = await api.request(endpoint, { method: 'POST', body: JSON.stringify(formData) });
  api.setToken(result.token);
  setAuthenticated(true);
  await refreshAllData();
  const screen = getScreenIdFromPath();
  switchScreen(screen);
  const base = getBasePath();
  const targetPath = base ? base + '/' + screen : '/' + screen;
  if (window.location.pathname !== targetPath) window.history.replaceState(null, '', targetPath);
  showToast('Успішна авторизація.');
  startPolling();
  updatePushDot();
  // If permission already granted — re-subscribe immediately (refreshes endpoint on server)
  if (Notification?.permission === 'granted') {
    api.subscribePush().catch(() => {});
  }
  // Note: requestPermission must be from user gesture on iOS — bell button handles this
}

function bindJsonForm(selector, endpoint, options = {}) {
  const form = $(selector);
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const btn = form.querySelector('button[type="submit"], button:not([type])');
    try {
      setButtonLoading(btn, true);
      const values = Object.fromEntries(new FormData(form).entries());
      const payload = options.transform ? options.transform(values) : values;
      await api.request(endpoint(payload), { method: 'POST', body: JSON.stringify(payload) });
      form.reset();
      if (options.afterReset) options.afterReset(form);
      await refreshAllData();
      if (options.afterSuccess) options.afterSuccess();
      showToast(options.successMessage || 'Операцію виконано.');
    } catch (error) {
      showToast(error.message);
    } finally {
      setButtonLoading(btn, false);
    }
  });
}

// ── AUTH FORMS ───────────────────────────────────────────
$('#loginForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const btn = form.querySelector('button[type="submit"]');
  try {
    setButtonLoading(btn, true);
    await handleAuth(form, '/api/auth/login');
  } catch (error) {
    showToast(error.message);
  } finally {
    setButtonLoading(btn, false);
  }
});

$('#registerForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const btn = form.querySelector('button[type="submit"]');
  try {
    setButtonLoading(btn, true);
    await handleAuth(form, '/api/auth/register');
  } catch (error) {
    showToast(error.message);
  } finally {
    setButtonLoading(btn, false);
  }
});

// ── BOUND FORMS ──────────────────────────────────────────
bindJsonForm('#topupForm', () => '/api/transactions/topup', {
  transform: (v) => ({ ...v, amount: Number(v.amount) }),
  successMessage: 'Рахунок поповнено.',
  afterReset: (form) => { form.description.value = 'Поповнення рахунку'; },
});

bindJsonForm('#transferForm', () => '/api/transactions/transfer', {
  transform: (v) => ({
    recipient_account_number: v.recipient_account_number,
    amount: Number(v.amount),
    description: v.description || 'Переказ',
  }),
  successMessage: 'Переказ виконано.',
  afterReset: (form) => {
    form.description.value = 'Переказ родині';
    const sel = $('#transferTemplateSelect');
    if (sel) sel.value = '';
  },
});

$('#transferTemplateSelect')?.addEventListener('change', function () {
  const opt = this.selectedOptions[0];
  if (!opt || !opt.value) return;
  const form = $('#transferForm');
  if (form) {
    form.recipient_account_number.value = opt.dataset.account || '';
    form.amount.value = opt.dataset.amount || '';
    form.description.value = (opt.dataset.desc || '').replace(/&quot;/g, '"');
  }
});

bindJsonForm('#demoPayoutForm', () => '/api/payouts/demo-accrual', {
  transform: (v) => ({ ...v, amount: Number(v.amount) }),
  successMessage: 'Виплату нараховано.',
  afterReset: (form) => { form.title.value = 'Бойова виплата'; form.payout_type.value = 'combat'; form.amount.value = '10000'; },
});

bindJsonForm('#donationForm', () => '/api/donations', {
  transform: (v) => ({ ...v, amount: Number(v.amount) }),
  successMessage: 'Донат проведено.',
});

bindJsonForm('#goalForm', () => '/api/savings-goals', {
  transform: (v) => ({ ...v, target_amount: Number(v.target_amount) }),
  successMessage: 'Ціль накопичення створено.',
  afterReset: (form) => { form.title.value = 'Спорядження'; },
});

bindJsonForm('#goalContributionForm', (payload) => `/api/savings-goals/${payload.goal_id}/contribute`, {
  transform: (v) => ({ goal_id: Number(v.goal_id), amount: Number(v.amount) }),
  successMessage: 'Ціль поповнено.',
});

bindJsonForm('#contactForm', () => '/api/family-contacts', {
  successMessage: 'Контакт додано.',
});

bindJsonForm('#templateForm', () => '/api/payment-templates', {
  transform: (v) => ({
    name: v.name,
    recipient_account: v.recipient_account,
    amount: v.amount ? Number(v.amount) : null,
    description: v.description || '',
  }),
  successMessage: 'Шаблон збережено.',
  afterSuccess: () => loadPaymentTemplates(),
});

$('#transactionsFilters')?.addEventListener('submit', (event) => {
  event.preventDefault();
  loadTransactionsWithFilters();
  showToast('Фільтри застосовано.');
});

// ── NAVIGATION ───────────────────────────────────────────
$$('.nav-item.nav-link').forEach((btn) => {
  btn.addEventListener('click', (event) => {
    const screen = btn.dataset.screen;
    if (screen) {
      event.preventDefault();
      const base = getBasePath();
      window.history.pushState(null, '', base ? base + '/' + screen : '/' + screen);
      switchScreen(screen);
    }
  });
});

window.addEventListener('popstate', () => {
  switchScreen(getScreenIdFromPath());
});

// Quick action buttons
$$('[data-jump]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.jump;
    // Navigate to screen
    const screenMap = { history: 'transactions', 'donations-screen': 'donations', payouts: 'payouts', savings: 'savings', contacts: 'contacts' };
    if (screenMap[id]) {
      const target = screenMap[id];
      const base = getBasePath();
      window.history.pushState(null, '', base ? base + '/' + target : '/' + target);
      switchScreen(target);
      return;
    }
    // Scroll to form
    const formMap = { topup: '#topupForm', transfer: '#transferForm' };
    const target = formMap[id];
    if (target) {
      $(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// Auth tabs
$$('.auth-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const t = tab.dataset.tab;
    $$('.auth-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    $$('.auth-form').forEach((f) => f.classList.toggle('active',
      (f.id === 'loginForm' && t === 'login') || (f.id === 'registerForm' && t === 'register')
    ));
  });
});

// Logout
$('#logoutBtn')?.addEventListener('click', async () => {
  stopPolling();
  try { await api.request('/api/auth/logout', { method: 'POST' }); } catch (_) {}
  api.setToken('');
  setAuthenticated(false);
  const base = getBasePath();
  window.history.replaceState(null, '', base || '/');
  showToast('Ви вийшли з системи.');
});

// ── Push notification bell button ─────────────────────────
async function updatePushDot() {
  if (!('Notification' in window) || !('PushManager' in window)) return;
  const granted = Notification.permission === 'granted';
  const dot = $('#pushDot');
  if (dot) dot.style.display = granted ? 'block' : 'none';
}

$('#pushBtn')?.addEventListener('click', async () => {
  const btn = $('#pushBtn');
  if (!('Notification' in window)) {
    showToast('Браузер не підтримує сповіщення.');
    return;
  }
  if (!('PushManager' in window)) {
    showToast('Push API недоступний. На iPhone — додайте застосунок на Головний екран.');
    return;
  }
  if (Notification.permission === 'denied') {
    showToast('Сповіщення заблоковані. Дозвольте в налаштуваннях браузера / системи.');
    return;
  }

  btn.disabled = true;
  try {
    if (Notification.permission !== 'granted') {
      showToast('Запит дозволу на сповіщення…');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        showToast('Сповіщення не дозволені.');
        return;
      }
    }

    showToast('Підписка на сповіщення…');
    const ok = await api.subscribePush();
    if (!ok) {
      showToast('Не вдалося підписатись на сповіщення.');
      return;
    }
    updatePushDot();

    // Send test push so user confirms it works
    try {
      await api.testPush();
      showToast('🔔 Тест-сповіщення надіслано!', 'success');
    } catch (err) {
      showToast('Підписано. ' + (err.message || 'Помилка тест-пушу.'));
    }
  } finally {
    btn.disabled = false;
  }
});

// ── SW registration with instant update detection ────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(reg => {
    // Force check for SW update every time app opens
    reg.update().catch(() => {});

    // SW activated a new version → SW_UPDATED message → reload
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'SW_UPDATED') {
        // Small delay so the new SW finishes claiming clients
        setTimeout(() => location.reload(), 200);
      }
    });

    // Legacy: also handle via updatefound (covers cases where old SW sent SKIP_WAITING)
    reg.addEventListener('updatefound', () => {
      const newSW = reg.installing;
      newSW?.addEventListener('statechange', () => {
        if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
          newSW.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
  });
}

// ── BOOTSTRAP ────────────────────────────────────────────
(async function bootstrap() {
  if (!api.token) {
    setAuthenticated(false);
    return;
  }
  try {
    setAuthenticated(true);
    await refreshAllData();
    switchScreen(getScreenIdFromPath());
    startPolling();
    updatePushDot();
    // Re-subscribe push if permission already granted (refreshes subscription on server)
    if (Notification?.permission === 'granted') api.subscribePush().catch(() => {});
  } catch (error) {
    api.setToken('');
    setAuthenticated(false);
    showToast('Сесію завершено. Увійдіть повторно.');
  }
})();

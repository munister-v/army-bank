// Головний файл фронтенду: обробка подій, рендер списків та навігація.
const state = {
  user: null,
  account: null,
  paymentTemplates: [],
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2600);
}

function setAuthenticated(authenticated) {
  $('#authScreen').classList.toggle('hidden', authenticated);
  $('#appScreen').classList.toggle('hidden', !authenticated);
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
    container.innerHTML = `<div class="empty-state">${emptyText || 'Немає даних.'}</div>`;
    return;
  }
  container.innerHTML = items.map(renderer).join('');
}

function renderTransactions(list, container = '#transactionsList') {
  renderList(container, list, (tx) => `
    <div class="item">
      <div class="item-header">
        <strong>${tx.description}</strong>
        <span class="amount ${tx.direction}">${tx.direction === 'in' ? '+' : '-'}${formatMoney(tx.amount)}</span>
      </div>
      <div class="muted">Тип: ${tx.tx_type} · Дата: ${tx.created_at}${tx.related_account ? ` · Пов'язаний рахунок: ${tx.related_account}` : ''}</div>
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
  const id = ['dashboard', 'transactions', 'payouts', 'donations', 'savings', 'contacts'].includes(screenId) ? screenId : 'dashboard';
  $$('.screen').forEach((section) => section.classList.remove('active-screen'));
  const el = $(`#${id}`);
  if (el) el.classList.add('active-screen');
  $$('.menu-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.screen === id);
  });
  if (id === 'transactions') loadTransactionsWithFilters();
}

async function refreshProfile() {
  state.user = await api.request('/api/auth/me');
  state.account = await api.request('/api/accounts/main');
  $('#userName').textContent = state.user.full_name;
  const roleLabels = { soldier: 'Військовий', operator: 'Оператор', admin: 'Адмін', platform_admin: 'Платформа' };
  $('#userMeta').textContent = `${roleLabels[state.user.role] || state.user.role} · ${state.user.email}`;
  $('#balanceValue').textContent = formatMoney(state.account.balance);
  $('#accountNumber').textContent = `Рахунок: ${state.account.account_number}`;
  $('#heroBalance')?.replaceChildren(document.createTextNode(formatMoney(state.account.balance)));
  const masked = state.account.account_number ? `Рахунок: ${state.account.account_number}` : 'Рахунок: —';
  $('#heroAccount')?.replaceChildren(document.createTextNode(masked));
  const adminLink = $('.nav-admin');
  const operatorLink = $('.nav-operator');
  const platformLink = $('.nav-platform');
  if (adminLink) adminLink.classList.toggle('hidden', state.user.role !== 'admin' && state.user.role !== 'platform_admin');
  if (operatorLink) operatorLink.classList.toggle('hidden', state.user.role !== 'operator' && state.user.role !== 'admin' && state.user.role !== 'platform_admin');
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
    state.paymentTemplates.map((t) => `<option value="${t.id}" data-account="${t.recipient_account || ''}" data-amount="${t.amount || ''}" data-desc="${(t.description || '').replace(/"/g, '&quot;')}">${t.name}</option>`).join('');
}

async function loadTransactionsWithFilters() {
  const container = $('#transactionsList');
  if (container) setListLoading('#transactionsList', true);
  const form = $('#transactionsFilters');
  let url = '/api/transactions/history';
  if (form) {
    const fd = new FormData(form);
    const from = fd.get('from_date');
    const to = fd.get('to_date');
    const txType = fd.get('tx_type');
    const dir = fd.get('direction');
    const params = new URLSearchParams();
    if (from) params.set('from_date', from);
    if (to) params.set('to_date', to);
    if (txType) params.set('tx_type', txType);
    if (dir) params.set('direction', dir);
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
  setListLoading('#recentTransactions', true);
  setListLoading('#transactionsList', true);
  setListLoading('#payoutsList', true);
  setListLoading('#donationsList', true);
  setListLoading('#goalsList', true);
  setListLoading('#contactsList', true);
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
      <div class="muted">Тип: ${row.payout_type} · Статус: ${row.status} · ${row.created_at}</div>
    </div>
  `, 'Виплат поки немає.');
  renderSimpleList('#donationsList', donations, (row) => `
    <div class="item">
      <div class="item-header"><strong>${row.fund_name}</strong><span class="amount out">-${formatMoney(row.amount)}</span></div>
      <div class="muted">${row.comment || 'Без коментаря'} · ${row.created_at}</div>
    </div>
  `, 'Донатів поки немає.');
  renderSimpleList('#goalsList', goals, (row) => `
    <div class="item">
      <div class="item-header"><strong>#${row.id} ${row.title}</strong><span>${formatMoney(row.current_amount)} / ${formatMoney(row.target_amount)}</span></div>
      <div class="muted">Статус: ${row.status}${row.deadline ? ` · Дедлайн: ${row.deadline}` : ''}</div>
    </div>
  `, 'Цілей накопичення поки немає.');
  renderSimpleList('#contactsList', contacts, (row) => `
    <div class="item">
      <div class="item-header"><strong>${row.contact_name}</strong><span>${row.relation_type}</span></div>
      <div class="muted">${row.phone || 'Телефон не вказано'}${row.account_number ? ` · ${row.account_number}` : ''}</div>
    </div>
  `, 'Контактів поки немає.');
  } finally {
    setListLoading('#recentTransactions', false);
    setListLoading('#transactionsList', false);
    setListLoading('#payoutsList', false);
    setListLoading('#donationsList', false);
    setListLoading('#goalsList', false);
    setListLoading('#contactsList', false);
  }
}

async function handleAuth(form, endpoint) {
  const formData = Object.fromEntries(new FormData(form).entries());
  const result = await api.request(endpoint, {
    method: 'POST',
    body: JSON.stringify(formData),
  });
  api.setToken(result.token);
  setAuthenticated(true);
  await refreshAllData();
  const screen = getScreenIdFromPath();
  switchScreen(screen);
  const base = getBasePath();
  const targetPath = base ? base + '/' + screen : '/' + screen;
  if (window.location.pathname !== targetPath) {
    window.history.replaceState(null, '', targetPath);
  }
  showToast('Успішна авторизація.');
}

function bindJsonForm(selector, endpoint, options = {}) {
  const form = $(selector);
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    try {
      setButtonLoading(btn, true);
      const values = Object.fromEntries(new FormData(form).entries());
      const payload = options.transform ? options.transform(values) : values;
      await api.request(endpoint(payload), {
        method: 'POST',
        body: JSON.stringify(payload),
      });
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
  afterReset: (form) => { form.description.value = 'Переказ родині'; $('#transferTemplateSelect').value = ''; },
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

$$('.menu-btn.nav-link').forEach((btn) => {
  btn.addEventListener('click', (event) => {
    const screen = btn.dataset.screen;
    if (screen && !btn.href?.endsWith('/admin') && !btn.href?.endsWith('/operator')) {
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

$$('[data-jump]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.jump;
    if (id === 'history') {
      const base = getBasePath();
      window.history.pushState(null, '', base ? base + '/transactions' : '/transactions');
      switchScreen('transactions');
      return;
    }
    const target = id === 'topup' ? '#topupForm' : id === 'transfer' ? '#transferForm' : null;
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
    $$('.auth-form').forEach((f) => f.classList.toggle('active', (f.id === 'loginForm' && t === 'login') || (f.id === 'registerForm' && t === 'register')));
  });
});

$('#logoutBtn')?.addEventListener('click', async () => {
  try {
    await api.request('/api/auth/logout', { method: 'POST' });
  } catch (_) {}
  api.setToken('');
  setAuthenticated(false);
  const base = getBasePath();
  window.history.replaceState(null, '', base || '/');
  showToast('Ви вийшли з системи.');
});

(async function bootstrap() {
  if (!api.token) {
    setAuthenticated(false);
    return;
  }
  try {
    setAuthenticated(true);
    await refreshAllData();
    switchScreen(getScreenIdFromPath());
  } catch (error) {
    api.setToken('');
    setAuthenticated(false);
    showToast('Сесію завершено. Увійдіть повторно.');
  }
})();

// Army Bank — головний фронтенд v2.1
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

    const bal = formatMoney(fresh.balance);
    const heroBalEl = $('#heroBalance');
    if (heroBalEl) heroBalEl.textContent = bal;
    const balVal = $('#balanceValue');
    if (balVal) balVal.textContent = bal;

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

const TX_TYPE_LABELS = {
  topup: 'Поповнення', transfer: 'Переказ',
  payout: 'Виплата', donation: 'Донат', savings: 'Накопичення',
};

function renderTransactions(list, container = '#transactionsList') {
  renderList(container, list, (tx) => `
    <div class="item item-clickable" data-tx-id="${tx.id}">
      <div class="tx-dir-dot ${tx.direction}"></div>
      <div class="item-body">
        <div class="item-header">
          <strong>${tx.description}</strong>
          <span class="amount ${tx.direction}">${tx.direction === 'in' ? '+' : '−'}${formatMoney(tx.amount)}</span>
        </div>
        <div class="muted">${TX_TYPE_LABELS[tx.tx_type] || tx.tx_type} · ${formatDate(tx.created_at)}</div>
      </div>
    </div>
  `, 'Транзакцій поки немає.');

  // bind click → drawer
  $$(container + ' .item-clickable').forEach((el) => {
    el.addEventListener('click', () => openTxDrawer(Number(el.dataset.txId)));
  });
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' })
      + ' ' + d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  } catch (_) { return iso; }
}

function renderSimpleList(container, list, mapFn, emptyText) {
  renderList(container, list, mapFn, emptyText);
}

// ── TRANSACTION DRAWER ──────────────────────────────────
function openDrawer() {
  $('#txDrawer')?.classList.remove('hidden');
  $('#drawerBackdrop')?.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeDrawer() {
  $('#txDrawer')?.classList.add('hidden');
  $('#drawerBackdrop')?.classList.add('hidden');
  document.body.style.overflow = '';
}

async function openTxDrawer(txId) {
  if (!txId) return;
  openDrawer();
  const body = $('#drawerBody');
  if (body) body.innerHTML = '<div class="drawer-loading">Завантаження…</div>';
  try {
    const tx = await api.request(`/api/transactions/${txId}`);
    if (!body) return;
    body.innerHTML = `
      <div class="drawer-amount ${tx.direction}">
        ${tx.direction === 'in' ? '+' : '−'}${formatMoney(tx.amount)}
      </div>
      <dl class="drawer-info-list">
        <div class="drawer-info-row"><dt>Опис</dt><dd>${tx.description}</dd></div>
        <div class="drawer-info-row"><dt>Тип</dt><dd>${TX_TYPE_LABELS[tx.tx_type] || tx.tx_type}</dd></div>
        <div class="drawer-info-row"><dt>Напрям</dt><dd>${tx.direction === 'in' ? '↓ Прихід' : '↑ Відхід'}</dd></div>
        ${tx.related_account ? `<div class="drawer-info-row"><dt>Контрагент</dt><dd>${tx.related_account}</dd></div>` : ''}
        <div class="drawer-info-row"><dt>Дата</dt><dd>${formatDate(tx.created_at)}</dd></div>
        <div class="drawer-info-row"><dt>ID</dt><dd>#${tx.id}</dd></div>
      </dl>
    `;
  } catch (e) {
    if (body) body.innerHTML = `<div class="drawer-error">${e.message}</div>`;
  }
}

$('#drawerClose')?.addEventListener('click', closeDrawer);
$('#drawerBackdrop')?.addEventListener('click', closeDrawer);

// ── CONFIRM DIALOG ──────────────────────────────────────
let _confirmCallback = null;

function confirmAction(title, msg, onOk) {
  const dialog = $('#confirmDialog');
  const backdrop = $('#confirmBackdrop');
  $('#confirmTitle').textContent = title;
  $('#confirmMsg').textContent = msg;
  dialog?.classList.remove('hidden');
  backdrop?.classList.remove('hidden');
  _confirmCallback = onOk;
}

function closeConfirm() {
  $('#confirmDialog')?.classList.add('hidden');
  $('#confirmBackdrop')?.classList.add('hidden');
  _confirmCallback = null;
}

$('#confirmCancel')?.addEventListener('click', closeConfirm);
$('#confirmBackdrop')?.addEventListener('click', closeConfirm);
$('#confirmOk')?.addEventListener('click', () => {
  if (_confirmCallback) _confirmCallback();
  closeConfirm();
});

// ── CSV EXPORT ──────────────────────────────────────────
async function exportCsv() {
  const btn = $('#exportCsvBtn');
  try {
    setButtonLoading(btn, true);
    const form = $('#transactionsFilters');
    const params = new URLSearchParams();
    if (form) {
      const fd = new FormData(form);
      if (fd.get('from_date')) params.set('from_date', fd.get('from_date'));
      if (fd.get('to_date'))   params.set('to_date',   fd.get('to_date'));
    }
    const url = '/api/transactions/export' + (params.toString() ? '?' + params.toString() : '');
    const res = await fetch((typeof window !== 'undefined' && window.ARMY_BANK_BASE || '') + url, {
      headers: { Authorization: `Bearer ${api.token}` },
    });
    if (!res.ok) throw new Error('Помилка експорту');
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `army-bank-transactions-${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    showToast('CSV файл завантажено.', 'success');
  } catch (e) {
    showToast(e.message);
  } finally {
    setButtonLoading(btn, false);
  }
}

$('#exportCsvBtn')?.addEventListener('click', exportCsv);

// ── ANALYTICS ───────────────────────────────────────────
async function loadAnalytics() {
  try {
    const data = await api.request('/api/analytics/summary');
    const cur = data.current_month || {};
    const prev = data.prev_month || {};
    const byType = data.by_type || [];
    const monthly = data.monthly || [];

    // Summary cards
    const setEl = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    setEl('#amsIn',    formatMoney(cur.total_in  || 0));
    setEl('#amsOut',   formatMoney(cur.total_out || 0));
    setEl('#amsCount', cur.tx_count || cur.count || 0);

    const diffLabel = (cur_v, prev_v, isMoney) => {
      if (!prev_v) return '';
      const diff = cur_v - prev_v;
      const label = isMoney ? formatMoney(Math.abs(diff)) : Math.abs(diff);
      return diff >= 0 ? `▲ ${label} vs попередній місяць` : `▼ ${label} vs попередній місяць`;
    };
    const curCount  = cur.tx_count  || cur.count  || 0;
    const prevCount = prev.tx_count || prev.count || 0;
    setEl('#amsPrevIn',    diffLabel(cur.total_in  || 0, prev.total_in  || 0, true));
    setEl('#amsPrevOut',   diffLabel(cur.total_out || 0, prev.total_out || 0, true));
    setEl('#amsPrevCount', diffLabel(curCount, prevCount, false));

    // By type bar list
    const byTypeEl = $('#analyticsByType');
    if (byTypeEl) {
      const maxAmt = Math.max(...byType.map(r => Number(r.total) || 0), 1);
      byTypeEl.innerHTML = byType.length ? byType.map(r => {
        const pct = Math.round((Number(r.total) / maxAmt) * 100);
        return `
          <div class="cat-row">
            <span class="cat-label">${TX_TYPE_LABELS[r.tx_type] || r.tx_type}</span>
            <div class="cat-bar-wrap"><div class="cat-bar" style="width:${pct}%"></div></div>
            <span class="cat-amount">${formatMoney(r.total)}</span>
          </div>`;
      }).join('') : '<div class="empty-state">Операцій ще немає.</div>';
    }

    // 6-month bar chart
    const chartEl = $('#analyticsBarChart');
    if (chartEl && monthly.length) {
      const maxVal = Math.max(...monthly.map(m => Math.max(Number(m.total_in)||0, Number(m.total_out)||0)), 1);
      chartEl.innerHTML = monthly.map(m => {
        const inH  = Math.round((Number(m.total_in)  / maxVal) * 80);
        const outH = Math.round((Number(m.total_out) / maxVal) * 80);
        return `
          <div class="bar-group">
            <div class="bar-pair">
              <div class="bar bar-in"  style="height:${inH}px"  title="Прихід: ${formatMoney(m.total_in)}"></div>
              <div class="bar bar-out" style="height:${outH}px" title="Витрати: ${formatMoney(m.total_out)}"></div>
            </div>
            <div class="bar-label">${m.month || ''}</div>
          </div>`;
      }).join('');
    } else if (chartEl) {
      chartEl.innerHTML = '<div class="empty-state">Недостатньо даних для графіку.</div>';
    }
  } catch (_) {}
}

// ── PROFILE SCREEN ──────────────────────────────────────
function renderProfileScreen() {
  if (!state.user || !state.account) return;
  const roleLabels = { soldier: 'Клієнт', operator: 'Оператор', admin: 'Адміністратор', platform_admin: 'Платформа' };
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v || '—'; };
  set('#piName',    state.user.full_name);
  set('#piPhone',   state.user.phone);
  set('#piEmail',   state.user.email);
  set('#piAccount', state.account.account_number);
  set('#piRole',    roleLabels[state.user.role] || state.user.role);
}

// Change password form
$('#changePasswordForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = form.querySelector('button[type="submit"]');
  const fd = new FormData(form);
  const oldPw  = fd.get('old_password');
  const newPw  = fd.get('new_password');
  const confPw = fd.get('confirm_password');
  if (newPw !== confPw) {
    showToast('Паролі не збігаються.');
    return;
  }
  try {
    setButtonLoading(btn, true);
    await api.request('/api/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ old_password: oldPw, new_password: newPw }),
    });
    form.reset();
    showToast('Пароль змінено успішно.', 'success');
  } catch (err) {
    showToast(err.message);
  } finally {
    setButtonLoading(btn, false);
  }
});

// Profile logout button
$('#profileLogoutBtn')?.addEventListener('click', async () => {
  stopPolling();
  try { await api.request('/api/auth/logout', { method: 'POST' }); } catch (_) {}
  api.setToken('');
  setAuthenticated(false);
  const base = (typeof window !== 'undefined' && window.ARMY_BANK_BASE) || '';
  window.history.replaceState(null, '', base || '/');
  showToast('Ви вийшли з системи.');
});

// ── NAVIGATION ──────────────────────────────────────────
const ALLOWED_SCREENS = ['dashboard', 'transactions', 'payouts', 'donations', 'savings', 'contacts', 'analytics', 'profile'];

function getBasePath() {
  return (typeof window !== 'undefined' && window.ARMY_BANK_BASE) || '';
}

function getScreenIdFromPath() {
  let path = window.location.pathname;
  const base = getBasePath();
  if (base) path = path.replace(new RegExp('^' + base.replace(/\//g, '\\/')), '') || '/';
  path = path.replace(/^\//, '') || 'dashboard';
  return ALLOWED_SCREENS.includes(path) ? path : 'dashboard';
}

function switchScreen(screenId) {
  const id = ALLOWED_SCREENS.includes(screenId) ? screenId : 'dashboard';

  $$('.screen').forEach((s) => s.classList.remove('active-screen'));
  const el = $(`#${id}`);
  if (el) el.classList.add('active-screen');

  $$('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.screen === id);
  });
  $$('.menu-btn:not(.nav-item)').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.screen === id);
  });

  if (id === 'transactions') loadTransactionsWithFilters();
  if (id === 'analytics') loadAnalytics();
  if (id === 'profile') renderProfileScreen();
}

async function refreshProfile() {
  state.user = await api.request('/api/auth/me');
  state.account = await api.request('/api/accounts/main');

  const nameEl = $('#userName');
  if (nameEl) nameEl.textContent = state.user.full_name;

  const roleLabels = { soldier: 'Клієнт', operator: 'Оператор', admin: 'Адміністратор', platform_admin: 'Платформа' };
  const metaEl = $('#userMeta');
  if (metaEl) metaEl.textContent = `${roleLabels[state.user.role] || state.user.role} · ${state.user.email}`;

  const avatarEl = $('#userAvatar');
  if (avatarEl && state.user.full_name) {
    const parts = state.user.full_name.trim().split(' ');
    avatarEl.textContent = (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
  }

  const balance = formatMoney(state.account.balance);
  const heroBalEl = $('#heroBalance');
  if (heroBalEl) heroBalEl.textContent = balance;
  const heroAccEl = $('#heroAccount');
  if (heroAccEl) heroAccEl.textContent = `Рахунок: ${state.account.account_number || '—'}`;

  const balVal = $('#balanceValue');
  if (balVal) balVal.textContent = balance;
  const accNum = $('#accountNumber');
  if (accNum) accNum.textContent = `Рахунок: ${state.account.account_number}`;

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

async function deletePaymentTemplate(templateId) {
  try {
    await api.request(`/api/payment-templates/${templateId}`, { method: 'DELETE' });
    await loadPaymentTemplates();
    showToast('Шаблон видалено.', 'success');
  } catch (e) {
    showToast(e.message);
  }
}

async function loadTransactionsWithFilters() {
  const container = $('#transactionsList');
  if (container) setListLoading('#transactionsList', true);
  const form = $('#transactionsFilters');
  let url = '/api/transactions/history';
  const params = new URLSearchParams();
  if (form) {
    const fd = new FormData(form);
    if (fd.get('from_date')) params.set('from_date', fd.get('from_date'));
    if (fd.get('to_date'))   params.set('to_date',   fd.get('to_date'));
    if (fd.get('tx_type'))   params.set('tx_type',   fd.get('tx_type'));
    if (fd.get('direction')) params.set('direction', fd.get('direction'));
  }
  const searchVal = $('#txSearchInput')?.value?.trim();
  if (searchVal) params.set('search', searchVal);
  if (params.toString()) url += '?' + params.toString();
  try {
    const list = await api.request(url);
    renderTransactions(list, '#transactionsList');
  } catch (e) {
    renderTransactions([], '#transactionsList');
  } finally {
    if (container) setListLoading('#transactionsList', false);
  }
}

// Debounced search
let _searchTimer = null;
$('#txSearchInput')?.addEventListener('input', () => {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => loadTransactionsWithFilters(), 400);
});

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
        <div class="muted">${row.payout_type} · ${row.status} · ${formatDate(row.created_at)}</div>
      </div>
    `, 'Виплат поки немає.');

    renderSimpleList('#donationsList', donations, (row) => `
      <div class="item">
        <div class="item-header"><strong>${row.fund_name}</strong><span class="amount out">−${formatMoney(row.amount)}</span></div>
        <div class="muted">${row.comment || 'Без коментаря'} · ${formatDate(row.created_at)}</div>
      </div>
    `, 'Донатів поки немає.');

    // Goals with progress bars + delete
    renderSimpleList('#goalsList', goals, (row) => {
      const pct = row.target_amount > 0 ? Math.min(100, Math.round(row.current_amount / row.target_amount * 100)) : 0;
      return `
        <div class="item item-with-actions">
          <div class="item-main">
            <div class="item-header">
              <strong>${row.title}</strong>
              <span>${formatMoney(row.current_amount)} / ${formatMoney(row.target_amount)}</span>
            </div>
            <div class="progress-bar-wrap">
              <div class="progress-bar" style="width:${pct}%"></div>
            </div>
            <div class="muted">${row.status}${row.deadline ? ` · до ${row.deadline}` : ''} · ${pct}%</div>
          </div>
          <button class="btn-icon-danger" data-delete-goal="${row.id}" title="Видалити ціль" aria-label="Видалити">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>`;
    }, 'Цілей накопичення поки немає.');

    // Bind goal delete
    $$('#goalsList [data-delete-goal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const goalId = Number(btn.dataset.deleteGoal);
        confirmAction('Видалити ціль?', 'Ціль буде видалена. Кошти залишаться на рахунку.', async () => {
          try {
            await api.request(`/api/savings-goals/${goalId}`, { method: 'DELETE' });
            await refreshAllData();
            showToast('Ціль видалено.', 'success');
          } catch (e) { showToast(e.message); }
        });
      });
    });

    // Contacts with transfer + delete
    renderSimpleList('#contactsList', contacts, (row) => `
      <div class="item item-with-actions">
        <div class="item-main">
          <div class="item-header"><strong>${row.contact_name}</strong><span class="muted">${row.relation_type}</span></div>
          <div class="muted">${row.phone || 'Телефон не вказано'}${row.account_number ? ` · ${row.account_number}` : ''}</div>
        </div>
        <div class="item-btns">
          ${row.account_number ? `
            <button class="btn-icon-transfer" data-transfer-account="${row.account_number}" title="Переказ" aria-label="Переказ">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </button>` : ''}
          <button class="btn-icon-danger" data-delete-contact="${row.id}" title="Видалити" aria-label="Видалити">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>
    `, 'Контактів поки немає.');

    // Bind contact transfer → fill transfer form
    $$('#contactsList [data-transfer-account]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const acc = btn.dataset.transferAccount;
        const form = $('#transferForm');
        if (form) {
          form.recipient_account_number.value = acc;
          const base = getBasePath();
          window.history.pushState(null, '', base ? base + '/dashboard' : '/dashboard');
          switchScreen('dashboard');
          form.scrollIntoView({ behavior: 'smooth', block: 'start' });
          showToast(`Рахунок ${acc} підставлено у форму переказу.`);
        }
      });
    });

    // Bind contact delete
    $$('#contactsList [data-delete-contact]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const contactId = Number(btn.dataset.deleteContact);
        confirmAction('Видалити контакт?', 'Контакт буде видалено безповоротно.', async () => {
          try {
            await api.request(`/api/family-contacts/${contactId}`, { method: 'DELETE' });
            await refreshAllData();
            showToast('Контакт видалено.', 'success');
          } catch (e) { showToast(e.message); }
        });
      });
    });

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
  if (Notification?.permission === 'granted') {
    api.subscribePush().catch(() => {});
  }
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

// ── NAV CLICKS ───────────────────────────────────────────
$$('.nav-item.nav-link, .nav-link').forEach((btn) => {
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
    const screenMap = { history: 'transactions', 'donations-screen': 'donations', payouts: 'payouts', savings: 'savings', contacts: 'contacts' };
    if (screenMap[id]) {
      const target = screenMap[id];
      const base = getBasePath();
      window.history.pushState(null, '', base ? base + '/' + target : '/' + target);
      switchScreen(target);
      return;
    }
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

// Logout (header button)
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

// ── SW update detection ───────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(reg => {
    reg.update().catch(() => {});

    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'SW_UPDATED') {
        setTimeout(() => location.reload(), 200);
      }
    });

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
    if (Notification?.permission === 'granted') api.subscribePush().catch(() => {});
  } catch (error) {
    api.setToken('');
    setAuthenticated(false);
    showToast('Сесію завершено. Увійдіть повторно.');
  }
})();

// Army Bank PWA — app.js v2.0
'use strict';

/* ─── State ─────────────────────────────────────────── */
const state = {
  user: null,
  account: null,
  paymentTemplates: [],
  analytics: null,
};

/* ─── DOM helpers ─────────────────────────────────────── */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ─── Toast ──────────────────────────────────────────── */
let toastTimer = null;
function showToast(message, type = 'info') {
  const toast = $('#toast');
  toast.textContent = message;
  toast.className = `toast toast-${type}`;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3200);
}

/* ─── Auth state ─────────────────────────────────────── */
function setAuthenticated(authenticated) {
  $('#authScreen').classList.toggle('hidden', authenticated);
  $('#appScreen').classList.toggle('hidden', !authenticated);
  $('#sidebar')?.classList.toggle('hidden', !authenticated);
  document.body.classList.toggle('auth-mode', !authenticated);
}

/* ─── Formatting ─────────────────────────────────────── */
function formatMoney(value) {
  return `₴${Number(value || 0).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const TX_TYPE_LABELS = {
  topup: 'Поповнення', transfer: 'Переказ', payout: 'Виплата',
  donation: 'Донат', savings: 'Накопичення',
};

const PAYOUT_TYPE_LABELS = {
  combat: 'Бойова', allowance: 'Надбавка', compensation: 'Компенсація', bonus: 'Преміальна',
};

const ROLE_LABELS = {
  soldier: 'Військовий', operator: 'Оператор', admin: 'Адміністратор', platform_admin: 'Платформа',
};

/* ─── Loading states ─────────────────────────────────── */
function setListLoading(sel, loading) {
  $(sel)?.classList.toggle('loading', !!loading);
}

function setButtonLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.disabled = true;
    btn.dataset.originalText = btn.innerHTML;
    btn.textContent = 'Завантаження…';
  } else {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.originalText || btn.innerHTML;
  }
}

/* ─── List rendering ─────────────────────────────────── */
function renderList(sel, items, renderer, emptyText) {
  const container = $(sel);
  if (!container) return;
  container.classList.remove('loading');
  if (!items || !items.length) {
    container.innerHTML = `<div class="empty-state"><strong>Поки що порожньо</strong>${emptyText || ''}</div>`;
    return;
  }
  container.innerHTML = items.map(renderer).join('');
}

/* ─── Transaction rendering ──────────────────────────── */
function txIcon(tx) {
  if (tx.direction === 'in') {
    return `<span class="tx-dir-icon tx-dir-in">↓</span>`;
  }
  return `<span class="tx-dir-icon tx-dir-out">↑</span>`;
}

function renderTransactionItem(tx) {
  const sign = tx.direction === 'in' ? '+' : '−';
  const label = TX_TYPE_LABELS[tx.tx_type] || tx.tx_type;
  return `
    <div class="item item-clickable" data-tx-id="${tx.id}">
      <div class="item-header">
        <div class="item-left">
          ${txIcon(tx)}
          <div>
            <strong>${tx.description}</strong>
            <div class="muted">${label}${tx.related_account ? ` · ${tx.related_account}` : ''}</div>
          </div>
        </div>
        <div class="item-right">
          <span class="amount ${tx.direction}">${sign}${formatMoney(tx.amount)}</span>
          <div class="muted tx-date">${tx.created_at}</div>
        </div>
      </div>
    </div>`;
}

function renderTransactions(list, container = '#transactionsList') {
  renderList(container, list, renderTransactionItem, 'Транзакцій поки немає.');
  // bind click → drawer
  $$(container + ' .item-clickable').forEach((el) => {
    el.addEventListener('click', () => openTxDrawer(Number(el.dataset.txId)));
  });
}

/* ─── Profile ─────────────────────────────────────────── */
async function refreshProfile() {
  state.user = await api.request('/api/auth/me');
  state.account = await api.request('/api/accounts/main');

  $('#userName').textContent = state.user.full_name;
  const roleLabel = ROLE_LABELS[state.user.role] || state.user.role;
  $('#userMeta').textContent = `${roleLabel} · ${state.user.email}`;
  $('#balanceValue').textContent = formatMoney(state.account.balance);

  const accNum = state.account.account_number || '—';
  $('#accountNumber').textContent = `Рахунок: ${accNum}`;
  $('#heroBalance')?.replaceChildren(document.createTextNode(formatMoney(state.account.balance)));
  $('#heroAccount')?.replaceChildren(document.createTextNode(`Рахунок: ${accNum}`));

  // Profile screen
  $('#profileName').textContent  = state.user.full_name || '—';
  $('#profilePhone').textContent = state.user.phone || '—';
  $('#profileEmail').textContent = state.user.email || '—';
  $('#profileRole').textContent  = roleLabel;
  $('#profileStatus').textContent = state.user.military_status || 'Не вказано';
  $('#profileAccountNumber').textContent = accNum;
  $('#profileBalance').textContent = formatMoney(state.account.balance);

  // Role-based nav
  const adminLink    = $('.nav-admin');
  const operatorLink = $('.nav-operator');
  const platformLink = $('.nav-platform');
  if (adminLink)    adminLink.classList.toggle('hidden',    !['admin', 'platform_admin'].includes(state.user.role));
  if (operatorLink) operatorLink.classList.toggle('hidden', !['operator', 'admin', 'platform_admin'].includes(state.user.role));
  if (platformLink) platformLink.classList.toggle('hidden', state.user.role !== 'platform_admin');
}

/* ─── Payment templates ──────────────────────────────── */
async function loadPaymentTemplates() {
  try {
    state.paymentTemplates = await api.request('/api/payment-templates');
  } catch (_) {
    state.paymentTemplates = [];
  }
  // Dropdown
  const sel = $('#transferTemplateSelect');
  if (sel) {
    sel.innerHTML = '<option value="">— Обрати шаблон —</option>' +
      state.paymentTemplates.map((t) =>
        `<option value="${t.id}" data-account="${t.recipient_account || ''}" data-amount="${t.amount || ''}" data-desc="${(t.description || '').replace(/"/g, '&quot;')}">${t.name}</option>`
      ).join('');
  }
  // Render list with delete button
  renderList('#templatesList', state.paymentTemplates, (t) => `
    <div class="item">
      <div class="item-header">
        <div>
          <strong>${t.name}</strong>
          <div class="muted">${t.recipient_account}${t.amount ? ` · ${formatMoney(t.amount)}` : ''}</div>
        </div>
        <div class="btn-row">
          <button type="button" class="ghost-btn small-btn btn-use-template" data-account="${t.recipient_account}" data-amount="${t.amount || ''}" data-desc="${(t.description || '').replace(/"/g, '&quot;')}">
            Використати
          </button>
          ${!t.is_system ? `<button type="button" class="danger-ghost-btn small-btn btn-delete-template" data-id="${t.id}">✕</button>` : ''}
        </div>
      </div>
    </div>
  `, 'Шаблонів поки немає.');

  $$('#templatesList .btn-use-template').forEach((btn) => {
    btn.addEventListener('click', () => {
      const form = $('#transferForm');
      if (form) {
        form.recipient_account_number.value = btn.dataset.account || '';
        form.amount.value = btn.dataset.amount || '';
        form.description.value = (btn.dataset.desc || '').replace(/&quot;/g, '"');
      }
      const base = getBasePath();
      window.history.pushState(null, '', base ? base + '/dashboard' : '/dashboard');
      switchScreen('dashboard');
      setTimeout(() => $('#transferForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    });
  });

  $$('#templatesList .btn-delete-template').forEach((btn) => {
    btn.addEventListener('click', () => {
      confirmAction('Видалити шаблон?', 'Цю дію неможливо скасувати.', async () => {
        await api.request(`/api/payment-templates/${btn.dataset.id}`, { method: 'DELETE' });
        showToast('Шаблон видалено.', 'success');
        await loadPaymentTemplates();
      });
    });
  });
}

/* ─── Transactions with filters ──────────────────────── */
async function loadTransactionsWithFilters() {
  setListLoading('#transactionsList', true);
  const form = $('#transactionsFilters');
  let url = '/api/transactions/history';
  if (form) {
    const fd = new FormData(form);
    const params = new URLSearchParams();
    if (fd.get('from_date'))  params.set('from_date', fd.get('from_date'));
    if (fd.get('to_date'))    params.set('to_date',   fd.get('to_date'));
    if (fd.get('tx_type'))    params.set('tx_type',   fd.get('tx_type'));
    if (fd.get('direction'))  params.set('direction', fd.get('direction'));
    if (fd.get('search'))     params.set('search',    fd.get('search'));
    const q = params.toString();
    if (q) url += '?' + q;
  }
  try {
    const list = await api.request(url);
    renderTransactions(list, '#transactionsList');
  } catch (e) {
    renderTransactions([], '#transactionsList');
  } finally {
    setListLoading('#transactionsList', false);
  }
}

/* ─── Analytics ──────────────────────────────────────── */
async function loadAnalytics() {
  try {
    const data = await api.request('/api/analytics/summary');
    state.analytics = data;

    const cur = data.current_month;
    const prev = data.prev_month;

    $('#analyticsIn').textContent   = formatMoney(cur.total_in);
    $('#analyticsOut').textContent  = formatMoney(cur.total_out);
    $('#analyticsTxCount').textContent = cur.tx_count || 0;
    $('#statMonthIn').textContent   = formatMoney(cur.total_in);
    $('#statMonthOut').textContent  = formatMoney(cur.total_out);
    $('#statMonthCount').textContent = cur.tx_count || 0;

    // vs prev month
    const vpEl = $('#analyticsVsPrev');
    if (vpEl) {
      const inDiff  = (cur.total_in  || 0) - (prev.total_in  || 0);
      const outDiff = (cur.total_out || 0) - (prev.total_out || 0);
      vpEl.innerHTML = `
        <span class="${inDiff >= 0 ? 'in' : 'out'}">
          Прихід: ${inDiff >= 0 ? '+' : ''}${formatMoney(inDiff)}
        </span>
        <span class="${outDiff <= 0 ? 'in' : 'out'}">
          Витрати: ${outDiff >= 0 ? '+' : ''}${formatMoney(outDiff)}
        </span>`;
    }

    // Categories
    const catEl = $('#analyticsCategories');
    if (catEl && data.by_type && data.by_type.length) {
      const maxAmount = Math.max(...data.by_type.map((r) => r.total));
      catEl.innerHTML = data.by_type.map((r) => {
        const pct = maxAmount > 0 ? Math.round((r.total / maxAmount) * 100) : 0;
        const label = TX_TYPE_LABELS[r.tx_type] || r.tx_type;
        const dir = r.direction === 'in' ? 'in' : 'out';
        return `
          <div class="cat-row">
            <div class="cat-meta">
              <span class="cat-name">${label} <span class="cat-dir ${dir}">${r.direction === 'in' ? 'прихід' : 'відхід'}</span></span>
              <span class="cat-amount ${dir}">${formatMoney(r.total)}</span>
            </div>
            <div class="cat-bar-wrap">
              <div class="cat-bar ${dir}" style="width:${pct}%"></div>
            </div>
          </div>`;
      }).join('');
    } else if (catEl) {
      catEl.innerHTML = '<div class="empty-state">Транзакцій у цьому місяці немає.</div>';
    }

    // Monthly chart
    const chartEl = $('#analyticsChart');
    if (chartEl && data.monthly && data.monthly.length) {
      const maxVal = Math.max(...data.monthly.flatMap((m) => [m.total_in, m.total_out]));
      chartEl.innerHTML = data.monthly.map((m) => {
        const inH  = maxVal > 0 ? Math.round((m.total_in  / maxVal) * 120) : 4;
        const outH = maxVal > 0 ? Math.round((m.total_out / maxVal) * 120) : 4;
        const [year, month] = m.month.split('-');
        const monthName = new Date(year, month - 1).toLocaleString('uk-UA', { month: 'short' });
        return `
          <div class="bar-group">
            <div class="bar-cols">
              <div class="bar bar-in"  style="height:${inH}px"  title="Прихід: ${formatMoney(m.total_in)}"></div>
              <div class="bar bar-out" style="height:${outH}px" title="Витрати: ${formatMoney(m.total_out)}"></div>
            </div>
            <div class="bar-label">${monthName}</div>
          </div>`;
      }).join('');
    } else if (chartEl) {
      chartEl.innerHTML = '<div class="empty-state">Недостатньо даних для графіка.</div>';
    }
  } catch (e) {
    // silent
  }
}

/* ─── All data refresh ───────────────────────────────── */
async function refreshAllData() {
  setListLoading('#recentTransactions', true);
  setListLoading('#transactionsList',   true);
  setListLoading('#payoutsList',        true);
  setListLoading('#donationsList',      true);
  setListLoading('#goalsList',          true);
  setListLoading('#contactsList',       true);

  await refreshProfile();
  await loadPaymentTemplates();
  await loadAnalytics();

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

    // Payouts
    renderList('#payoutsList', payouts, (row) => `
      <div class="item">
        <div class="item-header">
          <div class="item-left">
            <span class="tx-dir-icon tx-dir-in">↓</span>
            <div>
              <strong>${row.title}</strong>
              <div class="muted">${PAYOUT_TYPE_LABELS[row.payout_type] || row.payout_type} · ${row.status || 'нараховано'}</div>
            </div>
          </div>
          <div class="item-right">
            <span class="amount in">+${formatMoney(row.amount)}</span>
            <div class="muted tx-date">${row.created_at}</div>
          </div>
        </div>
      </div>`, 'Виплат поки немає.');

    // Donations
    renderList('#donationsList', donations, (row) => `
      <div class="item">
        <div class="item-header">
          <div class="item-left">
            <span class="tx-dir-icon tx-dir-out">↑</span>
            <div>
              <strong>${row.fund_name}</strong>
              <div class="muted">${row.comment || 'Без коментаря'}</div>
            </div>
          </div>
          <div class="item-right">
            <span class="amount out">−${formatMoney(row.amount)}</span>
            <div class="muted tx-date">${row.created_at}</div>
          </div>
        </div>
      </div>`, 'Донатів поки немає.');

    // Goals with progress bars
    renderList('#goalsList', goals, (row) => {
      const pct = row.target_amount > 0
        ? Math.min(100, Math.round((row.current_amount / row.target_amount) * 100))
        : 0;
      const isComplete = row.status === 'completed' || pct >= 100;
      return `
        <div class="item">
          <div class="item-header">
            <div>
              <strong>#${row.id} ${row.title}</strong>
              <div class="muted">${formatMoney(row.current_amount)} / ${formatMoney(row.target_amount)}${row.deadline ? ` · Дедлайн: ${row.deadline}` : ''}</div>
            </div>
            <div class="btn-row">
              <span class="status-badge ${isComplete ? 'badge-ok' : 'badge-active'}">${isComplete ? 'Виконано' : `${pct}%`}</span>
              <button type="button" class="danger-ghost-btn small-btn btn-delete-goal" data-id="${row.id}">✕</button>
            </div>
          </div>
          <div class="progress-bar-wrap" title="${pct}%">
            <div class="progress-bar" style="width:${pct}%"></div>
          </div>
        </div>`;
    }, 'Цілей накопичення поки немає.');

    $$('#goalsList .btn-delete-goal').forEach((btn) => {
      btn.addEventListener('click', () => {
        confirmAction('Видалити ціль накопичення?', 'Кошти залишаться на рахунку.', async () => {
          await api.request(`/api/savings-goals/${btn.dataset.id}`, { method: 'DELETE' });
          showToast('Ціль видалено.', 'success');
          await refreshAllData();
        });
      });
    });

    // Contacts
    renderList('#contactsList', contacts, (row) => `
      <div class="item">
        <div class="item-header">
          <div>
            <strong>${row.contact_name}</strong>
            <div class="muted">${row.relation_type}${row.phone ? ` · ${row.phone}` : ''}${row.account_number ? ` · ${row.account_number}` : ''}</div>
          </div>
          <div class="btn-row">
            ${row.account_number ? `<button type="button" class="ghost-btn small-btn btn-transfer-contact" data-account="${row.account_number}" data-name="${row.contact_name}">Переказати</button>` : ''}
            <button type="button" class="danger-ghost-btn small-btn btn-delete-contact" data-id="${row.id}">✕</button>
          </div>
        </div>
      </div>`, 'Контактів поки немає.');

    $$('#contactsList .btn-transfer-contact').forEach((btn) => {
      btn.addEventListener('click', () => {
        const form = $('#transferForm');
        if (form) {
          form.recipient_account_number.value = btn.dataset.account;
          form.description.value = `Переказ: ${btn.dataset.name}`;
          form.amount.value = '';
        }
        const base = getBasePath();
        window.history.pushState(null, '', base ? base + '/dashboard' : '/dashboard');
        switchScreen('dashboard');
        setTimeout(() => { $('#transferForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); form?.amount?.focus(); }, 100);
      });
    });

    $$('#contactsList .btn-delete-contact').forEach((btn) => {
      btn.addEventListener('click', () => {
        confirmAction('Видалити контакт?', 'Цю дію неможливо скасувати.', async () => {
          await api.request(`/api/family-contacts/${btn.dataset.id}`, { method: 'DELETE' });
          showToast('Контакт видалено.', 'success');
          await refreshAllData();
        });
      });
    });

  } finally {
    setListLoading('#recentTransactions', false);
    setListLoading('#transactionsList',   false);
    setListLoading('#payoutsList',        false);
    setListLoading('#donationsList',      false);
    setListLoading('#goalsList',          false);
    setListLoading('#contactsList',       false);
  }
}

/* ─── Auth ────────────────────────────────────────────── */
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
  showToast('Успішна авторизація.', 'success');
}

/* ─── Generic form binder ────────────────────────────── */
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
      const ep = typeof endpoint === 'function' ? endpoint(payload) : endpoint;
      await api.request(ep, { method: options.method || 'POST', body: JSON.stringify(payload) });
      form.reset();
      if (options.afterReset) options.afterReset(form);
      await refreshAllData();
      if (options.afterSuccess) await options.afterSuccess();
      showToast(options.successMessage || 'Операцію виконано.', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setButtonLoading(btn, false);
    }
  });
}

/* ─── Navigation ─────────────────────────────────────── */
const SCREENS = ['dashboard', 'transactions', 'analytics', 'payouts', 'donations', 'savings', 'contacts', 'profile'];

function getBasePath() {
  return (typeof window !== 'undefined' && window.ARMY_BANK_BASE) || '';
}

function getScreenIdFromPath() {
  let path = window.location.pathname;
  const base = getBasePath();
  if (base) path = path.replace(new RegExp('^' + base.replace(/\//g, '\\/')), '') || '/';
  path = path.replace(/^\//, '') || 'dashboard';
  return SCREENS.includes(path) ? path : 'dashboard';
}

function switchScreen(screenId) {
  const id = SCREENS.includes(screenId) ? screenId : 'dashboard';
  $$('.screen').forEach((s) => s.classList.remove('active-screen'));
  $(`#${id}`)?.classList.add('active-screen');
  $$('.menu-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.screen === id));
  if (id === 'transactions') loadTransactionsWithFilters();
  if (id === 'analytics')    loadAnalytics();
}

/* ─── Transaction detail drawer ─────────────────────── */
function openDrawer() {
  $('#txDrawer').classList.add('open');
  $('#drawerBackdrop').classList.add('open');
}

function closeDrawer() {
  $('#txDrawer').classList.remove('open');
  $('#drawerBackdrop').classList.remove('open');
}

async function openTxDrawer(txId) {
  const body = $('#drawerBody');
  body.innerHTML = '<div class="loading-spinner" style="margin:32px auto;display:block"></div>';
  openDrawer();
  try {
    const tx = await api.request(`/api/transactions/${txId}`);
    const sign = tx.direction === 'in' ? '+' : '−';
    const label = TX_TYPE_LABELS[tx.tx_type] || tx.tx_type;
    body.innerHTML = `
      <div class="drawer-tx-amount ${tx.direction}">${sign}${formatMoney(tx.amount)}</div>
      <div class="drawer-tx-desc">${tx.description}</div>
      <div class="drawer-info-list">
        <div class="di-row"><span class="di-label">ID</span><span class="di-val">#${tx.id}</span></div>
        <div class="di-row"><span class="di-label">Тип</span><span class="di-val">${label}</span></div>
        <div class="di-row"><span class="di-label">Напрям</span><span class="di-val ${tx.direction}">${tx.direction === 'in' ? 'Прихід' : 'Відхід'}</span></div>
        ${tx.related_account ? `<div class="di-row"><span class="di-label">Рахунок</span><span class="di-val">${tx.related_account}</span></div>` : ''}
        <div class="di-row"><span class="di-label">Дата</span><span class="di-val">${tx.created_at}</span></div>
      </div>`;
  } catch (e) {
    body.innerHTML = `<div class="empty-state"><strong>Помилка</strong>${e.message}</div>`;
  }
}

/* ─── Confirm dialog ─────────────────────────────────── */
function confirmAction(title, msg, onOk) {
  $('#confirmTitle').textContent = title;
  $('#confirmMsg').textContent   = msg;
  $('#confirmBackdrop').classList.add('open');
  $('#confirmDialog').classList.add('open');
  const cleanup = () => {
    $('#confirmBackdrop').classList.remove('open');
    $('#confirmDialog').classList.remove('open');
    $('#confirmOk').replaceWith($('#confirmOk').cloneNode(true));
    $('#confirmCancel').replaceWith($('#confirmCancel').cloneNode(true));
    rebindConfirm();
  };
  function rebindConfirm() {
    $('#confirmOk').addEventListener('click', async () => {
      cleanup();
      try { await onOk(); } catch (e) { showToast(e.message, 'error'); }
    });
    $('#confirmCancel').addEventListener('click', cleanup);
  }
  rebindConfirm();
}

/* ─── Copy to clipboard ──────────────────────────────── */
function bindCopyButtons() {
  $$('.account-number-copy').forEach((el) => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', async () => {
      const text = (el.textContent || '').replace('Рахунок: ', '').trim();
      try {
        await navigator.clipboard.writeText(text);
        showToast(`Скопійовано: ${text}`, 'success');
      } catch { showToast('Не вдалось скопіювати.', 'error'); }
    });
  });
}

/* ─── Export CSV ─────────────────────────────────────── */
async function exportCsv() {
  try {
    const form = $('#transactionsFilters');
    const params = new URLSearchParams();
    if (form) {
      const fd = new FormData(form);
      if (fd.get('from_date')) params.set('from_date', fd.get('from_date'));
      if (fd.get('to_date'))   params.set('to_date',   fd.get('to_date'));
    }
    const url = '/api/transactions/export' + (params.toString() ? '?' + params.toString() : '');
    // Fetch as blob
    const fullUrl = (typeof window !== 'undefined' && window.ARMY_BANK_BASE ? window.ARMY_BANK_BASE : '') + url;
    const resp = await fetch(fullUrl, {
      headers: { Authorization: `Bearer ${api.token}` },
    });
    if (!resp.ok) throw new Error('Помилка експорту.');
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'army_bank_transactions.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('CSV завантажено.', 'success');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

/* ─── Bind all forms ─────────────────────────────────── */

// Login
$('#loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.currentTarget.querySelector('button[type="submit"]');
  try {
    setButtonLoading(btn, true);
    await handleAuth(e.currentTarget, '/api/auth/login');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setButtonLoading(btn, false);
  }
});

// Register
$('#registerForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.currentTarget.querySelector('button[type="submit"]');
  try {
    setButtonLoading(btn, true);
    await handleAuth(e.currentTarget, '/api/auth/register');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setButtonLoading(btn, false);
  }
});

// Top-up
bindJsonForm('#topupForm', '/api/transactions/topup', {
  transform: (v) => ({ ...v, amount: Number(v.amount) }),
  successMessage: 'Рахунок поповнено.',
  afterReset: (form) => { form.description.value = 'Поповнення рахунку'; },
});

// Transfer
bindJsonForm('#transferForm', '/api/transactions/transfer', {
  transform: (v) => ({
    recipient_account_number: v.recipient_account_number,
    amount: Number(v.amount),
    description: v.description || 'Переказ',
  }),
  successMessage: 'Переказ виконано.',
  afterReset: (form) => { form.description.value = 'Переказ родині'; $('#transferTemplateSelect').value = ''; },
});

// Template select → fill transfer form
$('#transferTemplateSelect')?.addEventListener('change', function () {
  const opt = this.selectedOptions[0];
  if (!opt?.value) return;
  const form = $('#transferForm');
  if (form) {
    form.recipient_account_number.value = opt.dataset.account || '';
    form.amount.value = opt.dataset.amount || '';
    form.description.value = (opt.dataset.desc || '').replace(/&quot;/g, '"');
  }
});

// Demo payout
bindJsonForm('#demoPayoutForm', '/api/payouts/demo-accrual', {
  transform: (v) => ({ ...v, amount: Number(v.amount) }),
  successMessage: 'Виплату нараховано.',
  afterReset: (form) => { form.title.value = 'Бойова виплата'; form.amount.value = '10000'; },
});

// Donation
bindJsonForm('#donationForm', '/api/donations', {
  transform: (v) => ({ ...v, amount: Number(v.amount) }),
  successMessage: 'Донат проведено.',
});

// Savings goal
bindJsonForm('#goalForm', '/api/savings-goals', {
  transform: (v) => ({ ...v, target_amount: Number(v.target_amount) }),
  successMessage: 'Ціль накопичення створено.',
  afterReset: (form) => { form.title.value = 'Спорядження'; },
});

// Goal contribution
bindJsonForm('#goalContributionForm', (payload) => `/api/savings-goals/${payload.goal_id}/contribute`, {
  transform: (v) => ({ goal_id: Number(v.goal_id), amount: Number(v.amount) }),
  successMessage: 'Ціль поповнено.',
});

// Contact add
bindJsonForm('#contactForm', '/api/family-contacts', {
  successMessage: 'Контакт додано.',
});

// Template save
bindJsonForm('#templateForm', '/api/payment-templates', {
  transform: (v) => ({
    name: v.name,
    recipient_account: v.recipient_account,
    amount: v.amount ? Number(v.amount) : null,
    description: v.description || '',
  }),
  successMessage: 'Шаблон збережено.',
  afterSuccess: () => loadPaymentTemplates(),
});

// Change password
$('#changePasswordForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = form.querySelector('button[type="submit"]');
  const vals = Object.fromEntries(new FormData(form).entries());
  if (vals.new_password !== vals.confirm_password) {
    showToast('Паролі не збігаються.', 'error');
    return;
  }
  try {
    setButtonLoading(btn, true);
    await api.request('/api/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ old_password: vals.old_password, new_password: vals.new_password }),
    });
    form.reset();
    showToast('Пароль змінено.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setButtonLoading(btn, false);
  }
});

// Transactions filter
$('#transactionsFilters')?.addEventListener('submit', (e) => {
  e.preventDefault();
  loadTransactionsWithFilters();
});

// Export CSV
$('#exportCsvBtn')?.addEventListener('click', exportCsv);

// Drawer close
$('#drawerClose')?.addEventListener('click', closeDrawer);
$('#drawerBackdrop')?.addEventListener('click', closeDrawer);

// Confirm cancel
$('#confirmBackdrop')?.addEventListener('click', () => {
  $('#confirmBackdrop').classList.remove('open');
  $('#confirmDialog').classList.remove('open');
});

/* ─── Nav links ──────────────────────────────────────── */
$$('.menu-btn.nav-link').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    const screen = btn.dataset.screen;
    if (screen && SCREENS.includes(screen)) {
      e.preventDefault();
      const base = getBasePath();
      window.history.pushState(null, '', base ? base + '/' + screen : '/' + screen);
      switchScreen(screen);
    }
  });
});

window.addEventListener('popstate', () => switchScreen(getScreenIdFromPath()));

// Quick action tiles
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
    if (target) $(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  try { await api.request('/api/auth/logout', { method: 'POST' }); } catch (_) {}
  api.setToken('');
  setAuthenticated(false);
  const base = getBasePath();
  window.history.replaceState(null, '', base || '/');
  showToast('Ви вийшли з системи.');
});

/* ─── Bootstrap ──────────────────────────────────────── */
(async function bootstrap() {
  if (!api.token) { setAuthenticated(false); return; }
  try {
    setAuthenticated(true);
    await refreshAllData();
    switchScreen(getScreenIdFromPath());
    bindCopyButtons();
  } catch (error) {
    api.setToken('');
    setAuthenticated(false);
    showToast('Сесію завершено. Увійдіть повторно.');
  }
})();

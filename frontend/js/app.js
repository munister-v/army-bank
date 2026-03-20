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
  const el = $(container);
  if (!el) return;
  el.classList.remove('loading');
  if (!list.length) {
    el.innerHTML = '<div class="empty-state"><strong>Нічого немає</strong>Транзакцій поки немає.</div>';
    return;
  }

  // Group by date
  const groups = {};
  list.forEach(tx => {
    const day = (tx.created_at || '').slice(0, 10);
    if (!groups[day]) groups[day] = [];
    groups[day].push(tx);
  });

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  function dayLabel(day) {
    if (!day || day.length < 8) return 'Невідома дата';
    if (day === today) return 'Сьогодні';
    if (day === yesterday) return 'Вчора';
    try {
      const d = new Date(day + 'T00:00:00');
      if (isNaN(d.getTime())) return day || 'Невідома дата';
      return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', weekday: 'short' });
    } catch(_) { return day || 'Невідома дата'; }
  }

  el.innerHTML = Object.keys(groups).sort((a,b) => b.localeCompare(a)).map(day => `
    <div class="tx-date-group">
      <div class="tx-date-label">${dayLabel(day)}</div>
      ${groups[day].map(tx => `
        <div class="item item-clickable" data-tx-id="${tx.id}">
          <div class="tx-dir-dot ${tx.direction}"></div>
          <div class="item-body">
            <div class="item-header">
              <strong>${tx.description}</strong>${tx.note ? ' <span title="Є нотатка" style="font-size:11px">📝</span>' : ''}
              <span class="amount ${tx.direction}">${tx.direction === 'in' ? '+' : '−'}${formatMoney(tx.amount)}</span>
            </div>
            <div class="muted">${TX_TYPE_LABELS[tx.tx_type] || tx.tx_type}${tx.related_account ? ` · ${tx.related_account}` : ''}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');

  // Bind click → drawer
  el.querySelectorAll('.item-clickable').forEach(item => {
    item.addEventListener('click', () => openTxDrawer(Number(item.dataset.txId)));
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
      <button class="btn-ghost" id="shareTxBtn" style="width:100%;margin-top:16px;display:flex;align-items:center;justify-content:center;gap:8px">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        Поділитися
      </button>
      <div class="drawer-note-section">
        <label class="drawer-note-label">Нотатка</label>
        <textarea id="drawerNoteInput" class="drawer-note-input" placeholder="Додайте особисту нотатку…" rows="2">${tx.note || ''}</textarea>
        <button id="saveNoteBtn" class="btn-ghost btn-sm" style="margin-top:6px">Зберегти нотатку</button>
      </div>
    `;
    $('#shareTxBtn')?.addEventListener('click', () => {
      if (typeof shareTransaction === 'function') shareTransaction(tx);
    });
    $('#saveNoteBtn')?.addEventListener('click', async () => {
      const note = $('#drawerNoteInput')?.value || '';
      try {
        await api.request(`/api/transactions/${tx.id}/note`, {
          method: 'PATCH', body: JSON.stringify({ note })
        });
        showToast('Нотатку збережено.', 'success');
      } catch(e) { showToast(e.message); }
    });
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

    // Update dashboard strip
    const setDash = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    setDash('#dashMonthIn',    formatMoney(cur.total_in  || 0));
    setDash('#dashMonthOut',   formatMoney(cur.total_out || 0));
    setDash('#dashMonthCount', cur.tx_count || cur.count || 0);

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

    // Render pie chart with by_type data
    if (typeof renderPieChart === 'function') {
      renderPieChart(byType);
    }
  } catch (_) {}

  // Load additional analytics features
  if (typeof loadInsights === 'function') loadInsights().catch(() => {});
  if (typeof loadBudgetLimits === 'function') loadBudgetLimits().catch(() => {});
  if (typeof renderHeatmap === 'function') renderHeatmap().catch(() => {});
  if (typeof loadForecast === 'function') loadForecast().catch(() => {});
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
  loadAchievements();
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
const ALLOWED_SCREENS = ['dashboard', 'transactions', 'payouts', 'donations', 'savings', 'contacts', 'analytics', 'profile', 'calendar', 'recurring', 'debts'];

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
  if (id === 'calendar') loadCalendar();
  if (id === 'recurring') { if (typeof loadRecurring === 'function') loadRecurring(); }
  if (id === 'debts') { if (typeof loadDebts === 'function') loadDebts(); }
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

    // Check goal completions for confetti celebrations
    if (typeof checkGoalCompletion === 'function') checkGoalCompletion(goals);

    // Goals with progress bars + delete + estimated completion
    renderSimpleList('#goalsList', goals, (row) => {
      const pct = row.target_amount > 0 ? Math.min(100, Math.round(row.current_amount / row.target_amount * 100)) : 0;
      const remaining = row.target_amount - row.current_amount;
      let estText = '';
      if (pct < 100 && remaining > 0) {
        estText = `· залишилось ${formatMoney(remaining)}`;
      }
      return `
        <div class="item item-with-actions">
          <div class="item-main">
            <div class="item-header">
              <strong>${row.title}</strong>
              <span class="pct-badge ${pct >= 100 ? 'done' : ''}">${pct}%</span>
            </div>
            <div class="progress-bar-wrap">
              <div class="progress-bar" style="width:${pct}%"></div>
            </div>
            <div class="muted">${formatMoney(row.current_amount)} / ${formatMoney(row.target_amount)} ${estText}${row.deadline ? ` · до ${row.deadline}` : ''}</div>
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
            <button class="btn-icon-history" data-history-account="${row.account_number}" data-history-name="${row.contact_name}" title="Історія переказів">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </button>
            <button class="btn-icon-transfer" data-transfer-account="${row.account_number}" title="Переказ" aria-label="Переказ">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </button>` : ''}
          <button class="btn-icon-danger" data-delete-contact="${row.id}" title="Видалити" aria-label="Видалити">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>
    `, 'Контактів поки немає.');

    // Bind contact history → drawer
    $$('#contactsList [data-history-account]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const acc  = btn.dataset.historyAccount;
        const name = btn.dataset.historyName;
        openDrawer();
        const body = $('#drawerBody');
        if (body) body.innerHTML = '<div class="drawer-loading">Завантаження…</div>';
        try {
          const txs = await api.request(`/api/transactions/with-contact/${encodeURIComponent(acc)}`);
          const totalIn  = txs.filter(t=>t.direction==='in').reduce((s,t)=>s+Number(t.amount),0);
          const totalOut = txs.filter(t=>t.direction==='out').reduce((s,t)=>s+Number(t.amount),0);
          if (body) body.innerHTML = `
            <div style="margin-bottom:16px">
              <div class="drawer-title" style="font-size:18px;font-weight:900;margin-bottom:4px">${name}</div>
              <div class="muted">${acc}</div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
              <div style="background:var(--green-bg);border-radius:10px;padding:12px;text-align:center">
                <div style="font-size:11px;color:var(--green);font-weight:700;text-transform:uppercase;margin-bottom:4px">Отримано</div>
                <div style="font-size:16px;font-weight:900;color:var(--green)">+${formatMoney(totalIn)}</div>
              </div>
              <div style="background:var(--red-bg);border-radius:10px;padding:12px;text-align:center">
                <div style="font-size:11px;color:var(--red);font-weight:700;text-transform:uppercase;margin-bottom:4px">Відправлено</div>
                <div style="font-size:16px;font-weight:900;color:var(--red)">-${formatMoney(totalOut)}</div>
              </div>
            </div>
            <div class="drawer-title" style="margin-bottom:10px">${txs.length} операцій</div>
            ${txs.length ? txs.map(tx => `
              <div class="item">
                <div class="tx-dir-dot ${tx.direction}"></div>
                <div class="item-body">
                  <div class="item-header">
                    <strong>${tx.description}</strong>
                    <span class="amount ${tx.direction}">${tx.direction==='in'?'+':'−'}${formatMoney(tx.amount)}</span>
                  </div>
                  <div class="muted">${formatDate(tx.created_at)}</div>
                </div>
              </div>`).join('') : '<div class="empty-state">Переказів між вами ще немає.</div>'}
          `;
        } catch(e) {
          if (body) body.innerHTML = `<div class="drawer-error">${e.message}</div>`;
        }
      });
    });

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

    // Load analytics data for dashboard strip + sparkline
    loadAnalytics().catch(() => {});
    loadSparkline().catch(() => {});
    if (typeof loadVelocity === 'function') loadVelocity().catch(() => {});
    if (typeof loadTopRecipients === 'function') loadTopRecipients().catch(() => {});
    if (typeof loadTagsCloud === 'function') loadTagsCloud().catch(() => {});
    if (typeof checkPinStatus === 'function') checkPinStatus().catch(() => {});

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
    const screenMap = { history: 'transactions', 'donations-screen': 'donations', payouts: 'payouts', savings: 'savings', contacts: 'contacts', calendar: 'calendar' };
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

// ── THEME ──────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('ab_theme') || 'dark';
  applyTheme(saved);
  const toggle = $('#themeToggle');
  if (toggle) toggle.checked = saved === 'light';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('ab_theme', theme);
}

$('#themeToggle')?.addEventListener('change', function() {
  applyTheme(this.checked ? 'light' : 'dark');
});

// Compact mode
function initCompact() {
  const saved = localStorage.getItem('ab_compact') === 'true';
  document.documentElement.classList.toggle('compact', saved);
  const toggle = $('#compactToggle');
  if (toggle) toggle.checked = saved;
}

$('#compactToggle')?.addEventListener('change', function() {
  document.documentElement.classList.toggle('compact', this.checked);
  localStorage.setItem('ab_compact', this.checked);
});

// Animations toggle
function initAnimations() {
  const disabled = localStorage.getItem('ab_animations') === 'false';
  document.documentElement.classList.toggle('no-animations', disabled);
  const toggle = $('#animationsToggle');
  if (toggle) toggle.checked = !disabled;
}

$('#animationsToggle')?.addEventListener('change', function() {
  document.documentElement.classList.toggle('no-animations', !this.checked);
  localStorage.setItem('ab_animations', this.checked ? 'true' : 'false');
});

initTheme();
initCompact();
initAnimations();

// ── NETWORK STATUS ──────────────────────────────────────
function updateNetworkBanner() {
  const banner = $('#networkBanner');
  if (!banner) return;
  if (navigator.onLine) {
    banner.classList.add('hidden');
  } else {
    banner.classList.remove('hidden');
  }
}
window.addEventListener('online',  updateNetworkBanner);
window.addEventListener('offline', updateNetworkBanner);
updateNetworkBanner();

// ── SPARKLINE ────────────────────────────────────────────
async function loadSparkline() {
  const container = $('#sparklineContainer');
  if (!container) return;
  try {
    const history = await api.request('/api/analytics/balance-history?days=14');
    if (!history || !history.length) {
      container.innerHTML = '<div class="empty-state">Недостатньо даних.</div>';
      return;
    }

    const values = history.map(h => Number(h.balance));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const W = 300, H = 60, PAD = 4;

    const points = values.map((v, i) => {
      const x = PAD + (i / (values.length - 1)) * (W - PAD * 2);
      const y = H - PAD - ((v - min) / range) * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    // Area fill path
    const firstX = PAD;
    const lastX = W - PAD;
    const bottomY = H - PAD;
    const areaPoints = `${firstX},${bottomY} ${points} ${lastX},${bottomY}`;

    const trend = values[values.length - 1] - values[0];
    const trendEl = $('#sparklineTrend');
    if (trendEl) {
      const trendClass = trend >= 0 ? 'trend-up' : 'trend-down';
      trendEl.className = `trend-badge ${trendClass}`;
      trendEl.textContent = `${trend >= 0 ? '+' : ''}${formatMoney(trend)}`;
    }

    const lastValY = (H - PAD - ((values[values.length-1] - min) / range) * (H - PAD * 2)).toFixed(1);

    container.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none">
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${trend >= 0 ? '#4ade80' : '#f87171'}" stop-opacity="0.18"/>
            <stop offset="100%" stop-color="${trend >= 0 ? '#4ade80' : '#f87171'}" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <polygon points="${areaPoints}" fill="url(#sparkGrad)"/>
        <polyline points="${points}" fill="none" stroke="${trend >= 0 ? '#4ade80' : '#f87171'}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="${lastX}" cy="${lastValY}" r="3" fill="${trend >= 0 ? '#4ade80' : '#f87171'}"/>
      </svg>
      <div class="sparkline-labels">
        <span>${history[0]?.day?.slice(5) || ''}</span>
        <span>${history[history.length-1]?.day?.slice(5) || ''}</span>
      </div>
    `;
  } catch (_) {
    if (container) container.innerHTML = '';
  }
}

// ── QUICK AMOUNTS ─────────────────────────────────────────
function initQuickAmounts() {
  $$('.quick-amounts').forEach(wrap => {
    const form = wrap.closest('form');
    const amountInput = form?.querySelector('input[name="amount"]');
    if (!amountInput) return;
    wrap.querySelectorAll('.qa-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        amountInput.value = chip.dataset.amount;
        amountInput.dispatchEvent(new Event('input'));
        wrap.querySelectorAll('.qa-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
    });
    amountInput.addEventListener('input', () => {
      wrap.querySelectorAll('.qa-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.amount === amountInput.value);
      });
    });
  });
}
initQuickAmounts();

// ── SECURITY LOG ──────────────────────────────────────────
let _secLogLoaded = false;
const SEC_ACTION_ICONS = {
  login: '🔐', logout: '🚪', register: '✅', change_password: '🔑',
  topup: '💰', transfer: '💸', donation: '❤️', goal_contribution: '🎯',
  create_goal: '🎯', delete_goal: '🗑', add_family_contact: '👤',
  delete_family_contact: '🗑', demo_payout: '🛡', delete_template: '🗑',
  default: '📋'
};

$('#secLogHead')?.addEventListener('click', async () => {
  const list = $('#securityLogList');
  const chevron = $('#secLogChevron');
  if (!list) return;
  const isOpen = list.style.display !== 'none';
  list.style.display = isOpen ? 'none' : 'block';
  if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
  if (!isOpen && !_secLogLoaded) {
    _secLogLoaded = true;
    list.innerHTML = '<div class="sec-log-loading">Завантаження…</div>';
    try {
      const logs = await api.request('/api/audit-logs');
      if (!logs.length) {
        list.innerHTML = '<div class="empty-state">Журнал порожній.</div>';
        return;
      }
      list.innerHTML = logs.map(log => {
        const icon = SEC_ACTION_ICONS[log.action] || SEC_ACTION_ICONS.default;
        return `
          <div class="sec-log-item">
            <span class="sec-log-icon">${icon}</span>
            <div class="sec-log-body">
              <div class="sec-log-action">${log.details || log.action}</div>
              <div class="sec-log-date muted">${formatDate(log.created_at)}</div>
            </div>
          </div>`;
      }).join('');
    } catch(e) {
      list.innerHTML = `<div class="sec-log-error">${e.message}</div>`;
    }
  }
});

// ── ACCOUNT QR + COPY ─────────────────────────────────────
$('#copyAccountBtn')?.addEventListener('click', () => {
  const acc = state.account?.account_number;
  if (!acc) return;
  navigator.clipboard.writeText(acc).then(() => {
    showToast('Номер рахунку скопійовано.', 'success');
  }).catch(() => {
    showToast('Не вдалося скопіювати.');
  });
});

let _qrVisible = false;
$('#showQrBtn')?.addEventListener('click', () => {
  const wrap = $('#accountQrWrap');
  const img = $('#accountQrImg');
  if (!wrap || !img) return;
  _qrVisible = !_qrVisible;
  wrap.classList.toggle('hidden', !_qrVisible);
  if (_qrVisible && state.account?.account_number) {
    const text = encodeURIComponent(state.account.account_number);
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${text}&color=ffffff&bgcolor=111111`;
  }
  const qrBtn = $('#showQrBtn');
  if (qrBtn) qrBtn.textContent = _qrVisible ? 'Сховати QR' : 'QR-код рахунку';
});

// ── SWIPE TO CLOSE DRAWER ─────────────────────────────────
(function initSwipeDrawer() {
  const drawer = $('#txDrawer');
  if (!drawer) return;
  let startY = 0, startX = 0;
  drawer.addEventListener('touchstart', e => {
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
  }, { passive: true });
  drawer.addEventListener('touchend', e => {
    const dy = e.changedTouches[0].clientY - startY;
    const dx = e.changedTouches[0].clientX - startX;
    // Swipe down (mobile) or right (desktop side drawer)
    if (dy > 60 || dx > 80) closeDrawer();
  }, { passive: true });
})();

// ── PULL TO REFRESH ───────────────────────────────────────
(function initPullToRefresh() {
  const content = $('.app-content');
  if (!content) return;
  let startY = 0, pulling = false;
  const indicator = document.createElement('div');
  indicator.className = 'ptr-indicator hidden';
  indicator.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="ptr-spin"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';
  content.parentNode.insertBefore(indicator, content);

  content.addEventListener('touchstart', e => {
    if (content.scrollTop === 0) {
      startY = e.touches[0].clientY;
      pulling = true;
    }
  }, { passive: true });

  content.addEventListener('touchmove', e => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 10) indicator.classList.remove('hidden');
  }, { passive: true });

  content.addEventListener('touchend', async e => {
    if (!pulling) return;
    const dy = e.changedTouches[0].clientY - startY;
    pulling = false;
    if (dy > 60) {
      indicator.classList.add('spinning');
      try { await refreshAllData(); showToast('Оновлено', 'success'); }
      catch(_) {}
      indicator.classList.remove('spinning');
    }
    indicator.classList.add('hidden');
  }, { passive: true });
})();

// ═══════════════════════════════════════════════════════
// WAVE 3 FEATURES
// ═══════════════════════════════════════════════════════

// ── SPENDING PIE CHART ────────────────────────────────
const PIE_COLORS = {
  transfer: '#60a5fa', donation: '#f87171', savings: '#4ade80',
  topup: '#a78bfa', payout: '#fb923c', default: '#94a3b8',
};

function renderPieChart(byType) {
  const pieEl = $('#spendingPie');
  const legendEl = $('#pieLegend');
  if (!pieEl) return;

  const outItems = byType.filter(r => r.direction === 'out' || !r.direction);
  const total = outItems.reduce((s, r) => s + Number(r.total), 0);
  if (!total) {
    pieEl.innerHTML = '<div class="empty-state">Витрат ще немає.</div>';
    return;
  }

  const R = 70, CX = 80, CY = 80;
  let angle = -Math.PI / 2;
  const segments = outItems.map(r => {
    const frac = Number(r.total) / total;
    const startAngle = angle;
    angle += frac * 2 * Math.PI;
    return { ...r, frac, startAngle, endAngle: angle };
  });

  function polarToXY(a, r) {
    return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
  }

  const paths = segments.map(seg => {
    const [x1, y1] = polarToXY(seg.startAngle, R);
    const [x2, y2] = polarToXY(seg.endAngle, R);
    const large = seg.frac > 0.5 ? 1 : 0;
    const color = PIE_COLORS[seg.tx_type] || PIE_COLORS.default;
    return `<path d="M${CX},${CY} L${x1},${y1} A${R},${R} 0 ${large},1 ${x2},${y2} Z" fill="${color}" opacity="0.85"/>`;
  }).join('');

  pieEl.innerHTML = `
    <svg viewBox="0 0 160 160" width="160" height="160" style="display:block;margin:0 auto">
      ${paths}
      <circle cx="${CX}" cy="${CY}" r="36" fill="var(--surface)"/>
      <text x="${CX}" y="${CY - 4}" text-anchor="middle" fill="var(--text)" font-size="10" font-weight="700" font-family="Manrope,sans-serif">Витрати</text>
      <text x="${CX}" y="${CY + 10}" text-anchor="middle" fill="var(--muted)" font-size="8" font-family="Manrope,sans-serif">цього місяця</text>
    </svg>`;

  if (legendEl) {
    legendEl.innerHTML = segments.map(seg => {
      const color = PIE_COLORS[seg.tx_type] || PIE_COLORS.default;
      const label = (TX_TYPE_LABELS || {})[seg.tx_type] || seg.tx_type;
      return `<div class="pie-leg-item">
        <span class="pie-leg-dot" style="background:${color}"></span>
        <span class="pie-leg-label">${label}</span>
        <span class="pie-leg-pct">${(seg.frac * 100).toFixed(1)}%</span>
      </div>`;
    }).join('');
  }
}

// ── ACTIVITY HEATMAP ─────────────────────────────────
async function renderHeatmap() {
  const el = $('#activityHeatmap');
  if (!el) return;
  try {
    const WEEKS = 12, DAYS = 7;
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - (WEEKS * DAYS - 1));

    const params = new URLSearchParams({ from_date: start.toISOString().slice(0,10) });
    const txs = await api.request('/api/transactions/history?' + params);

    const counts = {};
    txs.forEach(tx => {
      const d = (tx.created_at || '').slice(0,10);
      counts[d] = (counts[d] || 0) + 1;
    });
    const maxCount = Math.max(...Object.values(counts), 1);

    function intensity(c) {
      if (!c) return 0;
      return Math.ceil((c / maxCount) * 4);
    }
    const COLORS = ['rgba(255,255,255,.06)','rgba(255,255,255,.18)','rgba(255,255,255,.35)','rgba(255,255,255,.55)','#4ade80'];

    let html = '<div class="heatmap-grid">';
    for (let w = 0; w < WEEKS; w++) {
      html += '<div class="heatmap-col">';
      for (let d = 0; d < DAYS; d++) {
        const date = new Date(start);
        date.setDate(start.getDate() + w * 7 + d);
        const key = date.toISOString().slice(0,10);
        const cnt = counts[key] || 0;
        const col = COLORS[intensity(cnt)];
        const title = cnt ? `${key}: ${cnt} операцій` : key;
        html += `<div class="heatmap-cell" style="background:${col}" title="${title}"></div>`;
      }
      html += '</div>';
    }
    html += '</div>';
    el.innerHTML = html;
  } catch(_) {}
}

// ── BUDGET LIMITS ────────────────────────────────────
async function loadBudgetLimits() {
  const listEl = $('#budgetLimitsList');
  if (!listEl) return;
  try {
    const limits = await api.request('/api/budget-limits');
    if (!limits.length) {
      listEl.innerHTML = '<div class="empty-state" style="padding:8px 0">Лімітів не встановлено.</div>';
      return;
    }
    const txLabels = { transfer: 'Переказ', donation: 'Донат', savings: 'Накопичення', topup: 'Поповнення' };
    listEl.innerHTML = limits.map(l => {
      const pct = l.pct || 0;
      const color = pct >= 90 ? 'var(--red)' : pct >= 70 ? 'var(--orange)' : 'var(--green)';
      return `<div class="budget-limit-item">
        <div class="bl-header">
          <span class="bl-type">${txLabels[l.tx_type] || l.tx_type}</span>
          <span class="bl-pct" style="color:${color}">${pct}%</span>
          <button class="btn-icon-danger bl-del" data-del-limit="${l.tx_type}" title="Видалити">×</button>
        </div>
        <div class="progress-bar-wrap">
          <div class="progress-bar" style="width:${pct}%;background:${color}"></div>
        </div>
        <div class="bl-amounts muted">${formatMoney(l.spent)} / ${formatMoney(l.monthly_limit)}</div>
      </div>`;
    }).join('');

    listEl.querySelectorAll('[data-del-limit]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const txType = btn.dataset.delLimit;
        try {
          await api.request(`/api/budget-limits/${txType}`, { method: 'DELETE' });
          await loadBudgetLimits();
          showToast('Ліміт видалено.');
        } catch(e) { showToast(e.message); }
      });
    });
  } catch(e) {
    listEl.innerHTML = `<div class="empty-state">Помилка: ${e.message}</div>`;
  }
}

$('#addBudgetBtn')?.addEventListener('click', () => {
  $('#budgetLimitForm')?.classList.toggle('hidden');
});
$('#cancelBudgetBtn')?.addEventListener('click', () => {
  $('#budgetLimitForm')?.classList.add('hidden');
});
$('#saveBudgetBtn')?.addEventListener('click', async () => {
  const txType = $('#budgetTxType')?.value;
  const amount = Number($('#budgetAmount')?.value || 0);
  if (!txType || !amount) { showToast('Вкажіть тип та суму.'); return; }
  try {
    await api.request('/api/budget-limits', {
      method: 'POST',
      body: JSON.stringify({ tx_type: txType, monthly_limit: amount }),
    });
    $('#budgetLimitForm')?.classList.add('hidden');
    if ($('#budgetAmount')) $('#budgetAmount').value = '';
    await loadBudgetLimits();
    showToast('Ліміт встановлено.', 'success');
  } catch(e) { showToast(e.message); }
});

// ── SPENDING INSIGHTS ────────────────────────────────
async function loadInsights() {
  const el = $('#insightsList');
  if (!el) return;
  try {
    const data = await api.request('/api/analytics/insights');
    const insights = data.insights || [];
    if (!insights.length) {
      el.innerHTML = '<div class="empty-state">Недостатньо даних для аналізу.</div>';
      return;
    }
    el.innerHTML = insights.map(ins => `
      <div class="insight-item">
        <span class="insight-icon">${ins.icon}</span>
        <span class="insight-text">${ins.text}</span>
      </div>`).join('');
  } catch(_) {}
}

// ── CURRENCY CONVERTER ────────────────────────────────
const _ratesCache = {};
async function loadCurrencyRates() {
  try {
    const res = await fetch('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json');
    if (!res.ok) throw new Error('');
    const data = await res.json();
    const wanted = ['USD','EUR','GBP','PLN'];
    wanted.forEach(code => {
      const item = data.find(r => r.cc === code);
      if (item) {
        _ratesCache[code] = item.rate;
        const el = $(`#rate${code}`);
        if (el) el.textContent = `₴${item.rate.toFixed(2)}`;
      }
    });
    const updated = $('#ratesUpdated');
    if (updated) updated.textContent = 'Оновлено зараз';
    updateConverter();
  } catch(_) {
    Object.assign(_ratesCache, { USD: 41.0, EUR: 44.5, GBP: 51.8, PLN: 10.2 });
    ['USD','EUR','GBP','PLN'].forEach(code => {
      const el = $(`#rate${code}`);
      if (el) el.textContent = `₴${_ratesCache[code].toFixed(2)}`;
    });
    updateConverter();
  }
}

function updateConverter() {
  const amount = parseFloat($('#convAmount')?.value || 0);
  const from = $('#convFrom')?.value;
  const to = $('#convTo')?.value;
  const result = $('#convResult');
  if (!result || !from || !to || isNaN(amount)) return;

  let uah;
  if (from === 'UAH') uah = amount;
  else uah = amount * (_ratesCache[from] || 1);

  let converted;
  if (to === 'UAH') converted = uah;
  else converted = uah / (_ratesCache[to] || 1);

  result.textContent = `${amount} ${from} = ${converted.toFixed(2)} ${to}`;
}

['#convAmount','#convFrom','#convTo'].forEach(sel => {
  $(sel)?.addEventListener('input', updateConverter);
  $(sel)?.addEventListener('change', updateConverter);
});

loadCurrencyRates();

// ── COMMAND PALETTE (Ctrl+K) ──────────────────────────
let _cmdOpen = false;
let _cmdItems = [];
let _cmdIdx = 0;

const NAV_CMDS = [
  { type: 'nav', label: 'Огляд', screen: 'dashboard', icon: '🏠' },
  { type: 'nav', label: 'Операції', screen: 'transactions', icon: '📊' },
  { type: 'nav', label: 'Цілі накопичення', screen: 'savings', icon: '🎯' },
  { type: 'nav', label: 'Родина', screen: 'contacts', icon: '👨‍👩‍👧' },
  { type: 'nav', label: 'Аналітика', screen: 'analytics', icon: '📈' },
  { type: 'nav', label: 'Профіль', screen: 'profile', icon: '👤' },
  { type: 'nav', label: 'Виплати', screen: 'payouts', icon: '🛡' },
  { type: 'nav', label: 'Донати', screen: 'donations', icon: '❤️' },
];

function openCmdPalette() {
  _cmdOpen = true;
  $('#cmdPalette')?.classList.remove('hidden');
  $('#cmdBackdrop')?.classList.remove('hidden');
  const input = $('#cmdInput');
  if (input) { input.value = ''; input.focus(); }
  renderCmdResults('');
}

function closeCmdPalette() {
  _cmdOpen = false;
  $('#cmdPalette')?.classList.add('hidden');
  $('#cmdBackdrop')?.classList.add('hidden');
}

function renderCmdResults(query) {
  const el = $('#cmdResults');
  if (!el) return;

  const q = query.toLowerCase().trim();
  let items = [...NAV_CMDS];

  _cmdItems = q ? items.filter(it =>
    it.label.toLowerCase().includes(q)
  ) : items;

  _cmdIdx = 0;
  if (!_cmdItems.length) {
    el.innerHTML = '<div class="cmd-empty">Нічого не знайдено</div>';
    return;
  }
  renderCmdList();
}

function renderCmdList() {
  const el = $('#cmdResults');
  if (!el) return;
  el.innerHTML = _cmdItems.map((item, i) => `
    <div class="cmd-item ${i === _cmdIdx ? 'active' : ''}" data-idx="${i}">
      <span class="cmd-item-icon">${item.icon}</span>
      <span class="cmd-item-label">${item.label}</span>
      ${item.type === 'nav' ? '<span class="cmd-item-type">Розділ</span>' : ''}
    </div>
  `).join('');
  el.querySelectorAll('.cmd-item').forEach(row => {
    row.addEventListener('click', () => {
      _cmdIdx = Number(row.dataset.idx);
      executeCmdItem();
    });
    row.addEventListener('mouseenter', () => {
      _cmdIdx = Number(row.dataset.idx);
      el.querySelectorAll('.cmd-item').forEach((r,i) => r.classList.toggle('active', i === _cmdIdx));
    });
  });
}

function executeCmdItem() {
  const item = _cmdItems[_cmdIdx];
  if (!item) return;
  closeCmdPalette();
  if (item.type === 'nav') {
    const base = getBasePath();
    window.history.pushState(null, '', base ? base + '/' + item.screen : '/' + item.screen);
    switchScreen(item.screen);
  }
}

$('#cmdInput')?.addEventListener('input', e => renderCmdResults(e.target.value));
$('#cmdInput')?.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { _cmdIdx = Math.min(_cmdIdx + 1, _cmdItems.length - 1); renderCmdList(); e.preventDefault(); }
  if (e.key === 'ArrowUp')   { _cmdIdx = Math.max(_cmdIdx - 1, 0); renderCmdList(); e.preventDefault(); }
  if (e.key === 'Enter')     { executeCmdItem(); e.preventDefault(); }
  if (e.key === 'Escape')    { closeCmdPalette(); }
});
$('#cmdBackdrop')?.addEventListener('click', closeCmdPalette);

// ── KEYBOARD SHORTCUTS ────────────────────────────────
let _kbBuffer = '';
let _kbTimer = null;

document.addEventListener('keydown', (e) => {
  if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) {
    if (e.key === 'Escape') {
      document.activeElement.blur();
      closeCmdPalette();
      closeDrawer();
    }
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    _cmdOpen ? closeCmdPalette() : openCmdPalette();
    return;
  }

  if (e.key === 'Escape') {
    closeCmdPalette();
    closeDrawer();
    closeConfirm();
    return;
  }

  if (e.key === '?') {
    $('#kbHelp')?.classList.toggle('hidden');
    $('#kbBackdrop')?.classList.toggle('hidden');
    return;
  }

  if (e.key === 'r' || e.key === 'R') {
    refreshAllData().then(() => showToast('Оновлено', 'success')).catch(() => {});
    return;
  }

  if (!state.user) return;
  _kbBuffer += e.key.toUpperCase();
  clearTimeout(_kbTimer);
  _kbTimer = setTimeout(() => { _kbBuffer = ''; }, 800);

  const navMap = { 'GD': 'dashboard', 'GT': 'transactions', 'GS': 'savings', 'GC': 'contacts', 'GA': 'analytics', 'GP': 'profile' };
  if (navMap[_kbBuffer]) {
    const screen = navMap[_kbBuffer];
    const base = getBasePath();
    window.history.pushState(null, '', base ? base + '/' + screen : '/' + screen);
    switchScreen(screen);
    _kbBuffer = '';
  }
});

$('#kbClose')?.addEventListener('click', () => {
  $('#kbHelp')?.classList.add('hidden');
  $('#kbBackdrop')?.classList.add('hidden');
});
$('#kbBackdrop')?.addEventListener('click', () => {
  $('#kbHelp')?.classList.add('hidden');
  $('#kbBackdrop')?.classList.add('hidden');
});

// ── CONFETTI CELEBRATION ──────────────────────────────
function launchConfetti() {
  const canvas = $('#confettiCanvas');
  if (!canvas) return;
  canvas.style.display = 'block';
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const pieces = Array.from({ length: 80 }, () => ({
    x: Math.random() * canvas.width,
    y: -20,
    w: Math.random() * 8 + 4,
    h: Math.random() * 14 + 6,
    rot: Math.random() * 360,
    color: ['#4ade80','#60a5fa','#f87171','#facc15','#c084fc','#fb923c'][Math.floor(Math.random()*6)],
    vx: (Math.random() - 0.5) * 3,
    vy: Math.random() * 3 + 2,
    vrot: (Math.random() - 0.5) * 8,
  }));

  let frame;
  let t = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach(p => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
      ctx.restore();
      p.x += p.vx; p.y += p.vy; p.rot += p.vrot; p.vy += 0.05;
    });
    t++;
    if (t < 180) frame = requestAnimationFrame(draw);
    else {
      canvas.style.display = 'none';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
  cancelAnimationFrame(frame);
  requestAnimationFrame(draw);
}

function checkGoalCompletion(goals) {
  goals.forEach(g => {
    if (g.current_amount >= g.target_amount && g.target_amount > 0) {
      const key = `celebrated_goal_${g.id}`;
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, '1');
        setTimeout(() => {
          showToast(`🎉 Ціль "${g.title}" досягнута!`, 'success');
          launchConfetti();
        }, 500);
      }
    }
  });
}

// ── TRANSACTION RECEIPT SHARE ─────────────────────────
function shareTransaction(tx) {
  const text = [
    '🏦 Army Bank — Виписка операції',
    '─'.repeat(28),
    `📝 ${tx.description}`,
    `💰 ${tx.direction === 'in' ? '+' : '−'}${Number(tx.amount).toFixed(2)} ₴`,
    `📂 Тип: ${(TX_TYPE_LABELS || {})[tx.tx_type] || tx.tx_type}`,
    `📅 Дата: ${formatDate(tx.created_at)}`,
    tx.related_account ? `🔗 Контрагент: ${tx.related_account}` : '',
    `🔑 ID: #${tx.id}`,
  ].filter(Boolean).join('\n');

  if (navigator.share) {
    navigator.share({ title: 'Army Bank — Виписка', text }).catch(() => {});
  } else {
    navigator.clipboard.writeText(text).then(() =>
      showToast('Деталі скопійовано в буфер обміну.', 'success')
    ).catch(() => showToast('Не вдалося скопіювати.'));
  }
}

// ── SESSION MANAGEMENT ─────────────────────────────────
let _sessionsLoaded = false;
$('#sessionsHead')?.addEventListener('click', async () => {
  const list = $('#sessionsList');
  const chevron = $('#sessionsChevron');
  if (!list) return;
  const isOpen = list.style.display !== 'none';
  list.style.display = isOpen ? 'none' : 'block';
  if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
  if (!isOpen && !_sessionsLoaded) {
    _sessionsLoaded = true;
    list.innerHTML = '<div class="sec-log-loading">Завантаження…</div>';
    try {
      const sessions = await api.request('/api/auth/sessions');
      list.innerHTML = sessions.map(s => `
        <div class="session-item">
          <div class="session-info">
            <div class="session-label">
              ${s.is_current ? '<span class="session-current">Поточна</span> ' : ''}
              Сесія #${s.id}
            </div>
            <div class="session-dates muted">Створено: ${formatDate(s.created_at)} · До: ${formatDate(s.expires_at)}</div>
          </div>
          ${!s.is_current ? `<button class="btn-icon-danger" data-revoke-session="${s.id}" title="Завершити сесію">×</button>` : ''}
        </div>
      `).join('') || '<div class="empty-state">Активних сесій немає.</div>';
      list.querySelectorAll('[data-revoke-session]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.revokeSession);
          confirmAction('Завершити сесію?', 'Ця сесія буде примусово завершена.', async () => {
            try {
              await api.request(`/api/auth/sessions/${id}`, { method: 'DELETE' });
              _sessionsLoaded = false;
              list.style.display = 'none';
              if (chevron) chevron.style.transform = '';
              showToast('Сесію завершено.', 'success');
            } catch(e) { showToast(e.message); }
          });
        });
      });
    } catch(e) {
      list.innerHTML = `<div class="sec-log-error">${e.message}</div>`;
    }
  }
});

// ── ACHIEVEMENTS ──────────────────────────────────────
async function loadAchievements() {
  const listEl = $('#achievementsList');
  const countEl = $('#achieveCount');
  if (!listEl) return;
  try {
    const data = await api.request('/api/achievements');
    const { achievements, done, total } = data;
    if (countEl) countEl.textContent = `${done}/${total}`;
    listEl.innerHTML = achievements.map(a => `
      <div class="achieve-item ${a.done ? 'done' : 'locked'}">
        <div class="achieve-icon">${a.icon}</div>
        <div class="achieve-body">
          <div class="achieve-title">${a.title}</div>
          <div class="achieve-desc">${a.desc}</div>
        </div>
        ${a.done ? '<div class="achieve-check">✓</div>' : ''}
      </div>
    `).join('');
  } catch(_) {}
}

// ── SAVINGS CALCULATOR ─────────────────────────────────
function updateSavingsCalc() {
  const target  = parseFloat($('#calcTarget')?.value  || 0);
  const monthly = parseFloat($('#calcMonthly')?.value || 0);
  const current = parseFloat($('#calcCurrent')?.value || 0);
  const result  = $('#calcResult');
  if (!result) return;

  if (!target || !monthly || monthly <= 0) {
    result.innerHTML = '<span class="muted">Введіть суму цілі та щомісячний внесок.</span>';
    return;
  }

  const remaining = Math.max(0, target - current);
  const months = Math.ceil(remaining / monthly);
  const years = Math.floor(months / 12);
  const remMonths = months % 12;

  const now = new Date();
  const finishDate = new Date(now.getFullYear(), now.getMonth() + months, 1);
  const dateStr = finishDate.toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });

  let timeStr = '';
  if (months === 0) timeStr = 'Ціль вже досягнута! 🎉';
  else if (years > 0) timeStr = `${years} р. ${remMonths ? remMonths + ' міс.' : ''}`;
  else timeStr = `${months} міс.`;

  const pct = target > 0 ? Math.min(100, Math.round(current / target * 100)) : 0;

  result.innerHTML = `
    <div class="calc-answer">
      <div class="calc-main">${timeStr}</div>
      <div class="muted">до ${dateStr} · ${remaining > 0 ? formatMoney(remaining) + ' залишилось' : 'ціль досягнута'}</div>
    </div>
    <div class="progress-bar-wrap" style="margin-top:10px">
      <div class="progress-bar" style="width:${pct}%"></div>
    </div>
    <div class="muted" style="font-size:11px;margin-top:4px">${pct}% досягнуто</div>
  `;
}

['#calcTarget','#calcMonthly','#calcCurrent'].forEach(sel => {
  $(sel)?.addEventListener('input', updateSavingsCalc);
});
if ($('#calcTarget')) updateSavingsCalc();

// ── CALENDAR VIEW ─────────────────────────────────────
let _calYear = new Date().getFullYear();
let _calMonth = new Date().getMonth();
let _calTxData = {};

async function loadCalendar() {
  const from = new Date(_calYear, _calMonth, 1).toISOString().slice(0,10);
  const to   = new Date(_calYear, _calMonth+1, 0).toISOString().slice(0,10);
  try {
    const txs = await api.request(`/api/transactions/history?from_date=${from}&to_date=${to}`);
    _calTxData = {};
    txs.forEach(tx => {
      const d = (tx.created_at||'').slice(0,10);
      if (!_calTxData[d]) _calTxData[d] = { in: 0, out: 0, count: 0, txs: [] };
      _calTxData[d].count++;
      _calTxData[d][tx.direction] += Number(tx.amount);
      _calTxData[d].txs.push(tx);
    });
    renderCalendar();
  } catch(_) {}
}

function renderCalendar() {
  const label = $('#calMonthLabel');
  if (label) {
    label.textContent = new Date(_calYear, _calMonth, 1)
      .toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });
  }
  const grid = $('#calGrid');
  if (!grid) return;

  const firstDay = new Date(_calYear, _calMonth, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(_calYear, _calMonth+1, 0).getDate();
  const today = new Date().toISOString().slice(0,10);

  let html = '';
  for (let i = 0; i < firstDay; i++) html += '<div class="cal-cell cal-empty"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${_calYear}-${String(_calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayData = _calTxData[dateStr];
    const isToday = dateStr === today;
    let dots = '';
    if (dayData) {
      if (dayData.in > 0)  dots += '<span class="cal-dot in"></span>';
      if (dayData.out > 0) dots += '<span class="cal-dot out"></span>';
    }
    html += `
      <div class="cal-cell ${isToday ? 'today' : ''} ${dayData ? 'has-tx' : ''}" data-cal-date="${dateStr}">
        <span class="cal-day-num">${d}</span>
        <div class="cal-dots">${dots}</div>
      </div>`;
  }
  grid.innerHTML = html;

  grid.querySelectorAll('.cal-cell[data-cal-date]').forEach(cell => {
    cell.addEventListener('click', () => {
      const date = cell.dataset.calDate;
      const dayData = _calTxData[date];
      const detail = $('#calDayDetail');
      const dayTitle = $('#calDayTitle');
      const dayList = $('#calDayList');
      if (!detail) return;
      if (!dayData || !dayData.txs.length) { detail.style.display = 'none'; return; }
      detail.style.display = 'block';
      if (dayTitle) dayTitle.textContent = new Date(date + 'T12:00:00').toLocaleDateString('uk-UA', { weekday:'long', day:'numeric', month:'long' });
      if (dayList) {
        dayList.innerHTML = dayData.txs.map(tx => `
          <div class="item">
            <div class="tx-dir-dot ${tx.direction}"></div>
            <div class="item-body">
              <div class="item-header">
                <strong>${tx.description}</strong>
                <span class="amount ${tx.direction}">${tx.direction==='in'?'+':'−'}${formatMoney(tx.amount)}</span>
              </div>
              <div class="muted">${(TX_TYPE_LABELS||{})[tx.tx_type]||tx.tx_type}</div>
            </div>
          </div>`).join('');
      }
      grid.querySelectorAll('.cal-cell').forEach(c => c.classList.toggle('selected', c.dataset.calDate === date));
    });
  });
}

$('#calPrev')?.addEventListener('click', () => {
  _calMonth--;
  if (_calMonth < 0) { _calMonth = 11; _calYear--; }
  const det = $('#calDayDetail');
  if (det) det.style.display = 'none';
  loadCalendar();
});
$('#calNext')?.addEventListener('click', () => {
  _calMonth++;
  if (_calMonth > 11) { _calMonth = 0; _calYear++; }
  const det = $('#calDayDetail');
  if (det) det.style.display = 'none';
  loadCalendar();
});

// ── SOUND EFFECTS ─────────────────────────────────────
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let _audioCtx = null;

function playSound(type) {
  if (localStorage.getItem('ab_sound') === 'false') return;
  try {
    if (!_audioCtx) _audioCtx = new AudioCtx();
    const osc = _audioCtx.createOscillator();
    const gain = _audioCtx.createGain();
    osc.connect(gain);
    gain.connect(_audioCtx.destination);

    if (type === 'success') {
      osc.frequency.setValueAtTime(523, _audioCtx.currentTime);
      osc.frequency.setValueAtTime(659, _audioCtx.currentTime + 0.1);
      osc.frequency.setValueAtTime(784, _audioCtx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.08, _audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + 0.5);
      osc.start(_audioCtx.currentTime);
      osc.stop(_audioCtx.currentTime + 0.5);
    } else if (type === 'error') {
      osc.frequency.setValueAtTime(220, _audioCtx.currentTime);
      osc.frequency.setValueAtTime(180, _audioCtx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.06, _audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + 0.3);
      osc.start(_audioCtx.currentTime);
      osc.stop(_audioCtx.currentTime + 0.3);
    } else if (type === 'click') {
      osc.frequency.setValueAtTime(800, _audioCtx.currentTime);
      gain.gain.setValueAtTime(0.03, _audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + 0.05);
      osc.start(_audioCtx.currentTime);
      osc.stop(_audioCtx.currentTime + 0.05);
    }
  } catch(_) {}
}

function haptic(pattern = [10]) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

function initSound() {
  const toggle = $('#soundToggle');
  const saved = localStorage.getItem('ab_sound') !== 'false';
  if (toggle) toggle.checked = saved;
}
$('#soundToggle')?.addEventListener('change', function() {
  localStorage.setItem('ab_sound', this.checked ? 'true' : 'false');
});
initSound();

// Patch showToast to play sounds
(function() {
  const _origShowToast = showToast;
  window.showToast = function(message, type) {
    _origShowToast(message, type);
    if (type === 'success') { playSound('success'); haptic([15]); }
    else if (!type && message) playSound('error');
  };
})();

// ── BALANCE FORECAST ──────────────────────────────────
async function loadForecast() {
  const el = $('#forecastContent');
  if (!el) return;
  try {
    const [history, analytics] = await Promise.all([
      api.request('/api/analytics/balance-history?days=30'),
      api.request('/api/analytics/summary'),
    ]);
    if (!history || history.length < 7) {
      el.innerHTML = '<div class="empty-state">Недостатньо даних для прогнозу.</div>';
      return;
    }

    const cur = analytics.current_month || {};
    const monthlyNet = (cur.total_in || 0) - (cur.total_out || 0);
    const currentBalance = history[history.length - 1]?.balance || 0;

    const forecasts = [1, 3, 6].map(months => ({
      months,
      balance: Math.max(0, currentBalance + monthlyNet * months),
    }));

    const trend = monthlyNet >= 0 ? 'green' : 'red';
    const trendText = monthlyNet >= 0 ? `+${formatMoney(monthlyNet)}/міс` : `${formatMoney(monthlyNet)}/міс`;

    el.innerHTML = `
      <div class="forecast-trend muted" style="margin-bottom:14px">
        Середній місячний баланс: <strong style="color:var(--${trend})">${trendText}</strong>
      </div>
      <div class="forecast-grid">
        ${forecasts.map(f => `
          <div class="forecast-item">
            <div class="forecast-period">${f.months} ${f.months===1?'місяць':f.months<5?'місяці':'місяців'}</div>
            <div class="forecast-balance ${f.balance > currentBalance ? 'up' : 'down'}">${formatMoney(f.balance)}</div>
            <div class="forecast-change muted">
              ${f.balance > currentBalance ? '↑' : '↓'} ${formatMoney(Math.abs(f.balance - currentBalance))}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch(_) {}
}

// ── MULTI-TAB SYNC ─────────────────────────────────────
(function initTabSync() {
  if (!('BroadcastChannel' in window)) return;
  const bc = new BroadcastChannel('army_bank_sync');
  window._bcChannel = bc;

  bc.addEventListener('message', e => {
    if (e.data?.type === 'DATA_UPDATED' && api.token) {
      refreshAllData().catch(() => {});
    }
    if (e.data?.type === 'LOGOUT') {
      api.setToken('');
      setAuthenticated(false);
      showToast('Вийшли в іншій вкладці.');
    }
  });

  const _origRefreshAllData = window.refreshAllData || refreshAllData;
  window.refreshAllData = async function() {
    await _origRefreshAllData();
    bc.postMessage({ type: 'DATA_UPDATED' });
  };

  const logoutBtn = $('#logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      bc.postMessage({ type: 'LOGOUT' });
    });
  }
})();

// ═══════════════════════════════════════════════════════════
// WAVE 5 — PIN, Recurring, Debts, Tags, Velocity, Onboarding
// ═══════════════════════════════════════════════════════════

// ── CountUp Balance Animation ────────────────────────────
function animateCounter(el, from, to, duration) {
  if (!el) return;
  duration = duration || 700;
  const start = performance.now();
  const diff = to - from;
  function step(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    el.textContent = formatMoney(from + diff * ease);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ── Shake Animation ──────────────────────────────────────
function shakeElement(el) {
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 600);
}

// ── PIN Lock ─────────────────────────────────────────────
const PIN_TIMEOUT_MS = 3 * 60 * 1000;
let _pinBuffer = '';
let _pinLocked = false;
let _pinInactivityTimer = null;
let _hasPinEnabled = false;

function resetInactivityTimer() {
  clearTimeout(_pinInactivityTimer);
  if (_hasPinEnabled && api.token && !_pinLocked) {
    _pinInactivityTimer = setTimeout(showPinLock, PIN_TIMEOUT_MS);
  }
}

['click', 'keydown', 'touchstart', 'mousemove'].forEach(function(evt) {
  document.addEventListener(evt, resetInactivityTimer, { passive: true });
});

function updatePinDots() {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById('pd' + i);
    if (dot) dot.classList.toggle('filled', i < _pinBuffer.length);
  }
}

function showPinLock() {
  if (!api.token) return;
  _pinLocked = true;
  _pinBuffer = '';
  updatePinDots();
  const overlay = $('#pinLockOverlay');
  if (overlay) overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function hidePinLock() {
  _pinLocked = false;
  _pinBuffer = '';
  updatePinDots();
  const overlay = $('#pinLockOverlay');
  if (overlay) overlay.classList.add('hidden');
  document.body.style.overflow = '';
  resetInactivityTimer();
}

async function submitPinAttempt() {
  const pin = _pinBuffer;
  _pinBuffer = '';
  updatePinDots();
  const errEl = $('#pinError');
  try {
    await api.request('/api/auth/pin/verify', { method: 'POST', body: JSON.stringify({ pin: pin }) });
    hidePinLock();
    if (errEl) errEl.textContent = '';
  } catch (_e) {
    if (errEl) {
      errEl.textContent = 'Невірний PIN. Спробуйте ще раз.';
      shakeElement($('#pinDots'));
      setTimeout(function() { if (errEl) errEl.textContent = ''; }, 2500);
    }
  }
}

$$('.pin-key[data-digit]').forEach(function(btn) {
  btn.addEventListener('click', function() {
    if (_pinBuffer.length >= 4) return;
    _pinBuffer += btn.dataset.digit;
    updatePinDots();
    if (_pinBuffer.length === 4) setTimeout(submitPinAttempt, 150);
  });
});

$('#pinBackBtn')?.addEventListener('click', function() {
  _pinBuffer = _pinBuffer.slice(0, -1);
  updatePinDots();
});

$('#pinLogoutBtn')?.addEventListener('click', async function() {
  hidePinLock();
  stopPolling();
  try { await api.request('/api/auth/logout', { method: 'POST' }); } catch (_e) {}
  api.setToken('');
  setAuthenticated(false);
  showToast('Ви вийшли з системи.');
});

async function checkPinStatus() {
  try {
    const data = await api.request('/api/auth/pin/status');
    _hasPinEnabled = !!(data && data.has_pin);
    const badge = $('#pinStatusBadge');
    if (badge) {
      badge.textContent = _hasPinEnabled ? '🔒 PIN встановлено' : '🔓 PIN не встановлено';
      badge.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:10px;color:' + (_hasPinEnabled ? 'var(--green)' : 'var(--text-muted)') + ';display:block;';
    }
    if (_hasPinEnabled) showPinLock();
    else resetInactivityTimer();
  } catch (_e) {}
}

$('#setPinForm')?.addEventListener('submit', async function(e) {
  e.preventDefault();
  const pin = ($('#pinInput') || {}).value || '';
  const btn = $('#setPinBtn');
  if (!/^\d{4}$/.test(pin)) { showToast('PIN повинен містити 4 цифри.'); shakeElement($('#setPinForm')); return; }
  try {
    setButtonLoading(btn, true);
    await api.request('/api/auth/pin', { method: 'PUT', body: JSON.stringify({ pin: pin }) });
    _hasPinEnabled = true;
    showToast('PIN встановлено.', 'success');
    if ($('#pinInput')) $('#pinInput').value = '';
    const badge = $('#pinStatusBadge');
    if (badge) { badge.textContent = '🔒 PIN встановлено'; badge.style.color = 'var(--green)'; }
    resetInactivityTimer();
  } catch (e) { showToast(e.message); } finally { setButtonLoading(btn, false); }
});

$('#clearPinBtn')?.addEventListener('click', async function() {
  try {
    await api.request('/api/auth/pin', { method: 'DELETE' });
    _hasPinEnabled = false;
    clearTimeout(_pinInactivityTimer);
    showToast('PIN видалено.', 'success');
    const badge = $('#pinStatusBadge');
    if (badge) { badge.textContent = '🔓 PIN не встановлено'; badge.style.color = 'var(--text-muted)'; }
  } catch (e) { showToast(e.message); }
});

// ── Spending Velocity ────────────────────────────────────
async function loadVelocity() {
  try {
    const data = await api.request('/api/analytics/velocity');
    const card = $('#velocityCard');
    if (card) card.style.display = '';
    const dailyEl = $('#velocityDailySpend');
    const daysEl = $('#velocityDaysLeft');
    if (dailyEl) dailyEl.textContent = formatMoney(data.avg_daily_spend || 0);
    if (daysEl) {
      if (data.days_until_zero === null || data.days_until_zero === undefined) {
        daysEl.textContent = '∞ (без витрат)';
        daysEl.style.color = 'var(--green)';
      } else if (data.days_until_zero < 7) {
        daysEl.textContent = '\u26a0\ufe0f ' + data.days_until_zero + ' днів';
        daysEl.style.color = 'var(--red)';
      } else if (data.days_until_zero < 30) {
        daysEl.textContent = data.days_until_zero + ' днів';
        daysEl.style.color = '#f59e0b';
      } else {
        daysEl.textContent = data.days_until_zero + ' днів';
        daysEl.style.color = 'var(--green)';
      }
    }
  } catch (_e) {}
}

// ── Top Recipients ───────────────────────────────────────
async function loadTopRecipients() {
  try {
    const list = await api.request('/api/analytics/top-recipients');
    const el = $('#topRecipientsCard');
    if (!el || !list.length) return;
    el.style.display = '';
    el.innerHTML = '<h3 class="card-title" style="margin-bottom:12px">Топ отримувачів</h3>' +
      list.map(function(r, i) {
        return '<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border)">' +
          '<div style="width:24px;height:24px;border-radius:50%;background:var(--green-bg);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;color:var(--green)">' + (i+1) + '</div>' +
          '<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + r.related_account + '</div>' +
          '<div class="muted">' + r.tx_count + ' переказів</div></div>' +
          '<div style="font-weight:900;color:var(--red)">\u2212' + formatMoney(r.total_sent) + '</div></div>';
      }).join('');
  } catch (_e) {}
}

// ── Recurring Transactions ───────────────────────────────
async function loadRecurring() {
  const listEl = $('#recurringList');
  if (listEl) { listEl.classList.add('loading'); listEl.innerHTML = ''; }
  try {
    const items = await api.request('/api/recurring-transactions');
    if (!listEl) return;
    listEl.classList.remove('loading');
    if (!items.length) {
      listEl.innerHTML = '<div class="empty-state"><strong>Немає платежів</strong>Додайте перший регулярний платіж.</div>';
      return;
    }
    const FREQ = { daily: 'Щодня', weekly: 'Щотижня', monthly: 'Щомісяця', yearly: 'Щороку' };
    listEl.innerHTML = items.map(function(r) {
      return '<div class="item item-with-actions" style="' + (r.is_active ? '' : 'opacity:.5') + '">' +
        '<div class="item-main">' +
          '<div class="item-header"><strong>' + r.title + '</strong><span class="amount out">\u2212' + formatMoney(r.amount) + '</span></div>' +
          '<div class="muted">' + (FREQ[r.frequency] || r.frequency) + ' \xb7 наступний: ' + (r.next_run_date || '—') + '</div>' +
          (r.recipient_account ? '<div class="muted">\u2192 ' + r.recipient_account + '</div>' : '') +
        '</div>' +
        '<div class="item-btns">' +
          '<button class="btn-icon-transfer" data-toggle-recurring="' + r.id + '" data-active="' + (r.is_active ? '1' : '0') + '" title="' + (r.is_active ? 'Зупинити' : 'Запустити') + '">' +
            (r.is_active
              ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
              : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>') +
          '</button>' +
          '<button class="btn-icon-danger" data-delete-recurring="' + r.id + '" title="Видалити">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>';
    }).join('');

    $$('#recurringList [data-delete-recurring]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const id = Number(btn.dataset.deleteRecurring);
        confirmAction('Видалити регулярний платіж?', 'Платіж буде видалено. Минулі транзакції залишаться.', async function() {
          try {
            await api.request('/api/recurring-transactions/' + id, { method: 'DELETE' });
            await loadRecurring();
            showToast('Платіж видалено.', 'success');
          } catch (e) { showToast(e.message); }
        });
      });
    });

    $$('#recurringList [data-toggle-recurring]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        const id = Number(btn.dataset.toggleRecurring);
        const isActive = btn.dataset.active === '1';
        try {
          await api.request('/api/recurring-transactions/' + id + '/toggle', {
            method: 'PATCH', body: JSON.stringify({ is_active: !isActive })
          });
          await loadRecurring();
        } catch (e) { showToast(e.message); }
      });
    });
  } catch (e) {
    if (listEl) { listEl.classList.remove('loading'); listEl.innerHTML = '<div class="drawer-error">' + e.message + '</div>'; }
  }
}

$('#recurringForm')?.addEventListener('submit', async function(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = form.querySelector('button[type="submit"]');
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    setButtonLoading(btn, true);
    await api.request('/api/recurring-transactions', { method: 'POST', body: JSON.stringify(data) });
    form.reset();
    await loadRecurring();
    showToast('Регулярний платіж додано.', 'success');
  } catch (e) { showToast(e.message); shakeElement(form); } finally { setButtonLoading(btn, false); }
});

// ── Debt Tracker ─────────────────────────────────────────
async function loadDebts() {
  const listEl = $('#debtsList');
  if (listEl) { listEl.classList.add('loading'); listEl.innerHTML = ''; }
  try {
    const items = await api.request('/api/debts');
    if (!listEl) return;
    listEl.classList.remove('loading');

    let sumOwedToMe = 0, sumIOwe = 0;
    items.forEach(function(d) {
      if (!d.is_settled) {
        if (d.direction === 'owed_to_me') sumOwedToMe += Number(d.amount);
        else sumIOwe += Number(d.amount);
      }
    });
    const s1 = $('#debtSumOwedToMe');
    const s2 = $('#debtSumIOwe');
    if (s1) s1.textContent = formatMoney(sumOwedToMe);
    if (s2) s2.textContent = formatMoney(sumIOwe);

    if (!items.length) {
      listEl.innerHTML = '<div class="empty-state"><strong>Боргів немає</strong>Додайте перший борг або позику нижче.</div>';
      return;
    }

    listEl.innerHTML = items.map(function(d) {
      const isIn = d.direction === 'owed_to_me';
      return '<div class="item item-with-actions' + (d.is_settled ? ' debt-settled' : '') + '">' +
        '<div class="item-main">' +
          '<div class="item-header">' +
            '<strong>' + d.contact_name + '</strong>' +
            '<span class="amount ' + (isIn ? 'in' : 'out') + '">' + (isIn ? '+' : '\u2212') + formatMoney(d.amount) + '</span>' +
          '</div>' +
          '<div class="muted">' + (isIn ? 'Мені винні' : 'Я винен') +
            (d.description ? ' \xb7 ' + d.description : '') +
            (d.is_settled ? ' \xb7 \u2705 Закрито' : '') +
          '</div>' +
        '</div>' +
        '<div class="item-btns">' +
          (!d.is_settled
            ? '<button class="btn-icon-transfer" data-settle-debt="' + d.id + '" title="Закрити борг"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg></button>'
            : '') +
          '<button class="btn-icon-danger" data-delete-debt="' + d.id + '" title="Видалити"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>' +
        '</div>' +
      '</div>';
    }).join('');

    $$('#debtsList [data-settle-debt]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        const id = Number(btn.dataset.settleDebt);
        try {
          await api.request('/api/debts/' + id + '/settle', { method: 'POST' });
          await loadDebts();
          showToast('Борг закрито! \u2705', 'success');
        } catch (e) { showToast(e.message); }
      });
    });

    $$('#debtsList [data-delete-debt]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const id = Number(btn.dataset.deleteDebt);
        confirmAction('Видалити борг?', 'Запис про борг буде видалено безповоротно.', async function() {
          try {
            await api.request('/api/debts/' + id, { method: 'DELETE' });
            await loadDebts();
            showToast('Видалено.', 'success');
          } catch (e) { showToast(e.message); }
        });
      });
    });
  } catch (e) {
    if (listEl) { listEl.classList.remove('loading'); listEl.innerHTML = '<div class="drawer-error">' + e.message + '</div>'; }
  }
}

$('#debtForm')?.addEventListener('submit', async function(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = form.querySelector('button[type="submit"]');
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    setButtonLoading(btn, true);
    await api.request('/api/debts', { method: 'POST', body: JSON.stringify(data) });
    form.reset();
    await loadDebts();
    showToast('Борг додано.', 'success');
  } catch (e) { showToast(e.message); shakeElement(form); } finally { setButtonLoading(btn, false); }
});

// ── Transaction Tags ─────────────────────────────────────
async function loadTagsCloud() {
  try {
    const tags = await api.request('/api/transactions/tags');
    const el = $('#tagsCloud');
    if (!el || !tags.length) return;
    el.innerHTML = tags.map(function(t) {
      return '<button class="tag-chip" data-tag="' + t + '">' + t + '</button>';
    }).join('');
    $$('#tagsCloud .tag-chip').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const searchInput = $('#txSearchInput');
        if (searchInput) {
          searchInput.value = btn.dataset.tag;
          loadTransactionsWithFilters();
          switchScreen('transactions');
        }
      });
    });
  } catch (_e) {}
}

// Patch openTxDrawer to include tags section
const _origOpenTxDrawer = openTxDrawer;
window.openTxDrawer = async function(txId) {
  if (!txId) return;
  openDrawer();
  const body = $('#drawerBody');
  if (body) body.innerHTML = '<div class="drawer-loading">Завантаження\u2026</div>';
  try {
    const tx = await api.request('/api/transactions/' + txId);
    if (!body) return;
    const tagBadges = tx.tags
      ? tx.tags.split(',').map(function(t) { return t.trim(); }).filter(Boolean)
          .map(function(t) { return '<span class="tag-badge">' + t + '</span>'; }).join('')
      : '';
    body.innerHTML =
      '<div class="drawer-amount ' + tx.direction + '">' +
        (tx.direction === 'in' ? '+' : '\u2212') + formatMoney(tx.amount) +
      '</div>' +
      '<dl class="drawer-info-list">' +
        '<div class="drawer-info-row"><dt>Опис</dt><dd>' + tx.description + '</dd></div>' +
        '<div class="drawer-info-row"><dt>Тип</dt><dd>' + (TX_TYPE_LABELS[tx.tx_type] || tx.tx_type) + '</dd></div>' +
        '<div class="drawer-info-row"><dt>Напрям</dt><dd>' + (tx.direction === 'in' ? '\u2193 Прихід' : '\u2191 Відхід') + '</dd></div>' +
        (tx.related_account ? '<div class="drawer-info-row"><dt>Контрагент</dt><dd>' + tx.related_account + '</dd></div>' : '') +
        '<div class="drawer-info-row"><dt>Дата</dt><dd>' + formatDate(tx.created_at) + '</dd></div>' +
        '<div class="drawer-info-row"><dt>ID</dt><dd>#' + tx.id + '</dd></div>' +
      '</dl>' +
      (tagBadges ? '<div class="drawer-tags">' + tagBadges + '</div>' : '') +
      '<button class="btn-ghost" id="shareTxBtn" style="width:100%;margin-top:16px;display:flex;align-items:center;justify-content:center;gap:8px">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>' +
        'Поділитися' +
      '</button>' +
      '<div class="drawer-note-section">' +
        '<label class="drawer-note-label">Нотатка</label>' +
        '<textarea id="drawerNoteInput" class="drawer-note-input" placeholder="Додайте особисту нотатку\u2026" rows="2">' + (tx.note || '') + '</textarea>' +
        '<button id="saveNoteBtn" class="btn-ghost btn-sm" style="margin-top:6px">Зберегти нотатку</button>' +
      '</div>' +
      '<div class="drawer-note-section">' +
        '<label class="drawer-note-label">Теги (через кому)</label>' +
        '<input id="drawerTagsInput" type="text" class="drawer-note-input" placeholder="наприклад: їжа, магазин, особисте" value="' + (tx.tags || '') + '">' +
        '<button id="saveTagsBtn" class="btn-ghost btn-sm" style="margin-top:6px">Зберегти теги</button>' +
      '</div>';

    $('#shareTxBtn')?.addEventListener('click', function() {
      if (typeof shareTransaction === 'function') shareTransaction(tx);
    });
    $('#saveNoteBtn')?.addEventListener('click', async function() {
      const note = ($('#drawerNoteInput') || {}).value || '';
      try {
        await api.request('/api/transactions/' + tx.id + '/note', { method: 'PATCH', body: JSON.stringify({ note: note }) });
        showToast('Нотатку збережено.', 'success');
      } catch (e) { showToast(e.message); }
    });
    $('#saveTagsBtn')?.addEventListener('click', async function() {
      const tags = ($('#drawerTagsInput') || {}).value || '';
      try {
        await api.request('/api/transactions/' + tx.id + '/tags', { method: 'PATCH', body: JSON.stringify({ tags: tags }) });
        showToast('Теги збережено.', 'success');
        loadTagsCloud().catch(function() {});
      } catch (e) { showToast(e.message); }
    });
  } catch (e) {
    if (body) body.innerHTML = '<div class="drawer-error">' + e.message + '</div>';
  }
};

// ── Onboarding Tour ──────────────────────────────────────
var ONBOARDING_STEPS = [
  { icon: '\ud83c\udfe6', title: 'Ласкаво просимо до Army Bank!', text: 'Ваш персональний фінансовий помічник. Ми допоможемо вам керувати фінансами легко та зручно.' },
  { icon: '\ud83d\udcb8', title: 'Перекази та поповнення', text: 'Поповнюйте рахунок та надсилайте кошти рідним одним дотиком. Всі операції відображаються миттєво.' },
  { icon: '\ud83c\udfaf', title: 'Цілі накопичення', text: 'Встановлюйте фінансові цілі та відстежуйте прогрес. Система покаже, коли ви близькі до мети.' },
  { icon: '\ud83d\udcca', title: 'Аналітика та захист', text: 'Детальна аналітика, бюджетні ліміти, PIN-захист і звіти. Контролюйте фінанси повністю.' },
];
var _obStep = 0;

function showOnboarding() {
  var overlay = $('#onboardingOverlay');
  if (!overlay) return;
  _obStep = 0;
  renderOnboardingStep();
  overlay.classList.remove('hidden');
}

function renderOnboardingStep() {
  var step = ONBOARDING_STEPS[_obStep];
  if (!step) return;
  var content = $('#obContent');
  if (content) {
    content.innerHTML = '<div class="ob-icon">' + step.icon + '</div>' +
      '<h2 class="ob-title">' + step.title + '</h2>' +
      '<p class="ob-text">' + step.text + '</p>';
  }
  $$('.ob-dot').forEach(function(dot, i) { dot.classList.toggle('active', i === _obStep); });
  var nextBtn = $('#obNextBtn');
  if (nextBtn) nextBtn.textContent = _obStep === ONBOARDING_STEPS.length - 1 ? '\ud83d\ude80 Почати!' : 'Далі \u2192';
}

$('#obNextBtn')?.addEventListener('click', function() {
  _obStep++;
  if (_obStep >= ONBOARDING_STEPS.length) {
    var overlay = $('#onboardingOverlay');
    if (overlay) overlay.classList.add('hidden');
    localStorage.setItem('army_bank_onboarded', '1');
  } else {
    renderOnboardingStep();
  }
});

$('#obSkipBtn')?.addEventListener('click', function() {
  var overlay = $('#onboardingOverlay');
  if (overlay) overlay.classList.add('hidden');
  localStorage.setItem('army_bank_onboarded', '1');
});

// ── Balance CountUp on refresh ───────────────────────────
var _wave5_origRefreshProfile = window.refreshProfile || refreshProfile;
window.refreshProfile = async function() {
  var prevBalance = state.account ? parseFloat(state.account.balance || 0) : null;
  await _wave5_origRefreshProfile();
  var newBalance = state.account ? parseFloat(state.account.balance || 0) : null;
  if (prevBalance !== null && newBalance !== null && prevBalance !== newBalance) {
    var heroBalEl = $('#heroBalance');
    var balVal = $('#balanceValue');
    if (heroBalEl) animateCounter(heroBalEl, prevBalance, newBalance, 800);
    if (balVal) animateCounter(balVal, prevBalance, newBalance, 800);
  }
};

// ── Extra data on refreshAllData ─────────────────────────
var _wave5_origRefreshAll = window.refreshAllData || refreshAllData;
window.refreshAllData = async function() {
  await _wave5_origRefreshAll();
  checkPinStatus().catch(function() {});
  loadVelocity().catch(function() {});
  loadTagsCloud().catch(function() {});
  loadTopRecipients().catch(function() {});
};

// ── Onboarding check after auth ──────────────────────────
var _wave5_origHandleAuth = window.handleAuth || handleAuth;
window.handleAuth = async function(form, endpoint) {
  await _wave5_origHandleAuth(form, endpoint);
  if (!localStorage.getItem('army_bank_onboarded')) {
    setTimeout(showOnboarding, 2000);
  }
};

// ── Keyboard shortcuts G+D / G+R ─────────────────────────
(function() {
  var _gPressedTime = 0;
  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (!api.token) return;
    var key = e.key.toLowerCase();
    var now = Date.now();
    if (key === 'g') { _gPressedTime = now; return; }
    if (now - _gPressedTime < 1000) {
      if (key === 'd') { switchScreen('debts'); _gPressedTime = 0; }
      if (key === 'r') { switchScreen('recurring'); _gPressedTime = 0; }
    }
  });
})();

console.log('[Army Bank] Wave 5 loaded \u2014 PIN, Recurring, Debts, Tags, Velocity, Onboarding');

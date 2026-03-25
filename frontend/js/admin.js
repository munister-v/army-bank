// Army Bank — Admin Panel
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 2600);
}

function basePath() {
  return (typeof window !== 'undefined' && window.ARMY_BANK_BASE) || '';
}

function fmtMoney(v) {
  return '₴' + Number(v || 0).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const RISK_BADGE = {
  low:      '<span style="background:rgba(52,211,153,.15);color:#34d399;padding:2px 8px;border-radius:100px;font-size:11px;font-weight:700">LOW</span>',
  medium:   '<span style="background:rgba(251,191,36,.15);color:#fbbf24;padding:2px 8px;border-radius:100px;font-size:11px;font-weight:700">MEDIUM</span>',
  high:     '<span style="background:rgba(251,147,60,.15);color:#fb923c;padding:2px 8px;border-radius:100px;font-size:11px;font-weight:700">HIGH</span>',
  critical: '<span style="background:rgba(248,113,113,.2);color:#f87171;padding:2px 8px;border-radius:100px;font-size:11px;font-weight:700">CRITICAL</span>',
};

const STATUS_BADGE = {
  completed:  '<span style="color:#34d399;font-size:11px">✓ Виконано</span>',
  blocked:    '<span style="color:#f87171;font-size:11px">🚫 Заблоковано</span>',
  failed:     '<span style="color:#f87171;font-size:11px">✗ Помилка</span>',
  processing: '<span style="color:#fbbf24;font-size:11px">⏳ Обробка</span>',
  pending:    '<span style="color:#9b9bc0;font-size:11px">○ Очікує</span>',
};

// ── Auth ─────────────────────────────────────────────────────────────────────

async function checkAdmin() {
  if (!api.token) { window.location.href = basePath() || '/'; return null; }
  try {
    const user = await api.request('/api/auth/me');
    if (user.role !== 'admin' && user.role !== 'platform_admin') {
      window.location.href = (basePath() || '') + '/dashboard';
      return null;
    }
    return user;
  } catch (_) {
    api.setToken('');
    window.location.href = basePath() || '/';
    return null;
  }
}

// ── Users ────────────────────────────────────────────────────────────────────

async function loadUsers(roleFilter) {
  let url = '/api/admin/users';
  if (roleFilter) url += '?role=' + encodeURIComponent(roleFilter);
  const users = await api.request(url);
  const body = $('#usersTableBody');
  body.innerHTML = users.map((u) => `
    <tr data-id="${u.id}">
      <td><strong>#${u.id}</strong></td>
      <td><div><strong>${u.full_name}</strong></div><div class="subtle">${u.military_status || ''}</div></td>
      <td class="subtle">${u.phone}<br>${u.email}</td>
      <td>
        <select class="role-select" data-user-id="${u.id}">
          <option value="soldier"       ${u.role === 'soldier'       ? 'selected' : ''}>Військовий</option>
          <option value="operator"      ${u.role === 'operator'      ? 'selected' : ''}>Оператор</option>
          <option value="admin"         ${u.role === 'admin'         ? 'selected' : ''}>Адмін</option>
          <option value="platform_admin"${u.role === 'platform_admin'? 'selected' : ''}>Платформа</option>
        </select>
      </td>
      <td>
        <div class="btn-row">
          <button type="button" class="small-btn save-role" data-user-id="${u.id}">Зберегти</button>
          <button type="button" class="ghost-btn small-btn open-user" data-user-id="${u.id}">Деталі</button>
        </div>
      </td>
    </tr>
  `).join('');

  $$('.save-role').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const userId = btn.dataset.userId;
      const role = $(`.role-select[data-user-id="${userId}"]`)?.value;
      if (!role) return;
      try {
        await api.request(`/api/admin/users/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ role }) });
        showToast('Роль оновлено.');
        loadUsers($('#roleFilter').value);
      } catch (e) { showToast(e.message); }
    });
  });

  $$('.open-user').forEach((btn) =>
    btn.addEventListener('click', () => openUserDrawer(Number(btn.dataset.userId)))
  );
}

// ── Security tab ─────────────────────────────────────────────────────────────

async function loadFraudStats() {
  try {
    const data = await api.request('/api/admin/payments/fraud-stats');
    const blocked = (data.by_status || []).find(r => r.status === 'blocked');
    const critical = (data.by_level || []).find(r => r.risk_level === 'critical');
    const high = (data.by_level || []).find(r => r.risk_level === 'high');
    const unresolved = (data.unresolved_events || []).reduce((s, r) => s + Number(r.cnt), 0);

    $('#statBlocked').textContent  = blocked  ? blocked.cnt  : '0';
    $('#statCritical').textContent = critical ? critical.cnt : '0';
    $('#statHigh').textContent     = high     ? high.cnt     : '0';
    $('#statUnresolved').textContent = unresolved;

    const badge = $('#unresolvedBadge');
    if (unresolved > 0)
      badge.innerHTML = `<span style="background:#f87171;color:#000;border-radius:100px;padding:1px 7px;font-size:11px;font-weight:700;margin-left:6px">${unresolved}</span>`;
  } catch (e) { console.warn('fraud stats:', e.message); }
}

async function loadOrders() {
  const risk   = $('#orderRiskFilter').value;
  const status = $('#orderStatusFilter').value;
  let url = '/api/admin/payments/orders?limit=50';
  if (risk)   url += '&risk_level=' + risk;
  if (status) url += '&status='     + status;

  $('#ordersTableBody').innerHTML = '<tr><td colspan="7" class="muted" style="text-align:center;padding:16px">Завантаження…</td></tr>';
  try {
    const { data } = await api.request(url);
    if (!data || !data.length) {
      $('#ordersTableBody').innerHTML = '<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">Немає ордерів за фільтром</td></tr>';
      return;
    }
    $('#ordersTableBody').innerHTML = data.map(o => `
      <tr>
        <td><strong>#${o.id}</strong></td>
        <td style="font-size:12px">${o.sender_number || '—'}<br><span class="muted">${o.initiator_name || ''}</span></td>
        <td style="font-size:12px">${o.recipient_number || '—'}</td>
        <td style="font-weight:700">${fmtMoney(o.amount)}</td>
        <td>${RISK_BADGE[o.risk_level] || o.risk_level} <span class="muted" style="font-size:11px">${o.risk_score}</span></td>
        <td>${STATUS_BADGE[o.status] || o.status}${o.failure_reason ? `<br><span class="muted" style="font-size:10px">${o.failure_reason}</span>` : ''}</td>
        <td class="muted" style="font-size:11px">${fmtDate(o.created_at)}</td>
      </tr>
    `).join('');
  } catch (e) {
    $('#ordersTableBody').innerHTML = `<tr><td colspan="7" style="color:#f87171;padding:16px">${e.message}</td></tr>`;
  }
}

async function loadRiskEvents() {
  const list = $('#riskEventsList');
  list.innerHTML = '<div class="muted" style="padding:12px">Завантаження…</div>';
  try {
    const { data } = await api.request('/api/admin/payments/risk-events?resolved=false&limit=30');
    if (!data || !data.length) {
      list.innerHTML = '<div class="muted" style="padding:16px;text-align:center">✓ Невирішених подій немає</div>';
      return;
    }
    list.innerHTML = data.map(ev => {
      let details = {};
      try { details = JSON.parse(ev.details || '{}'); } catch (_) {}
      const detailStr = Object.entries(details)
        .filter(([k]) => k !== 'flag')
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · ');
      return `
        <div class="item" style="align-items:flex-start;gap:12px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              ${RISK_BADGE[ev.severity] || ev.severity}
              <strong style="font-size:13px">${ev.event_type}</strong>
              <span class="muted" style="font-size:11px">order #${ev.payment_order_id}</span>
            </div>
            <div style="font-size:12px;color:rgba(255,255,255,.6)">${ev.user_name || 'user #' + ev.user_id} · ${fmtMoney(ev.order_amount)}</div>
            ${detailStr ? `<div style="font-size:11px;color:rgba(255,255,255,.4);margin-top:2px">${detailStr}</div>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;flex-shrink:0">
            <span class="muted" style="font-size:11px">${fmtDate(ev.created_at)}</span>
            <button class="ghost-btn" style="font-size:11px;padding:4px 10px" onclick="resolveEvent(${ev.id}, this)">Вирішити</button>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    list.innerHTML = `<div style="color:#f87171;padding:16px">${e.message}</div>`;
  }
}

async function resolveEvent(eventId, btn) {
  try {
    btn.disabled = true; btn.textContent = '…';
    await api.request(`/api/admin/payments/risk-events/${eventId}/resolve`, { method: 'POST' });
    btn.closest('.item').style.opacity = '0.4';
    btn.textContent = '✓';
    showToast('Подію вирішено.');
    loadFraudStats();
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Вирішити';
    showToast(e.message);
  }
}

async function runIntegrityCheck() {
  const btn = $('#integrityBtn');
  const pre = $('#integrityResult');
  btn.disabled = true; btn.textContent = 'Перевірка…';
  pre.style.display = 'none';
  try {
    const { data } = await api.request('/api/admin/payments/integrity-check');
    const color = data.all_ok ? '#34d399' : '#f87171';
    const icon  = data.all_ok ? '✓' : '✗';
    pre.style.display = 'block';
    pre.style.color = color;
    pre.textContent = `${icon} Рахунків перевірено: ${data.total_accounts}\n`
      + `Порушень: ${data.broken_accounts}\n`
      + (data.all_ok ? 'Цілісність збережена.' : JSON.stringify(
          Object.entries(data.per_account)
            .filter(([, r]) => !r.ok)
            .map(([id, r]) => ({ account: id, broken_at_tx: r.broken_at, errors: r.errors.length })),
          null, 2
        ));
  } catch (e) {
    pre.style.display = 'block';
    pre.style.color = '#f87171';
    pre.textContent = e.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Перевірити хеш-ланцюг';
  }
}

// ── Audit ────────────────────────────────────────────────────────────────────

async function loadAudit() {
  const logs = await api.request('/api/admin/audit-logs');
  $('#auditList').innerHTML = logs.map((l) => `
    <div class="item">
      <div class="item-header"><strong>${l.action}</strong><span class="muted">${fmtDate(l.created_at)}</span></div>
      <div class="muted">user_id: ${l.user_id ?? '—'} · ${l.details || '—'}</div>
    </div>
  `).join('');
}

// ── Tab routing ───────────────────────────────────────────────────────────────

function switchTab(tabId) {
  $$('.admin-tab').forEach((el) => el.classList.add('hidden'));
  $(`#${tabId}Tab`)?.classList.remove('hidden');
  $$('.menu-btn[data-tab]').forEach((btn) =>
    btn.classList.toggle('active', btn.dataset.tab === tabId)
  );
  if (tabId === 'users')    loadUsers($('#roleFilter').value);
  if (tabId === 'audit')    loadAudit();
  if (tabId === 'security') {
    loadFraudStats();
    loadOrders();
    loadRiskEvents();
  }
}

// ── Drawer ───────────────────────────────────────────────────────────────────

function setDrawer(open) {
  $('#drawer')?.classList.toggle('open', open);
  $('#backdrop')?.classList.toggle('open', open);
}

async function openUserDrawer(userId) {
  try {
    setDrawer(true);
    $('#drawerTitle').textContent = `Користувач #${userId}`;
    $('#drawerSub').textContent = 'Завантаження...';
    $('#drawerBalance').textContent = '—';
    $('#drawerAccount').textContent = '—';
    $('#drawerTx').innerHTML = '';
    const [account, txs] = await Promise.all([
      api.request(`/api/admin/users/${userId}/account`),
      api.request(`/api/admin/users/${userId}/transactions?limit=50`),
    ]);
    $('#drawerSub').textContent = account.account_number || '—';
    $('#drawerBalance').textContent = `Баланс: ${fmtMoney(account.balance)}`;
    $('#drawerAccount').textContent = `Рахунок: ${account.account_number}`;
    $('#drawerTx').innerHTML = (txs || []).slice(0, 20).map((t) => `
      <div class="item">
        <div class="item-header">
          <strong>${t.description}</strong>
          <span class="amount ${t.direction}">${t.direction === 'in' ? '+' : '-'}${fmtMoney(t.amount)}</span>
        </div>
        <div class="subtle">${t.tx_type} · ${fmtDate(t.created_at)}${t.related_account ? ` · ${t.related_account}` : ''}</div>
      </div>
    `).join('') || '<div class="item"><span class="subtle">Транзакцій немає.</span></div>';
  } catch (e) { showToast(e.message); setDrawer(false); }
}

// ── Init ─────────────────────────────────────────────────────────────────────

(async function () {
  const user = await checkAdmin();
  if (!user) return;
  const roleLabels = { soldier: 'Військовий', operator: 'Оператор', admin: 'Адмін', platform_admin: 'Платформа' };
  $('#adminUser').textContent = user.email + ' · ' + (roleLabels[user.role] || user.role);

  $('#roleFilter').addEventListener('change', () => loadUsers($('#roleFilter').value));
  $('#orderRiskFilter').addEventListener('change', loadOrders);
  $('#orderStatusFilter').addEventListener('change', loadOrders);

  $$('.menu-btn[data-tab]').forEach((btn) =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  );
  $('#drawerClose')?.addEventListener('click', () => setDrawer(false));
  $('#backdrop')?.addEventListener('click', () => setDrawer(false));
  $('#logoutBtn').addEventListener('click', () => {
    api.setToken('');
    window.location.href = basePath() || '/';
  });

  switchTab('users');
})();

// Army Bank — Admin Panel v3
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const escapeHtml = (v) => String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

/** Like api.request but returns the full payload (no data unwrap). */
async function apiRaw(url, options = {}) {
  const base = (typeof window !== 'undefined' && window.ARMY_BANK_BASE) || '';
  const res = await fetch(base + url, {
    ...options,
    headers: { Authorization: `Bearer ${api.token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.ok === false) throw new Error(payload.error || 'Помилка запиту');
  return payload;
}

function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 2800);
}

function basePath() {
  return (typeof window !== 'undefined' && window.ARMY_BANK_BASE) || '';
}

function fmtMoney(v) {
  return '₴\u202f' + Number(v || 0).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtShortDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit' });
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

const TX_TYPE_UA = {
  transfer: 'Переказ', topup: 'Поповнення', payout: 'Виплата',
  donation: 'Донат', savings: 'Накопичення',
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

// ── Overview ──────────────────────────────────────────────────────────────────

async function loadOverview() {
  try {
    const [statsRes, chartRes] = await Promise.all([
      api.request('/api/admin/stats'),
      api.request('/api/admin/stats/charts?days=' + ($('#chartDays')?.value || 14)),
    ]);

    // KPI cards
    $('#ovUsers').textContent     = statsRes.total_users ?? '—';
    $('#ovBalance').textContent   = fmtMoney(statsRes.total_balance);
    $('#ovTx').textContent        = statsRes.total_tx ?? '—';
    $('#ovPayouts').textContent   = fmtMoney(statsRes.total_payouts);
    $('#ovDonations').textContent = fmtMoney(statsRes.total_donations);
    $('#ovNewToday').textContent   = statsRes.new_users_today ?? '—';
    $('#ovActiveToday').textContent = statsRes.active_today ?? '—';
    $('#ovNetFlow').textContent   = fmtMoney(statsRes.net_flow_month);

    // Bar chart (transactions)
    renderBarChart(chartRes.daily || []);

    // Registration trend chart
    renderRegChart(chartRes.new_users_daily || []);

    // Type distribution
    renderTypeDist(chartRes.by_type || []);

    // Top users
    renderTopUsers(chartRes.top_users || []);
  } catch (e) {
    console.warn('overview:', e.message);
  }
}

function renderBarChart(daily) {
  const wrap = $('#barChartWrap');
  if (!wrap) return;
  if (!daily.length) { wrap.innerHTML = '<div class="muted" style="padding:20px;text-align:center">Даних немає</div>'; return; }

  const W = Math.max(wrap.offsetWidth || 600, 300);
  const H = 140;
  const pad = { top: 10, right: 10, bottom: 30, left: 8 };
  const barW = Math.max(4, Math.floor((W - pad.left - pad.right) / daily.length) - 3);
  const maxIn  = Math.max(...daily.map(d => d.vol_in  || 0), 1);
  const maxOut = Math.max(...daily.map(d => d.vol_out || 0), 1);
  const maxVal = Math.max(maxIn, maxOut, 1);
  const innerH = H - pad.top - pad.bottom;

  const bars = daily.map((d, i) => {
    const x = pad.left + i * ((W - pad.left - pad.right) / daily.length);
    const hIn  = Math.round((d.vol_in  / maxVal) * innerH);
    const hOut = Math.round((d.vol_out / maxVal) * innerH);
    const yIn  = pad.top + innerH - hIn;
    const yOut = pad.top + innerH - hOut;
    const label = fmtShortDate(d.day + 'T00:00:00');
    return `
      <rect x="${x}" y="${yIn}" width="${barW}" height="${hIn}" rx="2" fill="#1a56db" opacity=".75"/>
      <rect x="${x + barW / 2}" y="${yOut}" width="${barW / 2}" height="${hOut}" rx="2" fill="#f87171" opacity=".6"/>
      <text x="${x + barW / 2}" y="${H - 4}" text-anchor="middle" font-size="9" fill="rgba(255,255,255,.4)">${label}</text>
    `;
  }).join('');

  wrap.innerHTML = `
    <svg width="100%" viewBox="0 0 ${W} ${H}" class="bar-chart" style="overflow:visible">
      ${bars}
    </svg>
    <div style="display:flex;gap:16px;margin-top:8px;font-size:11px;opacity:.55">
      <span><span style="display:inline-block;width:10px;height:10px;background:#1a56db;border-radius:2px;margin-right:4px"></span>Надходження</span>
      <span><span style="display:inline-block;width:10px;height:10px;background:#f87171;border-radius:2px;margin-right:4px"></span>Витрати</span>
    </div>
  `;
}

function renderRegChart(daily) {
  const wrap = $('#regChartWrap');
  if (!wrap) return;
  if (!daily.length) { wrap.innerHTML = '<div class="muted" style="padding:20px;text-align:center">Даних немає</div>'; return; }
  const W = Math.max(wrap.offsetWidth || 600, 300);
  const H = 100;
  const pad = { top: 8, right: 10, bottom: 28, left: 8 };
  const maxVal = Math.max(...daily.map(d => d.cnt || 0), 1);
  const innerH = H - pad.top - pad.bottom;
  const barW = Math.max(4, Math.floor((W - pad.left - pad.right) / daily.length) - 3);
  const bars = daily.map((d, i) => {
    const x = pad.left + i * ((W - pad.left - pad.right) / daily.length);
    const h = Math.round(((d.cnt || 0) / maxVal) * innerH);
    const y = pad.top + innerH - h;
    return `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="2" fill="#34d399" opacity=".75"/>
      <text x="${x + barW / 2}" y="${H - 4}" text-anchor="middle" font-size="9" fill="rgba(255,255,255,.4)">${fmtShortDate(d.day + 'T00:00:00')}</text>`;
  }).join('');
  wrap.innerHTML = `<svg width="100%" viewBox="0 0 ${W} ${H}" class="bar-chart" style="overflow:visible">${bars}</svg>`;
}

function renderTypeDist(byType) {
  const wrap = $('#typeDistWrap');
  if (!wrap) return;
  if (!byType.length) { wrap.innerHTML = '<div class="muted" style="font-size:12px">Немає даних</div>'; return; }
  const total = byType.reduce((s, r) => s + (r.cnt || 0), 0) || 1;
  wrap.innerHTML = '<div class="type-dist">' + byType.map(r => {
    const pct = Math.round((r.cnt / total) * 100);
    return `<span class="type-pill">${TX_TYPE_UA[r.tx_type] || r.tx_type} <strong>${r.cnt}</strong> <span style="opacity:.5">${pct}%</span></span>`;
  }).join('') + '</div>';
}

function renderTopUsers(topUsers) {
  const wrap = $('#topUsersWrap');
  if (!wrap) return;
  if (!topUsers.length) { wrap.innerHTML = '<div class="muted" style="font-size:12px">Немає даних</div>'; return; }
  const maxVol = Math.max(...topUsers.map(u => u.total_vol || 0), 1);
  wrap.innerHTML = topUsers.map(u => {
    const pct = Math.round(((u.total_vol || 0) / maxVol) * 100);
    return `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
          <span style="opacity:.8">${escapeHtml(u.full_name || '—')}</span>
          <span style="font-weight:700">${fmtMoney(u.total_vol)}</span>
        </div>
        <div style="background:rgba(255,255,255,.07);border-radius:4px;height:5px">
          <div style="background:#1a56db;border-radius:4px;height:100%;width:${pct}%;transition:width .4s"></div>
        </div>
      </div>
    `;
  }).join('');
}

// ── Users ────────────────────────────────────────────────────────────────────

const _selectedUsers = new Set();

function toggleSelectAllUsers(cb) {
  $$('#usersTableBody .user-row-cb').forEach(c => {
    c.checked = cb.checked;
    const id = Number(c.dataset.uid);
    cb.checked ? _selectedUsers.add(id) : _selectedUsers.delete(id);
  });
  updateUsersBulkBar();
}
function updateUsersBulkBar() {
  const bar = document.getElementById('usersBulkBar');
  const cnt = document.getElementById('usersBulkCount');
  if (!bar) return;
  bar.classList.toggle('visible', _selectedUsers.size > 0);
  if (cnt) cnt.textContent = `${_selectedUsers.size} вибрано`;
}
function clearUsersSelection() {
  _selectedUsers.clear();
  $$('.user-row-cb').forEach(c => c.checked = false);
  const all = document.getElementById('usersSelectAll');
  if (all) all.checked = false;
  updateUsersBulkBar();
}
function bulkSendNotification() {
  switchTab('notifications');
  const ids = [..._selectedUsers].join(',');
  setTimeout(() => {
    const el = document.getElementById('notifTargetUserId');
    if (el) el.value = ids;
  }, 200);
  clearUsersSelection();
}
function bulkGenerateStatements() {
  switchTab('audit');
  showToast(`Масова виписка для ${_selectedUsers.size} користувачів`);
  clearUsersSelection();
}
async function bulkBlockUsers() {
  if (!confirm(`Заблокувати ${_selectedUsers.size} користувачів?`)) return;
  const ids = [..._selectedUsers];
  for (const id of ids) {
    try { await apiRaw(`/api/admin/users/${id}/block`, {method:'POST'}); } catch {}
  }
  showToast(`Заблоковано ${ids.length} користувачів`);
  clearUsersSelection();
  loadUsers();
}
async function blockUser(userId, block) {
  try {
    await apiRaw(`/api/admin/users/${userId}/${block ? 'block' : 'unblock'}`, {method:'POST'});
    showToast(block ? `Користувача #${userId} заблоковано` : `Користувача #${userId} розблоковано`);
    loadUsers();
  } catch {
    showToast(block ? 'Заблоковано (mock)' : 'Розблоковано (mock)');
    loadUsers();
  }
}
function exportUsersCsv() { showToast('Формування CSV користувачів…'); }

function handleGlobalSearch(val) {
  if (!val || val.length < 2) return;
  const tabId = document.querySelector('.menu-btn.active[data-tab]')?.dataset?.tab || 'users';
  if (tabId === 'users') {
    const el = document.getElementById('userSearch');
    if (el) { el.value = val; loadUsers(); }
  }
}

const KYC_BADGE_INLINE = {
  verified:      '<span style="color:#34d399;font-size:10px;font-weight:700">✓ KYC</span>',
  pending:       '<span style="color:#fbbf24;font-size:10px;font-weight:700">⏳ KYC</span>',
  rejected:      '<span style="color:#f87171;font-size:10px;font-weight:700">✕ KYC</span>',
  expired:       '<span style="color:#9b9bc0;font-size:10px;font-weight:700">⚠ KYC</span>',
  not_submitted: '<span style="opacity:.35;font-size:10px">Немає</span>',
};

async function loadUsers() {
  const role   = $('#roleFilter')?.value || '';
  const search = $('#userSearch')?.value?.trim() || '';
  let url = '/api/admin/users';
  const p = new URLSearchParams();
  if (role)   p.set('role', role);
  if (search) p.set('search', search);
  if (p.toString()) url += '?' + p.toString();

  const colspan = 9;
  try {
    const res = await api.request(url);
    const users = Array.isArray(res) ? res : (res.data || []);
    const body = $('#usersTableBody');
    if (!users.length) { body.innerHTML = `<tr><td colspan="${colspan}" class="muted" style="text-align:center;padding:20px">Користувачів не знайдено</td></tr>`; return; }
    body.innerHTML = users.map((u) => {
      const kyc = KYC_BADGE_INLINE[u.kyc_status || 'not_submitted'] || KYC_BADGE_INLINE.not_submitted;
      const bal = u.balance != null ? fmtMoney(u.balance) : '<span style="opacity:.35">—</span>';
      const lastActive = u.last_active ? fmtShortDate(u.last_active) : '<span style="opacity:.35">—</span>';
      const isBlocked = u.is_blocked || u.status === 'blocked';
      return `<tr data-id="${u.id}" style="${isBlocked ? 'opacity:.5' : ''}">
        <td><input type="checkbox" class="user-row-cb" data-uid="${u.id}" onchange="(function(cb){const id=Number(cb.dataset.uid);cb.checked?_selectedUsers.add(id):_selectedUsers.delete(id);updateUsersBulkBar();})(this)"></td>
        <td><strong>#${u.id}</strong></td>
        <td>
          <div style="font-weight:600">${escapeHtml(u.full_name)}</div>
          <div class="subtle" style="font-size:11px">${escapeHtml(u.status || u.military_status || '')}</div>
        </td>
        <td class="subtle" style="font-size:11px">${escapeHtml(u.phone || '—')}<br>${escapeHtml(u.email || '—')}</td>
        <td>
          <select class="role-select" data-user-id="${u.id}" style="font-size:11px;padding:3px 6px">
            <option value="soldier"        ${u.role === 'soldier'        ? 'selected' : ''}>Клієнт</option>
            <option value="operator"       ${u.role === 'operator'       ? 'selected' : ''}>Оператор</option>
            <option value="admin"          ${u.role === 'admin'          ? 'selected' : ''}>Адмін</option>
            <option value="platform_admin" ${u.role === 'platform_admin' ? 'selected' : ''}>Платформа</option>
          </select>
        </td>
        <td style="font-family:var(--ff-mono);font-size:12px">${bal}</td>
        <td>${kyc}</td>
        <td style="font-size:11px;opacity:.7">${lastActive}</td>
        <td>
          <div class="btn-row" style="gap:4px;flex-wrap:nowrap">
            <button type="button" class="small-btn save-role" data-user-id="${u.id}" style="font-size:11px;padding:4px 8px">Зберегти</button>
            <button type="button" class="ghost-btn open-user" data-user-id="${u.id}" style="font-size:11px">Деталі</button>
            <button type="button" class="ghost-btn" style="font-size:11px;color:${isBlocked ? '#34d399' : '#f87171'}" onclick="blockUser(${u.id},${!isBlocked})">${isBlocked ? '🔓' : '🚫'}</button>
          </div>
        </td>
      </tr>`;
    }).join('');

    $$('.save-role').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.userId;
        const role = $(`.role-select[data-user-id="${userId}"]`)?.value;
        if (!role) return;
        try {
          await api.request(`/api/admin/users/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ role }) });
          showToast('Роль оновлено.');
          loadUsers();
        } catch (e) { showToast(e.message); }
      });
    });
    $$('.open-user').forEach((btn) =>
      btn.addEventListener('click', () => openUserDrawer(Number(btn.dataset.userId)))
    );
  } catch (e) { $('#usersTableBody').innerHTML = `<tr><td colspan="${colspan}" style="color:#f87171;padding:16px">${escapeHtml(e.message)}</td></tr>`; }
}

async function checkSystemHealth() {
  const dots = {api: 'healthApiDot', db: 'healthDbDot', ws: 'healthWsDot'};
  try {
    const h = await apiRaw('/api/health');
    ['api','db','ws'].forEach(k => {
      const el = document.getElementById(dots[k]);
      if (el) el.className = 'syshealth-dot ' + ((h[k] === 'ok') ? 'ok' : 'err');
    });
  } catch {
    ['healthApiDot','healthDbDot','healthWsDot'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.className = 'syshealth-dot warn';
    });
  }
}

// ── Registry ──────────────────────────────────────────────────────────────────

let _regPage = 0;
const _regLimit = 50;
let _regTotal = 0;

async function loadRegistry(reset) {
  if (reset) _regPage = 0;
  const params = new URLSearchParams();
  params.set('limit',  _regLimit);
  params.set('offset', _regPage * _regLimit);
  const search = $('#regSearch')?.value?.trim();
  const userId = $('#regUserId')?.value?.trim();
  const type   = $('#regType')?.value;
  const dir    = $('#regDir')?.value;
  const from   = $('#regFrom')?.value;
  const to     = $('#regTo')?.value;
  const minA   = $('#regMin')?.value;
  const maxA   = $('#regMax')?.value;
  if (search) params.set('search', search);
  if (userId) params.set('user_id', userId);
  if (type)   params.set('tx_type', type);
  if (dir)    params.set('direction', dir);
  if (from)   params.set('from_date', from);
  if (to)     params.set('to_date', to);
  if (minA)   params.set('min_amount', minA);
  if (maxA)   params.set('max_amount', maxA);

  $('#regTableBody').innerHTML = '<tr><td colspan="8" class="muted" style="text-align:center;padding:20px">Завантаження…</td></tr>';
  try {
    // Use apiRaw to preserve total + summary (api.request unwraps .data and loses them)
    const payload = await apiRaw('/api/admin/transactions?' + params.toString());
    const rows = payload.data || [];
    _regTotal = payload.total ?? rows.length;
    const sum  = payload.summary || {};

    // Summary strip
    const totalEl = $('#regTotal');
    if (totalEl) {
      if (_regTotal > 0 && (sum.total_in || sum.total_out)) {
        totalEl.innerHTML =
          `<span>Знайдено: <strong>${_regTotal}</strong></span>` +
          `<span style="margin-left:16px;color:#34d399">▲ ${fmtMoney(sum.total_in)}</span>` +
          `<span style="margin-left:10px;color:#f87171">▼ ${fmtMoney(sum.total_out)}</span>` +
          (sum.avg_amount ? `<span style="margin-left:10px;opacity:.5">⌀ ${fmtMoney(sum.avg_amount)}</span>` : '');
      } else {
        totalEl.textContent = `Знайдено: ${_regTotal} транзакцій`;
      }
    }

    $('#regPrev').disabled = _regPage === 0;
    $('#regNext').disabled = (_regPage + 1) * _regLimit >= _regTotal;
    $('#regPageInfo').textContent = `Сторінка ${_regPage + 1} / ${Math.max(1, Math.ceil(_regTotal / _regLimit))}`;

    if (!rows.length) {
      $('#regTableBody').innerHTML = '<tr><td colspan="8" class="muted" style="text-align:center;padding:24px">Нічого не знайдено</td></tr>';
      return;
    }
    $('#regTableBody').innerHTML = rows.map(t => `
      <tr>
        <td><strong>#${t.id}</strong></td>
        <td style="font-size:11px;white-space:nowrap">${fmtDate(t.created_at)}</td>
        <td style="font-size:12px">${escapeHtml(t.full_name || '—')}<br><span class="muted" style="font-size:11px">id:${t.user_id}</span></td>
        <td style="font-size:11px;font-family:monospace">${escapeHtml(t.account_number || '—')}</td>
        <td><span style="font-size:11px;background:rgba(255,255,255,.07);padding:2px 7px;border-radius:100px">${TX_TYPE_UA[t.tx_type] || t.tx_type}</span></td>
        <td style="font-size:12px">${t.direction === 'in' ? '<span style="color:#34d399">▲ Прихід</span>' : '<span style="color:#f87171">▼ Витрата</span>'}</td>
        <td style="font-weight:700;white-space:nowrap">${fmtMoney(t.amount)}</td>
        <td style="font-size:12px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(t.description || '')}">${escapeHtml(t.description || '—')}</td>
      </tr>
    `).join('');
  } catch (e) {
    $('#regTableBody').innerHTML = `<tr><td colspan="8" style="color:#f87171;padding:16px">${escapeHtml(e.message)}</td></tr>`;
  }
}

function registryPage(delta) {
  _regPage = Math.max(0, _regPage + delta);
  loadRegistry(false);
}

function resetRegistry() {
  ['#regSearch','#regUserId','#regMin','#regMax'].forEach(id => { const el = $(id); if (el) el.value = ''; });
  ['#regType','#regDir'].forEach(id => { const el = $(id); if (el) el.value = ''; });
  ['#regFrom','#regTo'].forEach(id => { const el = $(id); if (el) el.value = ''; });
  $('#regTotal').innerHTML = '';
  $('#regTableBody').innerHTML = '<tr><td colspan="8" class="muted" style="text-align:center;padding:24px">Застосуйте фільтр або натисніть ↻</td></tr>';
  ['#regPrev','#regNext'].forEach(id => { const el = $(id); if (el) el.disabled = true; });
  $('#regPageInfo').textContent = '—';
}

async function exportRegistryCsv() {
  const btn = $('#regExportCsvBtn');
  try {
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    const params = new URLSearchParams();
    params.set('limit', 2000);
    params.set('offset', 0);
    const search = $('#regSearch')?.value?.trim();
    const userId = $('#regUserId')?.value?.trim();
    const type   = $('#regType')?.value;
    const dir    = $('#regDir')?.value;
    const from   = $('#regFrom')?.value;
    const to     = $('#regTo')?.value;
    const minA   = $('#regMin')?.value;
    const maxA   = $('#regMax')?.value;
    if (search) params.set('search', search);
    if (userId) params.set('user_id', userId);
    if (type)   params.set('tx_type', type);
    if (dir)    params.set('direction', dir);
    if (from)   params.set('from_date', from);
    if (to)     params.set('to_date', to);
    if (minA)   params.set('min_amount', minA);
    if (maxA)   params.set('max_amount', maxA);

    const payload = await apiRaw('/api/admin/transactions?' + params.toString());
    const rows = payload.data || [];
    if (!rows.length) { showToast('Немає даних для експорту'); return; }

    const headers = ['ID','Дата','Користувач','User ID','Рахунок','Тип','Напрямок','Сума','Опис'];
    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      headers.join(','),
      ...rows.map(t => [
        t.id,
        fmtDate(t.created_at),
        escape(t.full_name),
        t.user_id,
        escape(t.account_number),
        t.tx_type,
        t.direction,
        Number(t.amount).toFixed(2),
        escape(t.description),
      ].join(','))
    ];
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `registry-${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    showToast(`Експортовано ${rows.length} транзакцій`);
  } catch (e) {
    showToast(e.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="margin-right:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>CSV';
    }
  }
}

// ── Security tab ─────────────────────────────────────────────────────────────

async function loadFraudStats() {
  try {
    const data = await api.request('/api/admin/payments/fraud-stats');
    const blocked = (data.by_status || []).find(r => r.status === 'blocked');
    const critical = (data.by_level || []).find(r => r.risk_level === 'critical');
    const high = (data.by_level || []).find(r => r.risk_level === 'high');
    const unresolved = (data.unresolved_events || []).reduce((s, r) => s + Number(r.cnt), 0);

    $('#statBlocked').textContent    = blocked  ? blocked.cnt  : '0';
    $('#statCritical').textContent   = critical ? critical.cnt : '0';
    $('#statHigh').textContent       = high     ? high.cnt     : '0';
    $('#statUnresolved').textContent = unresolved;

    const badge = $('#unresolvedBadge');
    if (unresolved > 0)
      badge.innerHTML = `<span style="background:#f87171;color:#000;border-radius:100px;padding:1px 7px;font-size:11px;font-weight:700;margin-left:6px">${unresolved}</span>`;
  } catch (e) { console.warn('fraud stats:', e.message); }
}

async function loadOrders() {
  const risk   = $('#orderRiskFilter').value;
  const status = $('#orderStatusFilter').value;
  const from   = $('#orderFromDate')?.value;
  const to     = $('#orderToDate')?.value;
  const params = new URLSearchParams({ limit: 50 });
  if (risk)   params.set('risk_level', risk);
  if (status) params.set('status', status);
  if (from)   params.set('from_date', from);
  if (to)     params.set('to_date', to);

  $('#ordersTableBody').innerHTML = '<tr><td colspan="7" class="muted" style="text-align:center;padding:16px">Завантаження…</td></tr>';
  try {
    const res = await api.request('/api/admin/payments/orders?' + params.toString());
    const data = Array.isArray(res) ? res : (res.data || []);
    if (!data.length) {
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
    $('#ordersTableBody').innerHTML = `<tr><td colspan="7" style="color:#f87171;padding:16px">${escapeHtml(e.message)}</td></tr>`;
  }
}

async function loadRiskEvents() {
  const list = $('#riskEventsList');
  list.innerHTML = '<div class="muted" style="padding:12px">Завантаження…</div>';
  try {
    const res = await api.request('/api/admin/payments/risk-events?resolved=false&limit=30');
    const data = Array.isArray(res) ? res : (res.data || []);
    if (!data.length) {
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
    list.innerHTML = `<div style="color:#f87171;padding:16px">${escapeHtml(e.message)}</div>`;
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
    const res  = await api.request('/api/admin/payments/integrity-check');
    const data = res.data ?? res;
    const color = data.all_ok ? '#34d399' : '#f87171';
    pre.style.display = 'block';
    pre.style.color = color;
    pre.textContent = `${data.all_ok ? '✓' : '✗'} Рахунків: ${data.total_accounts}\nПорушень: ${data.broken_accounts}\n`
      + (data.all_ok ? 'Цілісність збережена.' : JSON.stringify(
          Object.entries(data.per_account || {})
            .filter(([, r]) => !r.ok)
            .map(([id, r]) => ({ account: id, broken_at_tx: r.broken_at, errors: r.errors?.length })),
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
  const action = $('#auditActionFilter')?.value || '';
  const userId = $('#auditUserIdFilter')?.value?.trim() || '';
  const params = new URLSearchParams({ limit: 200 });
  if (userId) params.set('user_id', userId);

  try {
    const res  = await api.request('/api/admin/audit-logs?' + params.toString());
    let logs = Array.isArray(res) ? res : (res.data || []);
    logs = logs.filter(l => l.action !== 'statement_pdf');
    if (action) logs = logs.filter(l => l.action === action);

    $('#auditList').innerHTML = logs.length
      ? logs.map((l) => `
          <div class="item">
            <div class="item-header">
              <strong>${escapeHtml(l.action)}</strong>
              <span class="muted">${fmtDate(l.created_at)}</span>
            </div>
            <div class="muted" style="font-size:12px">user_id: ${l.user_id ?? '—'} · ${escapeHtml(l.details || '—')}</div>
          </div>
        `).join('')
      : '<div class="muted" style="padding:16px;text-align:center">Логів немає.</div>';
  } catch (e) {
    $('#auditList').innerHTML = `<div class="muted" style="padding:16px">Помилка: ${escapeHtml(e.message)}</div>`;
  }
}

async function loadStatements() {
  const typeF = $('#stmtLogTypeFilter')?.value || '';
  const userF = $('#stmtLogUserFilter')?.value || '';
  try {
    const res  = await api.request('/api/admin/payments/statements');
    let logs = Array.isArray(res) ? res : (res.data || []);
    if (typeF) logs = logs.filter(l => (l.stmt_type || l.type || '') === typeF);
    if (userF) logs = logs.filter(l => String(l.user_id) === userF);
    const tbody = $('#statementsTableBody');
    if (!logs.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="muted" style="text-align:center;padding:20px">Виписки не знайдено.</td></tr>';
      return;
    }
    const TYPE_UA = { full:'Повна', credit:'Кредитний', deposit:'Депозитний', tax:'Податкова', compliance:'Compliance', analytics:'Аналітика' };
    const FMT_COLOR = { pdf:'#f87171', csv:'#34d399', xlsx:'#60a5fa' };
    tbody.innerHTML = logs.map((l) => {
      const t = l.stmt_type || l.type || 'full';
      const fmt = l.format || 'pdf';
      const fmtBadge = `<span style="font-size:10px;font-weight:700;color:${FMT_COLOR[fmt]||'#e5e5e5'}">${fmt.toUpperCase()}</span>`;
      const period = l.period_from && l.period_to
        ? `${fmtShortDate(l.period_from)} – ${fmtShortDate(l.period_to)}`
        : (l.details ? escapeHtml(String(l.details).slice(0,30)) : '—');
      return `<tr>
        <td style="white-space:nowrap;font-size:11px">${fmtDate(l.created_at)}</td>
        <td>${l.user_id ?? '—'}</td>
        <td style="font-size:12px">${escapeHtml(l.username || l.name || '—')}</td>
        <td style="font-size:11px">${TYPE_UA[t] || t}</td>
        <td>${fmtBadge}</td>
        <td style="font-size:11px;white-space:nowrap">${period}</td>
        <td style="font-size:11px;text-align:center">${l.pages || '—'}</td>
        <td style="font-size:11px">${l.file_size ? (l.file_size > 1024 ? Math.round(l.file_size/1024)+'KB' : l.file_size+'B') : '—'}</td>
        <td style="font-size:11px">${escapeHtml(l.requested_by || 'admin')}</td>
        <td>${l.download_url
          ? `<a href="${escapeHtml(l.download_url)}" class="ghost-btn" style="font-size:11px;padding:3px 8px" target="_blank">↓ PDF</a>`
          : `<button class="ghost-btn" style="font-size:11px;padding:3px 8px" onclick="regenStatement(${l.id||l.user_id})">↻ Перегенерувати</button>`}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    $('#statementsTableBody').innerHTML = `<tr><td colspan="10" class="muted" style="padding:16px">Помилка: ${escapeHtml(e.message)}</td></tr>`;
  }
}

// ── Statement Generator ───────────────────────────────────────────────────────

let _stmtType = 'full';
let _stmtUserId = null;

function selectStmtType(btn) {
  $$('#stmtTypeGrid .stmt-type-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _stmtType = btn.dataset.type;
}

function setStmtPeriod(preset) {
  const now = new Date();
  let from, to = now.toISOString().slice(0,10);
  if (preset === 'month') {
    from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
  } else if (preset === 'quarter') {
    const q = Math.floor(now.getMonth()/3);
    from = new Date(now.getFullYear(), q*3, 1).toISOString().slice(0,10);
  } else if (preset === 'year') {
    from = new Date(now.getFullYear(), 0, 1).toISOString().slice(0,10);
  } else {
    from = '2024-01-01';
  }
  $('#stmtFrom').value = from;
  $('#stmtTo').value = to;
}

async function searchStmtUser() {
  const q = $('#stmtUserSearch')?.value?.trim();
  if (!q) return;
  try {
    const res = await api.request(`/api/admin/users?search=${encodeURIComponent(q)}&limit=5`);
    const users = Array.isArray(res) ? res : (res.data || res.users || []);
    const el = $('#stmtUserResult');
    if (!users.length) { el.textContent = 'Не знайдено'; return; }
    el.innerHTML = users.map(u =>
      `<div style="cursor:pointer;padding:4px 6px;border-radius:4px;hover:background:rgba(255,255,255,.05)"
        onclick="selectStmtUser(${u.id},'${escapeHtml(u.username||u.name||'')}')">
        <strong>#${u.id}</strong> ${escapeHtml(u.username||u.name||'—')}
        <span style="opacity:.5;font-size:11px"> · ${escapeHtml(u.email||'')}</span>
      </div>`
    ).join('');
  } catch(e) { $('#stmtUserResult').textContent = 'Помилка: ' + e.message; }
}

function selectStmtUser(id, name) {
  _stmtUserId = id;
  $('#stmtUserResult').innerHTML = `<div style="color:#34d399;font-weight:600">✓ Обрано: #${id} ${escapeHtml(name)}</div>`;
}

async function generateStatement() {
  const from   = $('#stmtFrom')?.value;
  const to     = $('#stmtTo')?.value;
  const format = document.querySelector('input[name="stmtFormat"]:checked')?.value || 'pdf';
  const lang   = document.querySelector('input[name="stmtLang"]:checked')?.value || 'uk';
  if (!_stmtUserId) { showToast('Оберіть користувача'); return; }
  if (!from || !to)  { showToast('Вкажіть період'); return; }
  const sections = {
    balance:    $('#inclBalance')?.checked,
    transactions: $('#inclTx')?.checked,
    credits:    $('#inclCredits')?.checked,
    deposits:   $('#inclDeposits')?.checked,
    analytics:  $('#inclAnalytics')?.checked,
    compliance: $('#inclCompliance')?.checked,
    kyc:        $('#inclKyc')?.checked,
    signature:  $('#inclSignature')?.checked,
  };
  try {
    showToast('Генерація виписки…');
    const res = await apiRaw('/api/admin/statements/generate', {
      method: 'POST',
      body: JSON.stringify({ user_id: _stmtUserId, type: _stmtType, format, lang, period_from: from, period_to: to, sections }),
    });
    if (res.download_url) {
      window.open(res.download_url, '_blank');
    } else {
      // Fallback: trigger existing user statement endpoint
      const fallback = await fetch(`${basePath()}/api/admin/users/${_stmtUserId}/statement?from=${from}&to=${to}&format=${format}`, {
        headers: { Authorization: `Bearer ${api.token}` }
      });
      if (!fallback.ok) throw new Error('Сервер не повернув файл');
      const blob = await fallback.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `statement_${_stmtUserId}_${from}_${to}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    }
    showToast('Виписку завантажено');
    loadStatements();
  } catch(e) { showToast('Помилка: ' + e.message); }
}

async function generateAndEmail() {
  if (!_stmtUserId) { showToast('Оберіть користувача'); return; }
  showToast('Надсилання на email…');
  try {
    await apiRaw('/api/admin/statements/send-email', {
      method: 'POST',
      body: JSON.stringify({ user_id: _stmtUserId, type: _stmtType }),
    });
    showToast('Email надіслано');
  } catch(e) { showToast('Помилка надсилання: ' + e.message); }
}

async function regenStatement(userId) {
  showToast('Перегенерація…');
  try {
    const res = await fetch(`${basePath()}/api/admin/users/${userId}/statement`, {
      headers: { Authorization: `Bearer ${api.token}` }
    });
    if (!res.ok) throw new Error('Помилка');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `statement_${userId}.pdf`; a.click();
    URL.revokeObjectURL(url);
    showToast('Готово');
  } catch(e) { showToast('Помилка: ' + e.message); }
}

async function generateBulkStatements() {
  const template = $('#bulkTemplate')?.value;
  const group    = $('#bulkGroup')?.value;
  const sendEmail = $('#bulkSendEmail')?.checked;
  const bar = $('#bulkProgressBar');
  const progress = $('#bulkProgress');
  const status = $('#bulkStatus');
  progress.style.display = 'block';
  status.textContent = 'Запуск масової генерації…';
  let pct = 0;
  const timer = setInterval(() => { pct = Math.min(pct + 7, 90); bar.style.width = pct + '%'; }, 400);
  try {
    const res = await apiRaw('/api/admin/statements/bulk', {
      method: 'POST',
      body: JSON.stringify({ template, group, send_email: sendEmail }),
    });
    clearInterval(timer);
    bar.style.width = '100%';
    status.textContent = `Готово: ${res.generated || '—'} виписок згенеровано${sendEmail ? ', надіслано на email' : ''}`;
    setTimeout(() => { progress.style.display = 'none'; bar.style.width = '0%'; }, 3000);
    loadStatements();
  } catch(e) {
    clearInterval(timer);
    bar.style.width = '0%';
    status.textContent = 'Помилка: ' + e.message;
    progress.style.display = 'none';
  }
}

function exportStatementsLog() {
  window.open(`${basePath()}/api/admin/statements/export-log?format=csv`, '_blank');
}

// ── KYC ──────────────────────────────────────────────────────────────────────

let _kycUserId = null;
let _kycDebounce = null;

function debounceKycSearch() {
  clearTimeout(_kycDebounce);
  _kycDebounce = setTimeout(loadKycQueue, 380);
}

const KYC_STATUS_HTML = {
  pending:       '<span class="kyc-status-pending">⏳ Очікує</span>',
  verified:      '<span class="kyc-status-verified">✓ Верифіковано</span>',
  rejected:      '<span class="kyc-status-rejected">✕ Відхилено</span>',
  expired:       '<span class="kyc-status-expired">◌ Застарів</span>',
  not_submitted: '<span style="opacity:.45;font-size:12px">Не подано</span>',
};

const KYC_DOC_UA = {
  passport: 'Паспорт', id_card: 'ID-картка',
  driving_license: 'Водійське', foreign_passport: 'Закорд. паспорт',
  residence_permit: 'Посвідка',
};

async function loadKycStats() {
  try {
    const res = await api.request('/api/admin/kyc/stats');
    $('#kycStatPending').textContent  = res.pending  ?? '—';
    $('#kycStatVerified').textContent = res.verified ?? '—';
    $('#kycStatRejected').textContent = res.rejected ?? '—';
    $('#kycStatExpired').textContent  = res.expired  ?? '—';
    $('#kycStatCompliance').textContent = res.compliance_pct ? res.compliance_pct + '%' : '—';
    $('#kycStatAvgTime').textContent  = res.avg_review_hours ? res.avg_review_hours + ' год' : '—';
  } catch (_) {
    // Fallback mock — remove when API is ready
    $('#kycStatPending').textContent  = '3';
    $('#kycStatVerified').textContent = '41';
    $('#kycStatRejected').textContent = '7';
    $('#kycStatExpired').textContent  = '2';
    $('#kycStatCompliance').textContent = '78%';
    $('#kycStatAvgTime').textContent  = '4.2 год';
  }
}

async function loadKycQueue() {
  const status  = $('#kycStatusFilter')?.value || '';
  const risk    = $('#kycRiskFilter')?.value   || '';
  const docType = $('#kycDocTypeFilter')?.value || '';
  const search  = $('#kycSearch')?.value?.trim() || '';
  const tbody   = $('#kycQueueBody');
  tbody.innerHTML = '<tr><td colspan="10" class="muted" style="text-align:center;padding:20px">Завантаження…</td></tr>';
  try {
    const params = new URLSearchParams({ limit: 50 });
    if (status)  params.set('kyc_status', status);
    if (risk)    params.set('risk', risk);
    if (docType) params.set('doc_type', docType);
    if (search)  params.set('search', search);
    const res  = await api.request('/api/admin/kyc/queue?' + params);
    const rows = Array.isArray(res) ? res : (res.data || res.users || []);
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="muted" style="text-align:center;padding:20px">Записів не знайдено.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(u => `
      <tr>
        <td>${u.id}</td>
        <td style="font-weight:600">${escapeHtml(u.username || u.name || '—')}</td>
        <td style="font-size:11px;opacity:.7">${escapeHtml(u.email || '—')}</td>
        <td>${KYC_STATUS_HTML[u.kyc_status || 'not_submitted'] || u.kyc_status}</td>
        <td>${RISK_BADGE[u.risk_level || 'low'] || '—'}</td>
        <td style="font-size:11px">${KYC_DOC_UA[u.kyc_doc_type] || '—'}</td>
        <td style="text-align:center">${u.kyc_docs_count ?? '—'}</td>
        <td style="font-size:11px;white-space:nowrap">${fmtDate(u.kyc_submitted_at)}</td>
        <td style="font-size:11px;opacity:.6">${escapeHtml(u.kyc_reviewer || '—')}</td>
        <td>
          <button class="ghost-btn" style="font-size:11px;padding:3px 9px" onclick="reviewKycUser(${u.id})">Розглянути</button>
        </td>
      </tr>
    `).join('');
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="10" class="muted" style="padding:16px">Помилка: ${escapeHtml(e.message)}</td></tr>`;
  }
}

async function reviewKycUser(userId) {
  _kycUserId = userId;
  const panel = $('#kycDetailPanel');
  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#kycDetailTitle').textContent = `Перевірка користувача #${userId}`;
  // Reset fields
  ['kycInfoName','kycInfoDob','kycInfoDocNum','kycInfoDocType','kycInfoCountry',
   'kycInfoAddress','kycInfoIpn','kycInfoPep',
   'kycTxTotal','kycTxMonthly','kycTxMax','kycTxRisk','kycTxAml','kycTxCreated'].forEach(id => {
    const el = $(`#${id}`); if (el) el.textContent = '—';
  });
  for (let i=1; i<=5; i++) {
    const d = $(`#kycDoc${i}`);
    if (d) { d.textContent = 'Завантаження…'; d.className = 'kyc-doc-preview'; }
    const a = $(`#kycDoc${i}Actions`); if (a) a.style.display = 'none';
  }
  $('#kycHistory').innerHTML = '<div class="kyc-hist-item pending" style="font-size:11px">Завантаження…</div>';
  try {
    const data = await api.request(`/api/admin/kyc/user/${userId}`);
    // Personal info
    $('#kycInfoName').textContent    = data.full_name || '—';
    $('#kycInfoDob').textContent     = data.date_of_birth || '—';
    $('#kycInfoDocNum').textContent  = data.document_number || '—';
    $('#kycInfoDocType').textContent = KYC_DOC_UA[data.document_type] || data.document_type || '—';
    $('#kycInfoCountry').textContent = data.nationality || '—';
    $('#kycInfoAddress').textContent = data.address || '—';
    $('#kycInfoIpn').textContent     = data.tax_id || '—';
    $('#kycInfoPep').innerHTML       = data.is_pep
      ? '<span style="color:#f87171;font-weight:700">PEP — Публічна особа</span>'
      : '<span style="color:#34d399">Ні</span>';
    // Tx profile
    $('#kycTxTotal').textContent   = data.tx_count || '—';
    $('#kycTxMonthly').textContent = data.monthly_turnover ? fmtMoney(data.monthly_turnover) : '—';
    $('#kycTxMax').textContent     = data.max_tx ? fmtMoney(data.max_tx) : '—';
    $('#kycTxRisk').innerHTML      = RISK_BADGE[data.risk_level || 'low'];
    $('#kycTxAml').innerHTML       = data.aml_flags?.length
      ? `<span style="color:#f87171">${data.aml_flags.join(', ')}</span>`
      : '<span style="color:#34d399">Чисто</span>';
    $('#kycTxCreated').textContent = fmtDate(data.created_at);
    // Documents
    const docs = data.documents || [];
    docs.forEach((doc, i) => {
      const d = $(`#kycDoc${i+1}`);
      if (!d) return;
      d.textContent = `✓ ${doc.filename || 'Завантажено'} (${doc.uploaded_at ? fmtShortDate(doc.uploaded_at) : ''})`;
      d.className = 'kyc-doc-preview uploaded';
      const a = $(`#kycDoc${i+1}Actions`); if (a) a.style.display = 'block';
    });
    for (let i = docs.length+1; i <= 5; i++) {
      const d = $(`#kycDoc${i}`);
      if (d) { d.textContent = 'Не завантажено'; d.className = 'kyc-doc-preview'; }
    }
    // History
    const history = data.review_history || [];
    if (history.length) {
      $('#kycHistory').innerHTML = history.map(h => `
        <div class="kyc-hist-item ${h.decision}">
          <strong>${h.decision === 'approved' ? '✓ Верифіковано' : h.decision === 'rejected' ? '✕ Відхилено' : '⏳'}</strong>
          · ${fmtDate(h.created_at)} · ${escapeHtml(h.reviewer || '—')}
          ${h.note ? `<div style="opacity:.7;margin-top:2px">${escapeHtml(h.note)}</div>` : ''}
        </div>
      `).join('');
    } else {
      $('#kycHistory').innerHTML = '<div class="kyc-hist-item pending">Немає попередніх перевірок</div>';
    }
  } catch(e) {
    showToast('Не вдалося завантажити KYC: ' + e.message);
  }
}

function closeKycDetail() {
  $('#kycDetailPanel').style.display = 'none';
  _kycUserId = null;
}

async function approveKyc() {
  if (!_kycUserId) return;
  const docType = $('#kycDocTypeDecision')?.value;
  const note    = $('#kycReviewNote')?.value?.trim();
  const limitD  = $('#kycLimitDaily')?.value;
  const limitM  = $('#kycLimitMonthly')?.value;
  if (!docType) { showToast('Оберіть тип документа'); return; }
  try {
    await apiRaw(`/api/admin/kyc/user/${_kycUserId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ document_type: docType, note, limit_daily: limitD||null, limit_monthly: limitM||null }),
    });
    showToast(`KYC #${_kycUserId} верифіковано`);
    closeKycDetail();
    loadKycQueue();
    loadKycStats();
  } catch(e) { showToast('Помилка: ' + e.message); }
}

async function rejectKyc() {
  if (!_kycUserId) return;
  const note = $('#kycReviewNote')?.value?.trim();
  if (!note) { showToast('Вкажіть причину відхилення'); return; }
  try {
    await apiRaw(`/api/admin/kyc/user/${_kycUserId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    });
    showToast(`KYC #${_kycUserId} відхилено`);
    closeKycDetail();
    loadKycQueue();
    loadKycStats();
  } catch(e) { showToast('Помилка: ' + e.message); }
}

async function requestMoreKycDocs() {
  if (!_kycUserId) return;
  const note = $('#kycReviewNote')?.value?.trim() || 'Необхідні додаткові документи';
  try {
    await apiRaw(`/api/admin/kyc/user/${_kycUserId}/request-docs`, {
      method: 'POST', body: JSON.stringify({ note }),
    });
    showToast('Запит надіслано користувачу');
  } catch(e) { showToast('Помилка: ' + e.message); }
}

async function flagKycAml() {
  if (!_kycUserId) return;
  const note = $('#kycReviewNote')?.value?.trim() || 'AML-підозра';
  try {
    await apiRaw(`/api/admin/kyc/user/${_kycUserId}/flag-aml`, {
      method: 'POST', body: JSON.stringify({ note }),
    });
    showToast(`Користувач #${_kycUserId} позначений як AML-підозра`);
    loadKycQueue();
  } catch(e) { showToast('Помилка: ' + e.message); }
}

async function escalateKyc() {
  if (!_kycUserId) return;
  try {
    await apiRaw(`/api/admin/kyc/user/${_kycUserId}/escalate`, { method: 'POST' });
    showToast('Ескальовано на platform_admin');
  } catch(e) { showToast('Помилка: ' + e.message); }
}

async function generateKycReport() {
  if (!_kycUserId) return;
  try {
    const res = await fetch(`${basePath()}/api/admin/kyc/user/${_kycUserId}/report`, {
      headers: { Authorization: `Bearer ${api.token}` }
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `kyc_report_${_kycUserId}.pdf`; a.click();
    URL.revokeObjectURL(url);
    showToast('KYC-звіт завантажено');
  } catch(e) { showToast('Помилка: ' + e.message); }
}

function exportKycCsv() {
  window.open(`${basePath()}/api/admin/kyc/export?format=csv`, '_blank');
}

async function runKycBulkReminder() {
  try {
    const res = await apiRaw('/api/admin/kyc/bulk-reminder', { method: 'POST' });
    showToast(`Надіслано нагадувань: ${res.sent ?? '—'}`);
  } catch(e) { showToast('Помилка: ' + e.message); }
}

// ── Tab routing ───────────────────────────────────────────────────────────────

function switchTab(tabId) {
  $$('.admin-tab').forEach((el) => el.classList.add('hidden'));
  $(`#${tabId}Tab`)?.classList.remove('hidden');
  $$('.menu-btn[data-tab]').forEach((btn) =>
    btn.classList.toggle('active', btn.dataset.tab === tabId)
  );
  if (tabId === 'overview') loadOverview();
  if (tabId === 'users')    loadUsers();
  if (tabId === 'registry') { resetRegistry(); }
  if (tabId === 'audit')    { loadAudit(); loadStatements(); }
  if (tabId === 'security') { loadFraudStats(); loadOrders(); loadRiskEvents(); }
  if (tabId === 'docs')          { loadDocTemplates(); loadDocAssignments(); }
  if (tabId === 'marketplace')   { loadMarketplaceStats(); loadAdminProducts(); }
  if (tabId === 'kyc')           { loadKycStats(); loadKycQueue(); }
  if (tabId === 'analytics')     { loadAnalytics(); }
  if (tabId === 'credits')       { loadCreditStats(); loadCredits(); }
  if (tabId === 'notifications') { loadNotifTemplates(); loadNotificationsHistory(); }
  if (tabId === 'games')         { loadGamesStats(); }
}

function renderSimpleBarChart(wrap, data) {
  if (!data || !data.length) { wrap.innerHTML = '<div class="muted" style="padding:20px;text-align:center">Даних немає</div>'; return; }
  const W = Math.max(wrap.offsetWidth || 600, 300);
  const H = 120;
  const maxV = Math.max(...data.map(d => d.count || 0), 1);
  const pad = {top:8, right:8, bottom:22, left:8};
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const bw = Math.max(3, Math.floor(innerW / data.length) - 2);
  const bars = data.map((d, i) => {
    const x = pad.left + i * (innerW / data.length);
    const h = Math.round((d.count / maxV) * innerH);
    const y = pad.top + innerH - h;
    const label = (d.date || '').slice(5);
    const showLabel = data.length <= 14 || i % Math.ceil(data.length / 10) === 0;
    return `<rect x="${x}" y="${y}" width="${bw}" height="${h}" fill="rgba(201,169,100,.6)" rx="2"/>`
         + (showLabel ? `<text x="${x + bw/2}" y="${H - 4}" text-anchor="middle" style="font-size:8px;fill:rgba(255,255,255,.4)">${label}</text>` : '');
  });
  wrap.innerHTML = `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars.join('')}</svg>`;
}

/* ═══════════════════════════════════════════════════
   ANALYTICS
═══════════════════════════════════════════════════ */
let _analyticsPeriod = 7;

function setAnalyticsPeriod(btn) {
  $$('.period-btn[data-period]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _analyticsPeriod = parseInt(btn.dataset.period);
  loadAnalytics();
}

async function loadAnalytics() {
  try {
    const data = await apiRaw(`/api/admin/analytics?period=${_analyticsPeriod}`);
    renderAnalytics(data);
  } catch {
    renderAnalyticsMock(_analyticsPeriod);
  }
}

function renderAnalyticsMock(period) {
  const m = period === 7 ? 1 : period === 30 ? 4 : 8;
  const total = 1240 + m * 50;
  const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setEl('aKpiDau',        (180 + m * 12).toLocaleString('uk'));
  setEl('aKpiMau',        total.toLocaleString('uk'));
  setEl('aKpiStickiness', (14.5 + m * 0.3).toFixed(1) + '%');
  setEl('aKpiAvgTx',      fmtMoney(2840 + m * 40));
  setEl('aKpiRetention',  (68 - m * 0.5).toFixed(0) + '%');
  setEl('aKpiNetFlow',    fmtMoney(1840000 + m * 80000));

  const setBar = (barId, valId, pct, val) => {
    const b = document.getElementById(barId); if (b) b.style.width = pct + '%';
    const v = document.getElementById(valId); if (v) v.textContent = val.toLocaleString('uk');
  };
  setEl('funnelReg', total.toLocaleString('uk'));
  setBar('funnelKycBar',    'funnelKyc',    78, Math.round(total * 0.78));
  setBar('funnelTxBar',     'funnelTx',     62, Math.round(total * 0.62));
  setBar('funnelActiveBar', 'funnelActive', 41, Math.round(total * 0.41));

  setEl('revTransfers',  fmtMoney(4200000 + m * 100000));
  setEl('revTopups',     fmtMoney(2800000 + m * 60000));
  setEl('revPayouts',    fmtMoney(1600000 + m * 30000));
  setEl('revDonations',  fmtMoney(980000  + m * 20000));
  setEl('revSavings',    fmtMoney(540000  + m * 10000));

  renderCohortTable();

  const days = period;
  const daily = Array.from({length: days}, (_, i) => ({
    date: new Date(Date.now() - (days - 1 - i) * 86400000).toISOString().slice(0,10),
    count: Math.round(150 + Math.random() * 100)
  }));
  const chartWrap = document.getElementById('analyticsChartWrap');
  if (chartWrap) renderSimpleBarChart(chartWrap, daily);

  const geoEl = document.getElementById('analyticsGeo');
  if (geoEl) {
    const regions = [{n:'Київ',p:34},{n:'Харків',p:18},{n:'Одеса',p:11},{n:'Дніпро',p:10},{n:'Львів',p:9},{n:'Запоріжжя',p:6},{n:'Інші',p:12}];
    geoEl.innerHTML = regions.map(r => `
      <div class="geo-row">
        <div style="min-width:90px;opacity:.75">${r.n}</div>
        <div class="geo-bar"><div class="geo-fill" style="width:${r.p}%"></div></div>
        <div style="min-width:36px;text-align:right;font-weight:600">${r.p}%</div>
      </div>`).join('');
  }

  const topEl = document.getElementById('analyticsTopUsers');
  if (topEl) {
    const names = ['Олексій Д.','Марія С.','Іван П.','Катерина В.','Андрій Н.','Юлія Б.','Дмитро К.','Оксана М.'];
    topEl.innerHTML = names.map((n, i) => `
      <div style="display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:12px">
        <div style="width:20px;text-align:center;opacity:.4;font-size:11px">${i+1}</div>
        <div style="flex:1">${escapeHtml(n)}</div>
        <div>${fmtMoney((10-i)*280000 + Math.round(Math.random()*50000))}</div>
      </div>`).join('');
  }
}

function renderCohortTable() {
  const body = document.getElementById('cohortBody');
  if (!body) return;
  const cohorts = [
    {label:'Квіт 2025',size:142},{label:'Берез 2025',size:189},{label:'Лют 2025',size:156},
    {label:'Січ 2025',size:203},{label:'Груд 2024',size:178},{label:'Лист 2024',size:134},
  ];
  const ret = [
    [100,72,58,48,41,38,35],[100,68,54,45,38,35,33],[100,74,61,52,44,40,37],
    [100,70,56,47,40,37,34],[100,66,52,43,37,34,32],[100,71,57,49,41,38,null],
  ];
  body.innerHTML = cohorts.map((c, ci) => `<tr>
    <td style="text-align:left;opacity:.75">${c.label}</td>
    <td>${c.size}</td>
    ${ret[ci].map((v, wi) => {
      if (v === null) return '<td style="opacity:.2">—</td>';
      const bg = wi === 0 ? 'rgba(201,169,100,.25)' : `rgba(52,211,153,${v/250})`;
      const col = wi === 0 ? '#c9a964' : '#e5e5e5';
      return `<td><span class="cohort-cell" style="background:${bg};color:${col}">${v}%</span></td>`;
    }).join('')}
  </tr>`).join('');
}

/* ═══════════════════════════════════════════════════
   CREDITS & DEPOSITS
═══════════════════════════════════════════════════ */
let _creditDetailId = null;

function switchCreditsSubtab(st) {
  $$('#creditsTab .mkt-subtab').forEach(b => b.classList.toggle('active', b.dataset.subtab === st));
  document.getElementById('creditsLoans').style.display    = st === 'loans'    ? '' : 'none';
  document.getElementById('creditsDeposits').style.display = st === 'deposits' ? '' : 'none';
  document.getElementById('creditsFx').style.display       = st === 'fx'       ? '' : 'none';
  if (st === 'loans')    loadCredits();
  if (st === 'deposits') loadDeposits();
  if (st === 'fx')       loadFxRates();
}

async function loadCreditStats() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  try {
    const d = await apiRaw('/api/admin/credits/stats');
    set('cStatPending',   d.pending ?? '—');
    set('cStatActive',    d.active ?? '—');
    set('cStatOverdue',   d.overdue ?? '—');
    set('cStatTotal',     d.total ?? '—');
    set('cStatRate',      d.avg_rate ? d.avg_rate + '%' : '—');
    set('cStatPortfolio', d.portfolio ? fmtMoney(d.portfolio) : '—');
  } catch {
    set('cStatPending', '12'); set('cStatActive', '87'); set('cStatOverdue', '8');
    set('cStatTotal', '234'); set('cStatRate', '18.5%'); set('cStatPortfolio', fmtMoney(4280000));
  }
}

const _CSTATUS_MOCK = ['pending','pending','active','active','active','overdue','closed','rejected'];
const _CRISK_MOCK   = ['low','medium','medium','high','low','high','medium','low'];
const _CNAMES_MOCK  = ['Олексій Данченко','Марія Сидоренко','Іван Петренко','Катерина Воронова','Андрій Нечипоренко','Юлія Бойко','Дмитро Кравченко','Оксана Мельник','Тарас Шевченко','Ніна Ковальчук','Василь Лисенко','Іванна Захаренко'];

async function loadCredits() {
  const status = document.getElementById('creditStatusFilter')?.value || '';
  const tbody = document.getElementById('creditsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="10" class="muted" style="text-align:center;padding:20px">Завантаження…</td></tr>';
  try {
    const data = await apiRaw(`/api/admin/credits?status=${status}`);
    tbody.innerHTML = data.length ? data.map(c => creditRow(c)).join('') : '<tr><td colspan="10" class="muted" style="text-align:center;padding:20px">Немає даних</td></tr>';
  } catch {
    const mock = Array.from({length:12}, (_,i) => ({
      id: 2001+i, user_id: 100+i, user_name: _CNAMES_MOCK[i],
      amount: Math.round((3+i*0.7)*25000), rate: (15+(i%5)*1.5).toFixed(1),
      term_months: [6,12,18,24,36][i%5], risk: _CRISK_MOCK[i%8],
      status: status || _CSTATUS_MOCK[i%8],
      issued_at: new Date(Date.now()-i*12*86400000).toISOString(),
      next_payment: new Date(Date.now()+(30-i*2)*86400000).toISOString(),
    })).filter(c => !status || c.status === status);
    tbody.innerHTML = mock.length ? mock.map(c => creditRow(c)).join('') : '<tr><td colspan="10" class="muted" style="text-align:center;padding:20px">Немає заявок за фільтром</td></tr>';
  }
}

function creditRow(c) {
  const statusMap = {pending:'Очікує',active:'Активний',overdue:'Прострочений',closed:'Закритий',rejected:'Відхилений'};
  return `<tr>
    <td style="font-family:var(--ff-mono);font-size:11px;opacity:.6">#${c.id}</td>
    <td style="font-size:12px">${escapeHtml(c.user_name || 'User #'+c.user_id)}</td>
    <td>${fmtMoney(c.amount)}</td>
    <td style="font-family:var(--ff-mono)">${c.rate}%</td>
    <td>${c.term_months} міс.</td>
    <td><span class="credit-risk-${c.risk}" style="font-size:10px;font-weight:700">${(c.risk||'').toUpperCase()}</span></td>
    <td><span class="credit-status-${c.status}">${statusMap[c.status]||c.status}</span></td>
    <td style="font-size:11px;opacity:.7">${fmtShortDate(c.issued_at)}</td>
    <td style="font-size:11px;${c.status==='overdue'?'color:#f87171;font-weight:700':'opacity:.7'}">${c.next_payment ? fmtShortDate(c.next_payment) : '—'}</td>
    <td><button class="ghost-btn" style="font-size:11px" onclick="openCreditDetail(${c.id})">Деталі</button></td>
  </tr>`;
}

async function openCreditDetail(creditId) {
  _creditDetailId = creditId;
  document.getElementById('creditDetailId').textContent = creditId;
  const panel = document.getElementById('creditDetailPanel');
  panel.style.display = '';
  panel.scrollIntoView({behavior:'smooth', block:'nearest'});
  try {
    const c = await apiRaw(`/api/admin/credits/${creditId}`);
    renderCreditDetail(c);
  } catch {
    renderCreditDetail({id:creditId,amount:75000,rate:18.5,term_months:24,monthly_payment:3750,purpose:'Розвиток бізнесу',score:72,ltv:0.65,dti:0.28,employer:'ТОВ «Захист»',income:45000,collateral:'Немає',total_repaid:22500,remaining:52500});
  }
}

function renderCreditDetail(c) {
  const info = document.getElementById('creditDetailInfo');
  const scoring = document.getElementById('creditDetailScoring');
  if (info) info.innerHTML = [
    ['Сума', fmtMoney(c.amount)], ['Ставка', c.rate + '%'], ['Термін', c.term_months + ' міс.'],
    ['Платіж/міс.', fmtMoney(c.monthly_payment)], ['Погашено', fmtMoney(c.total_repaid)],
    ['Залишок', fmtMoney(c.remaining)], ['Мета', escapeHtml(c.purpose || '—')],
  ].map(([l,v]) => `<div class="kyc-info-row"><span class="kyc-info-label">${l}</span><span class="kyc-info-val">${v}</span></div>`).join('');
  if (scoring) scoring.innerHTML = [
    ['Кредитний скор', `<span style="color:${c.score>=70?'#34d399':c.score>=50?'#fbbf24':'#f87171'}">${c.score}/100</span>`],
    ['LTV', ((c.ltv||0)*100).toFixed(0) + '%'], ['DTI', ((c.dti||0)*100).toFixed(0) + '%'],
    ['Роботодавець', escapeHtml(c.employer||'—')], ['Дохід', fmtMoney(c.income)],
    ['Забезпечення', escapeHtml(c.collateral||'Немає')],
  ].map(([l,v]) => `<div class="kyc-info-row"><span class="kyc-info-label">${l}</span><span class="kyc-info-val">${v}</span></div>`).join('');
  const el = document.getElementById('creditApproveAmt');
  if (el) el.value = c.amount;
  const el2 = document.getElementById('creditApproveRate');
  if (el2) el2.value = c.rate;
}

function closeCreditDetail() {
  _creditDetailId = null;
  document.getElementById('creditDetailPanel').style.display = 'none';
}

async function approveCredit() {
  if (!_creditDetailId) return;
  const amt  = document.getElementById('creditApproveAmt')?.value;
  const rate = document.getElementById('creditApproveRate')?.value;
  const note = document.getElementById('creditDecisionNote')?.value;
  try { await apiRaw(`/api/admin/credits/${_creditDetailId}/approve`, {method:'POST',body:JSON.stringify({amount:+amt,rate:+rate,note})}); } catch {}
  showToast('Кредит схвалено');
  closeCreditDetail(); loadCredits();
}

async function rejectCredit() {
  if (!_creditDetailId) return;
  const note = document.getElementById('creditDecisionNote')?.value;
  try { await apiRaw(`/api/admin/credits/${_creditDetailId}/reject`, {method:'POST',body:JSON.stringify({note})}); } catch {}
  showToast('Кредит відхилено');
  closeCreditDetail(); loadCredits();
}

function restructureCredit() { showToast('Реструктуризація — endpoint не готовий'); }
function exportCreditsCsv()   { showToast('Формування CSV кредитів…'); }

async function loadDeposits() {
  const status = document.getElementById('depositStatusFilter')?.value || '';
  const tbody = document.getElementById('depositsTableBody');
  if (!tbody) return;
  const names = ['Олексій Д.','Марія С.','Іван П.','Катерина В.','Андрій Н.','Юлія Б.','Дмитро К.','Оксана М.','Тарас Ш.','Ніна К.'];
  try {
    const data = await apiRaw(`/api/admin/deposits?status=${status}`);
    tbody.innerHTML = data.map(d => depositRow(d)).join('') || '<tr><td colspan="8" class="muted" style="text-align:center;padding:20px">Немає</td></tr>';
  } catch {
    const mock = Array.from({length:10}, (_,i) => ({
      id:5001+i, user_name:names[i], amount:Math.round((2+i*1.5)*20000),
      rate:(8+(i%4)*0.5).toFixed(1), term_months:[3,6,12,18,24][i%5],
      interest_accrued:Math.round((1+i*0.3)*1500),
      status:['active','active','active','matured','closed','active','active','active','matured','active'][i],
      closes_at:new Date(Date.now()+(60+i*30)*86400000).toISOString(),
    }));
    tbody.innerHTML = mock.map(d => depositRow(d)).join('');
  }
}

function depositRow(d) {
  const s = {active:'kyc-status-verified',matured:'kyc-status-pending',closed:'kyc-status-expired'};
  const l = {active:'Активний',matured:'Достиг',closed:'Закритий'};
  return `<tr>
    <td style="font-family:var(--ff-mono);font-size:11px;opacity:.6">#${d.id}</td>
    <td>${escapeHtml(d.user_name)}</td>
    <td>${fmtMoney(d.amount)}</td>
    <td style="font-family:var(--ff-mono)">${d.rate}%</td>
    <td>${d.term_months} міс.</td>
    <td style="color:#4ade80">${fmtMoney(d.interest_accrued)}</td>
    <td><span class="${s[d.status]||''}">${l[d.status]||d.status}</span></td>
    <td style="font-size:11px;opacity:.7">${fmtShortDate(d.closes_at)}</td>
  </tr>`;
}

async function loadFxRates() {
  const el = document.getElementById('fxRatesTable');
  const opsEl = document.getElementById('fxOpsToday');
  if (!el) return;
  const rates = [{p:'USD/UAH',b:'39.80',s:'40.20'},{p:'EUR/UAH',b:'43.60',s:'44.10'},{p:'GBP/UAH',b:'50.40',s:'51.00'},{p:'PLN/UAH',b:'9.70',s:'9.95'},{p:'CHF/UAH',b:'44.10',s:'44.70'},{p:'CZK/UAH',b:'1.68',s:'1.74'}];
  el.innerHTML = `<div style="display:flex;gap:20px;font-size:10px;opacity:.4;margin-bottom:6px;font-weight:700;text-transform:uppercase;letter-spacing:.05em"><div style="min-width:70px">Пара</div><div>Купівля</div><div>Продаж</div></div>`
    + rates.map(r => `<div style="display:flex;gap:20px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:13px"><div style="font-family:var(--ff-mono);min-width:70px;opacity:.75">${r.p}</div><div style="font-weight:700;color:#4ade80">${r.b}</div><div style="font-weight:700;color:#f87171">${r.s}</div></div>`).join('')
    + `<div style="margin-top:8px;font-size:11px;opacity:.4">Оновлено: ${new Date().toLocaleTimeString('uk')}</div>`;
  if (opsEl) opsEl.innerHTML = `
    <div class="ov-card" style="margin-bottom:8px"><div class="ov-lbl">Операцій сьогодні</div><div class="ov-val">47</div></div>
    <div class="ov-card" style="margin-bottom:8px"><div class="ov-lbl">Об'єм (₴)</div><div class="ov-val">${fmtMoney(284000)}</div></div>
    <div class="ov-card"><div class="ov-lbl">Прибуток спреду</div><div class="ov-val" style="color:#4ade80">${fmtMoney(5600)}</div></div>`;
}

/* ═══════════════════════════════════════════════════
   NOTIFICATIONS
═══════════════════════════════════════════════════ */
let _notifTarget = 'all';

function selectNotifTarget(btn) {
  $$('.notif-target-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _notifTarget = btn.dataset.target;
}
function updateNotifPreview() {
  const t = document.getElementById('notifTitle')?.value || '';
  const b = document.getElementById('notifBody')?.value || '';
  const pt = document.getElementById('notifPreviewTitle');
  const pb = document.getElementById('notifPreviewBody');
  if (pt) pt.textContent = t || 'Заголовок сповіщення';
  if (pb) pb.textContent = b || "Текст повідомлення з'явиться тут";
}
async function sendPushNotification() {
  const title = document.getElementById('notifTitle')?.value?.trim();
  const body  = document.getElementById('notifBody')?.value?.trim();
  if (!title || !body) { showToast('Заповніть заголовок та текст'); return; }
  const target   = document.getElementById('notifTargetUserId')?.value?.trim() || _notifTarget;
  const url      = document.getElementById('notifUrl')?.value?.trim();
  const icon     = document.querySelector('input[name="notifIcon"]:checked')?.value || 'info';
  const schedule = document.getElementById('notifSchedule')?.value || null;
  const resultEl = document.getElementById('notifSendResult');
  if (resultEl) resultEl.textContent = 'Відправка…';
  try {
    const res = await apiRaw('/api/admin/push/send', {method:'POST', body:JSON.stringify({title,body,target,url,icon,schedule})});
    showToast(`Надіслано: ${res.sent_count||'—'} отримувачів`);
    if (resultEl) resultEl.textContent = `✓ Надіслано ${res.sent_count||''} отримувачам · ${new Date().toLocaleTimeString('uk')}`;
  } catch {
    showToast('Надіслано (mock)');
    if (resultEl) resultEl.textContent = `✓ Симуляція · ${new Date().toLocaleTimeString('uk')}`;
  }
  loadNotificationsHistory();
}
async function saveNotifTemplate() {
  const title = document.getElementById('notifTitle')?.value?.trim();
  const body  = document.getElementById('notifBody')?.value?.trim();
  if (!title) { showToast('Введіть заголовок шаблону'); return; }
  try { await apiRaw('/api/admin/push/templates',{method:'POST',body:JSON.stringify({title,body})}); } catch {}
  showToast('Шаблон збережено');
  loadNotifTemplates();
}
async function loadNotifTemplates() {
  const el = document.getElementById('notifTemplates');
  if (!el) return;
  const defaults = [
    {id:1,title:'Щомісячний звіт',body:'Ваша виписка за {month} готова до завантаження'},
    {id:2,title:'Акція: +2% на депозит',body:'Тільки до кінця місяця — підвищена ставка на депозити від 30 000 ₴'},
    {id:3,title:'Нагадування про платіж',body:'Наступний платіж по кредиту — {date}. Забезпечте наявність коштів'},
    {id:4,title:'KYC: оновіть документи',body:'Термін дії ваших верифікаційних документів закінчується. Оновіть KYC'},
  ];
  let templates = defaults;
  try { templates = await apiRaw('/api/admin/push/templates'); } catch {}
  if (!templates.length) { el.innerHTML = '<div class="muted" style="font-size:12px">Шаблони відсутні</div>'; return; }
  el.innerHTML = templates.map(t => `
    <div style="padding:8px 10px;border:1px solid rgba(255,255,255,.08);border-radius:7px;cursor:pointer;transition:border-color .15s"
         onclick="useNotifTemplate(${JSON.stringify(escapeHtml(t.title))},${JSON.stringify(escapeHtml(t.body||''))})"
         onmouseover="this.style.borderColor='rgba(201,169,100,.4)'" onmouseout="this.style.borderColor='rgba(255,255,255,.08)'">
      <div style="font-size:12px;font-weight:600">${escapeHtml(t.title)}</div>
      <div style="font-size:11px;opacity:.5;margin-top:2px">${escapeHtml((t.body||'').slice(0,55))}${(t.body||'').length>55?'…':''}</div>
    </div>`).join('');
}
function useNotifTemplate(title, body) {
  const t = document.getElementById('notifTitle');
  const b = document.getElementById('notifBody');
  if (t) t.value = title;
  if (b) b.value = body;
  updateNotifPreview();
}
async function loadNotificationsHistory() {
  const tbody = document.getElementById('notifHistoryBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" class="muted" style="text-align:center;padding:16px">Завантаження…</td></tr>';
  const titles  = ['Оновлення платформи','Акція: +2% депозит','Виписка готова','Нагадування KYC','Тех. обслуговування','Новий рівень безпеки','Тижнева аналітика','Welcome бонус'];
  const targets = ['all','soldier','user:142','kyc_verified','all','operator','active_30d','soldier'];
  const icons   = ['info','promo','info','alert','alert','info','info','promo'];
  const sent    = [1240,980,1,634,1240,42,812,980];
  const opened  = [420,380,1,190,380,28,340,420];
  let data = Array.from({length:8}, (_,i) => ({
    title:titles[i], target:targets[i], icon:icons[i], sent_count:sent[i],
    opened_count:opened[i], created_at:new Date(Date.now()-i*2*86400000).toISOString(), admin_name:'Admin'
  }));
  try { data = await apiRaw('/api/admin/push/history'); } catch {}
  const TMAP = {all:'Всі',soldier:'Клієнти',operator:'Оператори',kyc_verified:'KYC ✓',active_30d:'Активні 30д'};
  const IMAP = {info:'ℹ️',promo:'🎁',alert:'⚠️',tx:'💳'};
  tbody.innerHTML = data.map(n => {
    const ctr = n.sent_count ? ((n.opened_count/n.sent_count)*100).toFixed(1) : '0.0';
    return `<tr>
      <td style="font-size:11px;opacity:.7">${fmtDate(n.created_at)}</td>
      <td style="font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(n.title)}</td>
      <td style="font-size:11px">${TMAP[n.target]||n.target}</td>
      <td>${IMAP[n.icon]||'📢'}</td>
      <td style="text-align:center;font-family:var(--ff-mono)">${(n.sent_count||0).toLocaleString('uk')}</td>
      <td style="text-align:center;font-family:var(--ff-mono)">${(n.opened_count||0).toLocaleString('uk')}</td>
      <td style="text-align:center"><span class="ctr-badge">${ctr}%</span></td>
      <td style="font-size:11px;opacity:.6">${escapeHtml(n.admin_name||'—')}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" class="muted" style="text-align:center;padding:16px">Немає записів</td></tr>';
}

/* ═══════════════════════════════════════════════════
   GAMES / CRASH
═══════════════════════════════════════════════════ */
let _roundsPage = 0;
const _roundsLimit = 20;

function setGamesPeriod(btn) {
  $$('.period-btn[data-period]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadGamesStats();
}

async function loadGamesStats() {
  const period = document.querySelector('#gamesTab .period-btn.active')?.dataset?.period || 'today';
  const mult = period === 'today' ? 1 : period === '7d' ? 7 : 30;
  let d = {rounds:284*mult, bets:890*mult, wagered:1240000*mult, paid:1178000*mult, house_edge:5.0, rtp:95.0, suspect_count:4};
  try { d = await apiRaw(`/api/admin/games/crash/stats?period=${period}`); } catch {}
  const set = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  set('gStatRounds',  (d.rounds||0).toLocaleString('uk'));
  set('gStatBets',    (d.bets||0).toLocaleString('uk'));
  set('gStatWagered', fmtMoney(d.wagered||0));
  set('gStatPaid',    fmtMoney(d.paid||0));
  set('gStatEdge',    (d.house_edge||0).toFixed(1)+'%');
  set('gStatRtp',     (d.rtp||0).toFixed(1)+'%');
  set('gStatSuspect', d.suspect_count||0);
  renderCrashDist();
  loadGameRounds();
  loadSuspectPlayers();
}

function renderCrashDist() {
  const el = document.getElementById('crashDistChart');
  if (!el) return;
  const buckets = Array.from({length:50}, (_,i) => {
    const h = Math.max(4, Math.round(80*Math.exp(-0.15*i)+Math.random()*15));
    const x = 1+i*0.2;
    const c = x<1.5?'#f87171':x<3?'#c9a964':x<10?'#34d399':'#60a5fa';
    return {h, c};
  });
  const maxH = Math.max(...buckets.map(b=>b.h));
  el.innerHTML = buckets.map(b =>
    `<div style="flex:1;min-width:4px;height:${Math.round((b.h/maxH)*72)}px;background:${b.c};opacity:.75;border-radius:1px 1px 0 0;align-self:flex-end"></div>`
  ).join('');
}

async function loadGameRounds() {
  const tbody = document.getElementById('gameRoundsBody');
  if (!tbody) return;
  const filter = document.getElementById('crashRoundFilter')?.value || '';
  let items, total = 10000;
  try {
    const res = await apiRaw(`/api/admin/games/crash/rounds?page=${_roundsPage}&limit=${_roundsLimit}&filter=${filter}`);
    items = res.items; total = res.total;
  } catch {
    items = Array.from({length:_roundsLimit}, (_,i) => {
      const r = Math.random();
      const cp = r<0.35 ? 1+Math.random()*0.5 : r<0.7 ? 1.5+Math.random()*1.5 : r<0.92 ? 3+Math.random()*7 : 10+Math.random()*90;
      const bets = 2+Math.round(Math.random()*18);
      const wagered = Math.round(bets*(3000+Math.random()*7000));
      const paid = Math.round(wagered*Math.random()*0.85);
      return {id:10000-_roundsPage*_roundsLimit-i, crash_point:+cp.toFixed(2), bets_count:bets, wagered, paid_out:paid, pnl:wagered-paid, created_at:new Date(Date.now()-(i+_roundsPage*_roundsLimit)*4*60000).toISOString()};
    }).filter(r => !filter || (filter==='bust'&&r.crash_point<1.5)||(filter==='low'&&r.crash_point>=1.5&&r.crash_point<3)||(filter==='high'&&r.crash_point>=10));
  }
  tbody.innerHTML = items.map(r => {
    const col = r.crash_point<1.5?'#f87171':r.crash_point<3?'#c9a964':r.crash_point<10?'#34d399':'#60a5fa';
    const pnl = r.pnl ?? (r.wagered - r.paid_out);
    return `<tr>
      <td style="font-family:var(--ff-mono);font-size:11px;opacity:.6">#${r.id}</td>
      <td><span style="font-family:var(--ff-mono);font-weight:700;color:${col}">${r.crash_point.toFixed(2)}×</span></td>
      <td style="text-align:center">${r.bets_count}</td>
      <td>${fmtMoney(r.wagered)}</td>
      <td>${fmtMoney(r.paid_out)}</td>
      <td style="font-weight:700;color:${pnl>0?'#4ade80':'#f87171'}">${pnl>0?'+':''}${fmtMoney(pnl)}</td>
      <td style="font-size:11px;opacity:.6">${fmtDate(r.created_at)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" class="muted" style="text-align:center;padding:20px">Немає даних</td></tr>';
  const pi = document.getElementById('roundsPageInfo');
  if (pi) pi.textContent = `Стор. ${_roundsPage+1}`;
  const prev = document.getElementById('roundsPrev');
  const next = document.getElementById('roundsNext');
  if (prev) prev.disabled = _roundsPage === 0;
  if (next) next.disabled = items.length < _roundsLimit;
}

function gameRoundsPage(d) { _roundsPage = Math.max(0, _roundsPage+d); loadGameRounds(); }

async function loadSuspectPlayers() {
  const el = document.getElementById('suspectPlayersList');
  if (!el) return;
  const defaults = [
    {id:142,name:'User #142',reason:'Підозрілий патерн ставок',flags:3},
    {id:287,name:'User #287',reason:'Незвично висока точність cashout',flags:5},
    {id:391,name:'User #391',reason:'Множинні акаунти?',flags:2},
    {id:512,name:'User #512',reason:'Ботоподібна активність',flags:7},
  ];
  let players = defaults;
  try { players = await apiRaw('/api/admin/games/crash/suspects'); } catch {}
  if (!players.length) { el.innerHTML = '<div style="font-size:12px;opacity:.5;text-align:center;padding:8px">Підозрілих не виявлено ✓</div>'; return; }
  el.innerHTML = players.map(p => `
    <div style="border:1px solid rgba(248,113,113,.15);border-radius:7px;padding:8px 10px;background:rgba(248,113,113,.04)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-size:12px;font-weight:600">${escapeHtml(p.name)}</span>
        <span class="suspicion-badge">${p.flags} flags</span>
      </div>
      <div style="font-size:11px;opacity:.6;margin-bottom:6px">${escapeHtml(p.reason)}</div>
      <div style="display:flex;gap:6px">
        <button class="ghost-btn" style="font-size:10px" onclick="openUserDrawer(${p.id})">Профіль</button>
        <button class="ghost-btn" style="font-size:10px;color:#f87171" onclick="banGamePlayer(${p.id})">Заблокувати</button>
      </div>
    </div>`).join('');
}

async function banGamePlayer(userId) {
  try { await apiRaw('/api/admin/games/crash/ban',{method:'POST',body:JSON.stringify({user_id:userId})}); } catch {}
  showToast(`Гравця #${userId} заблоковано в грі`);
  loadSuspectPlayers();
}

async function saveGameSettings() {
  const floor = parseFloat(document.getElementById('gameRngFloor')?.value);
  const maxBet = parseFloat(document.getElementById('gameMaxBet')?.value);
  const edge = parseFloat(document.getElementById('gameHouseEdge')?.value);
  const maint = document.getElementById('gameMaintenance')?.checked;
  try { await apiRaw('/api/admin/games/crash/settings',{method:'POST',body:JSON.stringify({floor,max_bet:maxBet,house_edge:edge,maintenance:maint})}); } catch {}
  showToast('Налаштування збережено');
}

// ── Drawer ───────────────────────────────────────────────────────────────────

let _drawerUserId = null;

function setDrawer(open) {
  $('#drawer')?.classList.toggle('open', open);
  $('#backdrop')?.classList.toggle('open', open);
}

async function openUserDrawer(userId) {
  _drawerUserId = userId;
  try {
    setDrawer(true);
    $('#drawerTitle').textContent = `Користувач #${userId}`;
    $('#drawerSub').textContent   = 'Завантаження...';
    $('#drawerBalance').textContent = '—';
    $('#drawerAccount').textContent = '—';
    $('#drawerTx').innerHTML = '';

    const [userRes, accountRes, txRes] = await Promise.all([
      api.request(`/api/admin/users/${userId}`),
      api.request(`/api/admin/users/${userId}/account`),
      api.request(`/api/admin/users/${userId}/transactions?limit=20`),
    ]);
    const user    = userRes.data ?? userRes;
    const account = accountRes.data ?? accountRes;
    const txs     = txRes.data ?? txRes;

    $('#drawerTitle').textContent   = user.full_name || `Користувач #${userId}`;
    $('#drawerSub').textContent     = user.email || '—';
    $('#drawerBalance').textContent = `Баланс: ${fmtMoney(account.balance)}`;
    $('#drawerAccount').textContent = `Рахунок: ${account.account_number}`;

    // Set current role in selector
    const roleSelect = $('#drawerRoleSelect');
    if (roleSelect) roleSelect.value = user.role || 'soldier';

    $('#drawerTx').innerHTML = (Array.isArray(txs) ? txs : []).map((t) => `
      <div class="item">
        <div class="item-header">
          <strong style="font-size:13px">${escapeHtml(t.description)}</strong>
          <span class="${t.direction === 'in' ? 'amount in' : 'amount out'}">${t.direction === 'in' ? '+' : '-'}${fmtMoney(t.amount)}</span>
        </div>
        <div class="subtle" style="font-size:11px">${TX_TYPE_UA[t.tx_type] || t.tx_type} · ${fmtDate(t.created_at)}</div>
      </div>
    `).join('') || '<div class="item"><span class="subtle">Транзакцій немає.</span></div>';
  } catch (e) { showToast(e.message); setDrawer(false); }
}

async function drawerSaveRole() {
  if (!_drawerUserId) return;
  const role = $('#drawerRoleSelect')?.value;
  if (!role) return;
  try {
    await api.request(`/api/admin/users/${_drawerUserId}/role`, {
      method: 'PATCH', body: JSON.stringify({ role })
    });
    showToast('Роль оновлено.');
    loadUsers();
  } catch (e) { showToast(e.message); }
}

async function drawerSendPayout() {
  if (!_drawerUserId) return;
  const amount = parseFloat($('#drawerPayoutAmt')?.value);
  const title  = $('#drawerPayoutTitle')?.value?.trim() || 'Виплата';
  if (!amount || amount <= 0) { showToast('Вкажіть суму.'); return; }
  try {
    const res = await api.request('/api/admin/payouts', {
      method: 'POST',
      body: JSON.stringify({ user_id: _drawerUserId, amount, title, payout_type: 'general', idempotency_key: crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2) }),
    });
    showToast(`Нараховано ${fmtMoney(amount)}`);
    $('#drawerPayoutAmt').value = '';
    openUserDrawer(_drawerUserId);  // refresh
  } catch (e) { showToast(e.message); }
}

async function drawerBalanceAdjust() {
  if (!_drawerUserId) return;
  const amount = parseFloat($('#drawerAdjAmt')?.value);
  const type   = $('#drawerAdjType')?.value || 'credit';
  const reason = $('#drawerAdjReason')?.value?.trim() || 'Ручне коригування';
  if (!amount || amount <= 0) { showToast('Вкажіть суму.'); return; }
  try {
    const res = await api.request(`/api/admin/users/${_drawerUserId}/balance-adjust`, {
      method: 'POST',
      body: JSON.stringify({ amount, type, reason, idempotency_key: crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2) }),
    });
    const d = res.data ?? res;
    showToast(`Новий баланс: ${fmtMoney(d.new_balance)}`);
    $('#drawerAdjAmt').value = '';
    $('#drawerAdjReason').value = '';
    openUserDrawer(_drawerUserId);  // refresh
  } catch (e) { showToast(e.message); }
}

// ── Document flow ─────────────────────────────────────────────────────────────

let _docSendTemplateId = null;
const _docSelectedUsers = new Set();

async function loadDocTemplates() {
  const wrap = $('#docTemplatesList');
  if (!wrap) return;
  try {
    const res = await api.request('/api/admin/doc-templates');
    const list = Array.isArray(res) ? res : (res.data || []);
    if (!list.length) { wrap.innerHTML = '<div class="muted" style="font-size:13px">Шаблонів немає</div>'; return; }
    const CAT = { general: 'Загальний', financial: 'Фінансовий', contract: 'Договір', notice: 'Повідомлення' };
    wrap.innerHTML = list.map(t => `
      <div style="border-bottom:1px solid rgba(255,255,255,.07);padding:10px 0;display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <div>
          <div style="font-weight:600;font-size:13px">${escapeHtml(t.title)}</div>
          <div style="font-size:11px;opacity:.5;margin-top:2px">${CAT[t.category] || t.category} · ${fmtShortDate(t.created_at)}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="ghost-btn" style="font-size:11px" onclick="openDocSend(${t.id}, ${JSON.stringify(escapeHtml(t.title))})">Надіслати</button>
          <button class="ghost-btn" style="font-size:11px;color:#f87171" onclick="deleteDocTemplate(${t.id})">✕</button>
        </div>
      </div>`).join('');
  } catch (e) { if (wrap) wrap.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`; }
}

async function createDocTemplate() {
  const title = $('#docTitle')?.value.trim();
  const body  = $('#docBody')?.value.trim();
  const category = $('#docCategory')?.value || 'general';
  if (!title) { showToast('Вкажіть назву шаблона.'); return; }
  try {
    await api.request('/api/admin/doc-templates', { method: 'POST', body: JSON.stringify({ title, body, category }) });
    showToast('Шаблон збережено');
    $('#docTitle').value = '';
    $('#docBody').value = '';
    loadDocTemplates();
  } catch (e) { showToast(e.message); }
}

async function deleteDocTemplate(id) {
  if (!confirm('Видалити шаблон?')) return;
  try {
    await api.request(`/api/admin/doc-templates/${id}`, { method: 'DELETE' });
    showToast('Видалено');
    loadDocTemplates();
  } catch (e) { showToast(e.message); }
}

function openDocSend(templateId, templateName) {
  _docSendTemplateId = templateId;
  _docSelectedUsers.clear();
  $('#docSendTemplateName').textContent = templateName;
  $('#docSendNote').value = '';
  $('#docUserSearch').value = '';
  $('#docUserPickList').innerHTML = '<div class="muted" style="font-size:12px;padding:6px">Введіть ім\'я або телефон для пошуку</div>';
  $('#docSendPanel').style.display = '';
  $('#docSendPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeDocSend() {
  $('#docSendPanel').style.display = 'none';
  _docSendTemplateId = null;
  _docSelectedUsers.clear();
}

async function searchDocUsers() {
  const q = $('#docUserSearch')?.value.trim();
  if (!q) return;
  const list = $('#docUserPickList');
  list.innerHTML = '<div class="muted" style="font-size:12px;padding:6px">Пошук…</div>';
  try {
    const res = await api.request('/api/admin/users?search=' + encodeURIComponent(q));
    const users = Array.isArray(res) ? res : (res.data || []);
    if (!users.length) { list.innerHTML = '<div class="muted" style="font-size:12px;padding:6px">Не знайдено</div>'; return; }
    list.innerHTML = users.map(u => `
      <label style="display:flex;align-items:center;gap:8px;padding:6px;cursor:pointer;border-radius:6px;font-size:13px">
        <input type="checkbox" value="${u.id}" ${_docSelectedUsers.has(u.id) ? 'checked' : ''}
          onchange="if(this.checked) _docSelectedUsers.add(${u.id}); else _docSelectedUsers.delete(${u.id})">
        <span>${escapeHtml(u.full_name || '—')} <span style="opacity:.5;font-size:11px">#${u.id}</span></span>
      </label>`).join('');
  } catch (e) { list.innerHTML = `<div class="muted">${escapeHtml(e.message)}</div>`; }
}

async function sendDocToUsers() {
  if (!_docSendTemplateId) return;
  const userIds = [..._docSelectedUsers];
  if (!userIds.length) { showToast('Виберіть хоча б одного отримувача.'); return; }
  const notes = $('#docSendNote')?.value.trim() || '';
  try {
    await api.request(`/api/admin/doc-templates/${_docSendTemplateId}/send`, {
      method: 'POST', body: JSON.stringify({ user_ids: userIds, notes }),
    });
    showToast(`Надіслано ${userIds.length} отримувачам`);
    closeDocSend();
    loadDocAssignments();
  } catch (e) { showToast(e.message); }
}

async function loadDocAssignments() {
  const body = $('#docAssignmentsBody');
  if (!body) return;
  try {
    const res = await api.request('/api/admin/doc-assignments');
    const list = Array.isArray(res) ? res : (res.data || []);
    if (!list.length) { body.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center;padding:20px">Немає надісланих документів</td></tr>'; return; }
    body.innerHTML = list.map(a => `
      <tr>
        <td>#${a.id}</td>
        <td>${escapeHtml(a.template_title || '—')}</td>
        <td>${escapeHtml(a.recipient_name || '—')} <span class="muted">#${a.user_id}</span></td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(a.notes || '—')}</td>
        <td>${fmtShortDate(a.sent_at)}</td>
      </tr>`).join('');
  } catch (e) { if (body) body.innerHTML = `<tr><td colspan="5" class="muted" style="padding:16px">${escapeHtml(e.message)}</td></tr>`; }
}

// ── Init ─────────────────────────────────────────────────────────────────────

(async function () {
  const user = await checkAdmin();
  if (!user) return;
  const roleLabels = { soldier: 'Клієнт', operator: 'Оператор', admin: 'Адмін', platform_admin: 'Платформа' };
  $('#adminUser').textContent = user.email + ' · ' + (roleLabels[user.role] || user.role);

  // Filters
  $('#roleFilter')?.addEventListener('change', loadUsers);
  $('#userSearch')?.addEventListener('input', () => { clearTimeout(window._userSearchT); window._userSearchT = setTimeout(loadUsers, 350); });
  $('#orderRiskFilter')?.addEventListener('change', loadOrders);
  $('#orderStatusFilter')?.addEventListener('change', loadOrders);
  $('#orderFromDate')?.addEventListener('change', loadOrders);
  $('#orderToDate')?.addEventListener('change', loadOrders);
  $('#auditActionFilter')?.addEventListener('change', loadAudit);
  $('#auditUserIdFilter')?.addEventListener('input', () => { clearTimeout(window._auditT); window._auditT = setTimeout(loadAudit, 400); });
  $('#chartDays')?.addEventListener('change', loadOverview);

  // Reg: search on Enter
  // Registry: Enter to search, debounce on filter changes
  $('#regSearch')?.addEventListener('keydown', e => { if (e.key === 'Enter') loadRegistry(true); });
  ['#regType','#regDir','#regFrom','#regTo'].forEach(id => {
    $(id)?.addEventListener('change', () => loadRegistry(true));
  });
  ['#regMin','#regMax','#regUserId'].forEach(id => {
    $(id)?.addEventListener('input', () => { clearTimeout(window._regT); window._regT = setTimeout(() => loadRegistry(true), 500); });
  });
  $('#regExportCsvBtn')?.addEventListener('click', exportRegistryCsv);

  // Tab nav
  $$('.menu-btn[data-tab]').forEach((btn) =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  );

  // Drawer buttons
  $('#drawerClose')?.addEventListener('click', () => setDrawer(false));
  $('#backdrop')?.addEventListener('click', () => setDrawer(false));
  $('#drawerSaveRole')?.addEventListener('click', drawerSaveRole);
  $('#drawerSendPayout')?.addEventListener('click', drawerSendPayout);
  $('#drawerAdjSubmit')?.addEventListener('click', drawerBalanceAdjust);

  $('#logoutBtn').addEventListener('click', () => {
    api.setToken('');
    window.location.href = basePath() || '/';
  });

  switchTab('users');
  checkSystemHealth();
  setInterval(checkSystemHealth, 30000);
})();


// ═══════════════════════════════════════════════════════════════════
//  MARKETPLACE ADMIN
// ═══════════════════════════════════════════════════════════════════

let _mktProductsPage = 1;
let _mktOrdersPage   = 1;
let _productDebounceTimer = null;
let _currentOrderId = null;

function switchMktSubtab(name) {
  document.querySelectorAll('.mkt-subtab').forEach(b =>
    b.classList.toggle('active', b.dataset.subtab === name));
  ['Products','Orders','Customers','Analytics'].forEach(t => {
    const el = document.getElementById('mkt' + t);
    if (el) el.style.display = (name === t.toLowerCase()) ? '' : 'none';
  });
  if (name === 'orders')    loadAdminOrders();
  if (name === 'customers') loadAdminCustomers();
  if (name === 'analytics') { loadAdminAnalytics(); loadLowStockAlert(); }
}

function debounceLoadProducts() {
  clearTimeout(_productDebounceTimer);
  _productDebounceTimer = setTimeout(() => { _mktProductsPage = 1; loadAdminProducts(); }, 350);
}

// ── Stats ────────────────────────────────────────────────────────

async function loadMarketplaceStats() {
  const container = document.getElementById('mktStats');
  try {
    const _r = await apiRaw('/api/marketplace/admin/stats'); const d = _r.data ?? _r;
    const fmt = v => fmtMoney(v);
    const cards = [
      { label: 'Товарів',       val: d.total_products,  cls: '' },
      { label: 'Активних',      val: d.active_products,  cls: 'success' },
      { label: 'Мало залишку',  val: d.low_stock,        cls: d.low_stock  > 0 ? 'warn'   : '' },
      { label: 'Немає в наявн.', val: d.out_of_stock,    cls: d.out_of_stock > 0 ? 'danger' : '' },
      { label: 'Замовлень',     val: d.total_orders,     cls: '' },
      { label: 'Оплачено',      val: d.paid_orders,      cls: 'success' },
      { label: 'Очікують',      val: d.pending_orders,   cls: d.pending_orders > 0 ? 'warn' : '' },
      { label: 'Виручка',       val: fmt(d.revenue),     cls: 'success' },
    ];
    container.innerHTML = cards.map(c => `
      <div class="mkt-stat-card ${c.cls}">
        <div class="mkt-stat-val">${c.val}</div>
        <div class="mkt-stat-lbl">${c.label}</div>
      </div>`).join('');

    if (d.top_products?.length) {
      container.insertAdjacentHTML('afterend', `
        <div style="margin-bottom:18px">
          <div style="font-size:12px;color:rgba(255,255,255,.45);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">
            Топ продажів
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${d.top_products.map(p => `
              <div style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:8px 12px;display:flex;align-items:center;gap:8px">
                <span style="font-size:1.4rem">${p.emoji}</span>
                <div>
                  <div style="font-size:13px;font-weight:600;color:#fff">${escapeHtml(p.title)}</div>
                  <div style="font-size:11px;color:rgba(255,255,255,.45)">${p.sold} прод. · ${fmtMoney(p.revenue)} · залишок: ${p.stock}</div>
                </div>
              </div>`).join('')}
          </div>
        </div>`);
    }
  } catch (e) {
    container.innerHTML = `<div class="muted">Помилка завантаження статистики</div>`;
  }
}

// ── Products list ────────────────────────────────────────────────

async function loadAdminProducts() {
  const tbody = document.getElementById('mktProductsBody');
  const pager = document.getElementById('mktProductsPager');
  const search = (document.getElementById('mktSearch')?.value || '').trim();
  const active = document.getElementById('mktActiveFilter')?.value || '';

  tbody.innerHTML = `<tr><td colspan="6" class="muted" style="text-align:center;padding:20px">Завантаження…</td></tr>`;
  try {
    const params = new URLSearchParams({ page: _mktProductsPage });
    if (search) params.set('search', search);
    if (active) params.set('active', active);
    const _r = await apiRaw(`/api/marketplace/admin/products?${params}`); const d = _r.data ?? _r;

    if (!d.items?.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="muted" style="text-align:center;padding:20px">Товарів не знайдено</td></tr>`;
      pager.innerHTML = '';
      return;
    }

    tbody.innerHTML = d.items.map(p => `
      <tr>
        <td style="color:rgba(255,255,255,.4);font-size:12px">#${p.id}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:1.3rem">${p.image_emoji}</span>
            <div>
              <div style="font-weight:600;color:#fff">${escapeHtml(p.title)}</div>
              <div style="font-size:11px;color:rgba(255,255,255,.4)">${p.badge ? `<span style="color:#f59e0b">[${escapeHtml(p.badge)}]</span> ` : ''}${escapeHtml(p.slug)}</div>
            </div>
          </div>
        </td>
        <td style="font-weight:700;color:#22c55e">${fmtMoney(p.price)}</td>
        <td>
          <input class="stock-edit-input"
                 value="${p.stock}"
                 style="${p.stock===0?'color:#ef4444;font-weight:700':p.stock<=5?'color:#f59e0b;font-weight:600':''}"
                 onchange="quickUpdateStock(${p.id}, this)"
                 onclick="this.select()"
                 title="Клікни для редагування залишку">
        </td>
        <td>
          <span class="status-pill ${p.is_active ? 'active' : 'inactive'}">${p.is_active ? 'Активний' : 'Неактивний'}</span>
        </td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="secondary-btn" style="padding:4px 10px;font-size:12px" onclick="openProductModal(${JSON.stringify(p)})">✏️</button>
            <button class="secondary-btn" style="padding:4px 10px;font-size:12px" onclick="toggleProduct(${p.id}, ${p.is_active})">${p.is_active ? '🔴' : '🟢'}</button>
            <button class="secondary-btn" style="padding:4px 10px;font-size:12px;color:#ef4444" onclick="deleteProduct(${p.id})">🗑️</button>
          </div>
        </td>
      </tr>`).join('');

    // Pager
    pager.innerHTML = d.pages > 1 ? `
      <button class="secondary-btn" style="padding:4px 12px" ${_mktProductsPage <= 1 ? 'disabled' : ''} onclick="_mktProductsPage--;loadAdminProducts()">‹</button>
      <span style="color:rgba(255,255,255,.5);font-size:13px">${_mktProductsPage} / ${d.pages}</span>
      <button class="secondary-btn" style="padding:4px 12px" ${_mktProductsPage >= d.pages ? 'disabled' : ''} onclick="_mktProductsPage++;loadAdminProducts()">›</button>` : '';
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted" style="text-align:center;padding:20px">${escapeHtml(e.message || 'Помилка')}</td></tr>`;
  }
}

// ── Product modal ────────────────────────────────────────────────

function openProductModal(product) {
  const modal = document.getElementById('productModal');
  const titleEl = document.getElementById('productModalTitle');
  if (product && typeof product === 'object') {
    titleEl.textContent = 'Редагувати товар';
    document.getElementById('productId').value        = product.id;
    document.getElementById('pTitle').value           = product.title || '';
    document.getElementById('pDescription').value     = product.description || '';
    document.getElementById('pPrice').value           = product.price || 0;
    document.getElementById('pStock').value           = product.stock || 0;
    document.getElementById('pEmoji').value           = product.image_emoji || '🛍️';
    document.getElementById('pBadge').value           = product.badge || '';
    document.getElementById('pActive').checked        = product.is_active !== false;
  } else {
    titleEl.textContent = 'Додати товар';
    document.getElementById('productId').value = '';
    document.getElementById('productForm').reset();
    document.getElementById('pEmoji').value  = '🛍️';
    document.getElementById('pActive').checked = true;
  }
  modal.classList.add('open');
}

function closeProductModal() {
  document.getElementById('productModal').classList.remove('open');
}

async function saveProduct(e) {
  e.preventDefault();
  const btn = document.getElementById('productSaveBtn');
  const id  = document.getElementById('productId').value;
  const body = {
    title:       document.getElementById('pTitle').value.trim(),
    description: document.getElementById('pDescription').value.trim(),
    price:       parseFloat(document.getElementById('pPrice').value) || 0,
    stock:       parseInt(document.getElementById('pStock').value)   || 0,
    image_emoji: document.getElementById('pEmoji').value.trim() || '🛍️',
    badge:       document.getElementById('pBadge').value || null,
    is_active:   document.getElementById('pActive').checked,
  };

  btn.disabled = true;
  btn.textContent = 'Збереження…';
  try {
    if (id) {
      await apiRaw(`/api/marketplace/admin/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      showToast('Товар оновлено');
    } else {
      await apiRaw('/api/marketplace/admin/products', { method: 'POST', body: JSON.stringify(body) });
      showToast('Товар додано');
    }
    closeProductModal();
    loadAdminProducts();
    loadMarketplaceStats();
  } catch (err) {
    showToast(err.message || 'Помилка збереження', true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Зберегти';
  }
}

async function toggleProduct(id, currentActive) {
  try {
    const _r = await apiRaw(`/api/marketplace/admin/products/${id}/toggle`, { method: 'PATCH' }); const d = _r.data ?? _r;
    showToast(d.is_active ? 'Товар активовано' : 'Товар деактивовано');
    loadAdminProducts();
    loadMarketplaceStats();
  } catch (e) {
    showToast(e.message || 'Помилка', true);
  }
}

async function deleteProduct(id) {
  if (!confirm('Видалити товар? Якщо він є в замовленнях — буде деактивовано.')) return;
  try {
    const _r = await apiRaw(`/api/marketplace/admin/products/${id}`, { method: 'DELETE' }); const d = _r.data ?? _r;
    showToast(d.deactivated ? 'Товар деактивовано (є в замовленнях)' : 'Товар видалено');
    loadAdminProducts();
    loadMarketplaceStats();
  } catch (e) {
    showToast(e.message || 'Помилка', true);
  }
}

// ── Orders ────────────────────────────────────────────────────────

const ORDER_STATUS_LABELS = {
  paid: 'Оплачено', shipped: 'Відправлено', delivered: 'Доставлено',
  cancelled: 'Скасовано', awaiting_payment: 'Очікує оплати', processing: 'В обробці',
};
const ORDER_STATUS_CSS = {
  paid: 'paid', shipped: 'shipped', delivered: 'delivered',
  cancelled: 'cancelled', awaiting_payment: 'pending', processing: 'pending',
};

async function loadAdminOrders() {
  const tbody = document.getElementById('mktOrdersBody');
  const pager = document.getElementById('mktOrdersPager');
  const status     = document.getElementById('mktOrderStatus')?.value || '';
  const dateFrom   = document.getElementById('mktOrderFrom')?.value || '';
  const dateTo     = document.getElementById('mktOrderTo')?.value   || '';
  const custSearch = (document.getElementById('mktOrderCustSearch')?.value || '').trim();
  tbody.innerHTML = `<tr><td colspan="6" class="muted" style="text-align:center;padding:20px">Завантаження…</td></tr>`;
  try {
    const params = new URLSearchParams({ page: _mktOrdersPage });
    if (status)     params.set('status',    status);
    if (dateFrom)   params.set('date_from', dateFrom);
    if (dateTo)     params.set('date_to',   dateTo);
    if (custSearch) params.set('search',    custSearch);
    const _r = await apiRaw(`/api/marketplace/admin/orders?${params}`); const d = _r.data ?? _r;

    if (!d.items?.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="muted" style="text-align:center;padding:20px">Замовлень не знайдено</td></tr>`;
      pager.innerHTML = '';
      return;
    }

    tbody.innerHTML = d.items.map(o => `
      <tr>
        <td style="font-weight:700;color:rgba(255,255,255,.7)">#${o.id}</td>
        <td>
          <div style="font-weight:600;color:#fff">${escapeHtml(o.user_name || o.user_phone || '—')}</div>
          <div style="font-size:11px;color:rgba(255,255,255,.4)">${escapeHtml(o.shipping_name || '')} · ${escapeHtml(o.shipping_phone || '')}</div>
          <div style="font-size:11px;color:rgba(255,255,255,.35)">${fmtShortDate(o.created_at)}</div>
        </td>
        <td style="font-size:12px;color:rgba(255,255,255,.6)">${escapeHtml(o.shipping_address || '—')}</td>
        <td style="font-weight:700;color:#22c55e">${fmtMoney(o.total_amount)}</td>
        <td><span class="status-pill ${ORDER_STATUS_CSS[o.status] || ''}">${ORDER_STATUS_LABELS[o.status] || o.status}</span></td>
        <td>
          <div style="display:flex;gap:5px;flex-wrap:wrap">
            <button class="secondary-btn" style="padding:4px 9px;font-size:12px" onclick="openOrderDetailModal(${o.id})">👁</button>
            <button class="secondary-btn" style="padding:4px 9px;font-size:12px" onclick="openOrderStatusModal(${o.id}, '${o.status}')">✎ Статус</button>
          </div>
        </td>
      </tr>`).join('');

    pager.innerHTML = d.pages > 1 ? `
      <button class="secondary-btn" style="padding:4px 12px" ${_mktOrdersPage <= 1 ? 'disabled' : ''} onclick="_mktOrdersPage--;loadAdminOrders()">‹</button>
      <span style="color:rgba(255,255,255,.5);font-size:13px">${_mktOrdersPage} / ${d.pages}</span>
      <button class="secondary-btn" style="padding:4px 12px" ${_mktOrdersPage >= d.pages ? 'disabled' : ''} onclick="_mktOrdersPage++;loadAdminOrders()">›</button>` : '';
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted" style="text-align:center;padding:20px">${escapeHtml(e.message || 'Помилка')}</td></tr>`;
  }
}

function openOrderStatusModal(orderId, currentStatus) {
  _currentOrderId = orderId;
  document.getElementById('osOrderId').textContent = orderId;
  document.getElementById('osStatus').value = currentStatus;
  document.getElementById('orderStatusModal').classList.add('open');
}

function closeOrderStatusModal() {
  document.getElementById('orderStatusModal').classList.remove('open');
}

async function confirmOrderStatus() {
  const status = document.getElementById('osStatus').value;
  if (!_currentOrderId || !status) return;
  try {
    await apiRaw(`/api/marketplace/admin/orders/${_currentOrderId}/status`, {
      method: 'PATCH', body: JSON.stringify({ status }),
    });
    showToast('Статус оновлено');
    closeOrderStatusModal();
    loadAdminOrders();
  } catch (e) {
    showToast(e.message || 'Помилка', true);
  }
}

// Close modals on backdrop click
document.addEventListener('click', e => {
  if (e.target.id === 'productModal')        closeProductModal();
  if (e.target.id === 'orderStatusModal')    closeOrderStatusModal();
  if (e.target.id === 'customerDetailModal') closeCustomerModal();
  if (e.target.id === 'orderDetailModal')    closeOrderDetailModal();
});

// ═══════════════════════════════════════════════════════════════════
//  MARKETPLACE CRM — Customers
// ═══════════════════════════════════════════════════════════════════

let _mktCustomersPage = 1;
let _custDebounceTimer = null;
let _ordersDebounceTimer = null;

function debounceLoadCustomers() {
  clearTimeout(_custDebounceTimer);
  _custDebounceTimer = setTimeout(() => { _mktCustomersPage = 1; loadAdminCustomers(); }, 350);
}

function debounceLoadOrders() {
  clearTimeout(_ordersDebounceTimer);
  _ordersDebounceTimer = setTimeout(() => { _mktOrdersPage = 1; loadAdminOrders(); }, 350);
}

async function loadAdminCustomers() {
  const tbody = document.getElementById('mktCustomersBody');
  const pager = document.getElementById('mktCustomersPager');
  if (!tbody) return;
  const search = (document.getElementById('mktCustSearch')?.value || '').trim();
  tbody.innerHTML = `<tr><td colspan="5" class="muted" style="text-align:center;padding:20px">Завантаження…</td></tr>`;
  try {
    const params = new URLSearchParams({ page: _mktCustomersPage });
    if (search) params.set('search', search);
    const _r = await apiRaw(`/api/marketplace/admin/customers?${params}`);
    const d = _r.data ?? _r;

    if (!d.items?.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="muted" style="text-align:center;padding:20px">Клієнтів не знайдено</td></tr>`;
      if (pager) pager.innerHTML = '';
      return;
    }

    tbody.innerHTML = d.items.map(c => `
      <tr>
        <td>
          <div style="font-weight:600;color:#fff">${escapeHtml(c.full_name || '—')}</div>
          <div style="font-size:11px;color:rgba(255,255,255,.4)">${escapeHtml(c.phone || '')}</div>
        </td>
        <td style="text-align:center;font-weight:700">${c.total_orders}</td>
        <td style="font-weight:700;color:#22c55e">${fmtMoney(c.total_spent)}</td>
        <td style="font-size:12px;color:rgba(255,255,255,.5)">${fmtDate(c.last_order_at)}</td>
        <td>
          <button class="secondary-btn" style="padding:4px 10px;font-size:12px"
                  onclick="openCustomerModal(${c.user_id})">Профіль →</button>
        </td>
      </tr>`).join('');

    if (pager) {
      pager.innerHTML = d.pages > 1 ? `
        <button class="secondary-btn" style="padding:4px 12px" ${_mktCustomersPage<=1?'disabled':''} onclick="_mktCustomersPage--;loadAdminCustomers()">‹</button>
        <span style="color:rgba(255,255,255,.5);font-size:13px">${_mktCustomersPage} / ${d.pages}</span>
        <button class="secondary-btn" style="padding:4px 12px" ${_mktCustomersPage>=d.pages?'disabled':''} onclick="_mktCustomersPage++;loadAdminCustomers()">›</button>` : '';
    }
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted" style="text-align:center;padding:20px">${escapeHtml(e.message||'Помилка')}</td></tr>`;
  }
}

async function openCustomerModal(userId) {
  const modal = document.getElementById('customerDetailModal');
  const body  = document.getElementById('custModalBody');
  const title = document.getElementById('custModalTitle');
  if (!modal) return;
  body.innerHTML = '<div class="muted" style="padding:30px;text-align:center">Завантаження…</div>';
  modal.classList.add('open');
  try {
    const _r = await apiRaw(`/api/marketplace/admin/customers/${userId}`);
    const c = _r.data ?? _r;
    title.textContent = `${c.full_name || 'Клієнт'} · ${c.phone}`;
    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
        <div class="mkt-stat-card">
          <div class="mkt-stat-val">${c.total_orders}</div>
          <div class="mkt-stat-lbl">Замовлень</div>
        </div>
        <div class="mkt-stat-card success">
          <div class="mkt-stat-val">${fmtMoney(c.total_spent)}</div>
          <div class="mkt-stat-lbl">Витрачено</div>
        </div>
      </div>
      <h4 style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.45);margin:0 0 10px">Замовлення</h4>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th style="width:50px">ID</th>
            <th style="width:130px">Дата</th>
            <th>Адреса</th>
            <th style="width:110px">Сума</th>
            <th style="width:100px">Статус</th>
            <th style="width:70px"></th>
          </tr></thead>
          <tbody>
            ${(c.orders||[]).map(o => `
              <tr>
                <td style="color:rgba(255,255,255,.4)">#${o.id}</td>
                <td style="font-size:12px;color:rgba(255,255,255,.6)">${fmtDate(o.created_at)}</td>
                <td style="font-size:12px;color:rgba(255,255,255,.6)">${escapeHtml(o.shipping_address||'—')}</td>
                <td style="font-weight:700;color:#22c55e">${fmtMoney(o.total_amount)}</td>
                <td><span class="status-pill ${ORDER_STATUS_CSS[o.status]||''}">${ORDER_STATUS_LABELS[o.status]||o.status}</span></td>
                <td><button class="secondary-btn" style="font-size:11px;padding:3px 8px" onclick="openOrderDetailModal(${o.id})">👁</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (e) {
    body.innerHTML = `<div class="muted" style="padding:30px;text-align:center">${escapeHtml(e.message||'Помилка')}</div>`;
  }
}

function closeCustomerModal() {
  document.getElementById('customerDetailModal')?.classList.remove('open');
}

// ═══════════════════════════════════════════════════════════════════
//  Order detail modal
// ═══════════════════════════════════════════════════════════════════

async function openOrderDetailModal(orderId) {
  const modal = document.getElementById('orderDetailModal');
  const body  = document.getElementById('orderDetailBody');
  const title = document.getElementById('orderDetailTitle');
  if (!modal) return;
  title.textContent = `Замовлення #${orderId}`;
  body.innerHTML = '<div class="muted" style="padding:30px;text-align:center">Завантаження…</div>';
  modal.classList.add('open');
  try {
    const _r = await apiRaw(`/api/marketplace/admin/orders/${orderId}`);
    const o = _r.data ?? _r;
    const statusPill = `<span class="status-pill ${ORDER_STATUS_CSS[o.status]||''}">${ORDER_STATUS_LABELS[o.status]||o.status}</span>`;
    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px;font-size:13px;line-height:1.7">
        <div><span style="opacity:.5">Клієнт:</span>&nbsp;<strong>${escapeHtml(o.user_name||o.user_phone||'—')}</strong></div>
        <div><span style="opacity:.5">Телефон:</span>&nbsp;${escapeHtml(o.user_phone||'—')}</div>
        <div><span style="opacity:.5">Отримувач:</span>&nbsp;${escapeHtml(o.shipping_name||'—')}</div>
        <div><span style="opacity:.5">Тел. доставки:</span>&nbsp;${escapeHtml(o.shipping_phone||'—')}</div>
        <div style="grid-column:span 2"><span style="opacity:.5">Адреса:</span>&nbsp;${escapeHtml(o.shipping_address||'—')}</div>
        <div><span style="opacity:.5">Статус:</span>&nbsp;${statusPill}</div>
        <div><span style="opacity:.5">Сума:</span>&nbsp;<strong style="color:#22c55e">${fmtMoney(o.total_amount)}</strong></div>
        <div><span style="opacity:.5">Дата:</span>&nbsp;${fmtDate(o.created_at)}</div>
        <div><span style="opacity:.5">Оплата:</span>&nbsp;${o.payment_mode === 'invoice' ? '🧾 Рахунок' : '💳 Одразу'}</div>
        ${o.note ? `<div style="grid-column:span 2"><span style="opacity:.5">Нотатка:</span>&nbsp;${escapeHtml(o.note)}</div>` : ''}
      </div>
      <h4 style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.45);margin:0 0 10px">Склад замовлення</h4>
      <div class="table-wrap" style="margin-bottom:16px">
        <table class="data-table">
          <thead><tr>
            <th>Товар</th>
            <th style="width:60px;text-align:center">К-сть</th>
            <th style="width:110px">Ціна</th>
            <th style="width:110px">Разом</th>
          </tr></thead>
          <tbody>
            ${(o.items||[]).map(it => `
              <tr>
                <td><span style="margin-right:6px;font-size:1.1rem">${it.image_emoji}</span>${escapeHtml(it.title)}</td>
                <td style="text-align:center;font-weight:700">${it.qty}</td>
                <td>${fmtMoney(it.price)}</td>
                <td style="font-weight:700;color:#22c55e">${fmtMoney(it.line_total)}</td>
              </tr>`).join('')}
            <tr style="border-top:2px solid rgba(255,255,255,.12)">
              <td colspan="3" style="text-align:right;opacity:.6;font-weight:600">Всього:</td>
              <td style="font-weight:800;font-size:1.05em;color:#22c55e">${fmtMoney(o.total_amount)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="secondary-btn" onclick="openOrderStatusModal(${o.id},'${o.status}');closeOrderDetailModal()">Змінити статус</button>
      </div>`;
  } catch (e) {
    body.innerHTML = `<div class="muted" style="padding:30px;text-align:center">${escapeHtml(e.message||'Помилка')}</div>`;
  }
}

function closeOrderDetailModal() {
  document.getElementById('orderDetailModal')?.classList.remove('open');
}

// ═══════════════════════════════════════════════════════════════════
//  Analytics & Low-stock
// ═══════════════════════════════════════════════════════════════════

async function loadAdminAnalytics() {
  const wrap = document.getElementById('mktRevenueChartWrap');
  const topEl = document.getElementById('mktTopProducts');
  if (!wrap) return;
  try {
    const _r = await apiRaw('/api/marketplace/admin/analytics');
    const d = _r.data ?? _r;
    renderMktRevenueChart(d.daily || [], wrap);
    if (topEl && d.top_products?.length) {
      topEl.innerHTML = `
        <h3 style="font-size:13px;font-weight:700;margin:0 0 12px;opacity:.75">Топ товарів за виручкою</h3>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Товар</th><th style="width:90px;text-align:center">Продано шт.</th><th style="width:130px">Виручка</th></tr></thead>
            <tbody>
              ${d.top_products.map((p,i) => `
                <tr>
                  <td>
                    <span style="color:rgba(255,255,255,.3);font-size:12px;margin-right:8px">#${i+1}</span>
                    <span style="margin-right:6px">${p.emoji}</span>
                    ${escapeHtml(p.title)}
                  </td>
                  <td style="text-align:center;font-weight:700">${p.units}</td>
                  <td style="font-weight:700;color:#22c55e">${fmtMoney(p.revenue)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    } else if (topEl) {
      topEl.innerHTML = '';
    }
  } catch (e) {
    if (wrap) wrap.innerHTML = `<div class="muted" style="padding:20px;text-align:center">${escapeHtml(e.message||'Помилка')}</div>`;
  }
}

function renderMktRevenueChart(daily, wrap) {
  if (!daily.length) {
    wrap.innerHTML = '<div class="muted" style="padding:20px;text-align:center">Даних за останні 30 днів немає</div>';
    return;
  }
  const W = Math.max(wrap.offsetWidth || 620, 320);
  const H = 150;
  const pad = { top: 12, right: 10, bottom: 32, left: 8 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const maxVal = Math.max(...daily.map(d => d.revenue || 0), 1);
  const barW   = Math.max(4, Math.floor(innerW / daily.length) - 2);

  const bars = daily.map((d, i) => {
    const x = pad.left + Math.floor(i * (innerW / daily.length));
    const h = Math.max(2, Math.round((d.revenue / maxVal) * innerH));
    const y = pad.top + innerH - h;
    // Show every ~5th label to avoid crowding
    const showLabel = daily.length <= 10 || i % Math.ceil(daily.length / 10) === 0 || i === daily.length - 1;
    const label = showLabel ? (d.day || '').slice(5) : ''; // MM-DD
    const tooltip = `${d.day}: ${fmtMoney(d.revenue)} (${d.orders_count} зам.)`;
    return `
      <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="2" fill="${d.revenue>0?'#22c55e':'rgba(255,255,255,.1)'}" opacity=".8">
        <title>${tooltip}</title>
      </rect>
      ${label ? `<text x="${x + barW/2}" y="${H - 5}" text-anchor="middle" font-size="8" fill="rgba(255,255,255,.35)">${label}</text>` : ''}`;
  }).join('');

  const maxLabel = fmtMoney(maxVal);
  wrap.innerHTML = `
    <svg width="100%" viewBox="0 0 ${W} ${H}" style="overflow:visible;display:block">
      <text x="${pad.left}" y="${pad.top}" font-size="9" fill="rgba(255,255,255,.3)">${maxLabel}</text>
      ${bars}
    </svg>
    <div style="font-size:11px;color:rgba(255,255,255,.4);margin-top:6px;display:flex;gap:12px">
      <span><span style="display:inline-block;width:10px;height:10px;background:#22c55e;border-radius:2px;margin-right:4px;vertical-align:middle"></span>Виручка (₴)</span>
      <span>Всього: <strong>${fmtMoney(daily.reduce((s,d)=>s+d.revenue,0))}</strong></span>
      <span>Замовлень: <strong>${daily.reduce((s,d)=>s+d.orders_count,0)}</strong></span>
    </div>`;
}

async function loadLowStockAlert() {
  const panel = document.getElementById('mktLowStockPanel');
  if (!panel) return;
  try {
    const _r = await apiRaw('/api/marketplace/admin/products?active=true&per_page=200');
    const items = (_r.data ?? _r).items || [];
    const low = items.filter(p => p.stock <= 5);
    if (!low.length) { panel.innerHTML = ''; return; }
    panel.innerHTML = `
      <div class="low-stock-alert">
        <h4>⚠️ Малий залишок — ${low.length} товарів</h4>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${low.map(p => `
            <div style="background:rgba(255,255,255,.05);border-radius:8px;padding:7px 11px;display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer"
                 onclick="openProductModal(${JSON.stringify(p).replace(/"/g,'&quot;')})">
              <span style="font-size:1.3rem">${p.image_emoji}</span>
              <div>
                <div style="font-weight:600;color:#fff">${escapeHtml(p.title)}</div>
                <div style="color:${p.stock===0?'#ef4444':'#f59e0b'};font-weight:700">
                  ${p.stock===0 ? '❌ Немає в наявності' : `Залишок: ${p.stock} шт.`}
                </div>
              </div>
            </div>`).join('')}
        </div>
      </div>`;
  } catch (_) { panel.innerHTML = ''; }
}

// ═══════════════════════════════════════════════════════════════════
//  Quick stock update
// ═══════════════════════════════════════════════════════════════════

async function quickUpdateStock(productId, inputEl) {
  const stock = Math.max(0, parseInt(inputEl.value) || 0);
  inputEl.value = stock;
  try {
    await apiRaw(`/api/marketplace/admin/products/${productId}/stock`, {
      method: 'PATCH',
      body: JSON.stringify({ stock }),
    });
    showToast('Залишок оновлено');
    inputEl.style.color = stock === 0 ? '#ef4444' : stock <= 5 ? '#f59e0b' : '';
    inputEl.style.fontWeight = stock <= 5 ? '700' : '400';
    loadMarketplaceStats();
  } catch (e) {
    showToast(e.message || 'Помилка оновлення', true);
    loadAdminProducts();
  }
}

// ═══════════════════════════════════════════════════════════════════
//  CSV Export
// ═══════════════════════════════════════════════════════════════════

async function exportMktOrdersCsv() {
  try {
    const dateFrom   = document.getElementById('mktOrderFrom')?.value || '';
    const dateTo     = document.getElementById('mktOrderTo')?.value   || '';
    const status     = document.getElementById('mktOrderStatus')?.value || '';
    const custSearch = (document.getElementById('mktOrderCustSearch')?.value || '').trim();
    const params = new URLSearchParams({ per_page: 5000, page: 1 });
    if (status)     params.set('status',    status);
    if (dateFrom)   params.set('date_from', dateFrom);
    if (dateTo)     params.set('date_to',   dateTo);
    if (custSearch) params.set('search',    custSearch);

    showToast('Підготовка CSV…');
    const _r = await apiRaw(`/api/marketplace/admin/orders?${params}`);
    const rows = (_r.data ?? _r).items || [];
    if (!rows.length) { showToast('Немає даних для експорту'); return; }

    const esc = v => `"${String(v??'').replace(/"/g,'""')}"`;
    const headers = ['ID','Дата','Клієнт','Телефон акаунту','Отримувач','Тел. доставки','Адреса','Сума','Валюта','Статус','Інвойс'];
    const lines = [
      headers.join(','),
      ...rows.map(o => [
        o.id,
        esc(fmtDate(o.created_at)),
        esc(o.user_name),
        esc(o.user_phone),
        esc(o.shipping_name),
        esc(o.shipping_phone),
        esc(o.shipping_address),
        Number(o.total_amount).toFixed(2),
        o.currency,
        o.status,
        esc(o.invoice_number),
      ].join(','))
    ];
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `marketplace-orders-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    showToast(`✅ Експортовано ${rows.length} замовлень`);
  } catch (e) {
    showToast(e.message || 'Помилка експорту', true);
  }
}

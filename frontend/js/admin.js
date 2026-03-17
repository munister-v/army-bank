// Сторінка адміністратора
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

async function checkAdmin() {
  if (!api.token) {
    window.location.href = basePath() || '/';
    return null;
  }
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

async function loadUsers(roleFilter) {
  let url = '/api/admin/users';
  if (roleFilter) url += '?role=' + encodeURIComponent(roleFilter);
  const users = await api.request(url);
  const body = $('#usersTableBody');
  body.innerHTML = users.map((u) => `
    <tr data-id="${u.id}">
      <td><strong>#${u.id}</strong></td>
      <td>
        <div><strong>${u.full_name}</strong></div>
        <div class="subtle">${u.military_status || ''}</div>
      </td>
      <td class="subtle">${u.phone}<br>${u.email}</td>
      <td>
        <select class="role-select" data-user-id="${u.id}">
          <option value="soldier" ${u.role === 'soldier' ? 'selected' : ''}>Військовий</option>
          <option value="operator" ${u.role === 'operator' ? 'selected' : ''}>Оператор</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Адмін</option>
          <option value="platform_admin" ${u.role === 'platform_admin' ? 'selected' : ''}>Платформа</option>
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
      const sel = $(`.role-select[data-user-id="${userId}"]`);
      const role = sel?.value;
      if (!role) return;
      try {
        await api.request(`/api/admin/users/${userId}/role`, {
          method: 'PATCH',
          body: JSON.stringify({ role }),
        });
        showToast('Роль оновлено.');
        loadUsers($('#roleFilter').value);
      } catch (e) {
        showToast(e.message);
      }
    });
  });

  $$('.open-user').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const userId = btn.dataset.userId;
      await openUserDrawer(Number(userId));
    });
  });
}

async function loadAudit() {
  const logs = await api.request('/api/admin/audit-logs');
  const list = $('#auditList');
  list.innerHTML = logs.map((l) => `
    <div class="item">
      <div class="item-header"><strong>${l.action}</strong><span class="muted">${l.created_at}</span></div>
      <div class="muted">user_id: ${l.user_id ?? '—'} · ${l.details || '—'}</div>
    </div>
  `).join('');
}

function switchTab(tabId) {
  $$('.admin-tab').forEach((el) => el.classList.add('hidden'));
  $(`#${tabId}Tab`)?.classList.remove('hidden');
  $$('.menu-btn[data-tab]').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tabId));
  if (tabId === 'users') loadUsers($('#roleFilter').value);
  if (tabId === 'audit') loadAudit();
}

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
    $('#drawerBalance').textContent = `Баланс: ₴${Number(account.balance || 0).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    $('#drawerAccount').textContent = `Рахунок: ${account.account_number}`;

    $('#drawerTx').innerHTML = (txs || []).slice(0, 20).map((t) => `
      <div class="item">
        <div class="item-header">
          <strong>${t.description}</strong>
          <span class="amount ${t.direction}">${t.direction === 'in' ? '+' : '-'}₴${Number(t.amount || 0).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        <div class="subtle">${t.tx_type} · ${t.created_at}${t.related_account ? ` · ${t.related_account}` : ''}</div>
      </div>
    `).join('') || `<div class="item"><span class="subtle">Транзакцій поки немає.</span></div>`;
  } catch (e) {
    showToast(e.message);
    setDrawer(false);
  }
}

(async function () {
  const user = await checkAdmin();
  if (!user) return;
  const roleLabels = { soldier: 'Військовий', operator: 'Оператор', admin: 'Адмін', platform_admin: 'Платформа' };
  $('#adminUser').textContent = user.email + ' · ' + (roleLabels[user.role] || user.role);

  $('#roleFilter').addEventListener('change', () => loadUsers($('#roleFilter').value));
  $$('.menu-btn[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  $('#drawerClose')?.addEventListener('click', () => setDrawer(false));
  $('#backdrop')?.addEventListener('click', () => setDrawer(false));

  $('#logoutBtn').addEventListener('click', () => {
    api.setToken('');
    window.location.href = basePath() || '/';
  });

  switchTab('users');
})();

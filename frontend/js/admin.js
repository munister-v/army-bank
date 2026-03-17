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
    if (user.role !== 'admin') {
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
  const list = $('#usersList');
  list.innerHTML = users.map((u) => `
    <div class="item item-user" data-id="${u.id}">
      <div class="item-header">
        <strong>#${u.id} ${u.full_name}</strong>
        <span>${u.role}</span>
      </div>
      <div class="muted">${u.phone} · ${u.email}</div>
      <div style="margin-top: 8px;">
        <label>Роль
          <select class="role-select" data-user-id="${u.id}">
            <option value="soldier" ${u.role === 'soldier' ? 'selected' : ''}>soldier</option>
            <option value="operator" ${u.role === 'operator' ? 'selected' : ''}>operator</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option>
          </select>
        </label>
        <button type="button" class="small-btn save-role" data-user-id="${u.id}">Зберегти</button>
      </div>
    </div>
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

(async function () {
  const user = await checkAdmin();
  if (!user) return;
  $('#adminUser').textContent = user.email + ' · ' + user.role;

  $('#roleFilter').addEventListener('change', () => loadUsers($('#roleFilter').value));
  $$('.menu-btn[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  $('#logoutBtn').addEventListener('click', () => {
    api.setToken('');
    window.location.href = basePath() || '/';
  });

  switchTab('users');
})();

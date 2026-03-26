// Сторінка оператора
const $ = (s) => document.querySelector(s);
const roleLabels = { soldier: 'Військовий', operator: 'Оператор', admin: 'Адмін' };

function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 2600);
}

function basePath() {
  return (typeof window !== 'undefined' && window.ARMY_BANK_BASE) || '';
}

async function checkOperator() {
  if (!api.token) {
    window.location.href = basePath() || '/';
    return null;
  }
  try {
    const user = await api.request('/api/auth/me');
    if (user.role !== 'operator' && user.role !== 'admin') {
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

async function loadSoldiers() {
  try {
    const res = await api.request('/api/operator/users');
    const users = Array.isArray(res) ? res : (res.data || []);
    const sel = $('#userSelect');
    sel.innerHTML = '<option value="">— Обрати —</option>' + users.map((u) => `<option value="${u.id}">#${u.id} ${u.full_name} (${u.phone})</option>`).join('');
    const list = $('#soldiersList');
    list.innerHTML = users.length
      ? users.map((u) => `
          <div class="item">
            <div class="item-header"><strong>#${u.id} ${u.full_name}</strong><span class="muted">${roleLabels[u.role] || u.role}</span></div>
            <div class="muted">${u.phone} · ${u.email}</div>
          </div>
        `).join('')
      : '<div class="muted" style="padding:16px;text-align:center">Немає солдатів</div>';
  } catch (e) {
    showToast(e.message);
  }
}

(async function () {
  const user = await checkOperator();
  if (!user) return;
  $('#operatorUser').textContent = user.email + ' · ' + (roleLabels[user.role] || user.role);

  await loadSoldiers();

  $('#payoutForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const payload = {
      user_id: parseInt(form.user_id.value, 10),
      title: form.title.value,
      payout_type: form.payout_type.value,
      amount: parseFloat(form.amount.value),
    };
    try {
      await api.request('/api/operator/payouts', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      showToast('Виплату нараховано.');
      form.amount.value = '';
    } catch (err) {
      showToast(err.message);
    }
  });

  $('#logoutBtn').addEventListener('click', () => {
    api.setToken('');
    window.location.href = basePath() || '/';
  });
})();

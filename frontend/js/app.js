// Головний файл фронтенду: обробка подій, рендер списків та навігація.
const state = {
  user: null,
  account: null,
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
}

function formatMoney(value) {
  return `${Number(value || 0).toFixed(2)} грн`;
}

function renderList(containerSelector, items, renderer, emptyText) {
  const container = $(containerSelector);
  if (!items.length) {
    container.innerHTML = `<div class="item"><span class="muted">${emptyText}</span></div>`;
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

async function refreshProfile() {
  state.user = await api.request('/api/auth/me');
  state.account = await api.request('/api/accounts/main');
  $('#userName').textContent = state.user.full_name;
  $('#userMeta').textContent = `${state.user.role} · ${state.user.email}`;
  $('#balanceValue').textContent = formatMoney(state.account.balance);
  $('#accountNumber').textContent = `Рахунок: ${state.account.account_number}`;
}

async function refreshAllData() {
  await refreshProfile();
  const [transactions, payouts, donations, goals, contacts] = await Promise.all([
    api.request('/api/transactions/history'),
    api.request('/api/payouts'),
    api.request('/api/donations'),
    api.request('/api/savings-goals'),
    api.request('/api/family-contacts'),
  ]);

  renderTransactions(transactions, '#transactionsList');
  renderTransactions(transactions.slice(0, 5), '#recentTransactions');
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
}

function switchScreen(screenId) {
  $$('.screen').forEach((section) => section.classList.remove('active-screen'));
  $(`#${screenId}`).classList.add('active-screen');
  $$('.menu-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.screen === screenId));
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
  showToast('Успішна авторизація.');
}

function bindJsonForm(selector, endpoint, options = {}) {
  const form = $(selector);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const values = Object.fromEntries(new FormData(form).entries());
      const payload = options.transform ? options.transform(values) : values;
      await api.request(endpoint(payload), {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      form.reset();
      if (options.afterReset) options.afterReset(form);
      await refreshAllData();
      showToast(options.successMessage || 'Операцію виконано.');
    } catch (error) {
      showToast(error.message);
    }
  });
}

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await handleAuth(event.currentTarget, '/api/auth/login');
  } catch (error) {
    showToast(error.message);
  }
});

$('#registerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await handleAuth(event.currentTarget, '/api/auth/register');
  } catch (error) {
    showToast(error.message);
  }
});

bindJsonForm('#topupForm', () => '/api/transactions/topup', {
  transform: (v) => ({ ...v, amount: Number(v.amount) }),
  successMessage: 'Рахунок поповнено.',
  afterReset: (form) => { form.description.value = 'Поповнення рахунку'; },
});

bindJsonForm('#transferForm', () => '/api/transactions/transfer', {
  transform: (v) => ({ ...v, amount: Number(v.amount) }),
  successMessage: 'Переказ виконано.',
  afterReset: (form) => { form.description.value = 'Переказ родині'; },
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

$$('.menu-btn').forEach((btn) => btn.addEventListener('click', () => switchScreen(btn.dataset.screen)));

$('#logoutBtn').addEventListener('click', async () => {
  try {
    await api.request('/api/auth/logout', { method: 'POST' });
  } catch (_) {
    // Навіть якщо сесію вже втрачено, локально очищаємо токен.
  }
  api.setToken('');
  setAuthenticated(false);
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
  } catch (error) {
    api.setToken('');
    setAuthenticated(false);
    showToast('Сесію завершено. Увійдіть повторно.');
  }
})();

(function () {
  const currencyFmt = new Intl.NumberFormat('uk-UA', {
    style: 'currency',
    currency: 'UAH',
    maximumFractionDigits: 2,
  });

  const state = {
    products: [],
    cart: new Map(),
    account: null,
    orders: [],
    authenticated: false,
  };

  const el = {
    catalogGrid: document.getElementById('catalog-grid'),
    cartEmpty: document.getElementById('cart-empty'),
    cartItems: document.getElementById('cart-items'),
    cartTotal: document.getElementById('cart-total'),
    accountNumber: document.getElementById('account-number'),
    accountBalance: document.getElementById('account-balance'),
    ordersCount: document.getElementById('orders-count'),
    ordersList: document.getElementById('orders-list'),
    checkoutForm: document.getElementById('checkout-form'),
    checkoutBtn: document.getElementById('checkout-btn'),
    shippingName: document.getElementById('shipping-name'),
    shippingPhone: document.getElementById('shipping-phone'),
    shippingAddress: document.getElementById('shipping-address'),
    checkoutNote: document.getElementById('checkout-note'),
    toast: document.getElementById('toast'),
    backToBank: document.getElementById('back-to-bank'),
    loginToBank: document.getElementById('login-to-bank'),
    guestBanner: document.getElementById('guest-banner'),
    catalogSearch: document.getElementById('catalog-search'),
    catalogSort: document.getElementById('catalog-sort'),
  };

  function basePath() {
    return window.ARMY_BANK_BASE || '';
  }

  function showToast(message, isError = false) {
    el.toast.textContent = message;
    el.toast.style.background = isError ? '#6b1f1f' : '#102e22';
    el.toast.hidden = false;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => { el.toast.hidden = true; }, 2400);
  }

  function getBankPath() {
    return `${basePath()}/app`;
  }

  function productById(id) {
    return state.products.find((p) => Number(p.id) === Number(id)) || null;
  }

  function cartTotal() {
    let total = 0;
    for (const [id, qty] of state.cart.entries()) {
      const product = productById(id);
      if (!product) continue;
      total += Number(product.price || 0) * Number(qty || 0);
    }
    return Number(total.toFixed(2));
  }

  function cartPayload() {
    return Array.from(state.cart.entries()).map(([id, qty]) => ({
      product_id: Number(id),
      qty: Number(qty),
    }));
  }

  function getFilteredCatalog() {
    const q = String(el.catalogSearch?.value || '').trim().toLowerCase();
    const sort = String(el.catalogSort?.value || 'popular');
    let list = [...state.products];
    if (q) {
      list = list.filter((item) => {
        const title = String(item.title || '').toLowerCase();
        const desc = String(item.description || '').toLowerCase();
        return title.includes(q) || desc.includes(q);
      });
    }
    if (sort === 'cheap') {
      list.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
    } else if (sort === 'expensive') {
      list.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
    } else if (sort === 'title') {
      list.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'uk'));
    } else {
      list.sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
    }
    return list;
  }

  function renderCatalog() {
    el.catalogGrid.innerHTML = '';
    const visible = getFilteredCatalog();
    if (!visible.length) {
      el.catalogGrid.innerHTML = '<p>Каталог порожній.</p>';
      return;
    }
    for (const item of visible) {
      const card = document.createElement('article');
      card.className = 'product-card';
      card.innerHTML = `
        <div class="product-top">
          <span class="emoji">${item.image_emoji || '🛍️'}</span>
          ${item.badge ? `<span class="badge">${item.badge}</span>` : ''}
        </div>
        <h3>${item.title}</h3>
        <p>${item.description || ''}</p>
        <div class="product-meta">
          <div class="price">${currencyFmt.format(Number(item.price || 0))}</div>
          <button class="btn btn-add" type="button" data-add-id="${item.id}" ${Number(item.stock || 0) <= 0 ? 'disabled' : ''}>
            ${Number(item.stock || 0) <= 0 ? 'Немає в наявності' : 'Додати'}
          </button>
        </div>
      `;
      el.catalogGrid.appendChild(card);
    }
  }

  function renderCart() {
    const entries = Array.from(state.cart.entries());
    el.cartItems.innerHTML = '';
    el.cartEmpty.style.display = entries.length ? 'none' : 'block';

    for (const [id, qty] of entries) {
      const item = productById(id);
      if (!item) continue;
      const row = document.createElement('div');
      row.className = 'cart-item';
      row.innerHTML = `
        <div>
          <div class="cart-item-name">${item.title}</div>
          <div class="cart-item-meta">${currencyFmt.format(Number(item.price || 0))}</div>
        </div>
        <div>
          <div class="qty-controls">
            <button class="qty-btn" type="button" data-dec-id="${item.id}">−</button>
            <strong>${qty}</strong>
            <button class="qty-btn" type="button" data-inc-id="${item.id}">+</button>
          </div>
        </div>
      `;
      el.cartItems.appendChild(row);
    }

    const total = cartTotal();
    el.cartTotal.textContent = currencyFmt.format(total);
    el.checkoutBtn.disabled = total <= 0 || !state.authenticated;
  }

  function setGuestMode(reason = '') {
    state.authenticated = false;
    state.account = null;
    state.orders = [];
    el.accountNumber.textContent = 'Потрібен вхід';
    el.accountBalance.textContent = '—';
    el.ordersCount.textContent = '0';
    el.ordersList.innerHTML = '<div class="order-item"><small>Увійдіть, щоб бачити історію замовлень.</small></div>';
    if (el.loginToBank) el.loginToBank.hidden = false;
    if (el.guestBanner) {
      el.guestBanner.hidden = false;
      if (reason) {
        el.guestBanner.innerHTML = `<strong>Гостьовий режим:</strong> ${reason}`;
      }
    }
    renderCart();
  }

  function setAuthorizedMode() {
    state.authenticated = true;
    if (el.loginToBank) el.loginToBank.hidden = true;
    if (el.guestBanner) el.guestBanner.hidden = true;
  }

  function renderOrders() {
    el.ordersList.innerHTML = '';
    if (!state.orders.length) {
      el.ordersList.innerHTML = '<div class="order-item"><small>Ще немає замовлень.</small></div>';
      el.ordersCount.textContent = '0';
      return;
    }

    el.ordersCount.textContent = String(state.orders.length);
    for (const order of state.orders) {
      const box = document.createElement('article');
      box.className = 'order-item';
      box.innerHTML = `
        <div>
          <strong>Замовлення #${order.id}</strong><br/>
          <small>${new Date(order.created_at).toLocaleString('uk-UA')}</small>
        </div>
        <div style="text-align:right">
          <strong>${currencyFmt.format(Number(order.total_amount || 0))}</strong><br/>
          <small>${order.items_count} позицій</small>
        </div>
      `;
      el.ordersList.appendChild(box);
    }
  }

  async function fetchAccount() {
    const data = await api.request('/api/account');
    state.account = data;
    el.accountNumber.textContent = data.account_number || '—';
    el.accountBalance.textContent = currencyFmt.format(Number(data.balance || 0));
  }

  async function fetchCatalog() {
    const data = await api.request('/api/marketplace/catalog');
    state.products = data.items || [];
    renderCatalog();
  }

  async function fetchOrders() {
    const data = await api.request('/api/marketplace/orders?limit=20');
    state.orders = data.orders || [];
    renderOrders();
  }

  async function checkout(ev) {
    ev.preventDefault();
    if (!state.authenticated) {
      showToast('Увійдіть у ARM Bank для оплати.', true);
      return;
    }
    const items = cartPayload();
    if (!items.length) {
      showToast('Кошик порожній.', true);
      return;
    }

    const payload = {
      items,
      shipping_name: el.shippingName.value.trim(),
      shipping_phone: el.shippingPhone.value.trim(),
      shipping_address: el.shippingAddress.value.trim(),
      note: el.checkoutNote.value.trim(),
    };

    el.checkoutBtn.disabled = true;
    const oldText = el.checkoutBtn.textContent;
    el.checkoutBtn.textContent = 'Оплата...';
    try {
      const data = await api.request('/api/marketplace/checkout', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      state.cart.clear();
      renderCart();
      await Promise.all([fetchAccount(), fetchCatalog(), fetchOrders()]);
      showToast(`Замовлення #${data.order_id} оплачено`);
    } catch (err) {
      showToast(err?.serverMessage || err?.message || 'Помилка оплати', true);
    } finally {
      el.checkoutBtn.disabled = false;
      el.checkoutBtn.textContent = oldText;
    }
  }

  function onCatalogClick(ev) {
    const addBtn = ev.target.closest('[data-add-id]');
    if (!addBtn) return;
    const id = Number(addBtn.dataset.addId);
    const product = productById(id);
    if (!product || Number(product.stock || 0) <= 0) return;
    const current = state.cart.get(id) || 0;
    state.cart.set(id, current + 1);
    renderCart();
  }

  function onCartClick(ev) {
    const inc = ev.target.closest('[data-inc-id]');
    if (inc) {
      const id = Number(inc.dataset.incId);
      state.cart.set(id, (state.cart.get(id) || 0) + 1);
      renderCart();
      return;
    }
    const dec = ev.target.closest('[data-dec-id]');
    if (dec) {
      const id = Number(dec.dataset.decId);
      const next = (state.cart.get(id) || 0) - 1;
      if (next <= 0) state.cart.delete(id);
      else state.cart.set(id, next);
      renderCart();
    }
  }

  async function init() {
    el.backToBank.addEventListener('click', () => {
      window.location.href = getBankPath();
    });
    el.loginToBank?.addEventListener('click', () => {
      window.location.href = getBankPath();
    });
    el.catalogGrid.addEventListener('click', onCatalogClick);
    el.cartItems.addEventListener('click', onCartClick);
    el.checkoutForm.addEventListener('submit', checkout);
    el.catalogSearch?.addEventListener('input', renderCatalog);
    el.catalogSort?.addEventListener('change', renderCatalog);

    try {
      await fetchCatalog();
      if (api?.token) {
        await Promise.all([fetchAccount(), fetchOrders()]);
        setAuthorizedMode();
      } else {
        setGuestMode('каталог доступний, для оплати потрібна авторизація.');
      }
      renderCart();
    } catch (err) {
      if (Number(err?.status) === 401) {
        setGuestMode('сесія завершилась, увійдіть повторно.');
        showToast('Сесію оновлено. Увійдіть у банк для оплати.', true);
      } else {
        showToast(err?.serverMessage || err?.message || 'Не вдалося завантажити маркетплейс', true);
      }
    }
  }

  init();
})();

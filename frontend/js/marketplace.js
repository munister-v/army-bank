(function () {
  const currencyFmt = new Intl.NumberFormat('uk-UA', {
    style: 'currency',
    currency: 'UAH',
    maximumFractionDigits: 2,
  });

  const CATEGORY_HINTS = [
    { key: 'Смартфони', terms: ['phone', 'смартфон', 'iphone'] },
    { key: 'Ноутбуки', terms: ['laptop', 'book air', 'book pro', 'ноутбук', 'ультрабук'] },
    { key: 'ТВ та Монітори', terms: ['monitor', 'tv box', 'монітор', 'телев'] },
    { key: 'Аудіо', terms: ['speaker', 'earbuds', 'headphones', 'колонка', 'навуш'] },
    { key: 'Дім', terms: ['lamp', 'kettle', 'coffee', 'blender', 'vacuum', 'нічник', 'лампа', 'дім'] },
    { key: 'Розумний дім', terms: ['smart home', 'sensor', 'security cam', 'hub', 'датчик', 'камера'] },
    { key: 'Аксесуари', terms: ['holder', 'card', 'кард', 'аксес', 'cable', 'charger', 'organizer', 'backpack'] },
    { key: 'Одяг', terms: ['hoodie', 'одяг'] },
  ];

  const state = {
    products: [],
    cart: new Map(),
    orders: [],
    account: null,
    authenticated: false,
    activeCategory: 'all',
  };

  const el = {
    catalogGrid: document.getElementById('catalog-grid'),
    catalogCount: document.getElementById('catalog-count'),
    catalogSearch: document.getElementById('catalog-search'),
    catalogSort: document.getElementById('catalog-sort'),
    categoryList: document.getElementById('category-list'),
    filterInStock: document.getElementById('filter-in-stock'),
    filterMinPrice: document.getElementById('filter-min-price'),
    filterMaxPrice: document.getElementById('filter-max-price'),
    filterReset: document.getElementById('filter-reset'),
    toggleFilters: document.getElementById('toggle-filters'),
    filtersBackdrop: document.getElementById('filters-backdrop'),
    cartEmpty: document.getElementById('cart-empty'),
    cartItems: document.getElementById('cart-items'),
    cartTotal: document.getElementById('cart-total'),
    checkoutForm: document.getElementById('checkout-form'),
    checkoutBtn: document.getElementById('checkout-btn'),
    shippingName: document.getElementById('shipping-name'),
    shippingPhone: document.getElementById('shipping-phone'),
    shippingAddress: document.getElementById('shipping-address'),
    checkoutNote: document.getElementById('checkout-note'),
    accountNumber: document.getElementById('account-number'),
    accountBalance: document.getElementById('account-balance'),
    ordersCount: document.getElementById('orders-count'),
    ordersList: document.getElementById('orders-list'),
    loginToBank: document.getElementById('login-to-bank'),
    backToBank: document.getElementById('back-to-bank'),
    guestBanner: document.getElementById('guest-banner'),
    toast: document.getElementById('toast'),
  };

  function basePath() {
    return window.ARMY_BANK_BASE || '';
  }

  function isMobileFiltersMode() {
    return window.matchMedia('(max-width: 920px)').matches;
  }

  function setFiltersOpen(open) {
    const shouldOpen = !!open && isMobileFiltersMode();
    document.body.classList.toggle('filters-open', shouldOpen);
    if (el.filtersBackdrop) {
      el.filtersBackdrop.hidden = !shouldOpen;
    }
  }

  function getBankPath() {
    return `${basePath()}/app`;
  }

  function showToast(message, isError = false) {
    if (!el.toast) return;
    el.toast.textContent = message;
    el.toast.style.background = isError ? '#8e2b2b' : '#1f1f1f';
    el.toast.hidden = false;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => { el.toast.hidden = true; }, 2400);
  }

  function inferCategory(product) {
    const title = String(product?.title || '').toLowerCase();
    const description = String(product?.description || '').toLowerCase();
    const text = `${title} ${description}`;
    for (const hint of CATEGORY_HINTS) {
      if (hint.terms.some((term) => text.includes(term))) return hint.key;
    }
    return 'Інше';
  }

  function enrichProduct(item) {
    const id = Number(item?.id || 1);
    const rating = Number((4.1 + ((id * 13) % 8) / 10).toFixed(1));
    const reviews = 24 + ((id * 37) % 420);
    const price = Number(item?.price || 0);
    const oldPrice = Number((price * 1.19).toFixed(2));
    const discountPercent = Math.max(3, Math.round(((oldPrice - price) / Math.max(oldPrice, 1)) * 100));
    return {
      ...item,
      category: inferCategory(item),
      rating,
      reviews,
      oldPrice,
      discountPercent,
    };
  }

  function getProduct(id) {
    return state.products.find((p) => Number(p.id) === Number(id)) || null;
  }

  function getCartTotal() {
    let total = 0;
    for (const [id, qty] of state.cart.entries()) {
      const p = getProduct(id);
      if (!p) continue;
      total += Number(p.price || 0) * Number(qty || 0);
    }
    return Number(total.toFixed(2));
  }

  function getCartPayload() {
    return Array.from(state.cart.entries()).map(([id, qty]) => ({
      product_id: Number(id),
      qty: Number(qty),
    }));
  }

  function renderCategoryList() {
    if (!el.categoryList) return;
    const categories = ['all', ...new Set(state.products.map((p) => p.category).filter(Boolean))];
    el.categoryList.innerHTML = '';
    for (const category of categories) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `category-btn${state.activeCategory === category ? ' active' : ''}`;
      btn.dataset.category = category;
      btn.textContent = category === 'all' ? 'Усі товари' : category;
      el.categoryList.appendChild(btn);
    }
  }

  function getFilteredProducts() {
    const q = String(el.catalogSearch?.value || '').trim().toLowerCase();
    const sort = String(el.catalogSort?.value || 'popular');
    const minPrice = Number(el.filterMinPrice?.value || 0);
    const maxPrice = Number(el.filterMaxPrice?.value || 0);
    const inStockOnly = !!el.filterInStock?.checked;

    let list = [...state.products];
    if (state.activeCategory !== 'all') {
      list = list.filter((p) => p.category === state.activeCategory);
    }
    if (q) {
      list = list.filter((p) => {
        const hay = `${String(p.title || '')} ${String(p.description || '')}`.toLowerCase();
        return hay.includes(q);
      });
    }
    if (inStockOnly) {
      list = list.filter((p) => Number(p.stock || 0) > 0);
    }
    if (minPrice > 0) {
      list = list.filter((p) => Number(p.price || 0) >= minPrice);
    }
    if (maxPrice > 0) {
      list = list.filter((p) => Number(p.price || 0) <= maxPrice);
    }

    if (sort === 'cheap') {
      list.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
    } else if (sort === 'expensive') {
      list.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
    } else if (sort === 'title') {
      list.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'uk'));
    } else if (sort === 'rating') {
      list.sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0));
    } else {
      list.sort((a, b) => Number(b.reviews || 0) - Number(a.reviews || 0));
    }
    return list;
  }

  function renderCatalog() {
    if (!el.catalogGrid) return;
    const products = getFilteredProducts();
    if (el.catalogCount) {
      el.catalogCount.textContent = `${products.length} товарів`;
    }
    el.catalogGrid.innerHTML = '';
    if (!products.length) {
      el.catalogGrid.innerHTML = '<p>Нічого не знайдено за обраними фільтрами.</p>';
      return;
    }

    for (const item of products) {
      const inStock = Number(item.stock || 0) > 0;
      const stars = '★★★★★'.slice(0, Math.floor(item.rating)) + '☆☆☆☆☆'.slice(0, Math.max(0, 5 - Math.floor(item.rating)));
      const product = document.createElement('article');
      product.className = 'rz-product';
      product.innerHTML = `
        <div class="rz-thumb">
          <span class="rz-discount">-${item.discountPercent}%</span>
          ${item.image_emoji || '🛍️'}
        </div>
        <div class="rz-content">
          <h3 class="rz-title">${item.title || 'Товар'}</h3>
          <div class="rz-meta">
            <span class="rz-stars">${stars}</span>
            <span>${item.rating.toFixed(1)} · ${item.reviews}</span>
          </div>
          <div class="rz-meta">
            <span class="rz-stock ${inStock ? '' : 'out'}">${inStock ? 'Є в наявності' : 'Немає в наявності'}</span>
            <span>${item.badge ? item.badge : item.category}</span>
          </div>
          <div class="rz-price-wrap">
            <div>
              <div class="rz-price-main">${currencyFmt.format(Number(item.price || 0))}</div>
              <div class="rz-price-old">${currencyFmt.format(Number(item.oldPrice || 0))}</div>
            </div>
            <button class="btn btn-add" data-add-id="${item.id}" type="button" ${inStock ? '' : 'disabled'}>
              Купити
            </button>
          </div>
        </div>
      `;
      el.catalogGrid.appendChild(product);
    }
  }

  function renderCart() {
    if (!el.cartItems) return;
    const entries = Array.from(state.cart.entries());
    el.cartItems.innerHTML = '';
    if (el.cartEmpty) {
      el.cartEmpty.style.display = entries.length ? 'none' : 'block';
    }
    for (const [id, qty] of entries) {
      const item = getProduct(id);
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
    const total = getCartTotal();
    if (el.cartTotal) el.cartTotal.textContent = currencyFmt.format(total);
    if (el.checkoutBtn) el.checkoutBtn.disabled = !state.authenticated || total <= 0;
  }

  function setGuestMode(reason = '') {
    state.authenticated = false;
    state.orders = [];
    if (el.loginToBank) el.loginToBank.hidden = false;
    if (el.guestBanner) {
      el.guestBanner.hidden = false;
      el.guestBanner.innerHTML = `<strong>Гостьовий режим:</strong> ${reason || 'для оплати потрібна авторизація.'}`;
    }
    if (el.accountNumber) el.accountNumber.textContent = 'Потрібен вхід';
    if (el.accountBalance) el.accountBalance.textContent = '—';
    if (el.ordersCount) el.ordersCount.textContent = '0';
    if (el.ordersList) {
      el.ordersList.innerHTML = '<div class="order-item"><small>Увійдіть, щоб переглядати замовлення.</small></div>';
    }
    renderCart();
  }

  function setAuthorizedMode() {
    state.authenticated = true;
    if (el.loginToBank) el.loginToBank.hidden = true;
    if (el.guestBanner) el.guestBanner.hidden = true;
  }

  function renderOrders() {
    if (!el.ordersList) return;
    el.ordersList.innerHTML = '';
    if (!state.orders.length) {
      el.ordersList.innerHTML = '<div class="order-item"><small>Ще немає замовлень.</small></div>';
      if (el.ordersCount) el.ordersCount.textContent = '0';
      return;
    }
    if (el.ordersCount) el.ordersCount.textContent = String(state.orders.length);
    for (const order of state.orders) {
      const node = document.createElement('article');
      node.className = 'order-item';
      node.innerHTML = `
        <div>
          <strong>Замовлення #${order.id}</strong><br/>
          <small>${new Date(order.created_at).toLocaleString('uk-UA')}</small>
        </div>
        <div style="text-align:right">
          <strong>${currencyFmt.format(Number(order.total_amount || 0))}</strong><br/>
          <small>${order.items_count} позицій</small>
        </div>
      `;
      el.ordersList.appendChild(node);
    }
  }

  async function fetchCatalog() {
    const data = await api.request('/api/marketplace/catalog');
    state.products = (data.items || []).map(enrichProduct);
    renderCategoryList();
    renderCatalog();
  }

  async function fetchAccount() {
    const data = await api.request('/api/account');
    state.account = data;
    if (el.accountNumber) el.accountNumber.textContent = data.account_number || '—';
    if (el.accountBalance) el.accountBalance.textContent = currencyFmt.format(Number(data.balance || 0));
  }

  async function fetchOrders() {
    const data = await api.request('/api/marketplace/orders?limit=20');
    state.orders = data.orders || [];
    renderOrders();
  }

  async function checkout(event) {
    event.preventDefault();
    if (!state.authenticated) {
      showToast('Увійдіть в ARM Bank для оплати.', true);
      return;
    }
    const items = getCartPayload();
    if (!items.length) {
      showToast('Кошик порожній.', true);
      return;
    }

    const payload = {
      items,
      shipping_name: String(el.shippingName?.value || '').trim(),
      shipping_phone: String(el.shippingPhone?.value || '').trim(),
      shipping_address: String(el.shippingAddress?.value || '').trim(),
      note: String(el.checkoutNote?.value || '').trim(),
    };

    const oldText = el.checkoutBtn ? el.checkoutBtn.textContent : '';
    if (el.checkoutBtn) {
      el.checkoutBtn.disabled = true;
      el.checkoutBtn.textContent = 'Оформлення...';
    }
    try {
      const data = await api.request('/api/marketplace/checkout', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      state.cart.clear();
      renderCart();
      await Promise.all([fetchAccount(), fetchCatalog(), fetchOrders()]);
      showToast(`Замовлення #${data.order_id} успішно оформлено`);
    } catch (err) {
      showToast(err?.serverMessage || err?.message || 'Помилка оплати', true);
    } finally {
      if (el.checkoutBtn) {
        el.checkoutBtn.disabled = false;
        el.checkoutBtn.textContent = oldText || 'Оформити через ARM Bank';
      }
    }
  }

  function onCatalogClick(event) {
    const addBtn = event.target.closest('[data-add-id]');
    if (!addBtn) return;
    const id = Number(addBtn.dataset.addId);
    const product = getProduct(id);
    if (!product || Number(product.stock || 0) <= 0) return;
    const current = state.cart.get(id) || 0;
    state.cart.set(id, current + 1);
    renderCart();
  }

  function onCartClick(event) {
    const incBtn = event.target.closest('[data-inc-id]');
    if (incBtn) {
      const id = Number(incBtn.dataset.incId);
      state.cart.set(id, (state.cart.get(id) || 0) + 1);
      renderCart();
      return;
    }
    const decBtn = event.target.closest('[data-dec-id]');
    if (decBtn) {
      const id = Number(decBtn.dataset.decId);
      const next = (state.cart.get(id) || 0) - 1;
      if (next <= 0) state.cart.delete(id);
      else state.cart.set(id, next);
      renderCart();
    }
  }

  function resetFilters() {
    state.activeCategory = 'all';
    if (el.filterInStock) el.filterInStock.checked = false;
    if (el.filterMinPrice) el.filterMinPrice.value = '';
    if (el.filterMaxPrice) el.filterMaxPrice.value = '';
    if (el.catalogSort) el.catalogSort.value = 'popular';
    if (el.catalogSearch) el.catalogSearch.value = '';
    renderCategoryList();
    renderCatalog();
    setFiltersOpen(false);
  }

  function bindEvents() {
    el.backToBank?.addEventListener('click', () => {
      window.location.href = getBankPath();
    });
    el.loginToBank?.addEventListener('click', () => {
      window.location.href = getBankPath();
    });
    el.catalogGrid?.addEventListener('click', onCatalogClick);
    el.cartItems?.addEventListener('click', onCartClick);
    el.checkoutForm?.addEventListener('submit', checkout);
    el.catalogSearch?.addEventListener('input', renderCatalog);
    el.catalogSort?.addEventListener('change', renderCatalog);
    el.filterInStock?.addEventListener('change', renderCatalog);
    el.filterMinPrice?.addEventListener('input', renderCatalog);
    el.filterMaxPrice?.addEventListener('input', renderCatalog);
    el.filterReset?.addEventListener('click', resetFilters);
    el.toggleFilters?.addEventListener('click', () => {
      const isOpen = document.body.classList.contains('filters-open');
      setFiltersOpen(!isOpen);
    });
    el.filtersBackdrop?.addEventListener('click', () => setFiltersOpen(false));
    el.categoryList?.addEventListener('click', (event) => {
      const btn = event.target.closest('.category-btn');
      if (!btn) return;
      state.activeCategory = String(btn.dataset.category || 'all');
      renderCategoryList();
      renderCatalog();
      setFiltersOpen(false);
    });
    window.addEventListener('resize', () => {
      if (!isMobileFiltersMode()) setFiltersOpen(false);
    });
  }

  async function init() {
    bindEvents();
    try {
      await fetchCatalog();
      if (api?.token) {
        await Promise.all([fetchAccount(), fetchOrders()]);
        setAuthorizedMode();
      } else {
        setGuestMode('переглядайте товари та увійдіть для оплати.');
      }
      renderCart();
    } catch (err) {
      if (Number(err?.status) === 401) {
        setGuestMode('сесія завершилася, увійдіть повторно.');
        showToast('Потрібна авторизація для оплати.', true);
      } else {
        showToast(err?.serverMessage || err?.message || 'Не вдалося завантажити маркетплейс', true);
      }
    }
  }

  init();
})();

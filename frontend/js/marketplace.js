(function () {
  /* ═══════════════════════════════════════
     Helpers
     ═══════════════════════════════════════ */
  const moneyFmt = new Intl.NumberFormat('uk-UA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  function formatMoney(value) {
    return `₴${moneyFmt.format(Number(value || 0))}`;
  }

  /* ── Star SVG ── */
  const STAR_FULL = '<svg class="rz-star" viewBox="0 0 20 20"><path fill="currentColor" d="M10 1.3l2.4 5.5 5.9.5-4.5 3.8 1.5 5.8L10 13.8l-5.3 3.1 1.5-5.8L1.7 7.3l5.9-.5z"/></svg>';
  const STAR_EMPTY = '<svg class="rz-star empty" viewBox="0 0 20 20"><path fill="currentColor" d="M10 1.3l2.4 5.5 5.9.5-4.5 3.8 1.5 5.8L10 13.8l-5.3 3.1 1.5-5.8L1.7 7.3l5.9-.5z"/></svg>';

  function renderStars(rating) {
    const full = Math.round(Number(rating) || 0);
    let html = '';
    for (let i = 0; i < 5; i++) {
      html += i < full ? STAR_FULL : STAR_EMPTY;
    }
    return html;
  }

  /* ── Category mapping ── */
  const TOP_CATEGORIES = [
    'Ноутбуки та комп\u2019ютери',
    'Смартфони',
    'Побутова техніка',
    'Товари для дому',
    'Акції ARM',
  ];

  const CATEGORY_HINTS = [
    { key: 'Смартфони', terms: ['phone', 'смартфон', 'iphone', 'galaxy', 'pixel', 'xiaomi', 'oneplus', 'honor', 'earbuds', 'навушник'] },
    { key: 'Ноутбуки та комп\u2019ютери', terms: ['laptop', 'book air', 'book pro', 'ноутбук', 'ультрабук', 'комп', 'desktop', 'keyboard', 'mouse', 'monitor', 'webcam', 'router', 'tv', 'телевізор'] },
    { key: 'Побутова техніка', terms: ['kettle', 'coffee', 'blender', 'vacuum', 'fryer', 'чайник', 'кавоварка', 'блендер', 'пилосос', 'техніка', 'robot'] },
    { key: 'Товари для дому', terms: ['lamp', 'home', 'sensor', 'security cam', 'hub', 'нічник', 'лампа', 'дім', 'органайзер', 'рюкзак', 'light', 'smart bulb', 'door'] },
  ];

  const CATEGORY_ICONS = {
    'Ноутбуки та комп\u2019ютери': 'bi-laptop',
    'Смартфони': 'bi-phone',
    'Побутова техніка': 'bi-house-gear',
    'Товари для дому': 'bi-house-heart',
    'Акції ARM': 'bi-stars',
  };

  /** Maps category → data-cat attribute for CSS gradients */
  const CATEGORY_THUMB = {
    'Смартфони': 'phones',
    'Ноутбуки та комп\u2019ютери': 'laptops',
    'Побутова техніка': 'appliances',
    'Товари для дому': 'home',
    'Акції ARM': 'promo',
  };

  /* ── Fallback products ── */
  const FALLBACK_PRODUCTS = [
    { id: 9001, title: 'ARM Phone Max 512GB', description: 'Флагманський смартфон 6.8\u2033, 120Hz, 120W', price: 29999, badge: 'TOP', stock: 18 },
    { id: 9002, title: 'ARM Phone Lite 5G', description: 'Смартфон 120Hz, NFC, батарея 5000mAh', price: 13999, badge: 'ARM DEAL', stock: 44 },
    { id: 9003, title: 'ARM Book Pro 15', description: 'Ноутбук для роботи, 32GB RAM, 1TB SSD', price: 45999, badge: 'PRO', stock: 9 },
    { id: 9004, title: 'ARM Book Air 14', description: 'Легкий ультрабук для щоденних задач', price: 32999, badge: 'NEW', stock: 17 },
    { id: 9005, title: 'ARM Monitor 27 QHD', description: 'Монітор 27\u2033, 165Hz, HDR', price: 11999, badge: 'HOT', stock: 28 },
    { id: 9006, title: 'ARM Router AX3000', description: 'Wi\u2011Fi 6 роутер для дому та офісу', price: 3599, badge: null, stock: 41 },
    { id: 9007, title: 'ARM Earbuds Pro', description: 'Бездротові навушники з ANC', price: 3299, badge: 'SALE', stock: 32 },
    { id: 9008, title: 'ARM Smart TV 50 4K', description: '4K телевізор з Dolby Vision', price: 18999, badge: 'TOP', stock: 20 },
    { id: 9009, title: 'ARM Coffee Pro', description: 'Кавоварка з капучинатором', price: 8499, badge: null, stock: 12 },
    { id: 9010, title: 'ARM Robot Vacuum', description: 'Робот\u2011пилосос з вологим прибиранням', price: 12499, badge: 'HOT', stock: 16 },
    { id: 9011, title: 'ARM Smart Lamp', description: 'Настільна лампа з керуванням зі смартфона', price: 1599, badge: null, stock: 32 },
    { id: 9012, title: 'ARM Home Security Kit', description: 'Камера + датчики + хаб', price: 7299, badge: 'ARM DEAL', stock: 17 },
  ];

  function useFallbackCatalog(reason) {
    state.products = FALLBACK_PRODUCTS.map(enrichProduct);
    renderCategoryList();
    renderCatalog();
    if (reason) showToast(reason, true);
  }

  /* ═══════════════════════════════════════
     State
     ═══════════════════════════════════════ */
  const state = {
    products: [],
    cart: new Map(),
    orders: [],
    account: null,
    authenticated: false,
    activeCategory: 'all',
  };

  const ORDER_STATUS_LABELS = {
    paid: 'Оплачено',
    awaiting_payment: 'Очікує оплату',
    invoice_expired: 'Інвойс прострочено',
  };

  /* ═══════════════════════════════════════
     DOM refs
     ═══════════════════════════════════════ */
  const el = {
    catalogGrid: document.getElementById('catalog-grid'),
    catalogCount: document.getElementById('catalog-count'),
    catalogSearch: document.getElementById('catalog-search'),
    catalogSort: document.getElementById('catalog-sort'),
    categoryList: document.getElementById('category-list'),
    filterReset: document.getElementById('filter-reset'),
    toggleFilters: document.getElementById('toggle-filters'),
    filtersBackdrop: document.getElementById('filters-backdrop'),
    cartEmpty: document.getElementById('cart-empty'),
    cartItems: document.getElementById('cart-items'),
    cartTotal: document.getElementById('cart-total'),
    cartBadge: document.getElementById('cart-badge-count'),
    cartHeaderBtn: document.getElementById('cart-header-btn'),
    checkoutForm: document.getElementById('checkout-form'),
    checkoutBtn: document.getElementById('checkout-btn'),
    shippingName: document.getElementById('shipping-name'),
    shippingAddress: document.getElementById('shipping-address'),
    paymentMode: document.getElementById('payment-mode'),
    paymentModeHint: document.getElementById('payment-mode-hint'),
    accountNumber: document.getElementById('account-number'),
    accountBalance: document.getElementById('account-balance'),
    ordersCount: document.getElementById('orders-count'),
    ordersList: document.getElementById('orders-list'),
    loginToBank: document.getElementById('login-to-bank'),
    backToBank: document.getElementById('back-to-bank'),
    guestBanner: document.getElementById('guest-banner'),
    toast: document.getElementById('toast'),
    catalogTitle: document.getElementById('catalog-title'),
    topCategoryNav: document.querySelector('.rz-subnav'),
  };

  /* ═══════════════════════════════════════
     Utilities
     ═══════════════════════════════════════ */
  function basePath() {
    return window.ARMY_BANK_BASE || '';
  }

  function isMobileFiltersMode() {
    return window.matchMedia('(max-width: 920px)').matches;
  }

  function setFiltersOpen(open) {
    const shouldOpen = !!open && isMobileFiltersMode();
    document.body.classList.toggle('filters-open', shouldOpen);
    if (el.filtersBackdrop) el.filtersBackdrop.hidden = !shouldOpen;
  }

  function getBankPath() {
    return `${basePath()}/app`;
  }

  /* ── Toast with animation ── */
  let toastTimer = 0;

  function showToast(message, isError) {
    if (!el.toast) return;
    el.toast.textContent = message;
    el.toast.style.background = isError ? '#8c1d29' : 'var(--ink)';
    el.toast.hidden = false;
    // Force reflow before adding class
    void el.toast.offsetHeight;
    el.toast.classList.add('toast-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.classList.remove('toast-visible');
      setTimeout(() => { el.toast.hidden = true; }, 300);
    }, 2800);
  }

  function createIdempotencyKey(scope) {
    const randomPart = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${scope}-${randomPart}`;
  }

  function updatePaymentModeHint() {
    const mode = String(el.paymentMode?.value || 'pay_now');
    if (!el.paymentModeHint || !el.checkoutBtn) return;
    if (mode === 'invoice') {
      el.paymentModeHint.textContent = 'Інвойс діє 24 години. Товар резервується після оформлення.';
      el.checkoutBtn.textContent = 'Виставити інвойс';
    } else {
      el.paymentModeHint.textContent = 'Миттєве списання коштів після підтвердження замовлення.';
      el.checkoutBtn.textContent = 'Оформити через ARM Bank';
    }
  }

  /* ═══════════════════════════════════════
     Product data enrichment
     ═══════════════════════════════════════ */
  function inferCategory(product) {
    const badge = String(product?.badge || '').toUpperCase();
    if (badge && ['SALE', 'HOT', 'TOP', 'NEW', 'ARM DEAL'].includes(badge)) {
      return 'Акції ARM';
    }
    const text = `${String(product?.title || '')} ${String(product?.description || '')}`.toLowerCase();
    for (const hint of CATEGORY_HINTS) {
      if (hint.terms.some((t) => text.includes(t))) return hint.key;
    }
    return 'Товари для дому';
  }

  function enrichProduct(item) {
    const id = Number(item?.id || 1);
    const rating = Number((4.1 + ((id * 13) % 8) / 10).toFixed(1));
    const reviews = 24 + ((id * 37) % 420);
    const price = Number(item?.price || 0);
    const oldPrice = Number((price * 1.19).toFixed(2));
    const discountPercent = Math.max(3, Math.round(((oldPrice - price) / Math.max(oldPrice, 1)) * 100));
    const category = inferCategory(item);
    return {
      ...item,
      category,
      rating,
      reviews,
      oldPrice,
      discountPercent,
      iconClass: CATEGORY_ICONS[category] || 'bi-bag',
      thumbCat: CATEGORY_THUMB[category] || 'home',
    };
  }

  function getProduct(id) {
    return state.products.find((p) => Number(p.id) === Number(id)) || null;
  }

  /* ═══════════════════════════════════════
     Cart logic
     ═══════════════════════════════════════ */
  function getCartTotal() {
    let total = 0;
    for (const [id, qty] of state.cart.entries()) {
      const p = getProduct(id);
      if (p) total += Number(p.price || 0) * Number(qty || 0);
    }
    return Number(total.toFixed(2));
  }

  function getCartCount() {
    let count = 0;
    for (const qty of state.cart.values()) count += qty;
    return count;
  }

  function getCartPayload() {
    return Array.from(state.cart.entries()).map(([id, qty]) => ({
      product_id: Number(id),
      qty: Number(qty),
    }));
  }

  /* ═══════════════════════════════════════
     Skeleton loading
     ═══════════════════════════════════════ */
  function renderSkeleton(count) {
    if (!el.catalogGrid) return;
    el.catalogGrid.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const skel = document.createElement('div');
      skel.className = 'rz-skeleton';
      skel.setAttribute('aria-hidden', 'true');
      skel.innerHTML = `
        <div class="rz-skel-thumb"></div>
        <div class="rz-skel-body">
          <div class="rz-skel-line w60"></div>
          <div class="rz-skel-line w80"></div>
          <div class="rz-skel-line w40"></div>
        </div>
      `;
      el.catalogGrid.appendChild(skel);
    }
  }

  /* ═══════════════════════════════════════
     Render: categories
     ═══════════════════════════════════════ */
  function renderCategoryList() {
    if (!el.categoryList) return;
    const categories = ['all', ...TOP_CATEGORIES];
    el.categoryList.innerHTML = '';
    for (const cat of categories) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `category-btn${state.activeCategory === cat ? ' active' : ''}`;
      btn.dataset.category = cat;
      btn.textContent = cat === 'all' ? 'Усі товари' : cat;
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', state.activeCategory === cat ? 'true' : 'false');
      el.categoryList.appendChild(btn);
    }
  }

  function syncTopCategoryUI() {
    if (el.catalogTitle) {
      el.catalogTitle.textContent = state.activeCategory === 'all'
        ? 'Товари для дому та техніки'
        : state.activeCategory;
    }
    if (!el.topCategoryNav) return;
    el.topCategoryNav.querySelectorAll('[data-top-category]').forEach((btn) => {
      btn.classList.toggle('active', String(btn.dataset.topCategory || 'all') === state.activeCategory);
    });
  }

  /* ═══════════════════════════════════════
     Render: catalog
     ═══════════════════════════════════════ */
  function getFilteredProducts() {
    const q = String(el.catalogSearch?.value || '').trim().toLowerCase();
    const sort = String(el.catalogSort?.value || 'popular');

    let list = [...state.products];
    if (state.activeCategory !== 'all') {
      if (state.activeCategory === 'Акції ARM') {
        list = list.filter((p) => p.category === 'Акції ARM' || ['SALE', 'HOT', 'TOP', 'NEW', 'ARM DEAL'].includes(String(p.badge || '').toUpperCase()));
      } else {
        list = list.filter((p) => p.category === state.activeCategory);
      }
    }
    if (q) {
      list = list.filter((p) => `${String(p.title || '')} ${String(p.description || '')}`.toLowerCase().includes(q));
    }

    if (sort === 'cheap') list.sort((a, b) => Number(a.price) - Number(b.price));
    else if (sort === 'expensive') list.sort((a, b) => Number(b.price) - Number(a.price));
    else if (sort === 'title') list.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'uk'));
    else if (sort === 'rating') list.sort((a, b) => Number(b.rating) - Number(a.rating));
    else list.sort((a, b) => Number(b.reviews) - Number(a.reviews));

    return list;
  }

  function renderCatalog() {
    if (!el.catalogGrid) return;
    const products = getFilteredProducts();
    if (el.catalogCount) el.catalogCount.textContent = `${products.length} товарів`;
    syncTopCategoryUI();

    el.catalogGrid.innerHTML = '';
    if (!products.length) {
      el.catalogGrid.innerHTML = '<p>Нічого не знайдено за обраними фільтрами.</p>';
      return;
    }

    for (const item of products) {
      const inStock = Number(item.stock || 0) > 0;
      const badge = String(item.badge || '').toUpperCase();
      const card = document.createElement('article');
      card.className = 'rz-product';
      card.setAttribute('role', 'listitem');

      card.innerHTML = `
        <div class="rz-thumb" data-cat="${item.thumbCat}">
          <span class="rz-thumb-brand">ARM</span>
          <i class="bi ${item.iconClass}" aria-hidden="true"></i>
          ${item.discountPercent >= 5 ? `<span class="rz-discount">-${item.discountPercent}%</span>` : ''}
        </div>
        <div class="rz-content">
          ${badge ? `<span class="rz-badge" data-badge="${badge}">${badge}</span>` : `<span class="rz-product-category">${item.category}</span>`}
          <h3 class="rz-title">${item.title || 'Товар'}</h3>
          <div class="rz-meta">
            <span class="rz-rating">
              <span class="rz-stars" aria-label="Рейтинг ${item.rating} з 5">${renderStars(item.rating)}</span>
              ${item.rating.toFixed(1)}
            </span>
            <span class="rz-stock${inStock ? '' : ' out'}">${inStock ? 'В наявності' : 'Немає'}</span>
          </div>
          <div class="rz-price-wrap">
            <div>
              <div class="rz-price-main">${formatMoney(item.price)}</div>
              ${item.discountPercent >= 5 ? `<div class="rz-price-old">${formatMoney(item.oldPrice)}</div>` : ''}
            </div>
            <button class="btn btn-add" data-add-id="${item.id}" type="button" ${inStock ? '' : 'disabled'} aria-label="Додати ${item.title} до кошика">
              <i class="bi bi-plus" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      `;
      el.catalogGrid.appendChild(card);
    }
  }

  /* ═══════════════════════════════════════
     Render: cart
     ═══════════════════════════════════════ */
  function updateCartBadge() {
    const count = getCartCount();
    if (el.cartBadge) {
      el.cartBadge.textContent = count > 0 ? String(count) : '';
      el.cartBadge.dataset.count = String(count);
    }
  }

  function renderCart() {
    if (!el.cartItems) return;
    const entries = Array.from(state.cart.entries());
    el.cartItems.innerHTML = '';

    if (el.cartEmpty) el.cartEmpty.style.display = entries.length ? 'none' : '';

    for (const [id, qty] of entries) {
      const item = getProduct(id);
      if (!item) continue;
      const row = document.createElement('div');
      row.className = 'cart-item';
      row.innerHTML = `
        <div>
          <div class="cart-item-name">${item.title}</div>
          <div class="cart-item-meta">${formatMoney(item.price)} \u00d7 ${qty}</div>
        </div>
        <div class="qty-controls">
          <button class="qty-btn" type="button" data-dec-id="${item.id}" aria-label="Зменшити">−</button>
          <strong>${qty}</strong>
          <button class="qty-btn" type="button" data-inc-id="${item.id}" aria-label="Збільшити">+</button>
        </div>
      `;
      el.cartItems.appendChild(row);
    }

    const total = getCartTotal();
    if (el.cartTotal) el.cartTotal.textContent = formatMoney(total);
    if (el.checkoutBtn) el.checkoutBtn.disabled = !state.authenticated || total <= 0;
    updateCartBadge();
  }

  /* ═══════════════════════════════════════
     Auth modes
     ═══════════════════════════════════════ */
  function setGuestMode(reason) {
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

  /* ═══════════════════════════════════════
     Render: orders
     ═══════════════════════════════════════ */
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
      const status = String(order.status || 'paid');
      const badgeClass = status === 'paid' ? 'paid' : (status === 'awaiting_payment' ? 'awaiting' : 'expired');
      const statusLabel = ORDER_STATUS_LABELS[status] || status;
      const invoiceLabel = order.invoice_number ? `Інвойс: ${order.invoice_number}` : '';
      const dueLabel = order.invoice_due_at ? `до ${new Date(order.invoice_due_at).toLocaleString('uk-UA')}` : '';
      const canPay = status === 'awaiting_payment' && order.invoice_number;

      const node = document.createElement('article');
      node.className = 'order-item';
      node.setAttribute('role', 'listitem');
      node.innerHTML = `
        <div class="order-main">
          <strong>Замовлення #${order.id}</strong>
          <small>${new Date(order.created_at).toLocaleString('uk-UA')}</small>
          <span class="order-status ${badgeClass}">${statusLabel}</span>
          ${invoiceLabel ? `<small>${invoiceLabel} ${dueLabel}</small>` : ''}
        </div>
        <div class="order-actions">
          <strong>${formatMoney(Number(order.total_amount || 0))}</strong>
          <small>${order.items_count} позицій</small>
          ${canPay ? `<button class="order-pay-btn" data-invoice-pay="${order.invoice_number}" type="button">Оплатити інвойс</button>` : ''}
        </div>
      `;
      el.ordersList.appendChild(node);
    }
  }

  /* ═══════════════════════════════════════
     API calls
     ═══════════════════════════════════════ */
  async function fetchCatalog() {
    try {
      const data = await api.request('/api/marketplace/catalog');
      const fromApi = Array.isArray(data?.items) ? data.items : [];
      if (!fromApi.length) {
        useFallbackCatalog('Каталог оновлюється: показано рекомендовані товари ARM.');
        return;
      }
      state.products = fromApi.map(enrichProduct);
      renderCategoryList();
      renderCatalog();
    } catch (err) {
      useFallbackCatalog('Проблема з мережею: показано локальний каталог ARM.');
    }
  }

  async function fetchAccount() {
    const data = await api.request('/api/account');
    state.account = data;
    if (el.accountNumber) el.accountNumber.textContent = data.account_number || '—';
    if (el.accountBalance) el.accountBalance.textContent = formatMoney(Number(data.balance || 0));
  }

  async function fetchOrders() {
    const data = await api.request('/api/marketplace/orders?limit=20');
    state.orders = data.orders || [];
    renderOrders();
  }

  /* ═══════════════════════════════════════
     Checkout
     ═══════════════════════════════════════ */
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

    const idempotencyKey = createIdempotencyKey('market-checkout');
    const payload = {
      items,
      shipping_name: String(el.shippingName?.value || '').trim(),
      shipping_address: String(el.shippingAddress?.value || '').trim(),
      payment_mode: String(el.paymentMode?.value || 'pay_now'),
      idempotency_key: idempotencyKey,
    };

    const oldText = el.checkoutBtn ? el.checkoutBtn.textContent : '';
    if (el.checkoutBtn) {
      el.checkoutBtn.disabled = true;
      el.checkoutBtn.textContent = 'Оформлення\u2026';
    }

    try {
      const data = await api.request('/api/marketplace/checkout', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(payload),
      });
      state.cart.clear();
      renderCart();
      await Promise.all([fetchAccount(), fetchCatalog(), fetchOrders()]);
      if (String(data.payment_mode || '') === 'invoice') {
        showToast(`Інвойс ${data.invoice_number} створено. Оплатіть до 24 годин.`);
      } else {
        const authCode = data.payment_authorization?.authorization_code;
        showToast(authCode
          ? `Оплату авторизовано (${authCode}). Замовлення #${data.order_id} оформлено`
          : `Замовлення #${data.order_id} успішно оформлено`);
      }
    } catch (err) {
      showToast(err?.serverMessage || err?.message || 'Помилка оплати', true);
    } finally {
      if (el.checkoutBtn) {
        el.checkoutBtn.disabled = false;
        el.checkoutBtn.textContent = oldText || 'Оформити через ARM Bank';
        updatePaymentModeHint();
      }
    }
  }

  async function payInvoice(invoiceNumber, btn) {
    const key = String(invoiceNumber || '').trim();
    if (!key) return;
    const prevText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Оплата\u2026'; }

    const idempotencyKey = createIdempotencyKey(`invoice-${key}`);
    try {
      const data = await api.request(`/api/marketplace/invoice/${encodeURIComponent(key)}/pay`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ idempotency_key: idempotencyKey }),
      });
      await Promise.all([fetchAccount(), fetchOrders()]);
      const authCode = data.payment_authorization?.authorization_code;
      showToast(authCode
        ? `Інвойс ${data.invoice_number} оплачено. Авторизація ${authCode}`
        : `Інвойс ${data.invoice_number} оплачено`);
    } catch (err) {
      showToast(err?.serverMessage || err?.message || 'Не вдалося оплатити інвойс', true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = prevText || 'Оплатити інвойс'; }
    }
  }

  /* ═══════════════════════════════════════
     Event handlers
     ═══════════════════════════════════════ */
  function onCatalogClick(event) {
    const addBtn = event.target.closest('[data-add-id]');
    if (!addBtn) return;
    const id = Number(addBtn.dataset.addId);
    const product = getProduct(id);
    if (!product || Number(product.stock || 0) <= 0) return;
    state.cart.set(id, (state.cart.get(id) || 0) + 1);
    renderCart();
    showToast(`${product.title} додано до кошика`);
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

  function onOrdersClick(event) {
    const payBtn = event.target.closest('[data-invoice-pay]');
    if (!payBtn) return;
    payInvoice(payBtn.dataset.invoicePay, payBtn);
  }

  function resetFilters() {
    state.activeCategory = 'all';
    if (el.catalogSort) el.catalogSort.value = 'popular';
    if (el.catalogSearch) el.catalogSearch.value = '';
    renderCategoryList();
    renderCatalog();
    setFiltersOpen(false);
  }

  /* ═══════════════════════════════════════
     Bind events
     ═══════════════════════════════════════ */
  function bindEvents() {
    el.backToBank?.addEventListener('click', () => { window.location.href = getBankPath(); });
    el.loginToBank?.addEventListener('click', () => { window.location.href = getBankPath(); });

    el.cartHeaderBtn?.addEventListener('click', () => {
      document.querySelector('.rz-cart')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    el.catalogGrid?.addEventListener('click', onCatalogClick);
    el.cartItems?.addEventListener('click', onCartClick);
    el.checkoutForm?.addEventListener('submit', checkout);
    el.paymentMode?.addEventListener('change', updatePaymentModeHint);

    let searchTimer = 0;
    el.catalogSearch?.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderCatalog, 200);
    });

    el.catalogSort?.addEventListener('change', renderCatalog);
    el.filterReset?.addEventListener('click', resetFilters);
    el.ordersList?.addEventListener('click', onOrdersClick);

    el.toggleFilters?.addEventListener('click', () => {
      setFiltersOpen(!document.body.classList.contains('filters-open'));
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

    el.topCategoryNav?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-top-category]');
      if (!btn) return;
      state.activeCategory = String(btn.dataset.topCategory || 'all');
      renderCategoryList();
      renderCatalog();
      setFiltersOpen(false);
    });

    window.addEventListener('resize', () => {
      if (!isMobileFiltersMode()) setFiltersOpen(false);
    });
  }

  /* ═══════════════════════════════════════
     Init
     ═══════════════════════════════════════ */
  async function init() {
    bindEvents();
    updatePaymentModeHint();
    renderSkeleton(8);

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

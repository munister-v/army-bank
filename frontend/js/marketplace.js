(function () {
  /* ═══════════════════════════════════════
     Helpers
     ═══════════════════════════════════════ */
  const moneyFmt = new Intl.NumberFormat('uk-UA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  function formatMoney(value) {
    return `\u20b4${moneyFmt.format(Number(value || 0))}`;
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
    '\u041d\u043e\u0443\u0442\u0431\u0443\u043a\u0438 \u0442\u0430 \u043a\u043e\u043c\u043f\u2019\u044e\u0442\u0435\u0440\u0438',
    '\u0421\u043c\u0430\u0440\u0442\u0444\u043e\u043d\u0438',
    '\u041f\u043e\u0431\u0443\u0442\u043e\u0432\u0430 \u0442\u0435\u0445\u043d\u0456\u043a\u0430',
    '\u0422\u043e\u0432\u0430\u0440\u0438 \u0434\u043b\u044f \u0434\u043e\u043c\u0443',
    '\u0410\u043a\u0446\u0456\u0457 ARM',
  ];

  const CATEGORY_HINTS = [
    { key: '\u0421\u043c\u0430\u0440\u0442\u0444\u043e\u043d\u0438', terms: ['phone', '\u0441\u043c\u0430\u0440\u0442\u0444\u043e\u043d', 'iphone', 'galaxy', 'pixel', 'xiaomi', 'oneplus', 'honor', 'earbuds', '\u043d\u0430\u0432\u0443\u0448\u043d\u0438\u043a'] },
    { key: '\u041d\u043e\u0443\u0442\u0431\u0443\u043a\u0438 \u0442\u0430 \u043a\u043e\u043c\u043f\u2019\u044e\u0442\u0435\u0440\u0438', terms: ['laptop', 'book air', 'book pro', '\u043d\u043e\u0443\u0442\u0431\u0443\u043a', '\u0443\u043b\u044c\u0442\u0440\u0430\u0431\u0443\u043a', '\u043a\u043e\u043c\u043f', 'desktop', 'keyboard', 'mouse', 'monitor', 'webcam', 'router', 'tv', '\u0442\u0435\u043b\u0435\u0432\u0456\u0437\u043e\u0440'] },
    { key: '\u041f\u043e\u0431\u0443\u0442\u043e\u0432\u0430 \u0442\u0435\u0445\u043d\u0456\u043a\u0430', terms: ['kettle', 'coffee', 'blender', 'vacuum', 'fryer', '\u0447\u0430\u0439\u043d\u0438\u043a', '\u043a\u0430\u0432\u043e\u0432\u0430\u0440\u043a\u0430', '\u0431\u043b\u0435\u043d\u0434\u0435\u0440', '\u043f\u0438\u043b\u043e\u0441\u043e\u0441', '\u0442\u0435\u0445\u043d\u0456\u043a\u0430', 'robot', '\u043c\u0456\u043a\u0441\u0435\u0440', 'washer', 'fridge'] },
    { key: '\u0422\u043e\u0432\u0430\u0440\u0438 \u0434\u043b\u044f \u0434\u043e\u043c\u0443', terms: ['lamp', 'home', 'sensor', 'security cam', 'hub', '\u043d\u0456\u0447\u043d\u0438\u043a', '\u043b\u0430\u043c\u043f\u0430', '\u0434\u0456\u043c', '\u043e\u0440\u0433\u0430\u043d\u0430\u0439\u0437\u0435\u0440', '\u0440\u044e\u043a\u0437\u0430\u043a', 'light', 'smart bulb', 'door'] },
  ];

  const CATEGORY_ICONS = {
    '\u041d\u043e\u0443\u0442\u0431\u0443\u043a\u0438 \u0442\u0430 \u043a\u043e\u043c\u043f\u2019\u044e\u0442\u0435\u0440\u0438': 'bi-laptop',
    '\u0421\u043c\u0430\u0440\u0442\u0444\u043e\u043d\u0438': 'bi-phone',
    '\u041f\u043e\u0431\u0443\u0442\u043e\u0432\u0430 \u0442\u0435\u0445\u043d\u0456\u043a\u0430': 'bi-house-gear',
    '\u0422\u043e\u0432\u0430\u0440\u0438 \u0434\u043b\u044f \u0434\u043e\u043c\u0443': 'bi-house-heart',
    '\u0410\u043a\u0446\u0456\u0457 ARM': 'bi-stars',
  };

  const CATEGORY_THUMB = {
    '\u0421\u043c\u0430\u0440\u0442\u0444\u043e\u043d\u0438': 'phones',
    '\u041d\u043e\u0443\u0442\u0431\u0443\u043a\u0438 \u0442\u0430 \u043a\u043e\u043c\u043f\u2019\u044e\u0442\u0435\u0440\u0438': 'laptops',
    '\u041f\u043e\u0431\u0443\u0442\u043e\u0432\u0430 \u0442\u0435\u0445\u043d\u0456\u043a\u0430': 'appliances',
    '\u0422\u043e\u0432\u0430\u0440\u0438 \u0434\u043b\u044f \u0434\u043e\u043c\u0443': 'home',
    '\u0410\u043a\u0446\u0456\u0457 ARM': 'promo',
  };

  /* ── Fallback products (30+) ── */
  const FALLBACK_PRODUCTS = [
    // Смартфони
    { id: 9001, title: 'ARM Phone Max 512GB', description: '\u0424\u043b\u0430\u0433\u043c\u0430\u043d\u0441\u044c\u043a\u0438\u0439 \u0441\u043c\u0430\u0440\u0442\u0444\u043e\u043d 6.8\u2033, 120Hz, 120W \u0437\u0430\u0440\u044f\u0434\u043a\u0430', price: 29999, badge: 'TOP', stock: 18 },
    { id: 9002, title: 'ARM Phone Lite 5G', description: '\u0421\u043c\u0430\u0440\u0442\u0444\u043e\u043d 120Hz, NFC, \u0431\u0430\u0442\u0430\u0440\u0435\u044f 5000mAh', price: 13999, badge: 'ARM DEAL', stock: 44 },
    { id: 9021, title: 'ARM Phone SE 128GB', description: '\u041a\u043e\u043c\u043f\u0430\u043a\u0442\u043d\u0438\u0439 \u0441\u043c\u0430\u0440\u0442\u0444\u043e\u043d 6.1\u2033, OLED, Face ID', price: 10499, badge: null, stock: 26 },
    { id: 9022, title: 'ARM Phone Ultra Pro', description: '\u0422\u0438\u0442\u0430\u043d\u043e\u0432\u0438\u0439 \u0447\u0438\u043f, 200MP \u043a\u0430\u043c\u0435\u0440\u0430, 12GB RAM', price: 41999, badge: 'HOT', stock: 7 },
    { id: 9023, title: 'ARM Earbuds Pro ANC', description: '\u0411\u0435\u0437\u0434\u0440\u043e\u0442\u043e\u0432\u0456 \u043d\u0430\u0432\u0443\u0448\u043d\u0438\u043a\u0438 \u0437 ANC, 36\u0433 \u0440\u043e\u0431\u043e\u0442\u0438', price: 3299, badge: 'SALE', stock: 32 },
    { id: 9024, title: 'ARM Watch Series 4', description: '\u0420\u043e\u0437\u0443\u043c\u043d\u0438\u0439 \u0433\u043e\u0434\u0438\u043d\u043d\u0438\u043a, GPS, ЕКГ, AMOLED', price: 7899, badge: null, stock: 21 },
    // Ноутбуки та комп'ютери
    { id: 9003, title: 'ARM Book Pro 15', description: '\u041d\u043e\u0443\u0442\u0431\u0443\u043a 32GB RAM, 1TB SSD, Retina', price: 45999, badge: 'PRO', stock: 9 },
    { id: 9004, title: 'ARM Book Air 14', description: '\u041b\u0435\u0433\u043a\u0438\u0439 \u0443\u043b\u044c\u0442\u0440\u0430\u0431\u0443\u043a 16GB, 512GB SSD, 15\u0433', price: 32999, badge: 'NEW', stock: 17 },
    { id: 9005, title: 'ARM Monitor 27 QHD', description: '\u041c\u043e\u043d\u0456\u0442\u043e\u0440 27\u2033, 165Hz, HDR, USB-C', price: 11999, badge: 'HOT', stock: 28 },
    { id: 9006, title: 'ARM Router AX3000', description: 'Wi\u2011Fi 6 \u0440\u043e\u0443\u0442\u0435\u0440, Mesh-\u0441\u0438\u0441\u0442\u0435\u043c\u0430', price: 3599, badge: null, stock: 41 },
    { id: 9025, title: 'ARM Desktop Mini M2', description: '\u041c\u0456\u043d\u0456-\u043f\u041a, M2 chip, 16GB, 512GB, 4K', price: 22999, badge: null, stock: 12 },
    { id: 9026, title: 'ARM Keyboard Pro RGB', description: '\u041c\u0435\u0445\u0430\u043d\u0456\u0447\u043d\u0430 \u043a\u043b\u0430\u0432\u0456\u0430\u0442\u0443\u0440\u0430 \u0437 \u043f\u0456\u0434\u0441\u0432\u0456\u0442\u043a\u043e\u044e RGB', price: 2799, badge: null, stock: 35 },
    { id: 9027, title: 'ARM Webcam 4K Ultra', description: '4K \u0432\u0435\u0431-\u043a\u0430\u043c\u0435\u0440\u0430, \u0448\u0443\u043c\u043e\u043f\u0440\u0438\u0434\u0443\u0448\u0435\u043d\u043d\u044f, USB-C', price: 1899, badge: null, stock: 19 },
    { id: 9008, title: 'ARM Smart TV 50 4K', description: '4K \u0442\u0435\u043b\u0435\u0432\u0456\u0437\u043e\u0440 Dolby Vision, Google TV', price: 18999, badge: 'TOP', stock: 20 },
    // Побутова техніка
    { id: 9009, title: 'ARM Coffee Pro', description: '\u041a\u0430\u0432\u043e\u0432\u0430\u0440\u043a\u0430 \u0437 \u043a\u0430\u043f\u0443\u0447\u0438\u043d\u0430\u0442\u043e\u0440\u043e\u043c, \u0442\u0435\u043c\u043f\u0435\u0440\u0430\u0442\u0443\u0440\u043d\u0430 \u043a\u043e\u043d\u0442\u0440\u043e\u043b\u044c', price: 8499, badge: null, stock: 12 },
    { id: 9010, title: 'ARM Robot Vacuum X5', description: '\u0420\u043e\u0431\u043e\u0442-\u043f\u0438\u043b\u043e\u0441\u043e\u0441, LiDAR, \u0432\u043e\u043b\u043e\u0433\u0435 \u043f\u0440\u0438\u0431\u0438\u0440\u0430\u043d\u043d\u044f', price: 12499, badge: 'HOT', stock: 16 },
    { id: 9028, title: 'ARM Blender Smart 1500W', description: '\u0411\u043b\u0435\u043d\u0434\u0435\u0440 1500W, 8 \u043f\u0440\u043e\u0433\u0440\u0430\u043c, \u0441\u0435\u043d\u0441\u043e\u0440\u043d\u0430 \u043a\u0440\u0438\u0448\u043a\u0430', price: 3299, badge: null, stock: 23 },
    { id: 9029, title: 'ARM Air Fryer Pro 5.5L', description: '\u0424\u0440\u0438\u0442\u044e\u0440\u043d\u0438\u0446\u044f 5.5\u043b, 1500W, 8 \u0440\u0435\u0436\u0438\u043c\u0456\u0432', price: 4599, badge: 'NEW', stock: 30 },
    { id: 9030, title: 'ARM Kettle 1.7L Smart', description: '\u0427\u0430\u0439\u043d\u0438\u043a 1.7\u043b, \u0442\u0435\u043c\u043f\u0435\u0440\u0430\u0442\u0443\u0440\u043d\u0438\u0439 \u043a\u043e\u043d\u0442\u0440\u043e\u043b\u044c, \u043a\u0435\u0440\u0430\u043c\u0456\u043a\u0430', price: 1499, badge: null, stock: 42 },
    { id: 9031, title: 'ARM Vacuum Upright Pro', description: '\u0412\u0435\u0440\u0442\u0438\u043a\u0430\u043b\u044c\u043d\u0438\u0439 \u043f\u0438\u043b\u043e\u0441\u043e\u0441 2400W, HEPA, 1.5\u043b \u0431\u0430\u043a', price: 6799, badge: 'SALE', stock: 14 },
    { id: 9032, title: 'ARM Washing Machine 8kg', description: '\u041f\u0440\u0430\u043b\u044c\u043d\u0430 \u043c\u0430\u0448\u0438\u043d\u0430 8\u043a\u0433, \u0456\u043d\u0432\u0435\u0440\u0442\u043e\u0440 A+++', price: 17999, badge: null, stock: 6 },
    // Товари для дому
    { id: 9011, title: 'ARM Smart Lamp RGB', description: '\u0420\u043e\u0437\u0443\u043c\u043d\u0430 \u043b\u0430\u043c\u043f\u0430 RGB, \u0433\u043e\u043b\u043e\u0441\u043e\u0432\u0435 \u043a\u0435\u0440\u0443\u0432\u0430\u043d\u043d\u044f', price: 1599, badge: null, stock: 32 },
    { id: 9012, title: 'ARM Home Security Kit', description: '\u041a\u0430\u043c\u0435\u0440\u0430 + \u0434\u0430\u0442\u0447\u0438\u043a\u0438 + \u0445\u0430\u0431, Wi-Fi', price: 7299, badge: 'ARM DEAL', stock: 17 },
    { id: 9033, title: 'ARM Smart Plug Power', description: '\u0420\u043e\u0437\u0443\u043c\u043d\u0430 \u0440\u043e\u0437\u0435\u0442\u043a\u0430, \u0432\u0438\u043c\u0456\u0440\u044e\u0432\u0430\u043d\u043d\u044f \u0441\u043f\u043e\u0436\u0438\u0432\u0430\u043d\u043d\u044f', price: 799, badge: null, stock: 60 },
    { id: 9034, title: 'ARM Door Smart Lock', description: '\u0420\u043e\u0437\u0443\u043c\u043d\u0438\u0439 \u0437\u0430\u043c\u043e\u043a, \u0432\u0456\u0434\u043f\u0435\u0447\u0430\u0442\u043e\u043a + PIN + App', price: 5499, badge: 'NEW', stock: 11 },
    { id: 9035, title: 'ARM Backpack 30L', description: '\u0420\u044e\u043a\u0437\u0430\u043a 30\u043b, \u0432\u043e\u043b\u043e\u0433\u043e\u0441\u0442\u0456\u0439\u043a\u0438\u0439, USB \u0437\u0430\u0440\u044f\u0434\u043a\u0430', price: 2199, badge: null, stock: 25 },
    { id: 9036, title: 'ARM Air Purifier HEPA', description: '\u041e\u0447\u0438\u0441\u043d\u044e\u0432\u0430\u0447 \u043f\u043e\u0432\u0456\u0442\u0440\u044f HEPA H13, 50\u043c\u00b2', price: 6299, badge: 'HOT', stock: 13 },
    { id: 9037, title: 'ARM Smart Hub 2.4/5GHz', description: 'Zigbee \u0445\u0430\u0431 \u0434\u043b\u044f \u0440\u043e\u0437\u0443\u043c\u043d\u043e\u0433\u043e \u0434\u043e\u043c\u0443, 128 \u043f\u0440\u0438\u0441\u0442\u0440\u043e\u0457', price: 1899, badge: null, stock: 28 },
    { id: 9038, title: 'ARM Power Bank 26800mAh', description: 'Power Bank 26800mAh, 65W PD, 3 \u043f\u043e\u0440\u0442\u0438', price: 2499, badge: 'SALE', stock: 38 },
    // Акції ARM
    { id: 9039, title: 'ARM Bundle: Phone + Earbuds', description: 'ARM Phone Lite 5G + Earbuds Pro \u2014 \u043c\u0430\u043a\u0441\u0438\u043c\u0430\u043b\u044c\u043d\u0438\u0439 \u043d\u0430\u0431\u0456\u0440', price: 15999, badge: 'ARM DEAL', stock: 10 },
    { id: 9040, title: 'ARM Bundle: Laptop + Mouse', description: 'ARM Book Air + \u0431\u0435\u0437\u0434\u0440\u043e\u0442\u043e\u0432\u0430 \u043c\u0438\u0448\u043a\u0430 Magic Pro', price: 34499, badge: 'SALE', stock: 8 },
    { id: 9041, title: 'ARM Smart Home Starter', description: '\u0425\u0430\u0431 + 2 \u043b\u0430\u043c\u043f\u0438 + \u043f\u0440\u0438\u0441\u0442\u0440\u0456\u0439 \u043f\u0430\u043a\u0435\u0442 "Smart Start"', price: 4299, badge: 'NEW', stock: 15 },
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
    paid: '\u041e\u043f\u043b\u0430\u0447\u0435\u043d\u043e',
    awaiting_payment: '\u041e\u0447\u0456\u043a\u0443\u0454 \u043e\u043f\u043b\u0430\u0442\u0443',
    invoice_expired: '\u0406\u043d\u0432\u043e\u0439\u0441 \u043f\u0440\u043e\u0441\u0442\u0440\u043e\u0447\u0435\u043d\u043e',
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
    guestBanner: document.getElementById('guest-banner'),
    toast: document.getElementById('toast'),
    catalogTitle: document.getElementById('catalog-title'),
    topCategoryNav: document.querySelector('.rz-subnav'),
    // user dropdown
    userMenuBtn: document.getElementById('user-menu-btn'),
    userDropdown: document.querySelector('.rz-user-dropdown'),
    // auth modal
    authOverlay: document.getElementById('auth-overlay'),
    authClose: document.getElementById('auth-close'),
    authLoginForm: document.getElementById('auth-login-form'),
    authRegisterForm: document.getElementById('auth-register-form'),
    authLoginIdentity: document.getElementById('auth-login-identity'),
    authLoginPassword: document.getElementById('auth-login-password'),
    authRegName: document.getElementById('auth-reg-name'),
    authRegEmail: document.getElementById('auth-reg-email'),
    authRegPhone: document.getElementById('auth-reg-phone'),
    authRegPassword: document.getElementById('auth-reg-password'),
  };

  /* ═══════════════════════════════════════
     Utilities
     ═══════════════════════════════════════ */
  function isMobileFiltersMode() {
    return window.matchMedia('(max-width: 920px)').matches;
  }

  function setFiltersOpen(open) {
    const shouldOpen = !!open && isMobileFiltersMode();
    document.body.classList.toggle('filters-open', shouldOpen);
    if (el.filtersBackdrop) el.filtersBackdrop.hidden = !shouldOpen;
  }

  /* ── Toast ── */
  let toastTimer = 0;

  function showToast(message, isError) {
    if (!el.toast) return;
    el.toast.textContent = message;
    el.toast.style.background = isError ? '#8c1d29' : 'var(--ink)';
    el.toast.hidden = false;
    void el.toast.offsetHeight;
    el.toast.classList.add('toast-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.classList.remove('toast-visible');
      setTimeout(() => { el.toast.hidden = true; }, 300);
    }, 2800);
  }

  function createIdempotencyKey(scope) {
    const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${scope}-${rand}`;
  }

  function updatePaymentModeHint() {
    const mode = String(el.paymentMode?.value || 'pay_now');
    if (!el.paymentModeHint || !el.checkoutBtn) return;
    if (mode === 'invoice') {
      el.paymentModeHint.textContent = '\u0406\u043d\u0432\u043e\u0439\u0441 \u0434\u0456\u0454 24 \u0433\u043e\u0434\u0438\u043d\u0438. \u0422\u043e\u0432\u0430\u0440 \u0440\u0435\u0437\u0435\u0440\u0432\u0443\u0454\u0442\u044c\u0441\u044f \u043f\u0456\u0441\u043b\u044f \u043e\u0444\u043e\u0440\u043c\u043b\u0435\u043d\u043d\u044f.';
      el.checkoutBtn.textContent = '\u0412\u0438\u0441\u0442\u0430\u0432\u0438\u0442\u0438 \u0456\u043d\u0432\u043e\u0439\u0441';
    } else {
      el.paymentModeHint.textContent = '\u041c\u0438\u0442\u0442\u0454\u0432\u0435 \u0441\u043f\u0438\u0441\u0430\u043d\u043d\u044f \u043a\u043e\u0448\u0442\u0456\u0432 \u043f\u0456\u0441\u043b\u044f \u043f\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043d\u043d\u044f \u0437\u0430\u043c\u043e\u0432\u043b\u0435\u043d\u043d\u044f.';
      el.checkoutBtn.textContent = '\u041e\u0444\u043e\u0440\u043c\u0438\u0442\u0438 \u0447\u0435\u0440\u0435\u0437 ARM Bank';
    }
  }

  /* ═══════════════════════════════════════
     Auth modal
     ═══════════════════════════════════════ */
  function openAuthModal(tab) {
    if (!el.authOverlay) return;
    el.authOverlay.hidden = false;
    document.body.style.overflow = 'hidden';
    switchAuthTab(tab || 'login');
  }

  function closeAuthModal() {
    if (!el.authOverlay) return;
    el.authOverlay.hidden = true;
    document.body.style.overflow = '';
    if (el.authLoginForm) el.authLoginForm.reset();
    if (el.authRegisterForm) el.authRegisterForm.reset();
  }

  function switchAuthTab(tab) {
    const isLogin = tab === 'login';
    if (el.authLoginForm) el.authLoginForm.hidden = !isLogin;
    if (el.authRegisterForm) el.authRegisterForm.hidden = isLogin;
    document.querySelectorAll('.auth-tab').forEach((btn) => {
      btn.classList.toggle('active', String(btn.dataset.authTab) === tab);
    });
  }

  async function handleLogin(event) {
    event.preventDefault();
    const identity = String(el.authLoginIdentity?.value || '').trim();
    const password = String(el.authLoginPassword?.value || '').trim();
    if (!identity || !password) {
      showToast('\u0417\u0430\u043f\u043e\u0432\u043d\u0456\u0442\u044c \u0443\u0441\u0456 \u043f\u043e\u043b\u044f.', true);
      return;
    }
    const btn = el.authLoginForm?.querySelector('button[type=submit]');
    const prevText = btn?.textContent || '';
    if (btn) { btn.disabled = true; btn.textContent = '\u0412\u0445\u0456\u0434\u2026'; }

    try {
      const data = await api.request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identity, password }),
      });
      if (data?.token) api.setToken(data.token);
      closeAuthModal();
      await onAuthSuccess();
    } catch (err) {
      showToast(err?.serverMessage || err?.message || '\u041d\u0435\u0432\u0456\u0440\u043d\u0438\u0439 \u043b\u043e\u0433\u0456\u043d \u0430\u0431\u043e \u043f\u0430\u0440\u043e\u043b\u044c', true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = prevText; }
    }
  }

  async function handleRegister(event) {
    event.preventDefault();
    const full_name = String(el.authRegName?.value || '').trim();
    const email = String(el.authRegEmail?.value || '').trim();
    const phone = String(el.authRegPhone?.value || '').trim();
    const password = String(el.authRegPassword?.value || '').trim();
    if (!full_name || !email || !phone || !password) {
      showToast('\u0417\u0430\u043f\u043e\u0432\u043d\u0456\u0442\u044c \u0443\u0441\u0456 \u043f\u043e\u043b\u044f.', true);
      return;
    }
    const btn = el.authRegisterForm?.querySelector('button[type=submit]');
    const prevText = btn?.textContent || '';
    if (btn) { btn.disabled = true; btn.textContent = '\u0420\u0435\u0454\u0441\u0442\u0440\u0430\u0446\u0456\u044f\u2026'; }

    try {
      const data = await api.request('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ full_name, email, phone, password }),
      });
      if (data?.token) api.setToken(data.token);
      closeAuthModal();
      await onAuthSuccess();
    } catch (err) {
      showToast(err?.serverMessage || err?.message || '\u041f\u043e\u043c\u0438\u043b\u043a\u0430 \u0440\u0435\u0454\u0441\u0442\u0440\u0430\u0446\u0456\u0457', true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = prevText; }
    }
  }

  async function onAuthSuccess() {
    try {
      await Promise.all([fetchAccount(), fetchOrders()]);
      setAuthorizedMode();
      renderCart();
      showToast('\u0423\u0432\u0456\u0439\u0448\u043b\u0438! \u0414\u043e\u0431\u0440\u043e \u043f\u043e\u0436\u0430\u043b\u0443\u0432\u0430\u0442\u0438 \u0434\u043e ARM Marketplace.');
    } catch (err) {
      showToast(err?.message || '\u0410\u0432\u0442\u043e\u0440\u0438\u0437\u0430\u0446\u0456\u044e \u043f\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043d\u043e', true);
    }
  }

  /* ── User dropdown ── */
  function toggleUserDropdown() {
    if (!el.userDropdown) return;
    const isHidden = el.userDropdown.hidden;
    el.userDropdown.hidden = !isHidden;
  }

  function closeUserDropdown() {
    if (el.userDropdown) el.userDropdown.hidden = true;
  }

  /* ═══════════════════════════════════════
     Product data enrichment
     ═══════════════════════════════════════ */
  function inferCategory(product) {
    const badge = String(product?.badge || '').toUpperCase();
    if (badge && ['SALE', 'HOT', 'TOP', 'NEW', 'ARM DEAL'].includes(badge)) {
      return '\u0410\u043a\u0446\u0456\u0457 ARM';
    }
    const text = `${String(product?.title || '')} ${String(product?.description || '')}`.toLowerCase();
    for (const hint of CATEGORY_HINTS) {
      if (hint.terms.some((t) => text.includes(t))) return hint.key;
    }
    return '\u0422\u043e\u0432\u0430\u0440\u0438 \u0434\u043b\u044f \u0434\u043e\u043c\u0443';
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
      btn.textContent = cat === 'all' ? '\u0423\u0441\u0456 \u0442\u043e\u0432\u0430\u0440\u0438' : cat;
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', state.activeCategory === cat ? 'true' : 'false');
      el.categoryList.appendChild(btn);
    }
  }

  function syncTopCategoryUI() {
    if (el.catalogTitle) {
      el.catalogTitle.textContent = state.activeCategory === 'all'
        ? '\u0422\u043e\u0432\u0430\u0440\u0438 \u0434\u043b\u044f \u0434\u043e\u043c\u0443 \u0442\u0430 \u0442\u0435\u0445\u043d\u0456\u043a\u0438'
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
      if (state.activeCategory === '\u0410\u043a\u0446\u0456\u0457 ARM') {
        list = list.filter((p) => p.category === '\u0410\u043a\u0446\u0456\u0457 ARM' || ['SALE', 'HOT', 'TOP', 'NEW', 'ARM DEAL'].includes(String(p.badge || '').toUpperCase()));
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
    if (el.catalogCount) el.catalogCount.textContent = `${products.length} \u0442\u043e\u0432\u0430\u0440\u0456\u0432`;
    syncTopCategoryUI();

    el.catalogGrid.innerHTML = '';
    if (!products.length) {
      el.catalogGrid.innerHTML = '<p>\u041d\u0456\u0447\u043e\u0433\u043e \u043d\u0435 \u0437\u043d\u0430\u0439\u0434\u0435\u043d\u043e \u0437\u0430 \u043e\u0431\u0440\u0430\u043d\u0438\u043c\u0438 \u0444\u0456\u043b\u044c\u0442\u0440\u0430\u043c\u0438.</p>';
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
          <h3 class="rz-title">${item.title || '\u0422\u043e\u0432\u0430\u0440'}</h3>
          <div class="rz-meta">
            <span class="rz-rating">
              <span class="rz-stars" aria-label="\u0420\u0435\u0439\u0442\u0438\u043d\u0433 ${item.rating} \u0437 5">${renderStars(item.rating)}</span>
              ${item.rating.toFixed(1)}
            </span>
            <span class="rz-stock${inStock ? '' : ' out'}">${inStock ? '\u0412 \u043d\u0430\u044f\u0432\u043d\u043e\u0441\u0442\u0456' : '\u041d\u0435\u043c\u0430\u0454'}</span>
          </div>
          <div class="rz-price-wrap">
            <div>
              <div class="rz-price-main">${formatMoney(item.price)}</div>
              ${item.discountPercent >= 5 ? `<div class="rz-price-old">${formatMoney(item.oldPrice)}</div>` : ''}
            </div>
            <button class="btn btn-add" data-add-id="${item.id}" type="button" ${inStock ? '' : 'disabled'} aria-label="\u0414\u043e\u0434\u0430\u0442\u0438 ${item.title} \u0434\u043e \u043a\u043e\u0448\u0438\u043a\u0430">
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
          <button class="qty-btn" type="button" data-dec-id="${item.id}" aria-label="\u0417\u043c\u0435\u043d\u0448\u0438\u0442\u0438">\u2212</button>
          <strong>${qty}</strong>
          <button class="qty-btn" type="button" data-inc-id="${item.id}" aria-label="\u0417\u0431\u0456\u043b\u044c\u0448\u0438\u0442\u0438">+</button>
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
      el.guestBanner.innerHTML = `<strong>\u0413\u043e\u0441\u0442\u044c\u043e\u0432\u0438\u0439 \u0440\u0435\u0436\u0438\u043c:</strong> ${reason || '\u0434\u043b\u044f \u043e\u043f\u043b\u0430\u0442\u0438 \u043f\u043e\u0442\u0440\u0456\u0431\u043d\u0430 \u0430\u0432\u0442\u043e\u0440\u0438\u0437\u0430\u0446\u0456\u044f.'}`;
    }
    if (el.accountNumber) el.accountNumber.textContent = '\u041f\u043e\u0442\u0440\u0456\u0431\u0435\u043d \u0432\u0445\u0456\u0434';
    if (el.accountBalance) el.accountBalance.textContent = '\u2014';
    if (el.ordersCount) el.ordersCount.textContent = '0';
    if (el.ordersList) {
      el.ordersList.innerHTML = '<div class="order-item"><small>\u0423\u0432\u0456\u0439\u0434\u0456\u0442\u044c, \u0449\u043e\u0431 \u043f\u0435\u0440\u0435\u0433\u043b\u044f\u0434\u0430\u0442\u0438 \u0437\u0430\u043c\u043e\u0432\u043b\u0435\u043d\u043d\u044f.</small></div>';
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
      el.ordersList.innerHTML = '<div class="order-item"><small>\u0429\u0435 \u043d\u0435\u043c\u0430\u0454 \u0437\u0430\u043c\u043e\u0432\u043b\u0435\u043d\u044c.</small></div>';
      if (el.ordersCount) el.ordersCount.textContent = '0';
      return;
    }
    if (el.ordersCount) el.ordersCount.textContent = String(state.orders.length);

    for (const order of state.orders) {
      const status = String(order.status || 'paid');
      const badgeClass = status === 'paid' ? 'paid' : (status === 'awaiting_payment' ? 'awaiting' : 'expired');
      const statusLabel = ORDER_STATUS_LABELS[status] || status;
      const invoiceLabel = order.invoice_number ? `\u0406\u043d\u0432\u043e\u0439\u0441: ${order.invoice_number}` : '';
      const dueLabel = order.invoice_due_at ? `\u0434\u043e ${new Date(order.invoice_due_at).toLocaleString('uk-UA')}` : '';
      const canPay = status === 'awaiting_payment' && order.invoice_number;

      const node = document.createElement('article');
      node.className = 'order-item';
      node.setAttribute('role', 'listitem');
      node.innerHTML = `
        <div class="order-main">
          <strong>\u0417\u0430\u043c\u043e\u0432\u043b\u0435\u043d\u043d\u044f #${order.id}</strong>
          <small>${new Date(order.created_at).toLocaleString('uk-UA')}</small>
          <span class="order-status ${badgeClass}">${statusLabel}</span>
          ${invoiceLabel ? `<small>${invoiceLabel} ${dueLabel}</small>` : ''}
        </div>
        <div class="order-actions">
          <strong>${formatMoney(Number(order.total_amount || 0))}</strong>
          <small>${order.items_count} \u043f\u043e\u0437\u0438\u0446\u0456\u0439</small>
          ${canPay ? `<button class="order-pay-btn" data-invoice-pay="${order.invoice_number}" type="button">\u041e\u043f\u043b\u0430\u0442\u0438\u0442\u0438 \u0456\u043d\u0432\u043e\u0439\u0441</button>` : ''}
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
        useFallbackCatalog('\u041a\u0430\u0442\u0430\u043b\u043e\u0433 \u043e\u043d\u043e\u0432\u043b\u044e\u0454\u0442\u044c\u0441\u044f: \u043f\u043e\u043a\u0430\u0437\u0430\u043d\u043e \u0440\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u043e\u0432\u0430\u043d\u0456 \u0442\u043e\u0432\u0430\u0440\u0438 ARM.');
        return;
      }
      state.products = fromApi.map(enrichProduct);
      renderCategoryList();
      renderCatalog();
    } catch (err) {
      useFallbackCatalog('\u041f\u0440\u043e\u0431\u043b\u0435\u043c\u0430 \u0437 \u043c\u0435\u0440\u0435\u0436\u0435\u044e: \u043f\u043e\u043a\u0430\u0437\u0430\u043d\u043e \u043b\u043e\u043a\u0430\u043b\u044c\u043d\u0438\u0439 \u043a\u0430\u0442\u0430\u043b\u043e\u0433 ARM.');
    }
  }

  async function fetchAccount() {
    const data = await api.request('/api/account');
    state.account = data;
    if (el.accountNumber) el.accountNumber.textContent = data.account_number || '\u2014';
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
      openAuthModal('login');
      return;
    }
    const items = getCartPayload();
    if (!items.length) {
      showToast('\u041a\u043e\u0448\u0438\u043a \u043f\u043e\u0440\u043e\u0436\u043d\u0456\u0439.', true);
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
      el.checkoutBtn.textContent = '\u041e\u0444\u043e\u0440\u043c\u043b\u0435\u043d\u043d\u044f\u2026';
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
        showToast(`\u0406\u043d\u0432\u043e\u0439\u0441 ${data.invoice_number} \u0441\u0442\u0432\u043e\u0440\u0435\u043d\u043e. \u041e\u043f\u043b\u0430\u0442\u0456\u0442\u044c \u0434\u043e 24 \u0433\u043e\u0434\u0438\u043d.`);
      } else {
        const authCode = data.payment_authorization?.authorization_code;
        showToast(authCode
          ? `\u041e\u043f\u043b\u0430\u0442\u0443 \u0430\u0432\u0442\u043e\u0440\u0438\u0437\u043e\u0432\u0430\u043d\u043e (${authCode}). \u0417\u0430\u043c\u043e\u0432\u043b\u0435\u043d\u043d\u044f #${data.order_id} \u043e\u0444\u043e\u0440\u043c\u043b\u0435\u043d\u043e`
          : `\u0417\u0430\u043c\u043e\u0432\u043b\u0435\u043d\u043d\u044f #${data.order_id} \u0443\u0441\u043f\u0456\u0448\u043d\u043e \u043e\u0444\u043e\u0440\u043c\u043b\u0435\u043d\u043e`);
      }
    } catch (err) {
      showToast(err?.serverMessage || err?.message || '\u041f\u043e\u043c\u0438\u043b\u043a\u0430 \u043e\u043f\u043b\u0430\u0442\u0438', true);
    } finally {
      if (el.checkoutBtn) {
        el.checkoutBtn.disabled = false;
        el.checkoutBtn.textContent = oldText || '\u041e\u0444\u043e\u0440\u043c\u0438\u0442\u0438 \u0447\u0435\u0440\u0435\u0437 ARM Bank';
        updatePaymentModeHint();
      }
    }
  }

  async function payInvoice(invoiceNumber, btn) {
    const key = String(invoiceNumber || '').trim();
    if (!key) return;
    const prevText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '\u041e\u043f\u043b\u0430\u0442\u0430\u2026'; }

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
        ? `\u0406\u043d\u0432\u043e\u0439\u0441 ${data.invoice_number} \u043e\u043f\u043b\u0430\u0447\u0435\u043d\u043e. \u0410\u0432\u0442\u043e\u0440\u0438\u0437\u0430\u0446\u0456\u044f ${authCode}`
        : `\u0406\u043d\u0432\u043e\u0439\u0441 ${data.invoice_number} \u043e\u043f\u043b\u0430\u0447\u0435\u043d\u043e`);
    } catch (err) {
      showToast(err?.serverMessage || err?.message || '\u041d\u0435 \u0432\u0434\u0430\u043b\u043e\u0441\u044f \u043e\u043f\u043b\u0430\u0442\u0438\u0442\u0438 \u0456\u043d\u0432\u043e\u0439\u0441', true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = prevText || '\u041e\u043f\u043b\u0430\u0442\u0438\u0442\u0438 \u0456\u043d\u0432\u043e\u0439\u0441'; }
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
    showToast(`${product.title} \u0434\u043e\u0434\u0430\u043d\u043e \u0434\u043e \u043a\u043e\u0448\u0438\u043a\u0430`);
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
    // User dropdown
    el.userMenuBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleUserDropdown();
    });
    document.addEventListener('click', (e) => {
      if (el.userDropdown && !el.userDropdown.hidden) {
        if (!el.userMenuBtn?.contains(e.target) && !el.userDropdown.contains(e.target)) {
          closeUserDropdown();
        }
      }
    });

    // Login button → open auth modal
    el.loginToBank?.addEventListener('click', () => {
      closeUserDropdown();
      openAuthModal('login');
    });

    // Auth modal tabs
    document.querySelectorAll('.auth-tab').forEach((btn) => {
      btn.addEventListener('click', () => switchAuthTab(btn.dataset.authTab));
    });

    // Auth modal close
    el.authClose?.addEventListener('click', closeAuthModal);
    el.authOverlay?.addEventListener('click', (e) => {
      if (e.target === el.authOverlay) closeAuthModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && el.authOverlay && !el.authOverlay.hidden) closeAuthModal();
    });

    // Auth forms
    el.authLoginForm?.addEventListener('submit', handleLogin);
    el.authRegisterForm?.addEventListener('submit', handleRegister);

    // Cart header button → scroll to cart section
    el.cartHeaderBtn?.addEventListener('click', () => {
      document.querySelector('.rz-cart-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // Catalog
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
    renderSkeleton(12);

    try {
      await fetchCatalog();
      if (api?.token) {
        await Promise.all([fetchAccount(), fetchOrders()]);
        setAuthorizedMode();
      } else {
        setGuestMode('\u043f\u0435\u0440\u0435\u0433\u043b\u044f\u0434\u0430\u0439\u0442\u0435 \u0442\u043e\u0432\u0430\u0440\u0438 \u0442\u0430 \u0443\u0432\u0456\u0439\u0434\u0456\u0442\u044c \u0434\u043b\u044f \u043e\u043f\u043b\u0430\u0442\u0438.');
      }
      renderCart();
    } catch (err) {
      if (Number(err?.status) === 401) {
        setGuestMode('\u0441\u0435\u0441\u0456\u044f \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u043b\u0430\u0441\u044f, \u0443\u0432\u0456\u0439\u0434\u0456\u0442\u044c \u043f\u043e\u0432\u0442\u043e\u0440\u043d\u043e.');
      } else {
        showToast(err?.serverMessage || err?.message || '\u041d\u0435 \u0432\u0434\u0430\u043b\u043e\u0441\u044f \u0437\u0430\u0432\u0430\u043d\u0442\u0430\u0436\u0438\u0442\u0438 \u043c\u0430\u0440\u043a\u0435\u0442\u043f\u043b\u0435\u0439\u0441', true);
      }
    }
  }

  init();
})();

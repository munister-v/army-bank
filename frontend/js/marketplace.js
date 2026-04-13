(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════
     HELPERS
     ═══════════════════════════════════════════════════════════ */
  const moneyFmt = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt = (v) => `\u20b4${moneyFmt.format(Number(v || 0))}`;

  /* ── Stars ── */
  const STAR_ON  = '<svg class="rz-star"       viewBox="0 0 20 20"><path fill="currentColor" d="M10 1.3l2.4 5.5 5.9.5-4.5 3.8 1.5 5.8L10 13.8l-5.3 3.1 1.5-5.8L1.7 7.3l5.9-.5z"/></svg>';
  const STAR_OFF = '<svg class="rz-star empty"  viewBox="0 0 20 20"><path fill="currentColor" d="M10 1.3l2.4 5.5 5.9.5-4.5 3.8 1.5 5.8L10 13.8l-5.3 3.1 1.5-5.8L1.7 7.3l5.9-.5z"/></svg>';
  function stars(r) {
    const n = Math.round(Number(r) || 0);
    return Array.from({ length: 5 }, (_, i) => i < n ? STAR_ON : STAR_OFF).join('');
  }

  /* ═══════════════════════════════════════════════════════════
     CATEGORY SYSTEM
     Bug fix: badge alone should NOT force category to "Акції ARM".
     Category is inferred from title/description text only.
     "Акції ARM" is a VIRTUAL view (items with promo badges) shown
     in the subnav filter but products keep their real category.
     ═══════════════════════════════════════════════════════════ */
  const CAT_LAPTOPS    = 'Ноутбуки та комп\u2019ютери';
  const CAT_PHONES     = 'Смартфони';
  const CAT_APPLIANCES = 'Побутова техніка';
  const CAT_HOME       = 'Товари для дому';
  const CAT_PROMO      = 'Акції ARM';

  const TOP_CATEGORIES = [CAT_LAPTOPS, CAT_PHONES, CAT_APPLIANCES, CAT_HOME, CAT_PROMO];

  // Order matters: first match wins
  const CATEGORY_HINTS = [
    {
      key: CAT_PHONES,
      terms: [
        'смартфон', 'phone', 'iphone', 'galaxy', 'pixel', 'oneplus', 'xiaomi', 'redmi',
        'honor', 'earbuds', 'навушник', 'watch fit', 'smartwatch', 'годинник', 'band',
        'fitness band', 'smart ring', 'кільце', 'gimbal', 'tripod', 'tripod', 'складаний',
        'fold', 'tablet', 'планшет', 'ebook', 'reader', 'рідер', 'konsol', 'console',
      ],
    },
    {
      key: CAT_LAPTOPS,
      terms: [
        'ноутбук', 'laptop', 'ultrabook', 'ультрабук', 'book air', 'book pro', 'ryzenbook',
        'ultrabook', 'gaming laptop', 'office laptop', 'monitor', 'монітор', 'моноблок',
        'all-in-one', 'aio', 'desktop', 'mini pc', 'міні-пк', 'gaming pc', 'стаціонарний пк',
        'keyboard', 'клавіатур', 'mouse', 'миш', 'webcam', 'вебкамер', 'router', 'роутер',
        'mesh', 'wi-fi', 'smart tv', 'телевізор', 'tv box', 'приставка', 'projector',
        'проектор', 'soundbar', 'саундбар', 'subwoofer', 'сабвуфер', 'speaker', 'колонка',
        'headphone', 'навушники over', 'mic', 'мікрофон', 'ssd', 'ram', 'пам', 'nas',
        'docking', 'підставка для ноутбука', 'laptop stand',
      ],
    },
    {
      key: CAT_APPLIANCES,
      terms: [
        'kettle', 'чайник', 'coffee', 'кавоварк', 'blender', 'блендер', 'vacuum', 'пилосос',
        'fryer', 'фритюр', 'washer', 'пральна', 'dryer', 'сушильна', 'dishwasher', 'посудомийна',
        'fridge', 'холодильник', 'microwave', 'мікрохвильов', 'oven', 'духова', 'induction',
        'індукційна', 'toaster', 'тостер', 'juicer', 'соковижималка', 'multicooker', 'мультиварка',
        'rice cooker', 'рисоварка', 'pressure cooker', 'скороварка', 'kitchen machine',
        'кухонна машина', 'food processor', 'кухонний комбайн', 'coffee grinder', 'млинок',
        'iron', 'праска', 'garment steamer', 'відпарювач', 'aircon', 'кондиціонер',
        'air purifier', 'очищувач', 'dehumidifier', 'осушувач', 'humidifier', 'зволожувач',
        'heater', 'обігрівач', 'fan', 'вентилятор', 'electric grill', 'гриль', 'knife',
        'cookware', 'посуд', 'sofa cleaner', 'water filter', 'фільтрації', 'robot', 'робот',
      ],
    },
    {
      key: CAT_HOME,
      terms: [
        'lamp', 'лампа', 'light', 'підсвітка', 'led strip', 'стрічка', 'floor lamp', 'торшер',
        'smart bulb', 'лампочка', 'night lamp', 'нічник', 'desk lamp', 'work light',
        'security', 'безпека', 'camera', 'камера', 'doorbell', 'дзвінок', 'door sensor',
        'датчик', 'sensor', 'lock', 'замок', 'smart plug', 'розетка', 'smart switch', 'вимикач',
        'hub', 'хаб', 'blinds', 'жалюзі', 'curtains', 'штор', 'baby monitor', 'відеоняня',
        'backpack', 'рюкзак', 'travel', 'органайзер', 'power bank', 'зарядка', 'charger',
        'cable', 'кабель', 'adapter', 'адаптер', 'car charger', 'автозарядка',
        'bedding', 'білизна', 'pillow', 'подушк', 'mattress', 'матрас', 'textile', 'рушник',
        'decor', 'декор', 'home safe', 'сейф', 'office chair', 'крісло', 'gaming chair',
        'gaming desk', 'стіл', 'lift desk', 'bedside', 'floor cleaner', 'bike holder',
        'bike', 'surveillance', 'відеоспостереження',
      ],
    },
  ];

  const CATEGORY_ICONS = {
    [CAT_LAPTOPS]:    'bi-laptop',
    [CAT_PHONES]:     'bi-phone',
    [CAT_APPLIANCES]: 'bi-house-gear',
    [CAT_HOME]:       'bi-house-heart',
    [CAT_PROMO]:      'bi-stars',
  };

  const CATEGORY_THUMB = {
    [CAT_PHONES]:     'phones',
    [CAT_LAPTOPS]:    'laptops',
    [CAT_APPLIANCES]: 'appliances',
    [CAT_HOME]:       'home',
    [CAT_PROMO]:      'promo',
  };

  const PROMO_BADGES = new Set(['SALE', 'HOT', 'TOP', 'NEW', 'ARM DEAL', 'PRO']);

  function inferCategory(product) {
    const text = `${product.title || ''} ${product.description || ''}`.toLowerCase();
    for (const { key, terms } of CATEGORY_HINTS) {
      if (terms.some((t) => text.includes(t))) return key;
    }
    return CAT_HOME;
  }

  function enrichProduct(item) {
    const id = Number(item.id || 1);
    const rating = Number((4.0 + ((id * 17) % 11) / 10).toFixed(1));
    const reviews = 18 + ((id * 43) % 530);
    const price = Number(item.price || 0);
    const oldPrice = Number((price * (1.12 + ((id % 8) * 0.01))).toFixed(2));
    const discountPct = Math.round(((oldPrice - price) / oldPrice) * 100);
    const category = inferCategory(item);
    const badge = String(item.badge || '').toUpperCase();
    return {
      ...item,
      category,
      badge: badge || null,
      isPromo: PROMO_BADGES.has(badge),
      rating,
      reviews,
      oldPrice,
      discountPct,
      iconClass: CATEGORY_ICONS[category] || 'bi-bag',
      thumbCat: CATEGORY_THUMB[category] || 'home',
    };
  }

  /* ── Fallback catalog (used when API unavailable or returns 0 items) ── */
  const FALLBACK_PRODUCTS = [
    { id: 9001, title: 'ARM Phone Max 512GB',       description: 'Флагманський смартфон 6.8\u2033, 120Hz, 120W',       price: 29999, badge: 'TOP',      stock: 18 },
    { id: 9002, title: 'ARM Phone Lite 5G 256GB',   description: 'Смартфон 120Hz, NFC, батарея 5000mAh',               price: 13999, badge: 'ARM DEAL', stock: 44 },
    { id: 9021, title: 'ARM Phone SE 128GB',         description: 'Компактний смартфон 6.1\u2033, OLED, Face ID',       price: 10499, badge: null,       stock: 26 },
    { id: 9022, title: 'ARM Phone Ultra Pro',        description: 'Титановий чіп, 200MP камера, 12GB RAM',              price: 41999, badge: 'HOT',      stock:  7 },
    { id: 9023, title: 'ARM Earbuds Pro ANC',        description: 'Бездротові навушники з ANC, 36г роботи',             price:  3299, badge: 'SALE',     stock: 32 },
    { id: 9024, title: 'ARM Watch Series 4',         description: 'Розумний годинник, GPS, ЕКГ, AMOLED',               price:  7899, badge: null,       stock: 21 },
    { id: 9025, title: 'ARM Tablet 11"',             description: 'Планшет 11" з підтримкою стилуса, 8GB/256GB',       price: 15499, badge: null,       stock: 22 },
    { id: 9003, title: 'ARM Book Pro 15',            description: 'Ноутбук 32GB RAM, 1TB SSD, Retina',                 price: 45999, badge: 'PRO',      stock:  9 },
    { id: 9004, title: 'ARM Book Air 14',            description: 'Легкий ультрабук 16GB, 512GB SSD, 1.3кг',           price: 32999, badge: 'NEW',      stock: 17 },
    { id: 9026, title: 'ARM Desktop Mini M2',        description: 'Міні-ПК, M2 chip, 16GB, 512GB, підтримка 4K',      price: 22999, badge: null,       stock: 12 },
    { id: 9005, title: 'ARM Monitor 27" QHD',        description: 'Монітор 27\u2033, 165Hz, HDR, USB-C',               price: 11999, badge: 'HOT',      stock: 28 },
    { id: 9027, title: 'ARM Router AX3000',          description: 'Wi\u2011Fi 6 роутер, Mesh-система, до 3000 Мбіт/с',price:  3599, badge: null,       stock: 41 },
    { id: 9008, title: 'ARM Smart TV 50" 4K',        description: '4K телевізор Dolby Vision, Google TV',              price: 18999, badge: 'TOP',      stock: 20 },
    { id: 9028, title: 'ARM Speaker Mini BT',        description: 'Портативна Bluetooth колонка, 10 год роботи',       price:  1299, badge: null,       stock: 70 },
    { id: 9009, title: 'ARM Coffee Pro',             description: 'Кавоварка еспресо з капучинатором',                 price:  8499, badge: null,       stock: 12 },
    { id: 9010, title: 'ARM Robot Vacuum X5',        description: 'Робот-пилосос, LiDAR, вологе прибирання',          price: 12499, badge: 'HOT',      stock: 16 },
    { id: 9029, title: 'ARM Air Fryer Pro 5.5L',     description: 'Фритюрниця 5.5л, 1500W, 8 режимів',               price:  4599, badge: 'NEW',      stock: 30 },
    { id: 9030, title: 'ARM Smart Kettle 1.7L',      description: 'Чайник 1.7л, температурний контроль, кераміка',    price:  1499, badge: null,       stock: 42 },
    { id: 9031, title: 'ARM Vacuum Upright Pro',     description: 'Вертикальний пилосос 2400W, HEPA, 1.5л бак',       price:  6799, badge: 'SALE',     stock: 14 },
    { id: 9032, title: 'ARM Washing Machine 8kg',    description: 'Пральна машина 8кг, інвертор A+++',                 price: 17999, badge: null,       stock:  6 },
    { id: 9011, title: 'ARM Smart Lamp RGB',         description: 'Розумна лампа RGB, голосове керування',             price:  1599, badge: null,       stock: 32 },
    { id: 9012, title: 'ARM Home Security Kit',      description: 'Камера + датчики + хаб, Wi-Fi',                    price:  7299, badge: 'ARM DEAL', stock: 17 },
    { id: 9033, title: 'ARM Smart Plug Power',       description: 'Розумна розетка, вимірювання споживання',           price:   799, badge: null,       stock: 60 },
    { id: 9034, title: 'ARM Door Smart Lock',        description: 'Розумний замок, відбиток + PIN + App',              price:  5499, badge: 'NEW',      stock: 11 },
    { id: 9035, title: 'ARM City Backpack 30L',      description: 'Рюкзак 30л, водостійкий, USB зарядка',             price:  2199, badge: null,       stock: 25 },
    { id: 9036, title: 'ARM Air Purifier HEPA',      description: 'Очищувач повітря HEPA H13, до 50м\u00b2',          price:  6299, badge: 'HOT',      stock: 13 },
    { id: 9037, title: 'ARM Power Bank 26800mAh',   description: 'Power Bank 26800mAh, 65W PD, 3 порти',             price:  2499, badge: 'SALE',     stock: 38 },
    { id: 9038, title: 'ARM GaN Charger 65W',        description: 'Компактна зарядка 65W USB-C + USB-A',              price:  1299, badge: null,       stock: 110 },
    { id: 9039, title: 'ARM Wireless Mouse Pro',     description: 'Ергономічна бездротова миша, до 70 год',           price:  1399, badge: null,       stock: 90 },
    { id: 9040, title: 'ARM Bundle: Phone + Watch',  description: 'ARM Phone Lite 5G + Watch Series 4 — повний набір',price: 20499, badge: 'ARM DEAL', stock: 10 },
    { id: 9041, title: 'ARM Smart Home Starter',     description: 'Хаб + 2 лампи + датчик — пакет "Smart Start"',    price:  4299, badge: 'NEW',      stock: 15 },
  ];

  /* ═══════════════════════════════════════════════════════════
     STATE
     ═══════════════════════════════════════════════════════════ */
  const state = {
    products: [],
    cart: new Map(),   // id → qty
    orders: [],
    account: null,
    user: null,
    authenticated: false,
    activeCategory: 'all',
    topCategory: 'all',  // subnav selection (may be CAT_PROMO = virtual view)
  };

  const ORDER_STATUS = {
    paid:            'Оплачено',
    awaiting_payment:'Очікує оплату',
    invoice_expired: 'Інвойс прострочено',
  };

  /* ═══════════════════════════════════════════════════════════
     CART PERSISTENCE
     ═══════════════════════════════════════════════════════════ */
  const CART_KEY = 'arm_cart_v1';

  function saveCart() {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(Array.from(state.cart.entries())));
    } catch (_) {}
  }

  function loadCart() {
    try {
      const raw = localStorage.getItem(CART_KEY);
      if (!raw) return;
      const entries = JSON.parse(raw);
      if (Array.isArray(entries)) {
        state.cart = new Map(entries.map(([id, qty]) => [Number(id), Number(qty)]));
      }
    } catch (_) {}
  }

  /* ═══════════════════════════════════════════════════════════
     DOM REFS
     ═══════════════════════════════════════════════════════════ */
  const el = {
    // catalog
    catalogGrid:    document.getElementById('catalog-grid'),
    catalogCount:   document.getElementById('catalog-count'),
    catalogSearch:  document.getElementById('catalog-search'),
    catalogSort:    document.getElementById('catalog-sort'),
    catalogTitle:   document.getElementById('catalog-title'),
    categoryList:   document.getElementById('category-list'),
    filterReset:    document.getElementById('filter-reset'),
    toggleFilters:  document.getElementById('toggle-filters'),
    filtersBackdrop:document.getElementById('filters-backdrop'),
    topCategoryNav: document.querySelector('.rz-subnav'),
    filterCatsBar:  document.getElementById('filter-cats-scroll'),
    headerNav:      document.getElementById('header-nav'),
    // cart
    cartEmpty:      document.getElementById('cart-empty'),
    cartItems:      document.getElementById('cart-items'),
    cartTotal:      document.getElementById('cart-total'),
    cartBadge:      document.getElementById('cart-badge-count'),
    cartHeaderBtn:  document.getElementById('cart-header-btn'),
    checkoutForm:   document.getElementById('checkout-form'),
    checkoutBtn:    document.getElementById('checkout-btn'),
    shippingName:   document.getElementById('shipping-name'),
    shippingAddress:document.getElementById('shipping-address'),
    paymentMode:    document.getElementById('payment-mode'),
    paymentModeHint:document.getElementById('payment-mode-hint'),
    // account
    accountNumber:  document.getElementById('account-number'),
    accountBalance: document.getElementById('account-balance'),
    // orders
    ordersCount:    document.getElementById('orders-count'),
    ordersList:     document.getElementById('orders-list'),
    // auth / session
    loginToBank:    document.getElementById('login-to-bank'),
    logoutBtn:      document.getElementById('logout-btn'),
    guestBanner:    document.getElementById('guest-banner'),
    toast:          document.getElementById('toast'),
    // user dropdown
    userMenuBtn:    document.getElementById('user-menu-btn'),
    userDropdown:   document.querySelector('.rz-user-dropdown'),
    // auth modal
    authOverlay:    document.getElementById('auth-overlay'),
    authClose:      document.getElementById('auth-close'),
    authLoginForm:  document.getElementById('auth-login-form'),
    authRegForm:    document.getElementById('auth-register-form'),
    authLoginId:    document.getElementById('auth-login-identity'),
    authLoginPass:  document.getElementById('auth-login-password'),
    authRegName:    document.getElementById('auth-reg-name'),
    authRegEmail:   document.getElementById('auth-reg-email'),
    authRegPhone:   document.getElementById('auth-reg-phone'),
    authRegPass:    document.getElementById('auth-reg-password'),
    // confirm modal
    confirmOverlay:      document.getElementById('confirm-overlay'),
    confirmItems:        document.getElementById('confirm-items'),
    confirmTotal:        document.getElementById('confirm-total'),
    confirmBalance:      document.getElementById('confirm-balance'),
    confirmBalanceAfter: document.getElementById('confirm-balance-after'),
    confirmBalanceAfterRow: document.getElementById('confirm-balance-after-row'),
    confirmInvoiceNote:  document.getElementById('confirm-invoice-note'),
    confirmWarning:      document.getElementById('confirm-warning'),
    confirmPayBtn:       document.getElementById('confirm-pay-btn'),
    confirmCancelBtn:    document.getElementById('confirm-cancel-btn'),
    confirmCancelLink:   document.getElementById('confirm-cancel-link'),
    // payment balance + receipt
    paymentBalanceEl:    document.getElementById('payment-balance'),
    orderReceipt:        document.getElementById('order-receipt'),
  };

  /* ═══════════════════════════════════════════════════════════
     TOAST
     ═══════════════════════════════════════════════════════════ */
  let _toastTimer = 0;

  function showToast(msg, isError = false) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.style.background = isError ? '#8c1d29' : '';
    el.toast.hidden = false;
    void el.toast.offsetHeight;
    el.toast.classList.add('toast-visible');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
      el.toast.classList.remove('toast-visible');
      setTimeout(() => { el.toast.hidden = true; el.toast.style.background = ''; }, 320);
    }, 3000);
  }

  /* ═══════════════════════════════════════════════════════════
     FILTERS / MOBILE DRAWER
     ═══════════════════════════════════════════════════════════ */
  function isMobile() { return window.matchMedia('(max-width: 920px)').matches; }

  function setFiltersOpen(open) {
    const on = open && isMobile();
    document.body.classList.toggle('filters-open', on);
    if (el.filtersBackdrop) el.filtersBackdrop.hidden = !on;
    const expanded = document.getElementById('filters-expanded');
    if (expanded) expanded.hidden = !on;
  }

  /* ═══════════════════════════════════════════════════════════
     PAYMENT MODE HINT
     ═══════════════════════════════════════════════════════════ */
  function syncPaymentHint() {
    const inv = el.paymentMode?.value === 'invoice';
    if (el.paymentModeHint) {
      el.paymentModeHint.textContent = inv
        ? 'Інвойс діє 24 години. Товар резервується після оформлення.'
        : 'Миттєве списання коштів після підтвердження замовлення.';
    }
    if (el.checkoutBtn) {
      el.checkoutBtn.textContent = inv ? 'Виставити інвойс' : 'Оформити через ARM Bank';
    }
  }

  /* ═══════════════════════════════════════════════════════════
     AUTH MODAL
     ═══════════════════════════════════════════════════════════ */
  function openAuthModal(tab = 'login') {
    if (!el.authOverlay) return;
    el.authOverlay.hidden = false;
    document.body.style.overflow = 'hidden';
    switchAuthTab(tab);
    closeUserDropdown();
    // Focus first input for a11y
    setTimeout(() => {
      const inp = el.authOverlay.querySelector('input:not([hidden])');
      inp?.focus();
    }, 60);
  }

  function closeAuthModal() {
    if (!el.authOverlay) return;
    el.authOverlay.hidden = true;
    document.body.style.overflow = '';
    el.authLoginForm?.reset();
    el.authRegForm?.reset();
  }

  function switchAuthTab(tab) {
    const isLogin = tab === 'login';
    if (el.authLoginForm) el.authLoginForm.hidden = !isLogin;
    if (el.authRegForm)   el.authRegForm.hidden   =  isLogin;
    document.querySelectorAll('.auth-tab').forEach((b) =>
      b.classList.toggle('active', b.dataset.authTab === tab)
    );
  }

  async function handleLogin(e) {
    e.preventDefault();
    const identity = el.authLoginId?.value.trim() || '';
    const password = el.authLoginPass?.value || '';
    if (!identity || !password) { showToast('Заповніть усі поля.', true); return; }

    const btn = el.authLoginForm?.querySelector('button[type=submit]');
    setBtnLoading(btn, 'Вхід…');
    try {
      const data = await api.request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identity, password }),
      });
      // token may be inside data.token or data (api.js unwraps data field)
      const token = data?.token || (typeof data === 'string' ? data : null);
      if (token) api.setToken(token);
      closeAuthModal();
      await onAuthSuccess(data);
    } catch (err) {
      showToast(err?.serverMessage || err?.message || 'Невірний логін або пароль', true);
    } finally {
      resetBtn(btn);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    const full_name = el.authRegName?.value.trim() || '';
    const email     = el.authRegEmail?.value.trim() || '';
    const phone     = el.authRegPhone?.value.trim() || '';
    const password  = el.authRegPass?.value || '';
    if (!full_name || !email || !phone || !password) { showToast('Заповніть усі поля.', true); return; }
    if (password.length < 6) { showToast('Пароль мінімум 6 символів.', true); return; }

    const btn = el.authRegForm?.querySelector('button[type=submit]');
    setBtnLoading(btn, 'Реєстрація…');
    try {
      const data = await api.request('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ full_name, email, phone, password }),
      });
      const token = data?.token || (typeof data === 'string' ? data : null);
      if (token) api.setToken(token);
      closeAuthModal();
      await onAuthSuccess(data);
    } catch (err) {
      showToast(err?.serverMessage || err?.message || 'Помилка реєстрації', true);
    } finally {
      resetBtn(btn);
    }
  }

  async function handleLogout() {
    closeUserDropdown();
    try { await api.request('/api/auth/logout', { method: 'POST' }); } catch (_) {}
    api.setToken('');
    state.account = null;
    state.user    = null;
    setGuestMode('Сесію завершено. Увійдіть для оплати.');
    showToast('Ви вийшли з облікового запису.');
  }

  async function onAuthSuccess(data) {
    // Immediately reflect user info from login response if available
    if (data?.user) {
      state.user = data.user;
      const acc  = data.user;
      if (el.accountNumber) el.accountNumber.textContent = acc.bank_account_number || '—';
    }
    try {
      await Promise.all([fetchAccount(), fetchOrders()]);
    } catch (_) {}
    setAuthorizedMode();
    renderCart();
    const fullName = state.user?.full_name || '';
    if (fullName && el.shippingName && !el.shippingName.value.trim()) {
      el.shippingName.value = fullName;
    }
    const firstName = fullName.split(' ')[0] || '';
    showToast(`Вітаємо${firstName ? ', ' + firstName : ''}! Ви в ARM Marketplace.`);
  }

  /* ── button helpers ── */
  const _btnPrev = new WeakMap();
  function setBtnLoading(btn, text) {
    if (!btn) return;
    _btnPrev.set(btn, btn.textContent);
    btn.disabled = true;
    btn.textContent = text;
  }
  function resetBtn(btn) {
    if (!btn) return;
    btn.disabled = false;
    btn.textContent = _btnPrev.get(btn) || '';
  }

  /* ── user dropdown ── */
  function toggleUserDropdown() {
    if (!el.userDropdown) return;
    el.userDropdown.hidden = !el.userDropdown.hidden;
  }
  function closeUserDropdown() {
    if (el.userDropdown) el.userDropdown.hidden = true;
  }

  /* ═══════════════════════════════════════════════════════════
     PRODUCT ENRICHMENT
     ═══════════════════════════════════════════════════════════ */
  function getProduct(id) {
    return state.products.find((p) => Number(p.id) === Number(id)) || null;
  }

  function useFallbackCatalog(silent = false) {
    state.products = FALLBACK_PRODUCTS.map(enrichProduct);
    renderCategoryList();
    renderCatalog();
    if (!silent) showToast('Показано локальний каталог ARM — сервер недоступний.', true);
  }

  /* ═══════════════════════════════════════════════════════════
     CART LOGIC
     ═══════════════════════════════════════════════════════════ */
  function cartTotal() {
    let s = 0;
    state.cart.forEach((qty, id) => {
      const p = getProduct(id);
      if (p) s += Number(p.price) * qty;
    });
    return Number(s.toFixed(2));
  }

  function cartCount() {
    let s = 0;
    state.cart.forEach((q) => { s += q; });
    return s;
  }

  function cartPayload() {
    return Array.from(state.cart.entries()).map(([id, qty]) => ({
      product_id: Number(id),
      qty: Number(qty),
    }));
  }

  function addToCart(id) {
    const p = getProduct(id);
    if (!p || Number(p.stock || 0) <= 0) return;
    state.cart.set(id, (state.cart.get(id) || 0) + 1);
    saveCart();
    renderCart();
    // Animate badge
    if (el.cartBadge) {
      el.cartBadge.classList.remove('bump');
      void el.cartBadge.offsetWidth;
      el.cartBadge.classList.add('bump');
    }
    showToast(`${p.title} — додано до кошика`);
  }

  function changeQty(id, delta) {
    const cur = state.cart.get(id) || 0;
    const next = cur + delta;
    if (next <= 0) state.cart.delete(id);
    else state.cart.set(id, next);
    saveCart();
    renderCart();
  }

  /* ═══════════════════════════════════════════════════════════
     SKELETON
     ═══════════════════════════════════════════════════════════ */
  function renderSkeleton(n = 12) {
    if (!el.catalogGrid) return;
    el.catalogGrid.innerHTML = Array.from({ length: n }, () =>
      `<div class="rz-skeleton" aria-hidden="true">
        <div class="rz-skel-thumb"></div>
        <div class="rz-skel-body">
          <div class="rz-skel-line w60"></div>
          <div class="rz-skel-line w80"></div>
          <div class="rz-skel-line w40"></div>
        </div>
      </div>`
    ).join('');
  }

  /* ═══════════════════════════════════════════════════════════
     RENDER: category sidebar
     ═══════════════════════════════════════════════════════════ */
  function renderCategoryList() {
    const cats = ['all', ...TOP_CATEGORIES];

    // Sidebar mobile drawer list
    if (el.categoryList) {
      el.categoryList.innerHTML = '';
      for (const cat of cats) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `category-btn${state.activeCategory === cat ? ' active' : ''}`;
        btn.dataset.category = cat;
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', String(state.activeCategory === cat));
        btn.textContent = cat === 'all' ? 'Усі товари' : cat;
        el.categoryList.appendChild(btn);
      }
    }

    // Filter bar pills (desktop)
    if (el.filterCatsBar) {
      el.filterCatsBar.innerHTML = '';
      for (const cat of cats) {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = `rz-filter-cat-pill${state.activeCategory === cat ? ' active' : ''}`;
        pill.dataset.topCategory = cat;
        pill.textContent = cat === 'all' ? 'Всі' : cat;
        el.filterCatsBar.appendChild(pill);
      }
    }

    // Header nav (desktop, abbreviated)
    if (el.headerNav) {
      el.headerNav.innerHTML = '';
      for (const cat of cats.slice(0, 6)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `rz-header-nav-item${state.activeCategory === cat ? ' active' : ''}`;
        btn.dataset.topCategory = cat;
        btn.textContent = cat === 'all' ? 'Всі' : cat;
        el.headerNav.appendChild(btn);
      }
    }
  }

  function syncTopNav() {
    if (el.catalogTitle) {
      el.catalogTitle.textContent =
        state.activeCategory === 'all' ? 'Каталог товарів' : state.activeCategory;
    }
    [el.topCategoryNav, el.filterCatsBar, el.headerNav].forEach((nav) => {
      nav?.querySelectorAll('[data-top-category]').forEach((b) => {
        b.classList.toggle('active', b.dataset.topCategory === state.activeCategory);
      });
    });
  }

  /* ═══════════════════════════════════════════════════════════
     RENDER: catalog grid
     ═══════════════════════════════════════════════════════════ */
  function filteredProducts() {
    const q    = (el.catalogSearch?.value || '').trim().toLowerCase();
    const sort = el.catalogSort?.value || 'popular';
    const cat  = state.activeCategory;

    let list = state.products.filter((p) => {
      if (cat === 'all') return true;
      if (cat === CAT_PROMO) return p.isPromo;
      return p.category === cat;
    });

    if (q) {
      list = list.filter((p) =>
        `${p.title} ${p.description}`.toLowerCase().includes(q)
      );
    }

    switch (sort) {
      case 'cheap':     list.sort((a, b) => a.price - b.price); break;
      case 'expensive': list.sort((a, b) => b.price - a.price); break;
      case 'title':     list.sort((a, b) => a.title.localeCompare(b.title, 'uk')); break;
      case 'rating':    list.sort((a, b) => b.rating - a.rating); break;
      default:          list.sort((a, b) => b.reviews - a.reviews);
    }
    return list;
  }

  function renderCatalog() {
    if (!el.catalogGrid) return;
    const items = filteredProducts();
    if (el.catalogCount) el.catalogCount.textContent = `${items.length} товарів`;
    syncTopNav();

    if (!items.length) {
      el.catalogGrid.innerHTML = '<p style="padding:24px;color:var(--ink-muted)">Нічого не знайдено за обраними фільтрами.</p>';
      return;
    }

    el.catalogGrid.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const p of items) {
      const inStock = Number(p.stock || 0) > 0;
      const badge   = p.badge || '';
      const card    = document.createElement('article');
      card.className = 'rz-product';
      card.setAttribute('role', 'listitem');
      card.innerHTML = `
        <div class="rz-thumb" data-cat="${p.thumbCat}">
          <span class="rz-thumb-brand">ARM</span>
          <i class="bi ${p.iconClass}" aria-hidden="true"></i>
          ${p.discountPct >= 5 ? `<span class="rz-discount">-${p.discountPct}%</span>` : ''}
        </div>
        <div class="rz-content">
          ${badge
            ? `<span class="rz-badge" data-badge="${badge}">${badge}</span>`
            : `<span class="rz-product-category">${p.category}</span>`
          }
          <h3 class="rz-title">${p.title}</h3>
          <div class="rz-meta">
            <span class="rz-rating">
              <span class="rz-stars" aria-label="Рейтинг ${p.rating} з 5">${stars(p.rating)}</span>
              ${p.rating.toFixed(1)}
            </span>
            <span class="rz-stock${inStock ? '' : ' out'}">${inStock ? 'В наявності' : 'Немає'}</span>
          </div>
          <div class="rz-price-wrap">
            <div>
              <div class="rz-price-main">${fmt(p.price)}</div>
              ${p.discountPct >= 5 ? `<div class="rz-price-old">${fmt(p.oldPrice)}</div>` : ''}
            </div>
            <button class="btn-add" data-add-id="${p.id}" type="button"
              ${inStock ? '' : 'disabled'}
              aria-label="Додати ${p.title} до кошика">
              <i class="bi bi-plus" aria-hidden="true"></i>
            </button>
          </div>
        </div>`;
      frag.appendChild(card);
    }
    el.catalogGrid.appendChild(frag);
  }

  /* ═══════════════════════════════════════════════════════════
     RENDER: cart
     ═══════════════════════════════════════════════════════════ */
  function renderCart() {
    if (!el.cartItems) return;
    const entries = Array.from(state.cart.entries());
    el.cartItems.innerHTML = '';
    if (el.cartEmpty) el.cartEmpty.style.display = entries.length ? 'none' : '';

    const frag = document.createDocumentFragment();
    for (const [id, qty] of entries) {
      const p = getProduct(id);
      if (!p) continue;
      const row = document.createElement('div');
      row.className = 'cart-item';
      row.innerHTML = `
        <div>
          <div class="cart-item-name">${p.title}</div>
          <div class="cart-item-meta">${fmt(p.price)} \u00d7 ${qty} = ${fmt(p.price * qty)}</div>
        </div>
        <div class="qty-controls">
          <button class="qty-btn" type="button" data-dec-id="${p.id}" aria-label="Зменшити">−</button>
          <strong>${qty}</strong>
          <button class="qty-btn" type="button" data-inc-id="${p.id}" aria-label="Збільшити">+</button>
        </div>`;
      frag.appendChild(row);
    }
    el.cartItems.appendChild(frag);

    const total = cartTotal();
    if (el.cartTotal) el.cartTotal.textContent = fmt(total);

    // Badge
    const count = cartCount();
    if (el.cartBadge) {
      el.cartBadge.textContent  = count > 0 ? String(count) : '';
      el.cartBadge.dataset.count = String(count);
    }

    // Checkout enabled only if authenticated + non-empty cart
    if (el.checkoutBtn) {
      el.checkoutBtn.disabled = !state.authenticated || total <= 0;
    }
  }

  /* ═══════════════════════════════════════════════════════════
     RENDER: orders
     ═══════════════════════════════════════════════════════════ */
  function renderOrders() {
    if (!el.ordersList) return;
    if (el.ordersCount) el.ordersCount.textContent = String(state.orders.length);

    if (!state.orders.length) {
      el.ordersList.innerHTML = '<div class="order-item"><small>Ще немає замовлень.</small></div>';
      return;
    }
    const frag = document.createDocumentFragment();
    for (const order of state.orders) {
      const status     = order.status || 'paid';
      const cls        = status === 'paid' ? 'paid' : status === 'awaiting_payment' ? 'awaiting' : 'expired';
      const label      = ORDER_STATUS[status] || status;
      const canPay     = status === 'awaiting_payment' && order.invoice_number;
      const dueStr     = order.invoice_due_at
        ? `до ${new Date(order.invoice_due_at).toLocaleString('uk-UA')}` : '';

      const node = document.createElement('article');
      node.className = 'order-item';
      node.setAttribute('role', 'listitem');
      node.innerHTML = `
        <div class="order-main">
          <strong>Замовлення #${order.id}</strong>
          <small>${new Date(order.created_at).toLocaleString('uk-UA')}</small>
          <span class="order-status ${cls}">${label}</span>
          ${order.invoice_number ? `<small>Інвойс: ${order.invoice_number} ${dueStr}</small>` : ''}
        </div>
        <div class="order-actions">
          <strong>${fmt(order.total_amount)}</strong>
          <small>${order.items_count} поз.</small>
          ${canPay ? `<button class="order-pay-btn" data-invoice-pay="${order.invoice_number}" type="button">Оплатити інвойс</button>` : ''}
        </div>`;
      frag.appendChild(node);
    }
    el.ordersList.innerHTML = '';
    el.ordersList.appendChild(frag);
  }

  /* ═══════════════════════════════════════════════════════════
     AUTH STATE
     ═══════════════════════════════════════════════════════════ */
  function setGuestMode(msg) {
    state.authenticated = false;
    state.orders = [];
    // header dropdown
    if (el.loginToBank)   el.loginToBank.hidden  = false;
    if (el.logoutBtn)     el.logoutBtn.hidden     = true;
    if (el.accountNumber) el.accountNumber.textContent = 'Потрібен вхід';
    if (el.accountBalance)el.accountBalance.textContent = '—';
    // guest banner
    if (el.guestBanner) {
      el.guestBanner.hidden = false;
      el.guestBanner.innerHTML = `<strong>Гостьовий режим:</strong> ${msg || 'увійдіть для оплати.'}`;
    }
    // orders
    if (el.ordersCount) el.ordersCount.textContent = '0';
    if (el.ordersList)  el.ordersList.innerHTML = '<div class="order-item"><small>Увійдіть, щоб переглядати замовлення.</small></div>';
    renderCart();
  }

  function setAuthorizedMode() {
    state.authenticated = true;
    if (el.loginToBank)  el.loginToBank.hidden  = true;
    if (el.logoutBtn)    el.logoutBtn.hidden     = false;
    if (el.guestBanner)  el.guestBanner.hidden   = true;
    updatePaymentBalance();
  }

  /* ═══════════════════════════════════════════════════════════
     API CALLS
     ═══════════════════════════════════════════════════════════ */
  async function fetchCatalog() {
    try {
      const data  = await api.request('/api/marketplace/catalog');
      const items = Array.isArray(data?.items) ? data.items : [];
      if (!items.length) {
        useFallbackCatalog(true); // silent — API just returned empty
        return;
      }
      state.products = items.map(enrichProduct);
      renderCategoryList();
      renderCatalog();
    } catch (_) {
      useFallbackCatalog(false);
    }
  }

  async function fetchAccount() {
    const data = await api.request('/api/accounts/main');
    state.account = data;
    if (el.accountNumber)  el.accountNumber.textContent  = data.account_number || '—';
    if (el.accountBalance) el.accountBalance.textContent = fmt(Number(data.balance || 0));
    updatePaymentBalance();
  }

  function updatePaymentBalance() {
    if (!el.paymentBalanceEl) return;
    if (!state.authenticated || state.account == null) {
      el.paymentBalanceEl.hidden = true;
      return;
    }
    el.paymentBalanceEl.hidden = false;
    el.paymentBalanceEl.innerHTML = `Ваш баланс: <span class="mono">${fmt(Number(state.account.balance || 0))}</span>`;
  }

  async function fetchOrders() {
    const data = await api.request('/api/marketplace/orders?limit=20');
    state.orders = data.orders || [];
    renderOrders();
  }

  /* ═══════════════════════════════════════════════════════════
     CHECKOUT
     ═══════════════════════════════════════════════════════════ */
  function mkKey(scope) {
    return `${scope}-${crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
  }

  function handleCheckout(e) {
    e.preventDefault();
    if (!state.authenticated) { openAuthModal('login'); return; }

    const items = cartPayload();
    if (!items.length) { showToast('Кошик порожній.', true); return; }

    const name    = el.shippingName?.value.trim() || '';
    const address = el.shippingAddress?.value.trim() || '';
    if (!name)    { el.shippingName?.focus();    showToast('Вкажіть отримувача.', true); return; }
    if (!address) { el.shippingAddress?.focus(); showToast('Вкажіть адресу доставки.', true); return; }

    openConfirmModal();
  }

  function openConfirmModal() {
    if (!el.confirmOverlay) return;

    const isInvoice = el.paymentMode?.value === 'invoice';
    const total     = cartTotal();
    const balance   = Number(state.account?.balance || 0);
    const after     = balance - total;

    // Populate items list
    if (el.confirmItems) {
      el.confirmItems.innerHTML = Array.from(state.cart.entries()).map(([id, qty]) => {
        const p = getProduct(id);
        if (!p) return '';
        const lineTotal = Number(p.price) * qty;
        return `<li class="confirm-item">
          <span class="confirm-item-name">${p.title}</span>
          <span class="confirm-item-qty">${qty} шт.</span>
          <span class="confirm-item-price">${fmt(lineTotal)}</span>
        </li>`;
      }).join('');
    }

    if (el.confirmTotal)   el.confirmTotal.textContent   = fmt(total);
    if (el.confirmBalance) el.confirmBalance.textContent = fmt(balance);

    if (isInvoice) {
      if (el.confirmBalanceAfterRow) el.confirmBalanceAfterRow.hidden = true;
      if (el.confirmInvoiceNote)     el.confirmInvoiceNote.hidden     = false;
    } else {
      if (el.confirmBalanceAfterRow) el.confirmBalanceAfterRow.hidden = false;
      if (el.confirmInvoiceNote)     el.confirmInvoiceNote.hidden     = true;
      if (el.confirmBalanceAfter)    el.confirmBalanceAfter.textContent = fmt(after);
    }

    if (el.confirmWarning) {
      if (!isInvoice && balance < total) {
        el.confirmWarning.hidden = false;
        el.confirmWarning.textContent = `Недостатньо коштів: не вистачає ${fmt(total - balance)}`;
      } else {
        el.confirmWarning.hidden = true;
      }
    }

    el.confirmOverlay.hidden = false;
    document.body.style.overflow = 'hidden';
    el.confirmPayBtn?.focus();
  }

  function closeConfirmModal() {
    if (!el.confirmOverlay) return;
    el.confirmOverlay.hidden = true;
    document.body.style.overflow = '';
  }

  async function submitConfirmedCheckout() {
    const items   = cartPayload();
    const name    = el.shippingName?.value.trim() || '';
    const address = el.shippingAddress?.value.trim() || '';
    const key     = mkKey('checkout');

    closeConfirmModal();
    setBtnLoading(el.checkoutBtn, 'Оформлення…');
    try {
      const data = await api.request('/api/marketplace/checkout', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify({
          items,
          shipping_name:    name,
          shipping_address: address,
          payment_mode:     el.paymentMode?.value || 'pay_now',
          idempotency_key:  key,
        }),
      });
      state.cart.clear();
      saveCart();
      renderCart();
      fetchAccount().catch(() => {});
      fetchOrders().catch(() => {});
      showReceipt(data);
    } catch (err) {
      const msg = err?.serverMessage || err?.message || 'Помилка оплати';
      if (msg.includes('Недостатньо коштів')) {
        const balance = Number(state.account?.balance || 0);
        const total   = cartTotal();
        showToast(`Недостатньо коштів. Баланс: ${fmt(balance)}, потрібно: ${fmt(total)}`, true);
      } else {
        showToast(msg, true);
      }
    } finally {
      resetBtn(el.checkoutBtn);
      syncPaymentHint();
      renderCart();
    }
  }

  function showReceipt(data) {
    if (!el.orderReceipt) return;

    const isInvoice = data.payment_mode === 'invoice';
    const newBalance = Number(data.new_balance ?? state.account?.balance ?? 0);

    let rows = '';
    if (isInvoice) {
      rows += `<div class="order-receipt-row"><span>Інвойс:</span><strong>${data.invoice_number || '—'}</strong></div>`;
      const dueRaw = data.invoice_due_at || data.due_at || data.due_date;
      if (dueRaw) {
        const dueStr = new Date(dueRaw).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        rows += `<div class="order-receipt-row"><span>Сплатити до:</span><strong>${dueStr}</strong></div>`;
      }
      rows += `<div class="order-receipt-row"><span>Сума:</span><strong>${fmt(data.total_amount || 0)}</strong></div>`;
    } else {
      const code = data.payment_authorization?.authorization_code;
      if (code) {
        rows += `<div class="order-receipt-row"><span>Код авторизації:</span><strong>${code}</strong></div>`;
      }
      rows += `<div class="order-receipt-row"><span>Новий баланс:</span><strong>${fmt(newBalance)}</strong></div>`;
    }

    el.orderReceipt.innerHTML = `
      <button class="order-receipt-close" type="button" aria-label="Закрити">&times;</button>
      <div class="order-receipt-header">
        <div class="order-receipt-icon">✓</div>
        <div class="order-receipt-title">Замовлення #${data.order_id} оформлено</div>
      </div>
      <div class="order-receipt-rows">${rows}</div>
      <button class="order-receipt-link" type="button">Переглянути замовлення ↓</button>
    `;
    el.orderReceipt.hidden = false;

    el.orderReceipt.querySelector('.order-receipt-close')?.addEventListener('click', () => {
      el.orderReceipt.hidden = true;
    });
    el.orderReceipt.querySelector('.order-receipt-link')?.addEventListener('click', () => {
      el.orderReceipt.hidden = true;
      document.querySelector('.orders-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    const _t = setTimeout(() => { el.orderReceipt.hidden = true; }, 15000);
    el.orderReceipt.addEventListener('click', () => clearTimeout(_t), { once: true });
  }

  async function payInvoice(invoiceNumber, btn) {
    const key = mkKey(`inv-${invoiceNumber}`);
    setBtnLoading(btn, 'Оплата…');
    try {
      const data = await api.request(`/api/marketplace/invoice/${encodeURIComponent(invoiceNumber)}/pay`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify({ idempotency_key: key }),
      });
      fetchAccount().catch(() => {});
      fetchOrders().catch(() => {});
      const code = data.payment_authorization?.authorization_code;
      showToast(code
        ? `Інвойс ${data.invoice_number} оплачено. Код: ${code}`
        : `Інвойс ${data.invoice_number} оплачено`);
    } catch (err) {
      showToast(err?.serverMessage || err?.message || 'Не вдалося оплатити інвойс', true);
    } finally {
      resetBtn(btn);
    }
  }

  /* ═══════════════════════════════════════════════════════════
     EVENT BINDING
     ═══════════════════════════════════════════════════════════ */
  function bindEvents() {
    /* ── User dropdown ── */
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

    /* ── Auth triggers ── */
    el.loginToBank?.addEventListener('click', () => openAuthModal('login'));
    el.logoutBtn?.addEventListener('click', handleLogout);

    /* ── Auth modal ── */
    el.authClose?.addEventListener('click', closeAuthModal);
    el.authOverlay?.addEventListener('click', (e) => { if (e.target === el.authOverlay) closeAuthModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && el.authOverlay && !el.authOverlay.hidden) closeAuthModal();
    });
    document.querySelectorAll('.auth-tab').forEach((b) =>
      b.addEventListener('click', () => switchAuthTab(b.dataset.authTab))
    );
    el.authLoginForm?.addEventListener('submit', handleLogin);
    el.authRegForm?.addEventListener('submit', handleRegister);

    /* ── Cart header button — scroll to cart ── */
    el.cartHeaderBtn?.addEventListener('click', () => {
      document.querySelector('.rz-cart-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    /* ── Catalog ── */
    el.catalogGrid?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-add-id]');
      if (btn) addToCart(Number(btn.dataset.addId));
    });

    el.cartItems?.addEventListener('click', (e) => {
      const inc = e.target.closest('[data-inc-id]');
      if (inc) { changeQty(Number(inc.dataset.incId), +1); return; }
      const dec = e.target.closest('[data-dec-id]');
      if (dec) { changeQty(Number(dec.dataset.decId), -1); }
    });

    el.checkoutForm?.addEventListener('submit', handleCheckout);
    el.paymentMode?.addEventListener('change', syncPaymentHint);

    /* ── Confirm modal ── */
    el.confirmPayBtn?.addEventListener('click', submitConfirmedCheckout);
    el.confirmCancelBtn?.addEventListener('click', closeConfirmModal);
    el.confirmCancelLink?.addEventListener('click', closeConfirmModal);
    el.confirmOverlay?.addEventListener('click', (e) => { if (e.target === el.confirmOverlay) closeConfirmModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && el.confirmOverlay && !el.confirmOverlay.hidden) closeConfirmModal();
    });

    el.ordersList?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-invoice-pay]');
      if (btn) payInvoice(btn.dataset.invoicePay, btn);
    });

    /* ── Search (debounced) ── */
    let _st = 0;
    const mobileSearch = document.getElementById('catalog-search-mobile');
    function onSearchInput() {
      clearTimeout(_st);
      // sync both inputs
      if (el.catalogSearch && mobileSearch) {
        if (document.activeElement === mobileSearch) el.catalogSearch.value = mobileSearch.value;
        else mobileSearch.value = el.catalogSearch?.value || '';
      }
      _st = setTimeout(renderCatalog, 180);
    }
    el.catalogSearch?.addEventListener('input', onSearchInput);
    mobileSearch?.addEventListener('input', onSearchInput);
    el.catalogSort?.addEventListener('change', renderCatalog);
    el.filterReset?.addEventListener('click', () => {
      state.activeCategory = 'all';
      if (el.catalogSort) el.catalogSort.value = 'popular';
      if (el.catalogSearch) el.catalogSearch.value = '';
      renderCategoryList();
      renderCatalog();
      setFiltersOpen(false);
    });

    /* ── Category sidebar ── */
    el.categoryList?.addEventListener('click', (e) => {
      const btn = e.target.closest('.category-btn');
      if (!btn) return;
      state.activeCategory = btn.dataset.category || 'all';
      renderCategoryList();
      renderCatalog();
      setFiltersOpen(false);
    });

    /* ── Top category nav (subnav / filter bar / header nav) ── */
    function onTopCatClick(e) {
      const btn = e.target.closest('[data-top-category]');
      if (!btn) return;
      state.activeCategory = btn.dataset.topCategory || 'all';
      renderCategoryList();
      renderCatalog();
    }
    el.topCategoryNav?.addEventListener('click', onTopCatClick);
    el.filterCatsBar?.addEventListener('click', onTopCatClick);
    el.headerNav?.addEventListener('click', onTopCatClick);

    /* ── Mobile filter drawer ── */
    el.toggleFilters?.addEventListener('click', () => setFiltersOpen(!document.body.classList.contains('filters-open')));
    el.filtersBackdrop?.addEventListener('click', () => setFiltersOpen(false));

    window.addEventListener('resize', () => { if (!isMobile()) setFiltersOpen(false); });
  }

  /* ═══════════════════════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════════════════════ */
  async function init() {
    loadCart();         // restore cart from localStorage
    bindEvents();
    syncPaymentHint();
    renderSkeleton(12);

    await fetchCatalog();
    renderCart(); // show restored cart items once products are loaded

    if (api?.token) {
      try {
        await Promise.all([fetchAccount(), fetchOrders()]);
        setAuthorizedMode();
      } catch (err) {
        if (Number(err?.status) === 401) {
          api.setToken('');
          setGuestMode('Сесію завершено, увійдіть повторно.');
        } else {
          setGuestMode('Увійдіть для оплати.');
        }
      }
    } else {
      setGuestMode('Переглядайте товари та увійдіть для оплати.');
    }

    renderCart(); // final sync (authenticated state now known)
  }

  init();
})();

// Army Bank — головний фронтенд v2.3
const state = {
  user: null,
  account: null,
  paymentTemplates: [],
  _pollTimer: null,
  _lastBalance: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const DESKTOP_MOBILE_ONLY_BLOCKED = document.documentElement.classList.contains('ab-desktop-blocked');

(function initRenderProfile() {
  const root = document.documentElement;
  const ua = navigator.userAgent || "";
  const isIOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
  const isFirefox = /Firefox|FxiOS/i.test(ua);
  const isChromium = !!window.chrome && /Chrome|CriOS|Edg/i.test(ua);

  root.classList.toggle("os-ios", isIOS);
  root.classList.toggle("os-android", isAndroid);
  root.classList.toggle("browser-safari", isSafari);
  root.classList.toggle("browser-firefox", isFirefox);
  root.classList.toggle("browser-chromium", isChromium);

  const cores = Number(navigator.hardwareConcurrency || 0);
  const memory = Number(navigator.deviceMemory || 0);
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const saveData = !!conn && conn.saveData === true;
  const slowNetwork = !!conn && /2g/i.test(String(conn.effectiveType || ""));
  const lowEndDevice = saveData || slowNetwork || (cores > 0 && cores <= 4) || (memory > 0 && memory <= 4);
  root.classList.toggle("render-lite", lowEndDevice);
  root.classList.toggle("render-rich", !lowEndDevice);

  const supportsBackdrop = !!(window.CSS && CSS.supports && (
    CSS.supports("backdrop-filter: blur(2px)") || CSS.supports("-webkit-backdrop-filter: blur(2px)")
  ));
  const supportsContentVisibility = !!(window.CSS && CSS.supports && CSS.supports("content-visibility: auto"));
  const supportsScrollbarGutter = !!(window.CSS && CSS.supports && CSS.supports("scrollbar-gutter: stable both-edges"));

  root.classList.toggle("no-backdrop-filter", !supportsBackdrop);
  root.classList.toggle("no-content-visibility", !supportsContentVisibility);
  root.classList.toggle("no-scrollbar-gutter", !supportsScrollbarGutter);

  const syncViewportUnit = () => {
    const vh = (window.visualViewport?.height || window.innerHeight || 0) * 0.01;
    if (vh > 0) root.style.setProperty("--app-vh", String(vh) + "px");
  };

  syncViewportUnit();
  window.addEventListener("resize", syncViewportUnit, { passive: true });
  window.visualViewport?.addEventListener("resize", syncViewportUnit, { passive: true });
  window.addEventListener("orientationchange", syncViewportUnit, { passive: true });
})();

(function initMobileKeyboardGuard() {
  const root = document.documentElement;
  const isMobileViewport = () => window.matchMedia('(max-width: 959px)').matches;
  const isEditable = (el) => {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = (el.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  };

  let baseline = Math.max(window.innerHeight || 0, window.visualViewport?.height || 0);
  const threshold = 140;

  const recalcBaseline = () => {
    baseline = Math.max(window.innerHeight || 0, window.visualViewport?.height || 0);
  };

  const update = () => {
    if (!isMobileViewport()) {
      root.classList.remove('keyboard-open');
      recalcBaseline();
      return;
    }

    const active = document.activeElement;
    const h = window.visualViewport?.height || window.innerHeight || 0;
    const delta = Math.max(0, baseline - h);
    const opened = isEditable(active) && delta >= threshold;
    root.classList.toggle('keyboard-open', opened);

    if (!opened && !isEditable(active)) recalcBaseline();
  };

  recalcBaseline();
  update();

  window.addEventListener('focusin', update, { passive: true });
  window.addEventListener('focusout', () => {
    setTimeout(() => {
      root.classList.remove('keyboard-open');
      recalcBaseline();
    }, 120);
  }, { passive: true });

  window.visualViewport?.addEventListener('resize', update, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  window.addEventListener('orientationchange', () => {
    root.classList.remove('keyboard-open');
    setTimeout(() => {
      recalcBaseline();
      update();
    }, 260);
  }, { passive: true });
})();

const _desktopClassicMql = window.matchMedia('(min-width: 1200px)');
let _desktopClassicSyncFrame = 0;

function applyDesktopClassicMode() {
  const desktop = _desktopClassicMql.matches;
  const root = document.documentElement;
  root.classList.toggle('desktop-classic', desktop);
  root.classList.toggle('desktop-cockpit', desktop);
}

function syncDesktopClassicMode() {
  if (typeof requestAnimationFrame !== 'function') {
    applyDesktopClassicMode();
    return;
  }
  if (_desktopClassicSyncFrame) return;
  _desktopClassicSyncFrame = requestAnimationFrame(() => {
    _desktopClassicSyncFrame = 0;
    applyDesktopClassicMode();
  });
}

applyDesktopClassicMode();
if (typeof _desktopClassicMql.addEventListener === 'function') {
  _desktopClassicMql.addEventListener('change', syncDesktopClassicMode);
} else if (typeof _desktopClassicMql.addListener === 'function') {
  _desktopClassicMql.addListener(syncDesktopClassicMode);
}
window.addEventListener('resize', syncDesktopClassicMode, { passive: true });
window.addEventListener('orientationchange', syncDesktopClassicMode, { passive: true });

const _scrollLocks = new Set();

function _applyScrollLockState() {
  const locked = _scrollLocks.size > 0;
  document.documentElement.classList.toggle('app-scroll-locked', locked);
  document.body.classList.toggle('app-scroll-locked', locked);
  document.body.style.overflow = locked ? 'hidden' : '';
}

function lockBodyScroll(reason) {
  const token = String(reason || 'global');
  _scrollLocks.add(token);
  _applyScrollLockState();
  return token;
}

function unlockBodyScroll(reason) {
  const token = String(reason || 'global');
  _scrollLocks.delete(token);
  _applyScrollLockState();
}

function clearBodyScrollLocks(options = {}) {
  const keepPin = !!options.keepPin;
  const pin = document.getElementById('pinLockOverlay');
  const pinVisible = !!pin && !pin.classList.contains('hidden');
  _scrollLocks.clear();
  if (keepPin && pinVisible) _scrollLocks.add('pin-lock');
  _applyScrollLockState();
}

function closeTransientLayers(options = {}) {
  const keepPin = !!options.keepPin;
  [
    '#txDrawer', '#drawerBackdrop', '#receiptOverlay', '#statementOverlay',
    '#transferConfirmOverlay', '#confirmDialog', '#confirmBackdrop', '#onboardingOverlay'
  ].forEach((sel) => {
    const el = document.querySelector(sel);
    if (el) el.classList.add('hidden');
  });

  if (!keepPin) {
    const pin = document.getElementById('pinLockOverlay');
    if (pin) pin.classList.add('hidden');
  }

  const notifPanel = document.getElementById('notifPanel');
  if (notifPanel) notifPanel.classList.remove('open');
  const notifOverlay = document.getElementById('notifOverlay');
  if (notifOverlay) notifOverlay.classList.remove('open');

  clearBodyScrollLocks({ keepPin });
}

function reconcileTransientState() {
  const hasPanel = !!document.getElementById('notifPanel')?.classList.contains('open');
  const hasPin = !!document.getElementById('pinLockOverlay') && !document.getElementById('pinLockOverlay').classList.contains('hidden');
  const hasLayer = [
    '#txDrawer', '#drawerBackdrop', '#receiptOverlay', '#statementOverlay',
    '#transferConfirmOverlay', '#confirmDialog', '#confirmBackdrop', '#onboardingOverlay'
  ].some((sel) => {
    const el = document.querySelector(sel);
    return !!el && !el.classList.contains('hidden');
  });

  if (!hasPanel && !hasLayer && !hasPin) {
    clearBodyScrollLocks({ keepPin: false });
  } else if (hasPin) {
    clearBodyScrollLocks({ keepPin: true });
  }
}

window.addEventListener('pageshow', reconcileTransientState);
window.addEventListener('popstate', () => setTimeout(reconcileTransientState, 0));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') reconcileTransientState();
});

function showToast(message, type = '') {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = type ? `toast ${type}` : 'toast';
  toast.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add('hidden'), 3200);
}

/* ── Auto-refresh balance every 40 s ── */
async function _pollBalance() {
  if (!api.token || !state.account) return;
  try {
    const fresh = await api.request('/api/accounts/main');
    const prev = state._lastBalance;
    state._lastBalance = fresh.balance;
    state.account = fresh;

    const bal = formatMoney(fresh.balance);
    const heroBalEl = $('#heroBalance');
    if (heroBalEl) {
      heroBalEl.textContent = bal;
      // Scale down font for very large numbers to prevent ₴ clipping
      const len = bal.replace(/\s/g, '').length;
      heroBalEl.style.fontSize = len > 12 ? 'clamp(1.4rem,6.5vw,2.4rem)' : len > 9 ? 'clamp(1.6rem,7.5vw,3rem)' : '';
    }
    const balVal = $('#balanceValue');
    if (balVal) balVal.textContent = bal;

    if (prev !== null && fresh.balance > prev + 0.01) {
      const diff = fresh.balance - prev;
      showToast(`💰 +${formatMoney(diff)} нараховано!`, 'success');
    }
  } catch (_) {}
}

const BALANCE_POLL_VISIBLE_MS = 40_000;
const BALANCE_POLL_BG_MS = 180_000;
const BALANCE_POLL_SLOW_MS = 75_000;

function _getBalancePollIntervalMs() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const saveData = !!conn && conn.saveData === true;
  const slowNetwork = !!conn && /2g/i.test(String(conn.effectiveType || ""));
  if (document.visibilityState !== 'visible') return BALANCE_POLL_BG_MS;
  return (saveData || slowNetwork) ? BALANCE_POLL_SLOW_MS : BALANCE_POLL_VISIBLE_MS;
}

async function _runBalancePoll(force = false) {
  if (!api.token || !state.account) return;
  if (!force && document.visibilityState !== 'visible') return;
  if (navigator.onLine === false) return;
  await _pollBalance();
}

function _rescheduleBalancePolling() {
  if (state._pollTimer) {
    clearInterval(state._pollTimer);
    state._pollTimer = null;
  }
  if (!api.token) return;
  state._pollTimer = setInterval(() => {
    _runBalancePoll(false).catch(() => {});
  }, _getBalancePollIntervalMs());
}

function startPolling() {
  _rescheduleBalancePolling();
  _runBalancePoll(true).catch(() => {});
}

function stopPolling() {
  if (state._pollTimer) {
    clearInterval(state._pollTimer);
    state._pollTimer = null;
  }
  state._lastBalance = null;
}

document.addEventListener('visibilitychange', () => {
  if (!api.token) return;
  if (!state._pollTimer) return;
  _rescheduleBalancePolling();
  if (document.visibilityState === 'visible') _runBalancePoll(true).catch(() => {});
});

window.addEventListener('online', () => {
  if (!api.token || !state._pollTimer) return;
  _runBalancePoll(true).catch(() => {});
});

let _bootstrapRetryTimer = null;

function clearBootstrapRetryTimer() {
  if (_bootstrapRetryTimer) {
    clearTimeout(_bootstrapRetryTimer);
    _bootstrapRetryTimer = null;
  }
}

function stopNotifPolling() {
  if (typeof window._stopNotifPolling === 'function') {
    window._stopNotifPolling();
  }
}

async function performLogout(options = {}) {
  const showMessage = options.showMessage !== false;
  const reason = options.reason || '';
  if (options.confirm === true) {
    const ok = window.confirm('Вийти з акаунту ARM Bank?');
    if (!ok) return false;
  }
  stopPolling();
  stopNotifPolling();
  clearBootstrapRetryTimer();
  closeTransientLayers({ keepPin: false });
  stopSessionEngine();
  try { await api.request('/api/auth/logout', { method: 'POST' }); } catch (_) {}
  api.setToken('');
  setAuthenticated(false);
  const base = getBasePath();
  window.history.replaceState(null, '', base || '/');
  if (showMessage) {
    if (reason === 'idle') showToast('Сесію завершено через бездіяльність.', 'warning');
    else if (reason === 'expired') showToast('Термін дії сесії вичерпано. Увійдіть повторно.', 'warning');
    else showToast('Ви вийшли з системи.');
  }
  if (options.broadcast !== false) {
    try { window._bcChannel?.postMessage({ type: 'LOGOUT' }); } catch (_) {}
  }
  return true;
}

function isAuthErrorResponse(error) {
  const status = Number(error?.status || 0);
  if (status === 401 || status === 403) return true;
  const msg = String(error?.message || '');
  return msg.includes('авторизац') || msg.includes('сесію') || msg.includes('Недійсна');
}

function setAuthenticated(authenticated) {
  /* Keep the early-auth CSS class in sync so toggling back to login always works */
  document.documentElement.classList.toggle('ab-authed', !!authenticated);
  $('#authScreen').classList.toggle('hidden', authenticated);
  $('#appScreen').classList.toggle('hidden', !authenticated);
  $('#sidebar')?.classList.toggle('hidden', !authenticated);
  document.body.classList.toggle('auth-mode', !authenticated);
  if (!authenticated) closeTransientLayers({ keepPin: false });
}

function formatMoney(value) {
  return `₴${Number(value || 0).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function setListLoading(containerSelector, loading) {
  const container = $(containerSelector);
  if (!container) return;
  container.classList.toggle('loading', !!loading);
  container.classList.toggle('is-loading', !!loading);
  if (loading) container.classList.remove('is-empty');
}

function setButtonLoading(button, loading) {
  if (!button) return;
  if (loading) {
    button.disabled = true;
    button.dataset.originalText = button.textContent;
    button.textContent = 'Завантаження…';
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || button.textContent;
  }
}

function renderList(containerSelector, items, renderer, emptyText) {
  const container = document.querySelector(containerSelector);
  if (!container) return;

  if (container._renderFrame) {
    cancelAnimationFrame(container._renderFrame);
    container._renderFrame = 0;
  }

  container.classList.remove('loading');
  container.classList.remove('is-loading');
  if (!items.length) {
    container.classList.add('is-empty');
    container.classList.remove('has-items');
    container.innerHTML = `<div class="empty-state"><strong>Нічого немає</strong>${emptyText || 'Даних поки немає.'}</div>`;
    return;
  }

  container.classList.add('has-items');
  container.classList.remove('is-empty');
  const html = items.map(renderer).join('');
  if (typeof requestAnimationFrame === 'function') {
    container._renderFrame = requestAnimationFrame(() => {
      container.innerHTML = html;
      container._renderFrame = 0;
    });
  } else {
    container.innerHTML = html;
  }
}

const TX_TYPE_LABELS = {
  topup: 'Поповнення', transfer: 'Переказ',
  payout: 'Виплата', donation: 'Благодійність', savings: 'Накопичення',
};

const TRANSFER_DRAFT_KEY = 'ab_transfer_draft_v1';
const TX_QUICK_FILTER_KEY = 'ab_tx_quick_filter_v1';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatLocalDateISO(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function extractFilenameFromDisposition(disposition, fallback = 'download.bin') {
  const raw = String(disposition || '');
  if (!raw) return fallback;

  const utfMatch = raw.match(/filename\\*=UTF-8''([^;]+)/i);
  if (utfMatch && utfMatch[1]) {
    try {
      return decodeURIComponent(utfMatch[1].trim());
    } catch (_) {}
  }

  const plainMatch = raw.match(/filename=\"?([^\";]+)\"?/i);
  if (plainMatch && plainMatch[1]) {
    return plainMatch[1].trim();
  }
  return fallback;
}

async function downloadBlobFile(blob, filename) {
  const name = filename || 'download.bin';
  // iOS PWA: Web Share API with files (opens native share sheet → Save to Files)
  if (navigator.share && navigator.canShare) {
    const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; }
      catch (e) { if (e.name === 'AbortError') return; /* user cancelled */ }
    }
  }
  // Desktop / Android: anchor download
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

function normalizeAccountNumber(value) {
  let v = String(value || '').toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9-]/g, '');
  if (v.startsWith('AB') && !v.startsWith('AB-')) {
    v = v.replace(/^AB-?/, 'AB-');
  }
  return v;
}

function isLikelyAccountNumber(value) {
  return /^AB-\d{4,}$/.test(normalizeAccountNumber(value));
}

function getTransferMode() {
  return ($('#transferModeToggle .tmt-btn.active') || {}).dataset?.mode || 'account';
}

function setTransferMode(mode) {
  const nextMode = mode === 'card' ? 'card' : 'account';
  const btn = document.querySelector(`#transferModeToggle .tmt-btn[data-mode="${nextMode}"]`);
  if (!btn) return;
  if (!btn.classList.contains('active')) btn.click();
}

function readTransferDraft() {
  try {
    const raw = localStorage.getItem(TRANSFER_DRAFT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return (parsed && typeof parsed === 'object') ? parsed : null;
  } catch (_) {
    return null;
  }
}

function writeTransferDraft(draft) {
  try { localStorage.setItem(TRANSFER_DRAFT_KEY, JSON.stringify(draft)); }
  catch (_) {}
}

function clearTransferDraft() {
  try { localStorage.removeItem(TRANSFER_DRAFT_KEY); }
  catch (_) {}
}

function saveTransferDraftFromForm() {
  const form = $('#transferForm');
  if (!form) return;
  const mode = getTransferMode();
  const account = normalizeAccountNumber(form.recipient_account_number?.value || '');
  const card = (form.recipient_card_number?.value || '').replace(/[^\d\s]/g, '').trim();
  const amount = form.amount?.value || '';
  const description = form.description?.value || '';
  const templateId = form.template_id?.value || '';
  const hasData = account || card || amount || description || templateId;
  if (!hasData) {
    clearTransferDraft();
    return;
  }
  writeTransferDraft({ mode, account, card, amount, description, template_id: templateId, ts: Date.now() });
}

function restoreTransferDraft() {
  const form = $('#transferForm');
  if (!form) return;
  const draft = readTransferDraft();
  if (!draft) return;

  setTransferMode(draft.mode || 'account');
  if (form.recipient_account_number && draft.account) form.recipient_account_number.value = draft.account;
  if (form.recipient_card_number && draft.card) form.recipient_card_number.value = draft.card;
  if (form.amount && draft.amount) form.amount.value = draft.amount;
  if (form.description && draft.description) form.description.value = draft.description;
  if (form.template_id && draft.template_id) form.template_id.value = draft.template_id;
}

function initTransferDraftAutosave() {
  const form = $('#transferForm');
  if (!form) return;
  ['input', 'change'].forEach((evt) => {
    form.addEventListener(evt, saveTransferDraftFromForm);
  });
  restoreTransferDraft();
}

function goToDashboardTransferForm() {
  const activeScreen = document.querySelector('.screen.active-screen')?.id;
  if (activeScreen !== 'dashboard') {
    const base = getBasePath();
    window.history.pushState(null, '', base ? base + '/dashboard' : '/dashboard');
    switchScreen('dashboard');
  }
  setDashboardActionFormsOpen(true);
  const form = $('#transferForm');
  form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function prefillTransferForm(options = {}) {
  const form = $('#transferForm');
  if (!form) return false;
  const mode = options.mode === 'card' ? 'card' : 'account';
  setTransferMode(mode);
  if (mode === 'card') {
    if (form.recipient_card_number) form.recipient_card_number.value = options.card || '';
    if (form.recipient_account_number) form.recipient_account_number.value = '';
  } else {
    if (form.recipient_account_number) form.recipient_account_number.value = normalizeAccountNumber(options.account || '');
    if (form.recipient_card_number) form.recipient_card_number.value = '';
  }
  if (form.amount && options.amount !== undefined && options.amount !== null && options.amount !== '') {
    const num = Number(options.amount);
    form.amount.value = Number.isFinite(num) ? num.toFixed(2) : String(options.amount);
  }
  if (form.description && options.description) form.description.value = options.description;
  saveTransferDraftFromForm();
  return true;
}

function buildQuickRecipients(contacts = [], transactions = []) {
  const map = new Map();

  contacts.forEach((row, idx) => {
    const acc = normalizeAccountNumber(row.account_number || '');
    if (!isLikelyAccountNumber(acc)) return;
    map.set(acc, {
      account: acc,
      title: row.contact_name || `Контакт ${idx + 1}`,
      score: 300 - idx * 3,
    });
  });

  transactions.forEach((tx, idx) => {
    if (tx.tx_type !== 'transfer' || tx.direction !== 'out') return;
    const acc = normalizeAccountNumber(tx.related_account || '');
    if (!isLikelyAccountNumber(acc)) return;
    const score = Math.max(1, 120 - idx);
    const existing = map.get(acc);
    if (existing) {
      existing.score += score;
      return;
    }
    map.set(acc, {
      account: acc,
      title: 'Швидкий переказ',
      score: score,
    });
  });

  return Array.from(map.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

function renderTransferQuickRecipients(items = []) {
  const wrap = $('#transferQuickRecipients');
  if (!wrap) return;

  if (!items.length) {
    wrap.classList.add('hidden');
    wrap.innerHTML = '';
    return;
  }

  wrap.innerHTML = items.map((item) => {
    const shortAcc = item.account.length > 10 ? `${item.account.slice(0, 7)}…${item.account.slice(-2)}` : item.account;
    return `<button type="button" class="tqr-chip" data-quick-account="${escapeHtml(item.account)}" title="${escapeHtml(item.account)}">${escapeHtml(item.title)} · ${escapeHtml(shortAcc)}</button>`;
  }).join('');

  wrap.classList.remove('hidden');
  wrap.querySelectorAll('[data-quick-account]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const account = normalizeAccountNumber(btn.dataset.quickAccount || '');
      if (!account) return;
      goToDashboardTransferForm();
      prefillTransferForm({ mode: 'account', account: account });
      showToast(`Отримувач ${account} підставлено.`, 'success');
    });
  });
}

function setTxQuickFilterActive(key) {
  $$('#txQuickFilters .tx-qf-chip').forEach((btn) => {
    const btnKey = btn.dataset.days ? `days${btn.dataset.days}` : (btn.dataset.range || '');
    btn.classList.toggle('active', !!key && key !== 'clear' && btnKey === key);
  });
}

function applyTxQuickFilter(key, options = {}) {
  const opts = { reload: true, persist: true, ...options };
  const form = $('#transactionsFilters');
  if (!form) return;

  const fromInput = form.querySelector('[name="from_date"]');
  const toInput = form.querySelector('[name="to_date"]');
  if (!fromInput || !toInput) return;

  const now = new Date();
  const today = formatLocalDateISO(now);
  let nextKey = key;

  if (key === 'today') {
    fromInput.value = today;
    toInput.value = today;
  } else if (key === 'month') {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    fromInput.value = formatLocalDateISO(monthStart);
    toInput.value = today;
  } else if (key === 'days7' || key === 'days30') {
    const days = key === 'days7' ? 7 : 30;
    const from = new Date(now);
    from.setDate(now.getDate() - (days - 1));
    fromInput.value = formatLocalDateISO(from);
    toInput.value = today;
  } else {
    nextKey = 'clear';
    fromInput.value = '';
    toInput.value = '';
  }

  setTxQuickFilterActive(nextKey);
  if (opts.persist) {
    if (nextKey === 'clear') localStorage.removeItem(TX_QUICK_FILTER_KEY);
    else localStorage.setItem(TX_QUICK_FILTER_KEY, nextKey);
  }
  if (opts.reload) loadTransactionsWithFilters();
}

function initTxQuickFilters() {
  const wrap = $('#txQuickFilters');
  if (!wrap) return;
  wrap.addEventListener('click', (event) => {
    const btn = event.target.closest('.tx-qf-chip');
    if (!btn) return;
    if (btn.dataset.range === 'today') return applyTxQuickFilter('today');
    if (btn.dataset.range === 'month') return applyTxQuickFilter('month');
    if (btn.dataset.range === 'clear') return applyTxQuickFilter('clear');
    if (btn.dataset.days === '7') return applyTxQuickFilter('days7');
    if (btn.dataset.days === '30') return applyTxQuickFilter('days30');
  });

  const form = $('#transactionsFilters');
  if (form) {
    ['from_date', 'to_date'].forEach((name) => {
      form.querySelector(`[name="${name}"]`)?.addEventListener('change', () => {
        localStorage.removeItem(TX_QUICK_FILTER_KEY);
        setTxQuickFilterActive('');
      });
    });
  }

  const savedKey = localStorage.getItem(TX_QUICK_FILTER_KEY);
  if (savedKey) applyTxQuickFilter(savedKey, { reload: false, persist: false });
}

function renderTransactions(list, container = '#transactionsList') {
  const el = $(container);
  if (!el) return;
  el.classList.remove('loading');
  el.classList.remove('is-loading');
  if (!list.length) {
    el.classList.add('is-empty');
    el.classList.remove('has-items');
    el.innerHTML = '<div class="empty-state"><strong>Нічого немає</strong>Транзакцій поки немає.</div>';
    return;
  }

  el.classList.add('has-items');
  el.classList.remove('is-empty');

  // Group by date
  const groups = {};
  list.forEach(tx => {
    const day = (tx.created_at || '').slice(0, 10);
    if (!groups[day]) groups[day] = [];
    groups[day].push(tx);
  });

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  function dayLabel(day) {
    if (!day || day.length < 8) return 'Невідома дата';
    if (day === today) return 'Сьогодні';
    if (day === yesterday) return 'Вчора';
    try {
      const d = new Date(day + 'T00:00:00');
      if (isNaN(d.getTime())) return day || 'Невідома дата';
      return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', weekday: 'short' });
    } catch(_) { return day || 'Невідома дата'; }
  }

  // Remap legacy military titles stored in DB
  const TX_TITLE_REMAP = { 'Бойова виплата': 'Виплата', 'Бойові виплати': 'Виплати' };

  el.innerHTML = Object.keys(groups).sort((a,b) => b.localeCompare(a)).map(day => `
    <div class="tx-date-group">
      <div class="tx-date-label">${dayLabel(day)}</div>
      ${groups[day].map(tx => {
        const txTitle = TX_TITLE_REMAP[tx.description] || tx.description;
        return `
        <div class="item item-clickable" data-tx-id="${tx.id}">
          <div class="tx-dir-dot ${tx.direction}"></div>
          <div class="item-body">
            <div class="item-header">
              <strong>${escapeHtml(txTitle)}</strong>${tx.note ? ' <span title="Є нотатка" style="font-size:11px;opacity:.6">✎</span>' : ''}
              <span class="amount ${tx.direction}">${tx.direction === 'in' ? '+' : '−'}${formatMoney(tx.amount)}</span>
            </div>
            <div class="muted">${TX_TYPE_LABELS[tx.tx_type] || tx.tx_type}${tx.related_account ? ` · ${escapeHtml(tx.related_account)}` : ''}</div>
          </div>
          <button type="button" class="tx-receipt-btn" data-tx-receipt="${tx.id}" data-amount="${tx.amount}" data-dir="${tx.direction}" data-desc="${escapeHtml(tx.description||'')}" data-from="${escapeHtml(tx.related_account||'')}" data-at="${tx.created_at||''}" title="Чек PDF" style="background:none;border:none;cursor:pointer;padding:4px 6px;opacity:.35;color:inherit;flex-shrink:0;line-height:1">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          </button>
        </div>
      `; }).join('')}
    </div>
  `).join('');

  // Bind receipt button (must bind before drawer to stop propagation)
  el.querySelectorAll('.tx-receipt-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      btn.style.opacity = '1';
      setTimeout(() => { btn.style.opacity = '.35'; }, 600);
      const myAcc = $('#heroAccount')?.textContent?.replace(/^Рахунок:\s*/i, '').trim() || '—';
      const dir = btn.dataset.dir || 'out';
      receipt.open({
        tx_id:        Number(btn.dataset.txReceipt),
        amount:       Number(btn.dataset.amount),
        direction:    dir,
        from_account: dir === 'out' ? myAcc : (btn.dataset.from || '—'),
        to_account:   dir === 'out' ? (btn.dataset.from || '—') : myAcc,
        description:  btn.dataset.desc,
        created_at:   btn.dataset.at,
      });
    });
  });

  // Bind click → drawer
  el.querySelectorAll('.item-clickable').forEach(item => {
    item.addEventListener('click', () => {
      const fn = (typeof window !== 'undefined' && window.openTxDrawer) ? window.openTxDrawer : openTxDrawer;
      fn(Number(item.dataset.txId));
    });
  });
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' })
      + ' ' + d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  } catch (_) { return iso; }
}

function renderSimpleList(container, list, mapFn, emptyText) {
  renderList(container, list, mapFn, emptyText);
}

// ── TRANSACTION DRAWER ──────────────────────────────────
function openDrawer() {
  $('#txDrawer')?.classList.remove('hidden');
  $('#drawerBackdrop')?.classList.remove('hidden');
  lockBodyScroll('drawer');
}

function closeDrawer() {
  $('#txDrawer')?.classList.add('hidden');
  $('#drawerBackdrop')?.classList.add('hidden');
  unlockBodyScroll('drawer');
}

async function openTxDrawer(txId) {
  if (!txId) return;
  openDrawer();
  const body = $('#drawerBody');
  if (body) {
    body.dataset.txId = txId;
    body.innerHTML = '<div class="drawer-loading">Завантаження…</div>';
  }
  try {
    const tx = await api.request(`/api/transactions/${txId}`);
    if (!body) return;

    const typeLabel = TX_TYPE_LABELS[tx.tx_type] || tx.tx_type;
    const repeatTarget = typeof getRepeatTransferTarget === 'function' ? getRepeatTransferTarget(tx) : null;
    const tagBadges = tx.tags
      ? tx.tags.split(',').map(t => t.trim()).filter(Boolean)
          .map(t => `<span class="tag-badge">${escapeHtml(t)}</span>`).join('')
      : '';

    body.innerHTML = `
      <div class="drawer-amount ${tx.direction}">
        ${tx.direction === 'in' ? '+' : '−'}${formatMoney(tx.amount)}
      </div>
      <div class="drawer-type-chip">${typeLabel} · ${tx.direction === 'in' ? '↓ Прихід' : '↑ Відхід'}</div>
      <dl class="drawer-info-list">
        <div class="drawer-info-row"><dt>Опис</dt><dd>${escapeHtml(tx.description || '—')}</dd></div>
        ${tx.related_account ? `<div class="drawer-info-row"><dt>Контрагент</dt><dd>${escapeHtml(tx.related_account)}</dd></div>` : ''}
        <div class="drawer-info-row"><dt>Дата</dt><dd>${formatDate(tx.created_at)}</dd></div>
        <div class="drawer-info-row"><dt>ID операції</dt><dd>#${tx.id}</dd></div>
        <div class="drawer-info-row"><dt>Статус</dt><dd class="status-ok">✓ Виконано</dd></div>
      </dl>
      ${tagBadges ? `<div class="drawer-tags-row">${tagBadges}</div>` : ''}
      <div class="drawer-actions">
        <button class="btn-primary" id="drawerPdfBtn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          Завантажити чек PDF
        </button>
        <button class="btn-ghost" id="drawerShareBtn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          Поділитися
        </button>
        ${repeatTarget ? `<button class="btn-accent" id="drawerRepeatBtn">Повторити переказ</button>` : ''}
      </div>
      <div class="drawer-note-section">
        <label class="drawer-note-label">Нотатка</label>
        <textarea id="drawerNoteInput" class="drawer-note-input" placeholder="Особиста нотатка…" rows="2">${escapeHtml(tx.note || '')}</textarea>
        <button id="saveNoteBtn" class="btn-ghost btn-sm" style="margin-top:6px;width:100%">Зберегти нотатку</button>
      </div>
      <div class="drawer-note-section" style="margin-top:0;padding-top:0;border-top:0">
        <label class="drawer-note-label">Теги</label>
        <input id="drawerTagsInput" type="text" class="drawer-note-input" placeholder="їжа, магазин, особисте" value="${escapeHtml(tx.tags || '')}">
        <button id="saveTagsBtn" class="btn-ghost btn-sm" style="margin-top:6px;width:100%">Зберегти теги</button>
      </div>
    `;

    $('#drawerPdfBtn')?.addEventListener('click', async () => {
      const btn = $('#drawerPdfBtn');
      const orig = btn.innerHTML;
      try {
        btn.disabled = true;
        btn.innerHTML = '<span style="opacity:.6">Формування…</span>';
        const res = await fetch(`${window.ARMY_BANK_BASE || ''}/api/transactions/${tx.id}/receipt`, {
          headers: { Authorization: `Bearer ${api.token}` },
        });
        if (!res.ok) { const t = await res.text(); throw new Error(t); }
        const blob = await res.blob();
        const filename = extractFilenameFromDisposition(
          res.headers.get('Content-Disposition'),
          `armybank_receipt_tx${tx.id}.pdf`
        );
        downloadBlobFile(blob, filename);
        showToast('Чек завантажено.', 'success');
      } catch(e) {
        showToast(e.message || 'Помилка завантаження.');
      } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
      }
    });

    $('#drawerShareBtn')?.addEventListener('click', () => {
      if (typeof shareTransaction === 'function') shareTransaction(tx);
    });

    $('#drawerRepeatBtn')?.addEventListener('click', () => {
      if (!repeatTarget) return;
      if (typeof goToDashboardTransferForm === 'function') goToDashboardTransferForm();
      if (typeof prefillTransferForm === 'function') prefillTransferForm({
        mode: repeatTarget.mode, account: repeatTarget.account,
        card: repeatTarget.card, amount: tx.amount,
        description: tx.description || 'Переказ',
      });
      closeDrawer();
      showToast('Переказ підготовлено до повтору.', 'success');
    });

    $('#saveNoteBtn')?.addEventListener('click', async () => {
      const note = $('#drawerNoteInput')?.value || '';
      try {
        await api.request(`/api/transactions/${tx.id}/note`, {
          method: 'PATCH', body: JSON.stringify({ note }),
        });
        showToast('Нотатку збережено.', 'success');
      } catch(e) { showToast(e.message); }
    });

    $('#saveTagsBtn')?.addEventListener('click', async () => {
      const tags = $('#drawerTagsInput')?.value || '';
      try {
        await api.request(`/api/transactions/${tx.id}/tags`, {
          method: 'PATCH', body: JSON.stringify({ tags }),
        });
        showToast('Теги збережено.', 'success');
        if (typeof loadTagsCloud === 'function') loadTagsCloud().catch(() => {});
      } catch(e) { showToast(e.message); }
    });
  } catch (e) {
    if (body) body.innerHTML = `<div class="drawer-error">${escapeHtml(e.message)}</div>`;
  }
}
window.openTxDrawer = openTxDrawer;

$('#drawerClose')?.addEventListener('click', closeDrawer);
$('#drawerBackdrop')?.addEventListener('click', closeDrawer);

// ── CONFIRM DIALOG ──────────────────────────────────────
let _confirmCallback = null;

function confirmAction(title, msg, onOk) {
  const dialog = $('#confirmDialog');
  const backdrop = $('#confirmBackdrop');
  $('#confirmTitle').textContent = title;
  $('#confirmMsg').textContent = msg;
  dialog?.classList.remove('hidden');
  backdrop?.classList.remove('hidden');
  lockBodyScroll('confirm');
  _confirmCallback = onOk;
}

function closeConfirm() {
  $('#confirmDialog')?.classList.add('hidden');
  $('#confirmBackdrop')?.classList.add('hidden');
  unlockBodyScroll('confirm');
  _confirmCallback = null;
}

$('#confirmCancel')?.addEventListener('click', closeConfirm);
$('#confirmBackdrop')?.addEventListener('click', closeConfirm);
$('#confirmOk')?.addEventListener('click', () => {
  if (_confirmCallback) _confirmCallback();
  closeConfirm();
});

// ── CSV EXPORT ──────────────────────────────────────────
async function exportCsv() {
  const btn = $('#exportCsvBtn');
  try {
    setButtonLoading(btn, true);
    const form = $('#transactionsFilters');
    const params = new URLSearchParams();
    if (form) {
      const fd = new FormData(form);
      if (fd.get('from_date')) params.set('from_date', fd.get('from_date'));
      if (fd.get('to_date'))   params.set('to_date',   fd.get('to_date'));
    }
    const url = '/api/transactions/export' + (params.toString() ? '?' + params.toString() : '');
    const res = await fetch((typeof window !== 'undefined' && window.ARMY_BANK_BASE || '') + url, {
      headers: { Authorization: `Bearer ${api.token}` },
    });
    if (!res.ok) throw new Error('Помилка експорту');
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `army-bank-transactions-${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    showToast('CSV файл завантажено.', 'success');
  } catch (e) {
    showToast(e.message);
  } finally {
    setButtonLoading(btn, false);
  }
}

$('#exportCsvBtn')?.addEventListener('click', exportCsv);

// ── Balance hide/show toggle ──────────────────────────────────────────────────
(function () {
  const LS_KEY = 'army_bank_balance_hidden';
  let hidden = localStorage.getItem(LS_KEY) === '1';

  function maskBalance() {
    const el = $('#heroBalance');
    if (!el) return;
    if (!el.dataset.real && el.textContent && !el.textContent.includes('•'))
      el.dataset.real = el.textContent;
    el.textContent = '₴ ••••••';
    el.style.letterSpacing = '.12em';
  }

  function unmaskBalance() {
    const el = $('#heroBalance');
    if (!el) return;
    if (el.dataset.real) { el.textContent = el.dataset.real; }
    el.style.letterSpacing = '';
  }

  function syncIcons() {
    const eye    = $('#eyeIcon');
    const eyeOff = $('#eyeOffIcon');
    const btn    = $('#toggleBalanceBtn');
    if (eye)    eye.style.display    = hidden ? 'none' : '';
    if (eyeOff) eyeOff.style.display = hidden ? ''     : 'none';
    if (btn)    btn.title = hidden ? 'Показати баланс' : 'Приховати баланс';
  }

  // Keep data-real fresh when balance updates from app state
  const _origSetter = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent').set;
  window._syncHeroBalance = function(newText) {
    const el = $('#heroBalance');
    if (!el) return;
    el.dataset.real = newText;
    if (hidden) maskBalance(); else { _origSetter.call(el, newText); el.style.letterSpacing = ''; }
  };

  function init() {
    syncIcons();
    if (hidden) maskBalance();
    $('#toggleBalanceBtn')?.addEventListener('click', () => {
      hidden = !hidden;
      localStorage.setItem(LS_KEY, hidden ? '1' : '0');
      if (hidden) maskBalance(); else unmaskBalance();
      syncIcons();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

// ── Hero account copy ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  $('#heroAccountCopyBtn')?.addEventListener('click', function () {
    const raw = $('#heroAccount')?.textContent?.replace(/^Рахунок:\s*/i, '').trim();
    if (!raw || raw === '—') return;
    navigator.clipboard?.writeText(raw)
      .then(() => showToast('Номер рахунку скопійовано', 'success'))
      .catch(() => {});
  });
});

// ── Receipt modal ────────────────────────────────────────────────────────────
const receipt = (() => {
  let _txId = null;

  function fmtAmt(amount, direction) {
    const sign = direction === 'in' ? '+' : '−';
    const color = direction === 'in' ? 'var(--mono-success, #34d399)' : 'var(--mono-danger, #f87171)';
    const val = '₴\u202f' + Math.abs(Number(amount)).toLocaleString('uk-UA', { minimumFractionDigits: 2 });
    return `<span style="color:${color}">${sign}${val}</span>`;
  }

  function fmtDt(s) {
    if (!s) return '—';
    try {
      return new Date(s).toLocaleString('uk-UA', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch (_) { return s; }
  }

  function open(data) {
    // data: { tx_id, amount, direction, from_account, to_account, description, created_at, title }
    _txId = data.tx_id || null;
    const dir = data.direction || 'out';

    const amtEl = $('#receiptAmount');
    if (amtEl) { amtEl.innerHTML = fmtAmt(data.amount, dir); amtEl.dataset.dir = dir; }
    $('#receiptTitle').textContent = data.title || (dir === 'in' ? 'Надходження' : 'Переказ виконано');
    $('#receiptTxId').textContent  = _txId ? `#${_txId}` : '—';
    $('#receiptDate').textContent  = fmtDt(data.created_at || new Date().toISOString());
    $('#receiptFrom').textContent  = data.from_account || '—';
    $('#receiptTo').textContent    = data.to_account   || '—';
    $('#receiptDesc').textContent  = data.description  || '—';

    // Icon/colour by direction
    const icon = $('#receiptIcon');
    if (icon) {
      icon.style.background = dir === 'in' ? 'rgba(31,160,85,.12)' : 'rgba(47,74,55,.12)';
      icon.innerHTML = dir === 'in'
        ? '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--mono-success,#1fa055)" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>'
        : '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--mono-blue-mid,#46664a)" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
    }

    $('#receiptDownloadBtn').disabled = !_txId;
    $('#receiptOverlay')?.classList.remove('hidden');
    lockBodyScroll('receipt');
  }

  async function download() {
    if (!_txId) return;
    const btn = $('#receiptDownloadBtn');
    try {
      btn.disabled = true;
      btn.innerHTML = '<span style="opacity:.6">Формування…</span>';
      const res = await fetch(`${window.ARMY_BANK_BASE || ''}/api/transactions/${_txId}/receipt`, {
        headers: { Authorization: `Bearer ${api.token}` },
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Помилка'); }
      const blob = await res.blob();
      const filename = extractFilenameFromDisposition(
        res.headers.get('Content-Disposition'),
        `armybank_receipt_tx${_txId}.pdf`
      );
      downloadBlobFile(blob, filename);
      showToast(`Квитанцію збережено: ${filename}`, 'success');
    } catch (e) {
      showToast(escapeHtml(e.message));
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="margin-right:6px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Скачати чек PDF';
    }
  }

  function close() {
    $('#receiptOverlay')?.classList.add('hidden');
    unlockBodyScroll('receipt');
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('#receiptDownloadBtn')?.addEventListener('click', download);
    $('#receiptCloseBtn')?.addEventListener('click', close);
    $('#receiptShareBtn')?.addEventListener('click', () => {
      if (typeof shareTransaction === 'function') {
        shareTransaction({
          id:              _txId,
          description:     $('#receiptDesc')?.textContent || '—',
          amount:          ($('#receiptAmount')?.textContent || '').replace(/[^0-9.,]/g, '').replace(',', '.'),
          direction:       ($('#receiptAmount')?.dataset?.dir) || 'out',
          tx_type:         'transfer',
          created_at:      $('#receiptDate')?.textContent || new Date().toISOString(),
          related_account: $('#receiptTo')?.textContent || '',
        });
      }
    });
    $('#receiptOverlay')?.addEventListener('click', e => { if (e.target === $('#receiptOverlay')) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#receiptOverlay')?.classList.contains('hidden')) close(); });
  });

  return { open, close };
})();

// ── Statement modal ──────────────────────────────────────────────────────────
(function () {
  const overlay = () => $('#statementOverlay');
  const dlBtn = () => $('#stmtDownloadBtn');
  const csvBtn = () => $('#stmtCsvBtn');
  const cancelBtn = () => $('#stmtCancelBtn');
  const periodGrid = () => $('#stmtPeriodGrid');
  const customDates = () => $('#stmtCustomDates');
  const periodLabel = () => $('#stmtPeriodLabel');
  const reportType = () => $('#stmtReportType');
  const ordersList = () => $('#stmtRecentOrders');

  const dlBtnDefaultHtml = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="margin-right:6px;flex-shrink:0"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Завантажити PDF`;
  const csvBtnDefaultHtml = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" style="margin-right:4px;flex-shrink:0"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>CSV`;

  let _from = null;
  let _to = null;

  function isoDate(d) { return d.toISOString().slice(0, 10); }

  function selectedReportType() {
    return (reportType()?.value || 'detailed').trim().toLowerCase();
  }

  function setActivePeriod(btn) {
    $$('.stmt-period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  function applyPeriod(period) {
    const now = new Date();
    customDates().style.display = 'none';
    dlBtn().disabled = false;
    if (csvBtn()) csvBtn().disabled = false;

    if (period === 'cur_month') {
      _from = isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
      _to = isoDate(now);
      const m = now.toLocaleString('uk-UA', { month: 'long', year: 'numeric' });
      periodLabel().textContent = `Поточний місяць · ${m}`;
    } else if (period === 'prev_month') {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      _from = isoDate(first);
      _to = isoDate(last);
      periodLabel().textContent = `Минулий місяць · ${first.toLocaleString('uk-UA', { month: 'long', year: 'numeric' })}`;
    } else if (period === '3months') {
      const d = new Date(now); d.setMonth(d.getMonth() - 3);
      _from = isoDate(d); _to = isoDate(now);
      periodLabel().textContent = `Останні 3 місяці · ${_from} — ${_to}`;
    } else if (period === '6months') {
      const d = new Date(now); d.setMonth(d.getMonth() - 6);
      _from = isoDate(d); _to = isoDate(now);
      periodLabel().textContent = `Останні 6 місяців · ${_from} — ${_to}`;
    } else if (period === 'cur_year') {
      _from = `${now.getFullYear()}-01-01`; _to = isoDate(now);
      periodLabel().textContent = `Поточний рік · ${now.getFullYear()}`;
    } else if (period === 'all') {
      _from = null; _to = null;
      periodLabel().textContent = 'Весь час · усі операції';
    } else if (period === 'custom') {
      customDates().style.display = 'grid';
      const fi = $('#stmtFrom');
      const ti = $('#stmtTo');
      if (fi && ti && !fi.value && !ti.value) {
        fi.value = isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
        ti.value = isoDate(now);
      }
      _from = fi?.value || null;
      _to = ti?.value || null;
      updateCustomLabel();
    }
  }

  function updateCustomLabel() {
    const f = $('#stmtFrom')?.value;
    const t = $('#stmtTo')?.value;
    _from = f || null;
    _to = t || null;
    periodLabel().textContent = (f || t) ? `${f || '…'} — ${t || '…'}` : 'Оберіть діапазон';
    dlBtn().disabled = !f && !t;
    if (csvBtn()) csvBtn().disabled = !f && !t;
  }

  function orderFallbackFilename() {
    const suffix = (_from && _to) ? `${_from}_${_to}` : new Date().toISOString().slice(0, 10);
    return `armybank_statement_${selectedReportType()}_${suffix}.pdf`;
  }

  async function fetchAndDownloadByQuery(downloadQuery, fallbackFilename) {
    const query = String(downloadQuery || '').trim();
    const url = '/api/transactions/statement' + (query ? `?${query}` : '');
    const res = await fetch((window.ARMY_BANK_BASE || '') + url, {
      headers: { Authorization: `Bearer ${api.token}` },
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || 'Помилка формування виписки');
    }
    const blob = await res.blob();
    const filename = extractFilenameFromDisposition(
      res.headers.get('Content-Disposition'),
      fallbackFilename || orderFallbackFilename()
    );
    downloadBlobFile(blob, filename);
  }

  function renderRecentOrders(items) {
    const box = ordersList();
    if (!box) return;
    if (!Array.isArray(items) || !items.length) {
      box.innerHTML = '<div class="stmt-order-empty">Поки немає замовлень.</div>';
      return;
    }

    box.innerHTML = items.map(item => {
      const period = escapeHtml(item.period_label || '—');
      const typeLabel = escapeHtml(item.report_type_label || item.report_type || '—');
      const created = item.created_at ? formatDate(item.created_at) : '—';
      const filename = escapeHtml(item.filename || 'statement.pdf');
      const query = encodeURIComponent(item.download_query || '');
      return `
        <div class="stmt-order-item">
          <div class="stmt-order-main">
            <div class="stmt-order-title">${typeLabel}</div>
            <div class="stmt-order-meta">${period} · ${created}</div>
            <div class="stmt-order-file">${filename}</div>
          </div>
          <button type="button" class="stmt-order-download" data-query="${query}" data-filename="${filename}">PDF</button>
        </div>
      `;
    }).join('');

    box.querySelectorAll('.stmt-order-download').forEach(btn => {
      btn.addEventListener('click', async () => {
        const query = decodeURIComponent(btn.dataset.query || '');
        const filename = btn.dataset.filename || orderFallbackFilename();
        try {
          btn.disabled = true;
          await fetchAndDownloadByQuery(query, filename);
          showToast('Виписку завантажено.', 'success');
        } catch (e) {
          showToast(e.message || 'Помилка завантаження');
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  async function loadRecentOrders() {
    const box = ordersList();
    if (!box) return;
    box.innerHTML = '<div class="stmt-order-empty">Завантаження…</div>';
    try {
      const rows = await api.request('/api/transactions/statement/orders?limit=6');
      renderRecentOrders(rows || []);
    } catch (_) {
      box.innerHTML = '<div class="stmt-order-empty">Не вдалося завантажити історію.</div>';
    }
  }

  function openStatementModal() {
    const acNum = ($('#heroAccount')?.textContent || '').replace(/^Рахунок:\s*/i, '').trim() || '—';
    const owner = ($('#userName')?.textContent || '').trim() || '—';
    $('#stmtAccount').textContent = acNum;
    $('#stmtOwner').textContent = owner;
    if (reportType()) reportType().value = 'detailed';

    $$('.stmt-period-btn').forEach(b => b.classList.remove('active'));
    customDates().style.display = 'none';
    if (csvBtn()) csvBtn().disabled = true;
    const curMonthBtn = document.querySelector('.stmt-period-btn[data-period="cur_month"]');
    if (curMonthBtn) { curMonthBtn.classList.add('active'); applyPeriod('cur_month'); }

    overlay()?.classList.remove('hidden');
    lockBodyScroll('statement');
    loadRecentOrders().catch(() => {});
  }

  function closeStatementModal() {
    overlay()?.classList.add('hidden');
    unlockBodyScroll('statement');
  }

  async function downloadStatement() {
    const btn = dlBtn();
    try {
      btn.disabled = true;
      if (csvBtn()) csvBtn().disabled = true;
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="margin-right:6px;animation:spin 1s linear infinite"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.49-8.49"/></svg><span>Формування…</span>';

      const payload = { report_type: selectedReportType() };
      if (_from) payload.from_date = _from;
      if (_to)   payload.to_date   = _to;

      const order = await api.request('/api/transactions/statement/order', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!order || !order.download_query) {
        throw new Error('Не вдалося отримати параметри замовлення виписки.');
      }

      const filename = order.filename || orderFallbackFilename();
      await fetchAndDownloadByQuery(order.download_query, filename);
      showToast(`Виписку завантажено: ${filename}`, 'success');
      await loadRecentOrders();
      closeStatementModal();
    } catch (e) {
      showToast(escapeHtml(e.message) || 'Помилка формування виписки');
    } finally {
      btn.disabled = false;
      btn.innerHTML = dlBtnDefaultHtml;
      if (csvBtn()) csvBtn().disabled = false;
    }
  }

  async function downloadCsv() {
    const btn = csvBtn();
    if (!btn) return;
    try {
      btn.disabled = true;
      btn.innerHTML = '<span style="opacity:.6">CSV…</span>';

      const params = new URLSearchParams();
      if (_from) params.set('from_date', _from);
      if (_to)   params.set('to_date',   _to);
      const url = `${window.ARMY_BANK_BASE || ''}/api/transactions/export?${params}`;

      const res = await fetch(url, { headers: { Authorization: `Bearer ${api.token}` } });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Помилка завантаження CSV');
      }
      const blob = await res.blob();
      const suffix = (_from && _to) ? `${_from}_${_to}` : new Date().toISOString().slice(0, 10);
      const fname = extractFilenameFromDisposition(res.headers.get('Content-Disposition'), `armybank_${suffix}.csv`);
      downloadBlobFile(blob, fname);
      showToast(`CSV завантажено: ${fname}`, 'success');
    } catch (e) {
      showToast(escapeHtml(e.message) || 'Помилка CSV');
    } finally {
      btn.disabled = false;
      btn.innerHTML = csvBtnDefaultHtml;
    }
  }

  function init() {
    $('#exportPdfBtn')?.addEventListener('click', openStatementModal);

    periodGrid()?.addEventListener('click', (e) => {
      const btn = e.target.closest('.stmt-period-btn');
      if (!btn) return;
      setActivePeriod(btn);
      applyPeriod(btn.dataset.period);
    });

    document.querySelector('.stmt-period-btn[data-period="custom"]')?.addEventListener('click', function () {
      setActivePeriod(this);
      applyPeriod('custom');
    });

    $('#stmtFrom')?.addEventListener('change', updateCustomLabel);
    $('#stmtTo')?.addEventListener('change', updateCustomLabel);
    dlBtn()?.addEventListener('click', downloadStatement);
    csvBtn()?.addEventListener('click', downloadCsv);
    cancelBtn()?.addEventListener('click', closeStatementModal);
    overlay()?.addEventListener('click', (e) => { if (e.target === overlay()) closeStatementModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeStatementModal(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

// ── ANALYTICS ───────────────────────────────────────────
async function loadAnalytics() {
  try {
    const data = await api.request('/api/analytics/summary');
    const cur = data.current_month || {};
    const prev = data.prev_month || {};
    const byType = data.by_type || [];
    const monthly = data.monthly || [];

    // Update dashboard strip
    const setDash = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    setDash('#dashMonthIn',    formatMoney(cur.total_in  || 0));
    setDash('#dashMonthOut',   formatMoney(cur.total_out || 0));
    setDash('#dashMonthCount', cur.tx_count || cur.count || 0);

    // Summary cards
    const setEl = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    setEl('#amsIn',    formatMoney(cur.total_in  || 0));
    setEl('#amsOut',   formatMoney(cur.total_out || 0));
    setEl('#amsCount', cur.tx_count || cur.count || 0);

    const diffLabel = (cur_v, prev_v, isMoney) => {
      if (!prev_v) return '';
      const diff = cur_v - prev_v;
      const label = isMoney ? formatMoney(Math.abs(diff)) : Math.abs(diff);
      return diff >= 0 ? `▲ ${label} vs попередній місяць` : `▼ ${label} vs попередній місяць`;
    };
    const curCount  = cur.tx_count  || cur.count  || 0;
    const prevCount = prev.tx_count || prev.count || 0;
    setEl('#amsPrevIn',    diffLabel(cur.total_in  || 0, prev.total_in  || 0, true));
    setEl('#amsPrevOut',   diffLabel(cur.total_out || 0, prev.total_out || 0, true));
    setEl('#amsPrevCount', diffLabel(curCount, prevCount, false));

    // By type bar list
    const byTypeEl = $('#analyticsByType');
    if (byTypeEl) {
      const maxAmt = Math.max(...byType.map(r => Number(r.total) || 0), 1);
      byTypeEl.innerHTML = byType.length ? byType.map(r => {
        const pct = Math.round((Number(r.total) / maxAmt) * 100);
        return `
          <div class="cat-row">
            <span class="cat-label">${TX_TYPE_LABELS[r.tx_type] || r.tx_type}</span>
            <div class="cat-bar-wrap"><div class="cat-bar" style="width:${pct}%"></div></div>
            <span class="cat-amount">${formatMoney(r.total)}</span>
          </div>`;
      }).join('') : '<div class="empty-state">Операцій ще немає.</div>';
    }

    // 6-month bar chart
    const chartEl = $('#analyticsBarChart');
    if (chartEl && monthly.length) {
      const maxVal = Math.max(...monthly.map(m => Math.max(Number(m.total_in)||0, Number(m.total_out)||0)), 1);
      chartEl.innerHTML = monthly.map(m => {
        const inH  = Math.round((Number(m.total_in)  / maxVal) * 80);
        const outH = Math.round((Number(m.total_out) / maxVal) * 80);
        return `
          <div class="bar-group">
            <div class="bar-pair">
              <div class="bar bar-in"  style="height:${inH}px"  title="Прихід: ${formatMoney(m.total_in)}"></div>
              <div class="bar bar-out" style="height:${outH}px" title="Витрати: ${formatMoney(m.total_out)}"></div>
            </div>
            <div class="bar-label">${m.month || ''}</div>
          </div>`;
      }).join('');
    } else if (chartEl) {
      chartEl.innerHTML = '<div class="empty-state">Недостатньо даних для графіку.</div>';
    }

    // Render pie chart with by_type data
    if (typeof renderPieChart === 'function') {
      renderPieChart(byType);
    }
  } catch (_) {}

  // Load additional analytics features
  if (typeof loadInsights === 'function') loadInsights().catch(() => {});
  if (typeof loadBudgetLimits === 'function') loadBudgetLimits().catch(() => {});
  if (typeof renderHeatmap === 'function') renderHeatmap().catch(() => {});
  if (typeof loadForecast === 'function') loadForecast().catch(() => {});
}

// ── PROFILE SCREEN ──────────────────────────────────────
function renderProfileScreen() {
  if (!state.user || !state.account) return;
  const roleLabels = { soldier: 'Клієнт', operator: 'Оператор', admin: 'Адміністратор', platform_admin: 'Платформа' };
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v || '—'; };
  set('#piName',    state.user.full_name);
  set('#piPhone',   state.user.phone);
  set('#piEmail',   state.user.email);
  set('#piAccount', state.account.account_number);
  set('#piRole',    roleLabels[state.user.role] || state.user.role);
  loadAchievements();
}

// Change password form
$('#changePasswordForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = form.querySelector('button[type="submit"]');
  const fd = new FormData(form);
  const oldPw  = fd.get('old_password');
  const newPw  = fd.get('new_password');
  const confPw = fd.get('confirm_password');
  if (newPw !== confPw) {
    showToast('Паролі не збігаються.');
    return;
  }
  try {
    setButtonLoading(btn, true);
    await api.request('/api/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ old_password: oldPw, new_password: newPw }),
    });
    form.reset();
    showToast('Пароль змінено успішно.', 'success');
  } catch (err) {
    showToast(err.message);
  } finally {
    setButtonLoading(btn, false);
  }
});

// Profile logout button
$('#profileLogoutBtn')?.addEventListener('click', async () => {
  await performLogout();
});

function getMessengerPath() {
  const base = getBasePath();
  return base ? `${base}/messenger` : '/messenger';
}

function openMessengerScreen() {
  window.location.href = getMessengerPath();
}

$('#messengerBtn')?.addEventListener('click', openMessengerScreen);
$('#profileMessengerBtn')?.addEventListener('click', openMessengerScreen);
$$('[data-open-messenger]').forEach((btn) => btn.addEventListener('click', openMessengerScreen));

// ── NAVIGATION ──────────────────────────────────────────
const ALLOWED_SCREENS = [
  'dashboard', 'transactions', 'cards', 'profile',
  'donations', 'savings', 'analytics',
  'contacts', 'calendar', 'recurring', 'debts', 'tax',
];
const _screenScrollMemory = Object.create(null);

function getBasePath() {
  return (typeof window !== 'undefined' && window.ARMY_BANK_BASE) || '';
}

function getScreenIdFromPath() {
  let path = window.location.pathname;
  const base = getBasePath();
  if (base) path = path.replace(new RegExp('^' + base.replace(/\//g, '\\/')), '') || '/';
  path = path.replace(/^\//, '') || 'dashboard';
  return ALLOWED_SCREENS.includes(path) ? path : 'dashboard';
}

function switchScreen(screenId) {
  const id = ALLOWED_SCREENS.includes(screenId) ? screenId : 'dashboard';
  const content = document.querySelector('.app-content');
  const prevActive = document.querySelector('.screen.active-screen');
  const prevId = prevActive ? prevActive.id : '';
  if (content && prevId) {
    _screenScrollMemory[prevId] = content.scrollTop || 0;
  }

  closeTransientLayers({ keepPin: true });

  // Defensive cleanup: remove any stale transition artifacts from legacy clients.
  $$('.screen').forEach((s) => {
    s.classList.remove('screen-enter-ltr', 'screen-enter-rtl', 'screen-exit', 'screen-exit-ltr', 'screen-exit-rtl');
    s.style.removeProperty('transform');
    s.style.removeProperty('opacity');
    s.style.removeProperty('z-index');
    s.style.removeProperty('position');
    s.style.removeProperty('inset');
  });

  $$('.screen').forEach((s) => s.classList.remove('active-screen'));
  const el = $(`#${id}`);
  if (el) el.classList.add('active-screen');

  $$('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.screen === id);
  });
  $$('.menu-btn:not(.nav-item)').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.screen === id);
  });

  const appShell = $('#appScreen');
  if (appShell) {
    appShell.classList.toggle('screen-dashboard', id === 'dashboard');
    appShell.dataset.screen = id;
  }
  $('.bottom-nav')?.classList.remove('nav-hidden');
  if (content) {
    var remembered = Number(_screenScrollMemory[id] || 0);
    content.scrollTop = Number.isFinite(remembered) ? remembered : 0;
  }
  try {
    window.dispatchEvent(new CustomEvent('ab:screen-changed', { detail: { screen: id } }));
  } catch (_) {
    window.dispatchEvent(new Event('ab:screen-changed'));
  }

  if (id === 'transactions') loadTransactionsWithFilters();
  if (id === 'profile')    renderProfileScreen();
  if (id === 'cards')      { if (typeof loadCards      === 'function') loadCards(); }
  if (id === 'analytics')  { if (typeof loadAnalytics  === 'function') loadAnalytics(); }
  if (id === 'calendar')   { if (typeof loadCalendar   === 'function') loadCalendar(); }
  if (id === 'recurring')  { if (typeof loadRecurring  === 'function') loadRecurring(); }
  if (id === 'debts')      { if (typeof loadDebts      === 'function') loadDebts(); }
  if (id !== 'dashboard') setDashboardActionFormsOpen(false);
}

function setDashboardActionFormsOpen(open) {
  const formsWrap = $('#dashboardActionForms');
  if (!formsWrap) return;
  formsWrap.classList.toggle('open', !!open);
}

async function refreshProfile() {
  // Fetch user + account in parallel (saves one round-trip latency)
  [state.user, state.account] = await Promise.all([
    api.request('/api/auth/me'),
    api.request('/api/accounts/main'),
  ]);

  if (state.user) {
    const nameEl = $('#userName');
    if (nameEl) nameEl.textContent = state.user.full_name || '';

    const roleLabels = { soldier: 'Клієнт', operator: 'Оператор', admin: 'Адміністратор', platform_admin: 'Платформа' };
    const metaEl = $('#userMeta');
    if (metaEl) metaEl.textContent = `${roleLabels[state.user.role] || state.user.role} · ${state.user.email}`;

    const avatarEl = $('#userAvatar');
    if (avatarEl && state.user.full_name) {
      const parts = state.user.full_name.trim().split(' ');
      avatarEl.textContent = (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
    }

    const adminLink = $('.nav-admin');
    const operatorLink = $('.nav-operator');
    const platformLink = $('.nav-platform');
    if (adminLink) adminLink.classList.toggle('hidden', state.user.role !== 'admin' && state.user.role !== 'platform_admin');
    if (operatorLink) operatorLink.classList.toggle('hidden', !['operator','admin','platform_admin'].includes(state.user.role));
    if (platformLink) platformLink.classList.toggle('hidden', state.user.role !== 'platform_admin');
  }

  if (state.account) {
    const balance = formatMoney(state.account.balance);
    const heroBalEl = $('#heroBalance');
    if (heroBalEl) {
      heroBalEl.textContent = balance;
      heroBalEl.dataset.raw = state.account.balance;
    }
    const heroAccEl = $('#heroAccount');
    if (heroAccEl) heroAccEl.textContent = `Рахунок: ${state.account.account_number || '—'}`;
    const balVal = $('#balanceValue');
    if (balVal) balVal.textContent = balance;
    const accNum = $('#accountNumber');
    if (accNum) accNum.textContent = `Рахунок: ${state.account.account_number || '—'}`;
  }

  /* ── Bank Cards ── */
  _updateBankCards().catch(function() {});
}

// CVV reveal cache: { cardId: { card_number, cvv } }
var _cvvCache = {};

function _initCarouselInteraction(track) {
  if (!track || track._bankCardsInit) return;
  track._bankCardsInit = true;

  var dotsHost = document.getElementById('bankCardsDots');
  var rafId = 0;

  function getCardWidth() {
    var first = track.querySelector('.bank-card');
    if (!first) return track.clientWidth || 1;
    var styles = window.getComputedStyle(track);
    var gap = parseFloat(styles.columnGap || styles.gap || '0') || 0;
    return first.getBoundingClientRect().width + gap;
  }

  function updateDotsImmediate() {
    var dots = dotsHost ? dotsHost.querySelectorAll('.bc-dot') : [];
    if (!dots.length) return;
    var cw = getCardWidth();
    var idx = cw > 0 ? Math.round(track.scrollLeft / cw) : 0;
    idx = Math.max(0, Math.min(idx, dots.length - 1));
    dots.forEach(function(d, i) { d.classList.toggle('active', i === idx); });
    updateDeckState(idx);
  }

  function updateDeckState(activeIdx) {
    var cards = Array.from(track.querySelectorAll('.bank-card'));
    cards.forEach(function(card, i) {
      card.classList.toggle('is-active', i === activeIdx);
      card.classList.toggle('is-prev', i === activeIdx - 1);
      card.classList.toggle('is-next', i === activeIdx + 1);
    });
  }

  function updateDots() {
    if (rafId) return;
    rafId = window.requestAnimationFrame(function() {
      rafId = 0;
      updateDotsImmediate();
    });
  }

  track.addEventListener('scroll', updateDots, { passive: true });
  window.addEventListener('resize', updateDotsImmediate, { passive: true });

  dotsHost?.addEventListener('click', function(e) {
    var dot = e.target.closest('.bc-dot');
    if (!dot) return;
    var dots = Array.from(dotsHost.querySelectorAll('.bc-dot'));
    var i = dots.indexOf(dot);
    if (i >= 0) track.scrollTo({ left: i * getCardWidth(), behavior: 'smooth' });
  });

  // Tap-to-flip: distinguish tap from horizontal swipe.
  track.addEventListener('pointerdown', function(e) {
    track._flipStartX = e.clientX;
    track._flipStartY = e.clientY;
    track._flipStartScrollLeft = track.scrollLeft;
  }, { passive: true });

  track.addEventListener('pointerup', function(e) {
    var dx = Math.abs(e.clientX - (track._flipStartX || e.clientX));
    var dy = Math.abs(e.clientY - (track._flipStartY || e.clientY));
    var ds = Math.abs(track.scrollLeft - (track._flipStartScrollLeft || track.scrollLeft));
    if (dx > 10 || dy > 10 || ds > 8) return; // swipe/scroll — ignore

    var cardEl = e.target.closest('.bank-card[data-card-id]');
    if (!cardEl) return;

    var cardId = parseInt(cardEl.dataset.cardId, 10);
    if (!cardId) return;

    var nextFlipped = !cardEl.classList.contains('is-flipped');
    track.querySelectorAll('.bank-card.is-flipped').forEach(function(c) {
      if (c !== cardEl) c.classList.remove('is-flipped');
    });
    cardEl.classList.toggle('is-flipped', nextFlipped);

    if (!nextFlipped) return;

    var cvvEl = cardEl.querySelector('.bank-card-cvv-value');
    var numEl = cardEl.querySelector('.bank-card-full-number');
    if (!cvvEl) return;

    if (_cvvCache[cardId]) {
      cvvEl.textContent = _cvvCache[cardId].cvv || '•••';
      if (numEl) numEl.textContent = _cvvCache[cardId].card_number || '';
      return;
    }

    cvvEl.classList.add('bc-loading');
    api.request('/api/cards/' + cardId + '/reveal')
      .then(function(data) {
        _cvvCache[cardId] = data;
        if (cvvEl.isConnected) {
          cvvEl.textContent = data.cvv || '•••';
          cvvEl.classList.remove('bc-loading');
        }
        if (numEl && numEl.isConnected) numEl.textContent = data.card_number || '';
      })
      .catch(function() {
        if (cvvEl.isConnected) {
          cvvEl.textContent = '•••';
          cvvEl.classList.remove('bc-loading');
        }
      });
  });

  // Keep active indicator in sync on first render too.
  updateDotsImmediate();
}

async function _updateBankCards() {
  var holderName = (state.user && state.user.full_name)
    ? state.user.full_name.toUpperCase() : 'ARMY BANK';

  var track = document.getElementById('bankCardsTrack');
  var dotsEl = document.getElementById('bankCardsDots');
  if (!track) return;

  // Try to load real issued cards
  var cards = [];
  try {
    const r = await api.request('/api/cards?_=' + Date.now());
    cards = Array.isArray(r) ? r : (Array.isArray(r && r.data) ? r.data : []);
  }
  catch(_) {}

  if (!cards.length) {
    track._bankCardsInit = false;
    track.innerHTML = ''
      + '<div class="bank-cards-empty" id="bankCardsEmpty">'
      +   '<div class="bank-cards-empty-title">Картки ще не випущені</div>'
      +   '<div class="bank-cards-empty-sub">Відкрийте розділ «Картки» і випустіть першу картку.</div>'
      +   '<button type="button" class="bank-cards-empty-btn" id="issueFirstCardBtn">Випустити картку</button>'
      + '</div>';
    if (dotsEl) dotsEl.innerHTML = '';
    var issueBtn = document.getElementById('issueFirstCardBtn');
    issueBtn?.addEventListener('click', function() {
      window.history.pushState(null, '', (getBasePath() || '') + '/cards');
      switchScreen('cards');
    });
    _initCarouselInteraction(track);
    return;
  }

  // Render real cards
  var DESIGN_MAP = {
    gold:   { cls: 'bank-card-gold',   chipColors: ['#e8c848','#d4a830','#c89820'],
      network: '<svg width="42" height="26" viewBox="0 0 42 26" fill="none"><circle cx="15" cy="13" r="12" fill="rgba(255,92,53,.92)"/><circle cx="27" cy="13" r="12" fill="rgba(247,178,56,.82)"/></svg>' },
    navy:   { cls: 'bank-card-navy',   chipColors: ['#b8b8b8','#a0a0a0','#888888'],
      network: '<svg width="44" height="14" viewBox="0 0 44 14"><text x="0" y="11" fill="rgba(255,255,255,.72)" font-size="13" font-family="Arial,sans-serif" font-weight="800" letter-spacing="2">VISA</text></svg>' },
    forest: { cls: 'bank-card-forest', chipColors: ['#a4c18f','#7f9e6e','#55724e'],
      network: '<svg width="42" height="26" viewBox="0 0 42 26" fill="none"><circle cx="15" cy="13" r="12" fill="rgba(126,171,109,.76)"/><circle cx="27" cy="13" r="12" fill="rgba(90,133,74,.64)"/></svg>' },
    camo:   { cls: 'bank-card-camo',   chipColors: ['#c4bd88','#8f9266','#5a633f'],
      network: '<svg width="42" height="26" viewBox="0 0 42 26" fill="none"><circle cx="15" cy="13" r="12" fill="rgba(201,177,106,.76)"/><circle cx="27" cy="13" r="12" fill="rgba(134,122,68,.62)"/></svg>' },
    rose:   { cls: 'bank-card-rose',   chipColors: ['#fda4af','#fb7185','#f43f5e'],
      network: '<svg width="44" height="14" viewBox="0 0 44 14"><text x="0" y="11" fill="rgba(255,255,255,.6)" font-size="13" font-family="Arial,sans-serif" font-weight="800" letter-spacing="2">VISA</text></svg>' },
    slate:  { cls: 'bank-card-slate',  chipColors: ['#94a3b8','#64748b','#475569'],
      network: '<svg width="42" height="26" viewBox="0 0 42 26" fill="none"><circle cx="15" cy="13" r="12" fill="rgba(148,163,184,.6)"/><circle cx="27" cy="13" r="12" fill="rgba(100,116,139,.5)"/></svg>' },
    dark:   { cls: 'bank-card-dark',   chipColors: ['#556070','#3a4858','#263040'],
      network: '<svg width="44" height="14" viewBox="0 0 44 14"><text x="0" y="11" fill="rgba(255,255,255,.55)" font-size="13" font-family="Arial,sans-serif" font-weight="800" letter-spacing="2">VISA</text></svg>' },
  };

  track._bankCardsInit = false; // allow re-init
  track.innerHTML = cards.map(function(card, i) {
    var selectedDesign = _getEffectiveCardDesign(card);
    var s = DESIGN_MAP[selectedDesign] || DESIGN_MAP.gold;
    var cid = 'chip_' + card.id;
    var blocked = card.status === 'blocked';
    var statusBadge = blocked
      ? '<span style="font-size:9px;color:rgba(239,68,68,.85);font-family:var(--font-mono);letter-spacing:.08em;background:rgba(239,68,68,.12);padding:2px 8px;border-radius:20px;border:1px solid rgba(239,68,68,.2)">ЗАБЛОК.</span>'
      : '<span style="font-size:9px;color:rgba(255,255,255,.4);font-family:var(--font-mono);letter-spacing:.1em;text-transform:uppercase">' + (card.card_type||'VIRTUAL').toUpperCase() + '</span>';

    // ── Front side HTML ──
    var frontHtml =
        '<div class="bank-card-front">'
      + '<div class="bank-card-bg"></div>'
      + '<div class="bank-card-noise"></div>'
      + '<div class="bank-card-content">'
      +   '<div class="bank-card-top">'
      +     '<div class="bank-card-logo"><span class="bank-card-logo-letter">A</span><span class="bank-card-logo-text">ARM<strong>Bank</strong></span></div>'
      +     statusBadge
      +   '</div>'
      +   '<div class="bank-card-chip"><svg width="36" height="28" viewBox="0 0 36 28" fill="none">'
      +     '<rect x="0.5" y="0.5" width="35" height="27" rx="4" fill="url(#'+cid+')" stroke="rgba(255,255,255,.18)"/>'
      +     '<line x1="0" y1="10" x2="36" y2="10" stroke="rgba(255,255,255,.12)" stroke-width="0.5"/>'
      +     '<line x1="0" y1="18" x2="36" y2="18" stroke="rgba(255,255,255,.12)" stroke-width="0.5"/>'
      +     '<line x1="12" y1="0" x2="12" y2="28" stroke="rgba(255,255,255,.12)" stroke-width="0.5"/>'
      +     '<line x1="24" y1="0" x2="24" y2="28" stroke="rgba(255,255,255,.12)" stroke-width="0.5"/>'
      +     '<defs><linearGradient id="'+cid+'" x1="0" y1="0" x2="36" y2="28">'
      +       '<stop stop-color="'+s.chipColors[0]+'"/><stop offset="0.5" stop-color="'+s.chipColors[1]+'"/><stop offset="1" stop-color="'+s.chipColors[2]+'"/>'
      +     '</linearGradient></defs></svg></div>'
      +   '<div class="bank-card-number">' + (card.masked_number||'•••• •••• •••• ••••') + '</div>'
      +   '<div class="bank-card-bottom">'
      +     '<div class="bank-card-holder"><div class="bank-card-label">Власник</div><div class="bank-card-name">' + holderName + '</div></div>'
      +     '<div class="bank-card-expiry"><div class="bank-card-label">До</div><div class="bank-card-date">' + (card.expiry_display||'—') + '</div></div>'
      +     '<div class="bank-card-network">' + s.network + '</div>'
      +   '</div>'
      + '</div></div>';

    // ── Back side HTML ──
    var backHtml =
        '<div class="bank-card-back">'
      + '<div class="bank-card-mag-stripe"></div>'
      + '<div class="bank-card-back-body">'
      +   '<div class="bank-card-sig-strip">'
      +     '<div class="bank-card-cvv-box">'
      +       '<div class="bank-card-cvv-label">CVV</div>'
      +       '<div class="bank-card-cvv-value bc-loading">•••</div>'
      +     '</div>'
      +   '</div>'
      +   '<div style="margin-top:6px;font-size:9px;color:rgba(255,255,255,.35);letter-spacing:.06em;font-variant-numeric:tabular-nums" class="bank-card-full-number"></div>'
      +   '<div class="bank-card-back-footer">'
      +     '<div class="bank-card-back-info">ARM<strong>Bank</strong><br>' + location.hostname + '</div>'
      +     '<div>' + s.network + '</div>'
      +   '</div>'
      + '</div>'
      + '</div>';

    return '<div class="bank-card ' + s.cls + (blocked?' bank-card-blocked':'') + '" data-design="' + selectedDesign + '" data-card-id="' + card.id + '">'
      + '<div class="bank-card-inner">'
      +   frontHtml
      +   backHtml
      + '</div>'
      + '</div>';
  }).join('');

  // Sync dots
  if (dotsEl) {
    dotsEl.innerHTML = cards.map(function(_, i) {
      return '<span class="bc-dot' + (i===0?' active':'') + '"></span>';
    }).join('');
  }

  _initCarouselInteraction(track);
}

async function loadPaymentTemplates() {
  try {
    state.paymentTemplates = await api.request('/api/payment-templates');
  } catch (_) {
    state.paymentTemplates = [];
  }
  const sel = $('#transferTemplateSelect');
  if (sel) {
    sel.innerHTML = '<option value="">— Обрати шаблон —</option>' +
      state.paymentTemplates.map((t) =>
        `<option value="${t.id}" data-account="${t.recipient_account || ''}" data-amount="${t.amount || ''}" data-desc="${(t.description || '').replace(/"/g, '&quot;')}">${t.name}</option>`
      ).join('');
  }
  _renderTemplateChips();
}

function _populateGoalSelect(goals) {
  const sel = $('#goalIdSelect');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Оберіть ціль —</option>' +
    (goals || [])
      .filter((g) => g.current_amount < g.target_amount)
      .map((g) => {
        const pct = g.target_amount > 0 ? Math.round(g.current_amount / g.target_amount * 100) : 0;
        return `<option value="${g.id}"${String(g.id) === cur ? ' selected' : ''}>${escapeHtml(g.title)} (${pct}%)</option>`;
      }).join('');
}

function _renderTemplateChips() {
  const chips = $('#templateChips');
  if (!chips) return;
  if (!state.paymentTemplates.length) {
    chips.classList.add('hidden');
    return;
  }
  chips.classList.remove('hidden');
  chips.innerHTML = state.paymentTemplates.map((t) =>
    `<button type="button" class="template-chip" data-tpl-account="${escapeHtml(t.recipient_account || '')}" data-tpl-amount="${t.amount || ''}" data-tpl-desc="${escapeHtml(t.description || '')}" data-tpl-id="${t.id}" title="${escapeHtml(t.name)}">` +
    `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>` +
    `${escapeHtml(t.name)}` +
    (t.amount ? `<span class="tc-amt">₴${Number(t.amount).toLocaleString('uk-UA')}</span>` : '') +
    `</button>`
  ).join('');
  chips.querySelectorAll('.template-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const account = btn.dataset.tplAccount;
      const amount  = btn.dataset.tplAmount;
      const desc    = btn.dataset.tplDesc;
      const tplId   = btn.dataset.tplId;
      prefillTransferForm({ mode: 'account', account, amount, description: desc, template_id: tplId });
      chips.querySelectorAll('.template-chip').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      showToast(`Шаблон «${btn.title}» підставлено.`, 'success');
    });
  });
}

async function deletePaymentTemplate(templateId) {
  try {
    await api.request(`/api/payment-templates/${templateId}`, { method: 'DELETE' });
    await loadPaymentTemplates();
    showToast('Шаблон видалено.', 'success');
  } catch (e) {
    showToast(e.message);
  }
}

async function loadTransactionsWithFilters() {
  const container = $('#transactionsList');
  if (container) setListLoading('#transactionsList', true);
  const form = $('#transactionsFilters');
  let url = '/api/transactions/history';
  const params = new URLSearchParams();
  if (form) {
    const fd = new FormData(form);
    if (fd.get('from_date'))  params.set('from_date',  fd.get('from_date'));
    if (fd.get('to_date'))    params.set('to_date',    fd.get('to_date'));
    if (fd.get('tx_type'))    params.set('tx_type',    fd.get('tx_type'));
    if (fd.get('direction'))  params.set('direction',  fd.get('direction'));
    if (fd.get('min_amount')) params.set('min_amount', fd.get('min_amount'));
    if (fd.get('max_amount')) params.set('max_amount', fd.get('max_amount'));
  }
  const searchVal = $('#txSearchInput')?.value?.trim();
  if (searchVal) params.set('search', searchVal);
  if (params.toString()) url += '?' + params.toString();
  try {
    const list = await api.request(url);
    renderTransactions(list, '#transactionsList');
  } catch (e) {
    renderTransactions([], '#transactionsList');
  } finally {
    if (container) setListLoading('#transactionsList', false);
  }
}

// Debounced search
let _searchTimer = null;
$('#txSearchInput')?.addEventListener('input', () => {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => loadTransactionsWithFilters(), 400);
});

async function refreshAllData() {
  ['#recentTransactions','#transactionsList','#donationsList','#goalsList','#contactsList']
    .forEach((s) => setListLoading(s, true));

  try {
    // Single batch request replaces 8 parallel calls — one round-trip, one DB connection
    const d = await api.request('/api/dashboard');

    // Apply profile state (same as refreshProfile but from batch data)
    state.user    = d.user;
    state.account = d.account;
    state.paymentTemplates = d.templates || [];

    const roleLabels = { soldier: 'Клієнт', operator: 'Оператор', admin: 'Адміністратор', platform_admin: 'Платформа' };
    const nameEl = $('#userName');    if (nameEl) nameEl.textContent = state.user.full_name;
    const metaEl = $('#userMeta');    if (metaEl) metaEl.textContent = `${roleLabels[state.user.role] || state.user.role} · ${state.user.email}`;
    const avatarEl = $('#userAvatar');
    if (avatarEl && state.user.full_name) {
      const parts = state.user.full_name.trim().split(' ');
      avatarEl.textContent = (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
    }
    const balance = formatMoney(state.account.balance);
    const heroBalEl = $('#heroBalance');
    if (heroBalEl) { heroBalEl.textContent = balance; heroBalEl.dataset.raw = state.account.balance; }
    const heroAccEl = $('#heroAccount');  if (heroAccEl) heroAccEl.textContent = `Рахунок: ${state.account.account_number || '—'}`;
    const balVal = $('#balanceValue');    if (balVal) balVal.textContent = balance;
    const accNum = $('#accountNumber');   if (accNum) accNum.textContent = `Рахунок: ${state.account.account_number}`;
    const adminLink    = $('.nav-admin');
    const operatorLink = $('.nav-operator');
    const platformLink = $('.nav-platform');
    if (adminLink)    adminLink.classList.toggle('hidden', state.user.role !== 'admin' && state.user.role !== 'platform_admin');
    if (operatorLink) operatorLink.classList.toggle('hidden', !['operator','admin','platform_admin'].includes(state.user.role));
    if (platformLink) platformLink.classList.toggle('hidden', state.user.role !== 'platform_admin');

    const { transactions, payouts, donations, goals, contacts } = d;

    // Always sync dashboard carousel with actual issued cards.
    _updateBankCards().catch(function() {});

    renderTransactions(transactions.slice(0, 5), '#recentTransactions');
    renderTransactions(transactions, '#transactionsList');
    renderTransferQuickRecipients(buildQuickRecipients(contacts, transactions));


    renderSimpleList('#donationsList', donations, (row) => `
      <div class="item">
        <div class="item-header"><strong>${row.fund_name}</strong><span class="amount out">−${formatMoney(row.amount)}</span></div>
        <div class="muted">${row.comment || 'Без коментаря'} · ${formatDate(row.created_at)}</div>
      </div>
    `, 'Пожертв поки немає.');

    // Check goal completions for confetti celebrations
    if (typeof checkGoalCompletion === 'function') checkGoalCompletion(goals);

    // Goals with progress bars + contribute + delete
    renderSimpleList('#goalsList', goals, (row) => {
      const pct = row.target_amount > 0 ? Math.min(100, Math.round(row.current_amount / row.target_amount * 100)) : 0;
      const remaining = Math.max(0, row.target_amount - row.current_amount);
      const done = pct >= 100;
      return `
        <div class="item item-with-actions goal-item">
          <div class="item-main">
            <div class="item-header">
              <strong>${escapeHtml(row.title)}</strong>
              <span class="pct-badge ${done ? 'done' : ''}">${done ? '✓' : pct + '%'}</span>
            </div>
            <div class="progress-bar-wrap">
              <div class="progress-bar ${done ? 'done' : ''}" style="width:${pct}%"></div>
            </div>
            <div class="muted" style="font-size:11px;margin-top:3px">${formatMoney(row.current_amount)} / ${formatMoney(row.target_amount)}${!done && remaining > 0 ? ` · ще ${formatMoney(remaining)}` : ''}${row.deadline ? ` · до ${row.deadline}` : ''}</div>
          </div>
          <div class="item-btns">
            ${!done ? `<button class="btn-icon-transfer" data-contribute-goal="${row.id}" data-goal-title="${escapeHtml(row.title)}" title="Поповнити ціль" aria-label="Поповнити">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
            </button>` : ''}
            <button class="btn-icon-danger" data-delete-goal="${row.id}" title="Видалити ціль" aria-label="Видалити">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
          </div>
        </div>`;
    }, 'Цілей накопичення поки немає.');

    // Populate goal dropdown in contribution form
    _populateGoalSelect(goals);

    // Bind goal contribute button — pre-fills form and scrolls to it
    $$('#goalsList [data-contribute-goal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const goalId = Number(btn.dataset.contributeGoal);
        const sel = $('#goalIdSelect');
        if (sel) sel.value = String(goalId);
        const form = document.getElementById('goalContributionForm');
        if (form) {
          form.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const amtInput = form.querySelector('[name="amount"]');
          if (amtInput) amtInput.focus();
        }
      });
    });

    // Bind goal delete
    $$('#goalsList [data-delete-goal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const goalId = Number(btn.dataset.deleteGoal);
        confirmAction('Видалити ціль?', 'Ціль буде видалена. Кошти залишаться на рахунку.', async () => {
          try {
            await api.request(`/api/savings-goals/${goalId}`, { method: 'DELETE' });
            await refreshAllData();
            showToast('Ціль видалено.', 'success');
          } catch (e) { showToast(e.message); }
        });
      });
    });

    // Contacts with transfer + delete
    renderSimpleList('#contactsList', contacts, (row) => `
      <div class="item item-with-actions">
        <div class="item-main">
          <div class="item-header"><strong>${row.contact_name}</strong><span class="muted">${row.relation_type}</span></div>
          <div class="muted">${row.phone || 'Телефон не вказано'}${row.account_number ? ` · ${row.account_number}` : ''}</div>
        </div>
        <div class="item-btns">
          ${row.account_number ? `
            <button class="btn-icon-history" data-history-account="${row.account_number}" data-history-name="${row.contact_name}" title="Історія переказів">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </button>
            <button class="btn-icon-transfer" data-transfer-account="${row.account_number}" title="Переказ" aria-label="Переказ">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </button>` : ''}
          <button class="btn-icon-danger" data-delete-contact="${row.id}" title="Видалити" aria-label="Видалити">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>
    `, 'Контактів поки немає.');

    // Bind contact history → drawer
    $$('#contactsList [data-history-account]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const acc  = btn.dataset.historyAccount;
        const name = btn.dataset.historyName;
        openDrawer();
        const body = $('#drawerBody');
        if (body) body.innerHTML = '<div class="drawer-loading">Завантаження…</div>';
        try {
          const txs = await api.request(`/api/transactions/with-contact/${encodeURIComponent(acc)}`);
          const totalIn  = txs.filter(t=>t.direction==='in').reduce((s,t)=>s+Number(t.amount),0);
          const totalOut = txs.filter(t=>t.direction==='out').reduce((s,t)=>s+Number(t.amount),0);
          if (body) body.innerHTML = `
            <div style="margin-bottom:16px">
              <div class="drawer-title" style="font-size:18px;font-weight:300;font-family:var(--font-serif);margin-bottom:4px">${name}</div>
              <div class="muted">${acc}</div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
              <div style="background:var(--green-bg);border-radius:var(--radius);padding:12px;text-align:center;border:1px solid rgba(74,222,128,.15)">
                <div style="font-size:9px;color:var(--green);font-family:var(--font-mono);letter-spacing:.12em;text-transform:uppercase;margin-bottom:4px">Отримано</div>
                <div style="font-size:16px;font-weight:400;color:var(--green)">+${formatMoney(totalIn)}</div>
              </div>
              <div style="background:var(--red-bg);border-radius:var(--radius);padding:12px;text-align:center;border:1px solid rgba(239,68,68,.15)">
                <div style="font-size:9px;color:var(--red);font-family:var(--font-mono);letter-spacing:.12em;text-transform:uppercase;margin-bottom:4px">Відправлено</div>
                <div style="font-size:16px;font-weight:400;color:var(--red)">-${formatMoney(totalOut)}</div>
              </div>
            </div>
            <div class="drawer-title" style="margin-bottom:10px">${txs.length} операцій</div>
            ${txs.length ? txs.map(tx => `
              <div class="item">
                <div class="tx-dir-dot ${tx.direction}"></div>
                <div class="item-body">
                  <div class="item-header">
                    <strong>${escapeHtml(tx.description)}</strong>
                    <span class="amount ${tx.direction}">${tx.direction==='in'?'+':'−'}${formatMoney(tx.amount)}</span>
                  </div>
                  <div class="muted">${formatDate(tx.created_at)}</div>
                </div>
              </div>`).join('') : '<div class="empty-state">Переказів між вами ще немає.</div>'}
          `;
        } catch(e) {
          if (body) body.innerHTML = `<div class="drawer-error">${escapeHtml(e.message)}</div>`;
        }
      });
    });

    // Bind contact transfer → fill transfer form
    $$('#contactsList [data-transfer-account]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const acc = btn.dataset.transferAccount;
        if (!acc) return;
        goToDashboardTransferForm();
        prefillTransferForm({ mode: 'account', account: acc });
        showToast(`Рахунок ${acc} підставлено у форму переказу.`);
      });
    });

    // Bind contact delete
    $$('#contactsList [data-delete-contact]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const contactId = Number(btn.dataset.deleteContact);
        confirmAction('Видалити контакт?', 'Контакт буде видалено безповоротно.', async () => {
          try {
            await api.request(`/api/family-contacts/${contactId}`, { method: 'DELETE' });
            await refreshAllData();
            showToast('Контакт видалено.', 'success');
          } catch (e) { showToast(e.message); }
        });
      });
    });

    // Load analytics data for dashboard strip + sparkline
    loadAnalytics().catch(() => {});
    loadSparkline().catch(() => {});
    if (typeof loadVelocity === 'function') loadVelocity().catch(() => {});
    if (typeof loadTopRecipients === 'function') loadTopRecipients().catch(() => {});
    if (typeof loadTagsCloud === 'function') loadTagsCloud().catch(() => {});
    if (typeof checkPinStatus === 'function') checkPinStatus().catch(() => {});
    if (typeof loadBudgetProgress === 'function') loadBudgetProgress().catch(() => {});

  } finally {
    ['#recentTransactions','#transactionsList','#donationsList','#goalsList','#contactsList']
      .forEach((s) => setListLoading(s, false));
  }
}

async function handleAuth(form, endpoint) {
  const formData = Object.fromEntries(new FormData(form).entries());
  const result = await api.request(endpoint, { method: 'POST', body: JSON.stringify(formData) });
  api.setToken(result.token);
  clearBootstrapRetryTimer();
  try {
    await hydrateAuthenticatedApp();
  } catch (error) {
    if (!isAuthErrorResponse(error)) {
      scheduleBootstrapRetry();
    } else {
      api.setToken('');
      setAuthenticated(false);
    }
    error.postAuthInit = true;
    throw error;
  }
  const screen = getScreenIdFromPath();
  const base = getBasePath();
  const targetPath = base ? base + '/' + screen : '/' + screen;
  if (window.location.pathname !== targetPath) window.history.replaceState(null, '', targetPath);
  showToast('Успішна авторизація.');
}

function bindJsonForm(selector, endpoint, options = {}) {
  const form = $(selector);
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const btn = form.querySelector('button[type="submit"], button:not([type])');
    try {
      setButtonLoading(btn, true);
      const values = Object.fromEntries(new FormData(form).entries());
      const payload = options.transform ? options.transform(values) : values;
      const result = await api.request(endpoint(payload), { method: 'POST', body: JSON.stringify(payload) });
      form.reset();
      if (options.afterReset) options.afterReset(form);
      await refreshAllData();
      if (options.afterSuccess) options.afterSuccess(result, payload);
      showToast(options.successMessage || 'Операцію виконано.');
    } catch (error) {
      showToast(error.message);
    } finally {
      setButtonLoading(btn, false);
    }
  });
}

// ── AUTH FORMS ───────────────────────────────────────────
$('#loginForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const btn = form.querySelector('button[type="submit"]');
  const errBox = document.getElementById('loginError');
  const errTxt = document.getElementById('loginErrorText');
  if (errBox) errBox.classList.add('hidden');
  try {
    setButtonLoading(btn, true);
    await handleAuth(form, '/api/auth/login');
  } catch (error) {
    const isCredentialsError = !error?.postAuthInit && isAuthErrorResponse(error);
    if (isCredentialsError && errBox && errTxt) {
      errTxt.textContent = error.message || 'Невірні облікові дані';
      errBox.classList.remove('hidden');
      form.classList.add('auth-shake');
      setTimeout(() => form.classList.remove('auth-shake'), 500);
    } else {
      showToast(error?.message || 'Сервер тимчасово недоступний. Спробуйте знову.');
    }
  } finally {
    setButtonLoading(btn, false);
  }
});

$('#registerForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const btn = form.querySelector('button[type="submit"]');
  try {
    setButtonLoading(btn, true);
    await handleAuth(form, '/api/auth/register');
  } catch (error) {
    showToast(error.message);
  } finally {
    setButtonLoading(btn, false);
  }
});

// ── BOUND FORMS ──────────────────────────────────────────
bindJsonForm('#topupForm', () => '/api/transactions/topup', {
  transform: (v) => ({ ...v, amount: Number(v.amount), idempotency_key: _genIdempotencyKey() }),
  successMessage: 'Рахунок поповнено.',
  afterReset: (form) => { form.description.value = 'Поповнення рахунку'; },
});

bindJsonForm('#transferForm', () => {
  const activeMode = ($('#transferModeToggle .tmt-btn.active') || {}).dataset?.mode || 'account';
  return activeMode === 'card' ? '/api/transactions/transfer-by-card' : '/api/transactions/transfer';
}, {
  transform: (v) => {
    const activeMode = ($('#transferModeToggle .tmt-btn.active') || {}).dataset?.mode || 'account';
    // Include idempotency key so server deduplicates retries/double-taps
    const ikey = _transferIdempotencyKey || _genIdempotencyKey();
    if (activeMode === 'card') {
      return {
        card_number: (v.recipient_card_number || '').replace(/\s/g, ''),
        amount: Number(v.amount),
        description: v.description || 'Переказ по картці',
        idempotency_key: ikey,
      };
    }
    return {
      recipient_account_number: normalizeAccountNumber(v.recipient_account_number),
      amount: Number(v.amount),
      description: v.description || 'Переказ',
      idempotency_key: ikey,
    };
  },
  successMessage: 'Переказ виконано.',
  afterReset: (form) => {
    form.description.value = 'Переказ родині';
    const sel = $('#transferTemplateSelect');
    if (sel) sel.value = '';
    clearTransferDraft();
    _transferIdempotencyKey = null;
  },
  afterSuccess: (result, payload) => {
    // result = {account, tx_id, order_id, ...}
    const myAccNum = $('#heroAccount')?.textContent?.replace(/^Рахунок:\s*/i, '').trim() || '—';
    const toAcc = payload?.recipient_account_number || payload?.card_number || '—';
    receipt.open({
      tx_id:        result?.tx_id,
      amount:       payload?.amount,
      direction:    'out',
      from_account: myAccNum,
      to_account:   toAcc,
      description:  payload?.description,
      created_at:   new Date().toISOString(),
      title:        'Переказ виконано',
    });
  },
});

$('#transferTemplateSelect')?.addEventListener('change', function () {
  const opt = this.selectedOptions[0];
  if (!opt || !opt.value) return;
  const form = $('#transferForm');
  if (form) {
    setTransferMode('account');
    form.recipient_account_number.value = opt.dataset.account || '';
    form.amount.value = opt.dataset.amount || '';
    form.description.value = (opt.dataset.desc || '').replace(/&quot;/g, '"');
    saveTransferDraftFromForm();
  }
});

// ── Transfer mode toggle (account ↔ card) ────────────
(function () {
  const toggle = $('#transferModeToggle');
  if (!toggle) return;

  function applyMode(mode) {
    $$('#transferModeToggle .tmt-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    const accLabel = $('#transferAccountLabel');
    const cardLabel = $('#transferCardLabel');
    if (accLabel) accLabel.classList.toggle('hidden', mode === 'card');
    if (cardLabel) cardLabel.classList.toggle('hidden', mode !== 'card');
  }

  toggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.tmt-btn');
    if (btn) {
      applyMode(btn.dataset.mode);
      saveTransferDraftFromForm();
    }
  });

  // Card number auto-format + status indicator
  document.addEventListener('input', (e) => {
    if (e.target.name === 'recipient_card_number') {
      const inp = e.target;
      const raw = inp.value.replace(/\D/g, '').slice(0, 16);
      const formatted = raw.replace(/(.{4})(?=.)/g, '$1 ');
      if (inp.value !== formatted) {
        const pos = inp.selectionStart;
        inp.value = formatted;
        inp.setSelectionRange(Math.min(pos, formatted.length), Math.min(pos, formatted.length));
      }
      const status = $('#cardLookupStatus');
      if (status) {
        if (raw.length === 16) {
          status.textContent = '✓';
          status.className = 'card-lookup-status ok';
        } else if (raw.length > 0) {
          status.textContent = raw.length + '/16';
          status.className = 'card-lookup-status pending';
        } else {
          status.textContent = '';
          status.className = 'card-lookup-status';
        }
      }
      saveTransferDraftFromForm();
      return;
    }

    if (e.target.name === 'recipient_account_number') {
      const inp = e.target;
      const normalized = normalizeAccountNumber(inp.value);
      if (inp.value !== normalized) {
        const pos = inp.selectionStart;
        inp.value = normalized;
        inp.setSelectionRange(Math.min(pos, normalized.length), Math.min(pos, normalized.length));
      }
      saveTransferDraftFromForm();
      return;
    }

    if (e.target.closest('#transferForm')) saveTransferDraftFromForm();
  });
})();

// ── Design picker (card issue form) ─────────────────────────
(function() {
  document.addEventListener('click', function(e) {
    const opt = e.target.closest('#designOptions .design-opt');
    if (!opt) return;
    document.querySelectorAll('#designOptions .design-opt').forEach(function(o) {
      o.classList.remove('selected');
    });
    opt.classList.add('selected');
    const hidden = document.getElementById('selectedDesign');
    if (hidden) hidden.value = opt.dataset.design || 'gold';
  });
})();

// ── Transfer confirmation bottom sheet ──────────────────────
// Shared idempotency key: generated when overlay opens, sent with the request.
// Cleared after form reset to prevent re-use on next transfer.
let _transferIdempotencyKey = null;

function _genIdempotencyKey() {
  try { return crypto.randomUUID(); } catch (_) {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
}

(function() {
  const overlay    = document.getElementById('transferConfirmOverlay');
  const confirmBtn = document.getElementById('tcConfirmBtn');
  const cancelBtn  = document.getElementById('tcCancelBtn');
  const previewBtn = document.getElementById('transferPreviewBtn');
  const form       = document.getElementById('transferForm');
  if (!overlay || !previewBtn || !form) return;

  function fmtMoney(n) {
    return '₴\u202f' + Number(n).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ── Fix: intercept form submit so Enter key can't bypass overlay ──────────
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    // Only allow submission when triggered by confirmBtn (sets _transferConfirmed flag)
    if (!form._transferConfirmed) {
      previewBtn.click();
    }
  });

  function openOverlay() {
    const mode = (document.querySelector('#transferModeToggle .tmt-btn.active') || {}).dataset?.mode || 'account';
    const amount = parseFloat(form.amount?.value || '0');
    const desc = form.description?.value || '';

    let toVal = '';
    if (mode === 'card') {
      const raw = (form.recipient_card_number?.value || '').replace(/\D/g,'');
      if (raw.length !== 16) { showToast('Введіть повний номер картки (16 цифр)'); return; }
      toVal = form.recipient_card_number.value;
    } else {
      toVal = normalizeAccountNumber(form.recipient_account_number?.value || '');
      if (!toVal) { showToast('Введіть номер рахунку'); return; }
      if (!isLikelyAccountNumber(toVal)) { showToast('Формат рахунку: AB-100001'); return; }
      if (form.recipient_account_number) form.recipient_account_number.value = toVal;
    }

    if (!amount || amount <= 0) { showToast('Введіть суму переказу'); return; }

    // ── Fix: client-side balance check ────────────────────────────────────
    const currentBalance = parseFloat(
      document.getElementById('balanceAmount')?.dataset?.raw ||
      document.getElementById('heroBalance')?.dataset?.raw || 'Infinity'
    );
    if (Number.isFinite(currentBalance) && amount > currentBalance) {
      showToast('Недостатньо коштів на рахунку.'); return;
    }

    // ── Fix: generate idempotency key per transfer attempt ────────────────
    _transferIdempotencyKey = _genIdempotencyKey();

    document.getElementById('tcTo').textContent = toVal;
    document.getElementById('tcAmount').textContent = fmtMoney(amount);
    document.getElementById('tcDesc').textContent = desc || '—';

    const afterEl = document.getElementById('tcAfterBalance');
    if (afterEl) {
      if (Number.isFinite(currentBalance)) {
        const after = currentBalance - amount;
        afterEl.textContent = fmtMoney(after);
        afterEl.style.color = after < 0 ? 'var(--mono-danger, #f87171)' : '';
      } else {
        afterEl.textContent = '—';
      }
    }

    overlay.classList.remove('hidden');
    lockBodyScroll('transfer-confirm');
    confirmBtn.focus();
  }

  previewBtn.addEventListener('click', openOverlay);

  function closeOverlay() {
    overlay.classList.add('hidden');
    unlockBodyScroll('transfer-confirm');
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Підтвердити';
    form._transferConfirmed = false;
  }

  cancelBtn.addEventListener('click', closeOverlay);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) closeOverlay(); });
  overlay.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeOverlay(); });

  confirmBtn.addEventListener('click', async function() {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Виконуємо…';
    try {
      // Signal to form submit handler that this is a confirmed submission
      form._transferConfirmed = true;
      closeOverlay();
      // Trigger the real form submit (goes through bindJsonForm handler)
      const realSubmit = document.getElementById('transferSubmitReal');
      if (realSubmit) realSubmit.click();
    } catch(err) {
      showToast(err.message || 'Помилка переказу');
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Підтвердити';
      form._transferConfirmed = false;
    }
  });
})();

bindJsonForm('#demoPayoutForm', () => '/api/payouts/demo-accrual', {
  transform: (v) => ({ ...v, amount: Number(v.amount) }),
  successMessage: 'Виплату нараховано.',
  afterReset: (form) => { form.title.value = 'Виплата'; form.payout_type.value = 'general'; form.amount.value = '10000'; },
});

bindJsonForm('#donationForm', () => '/api/donations', {
  transform: (v) => ({ ...v, amount: Number(v.amount) }),
  successMessage: 'Пожертву проведено.',
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

bindJsonForm('#templateForm', () => '/api/payment-templates', {
  transform: (v) => ({
    name: v.name,
    recipient_account: v.recipient_account,
    amount: v.amount ? Number(v.amount) : null,
    description: v.description || '',
  }),
  successMessage: 'Шаблон збережено.',
  afterSuccess: () => loadPaymentTemplates(),
});

$('#transactionsFilters')?.addEventListener('submit', (event) => {
  event.preventDefault();
  localStorage.removeItem(TX_QUICK_FILTER_KEY);
  setTxQuickFilterActive('');
  loadTransactionsWithFilters();
  showToast('Фільтри застосовано.');
});

// ── NAV CLICKS ───────────────────────────────────────────
$$('.nav-item.nav-link, .nav-link').forEach((btn) => {
  btn.addEventListener('click', (event) => {
    const screen = btn.dataset.screen;
    if (screen) {
      event.preventDefault();
      const activeScreen = document.querySelector('.screen.active-screen')?.id || '';
      const content = document.querySelector('.app-content');
      if (activeScreen === screen && content) {
        const nearTop = (content.scrollTop || 0) < 24;
        content.scrollTo({ top: nearTop ? content.scrollHeight : 0, behavior: 'smooth' });
        if (typeof navigator.vibrate === 'function') navigator.vibrate(8);
        return;
      }
      const base = getBasePath();
      window.history.pushState(null, '', base ? base + '/' + screen : '/' + screen);
      switchScreen(screen);
    }
  });
});

window.addEventListener('popstate', () => {
  switchScreen(getScreenIdFromPath());
});

// Quick action buttons
$$('[data-jump]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.jump;
    if (id === 'messenger') {
      openMessengerScreen();
      return;
    }

    const screenMap = {
      history: 'transactions',
      transactions: 'transactions',
      cards: 'cards',
      profile: 'profile',
    };
    if (screenMap[id]) {
      const target = screenMap[id];
      const base = getBasePath();
      window.history.pushState(null, '', base ? base + '/' + target : '/' + target);
      switchScreen(target);
      return;
    }

    if (id === 'iban') {
      const activeScreen = document.querySelector('.screen.active-screen')?.id;
      if (activeScreen !== 'dashboard') {
        const base = getBasePath();
        window.history.pushState(null, '', base ? base + '/dashboard' : '/dashboard');
        switchScreen('dashboard');
      }
      setDashboardActionFormsOpen(true);
      const transferForm = $('#transferForm');
      transferForm?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => {
        const accountModeBtn = document.querySelector('#transferModeToggle [data-mode="account"]');
        if (accountModeBtn && !accountModeBtn.classList.contains('active')) {
          accountModeBtn.click();
        }
        const accountInput = document.querySelector('#transferAccountLabel input[name="recipient_account_number"]');
        accountInput?.focus();
      }, 180);
      return;
    }

    const formMap = { topup: '#topupForm', transfer: '#transferForm' };
    const target = formMap[id];
    if (target) {
      const activeScreen = document.querySelector('.screen.active-screen')?.id;
      if (activeScreen !== 'dashboard') {
        const base = getBasePath();
        window.history.pushState(null, '', base ? base + '/dashboard' : '/dashboard');
        switchScreen('dashboard');
      }
      setDashboardActionFormsOpen(true);
      $(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// Auth tabs
$$('.auth-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const t = tab.dataset.tab;
    $$('.auth-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    $$('.auth-form').forEach((f) => f.classList.toggle('active',
      (f.id === 'loginForm' && t === 'login') || (f.id === 'registerForm' && t === 'register')
    ));
  });
});

// Logout (header button)
$('#logoutBtn')?.addEventListener('click', async () => {
  await performLogout({ confirm: true });
});

// ── Push notification bell button ─────────────────────────
function getNotificationApi() {
  return (typeof window !== 'undefined' && window.Notification) ? window.Notification : null;
}

async function updatePushDot() {
  const NotificationAPI = getNotificationApi();
  if (!NotificationAPI || !('PushManager' in window)) return;
  const granted = NotificationAPI.permission === 'granted';
  const dot = $('#pushDot');
  if (dot) dot.style.display = granted ? 'block' : 'none';
}

$('#pushBtn')?.addEventListener('click', async () => {
  const btn = $('#pushBtn');
  const NotificationAPI = getNotificationApi();
  if (!NotificationAPI) {
    showToast('Браузер не підтримує сповіщення.');
    return;
  }
  if (!('PushManager' in window)) {
    showToast('Push API недоступний. На iPhone — додайте застосунок на Головний екран.');
    return;
  }
  if (NotificationAPI.permission === 'denied') {
    showToast('Сповіщення заблоковані. Дозвольте в налаштуваннях браузера / системи.');
    return;
  }

  btn.disabled = true;
  try {
    if (NotificationAPI.permission !== 'granted') {
      showToast('Запит дозволу на сповіщення…');
      const perm = await NotificationAPI.requestPermission();
      if (perm !== 'granted') {
        showToast('Сповіщення не дозволені.');
        return;
      }
    }

    showToast('Підписка на сповіщення…');
    const ok = await api.subscribePush();
    if (!ok) {
      showToast('Не вдалося підписатись на сповіщення.');
      return;
    }
    updatePushDot();

    try {
      await api.testPush();
      showToast('🔔 Тест-сповіщення надіслано!', 'success');
    } catch (err) {
      showToast('Підписано. ' + (err.message || 'Помилка тест-пушу.'));
    }
  } finally {
    btn.disabled = false;
  }
});

// ── SW update detection ───────────────────────────────────
if ('serviceWorker' in navigator && !DESKTOP_MOBILE_ONLY_BLOCKED) {
  let _swReloading = false;
  let _swUpdateTimer = null;
  let _swPendingReload = false;
  let _swPendingToastAt = 0;

  function _clearSwUpdateTimer() {
    if (_swUpdateTimer) {
      clearInterval(_swUpdateTimer);
      _swUpdateTimer = null;
    }
  }

  function _scheduleSwUpdates(reg) {
    _clearSwUpdateTimer();
    const SW_UPDATE_VISIBLE_MS = 300_000; // 5 min, avoids aggressive mid-session churn
    const updateNow = () => {
      if (document.visibilityState !== 'visible') return;
      if (navigator.onLine === false) return;
      reg.update().catch(() => {});
    };

    updateNow();
    _swUpdateTimer = setInterval(updateNow, SW_UPDATE_VISIBLE_MS);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') updateNow();
    });
    window.addEventListener('online', updateNow, { passive: true });
    window.addEventListener('pageshow', updateNow, { passive: true });
  }

  function _performSwReload() {
    if (_swReloading) return;
    try {
      const now = Date.now();
      const last = Number(sessionStorage.getItem('ab_sw_reload_at') || 0);
      if (last && (now - last) < 12_000) return;
      sessionStorage.setItem('ab_sw_reload_at', String(now));
    } catch (_) {}
    _swReloading = true;
    setTimeout(() => location.reload(), 120);
  }

  function _markSwPendingReload() {
    _swPendingReload = true;
    const now = Date.now();
    if ((now - _swPendingToastAt) > 12_000) {
      _swPendingToastAt = now;
      showToast('Доступне оновлення. Застосуємо після повернення в додаток.', 'success');
    }
  }

  function _swReload(options = {}) {
    const immediate = !!options.immediate;
    if (!immediate && document.visibilityState === 'visible') {
      _markSwPendingReload();
      return;
    }
    _swPendingReload = false;
    _performSwReload();
  }

  function _applyPendingSwReload() {
    if (!_swPendingReload || _swReloading) return;
    if (document.visibilityState !== 'visible') return;
    _swReload({ immediate: true });
  }

  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(reg => {
    if (!reg) return;
    // If update is already waiting, activate immediately.
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });

    _scheduleSwUpdates(reg);

    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'SW_UPDATED') _swReload();
    });

    reg.addEventListener('updatefound', () => {
      const newSW = reg.installing;
      newSW?.addEventListener('statechange', () => {
        if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
          newSW.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    });

    navigator.serviceWorker.addEventListener('controllerchange', _swReload);
  }).catch(() => {});

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') _applyPendingSwReload();
  });
  window.addEventListener('pageshow', _applyPendingSwReload, { passive: true });
  window.addEventListener('focus', _applyPendingSwReload, { passive: true });
  window.addEventListener('beforeunload', _clearSwUpdateTimer, { passive: true });
}

// ── BOOTSTRAP ────────────────────────────────────────────
async function hydrateAuthenticatedApp() {
  /* Show app shell immediately — no flash of login page, data will shimmer in */
  setAuthenticated(true);
  switchScreen(getScreenIdFromPath());
  const _appEl = document.getElementById('appScreen');
  if (_appEl) _appEl.classList.add('app-loading');
  try {
    await refreshAllData();
  } finally {
    /* Always run startup machinery even when initial data fetch fails —
       otherwise polling / session engine never start and the app is broken */
    if (_appEl) _appEl.classList.remove('app-loading');
    clearBootstrapRetryTimer();
    startPolling();
    startSessionEngine();
    updatePushDot();
    if (typeof window._startNotifPolling === 'function') window._startNotifPolling();
    if (getNotificationApi()?.permission === 'granted') api.subscribePush().catch(() => {});
  }
}

function scheduleBootstrapRetry() {
  if (_bootstrapRetryTimer || !api.token) return;
  _bootstrapRetryTimer = setTimeout(async () => {
    _bootstrapRetryTimer = null;
    if (!api.token) return;
    try {
      await hydrateAuthenticatedApp();
      showToast('Зʼєднання відновлено.', 'success');
    } catch (_) {
      scheduleBootstrapRetry();
    }
  }, 10000);
}

(async function bootstrap() {
  if (DESKTOP_MOBILE_ONLY_BLOCKED) {
    stopPolling();
    stopNotifPolling();
    clearBootstrapRetryTimer();
    return;
  }
  if (!api.token) {
    setAuthenticated(false);
    return;
  }
  // Дозволяємо першу відрисовку (shell + тема) до мережевих запитів
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    await hydrateAuthenticatedApp();
  } catch (error) {
    if (isAuthErrorResponse(error)) {
      stopPolling();
      stopNotifPolling();
      clearBootstrapRetryTimer();
      api.setToken('');
      setAuthenticated(false);
      showToast('Сесію завершено. Увійдіть повторно.');
    } else {
      showToast('Сервер тимчасово недоступний. Спробуємо знову…');
      scheduleBootstrapRetry();
    }
  }
})();

// ── THEME / COMPACT / ANIMATIONS — batch localStorage read ─────────────────
// Один раз читаємо всі налаштування щоб уникнути 3 окремих sync I/O операцій
const _prefs = {
  theme:      localStorage.getItem('ab_theme')      || 'dark',
  compact:    localStorage.getItem('ab_compact')    === 'true',
  animations: localStorage.getItem('ab_animations') !== 'false',
};

function initTheme() {
  applyTheme(_prefs.theme);
  const toggle = $('#themeToggle');
  if (toggle) toggle.checked = _prefs.theme === 'light';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('ab_theme', theme);
}

$('#themeToggle')?.addEventListener('change', function() {
  applyTheme(this.checked ? 'light' : 'dark');
});

// Compact mode
function initCompact() {
  document.documentElement.classList.toggle('compact', _prefs.compact);
  const toggle = $('#compactToggle');
  if (toggle) toggle.checked = _prefs.compact;
}

$('#compactToggle')?.addEventListener('change', function() {
  document.documentElement.classList.toggle('compact', this.checked);
  localStorage.setItem('ab_compact', this.checked);
});

// Animations toggle
function initAnimations() {
  document.documentElement.classList.toggle('no-animations', !_prefs.animations);
  const toggle = $('#animationsToggle');
  if (toggle) toggle.checked = _prefs.animations;
}

$('#animationsToggle')?.addEventListener('change', function() {
  document.documentElement.classList.toggle('no-animations', !this.checked);
  localStorage.setItem('ab_animations', this.checked ? 'true' : 'false');
});

initTheme();
initCompact();
initAnimations();

// ── NETWORK STATUS ──────────────────────────────────────
function updateNetworkBanner() {
  const banner = $('#networkBanner');
  if (!banner) return;
  if (navigator.onLine) {
    banner.classList.add('hidden');
  } else {
    banner.classList.remove('hidden');
  }
}
window.addEventListener('online',  updateNetworkBanner);
window.addEventListener('offline', updateNetworkBanner);
updateNetworkBanner();

// ── SPARKLINE ────────────────────────────────────────────
async function loadSparkline() {
  const container = $('#sparklineContainer');
  if (!container) return;
  try {
    const history = await api.request('/api/analytics/balance-history?days=14');
    if (!history || !history.length) {
      container.innerHTML = '<div class="empty-state">Недостатньо даних.</div>';
      return;
    }

    const values = history.map(h => Number(h.balance));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const W = 300, H = 60, PAD = 4;

    const points = values.map((v, i) => {
      const x = PAD + (i / (values.length - 1)) * (W - PAD * 2);
      const y = H - PAD - ((v - min) / range) * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    // Area fill path
    const firstX = PAD;
    const lastX = W - PAD;
    const bottomY = H - PAD;
    const areaPoints = `${firstX},${bottomY} ${points} ${lastX},${bottomY}`;

    const trend = values[values.length - 1] - values[0];
    const trendEl = $('#sparklineTrend');
    if (trendEl) {
      const trendClass = trend >= 0 ? 'trend-up' : 'trend-down';
      trendEl.className = `trend-badge ${trendClass}`;
      trendEl.textContent = `${trend >= 0 ? '+' : ''}${formatMoney(trend)}`;
    }

    const lastValY = (H - PAD - ((values[values.length-1] - min) / range) * (H - PAD * 2)).toFixed(1);

    const sparkColor = trend >= 0 ? 'var(--mono-success, #4ade80)' : 'var(--mono-danger, #f87171)';
    container.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none">
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${sparkColor}" stop-opacity="0.18"/>
            <stop offset="100%" stop-color="${sparkColor}" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <polygon points="${areaPoints}" fill="url(#sparkGrad)"/>
        <polyline points="${points}" fill="none" stroke="${sparkColor}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="${lastX}" cy="${lastValY}" r="3" fill="${sparkColor}"/>
      </svg>
      <div class="sparkline-labels">
        <span>${history[0]?.day?.slice(5) || ''}</span>
        <span>${history[history.length-1]?.day?.slice(5) || ''}</span>
      </div>
    `;
  } catch (_) {
    if (container) container.innerHTML = '';
  }
}

// ── QUICK AMOUNTS ─────────────────────────────────────────
function initQuickAmounts() {
  $$('.quick-amounts').forEach(wrap => {
    const form = wrap.closest('form');
    const amountInput = form?.querySelector('input[name="amount"]');
    if (!amountInput) return;
    wrap.querySelectorAll('.qa-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        amountInput.value = chip.dataset.amount;
        amountInput.dispatchEvent(new Event('input'));
        wrap.querySelectorAll('.qa-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
    });
    amountInput.addEventListener('input', () => {
      wrap.querySelectorAll('.qa-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.amount === amountInput.value);
      });
    });
  });
}
initQuickAmounts();
initTransferDraftAutosave();
initTxQuickFilters();

// ── SECURITY LOG ──────────────────────────────────────────
let _secLogLoaded = false;
const SEC_ACTION_ICONS = {
  login: '🔐', logout: '🚪', register: '✅', change_password: '🔑',
  topup: '💰', transfer: '💸', donation: '❤️', goal_contribution: '🎯',
  create_goal: '🎯', delete_goal: '🗑', add_family_contact: '👤',
  delete_family_contact: '🗑', demo_payout: '🛡', delete_template: '🗑',
  default: '📋'
};

$('#secLogHead')?.addEventListener('click', async () => {
  const list = $('#securityLogList');
  const chevron = $('#secLogChevron');
  if (!list) return;
  const isOpen = list.style.display !== 'none';
  list.style.display = isOpen ? 'none' : 'block';
  if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
  if (!isOpen && !_secLogLoaded) {
    _secLogLoaded = true;
    list.innerHTML = '<div class="sec-log-loading">Завантаження…</div>';
    try {
      const logs = await api.request('/api/audit-logs');
      if (!logs.length) {
        list.innerHTML = '<div class="empty-state">Журнал порожній.</div>';
        return;
      }
      list.innerHTML = logs.map(log => {
        const icon = SEC_ACTION_ICONS[log.action] || SEC_ACTION_ICONS.default;
        return `
          <div class="sec-log-item">
            <span class="sec-log-icon">${icon}</span>
            <div class="sec-log-body">
              <div class="sec-log-action">${log.details || log.action}</div>
              <div class="sec-log-date muted">${formatDate(log.created_at)}</div>
            </div>
          </div>`;
      }).join('');
    } catch(e) {
      list.innerHTML = `<div class="sec-log-error">${escapeHtml(e.message)}</div>`;
    }
  }
});

// ── ACCOUNT QR + COPY ─────────────────────────────────────
$('#copyAccountBtn')?.addEventListener('click', () => {
  const acc = state.account?.account_number;
  if (!acc) return;
  const btn = $('#copyAccountBtn');
  navigator.clipboard?.writeText(acc).then(() => {
    showToast('Номер рахунку скопійовано.', 'success');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = 'Скопійовано ✓';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 2000);
    }
  }).catch(() => {
    showToast('Не вдалося скопіювати.');
  });
});

let _qrVisible = false;
$('#showQrBtn')?.addEventListener('click', () => {
  const wrap = $('#accountQrWrap');
  const img  = $('#accountQrImg');
  const lbl  = $('#showQrBtnLabel');
  const numEl = $('#qrAccountNum');
  if (!wrap || !img) return;
  _qrVisible = !_qrVisible;
  wrap.classList.toggle('hidden', !_qrVisible);
  if (lbl) lbl.textContent = _qrVisible ? 'Сховати QR' : 'Показати QR-код рахунку';
  if (_qrVisible && state.account?.account_number) {
    const acc = state.account.account_number;
    const text = encodeURIComponent(acc);
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${text}&color=1b2435&bgcolor=ffffff&margin=8`;
    if (numEl) numEl.textContent = acc;
  }
});

// ── SWIPE TO CLOSE DRAWER ─────────────────────────────────
(function initSwipeDrawer() {
  const drawer = $('#txDrawer');
  if (!drawer) return;
  let startY = 0, startX = 0;
  let canSwipeClose = false;
  drawer.addEventListener('touchstart', e => {
    const target = e.target;
    if (target && target.closest('input, textarea, select, button, [contenteditable="true"]')) {
      canSwipeClose = false;
      return;
    }
    const body = $('#drawerBody');
    const startsInHeader = !!(target && target.closest('.drawer-header'));
    const bodyAtTop = !body || body.scrollTop <= 2;
    canSwipeClose = startsInHeader || bodyAtTop;
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
  }, { passive: true });
  drawer.addEventListener('touchend', e => {
    if (!canSwipeClose) return;
    const dy = e.changedTouches[0].clientY - startY;
    const dx = e.changedTouches[0].clientX - startX;
    const verticalSwipe = dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.2;
    const horizontalSwipe = dx > 120 && Math.abs(dx) > Math.abs(dy) * 1.2;
    if (verticalSwipe || horizontalSwipe) closeDrawer();
    canSwipeClose = false;
  }, { passive: true });
})();

// ═══════════════════════════════════════════════════════
// WAVE 3 FEATURES
// ═══════════════════════════════════════════════════════

// ── SPENDING PIE CHART ────────────────────────────────
const PIE_COLORS = {
  transfer: '#60a5fa', donation: '#f87171', savings: '#4ade80',
  topup: '#a78bfa', payout: '#fb923c', default: '#94a3b8',
};

function renderPieChart(byType) {
  const pieEl = $('#spendingPie');
  const legendEl = $('#pieLegend');
  if (!pieEl) return;

  const outItems = byType.filter(r => r.direction === 'out' || !r.direction);
  const total = outItems.reduce((s, r) => s + Number(r.total), 0);
  if (!total) {
    pieEl.innerHTML = '<div class="empty-state">Витрат ще немає.</div>';
    return;
  }

  const R = 70, CX = 80, CY = 80;
  let angle = -Math.PI / 2;
  const segments = outItems.map(r => {
    const frac = Number(r.total) / total;
    const startAngle = angle;
    angle += frac * 2 * Math.PI;
    return { ...r, frac, startAngle, endAngle: angle };
  });

  function polarToXY(a, r) {
    return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
  }

  const paths = segments.map(seg => {
    const [x1, y1] = polarToXY(seg.startAngle, R);
    const [x2, y2] = polarToXY(seg.endAngle, R);
    const large = seg.frac > 0.5 ? 1 : 0;
    const color = PIE_COLORS[seg.tx_type] || PIE_COLORS.default;
    return `<path d="M${CX},${CY} L${x1},${y1} A${R},${R} 0 ${large},1 ${x2},${y2} Z" fill="${color}" opacity="0.85"/>`;
  }).join('');

  pieEl.innerHTML = `
    <svg viewBox="0 0 160 160" width="160" height="160" style="display:block;margin:0 auto">
      ${paths}
      <circle cx="${CX}" cy="${CY}" r="36" fill="var(--surface)"/>
      <text x="${CX}" y="${CY - 4}" text-anchor="middle" fill="var(--text)" font-size="10" font-weight="700" font-family="Manrope,sans-serif">Витрати</text>
      <text x="${CX}" y="${CY + 10}" text-anchor="middle" fill="var(--muted)" font-size="8" font-family="Manrope,sans-serif">цього місяця</text>
    </svg>`;

  if (legendEl) {
    legendEl.innerHTML = segments.map(seg => {
      const color = PIE_COLORS[seg.tx_type] || PIE_COLORS.default;
      const label = (TX_TYPE_LABELS || {})[seg.tx_type] || seg.tx_type;
      return `<div class="pie-leg-item">
        <span class="pie-leg-dot" style="background:${color}"></span>
        <span class="pie-leg-label">${label}</span>
        <span class="pie-leg-pct">${(seg.frac * 100).toFixed(1)}%</span>
      </div>`;
    }).join('');
  }
}

// ── ACTIVITY HEATMAP ─────────────────────────────────
async function renderHeatmap() {
  const el = $('#activityHeatmap');
  if (!el) return;
  try {
    const WEEKS = 12, DAYS = 7;
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - (WEEKS * DAYS - 1));

    const params = new URLSearchParams({ from_date: start.toISOString().slice(0,10) });
    const txs = await api.request('/api/transactions/history?' + params);

    const counts = {};
    txs.forEach(tx => {
      const d = (tx.created_at || '').slice(0,10);
      counts[d] = (counts[d] || 0) + 1;
    });
    const maxCount = Math.max(...Object.values(counts), 1);

    function intensity(c) {
      if (!c) return 0;
      return Math.ceil((c / maxCount) * 4);
    }
    const COLORS = ['rgba(0,0,0,.04)','rgba(0,0,0,.1)','rgba(0,0,0,.2)','rgba(0,0,0,.35)','var(--mono-success, #4ade80)'];

    let html = '<div class="heatmap-grid">';
    for (let w = 0; w < WEEKS; w++) {
      html += '<div class="heatmap-col">';
      for (let d = 0; d < DAYS; d++) {
        const date = new Date(start);
        date.setDate(start.getDate() + w * 7 + d);
        const key = date.toISOString().slice(0,10);
        const cnt = counts[key] || 0;
        const col = COLORS[intensity(cnt)];
        const title = cnt ? `${key}: ${cnt} операцій` : key;
        html += `<div class="heatmap-cell" style="background:${col}" title="${title}"></div>`;
      }
      html += '</div>';
    }
    html += '</div>';
    el.innerHTML = html;
  } catch(_) {}
}

// ── BUDGET LIMITS ────────────────────────────────────
async function loadBudgetLimits() {
  const listEl = $('#budgetLimitsList');
  if (!listEl) return;
  try {
    const limits = await api.request('/api/budget-limits');
    if (!limits.length) {
      listEl.innerHTML = '<div class="empty-state" style="padding:8px 0">Лімітів не встановлено.</div>';
      return;
    }
    const txLabels = { transfer: 'Переказ', donation: 'Благодійність', savings: 'Накопичення', topup: 'Поповнення' };
    listEl.innerHTML = limits.map(l => {
      const pct = l.pct || 0;
      const color = pct >= 90 ? 'var(--red)' : pct >= 70 ? 'var(--orange)' : 'var(--green)';
      return `<div class="budget-limit-item">
        <div class="bl-header">
          <span class="bl-type">${txLabels[l.tx_type] || l.tx_type}</span>
          <span class="bl-pct" style="color:${color}">${pct}%</span>
          <button class="btn-icon-danger bl-del" data-del-limit="${l.tx_type}" title="Видалити">×</button>
        </div>
        <div class="progress-bar-wrap">
          <div class="progress-bar" style="width:${pct}%;background:${color}"></div>
        </div>
        <div class="bl-amounts muted">${formatMoney(l.spent)} / ${formatMoney(l.monthly_limit)}</div>
      </div>`;
    }).join('');

    listEl.querySelectorAll('[data-del-limit]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const txType = btn.dataset.delLimit;
        try {
          await api.request(`/api/budget-limits/${txType}`, { method: 'DELETE' });
          await loadBudgetLimits();
          showToast('Ліміт видалено.');
        } catch(e) { showToast(e.message); }
      });
    });
  } catch(e) {
    listEl.innerHTML = `<div class="empty-state">Помилка: ${escapeHtml(e.message)}</div>`;
  }
}

$('#addBudgetBtn')?.addEventListener('click', () => {
  $('#budgetLimitForm')?.classList.toggle('hidden');
});
$('#cancelBudgetBtn')?.addEventListener('click', () => {
  $('#budgetLimitForm')?.classList.add('hidden');
});
$('#saveBudgetBtn')?.addEventListener('click', async () => {
  const txType = $('#budgetTxType')?.value;
  const amount = Number($('#budgetAmount')?.value || 0);
  if (!txType || !amount) { showToast('Вкажіть тип та суму.'); return; }
  try {
    await api.request('/api/budget-limits', {
      method: 'POST',
      body: JSON.stringify({ tx_type: txType, monthly_limit: amount }),
    });
    $('#budgetLimitForm')?.classList.add('hidden');
    if ($('#budgetAmount')) $('#budgetAmount').value = '';
    await loadBudgetLimits();
    showToast('Ліміт встановлено.', 'success');
  } catch(e) { showToast(e.message); }
});

// ── SPENDING INSIGHTS ────────────────────────────────
async function loadInsights() {
  const el = $('#insightsList');
  if (!el) return;
  try {
    const data = await api.request('/api/analytics/insights');
    const insights = data.insights || [];
    if (!insights.length) {
      el.innerHTML = '<div class="empty-state">Недостатньо даних для аналізу.</div>';
      return;
    }
    el.innerHTML = insights.map(ins => `
      <div class="insight-item">
        <span class="insight-icon">${ins.icon}</span>
        <span class="insight-text">${ins.text}</span>
      </div>`).join('');
  } catch(_) {}
}

// ── CURRENCY CONVERTER ────────────────────────────────
const _ratesCache = {};
async function loadCurrencyRates() {
  try {
    const res = await fetch('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json');
    if (!res.ok) throw new Error('');
    const data = await res.json();
    const wanted = ['USD','EUR','GBP','PLN'];
    wanted.forEach(code => {
      const item = data.find(r => r.cc === code);
      if (item) {
        _ratesCache[code] = item.rate;
        const el = $(`#rate${code}`);
        if (el) el.textContent = `₴${item.rate.toFixed(2)}`;
      }
    });
    const updated = $('#ratesUpdated');
    if (updated) updated.textContent = 'Оновлено зараз';
    updateConverter();
  } catch(_) {
    Object.assign(_ratesCache, { USD: 41.0, EUR: 44.5, GBP: 51.8, PLN: 10.2 });
    ['USD','EUR','GBP','PLN'].forEach(code => {
      const el = $(`#rate${code}`);
      if (el) el.textContent = `₴${_ratesCache[code].toFixed(2)}`;
    });
    const updated = $('#ratesUpdated');
    if (updated) updated.textContent = 'Резервні курси · офлайн';
    updateConverter();
  }
}

function updateConverter() {
  const amount = parseFloat($('#convAmount')?.value || 0);
  const from = $('#convFrom')?.value;
  const to = $('#convTo')?.value;
  const result = $('#convResult');
  if (!result || !from || !to || isNaN(amount)) return;

  let uah;
  if (from === 'UAH') uah = amount;
  else uah = amount * (_ratesCache[from] || 1);

  let converted;
  if (to === 'UAH') converted = uah;
  else converted = uah / (_ratesCache[to] || 1);

  result.textContent = `${amount} ${from} = ${converted.toFixed(2)} ${to}`;
}

['#convAmount','#convFrom','#convTo'].forEach(sel => {
  $(sel)?.addEventListener('input', updateConverter);
  $(sel)?.addEventListener('change', updateConverter);
});

if (!DESKTOP_MOBILE_ONLY_BLOCKED) loadCurrencyRates();

// ── KEYBOARD SHORTCUTS ────────────────────────────────
let _kbBuffer = '';
let _kbTimer = null;

document.addEventListener('keydown', (e) => {
  if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) {
    if (e.key === 'Escape') {
      document.activeElement.blur();
      closeDrawer();
      closeConfirm();
    }
    return;
  }

  if (e.key === 'Escape') {
    closeDrawer();
    closeConfirm();
    return;
  }

  if (e.key === 'r' || e.key === 'R') {
    refreshAllData().then(() => showToast('Оновлено', 'success')).catch(() => {});
    return;
  }

  if (!state.user) return;
  _kbBuffer += e.key.toUpperCase();
  clearTimeout(_kbTimer);
  _kbTimer = setTimeout(() => { _kbBuffer = ''; }, 800);

  const navMap = {
    'GD': 'dashboard', 'GT': 'transactions', 'GC': 'cards',   'GP': 'profile',
    'GY': 'payouts',   'GN': 'donations',    'GS': 'savings', 'GA': 'analytics',
    'GO': 'contacts',  'GL': 'calendar',     'GR': 'recurring','GB': 'debts',
  };
  if (navMap[_kbBuffer]) {
    const screen = navMap[_kbBuffer];
    const base = getBasePath();
    window.history.pushState(null, '', base ? base + '/' + screen : '/' + screen);
    switchScreen(screen);
    _kbBuffer = '';
  }
});

// ── CONFETTI CELEBRATION ──────────────────────────────
function launchConfetti() {
  const canvas = $('#confettiCanvas');
  if (!canvas) return;
  canvas.style.display = 'block';
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const pieces = Array.from({ length: 80 }, () => ({
    x: Math.random() * canvas.width,
    y: -20,
    w: Math.random() * 8 + 4,
    h: Math.random() * 14 + 6,
    rot: Math.random() * 360,
    color: ['#4ade80','#60a5fa','#f87171','#facc15','#c084fc','#fb923c'][Math.floor(Math.random()*6)],
    vx: (Math.random() - 0.5) * 3,
    vy: Math.random() * 3 + 2,
    vrot: (Math.random() - 0.5) * 8,
  }));

  let frame;
  let t = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach(p => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
      ctx.restore();
      p.x += p.vx; p.y += p.vy; p.rot += p.vrot; p.vy += 0.05;
    });
    t++;
    if (t < 180) frame = requestAnimationFrame(draw);
    else {
      canvas.style.display = 'none';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
  frame = requestAnimationFrame(draw);
}

function checkGoalCompletion(goals) {
  goals.forEach(g => {
    if (g.current_amount >= g.target_amount && g.target_amount > 0) {
      const key = `celebrated_goal_${g.id}`;
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, '1');
        setTimeout(() => {
          showToast(`🎉 Ціль "${g.title}" досягнута!`, 'success');
          launchConfetti();
        }, 500);
      }
    }
  });
}

// ── TRANSACTION RECEIPT SHARE ─────────────────────────
function shareTransaction(tx) {
  const text = [
    '🏦 Army Bank — Виписка операції',
    '─'.repeat(28),
    `📝 ${tx.description}`,
    `💰 ${tx.direction === 'in' ? '+' : '−'}${Number(tx.amount).toFixed(2)} ₴`,
    `📂 Тип: ${(TX_TYPE_LABELS || {})[tx.tx_type] || tx.tx_type}`,
    `📅 Дата: ${formatDate(tx.created_at)}`,
    tx.related_account ? `🔗 Контрагент: ${tx.related_account}` : '',
    `🔑 ID: #${tx.id}`,
  ].filter(Boolean).join('\n');

  function _copyFallback() {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, 99999);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) { showToast('Деталі скопійовано в буфер обміну.', 'success'); return; }
    } catch (_) {}
    // Last resort — show a modal with the text
    _showShareModal(text);
  }

  if (navigator.share) {
    navigator.share({ title: 'Army Bank — Виписка', text }).catch(() => _copyFallback());
  } else if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => showToast('Деталі скопійовано в буфер обміну.', 'success'))
      .catch(() => _copyFallback());
  } else {
    _copyFallback();
  }
}

function _showShareModal(text) {
  const existing = document.getElementById('_shareModal');
  if (existing) {
    existing.remove();
    unlockBodyScroll('share-modal');
  }
  const modal = document.createElement('div');
  modal.id = '_shareModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
    <div style="background:var(--card-bg,#1a2444);border-radius:16px;padding:24px;max-width:380px;width:100%;position:relative">
      <div style="font-weight:700;font-size:15px;margin-bottom:12px">Поділитися операцією</div>
      <textarea id="_shareText" readonly style="width:100%;height:160px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:12px;font-size:12px;font-family:monospace;color:inherit;resize:none;margin-bottom:12px">${text}</textarea>
      <div style="display:flex;gap:10px">
        <button id="_shareCopyBtn" class="btn-accent" style="flex:1">Скопіювати</button>
        <button id="_shareCloseBtn" class="btn-ghost">Закрити</button>
      </div>
    </div>`;
  const closeShareModal = () => {
    modal.remove();
    unlockBodyScroll('share-modal');
  };

  document.body.appendChild(modal);
  lockBodyScroll('share-modal');

  document.getElementById('_shareCopyBtn')?.addEventListener('click', () => {
    const ta = document.getElementById('_shareText');
    ta.select(); ta.setSelectionRange(0, 99999);
    try { document.execCommand('copy'); showToast('Скопійовано!', 'success'); } catch(_) {}
    closeShareModal();
  });
  document.getElementById('_shareCloseBtn')?.addEventListener('click', closeShareModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeShareModal(); });
}

// ── SESSION MANAGEMENT ─────────────────────────────────
let _sessionsLoaded = false;
$('#sessionsHead')?.addEventListener('click', async () => {
  const list = $('#sessionsList');
  const chevron = $('#sessionsChevron');
  if (!list) return;
  const isOpen = list.style.display !== 'none';
  list.style.display = isOpen ? 'none' : 'block';
  if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
  if (!isOpen && !_sessionsLoaded) {
    _sessionsLoaded = true;
    list.innerHTML = '<div class="sec-log-loading">Завантаження…</div>';
    try {
      const sessions = await api.request('/api/auth/sessions');
      list.innerHTML = sessions.map(s => `
        <div class="session-item">
          <div class="session-info">
            <div class="session-label">
              ${s.is_current ? '<span class="session-current">Поточна</span> ' : ''}
              Сесія #${s.id}
            </div>
            <div class="session-dates muted">Створено: ${formatDate(s.created_at)} · До: ${formatDate(s.expires_at)}</div>
          </div>
          ${!s.is_current ? `<button class="btn-icon-danger" data-revoke-session="${s.id}" title="Завершити сесію">×</button>` : ''}
        </div>
      `).join('') || '<div class="empty-state">Активних сесій немає.</div>';
      list.querySelectorAll('[data-revoke-session]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.revokeSession);
          confirmAction('Завершити сесію?', 'Ця сесія буде примусово завершена.', async () => {
            try {
              await api.request(`/api/auth/sessions/${id}`, { method: 'DELETE' });
              _sessionsLoaded = false;
              list.style.display = 'none';
              if (chevron) chevron.style.transform = '';
              showToast('Сесію завершено.', 'success');
            } catch(e) { showToast(e.message); }
          });
        });
      });
    } catch(e) {
      list.innerHTML = `<div class="sec-log-error">${escapeHtml(e.message)}</div>`;
    }
  }
});

// ── ACHIEVEMENTS ──────────────────────────────────────
async function loadAchievements() {
  const listEl = $('#achievementsList');
  const countEl = $('#achieveCount');
  if (!listEl) return;
  try {
    const data = await api.request('/api/achievements');
    const { achievements, done, total } = data;
    if (countEl) countEl.textContent = `${done}/${total}`;
    const DONE_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    const LOCK_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
    const ACHIEVE_SVG = {
      'Великий заощаджувач': `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`,
      'Близькі поруч':       `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
      'Активний':            `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
      default:               `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>`,
    };
    listEl.innerHTML = achievements.map(a => {
      const iconSvg = ACHIEVE_SVG[a.title] || ACHIEVE_SVG.default;
      return `
      <div class="achieve-item ${a.done ? 'done' : 'locked'}">
        <div class="achieve-icon">${iconSvg}</div>
        <div class="achieve-body">
          <div class="achieve-title">${a.title}</div>
          <div class="achieve-desc">${a.desc}</div>
        </div>
        ${a.done ? `<div class="achieve-check">${DONE_SVG}</div>` : `<div class="achieve-check locked-icon">${LOCK_SVG}</div>`}
      </div>`;
    }).join('');
  } catch(_) {}
}

// ── SAVINGS CALCULATOR ─────────────────────────────────
function updateSavingsCalc() {
  const target  = parseFloat($('#calcTarget')?.value  || 0);
  const monthly = parseFloat($('#calcMonthly')?.value || 0);
  const current = parseFloat($('#calcCurrent')?.value || 0);
  const result  = $('#calcResult');
  if (!result) return;

  if (!target || !monthly || monthly <= 0) {
    result.innerHTML = '<span class="muted">Введіть суму цілі та щомісячний внесок.</span>';
    return;
  }

  const remaining = Math.max(0, target - current);
  const months = Math.ceil(remaining / monthly);
  const years = Math.floor(months / 12);
  const remMonths = months % 12;

  const now = new Date();
  const finishDate = new Date(now.getFullYear(), now.getMonth() + months, 1);
  const dateStr = finishDate.toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });

  let timeStr = '';
  if (months === 0) timeStr = 'Ціль вже досягнута! 🎉';
  else if (years > 0) timeStr = `${years} р. ${remMonths ? remMonths + ' міс.' : ''}`;
  else timeStr = `${months} міс.`;

  const pct = target > 0 ? Math.min(100, Math.round(current / target * 100)) : 0;

  result.innerHTML = `
    <div class="calc-answer">
      <div class="calc-main">${timeStr}</div>
      <div class="muted">до ${dateStr} · ${remaining > 0 ? formatMoney(remaining) + ' залишилось' : 'ціль досягнута'}</div>
    </div>
    <div class="progress-bar-wrap" style="margin-top:10px">
      <div class="progress-bar" style="width:${pct}%"></div>
    </div>
    <div class="muted" style="font-size:11px;margin-top:4px">${pct}% досягнуто</div>
  `;
}

['#calcTarget','#calcMonthly','#calcCurrent'].forEach(sel => {
  $(sel)?.addEventListener('input', updateSavingsCalc);
});
if ($('#calcTarget')) updateSavingsCalc();

// ── CALENDAR VIEW ─────────────────────────────────────
let _calYear = new Date().getFullYear();
let _calMonth = new Date().getMonth();
let _calTxData = {};

async function loadCalendar() {
  const from = new Date(_calYear, _calMonth, 1).toISOString().slice(0,10);
  const to   = new Date(_calYear, _calMonth+1, 0).toISOString().slice(0,10);
  try {
    const txs = await api.request(`/api/transactions/history?from_date=${from}&to_date=${to}`);
    _calTxData = {};
    txs.forEach(tx => {
      const d = (tx.created_at||'').slice(0,10);
      if (!_calTxData[d]) _calTxData[d] = { in: 0, out: 0, count: 0, txs: [] };
      _calTxData[d].count++;
      _calTxData[d][tx.direction] += Number(tx.amount);
      _calTxData[d].txs.push(tx);
    });
    renderCalendar();
  } catch(_) {}
}

function renderCalendar() {
  const label = $('#calMonthLabel');
  if (label) {
    label.textContent = new Date(_calYear, _calMonth, 1)
      .toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });
  }
  const grid = $('#calGrid');
  if (!grid) return;

  const firstDay = new Date(_calYear, _calMonth, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(_calYear, _calMonth+1, 0).getDate();
  const today = new Date().toISOString().slice(0,10);

  let html = '';
  for (let i = 0; i < firstDay; i++) html += '<div class="cal-cell cal-empty"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${_calYear}-${String(_calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayData = _calTxData[dateStr];
    const isToday = dateStr === today;
    let dots = '';
    if (dayData) {
      if (dayData.in > 0)  dots += '<span class="cal-dot in"></span>';
      if (dayData.out > 0) dots += '<span class="cal-dot out"></span>';
    }
    html += `
      <div class="cal-cell ${isToday ? 'today' : ''} ${dayData ? 'has-tx' : ''}" data-cal-date="${dateStr}">
        <span class="cal-day-num">${d}</span>
        <div class="cal-dots">${dots}</div>
      </div>`;
  }
  grid.innerHTML = html;

  grid.querySelectorAll('.cal-cell[data-cal-date]').forEach(cell => {
    cell.addEventListener('click', () => {
      const date = cell.dataset.calDate;
      const dayData = _calTxData[date];
      const detail = $('#calDayDetail');
      const dayTitle = $('#calDayTitle');
      const dayList = $('#calDayList');
      if (!detail) return;
      if (!dayData || !dayData.txs.length) { detail.style.display = 'none'; return; }
      detail.style.display = 'block';
      if (dayTitle) dayTitle.textContent = new Date(date + 'T12:00:00').toLocaleDateString('uk-UA', { weekday:'long', day:'numeric', month:'long' });
      if (dayList) {
        dayList.innerHTML = dayData.txs.map(tx => `
          <div class="item">
            <div class="tx-dir-dot ${tx.direction}"></div>
            <div class="item-body">
              <div class="item-header">
                <strong>${escapeHtml(tx.description)}</strong>
                <span class="amount ${tx.direction}">${tx.direction==='in'?'+':'−'}${formatMoney(tx.amount)}</span>
              </div>
              <div class="muted">${(TX_TYPE_LABELS||{})[tx.tx_type]||tx.tx_type}</div>
            </div>
          </div>`).join('');
      }
      grid.querySelectorAll('.cal-cell').forEach(c => c.classList.toggle('selected', c.dataset.calDate === date));
    });
  });
}

$('#calPrev')?.addEventListener('click', () => {
  _calMonth--;
  if (_calMonth < 0) { _calMonth = 11; _calYear--; }
  const det = $('#calDayDetail');
  if (det) det.style.display = 'none';
  loadCalendar();
});
$('#calNext')?.addEventListener('click', () => {
  _calMonth++;
  if (_calMonth > 11) { _calMonth = 0; _calYear++; }
  const det = $('#calDayDetail');
  if (det) det.style.display = 'none';
  loadCalendar();
});

// ── SOUND EFFECTS ─────────────────────────────────────
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let _audioCtx = null;

function playSound(type) {
  if (localStorage.getItem('ab_sound') === 'false') return;
  try {
    if (!_audioCtx) _audioCtx = new AudioCtx();
    const osc = _audioCtx.createOscillator();
    const gain = _audioCtx.createGain();
    osc.connect(gain);
    gain.connect(_audioCtx.destination);

    if (type === 'success') {
      osc.frequency.setValueAtTime(523, _audioCtx.currentTime);
      osc.frequency.setValueAtTime(659, _audioCtx.currentTime + 0.1);
      osc.frequency.setValueAtTime(784, _audioCtx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.08, _audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + 0.5);
      osc.start(_audioCtx.currentTime);
      osc.stop(_audioCtx.currentTime + 0.5);
    } else if (type === 'error') {
      osc.frequency.setValueAtTime(220, _audioCtx.currentTime);
      osc.frequency.setValueAtTime(180, _audioCtx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.06, _audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + 0.3);
      osc.start(_audioCtx.currentTime);
      osc.stop(_audioCtx.currentTime + 0.3);
    } else if (type === 'click') {
      osc.frequency.setValueAtTime(800, _audioCtx.currentTime);
      gain.gain.setValueAtTime(0.03, _audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + 0.05);
      osc.start(_audioCtx.currentTime);
      osc.stop(_audioCtx.currentTime + 0.05);
    }
  } catch(_) {}
}

function haptic(pattern = [10]) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

function initSound() {
  const toggle = $('#soundToggle');
  const saved = localStorage.getItem('ab_sound') !== 'false';
  if (toggle) toggle.checked = saved;
}
$('#soundToggle')?.addEventListener('change', function() {
  localStorage.setItem('ab_sound', this.checked ? 'true' : 'false');
});
initSound();

// Patch showToast to play sounds
(function() {
  const _origShowToast = showToast;
  window.showToast = function(message, type) {
    _origShowToast(message, type);
    if (type === 'success') { playSound('success'); haptic([15]); }
    else if (!type && message) playSound('error');
  };
})();

// ── BALANCE FORECAST ──────────────────────────────────
async function loadForecast() {
  const el = $('#forecastContent');
  if (!el) return;
  try {
    const [history, analytics] = await Promise.all([
      api.request('/api/analytics/balance-history?days=30'),
      api.request('/api/analytics/summary'),
    ]);
    if (!history || history.length < 7) {
      el.innerHTML = '<div class="empty-state">Недостатньо даних для прогнозу.</div>';
      return;
    }

    const cur = analytics.current_month || {};
    const monthlyNet = (cur.total_in || 0) - (cur.total_out || 0);
    const currentBalance = history[history.length - 1]?.balance || 0;

    const forecasts = [1, 3, 6].map(months => ({
      months,
      balance: Math.max(0, currentBalance + monthlyNet * months),
    }));

    const trend = monthlyNet >= 0 ? 'green' : 'red';
    const trendText = monthlyNet >= 0 ? `+${formatMoney(monthlyNet)}/міс` : `${formatMoney(monthlyNet)}/міс`;

    el.innerHTML = `
      <div class="forecast-trend muted" style="margin-bottom:14px">
        Середній місячний баланс: <strong style="color:var(--${trend})">${trendText}</strong>
      </div>
      <div class="forecast-grid">
        ${forecasts.map(f => `
          <div class="forecast-item">
            <div class="forecast-period">${f.months} ${f.months===1?'місяць':f.months<5?'місяці':'місяців'}</div>
            <div class="forecast-balance ${f.balance > currentBalance ? 'up' : 'down'}">${formatMoney(f.balance)}</div>
            <div class="forecast-change muted">
              ${f.balance > currentBalance ? '↑' : '↓'} ${formatMoney(Math.abs(f.balance - currentBalance))}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch(_) {}
}

// ── MULTI-TAB SYNC ─────────────────────────────────────
(function initTabSync() {
  if (!('BroadcastChannel' in window)) return;
  const bc = new BroadcastChannel('army_bank_sync');
  window._bcChannel = bc;
  const tabId = `tab_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  let suppressBroadcast = false;

  bc.addEventListener('message', e => {
    if (!e.data || e.data.from === tabId) return;
    if (e.data.type === 'DATA_UPDATED' && api.token) {
      suppressBroadcast = true;
      Promise.resolve(window.refreshAllData ? window.refreshAllData() : refreshAllData())
        .catch(() => {})
        .finally(() => { suppressBroadcast = false; });
    }
    if (e.data.type === 'LOGOUT') {
      stopPolling();
      stopNotifPolling();
      clearBootstrapRetryTimer();
      api.setToken('');
      setAuthenticated(false);
      showToast('Вийшли в іншій вкладці.');
    }
  });

  const _origRefreshAllData = window.refreshAllData || refreshAllData;
  window.refreshAllData = async function() {
    await _origRefreshAllData();
    if (!suppressBroadcast) {
      bc.postMessage({ type: 'DATA_UPDATED', from: tabId, at: Date.now() });
    }
  };
})();

// ═══════════════════════════════════════════════════════════
// WAVE 5 — PIN, Recurring, Debts, Tags, Velocity, Onboarding
// ═══════════════════════════════════════════════════════════

// ── CountUp Balance Animation ────────────────────────────
function animateCounter(el, from, to, duration) {
  if (!el) return;
  duration = duration || 700;
  const start = performance.now();
  const diff = to - from;
  function step(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    el.textContent = formatMoney(from + diff * ease);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ── Shake Animation ──────────────────────────────────────
function shakeElement(el) {
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 600);
}

// ── PIN Lock ─────────────────────────────────────────────
const PIN_TIMEOUT_MS = 3 * 60 * 1000;
let _pinBuffer = '';
let _pinLocked = false;
let _pinInactivityTimer = null;
let _hasPinEnabled = false;

function resetInactivityTimer() {
  clearTimeout(_pinInactivityTimer);
  if (_hasPinEnabled && api.token && !_pinLocked) {
    _pinInactivityTimer = setTimeout(showPinLock, PIN_TIMEOUT_MS);
  }
}

['click', 'keydown', 'touchstart', 'mousemove'].forEach(function(evt) {
  document.addEventListener(evt, resetInactivityTimer, { passive: true });
});

function updatePinDots() {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById('pd' + i);
    if (dot) dot.classList.toggle('filled', i < _pinBuffer.length);
  }
}

function showPinLock() {
  if (!api.token) return;
  _pinLocked = true;
  _pinBuffer = '';
  updatePinDots();
  const overlay = $('#pinLockOverlay');
  if (overlay) overlay.classList.remove('hidden');
  lockBodyScroll('pin-lock');
}

function hidePinLock() {
  _pinLocked = false;
  _pinBuffer = '';
  updatePinDots();
  const overlay = $('#pinLockOverlay');
  if (overlay) overlay.classList.add('hidden');
  unlockBodyScroll('pin-lock');
  resetInactivityTimer();
}

async function submitPinAttempt() {
  const pin = _pinBuffer;
  _pinBuffer = '';
  updatePinDots();
  const errEl = $('#pinError');
  try {
    await api.request('/api/auth/pin/verify', { method: 'POST', body: JSON.stringify({ pin: pin }) });
    hidePinLock();
    if (errEl) errEl.textContent = '';
  } catch (_e) {
    if (errEl) {
      errEl.textContent = 'Невірний PIN. Спробуйте ще раз.';
      shakeElement($('#pinDots'));
      setTimeout(function() { if (errEl) errEl.textContent = ''; }, 2500);
    }
  }
}

$$('.pin-key[data-digit]').forEach(function(btn) {
  btn.addEventListener('click', function() {
    if (_pinBuffer.length >= 4) return;
    _pinBuffer += btn.dataset.digit;
    updatePinDots();
    if (_pinBuffer.length === 4) setTimeout(submitPinAttempt, 150);
  });
});

$('#pinBackBtn')?.addEventListener('click', function() {
  _pinBuffer = _pinBuffer.slice(0, -1);
  updatePinDots();
});

$('#pinLogoutBtn')?.addEventListener('click', async function() {
  hidePinLock();
  await performLogout({ confirm: true });
});

async function checkPinStatus() {
  try {
    const data = await api.request('/api/auth/pin/status');
    _hasPinEnabled = !!(data && data.has_pin);
    const badge = $('#pinStatusBadge');
    if (badge) {
      badge.textContent = _hasPinEnabled ? '🔒 PIN встановлено' : '🔓 PIN не встановлено';
      badge.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:10px;color:' + (_hasPinEnabled ? 'var(--green)' : 'var(--text-muted)') + ';display:block;';
    }
    if (_hasPinEnabled) showPinLock();
    else resetInactivityTimer();
  } catch (_e) {}
}

$('#setPinForm')?.addEventListener('submit', async function(e) {
  e.preventDefault();
  const pin = ($('#pinInput') || {}).value || '';
  const btn = $('#setPinBtn');
  if (!/^\d{4}$/.test(pin)) { showToast('PIN повинен містити 4 цифри.'); shakeElement($('#setPinForm')); return; }
  try {
    setButtonLoading(btn, true);
    await api.request('/api/auth/pin', { method: 'PUT', body: JSON.stringify({ pin: pin }) });
    _hasPinEnabled = true;
    showToast('PIN встановлено.', 'success');
    if ($('#pinInput')) $('#pinInput').value = '';
    const badge = $('#pinStatusBadge');
    if (badge) { badge.textContent = '🔒 PIN встановлено'; badge.style.color = 'var(--green)'; }
    resetInactivityTimer();
  } catch (e) { showToast(e.message); } finally { setButtonLoading(btn, false); }
});

$('#clearPinBtn')?.addEventListener('click', async function() {
  try {
    await api.request('/api/auth/pin', { method: 'DELETE' });
    _hasPinEnabled = false;
    clearTimeout(_pinInactivityTimer);
    showToast('PIN видалено.', 'success');
    const badge = $('#pinStatusBadge');
    if (badge) { badge.textContent = '🔓 PIN не встановлено'; badge.style.color = 'var(--text-muted)'; }
  } catch (e) { showToast(e.message); }
});

// ── Session Management Engine ────────────────────────────
// Idle logout: 15 min without activity → warning → 60s countdown → logout
// Absolute timeout: force logout when JWT exp reached
// Visibility/online: revalidate token on tab focus / network restore

const SESSION_IDLE_MS     = 15 * 60 * 1000;  // 15 min idle → start warning
const SESSION_WARN_MS     = 60 * 1000;        // 60 s warning countdown
const SESSION_MIN_EXTEND  = 30 * 1000;        // don't call /api/me more than once per 30s

let _sesIdleTimer     = null;
let _sesAbsTimer      = null;
let _sesWarnInterval  = null;
let _sesWarnActive    = false;
let _sesLastExtend    = 0;

function _sesJwtExp(token) {
  // Parse JWT exp claim without any library
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch (_) { return null; }
}

function _sesCancelWarn() {
  if (_sesWarnInterval) { clearInterval(_sesWarnInterval); _sesWarnInterval = null; }
  _sesWarnActive = false;
  const ov = document.getElementById('sessionWarnOverlay');
  if (ov) ov.classList.add('hidden');
}

function _sesShowWarn() {
  if (_sesWarnActive) return;
  _sesWarnActive = true;
  let secs = Math.round(SESSION_WARN_MS / 1000);
  const ov = document.getElementById('sessionWarnOverlay');
  const cd = document.getElementById('sessionWarnCountdown');
  if (ov) ov.classList.remove('hidden');
  if (cd) cd.textContent = secs;
  _sesWarnInterval = setInterval(() => {
    secs -= 1;
    if (cd) cd.textContent = Math.max(0, secs);
    if (secs <= 0) {
      _sesCancelWarn();
      performLogout({ showMessage: true, reason: 'idle' });
    }
  }, 1000);
}

function _sesResetIdle() {
  if (!api.token || _sesWarnActive) return;
  clearTimeout(_sesIdleTimer);
  _sesIdleTimer = setTimeout(_sesShowWarn, SESSION_IDLE_MS);
}

function _sesScheduleAbsolute() {
  clearTimeout(_sesAbsTimer);
  if (!api.token) return;
  const exp = _sesJwtExp(api.token);
  if (!exp) return;
  const ms = exp - Date.now();
  if (ms <= 0) {
    performLogout({ showMessage: true, reason: 'expired' });
    return;
  }
  // Show warning 60s before absolute expiry too (if sooner than idle warning)
  const warnAt = ms - SESSION_WARN_MS;
  if (warnAt > 0) {
    _sesAbsTimer = setTimeout(() => {
      _sesCancelWarn();
      _sesShowWarn();
      // After warning, force logout
      setTimeout(() => {
        if (_sesWarnActive) {
          _sesCancelWarn();
          performLogout({ showMessage: true, reason: 'expired' });
        }
      }, SESSION_WARN_MS + 2000);
    }, warnAt);
  } else {
    _sesAbsTimer = setTimeout(() => {
      _sesCancelWarn();
      performLogout({ showMessage: true, reason: 'expired' });
    }, Math.max(ms, 100));
  }
}

async function _sesExtend() {
  const now = Date.now();
  if (now - _sesLastExtend < SESSION_MIN_EXTEND) return;
  _sesLastExtend = now;
  try {
    await api.request('/api/auth/me');
    // If server returns a refreshed token it's handled by api.request interceptor
    _sesCancelWarn();
    _sesScheduleAbsolute();
    _sesResetIdle();
  } catch (err) {
    if (isAuthErrorResponse(err)) {
      _sesCancelWarn();
      performLogout({ showMessage: true, reason: 'expired' });
    }
  }
}

function startSessionEngine() {
  stopSessionEngine();
  if (!api.token) return;
  _sesScheduleAbsolute();
  _sesResetIdle();
}

function stopSessionEngine() {
  clearTimeout(_sesIdleTimer);
  clearTimeout(_sesAbsTimer);
  _sesCancelWarn();
  _sesIdleTimer = null;
  _sesAbsTimer  = null;
}

// Reuse existing activity listeners — also drive session idle reset
['click', 'keydown', 'touchstart', 'mousemove'].forEach(evt => {
  document.addEventListener(evt, () => { if (api.token) _sesResetIdle(); }, { passive: true });
});

// Tab focus → revalidate token
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && api.token) {
    _sesExtend();
  }
});

// Network restore → revalidate token
window.addEventListener('online', () => {
  if (api.token) _sesExtend();
});

// Warning overlay buttons
document.getElementById('sessionWarnExtend')?.addEventListener('click', () => {
  _sesLastExtend = 0; // force refresh even within throttle window
  _sesExtend();
});
document.getElementById('sessionWarnLogout')?.addEventListener('click', () => {
  _sesCancelWarn();
  performLogout();
});

// ── Spending Velocity ────────────────────────────────────
async function loadVelocity() {
  try {
    const data = await api.request('/api/analytics/velocity');
    const card = $('#velocityCard');
    if (card) card.style.display = '';
    const dailyEl = $('#velocityDailySpend');
    const daysEl = $('#velocityDaysLeft');
    if (dailyEl) dailyEl.textContent = formatMoney(data.avg_daily_spend || 0);
    if (daysEl) {
      if (data.days_until_zero === null || data.days_until_zero === undefined) {
        daysEl.textContent = '∞ (без витрат)';
        daysEl.style.color = 'var(--green)';
      } else if (data.days_until_zero < 7) {
        daysEl.textContent = '\u26a0\ufe0f ' + data.days_until_zero + ' днів';
        daysEl.style.color = 'var(--red)';
      } else if (data.days_until_zero < 30) {
        daysEl.textContent = data.days_until_zero + ' днів';
        daysEl.style.color = '#f59e0b';
      } else {
        daysEl.textContent = data.days_until_zero + ' днів';
        daysEl.style.color = 'var(--green)';
      }
    }
  } catch (_e) {}
}

// ── Top Recipients ───────────────────────────────────────
async function loadTopRecipients() {
  try {
    const list = await api.request('/api/analytics/top-recipients');
    const el = $('#topRecipientsCard');
    if (!el || !list.length) return;
    el.style.display = '';
    el.innerHTML = '<h3 class="card-title" style="margin-bottom:12px">Топ отримувачів</h3>' +
      list.map(function(r, i) {
        return '<button type="button" class="top-recipient-row" data-top-account="' + escapeHtml(r.related_account || '') + '" style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border);width:100%;background:transparent;border-left:none;border-right:none;border-top:none;text-align:left">' +
          '<div style="width:24px;height:24px;border-radius:50%;background:var(--green-bg);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;color:var(--green)">' + (i+1) + '</div>' +
          '<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(r.related_account || '—') + '</div>' +
          '<div class="muted">' + r.tx_count + ' переказів</div></div>' +
          '<div style="font-weight:900;color:var(--red)">\u2212' + formatMoney(r.total_sent) + '</div></button>';
      }).join('');
    el.querySelectorAll('[data-top-account]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const account = normalizeAccountNumber(btn.dataset.topAccount || '');
        if (!isLikelyAccountNumber(account)) return;
        goToDashboardTransferForm();
        prefillTransferForm({ mode: 'account', account: account });
        showToast(`Переказ на ${account} підготовлено.`, 'success');
      });
    });
  } catch (_e) {}
}

// ── Recurring Transactions ───────────────────────────────
async function loadRecurring() {
  const listEl = $('#recurringList');
  if (listEl) { listEl.classList.add('loading'); listEl.innerHTML = ''; }
  try {
    const items = await api.request('/api/recurring-transactions');
    if (!listEl) return;
    listEl.classList.remove('loading');
    if (!items.length) {
      listEl.innerHTML = '<div class="empty-state"><strong>Немає платежів</strong>Додайте перший регулярний платіж.</div>';
      return;
    }
    const FREQ = { daily: 'Щодня', weekly: 'Щотижня', monthly: 'Щомісяця', yearly: 'Щороку' };
    listEl.innerHTML = items.map(function(r) {
      return '<div class="item item-with-actions" style="' + (r.is_active ? '' : 'opacity:.5') + '">' +
        '<div class="item-main">' +
          '<div class="item-header"><strong>' + r.title + '</strong><span class="amount out">\u2212' + formatMoney(r.amount) + '</span></div>' +
          '<div class="muted">' + (FREQ[r.frequency] || r.frequency) + ' \xb7 наступний: ' + (r.next_run_date || '—') + '</div>' +
          (r.recipient_account ? '<div class="muted">\u2192 ' + r.recipient_account + '</div>' : '') +
        '</div>' +
        '<div class="item-btns">' +
          '<button class="btn-icon-transfer" data-toggle-recurring="' + r.id + '" data-active="' + (r.is_active ? '1' : '0') + '" title="' + (r.is_active ? 'Зупинити' : 'Запустити') + '">' +
            (r.is_active
              ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
              : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>') +
          '</button>' +
          '<button class="btn-icon-danger" data-delete-recurring="' + r.id + '" title="Видалити">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>';
    }).join('');

    $$('#recurringList [data-delete-recurring]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const id = Number(btn.dataset.deleteRecurring);
        confirmAction('Видалити регулярний платіж?', 'Платіж буде видалено. Минулі транзакції залишаться.', async function() {
          try {
            await api.request('/api/recurring-transactions/' + id, { method: 'DELETE' });
            await loadRecurring();
            showToast('Платіж видалено.', 'success');
          } catch (e) { showToast(e.message); }
        });
      });
    });

    $$('#recurringList [data-toggle-recurring]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        const id = Number(btn.dataset.toggleRecurring);
        const isActive = btn.dataset.active === '1';
        try {
          await api.request('/api/recurring-transactions/' + id + '/toggle', {
            method: 'PATCH', body: JSON.stringify({ is_active: !isActive })
          });
          await loadRecurring();
        } catch (e) { showToast(e.message); }
      });
    });
  } catch (e) {
    if (listEl) { listEl.classList.remove('loading'); listEl.innerHTML = '<div class="drawer-error">' + escapeHtml(e.message) + '</div>'; }
  }
}

$('#recurringForm')?.addEventListener('submit', async function(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = form.querySelector('button[type="submit"]');
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    setButtonLoading(btn, true);
    await api.request('/api/recurring-transactions', { method: 'POST', body: JSON.stringify(data) });
    form.reset();
    await loadRecurring();
    showToast('Регулярний платіж додано.', 'success');
  } catch (e) { showToast(e.message); shakeElement(form); } finally { setButtonLoading(btn, false); }
});

// ── Debt Tracker ─────────────────────────────────────────
async function loadDebts() {
  const listEl = $('#debtsList');
  if (listEl) { listEl.classList.add('loading'); listEl.innerHTML = ''; }
  try {
    const items = await api.request('/api/debts');
    if (!listEl) return;
    listEl.classList.remove('loading');

    let sumOwedToMe = 0, sumIOwe = 0;
    items.forEach(function(d) {
      if (!d.is_settled) {
        if (d.direction === 'owed_to_me') sumOwedToMe += Number(d.amount);
        else sumIOwe += Number(d.amount);
      }
    });
    const s1 = $('#debtSumOwedToMe');
    const s2 = $('#debtSumIOwe');
    if (s1) s1.textContent = formatMoney(sumOwedToMe);
    if (s2) s2.textContent = formatMoney(sumIOwe);

    if (!items.length) {
      listEl.innerHTML = '<div class="empty-state"><strong>Боргів немає</strong>Додайте перший борг або позику нижче.</div>';
      return;
    }

    listEl.innerHTML = items.map(function(d) {
      const isIn = d.direction === 'owed_to_me';
      return '<div class="item item-with-actions' + (d.is_settled ? ' debt-settled' : '') + '">' +
        '<div class="item-main">' +
          '<div class="item-header">' +
            '<strong>' + d.contact_name + '</strong>' +
            '<span class="amount ' + (isIn ? 'in' : 'out') + '">' + (isIn ? '+' : '\u2212') + formatMoney(d.amount) + '</span>' +
          '</div>' +
          '<div class="muted">' + (isIn ? 'Мені винні' : 'Я винен') +
            (d.description ? ' \xb7 ' + d.description : '') +
            (d.is_settled ? ' \xb7 \u2705 Закрито' : '') +
          '</div>' +
        '</div>' +
        '<div class="item-btns">' +
          (!d.is_settled
            ? '<button class="btn-icon-transfer" data-settle-debt="' + d.id + '" title="Закрити борг"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg></button>'
            : '') +
          '<button class="btn-icon-danger" data-delete-debt="' + d.id + '" title="Видалити"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>' +
        '</div>' +
      '</div>';
    }).join('');

    $$('#debtsList [data-settle-debt]').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        const id = Number(btn.dataset.settleDebt);
        try {
          await api.request('/api/debts/' + id + '/settle', { method: 'POST' });
          await loadDebts();
          showToast('Борг закрито! \u2705', 'success');
        } catch (e) { showToast(e.message); }
      });
    });

    $$('#debtsList [data-delete-debt]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const id = Number(btn.dataset.deleteDebt);
        confirmAction('Видалити борг?', 'Запис про борг буде видалено безповоротно.', async function() {
          try {
            await api.request('/api/debts/' + id, { method: 'DELETE' });
            await loadDebts();
            showToast('Видалено.', 'success');
          } catch (e) { showToast(e.message); }
        });
      });
    });
  } catch (e) {
    if (listEl) { listEl.classList.remove('loading'); listEl.innerHTML = '<div class="drawer-error">' + escapeHtml(e.message) + '</div>'; }
  }
}

$('#debtForm')?.addEventListener('submit', async function(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = form.querySelector('button[type="submit"]');
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    setButtonLoading(btn, true);
    await api.request('/api/debts', { method: 'POST', body: JSON.stringify(data) });
    form.reset();
    await loadDebts();
    showToast('Борг додано.', 'success');
  } catch (e) { showToast(e.message); shakeElement(form); } finally { setButtonLoading(btn, false); }
});

// ── Transaction Tags ─────────────────────────────────────
async function loadTagsCloud() {
  try {
    const tags = await api.request('/api/transactions/tags');
    const el = $('#tagsCloud');
    if (!el || !tags.length) return;
    el.innerHTML = tags.map(function(t) {
      return '<button class="tag-chip" data-tag="' + t + '">' + t + '</button>';
    }).join('');
    $$('#tagsCloud .tag-chip').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const searchInput = $('#txSearchInput');
        if (searchInput) {
          searchInput.value = btn.dataset.tag;
          loadTransactionsWithFilters();
          switchScreen('transactions');
        }
      });
    });
  } catch (_e) {}
}

function getRepeatTransferTarget(tx) {
  if (!tx || tx.tx_type !== 'transfer' || tx.direction !== 'out' || !tx.related_account) return null;
  const related = String(tx.related_account || '').trim();
  const digits = related.replace(/\D/g, '');
  if (digits.length === 16) {
    return { mode: 'card', card: digits.replace(/(.{4})(?=.)/g, '$1 ') };
  }
  const normalized = normalizeAccountNumber(related);
  if (!isLikelyAccountNumber(normalized)) return null;
  return { mode: 'account', account: normalized };
}


// ── Onboarding Tour ──────────────────────────────────────
var ONBOARDING_STEPS = [
  { icon: '\ud83c\udfe6', title: 'Ласкаво просимо до Army Bank!', text: 'Ваш персональний фінансовий помічник. Ми допоможемо вам керувати фінансами легко та зручно.' },
  { icon: '\ud83d\udcb8', title: 'Перекази та поповнення', text: 'Поповнюйте рахунок та надсилайте кошти рідним одним дотиком. Всі операції відображаються миттєво.' },
  { icon: '\ud83c\udfaf', title: 'Цілі накопичення', text: 'Встановлюйте фінансові цілі та відстежуйте прогрес. Система покаже, коли ви близькі до мети.' },
  { icon: '\ud83d\udcca', title: 'Аналітика та захист', text: 'Детальна аналітика, бюджетні ліміти, PIN-захист і звіти. Контролюйте фінанси повністю.' },
];
var _obStep = 0;
var _obAutoTimer = 0;

function _isOnboardingVisible() {
  var overlay = $('#onboardingOverlay');
  if (!overlay) return false;
  return !overlay.classList.contains('hidden');
}

function _finishOnboarding(markDone) {
  var overlay = $('#onboardingOverlay');
  if (overlay) overlay.classList.add('hidden');
  if (markDone) {
    try { localStorage.setItem('army_bank_onboarded', '1'); } catch (_) {}
  }
  window.dispatchEvent(new Event('ab:onboarding-visibility'));
}

function cancelOnboardingAutoShow() {
  if (_obAutoTimer) {
    clearTimeout(_obAutoTimer);
    _obAutoTimer = 0;
  }
}

function scheduleOnboardingAutoShow(delayMs) {
  cancelOnboardingAutoShow();
  try {
    if (localStorage.getItem('army_bank_onboarded')) return;
  } catch (_) {}
  _obAutoTimer = setTimeout(function() {
    _obAutoTimer = 0;
    try {
      if (localStorage.getItem('army_bank_onboarded')) return;
    } catch (_) {}
    if (document.hidden) return;
    var active = document.querySelector('.screen.active-screen')?.id || $('#appScreen')?.dataset?.screen || 'dashboard';
    // Do not interrupt users while they are already in sub-screens.
    if (active !== 'dashboard') return;
    if (document.documentElement.classList.contains('install-banner-visible')) return;
    showOnboarding();
  }, Number(delayMs) || 4200);
}

function showOnboarding() {
  var overlay = $('#onboardingOverlay');
  if (!overlay) return;
  if (_isOnboardingVisible()) return;
  try {
    if (localStorage.getItem('army_bank_onboarded')) return;
  } catch (_) {}
  _obStep = 0;
  renderOnboardingStep();
  overlay.classList.remove('hidden');
  window.dispatchEvent(new Event('ab:onboarding-visibility'));
}

function renderOnboardingStep() {
  var step = ONBOARDING_STEPS[_obStep];
  if (!step) return;
  var content = $('#obContent');
  if (content) {
    content.innerHTML = '<div class="ob-icon">' + step.icon + '</div>' +
      '<h2 class="ob-title">' + step.title + '</h2>' +
      '<p class="ob-text">' + step.text + '</p>';
  }
  $$('.ob-dot').forEach(function(dot, i) { dot.classList.toggle('active', i === _obStep); });
  var nextBtn = $('#obNextBtn');
  if (nextBtn) nextBtn.textContent = _obStep === ONBOARDING_STEPS.length - 1 ? '\ud83d\ude80 Почати!' : 'Далі \u2192';
}

$('#obNextBtn')?.addEventListener('click', function() {
  _obStep++;
  if (_obStep >= ONBOARDING_STEPS.length) {
    _finishOnboarding(true);
  } else {
    renderOnboardingStep();
  }
});

$('#obSkipBtn')?.addEventListener('click', function() {
  _finishOnboarding(true);
});

$('#onboardingOverlay')?.addEventListener('click', function(e) {
  if (e.target === e.currentTarget) _finishOnboarding(true);
});

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && _isOnboardingVisible()) _finishOnboarding(true);
});

window.addEventListener('ab:screen-changed', function(e) {
  var screen = e?.detail?.screen || document.querySelector('.screen.active-screen')?.id || '';
  if (screen && screen !== 'dashboard') {
    cancelOnboardingAutoShow();
    if (_isOnboardingVisible()) _finishOnboarding(true);
  }
});

// ── Balance CountUp on refresh ───────────────────────────
var _wave5_origRefreshProfile = window.refreshProfile || refreshProfile;
window.refreshProfile = async function() {
  var prevBalance = state.account ? parseFloat(state.account.balance || 0) : null;
  await _wave5_origRefreshProfile();
  var newBalance = state.account ? parseFloat(state.account.balance || 0) : null;
  if (prevBalance !== null && newBalance !== null && prevBalance !== newBalance) {
    var heroBalEl = $('#heroBalance');
    var balVal = $('#balanceValue');
    if (heroBalEl) animateCounter(heroBalEl, prevBalance, newBalance, 800);
    if (balVal) animateCounter(balVal, prevBalance, newBalance, 800);
  }
};

// ── Extra data on refreshAllData ─────────────────────────
if (!window._ab_refresh_patched) {
  window._ab_refresh_patched = true;
  var _wave5_origRefreshAll = window.refreshAllData || refreshAllData;
  window.refreshAllData = async function() {
    try {
      await _wave5_origRefreshAll();
    } catch(e) {
      // Ignore inner fails if they already handled it
      throw e;
    }
    checkPinStatus().catch(function() {});
    loadVelocity().catch(function() {});
    loadTagsCloud().catch(function() {});
    loadTopRecipients().catch(function() {});
  };

  // ── Onboarding check after auth ──────────────────────────
  var _wave5_origHandleAuth = window.handleAuth || handleAuth;
  window.handleAuth = async function(form, endpoint) {
    await _wave5_origHandleAuth(form, endpoint);
    scheduleOnboardingAutoShow(4200);
  };
}

console.log('[Army Bank] UX core modules loaded');

// ── A2HS Install Banner ───────────────────────────────────
(function() {
  var deferredPrompt = null;
  var canOfferInstall = false;
  var banner = document.getElementById('installBanner');
  var installBtn = document.getElementById('installBtn');
  var dismissBtn = document.getElementById('installDismiss');
  var bannerTitle = document.getElementById('installBannerTitle');
  var bannerSub = document.getElementById('installBannerSub');
  if (!banner) return;

  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var isAndroid = /android/i.test(navigator.userAgent);
  var isInStandalone = ('standalone' in window.navigator) && window.navigator.standalone;

  function getActiveScreenForInstall() {
    return document.querySelector('.screen.active-screen')?.id || document.getElementById('appScreen')?.dataset?.screen || 'dashboard';
  }

  function isOnboardingBlockingInstall() {
    var overlay = document.getElementById('onboardingOverlay');
    return !!overlay && !overlay.classList.contains('hidden');
  }

  function setInstallBannerVisible(visible) {
    banner.classList.toggle('hidden', !visible);
    document.documentElement.classList.toggle('install-banner-visible', !!visible);
  }

  function applyInstallBannerPlatformContent() {
    if (!installBtn) return;
    if (isIOS && !isInStandalone && !deferredPrompt) {
      banner.dataset.platform = 'ios';
      if (bannerTitle) bannerTitle.textContent = 'Додайте ARM Bank на iPhone';
      if (bannerSub) bannerSub.textContent = 'Safari: Поділитися → На екран Додому';
      installBtn.textContent = 'Як додати';
      return;
    }
    if (isAndroid) {
      banner.dataset.platform = 'android';
      if (bannerTitle) bannerTitle.textContent = 'Встановіть ARM Bank на Android';
      if (bannerSub) bannerSub.textContent = 'Одне натискання — і застосунок на головному екрані';
      installBtn.textContent = 'Встановити';
      return;
    }
    banner.dataset.platform = 'other';
    if (bannerTitle) bannerTitle.textContent = 'Встановіть ARM Bank';
    if (bannerSub) bannerSub.textContent = 'Швидкий доступ і робота як застосунок';
    installBtn.textContent = 'Встановити';
  }

  function refreshInstallBanner() {
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setInstallBannerVisible(false);
      return;
    }
    if (localStorage.getItem('ab_install_dismissed')) {
      setInstallBannerVisible(false);
      return;
    }
    if (!canOfferInstall || !api.token) {
      setInstallBannerVisible(false);
      return;
    }
    if (getActiveScreenForInstall() !== 'dashboard') {
      setInstallBannerVisible(false);
      return;
    }
    if (isOnboardingBlockingInstall()) {
      setInstallBannerVisible(false);
      return;
    }
    setInstallBannerVisible(true);
    applyInstallBannerPlatformContent();
  }

  // Don't show if already installed or dismissed
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  if (localStorage.getItem('ab_install_dismissed')) return;

  window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    deferredPrompt = e;
    // Show banner lazily and only on dashboard.
    setTimeout(function() {
      canOfferInstall = true;
      refreshInstallBanner();
    }, 3000);
  });

  if (installBtn) {
    installBtn.addEventListener('click', function() {
      if (isIOS && !isInStandalone && !deferredPrompt) {
        showToast('Safari: Поділитися → На екран Додому → Додати', '');
        return;
      }
      if (!deferredPrompt) {
        if (isAndroid) {
          showToast('Відкрийте меню браузера і натисніть "Встановити застосунок".', '');
        }
        return;
      }
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function(choice) {
        deferredPrompt = null;
        setInstallBannerVisible(false);
        if (choice.outcome === 'accepted') {
          showToast('Додаток встановлено!', 'success');
        }
      });
    });
  }

  if (dismissBtn) {
    dismissBtn.addEventListener('click', function() {
      setInstallBannerVisible(false);
      localStorage.setItem('ab_install_dismissed', '1');
    });
  }

  // iOS Safari install hint
  if (isIOS && !isInStandalone && !localStorage.getItem('ab_install_dismissed')) {
    setTimeout(function() {
      canOfferInstall = true;
      refreshInstallBanner();
    }, 4000);
  }

  window.addEventListener('ab:screen-changed', refreshInstallBanner);
  window.addEventListener('ab:onboarding-visibility', refreshInstallBanner);
  window.addEventListener('focus', refreshInstallBanner, { passive: true });
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) refreshInstallBanner();
  }, { passive: true });

  // Initial post-auth reconciliation.
  setTimeout(refreshInstallBanner, 1200);
})();

// ── Pull-to-refresh ───────────────────────────────────────
(function() {
  var content = document.querySelector('.app-content');
  var indicator = document.getElementById('pullRefreshIndicator');
  if (!content || !indicator) return;
  var indicatorText = indicator.querySelector('span');
  var startY = 0, pulling = false, pullDistance = 0;
  var SOFT_THRESHOLD = 72;
  var HARD_THRESHOLD = 132;
  var refreshing = false;

  function setIndicatorText(txt) {
    if (indicatorText) indicatorText.textContent = txt;
  }

  async function hardRefresh() {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        var regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(function(reg) {
          return reg.update().catch(function() {});
        }));
        regs.forEach(function(reg) {
          if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        });
      }
    } catch (_) {}

    try {
      var url = new URL(window.location.href);
      url.searchParams.set('_r', String(Date.now()));
      window.location.replace(url.toString());
    } catch (_) {
      window.location.reload();
    }
  }

  content.addEventListener('touchstart', function(e) {
    if (refreshing) return;
    if (content.scrollTop <= 0) {
      startY = e.touches[0].clientY;
      pullDistance = 0;
      setIndicatorText('Потягніть вниз для оновлення');
      return;
    }
    startY = 0;
    pullDistance = 0;
  }, { passive: true });

  content.addEventListener('touchmove', function(e) {
    if (!startY || refreshing) return;
    var dy = e.touches[0].clientY - startY;
    if (dy <= 0) return;
    pullDistance = dy;
    if (dy > 24 && !pulling) {
      pulling = true;
      indicator.classList.add('visible');
    }
    if (dy >= HARD_THRESHOLD) {
      setIndicatorText('Відпустіть для повного перезавантаження');
    } else if (dy >= SOFT_THRESHOLD) {
      setIndicatorText('Відпустіть для оновлення даних');
    } else {
      setIndicatorText('Потягніть ще трохи');
    }
  }, { passive: true });

  content.addEventListener('touchend', async function() {
    if (refreshing) return;
    if (!(pulling && pullDistance >= SOFT_THRESHOLD)) {
      indicator.classList.remove('visible');
      setIndicatorText('Оновлення…');
      pulling = false;
      pullDistance = 0;
      startY = 0;
      return;
    }

    refreshing = true;
    setIndicatorText(pullDistance >= HARD_THRESHOLD
      ? 'Перезавантаження сторінки…'
      : 'Оновлення даних…'
    );

    try {
      if (pullDistance >= HARD_THRESHOLD) {
        await hardRefresh();
        return;
      }
      await refreshAllData();
      showToast('Оновлено', 'success');
    } catch (_) {
      showToast('Помилка оновлення', 'error');
    } finally {
      refreshing = false;
      indicator.classList.remove('visible');
      setIndicatorText('Оновлення…');
    }

    pulling = false;
    pullDistance = 0;
    startY = 0;
  }, { passive: true });
})();

// ── Dashboard header scroll proxy (mobile) ───────────────
(function() {
  var header = document.querySelector('#appScreen .app-header');
  var content = document.querySelector('.app-content');
  if (!header || !content) return;

  var touchActive = false;
  var startX = 0;
  var startY = 0;
  var lastY = 0;
  var mobileMql = window.matchMedia('(max-width: 959px)');

  function isMobileLayout() {
    return !!mobileMql.matches;
  }

  function isDashboard() {
    var activeEl = document.querySelector('.screen.active-screen');
    return !!activeEl && activeEl.id === 'dashboard';
  }

  function isInteractiveTarget(target) {
    if (!target || !target.closest) return false;
    return !!target.closest(
      'button, a, input, textarea, select, ' +
      '.icon-btn, [data-no-header-scroll-proxy]'
    );
  }

  header.addEventListener('touchstart', function(e) {
    if (!isMobileLayout() || !isDashboard() || isInteractiveTarget(e.target)) {
      touchActive = false;
      return;
    }
    touchActive = true;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    lastY = e.touches[0].clientY;
  }, { passive: true });

  header.addEventListener('touchmove', function(e) {
    if (!touchActive || !isMobileLayout() || !isDashboard()) return;
    var x = e.touches[0].clientX;
    var y = e.touches[0].clientY;
    var absDx = Math.abs(x - startX);
    var absDy = Math.abs(y - startY);
    // Keep native horizontal gestures for card carousel.
    if (absDx > absDy * 1.08) return;
    var dy = y - lastY;
    if (Math.abs(dy) < 1.5) return;
    content.scrollTop = Math.max(0, content.scrollTop - dy);
    lastY = y;
    e.preventDefault();
  }, { passive: false });

  header.addEventListener('touchend', function() {
    touchActive = false;
  }, { passive: true });

  header.addEventListener('touchcancel', function() {
    touchActive = false;
  }, { passive: true });

  header.addEventListener('wheel', function(e) {
    if (!isDashboard() || isInteractiveTarget(e.target)) return;
    content.scrollTop = Math.max(0, content.scrollTop + e.deltaY);
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('ab:screen-changed', function() {
    touchActive = false;
  });
})();

// ── Swipe between screens ─────────────────────────────────
(function() {
  var SCREENS_ORDER = ['dashboard', 'transactions', 'cards', 'profile'];
  var content = document.querySelector('.app-content');
  if (!content) return;
  var startX = 0, startY = 0, swipeEligible = false;
  var EDGE_GUTTER = 20;
  var NAV_GUARD_ZONE = 132; // ignore gestures near bottom nav area

  function isInteractiveTarget(target) {
    if (!target || !target.closest) return false;
    return !!target.closest(
      'input, textarea, select, button, a, [data-no-screen-swipe], ' +
      '.bank-cards-track, .bank-card, .quick-actions, .transfer-mode-toggle, ' +
      '#dashboardActionForms, .drawer, .notif-panel'
    );
  }

  function hasOpenOverlay() {
    return !document.getElementById('txDrawer')?.classList.contains('hidden') ||
      !document.getElementById('transferConfirmOverlay')?.classList.contains('hidden') ||
      !document.getElementById('confirmDialog')?.classList.contains('hidden') ||
      document.getElementById('notifPanel')?.classList.contains('open');
  }

  content.addEventListener('touchstart', function(e) {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    var fromBottomNavZone = startY >= (window.innerHeight - NAV_GUARD_ZONE);
    if (fromBottomNavZone) {
      swipeEligible = false;
      return;
    }
    var fromEdge = startX <= EDGE_GUTTER || startX >= (window.innerWidth - EDGE_GUTTER);
    swipeEligible = fromEdge && !isInteractiveTarget(e.target) && !hasOpenOverlay();
  }, { passive: true });

  content.addEventListener('touchend', function(e) {
    if (!swipeEligible) return;
    swipeEligible = false;
    var dx = e.changedTouches[0].clientX - startX;
    var dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    // Find current screen
    var activeEl = document.querySelector('.screen.active-screen');
    if (!activeEl) return;
    var cur = SCREENS_ORDER.indexOf(activeEl.id);
    if (cur < 0) return;
    if (dx < -50 && cur < SCREENS_ORDER.length - 1) {
      // swipe left = next
      var nextScreen = SCREENS_ORDER[cur + 1];
      var base = getBasePath ? getBasePath() : '';
      window.history.pushState(null, '', base ? base + '/' + nextScreen : '/' + nextScreen);
      switchScreen(nextScreen);
      if (typeof navigator.vibrate === 'function') navigator.vibrate(10);
    } else if (dx > 50 && cur > 0) {
      // swipe right = prev
      var prevScreen = SCREENS_ORDER[cur - 1];
      var base = getBasePath ? getBasePath() : '';
      window.history.pushState(null, '', base ? base + '/' + prevScreen : '/' + prevScreen);
      switchScreen(prevScreen);
      if (typeof navigator.vibrate === 'function') navigator.vibrate(10);
    }
  }, { passive: true });
})();

// ── Auto-hide bottom nav on scroll (mobile) ──────────────
(function() {
  var content = document.querySelector('.app-content');
  var nav = document.querySelector('.bottom-nav');
  if (!content || !nav) return;

  var lastY = 0;
  var ticking = false;
  var mobileMql = window.matchMedia('(max-width: 959px)');

  function isMobileLayout() {
    return !!mobileMql.matches;
  }

  function showNav() {
    nav.classList.remove('nav-hidden');
  }

  function updateNav() {
    ticking = false;
    showNav();
    lastY = content.scrollTop || 0;
    if (!isMobileLayout()) return;
  }

  content.addEventListener('scroll', function() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(updateNav);
  }, { passive: true });

  content.addEventListener('touchend', function() {
    if ((content.scrollTop || 0) < 20) showNav();
  }, { passive: true });

  window.addEventListener('resize', showNav, { passive: true });
  window.addEventListener('orientationchange', showNav, { passive: true });
  window.addEventListener('popstate', showNav);
  if (typeof mobileMql.addEventListener === 'function') {
    mobileMql.addEventListener('change', showNav);
  } else if (typeof mobileMql.addListener === 'function') {
    mobileMql.addListener(showNav);
  }
})();

// ── NOTIFICATION CENTER ────────────────────────────────────────
(function() {
  var notifBtn    = document.getElementById('notifBtn');
  var notifPanel  = document.getElementById('notifPanel');
  var notifOverlay = document.getElementById('notifOverlay');
  var notifList   = document.getElementById('notifList');
  var notifBadge  = document.getElementById('notifBadge');
  var notifCloseBtn   = document.getElementById('notifCloseBtn');
  var notifMarkAllBtn = document.getElementById('notifMarkAllBtn');

  if (!notifBtn || !notifPanel || !notifOverlay) return;

  var ICON_MAP = {
    transfer_received: '💸',
    budget_exceeded:   '🚨',
    budget_warning:    '⚠️',
    goal_reached:      '🏆',
    recurring_done:    '🔄',
    info:              '🔔',
  };

  function relTime(dateStr) {
    var d   = new Date(dateStr);
    var now = Date.now();
    var s   = Math.floor((now - d.getTime()) / 1000);
    if (s < 60)  return 'щойно';
    if (s < 3600) return Math.floor(s/60) + ' хв. тому';
    if (s < 86400) return Math.floor(s/3600) + ' год. тому';
    return Math.floor(s/86400) + ' дн. тому';
  }

  function openNotifPanel() {
    if (notifPanel.classList.contains('open')) return;
    notifPanel.classList.add('open');
    notifOverlay.classList.add('open');
    lockBodyScroll('notif-panel');
    loadNotifications();
  }

  function closeNotifPanel() {
    notifPanel.classList.remove('open');
    notifOverlay.classList.remove('open');
    unlockBodyScroll('notif-panel');
  }

  notifBtn.addEventListener('click', openNotifPanel);
  notifCloseBtn.addEventListener('click', closeNotifPanel);
  notifOverlay.addEventListener('click', closeNotifPanel);

  notifMarkAllBtn.addEventListener('click', async function() {
    try {
      await api.request('/api/notifications/read-all', { method: 'POST' });
      await loadNotifications();
      updateBadge(0);
    } catch(e) {}
  });

  async function loadNotifications() {
    if (!notifList) return;
    try {
      var items = await api.request('/api/notifications');
      if (!items || !items.length) {
        notifList.innerHTML = '<div class="notif-empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg><span>Сповіщень немає</span></div>';
        return;
      }
      notifList.innerHTML = items.map(function(n) {
        var icon = n.icon || ICON_MAP[n.type] || '🔔';
        return '<div class="notif-item' + (n.is_read ? '' : ' unread') + '" data-id="' + n.id + '">' +
          '<div class="notif-icon">' + icon + '</div>' +
          '<div class="notif-body">' +
            '<div class="notif-title">' + escHtml(n.title) + '</div>' +
            (n.body ? '<div class="notif-text">' + escHtml(n.body) + '</div>' : '') +
            '<div class="notif-time">' + relTime(n.created_at) + '</div>' +
          '</div>' +
        '</div>';
      }).join('');

      notifList.querySelectorAll('.notif-item.unread').forEach(function(el) {
        el.addEventListener('click', async function() {
          var id = this.dataset.id;
          try {
            await api.request('/api/notifications/' + id + '/read', { method: 'POST' });
            this.classList.remove('unread');
            refreshBadge();
          } catch(e) {}
        });
      });
    } catch(e) {}
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function updateBadge(count) {
    if (!notifBadge) return;
    if (count > 0) {
      notifBadge.textContent = count > 99 ? '99+' : count;
      notifBadge.style.display = 'flex';
    } else {
      notifBadge.style.display = 'none';
    }
  }

  async function refreshBadge() {
    try {
      var res = await api.request('/api/notifications/unread-count');
      updateBadge(res && res.count ? res.count : 0);
    } catch(e) {}
  }

  var notifPollTimer = null;
  var notifVisibilityBound = false;

  function getNotifPollDelay() {
    var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    var saveData = !!conn && conn.saveData === true;
    var slowNetwork = !!conn && /2g/i.test(String(conn.effectiveType || ''));
    if (document.visibilityState !== 'visible') return 180000;
    if (saveData || slowNetwork) return 120000;
    return 60000;
  }

  function notifPollTick(force) {
    if (!api.token) {
      window._stopNotifPolling();
      return;
    }
    if (!force && document.visibilityState !== 'visible') return;
    if (navigator.onLine === false) return;
    refreshBadge();
  }

  function rescheduleNotifPolling() {
    if (notifPollTimer) {
      clearInterval(notifPollTimer);
      notifPollTimer = null;
    }
    if (!api.token) return;
    notifPollTimer = setInterval(function() {
      notifPollTick(false);
    }, getNotifPollDelay());
  }

  // Poll badge every 60 seconds once logged in
  window._startNotifPolling = function() {
    if (!api.token) return;
    notifPollTick(true);
    rescheduleNotifPolling();

    if (!notifVisibilityBound) {
      notifVisibilityBound = true;
      document.addEventListener('visibilitychange', function() {
        if (!api.token || !notifPollTimer) return;
        rescheduleNotifPolling();
        if (document.visibilityState === 'visible') notifPollTick(true);
      });
      window.addEventListener('online', function() {
        if (!api.token || !notifPollTimer) return;
        notifPollTick(true);
      }, { passive: true });
    }
  };

  window._stopNotifPolling = function() {
    if (!notifPollTimer) return;
    clearInterval(notifPollTimer);
    notifPollTimer = null;
  };
})();

// ── BUDGET PROGRESS WIDGET ──────────────────────────────────────
async function loadBudgetProgress() {
  var card = document.getElementById('budgetProgressCard');
  var list = document.getElementById('budgetProgressList');
  if (!card || !list) return;
  try {
    var limits = await api.request('/api/budget-limits');
    if (!limits || !limits.length) { card.style.display = 'none'; return; }
    var analytics = await api.request('/api/analytics/summary');
    var byType = {};
    ((analytics.by_type || [])).forEach(function(r) {
      if (r.direction === 'out') byType[r.tx_type] = parseFloat(r.total_out || r.total) || 0;
    });
    var TYPE_LABELS = { transfer: 'Перекази', donation: 'Благодійність', savings: 'Накопичення', topup: 'Поповнення' };
    list.innerHTML = limits.map(function(l) {
      var spent = byType[l.tx_type] || 0;
      var limit = parseFloat(l.monthly_limit) || 0;
      var pct = limit > 0 ? Math.min(100, Math.round(spent / limit * 100)) : 0;
      var cls = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : '';
      var label = TYPE_LABELS[l.tx_type] || l.tx_type;
      return '<div class="budget-progress-item">' +
        '<div class="bpi-row">' +
          '<span class="bpi-label">' + label + '</span>' +
          '<span class="bpi-amounts ' + cls + '">' +
            formatMoney(spent) + ' / ' + formatMoney(limit) +
          '</span>' +
        '</div>' +
        '<div class="bpi-bar"><div class="bpi-fill ' + cls + '" style="width:' + pct + '%"></div></div>' +
      '</div>';
    }).join('');
    card.style.display = '';
  } catch(e) {
    card.style.display = 'none';
  }
}

// ══════════════════════════════════════════════════════
// POLISH v3 — UX improvements
// ══════════════════════════════════════════════════════

// ── Balance animation on first login ─────────────────
(function() {
  var _origHandleAuth = window.handleAuth || handleAuth;
  window.handleAuth = async function(form, endpoint) {
    await _origHandleAuth(form, endpoint);
    // Animate balance from 0 after successful login
    setTimeout(function() {
      var bal = state.account ? parseFloat(state.account.balance || 0) : 0;
      var heroEl = document.getElementById('heroBalance');
      if (heroEl && bal > 0) animateCounter(heroEl, 0, bal, 1200);
    }, 400);
  };
})();

// ── Auto-save note/tags with debounce (1.5s) ─────────
(function() {
  var _noteTimer = null;
  var _tagsTimer = null;

  document.addEventListener('input', function(e) {
    if (e.target.id === 'drawerNoteInput') {
      clearTimeout(_noteTimer);
      _noteTimer = setTimeout(async function() {
        var txId = document.getElementById('drawerBody')?.dataset?.txId;
        if (!txId) return;
        var note = e.target.value || '';
        try {
          await api.request('/api/transactions/' + txId + '/note', { method: 'PATCH', body: JSON.stringify({ note: note }) });
          var btn = document.getElementById('saveNoteBtn');
          if (btn) {
            var orig = btn.textContent;
            btn.textContent = 'Збережено ✓';
            setTimeout(function() { if (btn) btn.textContent = orig; }, 1500);
          }
        } catch(_e) {}
      }, 1500);
    }
    if (e.target.id === 'drawerTagsInput') {
      clearTimeout(_tagsTimer);
      _tagsTimer = setTimeout(async function() {
        var txId = document.getElementById('drawerBody')?.dataset?.txId;
        if (!txId) return;
        var tags = e.target.value || '';
        try {
          await api.request('/api/transactions/' + txId + '/tags', { method: 'PATCH', body: JSON.stringify({ tags: tags }) });
        } catch(_e) {}
      }, 1500);
    }
  });

  // txId is now stored in body.dataset.txId inside openTxDrawer itself
})();

// ── Refresh button (R) visual feedback ───────────────
(function() {
  var _origKbR = null;
  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey) {
      var logoutBtn = document.getElementById('logoutBtn');
      if (logoutBtn) {
        logoutBtn.style.color = 'var(--accent)';
        setTimeout(function() { logoutBtn.style.color = ''; }, 300);
      }
    }
  }, true);
})();

console.log('[Army Bank] Polish v3 loaded — UX improvements');

// ══════════════════════════════════════════════════════════════
// ── CARDS MODULE ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

const CARD_STATUS_LABELS = { active: 'Активна', blocked: 'Заблокована', closed: 'Закрита' };
const CARD_TYPE_LABELS = { virtual: 'Віртуальна', physical: 'Фізична' };

function _cardDesignOptions() {
  return [
    { id: 'gold',   label: 'Gold' },
    { id: 'navy',   label: 'Navy' },
    { id: 'forest', label: 'Forest' },
    { id: 'camo',   label: 'Military' },
    { id: 'rose',   label: 'Rose' },
    { id: 'slate',  label: 'Slate' },
    { id: 'dark',   label: 'Dark' },
  ];
}

function _cardDesignStorageKey() {
  return 'ab_card_design_overrides_v1';
}

function _cardStatusClass(status) {
  return status === 'active' ? 'card-status-active' : status === 'blocked' ? 'card-status-blocked' : 'card-status-closed';
}

function _readCardDesignOverrides() {
  try {
    const raw = localStorage.getItem(_cardDesignStorageKey());
    const parsed = raw ? JSON.parse(raw) : {};
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (_) {
    return {};
  }
}

function _writeCardDesignOverrides(map) {
  try { localStorage.setItem(_cardDesignStorageKey(), JSON.stringify(map || {})); }
  catch (_) {}
}

function _isSupportedCardDesign(design) {
  return _cardDesignOptions().some((d) => d.id === design);
}

function _getEffectiveCardDesign(card) {
  const overrides = _readCardDesignOverrides();
  const fromStorage = overrides[String(card.id)];
  const resolved = fromStorage || card.design || 'gold';
  return _isSupportedCardDesign(resolved) ? resolved : 'gold';
}

function _setCardDesignOverride(cardId, design) {
  if (!_isSupportedCardDesign(design)) return;
  const map = _readCardDesignOverrides();
  map[String(cardId)] = design;
  _writeCardDesignOverrides(map);
}

function _getCardDesignLabel(design) {
  const m = _cardDesignOptions().find((d) => d.id === design);
  return m ? m.label : 'Gold';
}

function _renderCardDesignPalette(cardId, activeDesign, disabled) {
  return _cardDesignOptions().map((opt) => `
    <button
      type="button"
      class="cmi-design-dot design-${opt.id} ${opt.id === activeDesign ? 'active' : ''}"
      data-set-design="${cardId}"
      data-design="${opt.id}"
      aria-label="Стиль ${opt.label}"
      title="${opt.label}"
      ${disabled ? 'disabled' : ''}
    ></button>
  `).join('');
}

function renderCardItem(card) {
  const statusLabel = CARD_STATUS_LABELS[card.status] || card.status;
  const typeLabel = CARD_TYPE_LABELS[card.card_type] || card.card_type;
  const isActive = card.status === 'active';
  const isClosed = card.status === 'closed';
  const activeDesign = _getEffectiveCardDesign(card);
  const designLabel = _getCardDesignLabel(activeDesign);

  return `
    <div class="card-manage-item ${card.status}" data-card-id="${card.id}">
      <div class="cmi-visual">
        <div class="cmi-chip">
          <svg width="22" height="16" viewBox="0 0 22 16"><rect x="1" y="1" width="20" height="14" rx="3" fill="none" stroke="rgba(255,200,80,.6)" stroke-width="1.2"/>
            <line x1="1" y1="6" x2="21" y2="6" stroke="rgba(255,200,80,.4)" stroke-width="1"/>
            <line x1="1" y1="10" x2="21" y2="10" stroke="rgba(255,200,80,.4)" stroke-width="1"/>
            <line x1="8" y1="1" x2="8" y2="15" stroke="rgba(255,200,80,.4)" stroke-width="1"/>
            <line x1="14" y1="1" x2="14" y2="15" stroke="rgba(255,200,80,.4)" stroke-width="1"/>
          </svg>
        </div>
        <div class="cmi-number">${card.masked_number || card.card_number || '•••• •••• •••• ••••'}</div>
        <div class="cmi-meta">
          <span>${typeLabel}</span>
          <span>•</span>
          <span>дійсна до ${card.expiry_display || card.expires_at || '—'}</span>
        </div>
        <div class="cmi-design">
          <div class="cmi-design-head">
            <span class="cmi-design-label">Стиль: ${designLabel}</span>
          </div>
          <div class="cmi-design-palette">
            ${_renderCardDesignPalette(card.id, activeDesign, isClosed)}
          </div>
        </div>
      </div>
      <div class="cmi-right">
        <span class="cmi-status ${_cardStatusClass(card.status)}">${statusLabel}</span>
        <div class="cmi-actions">
          ${!isClosed ? `
            <button class="btn-card-action ${isActive ? 'btn-block' : 'btn-unblock'}" data-block-card="${card.id}" title="${isActive ? 'Заблокувати' : 'Розблокувати'}">
              ${isActive
                ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
                : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>'
              }
              ${isActive ? 'Заблокувати' : 'Розблокувати'}
            </button>
            <button class="btn-card-action btn-close-card" data-close-card="${card.id}" title="Закрити картку">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              Закрити
            </button>
          ` : '<span class="muted" style="font-size:11px">Картка закрита</span>'}
        </div>
      </div>
    </div>`;
}

async function loadCards() {
  const list = $('#cardsList');
  const emptyEl = $('#cardsEmpty');
  if (!list) return;
  list.classList.add('is-loading');
  list.classList.remove('is-empty', 'has-items');
  list.innerHTML = '<div class="loading-spinner-sm"></div>';
  if (emptyEl) emptyEl.classList.add('hidden');
  try {
    const cards = await api.request('/api/cards');
    const active = cards.filter(c => c.status !== 'closed');
    if (!cards.length) {
      list.classList.remove('is-loading', 'has-items');
      list.classList.add('is-empty');
      list.innerHTML = '';
      if (emptyEl) emptyEl.classList.remove('hidden');
    } else {
      list.classList.remove('is-loading', 'is-empty');
      list.classList.add('has-items');
      list.innerHTML = cards.map(renderCardItem).join('');
      bindCardActions();
    }
  } catch (e) {
    list.classList.remove('is-loading', 'has-items');
    list.classList.add('is-empty');
    list.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

function bindCardActions() {
  // Block / unblock
  $$('#cardsList [data-block-card]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const cardId = Number(btn.dataset.blockCard);
      const orig = btn.textContent.trim();
      btn.disabled = true;
      btn.textContent = '…';
      try {
        const result = await api.request(`/api/cards/${cardId}/block`, { method: 'PATCH' });
        const newStatus = result.status;
        showToast(newStatus === 'active' ? 'Картку розблоковано.' : 'Картку заблоковано.', newStatus === 'active' ? 'success' : '');
        loadCards();
        _updateBankCards().catch(function() {});
      } catch (e) {
        showToast(e.message);
        btn.disabled = false;
        btn.textContent = orig;
      }
    });
  });

  // Close card
  $$('#cardsList [data-close-card]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cardId = Number(btn.dataset.closeCard);
      confirmAction(
        'Закрити картку?',
        'Цю дію неможливо скасувати. Картка буде назавжди закрита.',
        async () => {
          try {
            await api.request(`/api/cards/${cardId}/close`, { method: 'PATCH' });
            showToast('Картку закрито.', '');
            loadCards();
            _updateBankCards().catch(function() {});
          } catch (e) {
            showToast(e.message);
          }
        }
      );
    });
  });

  // Design customization
  $$('#cardsList [data-set-design][data-design]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const cardId = Number(btn.dataset.setDesign);
      const design = (btn.dataset.design || '').trim();
      if (!cardId || !design || !_isSupportedCardDesign(design)) return;
      if (btn.classList.contains('active')) return;

      _setCardDesignOverride(cardId, design);
      _updateBankCards().catch(function() {});

      let savedOnServer = false;
      try {
        await api.request(`/api/cards/${cardId}`, {
          method: 'PATCH',
          body: JSON.stringify({ design: design }),
        });
        savedOnServer = true;
      } catch (_) {
        try {
          await api.request(`/api/cards/${cardId}/design`, {
            method: 'PATCH',
            body: JSON.stringify({ design: design }),
          });
          savedOnServer = true;
        } catch (_) {}
      }

      showToast(savedOnServer ? 'Дизайн картки оновлено.' : 'Дизайн застосовано локально.', 'success');
      loadCards();
    });
  });
}

// Issue card panel toggle
(function () {
  const issueBtn = $('#issueCardBtn');
  const panel = $('#issueCardPanel');
  const cancelBtn = $('#issueCardCancelBtn');
  if (issueBtn && panel) {
    issueBtn.addEventListener('click', () => panel.classList.toggle('hidden'));
  }
  if (cancelBtn && panel) {
    cancelBtn.addEventListener('click', () => panel.classList.add('hidden'));
  }
})();

// Issue card form submit
(function () {
  const form = $('#issueCardForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    setButtonLoading(btn, true);
    try {
      const data = Object.fromEntries(new FormData(form));
      await api.request('/api/cards', {
        method: 'POST',
        body: JSON.stringify({ card_type: data.card_type || 'virtual', design: data.design || 'gold' }),
      });
      showToast('Картку випущено!', 'success');
      form.reset();
      $('#issueCardPanel')?.classList.add('hidden');
      loadCards();
      _updateBankCards().catch(function() {});
    } catch (e) {
      showToast(e.message);
    } finally {
      setButtonLoading(btn, false);
    }
  });
})();

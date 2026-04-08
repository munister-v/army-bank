/* ════════════════════════════════════════════
   Army Bank — Messenger PWA
   Enhanced UX: filters, pinning, drafts, sync, actions
════════════════════════════════════════════ */
'use strict';

const BASE = window.ARMY_BANK_BASE || '';
const API = BASE + '/api';
const TOKEN_KEY = 'msng_token';
const USER_KEY = 'msng_user';
const PIN_KEY_PREFIX = 'msng_pins_';
const DRAFT_KEY_PREFIX = 'msng_drafts_';

const POLL_GLOBAL_ACTIVE_MS = 12000;
const POLL_GLOBAL_HIDDEN_MS = 28000;
const POLL_CONV_ACTIVE_MS = 2800;
const POLL_CONV_HIDDEN_MS = 8000;

// ── State ──────────────────────────────────
let token = localStorage.getItem(TOKEN_KEY) || null;
let me = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
let activeConvId = null;
let activePartner = null;
let lastMsgId = 0;
let convData = []; // [{id, partner, last_message_text, last_message_at, unread}]
let isLoadingOlder = false;
let noMoreOlder = false;
let globalPollTimer = null;
let convPollTimer = null;
let searchTimer = null;
let toastTimer = null;
let activeConvFilter = 'all';
let pinnedIds = new Set();
let drafts = {};

// ── DOM refs ───────────────────────────────
const authScreen = document.getElementById('auth-screen');
const app = document.getElementById('app');
const loginForm = document.getElementById('login-form');
const authIdentity = document.getElementById('auth-identity');
const authPassword = document.getElementById('auth-password');
const authError = document.getElementById('auth-error');
const btnLogin = document.getElementById('btn-login');
const btnLoginText = document.getElementById('btn-login-text');
const btnLoginSpin = document.getElementById('btn-login-spin');
const btnTogglePw = document.getElementById('btn-toggle-pw');
const sidebar = document.getElementById('sidebar');
const convList = document.getElementById('conv-list');
const convEmpty = document.getElementById('conv-empty');
const convSearch = document.getElementById('conv-search');
const convFilters = document.getElementById('conv-filters');
const sidebarUnread = document.getElementById('sidebar-unread');
const syncStatus = document.getElementById('sync-status');
const btnSync = document.getElementById('btn-sync');
const chatEmpty = document.getElementById('chat-empty');
const chatView = document.getElementById('chat-view');
const chatAvatar = document.getElementById('chat-avatar');
const chatPartnerName = document.getElementById('chat-partner-name');
const chatPartnerRole = document.getElementById('chat-partner-role');
const messagesWrap = document.getElementById('messages-wrap');
const messagesList = document.getElementById('messages-list');
const scrollAnchor = document.getElementById('scroll-anchor');
const msgInput = document.getElementById('msg-input');
const btnSend = document.getElementById('btn-send');
const btnBack = document.getElementById('btn-back');
const btnNewChat = document.getElementById('btn-new-chat');
const btnLogout = document.getElementById('btn-logout');
const newChatModal = document.getElementById('new-chat-modal');
const btnCloseModal = document.getElementById('btn-close-modal');
const userSearchInput = document.getElementById('user-search-input');
const userSearchResults = document.getElementById('user-search-results');
const searchHint = document.getElementById('search-hint');
const toast = document.getElementById('toast');

// ════════════════════════════════════════════
// API helpers
// ════════════════════════════════════════════
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (token) opts.headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) opts.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(API + path, opts);
  } catch (_) {
    throw new Error('Немає зʼєднання з сервером.');
  }

  const newToken = res.headers.get('X-Refresh-Token');
  if (newToken) {
    token = newToken;
    localStorage.setItem(TOKEN_KEY, token);
  }

  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    throw new Error('Помилка відповіді сервера.');
  }

  if (!res.ok || !data.ok) {
    throw new Error((data && data.error) || `Помилка ${res.status}`);
  }
  return data.data;
}

// ════════════════════════════════════════════
// Toast / status
// ════════════════════════════════════════════
function showToast(msg, isError = false) {
  toast.textContent = msg;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

function setSyncStatus(state = 'online', text = 'Синхронізовано') {
  if (!syncStatus) return;
  syncStatus.classList.remove('syncing', 'offline', 'error');
  if (state === 'syncing') syncStatus.classList.add('syncing');
  if (state === 'offline') syncStatus.classList.add('offline');
  if (state === 'error') syncStatus.classList.add('error');
  const textEl = syncStatus.querySelector('.sync-text');
  if (textEl) textEl.textContent = text;
}

// ════════════════════════════════════════════
// Local prefs: pins & drafts
// ════════════════════════════════════════════
function pinStoreKey() {
  return PIN_KEY_PREFIX + (me ? me.id : 'anon');
}

function draftStoreKey() {
  return DRAFT_KEY_PREFIX + (me ? me.id : 'anon');
}

function loadUserPrefs() {
  try {
    const rawPins = localStorage.getItem(pinStoreKey());
    const parsedPins = rawPins ? JSON.parse(rawPins) : [];
    pinnedIds = new Set(Array.isArray(parsedPins) ? parsedPins.map(Number) : []);
  } catch (_) {
    pinnedIds = new Set();
  }
  try {
    const rawDrafts = localStorage.getItem(draftStoreKey());
    const parsedDrafts = rawDrafts ? JSON.parse(rawDrafts) : {};
    drafts = parsedDrafts && typeof parsedDrafts === 'object' ? parsedDrafts : {};
  } catch (_) {
    drafts = {};
  }
}

function persistPins() {
  localStorage.setItem(pinStoreKey(), JSON.stringify(Array.from(pinnedIds)));
}

function persistDrafts() {
  localStorage.setItem(draftStoreKey(), JSON.stringify(drafts));
}

function saveDraft(convId, text) {
  if (!convId) return;
  const raw = String(text || '');
  if (!raw.trim()) {
    delete drafts[String(convId)];
  } else {
    drafts[String(convId)] = raw.slice(0, 4000);
  }
  persistDrafts();
}

function getDraft(convId) {
  return drafts[String(convId)] || '';
}

function persistActiveDraft() {
  if (activeConvId) saveDraft(activeConvId, msgInput.value);
}

function restoreDraft(convId) {
  msgInput.value = getDraft(convId);
  autoResizeInput();
  updateSendBtn();
}

// ════════════════════════════════════════════
// Auth
// ════════════════════════════════════════════
function setAuthLoading(loading) {
  btnLogin.disabled = loading;
  btnLoginText.hidden = loading;
  btnLoginSpin.hidden = !loading;
}

async function doLogin(e) {
  e.preventDefault();
  authError.hidden = true;
  const identity = authIdentity.value.trim();
  const password = authPassword.value;
  if (!identity || !password) {
    authError.textContent = 'Заповніть усі поля.';
    authError.hidden = false;
    return;
  }
  setAuthLoading(true);
  try {
    const data = await api('POST', '/auth/login', { identity, password });
    token = data.token;
    me = data.user;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(me));
    loadUserPrefs();
    showApp();
  } catch (err) {
    authError.textContent = err.message || 'Невірний логін або пароль.';
    authError.hidden = false;
  } finally {
    setAuthLoading(false);
  }
}

function doLogout() {
  api('POST', '/auth/logout').catch(() => {});
  token = null;
  me = null;
  activeConvId = null;
  clearPolling();
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  showAuth();
}

btnTogglePw.addEventListener('click', () => {
  const isText = authPassword.type === 'text';
  authPassword.type = isText ? 'password' : 'text';
  btnTogglePw.setAttribute('aria-label', isText ? 'Показати пароль' : 'Сховати пароль');
});

// ════════════════════════════════════════════
// Screen transitions
// ════════════════════════════════════════════
function showAuth() {
  authScreen.hidden = false;
  app.hidden = true;
  authIdentity.value = '';
  authPassword.value = '';
  authError.hidden = true;
  setSyncStatus('online', 'Очікує вхід');
}

async function showApp() {
  authScreen.hidden = true;
  app.hidden = false;
  loadUserPrefs();
  setSyncStatus(navigator.onLine ? 'syncing' : 'offline', navigator.onLine ? 'Завантаження...' : 'Немає мережі');
  await manualSync({ silentToast: true });
  startGlobalPoll();
}

// ════════════════════════════════════════════
// Conversations list
// ════════════════════════════════════════════
function normalizeConv(conv) {
  return {
    ...conv,
    unread: Number(conv.unread || 0),
    last_message_text: conv.last_message_text || '',
    last_message_at: conv.last_message_at || null,
  };
}

function convSortScore(conv) {
  const ts = conv.last_message_at ? Date.parse(conv.last_message_at) : 0;
  return Number.isFinite(ts) ? ts : 0;
}

function sortConversations(items) {
  return items.sort((a, b) => {
    const pinDiff = Number(pinnedIds.has(b.id)) - Number(pinnedIds.has(a.id));
    if (pinDiff !== 0) return pinDiff;
    return convSortScore(b) - convSortScore(a);
  });
}

async function loadConversations(opts = {}) {
  try {
    const rows = await api('GET', '/messenger/conversations');
    convData = sortConversations(rows.map(normalizeConv));
    renderConvList(convData);
    if (!opts.skipUnreadRefresh) await refreshUnreadCount({ silent: true });
    if (!opts.silentStatus) setSyncStatus(navigator.onLine ? 'online' : 'offline', navigator.onLine ? 'Синхронізовано' : 'Немає мережі');
  } catch (err) {
    if (err.message.includes('401') || err.message.includes('авторизац') || err.message.includes('сесі')) {
      doLogout();
      return;
    }
    if (!opts.silentStatus) setSyncStatus('error', 'Помилка синхронізації');
  }
}

function applyConvFilters(items) {
  const q = convSearch.value.trim().toLowerCase();
  let filtered = items;

  if (q) {
    filtered = filtered.filter(c => {
      const name = (c.partner && c.partner.full_name) ? c.partner.full_name.toLowerCase() : '';
      const phone = (c.partner && c.partner.phone) ? c.partner.phone.toLowerCase() : '';
      const preview = (c.last_message_text || '').toLowerCase();
      return name.includes(q) || phone.includes(q) || preview.includes(q);
    });
  }

  if (activeConvFilter === 'unread') {
    filtered = filtered.filter(c => (c.unread || 0) > 0);
  } else if (activeConvFilter === 'pinned') {
    filtered = filtered.filter(c => pinnedIds.has(c.id));
  }

  return filtered;
}

function updateEmptyState(filter) {
  const label = convEmpty.querySelector('p');
  if (!label) return;
  if (filter === 'unread') {
    label.innerHTML = 'Немає непрочитаних.<br/>Усе переглянуто.';
    return;
  }
  if (filter === 'pinned') {
    label.innerHTML = 'Немає закріплених чатів.<br/>Закріпіть важливі розмови.';
    return;
  }
  label.innerHTML = 'Немає розмов.<br/>Натисніть + щоб почати чат.';
}

function renderConvList(items) {
  const filtered = applyConvFilters(items);

  Array.from(convList.querySelectorAll('.conv-item')).forEach(el => el.remove());
  convEmpty.hidden = filtered.length > 0;
  updateEmptyState(activeConvFilter);

  filtered.forEach(conv => {
    const el = buildConvItem(conv);
    convList.appendChild(el);
    if (conv.id === activeConvId) el.classList.add('active');
  });
}

function setConvFilter(filter) {
  activeConvFilter = filter;
  if (convFilters) {
    convFilters.querySelectorAll('.conv-filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === filter);
    });
  }
  renderConvList(convData);
}

function buildConvItem(conv) {
  const el = document.createElement('div');
  el.className = 'conv-item';
  el.dataset.convId = conv.id;

  const name = conv.partner ? conv.partner.full_name : 'Невідомий';
  const initial = name.charAt(0);
  const preview = conv.last_message_text || 'Немає повідомлень';
  const time = conv.last_message_at ? formatTime(conv.last_message_at) : '';
  const unread = conv.unread || 0;
  const pinned = pinnedIds.has(conv.id);

  el.innerHTML = `
    <div class="conv-avatar">${escHtml(initial)}</div>
    <div class="conv-info">
      <div class="conv-name">${escHtml(name)}</div>
      <div class="conv-preview">${escHtml(preview)}</div>
    </div>
    <div class="conv-meta">
      <div class="conv-actions">
        <button class="conv-pin ${pinned ? 'active' : ''}" data-action="pin" title="${pinned ? 'Відкріпити чат' : 'Закріпити чат'}" aria-label="${pinned ? 'Відкріпити чат' : 'Закріпити чат'}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path d="M9 3h6l2 5-3 2v4l-4 7-1-8H6V10L3 8l2-5h4z"/>
          </svg>
        </button>
        ${unread > 0 ? `<span class="conv-unread">${unread > 99 ? '99+' : unread}</span>` : ''}
      </div>
      <span class="conv-time">${escHtml(time)}</span>
    </div>
  `;

  el.querySelector('[data-action="pin"]').addEventListener('click', evt => {
    evt.stopPropagation();
    togglePin(conv.id);
  });
  el.addEventListener('click', () => openChat(conv));
  return el;
}

function togglePin(convId) {
  if (pinnedIds.has(convId)) {
    pinnedIds.delete(convId);
    showToast('Чат відкріплено');
  } else {
    pinnedIds.add(convId);
    showToast('Чат закріплено');
  }
  persistPins();
  convData = sortConversations(convData);
  renderConvList(convData);
}

function updateConvItem(convId, patch) {
  const idx = convData.findIndex(c => c.id === convId);
  if (idx !== -1) {
    Object.assign(convData[idx], patch);
    convData = sortConversations(convData);
    renderConvList(convData);
  }
}

function upsertConversation(conv, opts = {}) {
  const item = normalizeConv(conv);
  const idx = convData.findIndex(c => c.id === item.id);
  if (idx === -1) convData.push(item);
  else convData[idx] = { ...convData[idx], ...item };
  convData = sortConversations(convData);
  renderConvList(convData);
  if (opts.open) openChat(item);
}

// ════════════════════════════════════════════
// Unread counter
// ════════════════════════════════════════════
async function refreshUnreadCount(opts = {}) {
  try {
    const data = await api('GET', '/messenger/unread');
    const unread = Number((data && data.unread) || 0);
    if (sidebarUnread) {
      sidebarUnread.hidden = unread <= 0;
      sidebarUnread.textContent = unread > 99 ? '99+' : String(unread);
    }
  } catch (_) {
    if (!opts.silent) setSyncStatus('error', 'Немає звʼязку');
  }
}

// ════════════════════════════════════════════
// Open chat
// ════════════════════════════════════════════
async function openChat(conv) {
  persistActiveDraft();

  if (window.innerWidth <= 680) sidebar.classList.add('hidden');

  activeConvId = conv.id;
  activePartner = conv.partner;
  lastMsgId = 0;
  noMoreOlder = false;

  const name = conv.partner ? conv.partner.full_name : 'Невідомий';
  const initial = name.charAt(0);
  chatAvatar.textContent = escHtml(initial);
  chatPartnerName.textContent = name;
  chatPartnerRole.textContent = roleLabel(conv.partner ? conv.partner.role : '');

  chatEmpty.hidden = true;
  chatView.hidden = false;

  document.querySelectorAll('.conv-item').forEach(el => {
    el.classList.toggle('active', Number(el.dataset.convId) === activeConvId);
  });

  messagesList.innerHTML = '';
  restoreDraft(activeConvId);

  await fetchMessages();
  startConvPoll();
}

// ════════════════════════════════════════════
// Messages
// ════════════════════════════════════════════
function firstMsgId() {
  const first = messagesList.querySelector('.msg-bubble-wrap[data-id]');
  return first ? Number(first.dataset.id) : 0;
}

function firstRenderedDateKey() {
  const first = messagesList.querySelector('.msg-bubble-wrap[data-date-key]');
  return first ? first.dataset.dateKey : '';
}

function lastRenderedDateKey() {
  const list = messagesList.querySelectorAll('.msg-bubble-wrap[data-date-key]');
  const last = list.length ? list[list.length - 1] : null;
  return last ? last.dataset.dateKey : '';
}

async function fetchMessages(prepend = false) {
  if (!activeConvId) return;
  try {
    const params = prepend && firstMsgId() > 0
      ? `?before_id=${firstMsgId()}&limit=30`
      : '?limit=50';

    const msgs = await api('GET', `/messenger/conversations/${activeConvId}/messages${params}`);

    if (!prepend) {
      messagesList.innerHTML = '';
      renderMessages(msgs, false);
      if (msgs.length) lastMsgId = msgs[msgs.length - 1].id;
      scrollToBottom(true);
    } else {
      if (msgs.length === 0) {
        noMoreOlder = true;
        return;
      }
      const prevFirst = messagesList.firstElementChild;
      renderMessages(msgs, true);
      if (prevFirst) prevFirst.scrollIntoView({ block: 'start' });
    }

    updateConvItem(activeConvId, { unread: 0 });
    await refreshUnreadCount({ silent: true });
  } catch (err) {
    console.error('[messenger] fetchMessages', err);
  }
}

function renderMessages(msgs, prepend = false) {
  let prevDate = prepend ? '' : lastRenderedDateKey();
  const boundaryDate = prepend ? firstRenderedDateKey() : '';
  const frag = document.createDocumentFragment();

  msgs.forEach((msg, idx) => {
    const d = new Date(msg.created_at);
    const dateKey = formatDateKey(d);
    const needDivider = dateKey !== prevDate;
    const skipBoundaryDivider = prepend && idx === msgs.length - 1 && dateKey === boundaryDate;

    if (needDivider && !skipBoundaryDivider) {
      const div = document.createElement('div');
      div.className = 'msg-date-divider';
      div.textContent = formatDate(d);
      frag.appendChild(div);
    }
    prevDate = dateKey;
    frag.appendChild(buildBubble(msg));
  });

  if (prepend) messagesList.insertBefore(frag, messagesList.firstChild);
  else messagesList.appendChild(frag);
}

function buildBubble(msg) {
  const isMe = msg.sender_id === (me && me.id);
  const wrap = document.createElement('div');
  wrap.className = `msg-bubble-wrap ${isMe ? 'me' : 'them'} ${msg.is_deleted ? '' : 'actionable'}`.trim();
  wrap.dataset.id = msg.id;
  wrap.dataset.dateKey = formatDateKey(new Date(msg.created_at));

  const name = msg.sender_name || '';
  const initial = name.charAt(0);
  const timeStr = formatTimeFromDate(new Date(msg.created_at));
  const isDeleted = Boolean(msg.is_deleted);
  const text = isDeleted ? 'Повідомлення видалено' : (msg.text || '');

  wrap.innerHTML = `
    ${!isMe ? `<div class="msg-sender-avatar">${escHtml(initial)}</div>` : ''}
    <div class="msg-inner">
      <div class="msg-bubble${isDeleted ? ' deleted' : ''}" data-text="${escHtml(text)}">${escHtml(text)}</div>
      <div class="msg-time">${timeStr}</div>
      ${!isDeleted ? `
      <div class="msg-actions">
        <button class="msg-action-btn copy" data-action="copy" type="button">Копія</button>
        ${isMe ? `<button class="msg-action-btn delete" data-action="delete" type="button">Видалити</button>` : ''}
      </div>
      ` : ''}
    </div>
    ${isMe ? '<div class="msg-sender-avatar" style="visibility:hidden"></div>' : ''}
  `;

  attachMessageActions(wrap, msg, isMe, isDeleted);
  return wrap;
}

function attachMessageActions(wrap, msg, isMe, isDeleted) {
  if (isDeleted) return;
  const bubble = wrap.querySelector('.msg-bubble');
  const copyBtn = wrap.querySelector('[data-action="copy"]');
  const delBtn = wrap.querySelector('[data-action="delete"]');

  const copy = () => copyMessageText(msg.text || '');
  if (copyBtn) copyBtn.addEventListener('click', evt => { evt.stopPropagation(); copy(); });
  if (bubble) bubble.addEventListener('dblclick', copy);

  if (delBtn && isMe) {
    delBtn.addEventListener('click', async evt => {
      evt.stopPropagation();
      await removeMessage(msg.id, wrap);
    });
  }

  // Mobile: long-press reveals actions
  let pressTimer = null;
  const clearPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  };

  wrap.addEventListener('touchstart', () => {
    clearPress();
    pressTimer = setTimeout(() => {
      wrap.classList.add('show-actions');
      setTimeout(() => wrap.classList.remove('show-actions'), 2400);
    }, 420);
  }, { passive: true });
  wrap.addEventListener('touchend', clearPress, { passive: true });
  wrap.addEventListener('touchcancel', clearPress, { passive: true });
}

async function copyMessageText(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast('Скопійовано');
  } catch (_) {
    showToast('Не вдалося скопіювати', true);
  }
}

async function removeMessage(msgId, wrap) {
  const ok = window.confirm('Видалити це повідомлення?');
  if (!ok) return;
  try {
    await api('DELETE', `/messenger/messages/${msgId}`);
    const bubble = wrap.querySelector('.msg-bubble');
    const actions = wrap.querySelector('.msg-actions');
    if (bubble) {
      bubble.classList.add('deleted');
      bubble.textContent = 'Повідомлення видалено';
    }
    if (actions) actions.remove();
    wrap.classList.remove('actionable');
    showToast('Повідомлення видалено');
    await loadConversations({ silentStatus: true });
  } catch (err) {
    showToast(err.message || 'Не вдалося видалити', true);
  }
}

async function sendMessage() {
  const text = msgInput.value.trim();
  if (!text || !activeConvId) return;

  msgInput.value = '';
  msgInput.style.height = 'auto';
  updateSendBtn();
  saveDraft(activeConvId, '');

  try {
    const msg = await api('POST', `/messenger/conversations/${activeConvId}/messages`, { text });
    appendMessage(msg);
    lastMsgId = msg.id;
    updateConvItem(activeConvId, {
      last_message_text: text,
      last_message_at: msg.created_at,
      unread: 0,
    });
    await refreshUnreadCount({ silent: true });
  } catch (err) {
    showToast(err.message, true);
    msgInput.value = text;
    autoResizeInput();
    updateSendBtn();
    saveDraft(activeConvId, text);
  }
}

function appendMessage(msg) {
  if (!msg || !msg.id) return;
  if (messagesList.querySelector(`.msg-bubble-wrap[data-id="${msg.id}"]`)) return;

  const frag = document.createDocumentFragment();
  const dateKey = formatDateKey(new Date(msg.created_at));
  const lastDate = lastRenderedDateKey();
  if (dateKey !== lastDate) {
    const div = document.createElement('div');
    div.className = 'msg-date-divider';
    div.textContent = formatDate(new Date(msg.created_at));
    frag.appendChild(div);
  }

  frag.appendChild(buildBubble(msg));
  messagesList.appendChild(frag);
  scrollToBottom(false);
}

// ════════════════════════════════════════════
// Polling
// ════════════════════════════════════════════
function globalPollDelay() {
  return document.hidden ? POLL_GLOBAL_HIDDEN_MS : POLL_GLOBAL_ACTIVE_MS;
}

function convPollDelay() {
  return document.hidden ? POLL_CONV_HIDDEN_MS : POLL_CONV_ACTIVE_MS;
}

function startGlobalPoll() {
  clearTimeout(globalPollTimer);
  const tick = async () => {
    await loadConversations({ silentStatus: true, skipUnreadRefresh: true });
    await refreshUnreadCount({ silent: true });
    globalPollTimer = setTimeout(tick, globalPollDelay());
  };
  globalPollTimer = setTimeout(tick, globalPollDelay());
}

function startConvPoll() {
  clearTimeout(convPollTimer);
  const tick = async () => {
    await pollNewMessages();
    convPollTimer = setTimeout(tick, convPollDelay());
  };
  convPollTimer = setTimeout(tick, convPollDelay());
}

function clearPolling() {
  clearTimeout(globalPollTimer);
  clearTimeout(convPollTimer);
}

async function pollNewMessages() {
  if (!activeConvId) return;
  try {
    const msgs = await api('GET', `/messenger/conversations/${activeConvId}/poll?after_id=${lastMsgId}`);
    if (msgs && msgs.length > 0) {
      msgs.forEach(msg => appendMessage(msg));
      lastMsgId = msgs[msgs.length - 1].id;
      updateConvItem(activeConvId, {
        last_message_text: msgs[msgs.length - 1].text,
        last_message_at: msgs[msgs.length - 1].created_at,
        unread: 0,
      });
      await refreshUnreadCount({ silent: true });
    }
  } catch (err) {
    if (err.message.includes('401')) doLogout();
  }
}

async function manualSync(opts = {}) {
  if (!token || !me) return;
  if (!navigator.onLine) {
    setSyncStatus('offline', 'Немає мережі');
    if (!opts.silentToast) showToast('Немає підключення до інтернету', true);
    return;
  }
  setSyncStatus('syncing', 'Оновлення...');
  try {
    await loadConversations({ silentStatus: true });
    if (activeConvId) await pollNewMessages();
    await refreshUnreadCount({ silent: true });
    setSyncStatus('online', 'Синхронізовано');
    if (!opts.silentToast) showToast('Оновлено');
  } catch (_) {
    setSyncStatus('error', 'Помилка синхронізації');
    if (!opts.silentToast) showToast('Не вдалося оновити', true);
  }
}

// ════════════════════════════════════════════
// New chat modal
// ════════════════════════════════════════════
function openNewChatModal() {
  newChatModal.hidden = false;
  userSearchInput.value = '';
  userSearchResults.innerHTML = '';
  searchHint.hidden = false;
  userSearchResults.appendChild(searchHint);
  setTimeout(() => userSearchInput.focus(), 50);
}

function closeNewChatModal() {
  newChatModal.hidden = true;
}

async function performUserSearch(q) {
  if (q.length < 2) {
    userSearchResults.innerHTML = '';
    searchHint.textContent = 'Введіть мінімум 2 символи';
    searchHint.hidden = false;
    userSearchResults.appendChild(searchHint);
    return;
  }
  try {
    const users = await api('GET', `/messenger/users/search?q=${encodeURIComponent(q)}`);
    userSearchResults.innerHTML = '';
    if (users.length === 0) {
      const p = document.createElement('p');
      p.className = 'search-hint';
      p.textContent = 'Нікого не знайдено.';
      userSearchResults.appendChild(p);
      return;
    }
    users.forEach(u => {
      const el = document.createElement('div');
      el.className = 'user-result-item';
      const initial = (u.full_name || '?').charAt(0);
      el.innerHTML = `
        <div class="user-result-avatar">${escHtml(initial)}</div>
        <div>
          <div class="user-result-name">${escHtml(u.full_name)}</div>
          <div class="user-result-meta">${escHtml(u.phone || '')}${u.account_number ? ' · ' + escHtml(u.account_number) : ''}</div>
        </div>
      `;
      el.addEventListener('click', () => startChatWith(u));
      userSearchResults.appendChild(el);
    });
  } catch (err) {
    showToast(err.message, true);
  }
}

async function startChatWith(user) {
  closeNewChatModal();
  try {
    const conv = await api('POST', '/messenger/conversations', { user_id: user.id });
    upsertConversation(conv, { open: true });
  } catch (err) {
    showToast(err.message, true);
  }
}

// ════════════════════════════════════════════
// Input handling
// ════════════════════════════════════════════
function updateSendBtn() {
  btnSend.disabled = msgInput.value.trim().length === 0;
}

function autoResizeInput() {
  msgInput.style.height = 'auto';
  msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';
}

// ════════════════════════════════════════════
// Scroll
// ════════════════════════════════════════════
function scrollToBottom(instant = false) {
  scrollAnchor.scrollIntoView({ behavior: instant ? 'auto' : 'smooth' });
}

function setupScrollLoadMore() {
  messagesWrap.addEventListener('scroll', async () => {
    if (messagesWrap.scrollTop < 80 && !isLoadingOlder && !noMoreOlder) {
      isLoadingOlder = true;
      await fetchMessages(true);
      isLoadingOlder = false;
    }
  });
}

// ════════════════════════════════════════════
// Utilities
// ════════════════════════════════════════════
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'вчора';
  if (diffDays < 7) return d.toLocaleDateString('uk-UA', { weekday: 'short' });
  return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
}

function formatTimeFromDate(d) {
  return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(d) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (msgDay.getTime() === today.getTime()) return 'Сьогодні';
  if (msgDay.getTime() === yesterday.getTime()) return 'Вчора';
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function roleLabel(role) {
  const map = {
    soldier: 'Військовослужбовець',
    operator: 'Оператор',
    admin: 'Адміністратор',
    platform_admin: 'Платформ-адмін',
  };
  return map[role] || role || '';
}

// ════════════════════════════════════════════
// Event listeners
// ════════════════════════════════════════════
loginForm.addEventListener('submit', doLogin);
btnLogout.addEventListener('click', doLogout);
if (btnSync) btnSync.addEventListener('click', () => manualSync());

btnNewChat.addEventListener('click', openNewChatModal);
btnCloseModal.addEventListener('click', closeNewChatModal);
newChatModal.addEventListener('click', e => {
  if (e.target === newChatModal) closeNewChatModal();
});

userSearchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => performUserSearch(userSearchInput.value.trim()), 350);
});

btnBack.addEventListener('click', () => {
  persistActiveDraft();
  sidebar.classList.remove('hidden');
  activeConvId = null;
  clearTimeout(convPollTimer);
  chatView.hidden = true;
  chatEmpty.hidden = false;
  document.querySelectorAll('.conv-item').forEach(el => el.classList.remove('active'));
});

msgInput.addEventListener('input', () => {
  autoResizeInput();
  updateSendBtn();
  if (activeConvId) saveDraft(activeConvId, msgInput.value);
});

msgInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

btnSend.addEventListener('click', sendMessage);
convSearch.addEventListener('input', () => renderConvList(convData));

if (convFilters) {
  convFilters.addEventListener('click', evt => {
    const btn = evt.target.closest('.conv-filter-btn');
    if (!btn) return;
    setConvFilter(btn.dataset.filter || 'all');
  });
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeNewChatModal();

  const meta = e.ctrlKey || e.metaKey;
  if (!meta) return;
  if (e.key.toLowerCase() === 'k') {
    e.preventDefault();
    convSearch.focus();
    convSearch.select();
  }
  if (e.key.toLowerCase() === 'n') {
    e.preventDefault();
    openNewChatModal();
  }
  if (e.key.toLowerCase() === 'r') {
    e.preventDefault();
    manualSync();
  }
});

document.addEventListener('visibilitychange', () => {
  if (!token || !me) return;
  startGlobalPoll();
  if (activeConvId) startConvPoll();
});

window.addEventListener('online', () => {
  setSyncStatus('online', 'Онлайн');
  manualSync({ silentToast: true });
});

window.addEventListener('offline', () => {
  setSyncStatus('offline', 'Немає мережі');
});

window.addEventListener('beforeunload', () => {
  persistActiveDraft();
});

setupScrollLoadMore();

if (token && me) {
  loadUserPrefs();
  showApp();
} else {
  showAuth();
}

// ── Service Worker registration ───────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw-messenger.js').catch(() => {});
  });
}

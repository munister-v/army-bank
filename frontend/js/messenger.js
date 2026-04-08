/* ════════════════════════════════════════════
   Army Bank — Messenger PWA
   Vanilla JS · Nummus Bank reference style
════════════════════════════════════════════ */
'use strict';

const BASE = window.ARMY_BANK_BASE || '';
const API  = BASE + '/api';
const TOKEN_KEY = 'msng_token';
const USER_KEY  = 'msng_user';

// ── State ──────────────────────────────────
let token        = localStorage.getItem(TOKEN_KEY) || null;
let me           = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
let activeConvId = null;
let activePartner= null;
let lastMsgId    = 0;
let convData     = [];
let isLoadingOlder = false;
let noMoreOlder    = false;
let globalPollTimer = null;
let convPollTimer   = null;
let searchTimer     = null;
let toastTimer      = null;

// ── DOM refs ───────────────────────────────
const $ = id => document.getElementById(id);
const authScreen    = $('auth-screen');
const app           = $('app');
const loginForm     = $('login-form');
const authIdentity  = $('auth-identity');
const authPassword  = $('auth-password');
const authError     = $('auth-error');
const btnLogin      = $('btn-login');
const btnLoginText  = $('btn-login-text');
const btnLoginSpin  = $('btn-login-spin');
const btnTogglePw   = $('btn-toggle-pw');
const sidebar       = $('sidebar');
const convList      = $('conv-list');
const convEmpty     = $('conv-empty');
const convSearch    = $('conv-search');
const chatEmpty     = $('chat-empty');
const chatView      = $('chat-view');
const chatAvatar    = $('chat-avatar');
const chatPartnerName = $('chat-partner-name');
const chatPartnerRole = $('chat-partner-role');
const messagesWrap  = $('messages-wrap');
const messagesList  = $('messages-list');
const scrollAnchor  = $('scroll-anchor');
const msgInput      = $('msg-input');
const btnSend       = $('btn-send');
const btnBack       = $('btn-back');
const btnNewChat    = $('btn-new-chat');
const btnLogout     = $('btn-logout');
const topbarAvatar  = $('topbar-avatar');
const unreadBadge   = $('unread-badge');
const newChatModal  = $('new-chat-modal');
const btnCloseModal = $('btn-close-modal');
const userSearchInput = $('user-search-input');
const userSearchResults = $('user-search-results');
const searchHint    = $('search-hint');
const toast         = $('toast');

// ════════════════════════════════════════════
// API helpers
// ════════════════════════════════════════════
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(API + path, opts);
  const newToken = res.headers.get('X-Refresh-Token');
  if (newToken) { token = newToken; localStorage.setItem(TOKEN_KEY, token); }

  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Помилка запиту');
  return data.data;
}

// ════════════════════════════════════════════
// Toast
// ════════════════════════════════════════════
function showToast(msg, isError = false) {
  toast.textContent = msg;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
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
    me    = data.user;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(me));
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
  token = null; me = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  clearPolling();
  showAuth();
}

btnTogglePw.addEventListener('click', () => {
  const isText = authPassword.type === 'text';
  authPassword.type = isText ? 'password' : 'text';
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
}

function showApp() {
  authScreen.hidden = true;
  app.hidden = false;
  if (me && topbarAvatar) topbarAvatar.textContent = (me.full_name || '?').charAt(0).toUpperCase();
  loadConversations();
  startGlobalPoll();
  pollUnreadBadge();
}

// ════════════════════════════════════════════
// Conversations list
// ════════════════════════════════════════════
async function loadConversations() {
  try {
    convData = await api('GET', '/messenger/conversations');
    renderConvList(convData);
  } catch (err) {
    if (err.message.includes('401') || err.message.includes('сесі')) doLogout();
  }
}

function renderConvList(items) {
  const q = convSearch.value.trim().toLowerCase();
  const filtered = q
    ? items.filter(c => c.partner && c.partner.full_name.toLowerCase().includes(q))
    : items;

  Array.from(convList.querySelectorAll('.conv-item')).forEach(el => el.remove());
  convEmpty.hidden = filtered.length > 0;

  filtered.forEach(conv => {
    const el = buildConvItem(conv);
    convList.appendChild(el);
    if (conv.id === activeConvId) el.classList.add('active');
  });
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

  el.innerHTML = `
    <div class="conv-avatar">${esc(initial)}</div>
    <div class="conv-info">
      <div class="conv-name">${esc(name)}</div>
      <div class="conv-preview">${esc(preview)}</div>
    </div>
    <div class="conv-meta">
      <span class="conv-time">${esc(time)}</span>
      ${unread > 0 ? `<span class="conv-unread">${unread > 99 ? '99+' : unread}</span>` : ''}
    </div>
  `;
  el.addEventListener('click', () => openChat(conv));
  return el;
}

function updateConvItem(convId, patch) {
  const idx = convData.findIndex(c => c.id === convId);
  if (idx !== -1) Object.assign(convData[idx], patch);
  renderConvList(convData);
}

// ════════════════════════════════════════════
// Open chat
// ════════════════════════════════════════════
async function openChat(conv) {
  if (window.innerWidth <= 720) sidebar.classList.add('hidden');

  activeConvId  = conv.id;
  activePartner = conv.partner;
  lastMsgId     = 0;
  noMoreOlder   = false;

  const name = conv.partner ? conv.partner.full_name : 'Невідомий';
  chatAvatar.textContent = esc(name.charAt(0));
  chatPartnerName.textContent = name;
  chatPartnerRole.textContent = roleLabel(conv.partner ? conv.partner.role : '');

  chatEmpty.hidden = true;
  chatView.hidden  = false;

  document.querySelectorAll('.conv-item').forEach(el => {
    el.classList.toggle('active', +el.dataset.convId === activeConvId);
  });

  messagesList.innerHTML = '';
  msgInput.value = '';
  updateSendBtn();
  await fetchMessages();
  startConvPoll();
}

// ════════════════════════════════════════════
// Messages
// ════════════════════════════════════════════
async function fetchMessages(prepend = false) {
  if (!activeConvId) return;
  try {
    const params = prepend && lastMsgId > 0
      ? `?before_id=${firstMsgId()}&limit=30`
      : '?limit=50';

    const msgs = await api('GET', `/messenger/conversations/${activeConvId}/messages${params}`);

    if (!prepend) {
      messagesList.innerHTML = '';
      renderMessages(msgs, false);
      if (msgs.length) lastMsgId = msgs[msgs.length - 1].id;
      scrollToBottom(true);
    } else {
      if (msgs.length === 0) { noMoreOlder = true; return; }
      const prevFirst = messagesList.firstElementChild;
      renderMessages(msgs, true);
      if (prevFirst) prevFirst.scrollIntoView({ block: 'start' });
    }
    updateConvItem(activeConvId, { unread: 0 });
  } catch (err) {
    console.error('[messenger] fetchMessages', err);
  }
}

function firstMsgId() {
  const first = messagesList.querySelector('.msg-bubble-wrap[data-id]');
  return first ? +first.dataset.id : 0;
}

function renderMessages(msgs, prepend = false) {
  let prevDate = null;
  const frag = document.createDocumentFragment();

  msgs.forEach(msg => {
    const d = new Date(msg.created_at);
    const dateStr = formatDate(d);
    if (dateStr !== prevDate) {
      const div = document.createElement('div');
      div.className = 'msg-date-divider';
      div.textContent = dateStr;
      frag.appendChild(div);
      prevDate = dateStr;
    }
    frag.appendChild(buildBubble(msg));
  });

  if (prepend) messagesList.insertBefore(frag, messagesList.firstChild);
  else messagesList.appendChild(frag);
}

function buildBubble(msg) {
  const isMe = msg.sender_id === (me && me.id);
  const wrap = document.createElement('div');
  wrap.className = `msg-bubble-wrap ${isMe ? 'me' : 'them'}`;
  wrap.dataset.id = msg.id;

  const name = msg.sender_name || '';
  const initial = name.charAt(0);
  const timeStr = formatTimeFromDate(new Date(msg.created_at));
  const isDeleted = msg.is_deleted;
  const text = isDeleted ? 'Повідомлення видалено' : msg.text;

  wrap.innerHTML = `
    ${!isMe ? `<div class="msg-sender-avatar">${esc(initial)}</div>` : ''}
    <div class="msg-inner">
      <div class="msg-bubble${isDeleted ? ' deleted' : ''}">${esc(text)}</div>
      <div class="msg-time">${timeStr}</div>
    </div>
  `;
  return wrap;
}

async function sendMessage() {
  const text = msgInput.value.trim();
  if (!text || !activeConvId) return;

  msgInput.value = '';
  msgInput.style.height = 'auto';
  updateSendBtn();

  try {
    const msg = await api('POST', `/messenger/conversations/${activeConvId}/messages`, { text });
    appendMessage(msg);
    lastMsgId = msg.id;
    updateConvItem(activeConvId, { last_message_text: text, last_message_at: msg.created_at });
  } catch (err) {
    showToast(err.message, true);
    msgInput.value = text;
    updateSendBtn();
  }
}

function appendMessage(msg) {
  const frag = document.createDocumentFragment();
  const d = new Date(msg.created_at);
  const dateStr = formatDate(d);

  const lastDivider = messagesList.querySelector('.msg-date-divider:last-of-type');
  if (!lastDivider || lastDivider.textContent !== dateStr) {
    const div = document.createElement('div');
    div.className = 'msg-date-divider';
    div.textContent = dateStr;
    frag.appendChild(div);
  }
  frag.appendChild(buildBubble(msg));
  messagesList.appendChild(frag);
  scrollToBottom(false);
}

// ════════════════════════════════════════════
// Polling
// ════════════════════════════════════════════
function startGlobalPoll() {
  clearInterval(globalPollTimer);
  globalPollTimer = setInterval(async () => {
    try { await loadConversations(); await pollUnreadBadge(); } catch (_) {}
  }, 15000);
}

function startConvPoll() {
  clearInterval(convPollTimer);
  convPollTimer = setInterval(pollNewMessages, 3000);
}

function clearPolling() {
  clearInterval(globalPollTimer);
  clearInterval(convPollTimer);
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
        last_message_at:   msgs[msgs.length - 1].created_at,
        unread: 0,
      });
    }
  } catch (err) { if (err.message.includes('401')) doLogout(); }
}

async function pollUnreadBadge() {
  try {
    const data = await api('GET', '/messenger/unread');
    if (unreadBadge) unreadBadge.hidden = !data.unread || data.unread === 0;
  } catch (_) {}
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

function closeNewChatModal() { newChatModal.hidden = true; }

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
        <div class="user-result-avatar">${esc(initial)}</div>
        <div>
          <div class="user-result-name">${esc(u.full_name)}</div>
          <div class="user-result-meta">${esc(u.phone || '')}${u.account_number ? ' · ' + u.account_number : ''}</div>
        </div>
      `;
      el.addEventListener('click', () => startChatWith(u));
      userSearchResults.appendChild(el);
    });
  } catch (err) { showToast(err.message, true); }
}

async function startChatWith(user) {
  closeNewChatModal();
  try {
    const conv = await api('POST', '/messenger/conversations', { user_id: user.id });
    const idx = convData.findIndex(c => c.id === conv.id);
    if (idx === -1) convData.unshift(conv);
    renderConvList(convData);
    openChat(conv);
  } catch (err) { showToast(err.message, true); }
}

// ════════════════════════════════════════════
// Input handling
// ════════════════════════════════════════════
function updateSendBtn() { btnSend.disabled = msgInput.value.trim().length === 0; }

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

// ════════════════════════════════════════════
// Utilities
// ════════════════════════════════════════════
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const now = new Date();
  const diff = Math.floor((now - d) / 86400000);
  if (diff === 0) return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  if (diff === 1) return 'вчора';
  if (diff < 7) return d.toLocaleDateString('uk-UA', { weekday: 'short' });
  return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
}

function formatTimeFromDate(d) {
  return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(d) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (msgDay.getTime() === today.getTime()) return 'Сьогодні';
  if (msgDay.getTime() === yesterday.getTime()) return 'Вчора';
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
}

function roleLabel(role) {
  const map = { soldier: 'Військовослужбовець', operator: 'Оператор', admin: 'Адміністратор', platform_admin: 'Платформ-адмін' };
  return map[role] || role || '';
}

// ════════════════════════════════════════════
// Scroll-to-load older
// ════════════════════════════════════════════
messagesWrap.addEventListener('scroll', async () => {
  if (messagesWrap.scrollTop < 80 && !isLoadingOlder && !noMoreOlder) {
    isLoadingOlder = true;
    await fetchMessages(true);
    isLoadingOlder = false;
  }
});

// ════════════════════════════════════════════
// Event listeners
// ════════════════════════════════════════════
loginForm.addEventListener('submit', doLogin);
btnLogout.addEventListener('click', doLogout);
btnNewChat.addEventListener('click', openNewChatModal);
btnCloseModal.addEventListener('click', closeNewChatModal);
newChatModal.addEventListener('click', e => { if (e.target === newChatModal) closeNewChatModal(); });

userSearchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => performUserSearch(userSearchInput.value.trim()), 350);
});

btnBack.addEventListener('click', () => {
  sidebar.classList.remove('hidden');
  activeConvId = null;
  clearInterval(convPollTimer);
  chatView.hidden = true;
  chatEmpty.hidden = false;
  document.querySelectorAll('.conv-item').forEach(el => el.classList.remove('active'));
});

msgInput.addEventListener('input', () => { autoResizeInput(); updateSendBtn(); });
msgInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
btnSend.addEventListener('click', sendMessage);
convSearch.addEventListener('input', () => renderConvList(convData));
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeNewChatModal(); });

// ════════════════════════════════════════════
// Boot
// ════════════════════════════════════════════
if (token && me) showApp();
else showAuth();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw-messenger.js').catch(() => {});
  });
}

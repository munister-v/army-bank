/* ════════════════════════════════════════════
   Army Bank — Messenger PWA
   groups · voice messages · WebRTC calls
════════════════════════════════════════════ */
'use strict';

const BASE = window.ARMY_BANK_BASE || '';
const API  = BASE + '/api';
const MESSENGER_ASSET_VERSION = '13';
const TOKEN_KEY = 'msng_token';
const USER_KEY  = 'msng_user';

// ── Auth state ─────────────────────────────
let token = localStorage.getItem(TOKEN_KEY) || null;
let me    = JSON.parse(localStorage.getItem(USER_KEY) || 'null');

// ── Chat state ─────────────────────────────
let activeConvId   = null;
let activePartner  = null;
let lastMsgId      = 0;
let convData       = [];
let isLoadingOlder = false;
let noMoreOlder    = false;

// ── Timers ─────────────────────────────────
let globalPollTimer    = null;
let convPollTimer      = null;
let searchTimer        = null;
let toastTimer         = null;
let groupSearchTimer   = null;
let incomingCheckTimer = null;
let callPollTimer      = null;
let callWallTimer      = null;

// ── Voice recording ────────────────────────
let mediaRecorder = null;
let audioChunks   = [];
let isRecording   = false;
let recSeconds    = 0;
let recTimer      = null;
let recordingShouldSend = true;
let recStartedAtMs = 0;
let recordStartInFlight = false;
let holdPointerActive = false;
let holdPointerId = null;
let cancelPendingStart = false;
let holdStartX = 0;
let holdCancelTriggered = false;
let recordRestartCooldownUntil = 0;
let recordCooldownToastAt = 0;
let activePhotoItems = [];
let activePhotoIndex = 0;
const photosByMessageId = new Map();
let photoGestureMode = 'idle'; // idle | swipe | pan | pinch
let photoSwipePointerId = null;
let photoSwipeStartX = 0;
let photoSwipeStartY = 0;
let photoSwipeLastX = 0;
let photoSwipeLastAt = 0;
let photoScale = 1;
let photoTranslateX = 0;
let photoTranslateY = 0;
let photoPanStartX = 0;
let photoPanStartY = 0;
let photoPanBaseX = 0;
let photoPanBaseY = 0;
let photoPinchStartDist = 0;
let photoPinchStartScale = 1;
const photoPointers = new Map();

// ── Call state ─────────────────────────────
let activeCallId       = null;
let peerConnection     = null;
let localStream        = null;
let callSeconds        = 0;
let icePollLastId      = 0;
let isMuted            = false;
let remoteSdpSet       = false;
let pendingLocalIce    = [];
let pendingRemoteIce   = [];
let incomingCallId     = null;
let incomingCallerName = '';
let callConnectedOnce  = false;

// ── Call audio state ───────────────────────
let callAudioCtx       = null;
let incomingToneTimer  = null;
let outgoingToneTimer  = null;
let callAudioPrimed    = false;

// ── Group state ────────────────────────────
let groupSelectedUsers = [];

// ── Auth mode ──────────────────────────────
let authMode = 'login'; // 'login' | 'register'

// ── DOM refs ───────────────────────────────
const $ = id => document.getElementById(id);
const authScreen        = $('auth-screen');
const appEl             = $('app');
const loginForm         = $('login-form');
const authIdentity      = $('auth-identity');
const authPassword      = $('auth-password');
const authError         = $('auth-error');
const btnLogin          = $('btn-login');
const btnLoginText      = $('btn-login-text');
const btnLoginSpin      = $('btn-login-spin');
const btnTogglePw       = $('btn-toggle-pw');
const sidebar           = $('sidebar');
const convList          = $('conv-list');
const convEmpty         = $('conv-empty');
const convSearch        = $('conv-search');
const chatEmpty         = $('chat-empty');
const chatView          = $('chat-view');
const chatAvatar        = $('chat-avatar');
const chatPartnerName   = $('chat-partner-name');
const chatPartnerRole   = $('chat-partner-role');
const messagesWrap      = $('messages-wrap');
const messagesList      = $('messages-list');
const scrollAnchor      = $('scroll-anchor');
const msgInput          = $('msg-input');
const btnSend           = $('btn-send');
const btnVoice          = $('btn-voice');
const btnAttachPhoto    = $('btn-attach-photo');
const inputPhoto        = $('input-photo');
const msgInputBar       = $('msg-input-bar');
const recordingIndicator= $('recording-indicator');
const recordingTime     = $('recording-time');
const recordingSwipeHint= $('recording-swipe-hint');
const btnCancelRecord   = $('btn-cancel-record');
const btnBack           = $('btn-back');
const btnNewChat        = $('btn-new-chat');
const btnLogout         = $('btn-logout');
const btnSidebarLogout  = $('btn-sidebar-logout');
const btnChatLogout     = $('btn-chat-logout');
const btnCall           = $('btn-call');
const topbarAvatar      = $('topbar-avatar');
const unreadBadge       = $('unread-badge');
const newChatModal      = $('new-chat-modal');
const btnCloseModal     = $('btn-close-modal');
const userSearchInput   = $('user-search-input');
const userSearchResults = $('user-search-results');
const searchHint        = $('search-hint');
const toast             = $('toast');
// Auth extra fields
const authFormTitle     = $('auth-form-title');
const authRegisterFields= $('auth-register-fields');
const authFullName      = $('auth-full-name');
const authPhone         = $('auth-phone');
const authSwitchBtn     = $('auth-switch-btn');
const authSwitchHint    = $('auth-switch-hint');
// Call UI
const callIncoming      = $('call-incoming');
const callCallerAvatar  = $('call-caller-avatar');
const callCallerName    = $('call-caller-name');
const btnAcceptCall     = $('btn-accept-call');
const btnRejectCall     = $('btn-reject-call');
const callScreen        = $('call-screen');
const callScreenAvatar  = $('call-screen-avatar');
const callScreenName    = $('call-screen-name');
const callScreenStatus  = $('call-screen-status');
const callScreenTimer   = $('call-screen-timer');
const btnMute           = $('btn-mute');
const btnEndCall        = $('btn-end-call');
const remoteAudio       = $('remote-audio');
const photoViewer       = $('photo-viewer');
const photoViewerImg    = $('photo-viewer-img');
const photoViewerCounter= $('photo-viewer-counter');
const btnPhotoClose     = $('btn-photo-close');
const btnPhotoPrev      = $('btn-photo-prev');
const btnPhotoNext      = $('btn-photo-next');
// Group / Modal UI
const tabDirect         = $('tab-direct');
const tabGroup          = $('tab-group');
const tabPanelDirect    = $('tab-panel-direct');
const tabPanelGroup     = $('tab-panel-group');
const groupNameInput    = $('group-name-input');
const groupUserSearch   = $('group-user-search');
const groupUserResults  = $('group-user-results');
const groupSelectedList = $('group-selected-list');
const btnCreateGroup    = $('btn-create-group');

// ════════════════════════════════════════════
// API helper
// ════════════════════════════════════════════
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body !== undefined) opts.body = JSON.stringify(body);
  let res;
  try {
    res = await fetch(API + path, opts);
  } catch (_err) {
    throw new Error('Мережа недоступна. Перевірте інтернет-з\'єднання.');
  }
  const newTok = res.headers.get('X-Refresh-Token');
  if (newTok) { token = newTok; localStorage.setItem(TOKEN_KEY, token); }
  const contentType = (res.headers.get('Content-Type') || '').toLowerCase();
  let data = null;
  if (contentType.includes('application/json')) {
    try { data = await res.json(); } catch (_) { data = null; }
  } else {
    const text = await res.text().catch(() => '');
    if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
    return null;
  }
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  if (!data?.ok) throw new Error(data?.error || 'Помилка запиту');
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
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

function syncOverlayLock() {
  const locked = (
    !!newChatModal && !newChatModal.hidden
  ) || (
    !!callIncoming && !callIncoming.hidden
  ) || (
    !!callScreen && !callScreen.hidden
  ) || (
    !!photoViewer && !photoViewer.hidden
  );
  document.documentElement.classList.toggle('overlay-lock', locked);
  document.body.classList.toggle('overlay-lock', locked);
}

// ════════════════════════════════════════════
// Auth — login + register
// ════════════════════════════════════════════
function setAuthMode(mode) {
  authMode = mode;
  const isReg = mode === 'register';
  if (authFormTitle)      authFormTitle.textContent = isReg ? 'Реєстрація' : 'Вхід';
  if (authRegisterFields) authRegisterFields.hidden = !isReg;
  if (btnLoginText)       btnLoginText.textContent  = isReg ? 'Зареєструватися' : 'Увійти';
  if (authSwitchHint)     authSwitchHint.textContent = isReg ? 'Вже є акаунт?' : 'Немає акаунту?';
  if (authSwitchBtn)      authSwitchBtn.textContent  = isReg ? 'Увійти' : 'Зареєструватися';
  if (authError)          authError.hidden = true;
  if (isReg && authFullName) authFullName.focus();
  else if (authIdentity)  authIdentity.focus();
}

if (authSwitchBtn) {
  authSwitchBtn.addEventListener('click', () =>
    setAuthMode(authMode === 'login' ? 'register' : 'login'));
}

function setAuthLoading(on) {
  btnLogin.disabled  = on;
  btnLoginText.hidden = on;
  btnLoginSpin.hidden = !on;
}

async function doLogin(e) {
  e.preventDefault();
  authError.hidden = true;

  if (authMode === 'register') { await doRegister(); return; }

  const identity = authIdentity.value.trim();
  const password = authPassword.value;
  if (!identity || !password) {
    authError.textContent = 'Заповніть усі поля.';
    authError.hidden = false; return;
  }
  setAuthLoading(true);
  try {
    const data = await api('POST', '/auth/login', { identity, password });
    token = data.token; me = data.user;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(me));
    showApp();
  } catch (err) {
    authError.textContent = err.message || 'Невірний логін або пароль.';
    authError.hidden = false;
  } finally { setAuthLoading(false); }
}

async function doRegister() {
  const fullName = (authFullName?.value || '').trim();
  const phone    = (authPhone?.value || '').trim();
  const identity = authIdentity.value.trim();
  const password = authPassword.value;

  if (!fullName || !identity || !password) {
    authError.textContent = 'Заповніть усі обов\'язкові поля.';
    authError.hidden = false; return;
  }
  if (password.length < 8) {
    authError.textContent = 'Пароль мінімум 8 символів.';
    authError.hidden = false; return;
  }

  setAuthLoading(true);
  try {
    // Determine if identity is email or phone
    const isEmail = identity.includes('@');
    const body = {
      full_name: fullName,
      password,
      ...(isEmail ? { email: identity } : { phone: identity }),
      ...(phone && !isEmail ? {} : phone ? { phone } : {}),
    };
    const data = await api('POST', '/auth/register', body);
    token = data.token; me = data.user;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(me));
    showToast('Акаунт створено! Ласкаво просимо.');
    showApp();
  } catch (err) {
    authError.textContent = err.message || 'Помилка реєстрації.';
    authError.hidden = false;
  } finally { setAuthLoading(false); }
}

function requestLogout() {
  const ok = window.confirm('Вийти з аккаунту месенджера?');
  if (!ok) return;
  doLogout();
}

function doLogout() {
  api('POST', '/auth/logout').catch(() => {});
  closeNewChatModal();
  closePhotoViewer();
  if (isRecording) stopRecording(false);
  token = null; me = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  clearPolling();
  clearInterval(incomingCheckTimer);
  hangupCall(false);
  showAuth();
}

btnTogglePw.addEventListener('click', () => {
  authPassword.type = authPassword.type === 'text' ? 'password' : 'text';
});

// ════════════════════════════════════════════
// Screen transitions
// ════════════════════════════════════════════
function showAuth() {
  authScreen.hidden = false;
  appEl.hidden = true;
  authIdentity.value = '';
  authPassword.value = '';
  if (authFullName) authFullName.value = '';
  if (authPhone)    authPhone.value = '';
  authError.hidden = true;
  setAuthMode('login');
  syncOverlayLock();
}

function showApp() {
  authScreen.hidden = true;
  appEl.hidden = false;
  if (me && topbarAvatar) topbarAvatar.textContent = initial(me.full_name);
  loadConversations();
  startGlobalPoll();
  pollUnreadBadge();
  startIncomingCallCheck();
  syncOverlayLock();
}

// ════════════════════════════════════════════
// Conversations
// ════════════════════════════════════════════
async function loadConversations() {
  try {
    convData = await api('GET', '/messenger/conversations');
    renderConvList(convData);
  } catch (err) {
    if (err.message.includes('401')) doLogout();
  }
}

function convName(conv) {
  return conv.is_group ? (conv.group_name || 'Група') : (conv.partner?.full_name || 'Невідомий');
}

function renderConvList(items) {
  const q = convSearch.value.trim().toLowerCase();
  const filtered = q ? items.filter(c => convName(c).toLowerCase().includes(q)) : items;
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
  const isGroup = !!conv.is_group;
  const name    = convName(conv);
  const preview = compactPreview(conv.last_message_text);
  const time    = conv.last_message_at ? formatTime(conv.last_message_at) : '';
  const unread  = conv.unread || 0;
  el.innerHTML = `
    <div class="conv-avatar${isGroup ? ' group' : ''}">${esc(initial(name))}</div>
    <div class="conv-info">
      <div class="conv-name">${esc(name)}</div>
      <div class="conv-preview">${esc(preview)}</div>
    </div>
    <div class="conv-meta">
      <span class="conv-time">${esc(time)}</span>
      ${unread > 0 ? `<span class="conv-unread">${unread > 99 ? '99+' : unread}</span>` : ''}
    </div>`;
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
  activePartner = conv.partner || null;
  lastMsgId     = 0;
  noMoreOlder   = false;

  const isGroup = !!conv.is_group;
  const name    = convName(conv);
  chatAvatar.textContent = esc(initial(name));
  chatAvatar.className   = 'chat-header-avatar' + (isGroup ? ' group' : '');
  chatPartnerName.textContent = name;
  chatPartnerRole.textContent = isGroup ? 'Групова розмова' : '';
  if (btnCall) btnCall.hidden = isGroup;

  chatEmpty.hidden = true;
  chatView.hidden  = false;
  document.querySelectorAll('.conv-item').forEach(el =>
    el.classList.toggle('active', +el.dataset.convId === activeConvId));

  messagesList.innerHTML = '';
  photosByMessageId.clear();
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
    const fid    = firstMsgId();
    const params = prepend && fid > 0 ? `?before_id=${fid}&limit=30` : '?limit=50';
    const msgs   = await api('GET', `/messenger/conversations/${activeConvId}/messages${params}`);
    if (!prepend) {
      messagesList.innerHTML = '';
      photosByMessageId.clear();
      renderMessages(msgs, false);
      if (msgs.length) lastMsgId = msgs[msgs.length - 1].id;
      scrollToBottom(true);
    } else {
      if (!msgs.length) { noMoreOlder = true; return; }
      const prevFirst = messagesList.firstElementChild;
      renderMessages(msgs, true);
      if (prevFirst) prevFirst.scrollIntoView({ block: 'start' });
    }
    updateConvItem(activeConvId, { unread: 0 });
  } catch (err) { console.error('[msg] fetch', err); }
}

function firstMsgId() {
  const el = messagesList.querySelector('.msg-bubble-wrap[data-id]');
  return el ? +el.dataset.id : 0;
}

function renderMessages(msgs, prepend = false) {
  let prevDate = null;
  const frag = document.createDocumentFragment();
  msgs.forEach(msg => {
    const d = new Date(msg.created_at);
    const ds = formatDate(d);
    if (ds !== prevDate) {
      const div = document.createElement('div');
      div.className = 'msg-date-divider';
      div.textContent = ds;
      frag.appendChild(div);
      prevDate = ds;
    }
    frag.appendChild(buildBubble(msg));
  });
  if (prepend) messagesList.insertBefore(frag, messagesList.firstChild);
  else messagesList.appendChild(frag);
}

function buildBubble(msg) {
  const isMe    = msg.sender_id === (me?.id);
  const wrap    = document.createElement('div');
  wrap.className = `msg-bubble-wrap ${isMe ? 'me' : 'them'}`;
  wrap.dataset.id = msg.id;

  const ini     = initial(msg.sender_name || '');
  const timeStr = formatTimeFromDate(new Date(msg.created_at));
  const msgType = msg.msg_type || 'text';
  const deleted = msg.is_deleted;

  let content;
  if (deleted) {
    content = `<div class="msg-bubble deleted">${esc('Повідомлення видалено')}</div>`;
  } else if (msgType === 'voice') {
    const src = `data:audio/webm;base64,${msg.text}`;
    content = `<div class="msg-bubble voice-bubble">
      <div class="voice-player">
        <div class="voice-player-head">
          <span class="voice-icon" aria-hidden="true">🎤</span>
          <span class="voice-title">Голосове повідомлення</span>
        </div>
        <div class="voice-wave" aria-hidden="true">
          <span></span><span></span><span></span><span></span><span></span>
        </div>
        <audio controls src="${src}" preload="metadata"></audio>
      </div>
    </div>`;
  } else if (msgType === 'image') {
    const imageItems = parseImagePayload(msg.text || '');
    photosByMessageId.set(String(msg.id), imageItems);
    if (!imageItems.length) {
      content = `<div class="msg-bubble">${esc('Фото недоступне')}</div>`;
    } else {
      const visibleItems = imageItems.slice(0, 4);
      const countClass = `count-${Math.min(visibleItems.length, 4)}`;
      const tiles = visibleItems.map((item, idx) => {
        const src = imageDataUrl(item);
        const tail = idx === 3 && imageItems.length > 4
          ? `<span class="photo-more">+${imageItems.length - 4}</span>`
          : '';
        return `<button type="button" class="photo-tile" data-photo-msg="${msg.id}" data-photo-index="${idx}" aria-label="Фото ${idx + 1}">
          <img class="photo-img" src="${esc(src)}" alt="Фото ${idx + 1}" loading="lazy" decoding="async"/>
          ${tail}
        </button>`;
      }).join('');
      content = `<div class="msg-bubble image-bubble"><div class="photo-stack ${countClass}">${tiles}</div></div>`;
    }
  } else {
    content = `<div class="msg-bubble">${esc(msg.text)}</div>`;
  }

  wrap.innerHTML = `
    ${!isMe ? `<div class="msg-sender-avatar">${esc(ini)}</div>` : ''}
    <div class="msg-inner">${content}<div class="msg-time">${timeStr}</div></div>`;
  if (!deleted && msgType === 'image') hydratePhotoTiles(wrap);
  return wrap;
}

function hydratePhotoTiles(root) {
  if (!root) return;
  const tiles = root.querySelectorAll('.photo-tile');
  tiles.forEach(tile => {
    const img = tile.querySelector('img');
    if (!(img instanceof HTMLImageElement)) return;
    tile.classList.add('loading');
    img.classList.remove('ready');
    const done = () => {
      tile.classList.remove('loading');
      tile.classList.add('ready');
      img.classList.add('ready');
    };
    const fail = () => {
      tile.classList.remove('loading');
      tile.classList.add('error');
    };
    if (img.complete && img.naturalWidth > 0) {
      done();
      return;
    }
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', fail, { once: true });
  });
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
    updateConvItem(activeConvId, {
      last_message_text: conversationPreview(msg),
      last_message_at: msg.created_at,
    });
  } catch (err) {
    showToast(err.message, true);
    msgInput.value = text;
    updateSendBtn();
  }
}

async function sendPhotos(files) {
  if (!activeConvId) { showToast('Спочатку відкрийте чат.', true); return; }
  const list = Array.from(files || [])
    .filter(f => /^image\//i.test(f.type || ''))
    .slice(0, 6);
  if (!list.length) return;
  showToast('Опрацьовую фото...');
  try {
    const items = [];
    for (const file of list) {
      const item = await preparePhotoItem(file);
      if (item) items.push(item);
    }
    if (!items.length) {
      showToast('Не вдалося підготувати фото.', true);
      return;
    }
    const payload = JSON.stringify({ v: 1, items });
    if (payload.length > 2_300_000) {
      showToast('Фото занадто важкі. Оберіть менше або менший розмір.', true);
      return;
    }
    const msg = await api('POST', `/messenger/conversations/${activeConvId}/messages`, {
      text: payload,
      msg_type: 'image',
    });
    appendMessage(msg);
    lastMsgId = msg.id;
    updateConvItem(activeConvId, {
      last_message_text: conversationPreview(msg),
      last_message_at: msg.created_at,
    });
    showToast('Фото надіслано');
  } catch (err) {
    showToast(err.message || 'Не вдалося надіслати фото.', true);
  }
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function preparePhotoItem(file) {
  const rawDataUrl = await readFileAsDataURL(file);
  const img = await loadImage(rawDataUrl);
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
  const height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, width, height);

  let quality = 0.86;
  let out = canvas.toDataURL('image/jpeg', quality);
  while (out.length > 750_000 && quality > 0.56) {
    quality -= 0.1;
    out = canvas.toDataURL('image/jpeg', quality);
  }
  const base64 = out.split(',')[1] || '';
  if (!base64) return null;
  return { mime: 'image/jpeg', data: base64, w: width, h: height };
}

function appendMessage(msg) {
  const frag = document.createDocumentFragment();
  const ds   = formatDate(new Date(msg.created_at));
  const last = messagesList.querySelector('.msg-date-divider:last-of-type');
  if (!last || last.textContent !== ds) {
    const div = document.createElement('div');
    div.className = 'msg-date-divider';
    div.textContent = ds;
    frag.appendChild(div);
  }
  frag.appendChild(buildBubble(msg));
  messagesList.appendChild(frag);
  scrollToBottom(false);
}

// ════════════════════════════════════════════
// Voice Recording
// ════════════════════════════════════════════
const MAX_REC_SECONDS = 90;
const MIN_REC_MS = 450;
const RECORD_RESTART_COOLDOWN_MS = 420;
const RECORD_COOLDOWN_TOAST_MS = 1200;
const PHOTO_SWIPE_THRESHOLD_PX = 56;

async function toggleRecording() {
  if (isRecording) { stopRecording(true); return; }
  await startRecording();
}

function holdCancelSwipeThresholdPx() {
  const vw = Math.max(320, Number(window.innerWidth || 0));
  return Math.max(56, Math.min(96, Math.round(vw * 0.18)));
}

function vibrate(pattern) {
  if (!navigator?.vibrate) return;
  try { navigator.vibrate(pattern); } catch (_) {}
}

function notifyRecordCooldown() {
  const now = Date.now();
  if ((now - recordCooldownToastAt) < RECORD_COOLDOWN_TOAST_MS) return;
  recordCooldownToastAt = now;
  showToast('Зачекайте мить перед новим записом');
}

async function startRecording() {
  if (recordStartInFlight || isRecording) return;
  if (Date.now() < recordRestartCooldownUntil) { notifyRecordCooldown(); return; }
  if (!activeConvId) { showToast('Спочатку відкрийте чат.', true); return; }
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    showToast('Мікрофон доступний лише по HTTPS.', true); return;
  }
  recordStartInFlight = true;

  // Pre-check permission
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach(t => t.stop());
  } catch (err) {
    recordStartInFlight = false;
    showToast(micError(err), true); return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    audioChunks  = [];
    recSeconds   = 0;
    recStartedAtMs = Date.now();

    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
      .find(t => MediaRecorder.isTypeSupported(t)) || '';
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      if (recordingShouldSend) sendVoiceMessage();
      else audioChunks = [];
    };
    mediaRecorder.start(200);
    isRecording = true;
    recordingShouldSend = true;
    btnVoice.classList.add('recording');
    setRecordingUI(true);
    vibrate(10);

    recTimer = setInterval(() => {
      recSeconds++;
      const m = String(Math.floor(recSeconds / 60)).padStart(2, '0');
      const s = String(recSeconds % 60).padStart(2, '0');
      if (recordingTime) recordingTime.textContent = `${m}:${s}`;
      btnVoice.title = `Зупинити · ${m}:${s}`;
      if (recSeconds >= MAX_REC_SECONDS) stopRecording(true);
    }, 1000);
  } catch (err) {
    showToast(micError(err), true);
  } finally {
    recordStartInFlight = false;
    if (cancelPendingStart && isRecording) {
      cancelPendingStart = false;
      stopRecording(false);
    }
  }
}

function stopRecording(shouldSend = true) {
  clearInterval(recTimer);
  isRecording = false;
  recordingShouldSend = shouldSend;
  recordRestartCooldownUntil = Date.now() + RECORD_RESTART_COOLDOWN_MS;
  holdPointerActive = false;
  holdPointerId = null;
  holdCancelTriggered = false;
  cancelPendingStart = false;
  btnVoice.classList.remove('recording');
  btnVoice.title = 'Утримуйте для запису';
  setRecordingUI(false);
  if (!shouldSend) vibrate([10, 24, 10]);
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
}

function handleVoicePointerDown(e) {
  if (e.button !== undefined && e.button !== 0) return;
  if (Date.now() < recordRestartCooldownUntil) { notifyRecordCooldown(); return; }
  e.preventDefault();
  holdPointerActive = true;
  holdPointerId = (e.pointerId ?? null);
  holdStartX = Number(e.clientX || 0);
  holdCancelTriggered = false;
  cancelPendingStart = false;
  if (btnVoice.setPointerCapture && holdPointerId !== null) {
    try { btnVoice.setPointerCapture(holdPointerId); } catch (_) {}
  }
  setSwipeProgress(0);
  startRecording().catch(() => {});
}

function handleVoicePointerUp(e) {
  if (!holdPointerActive) return;
  if (holdPointerId !== null && e.pointerId !== undefined && e.pointerId !== holdPointerId) return;
  e.preventDefault();
  holdPointerActive = false;
  holdPointerId = null;
  if (holdCancelTriggered) return;
  if (recordStartInFlight && !isRecording) {
    cancelPendingStart = true;
    return;
  }
  if (isRecording) stopRecording(true);
}

function handleVoicePointerCancel(e) {
  if (!holdPointerActive && !isRecording && !recordStartInFlight) return;
  if (holdPointerId !== null && e.pointerId !== undefined && e.pointerId !== holdPointerId) return;
  holdPointerActive = false;
  holdPointerId = null;
  if (recordStartInFlight && !isRecording) {
    cancelPendingStart = true;
    return;
  }
  if (isRecording) stopRecording(false);
}

function handleVoicePointerMove(e) {
  if (!holdPointerActive) return;
  if (holdPointerId !== null && e.pointerId !== undefined && e.pointerId !== holdPointerId) return;
  const dx = Number(e.clientX || holdStartX) - holdStartX; // swipe left => negative
  const leftDistance = Math.max(0, -dx);
  const progress = Math.min(1, leftDistance / holdCancelSwipeThresholdPx());
  setSwipeProgress(progress);
  if (progress >= 1 && !holdCancelTriggered) {
    holdCancelTriggered = true;
    showToast('Запис скасовано');
    handleVoicePointerCancel(e);
  }
}

async function sendVoiceMessage() {
  if (!audioChunks.length || !activeConvId) return;
  const blob = new Blob(audioChunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
  const durationMs = Date.now() - (recStartedAtMs || Date.now());
  if (durationMs < MIN_REC_MS) {
    showToast('Утримуйте кнопку довше для голосового.', true);
    vibrate([8, 22, 8]);
    return;
  }
  if (blob.size > 700_000) { showToast('Запис занадто великий (макс. ~90 с).', true); return; }
  const b64 = await blobToBase64(blob);
  try {
    const msg = await api('POST', `/messenger/conversations/${activeConvId}/messages`, {
      text: b64, msg_type: 'voice',
    });
    appendMessage(msg);
    lastMsgId = msg.id;
    updateConvItem(activeConvId, {
      last_message_text: conversationPreview(msg),
      last_message_at: msg.created_at,
    });
    vibrate([12, 28, 18]);
  } catch (err) { showToast(err.message, true); }
}

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

function setRecordingUI(on) {
  if (msgInputBar) msgInputBar.classList.toggle('recording-mode', on);
  if (recordingIndicator) recordingIndicator.hidden = !on;
  if (recordingTime && on) recordingTime.textContent = '00:00';
  if (recordingSwipeHint && on) recordingSwipeHint.textContent = 'Свайп ← для скасування';
  setSwipeProgress(0);
}

function setSwipeProgress(progress) {
  const clamped = Math.max(0, Math.min(1, Number(progress || 0)));
  if (recordingIndicator) {
    recordingIndicator.style.setProperty('--swipe-progress', String(clamped));
    recordingIndicator.classList.toggle('swiping', clamped > 0.01);
  }
  if (recordingSwipeHint) {
    if (clamped >= 1) recordingSwipeHint.textContent = 'Скасування...';
    else if (clamped > 0.2) recordingSwipeHint.textContent = 'Тягніть ще ←';
    else recordingSwipeHint.textContent = 'Свайп ← для скасування';
  }
}

// ════════════════════════════════════════════
// Polling
// ════════════════════════════════════════════
function startGlobalPoll() {
  clearInterval(globalPollTimer);
  loadConversations().catch(() => {});
  pollUnreadBadge().catch(() => {});
  globalPollTimer = setInterval(async () => {
    try { await loadConversations(); } catch (_) {}
    try { await pollUnreadBadge(); }  catch (_) {}
  }, 15000);
}

function startConvPoll() {
  clearInterval(convPollTimer);
  pollNewMessages().catch(() => {});
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
    if (msgs?.length > 0) {
      msgs.forEach(msg => appendMessage(msg));
      lastMsgId = msgs[msgs.length - 1].id;
      updateConvItem(activeConvId, {
        last_message_text: conversationPreview(msgs[msgs.length - 1]),
        last_message_at:   msgs[msgs.length - 1].created_at,
        unread: 0,
      });
    }
  } catch (err) { if (err.message.includes('401')) doLogout(); }
}

async function pollUnreadBadge() {
  try {
    const data = await api('GET', '/messenger/unread');
    unreadBadge.hidden = !data?.unread;
  } catch (_) {}
}

// ════════════════════════════════════════════
// Photo viewer
// ════════════════════════════════════════════
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function photoDistance(a, b) {
  return Math.hypot((a.x - b.x), (a.y - b.y));
}

function setPhotoDragX(px) {
  if (!photoViewerImg) return;
  photoViewerImg.style.setProperty('--pv-drag-x', `${Math.round(px)}px`);
}

function photoPanLimits() {
  if (!photoViewerImg) return { x: 0, y: 0 };
  const w = photoViewerImg.clientWidth || 0;
  const h = photoViewerImg.clientHeight || 0;
  const maxX = Math.max(0, ((w * photoScale) - w) * 0.5 + 10);
  const maxY = Math.max(0, ((h * photoScale) - h) * 0.5 + 10);
  return { x: maxX, y: maxY };
}

function clampPhotoPan() {
  const lim = photoPanLimits();
  photoTranslateX = clamp(photoTranslateX, -lim.x, lim.x);
  photoTranslateY = clamp(photoTranslateY, -lim.y, lim.y);
}

function applyPhotoTransform() {
  if (!photoViewerImg) return;
  clampPhotoPan();
  photoViewerImg.style.setProperty('--pv-scale', String(photoScale));
  photoViewerImg.style.setProperty('--pv-tx', `${Math.round(photoTranslateX)}px`);
  photoViewerImg.style.setProperty('--pv-ty', `${Math.round(photoTranslateY)}px`);
  photoViewerImg.classList.toggle('zoomed', photoScale > 1.01);
}

function resetPhotoTransform() {
  photoScale = 1;
  photoTranslateX = 0;
  photoTranslateY = 0;
  setPhotoDragX(0);
  applyPhotoTransform();
}

function setupPhotoPanFromPointer(pointerId) {
  const p = photoPointers.get(pointerId);
  if (!p) return;
  photoGestureMode = (photoScale > 1.01) ? 'pan' : 'swipe';
  photoSwipePointerId = pointerId;
  photoPanStartX = p.x;
  photoPanStartY = p.y;
  photoPanBaseX = photoTranslateX;
  photoPanBaseY = photoTranslateY;
  photoSwipeStartX = p.x;
  photoSwipeStartY = p.y;
  photoSwipeLastX = p.x;
  photoSwipeLastAt = Date.now();
}

function updatePhotoViewer() {
  if (!photoViewerImg || !photoViewerCounter) return;
  if (!activePhotoItems.length) {
    photoViewerImg.removeAttribute('src');
    photoViewerCounter.textContent = '0 / 0';
    return;
  }
  const idx = Math.max(0, Math.min(activePhotoItems.length - 1, activePhotoIndex));
  activePhotoIndex = idx;
  resetPhotoTransform();
  photoViewerImg.classList.remove('gesture-active');
  photoViewerImg.classList.add('loading');
  photoViewerImg.src = imageDataUrl(activePhotoItems[idx]);
  photoViewerCounter.textContent = `${idx + 1} / ${activePhotoItems.length}`;
  if (btnPhotoPrev) btnPhotoPrev.hidden = activePhotoItems.length < 2;
  if (btnPhotoNext) btnPhotoNext.hidden = activePhotoItems.length < 2;
  prefetchPhotoAroundIndex(idx);
}

function openPhotoViewer(items, startIndex = 0) {
  if (!photoViewer || !Array.isArray(items) || !items.length) return;
  activePhotoItems = items;
  activePhotoIndex = startIndex;
  updatePhotoViewer();
  photoViewer.hidden = false;
  photoGestureMode = 'idle';
  photoPointers.clear();
  syncOverlayLock();
}

function closePhotoViewer() {
  if (!photoViewer || photoViewer.hidden) return;
  photoViewer.hidden = true;
  activePhotoItems = [];
  activePhotoIndex = 0;
  photoGestureMode = 'idle';
  photoSwipePointerId = null;
  photoPointers.clear();
  if (photoViewerImg) {
    photoViewerImg.removeAttribute('src');
    photoViewerImg.classList.remove('gesture-active', 'drag-release');
  }
  resetPhotoTransform();
  syncOverlayLock();
}

function stepPhotoViewer(step) {
  if (!activePhotoItems.length) return;
  activePhotoIndex = (activePhotoIndex + step + activePhotoItems.length) % activePhotoItems.length;
  updatePhotoViewer();
}

function prefetchPhotoAroundIndex(idx) {
  if (!Array.isArray(activePhotoItems) || activePhotoItems.length < 2) return;
  const prev = activePhotoItems[(idx - 1 + activePhotoItems.length) % activePhotoItems.length];
  const next = activePhotoItems[(idx + 1) % activePhotoItems.length];
  [prev, next].forEach(item => {
    const img = new Image();
    img.src = imageDataUrl(item);
  });
}

function handlePhotoViewerPointerDown(e) {
  if (!photoViewer || photoViewer.hidden) return;
  if (!photoViewerImg || !(e.target instanceof Element) || !photoViewerImg.contains(e.target)) return;
  if (e.button !== undefined && e.button !== 0) return;
  const pointerId = e.pointerId ?? 0;
  photoPointers.set(pointerId, { x: Number(e.clientX || 0), y: Number(e.clientY || 0) });
  photoSwipePointerId = pointerId;
  setupPhotoPanFromPointer(pointerId);
  photoViewerImg.classList.add('gesture-active');
  if (photoViewerImg.setPointerCapture && photoSwipePointerId !== null) {
    try { photoViewerImg.setPointerCapture(photoSwipePointerId); } catch (_) {}
  }
  if (photoPointers.size >= 2) {
    const pts = Array.from(photoPointers.values());
    photoGestureMode = 'pinch';
    photoPinchStartDist = photoDistance(pts[0], pts[1]) || 1;
    photoPinchStartScale = photoScale;
    setPhotoDragX(0);
  }
}

function handlePhotoViewerPointerMove(e) {
  if (!photoViewer || photoViewer.hidden) return;
  const pointerId = e.pointerId ?? 0;
  if (!photoPointers.has(pointerId)) return;
  photoPointers.set(pointerId, { x: Number(e.clientX || 0), y: Number(e.clientY || 0) });

  if (photoPointers.size >= 2) {
    photoGestureMode = 'pinch';
  }

  if (photoGestureMode === 'pinch' && photoPointers.size >= 2) {
    e.preventDefault();
    const pts = Array.from(photoPointers.values());
    const dist = photoDistance(pts[0], pts[1]);
    const nextScale = clamp(photoPinchStartScale * (dist / (photoPinchStartDist || 1)), 1, 4);
    photoScale = nextScale;
    if (photoScale <= 1.01) {
      photoTranslateX = 0;
      photoTranslateY = 0;
    }
    applyPhotoTransform();
    return;
  }

  if (photoSwipePointerId !== pointerId) return;
  const p = photoPointers.get(pointerId);
  if (!p) return;

  if (photoGestureMode === 'pan' && photoScale > 1.01) {
    e.preventDefault();
    photoTranslateX = photoPanBaseX + (p.x - photoPanStartX);
    photoTranslateY = photoPanBaseY + (p.y - photoPanStartY);
    applyPhotoTransform();
    return;
  }

  if (photoGestureMode !== 'swipe') return;
  const dx = p.x - photoSwipeStartX;
  const dy = p.y - photoSwipeStartY;
  if (Math.abs(dx) <= Math.abs(dy) * 0.92) return;
  e.preventDefault();
  const drag = clamp(dx, -180, 180);
  setPhotoDragX(drag * 0.95);
  photoSwipeLastX = p.x;
  photoSwipeLastAt = Date.now();
}

function finishSwipeGesture(finalX, finalY) {
  const now = Date.now();
  const dx = Number(finalX || 0) - photoSwipeStartX;
  const dy = Number(finalY || 0) - photoSwipeStartY;
  const dt = Math.max(16, now - (photoSwipeLastAt || now));
  const vx = (Number(finalX || 0) - Number(photoSwipeLastX || photoSwipeStartX)) / dt; // px/ms
  let direction = 0;
  if (Math.abs(dx) > Math.abs(dy) * 1.1) {
    if (dx <= -PHOTO_SWIPE_THRESHOLD_PX || vx <= -0.55) direction = 1;
    if (dx >= PHOTO_SWIPE_THRESHOLD_PX || vx >= 0.55) direction = -1;
  }

  if (direction !== 0 && activePhotoItems.length > 1) {
    setPhotoDragX(direction > 0 ? -220 : 220);
    requestAnimationFrame(() => stepPhotoViewer(direction));
  } else {
    if (photoViewerImg) {
      photoViewerImg.classList.add('drag-release');
      setTimeout(() => photoViewerImg.classList.remove('drag-release'), 220);
    }
    setPhotoDragX(0);
  }
}

function handlePhotoViewerPointerEnd(e) {
  const pointerId = e.pointerId ?? 0;
  const p = photoPointers.get(pointerId) || { x: Number(e.clientX || 0), y: Number(e.clientY || 0) };
  const wasPrimary = (photoSwipePointerId === pointerId);
  photoPointers.delete(pointerId);

  if (photoGestureMode === 'pinch') {
    if (photoPointers.size >= 2) {
      const pts = Array.from(photoPointers.values());
      photoPinchStartDist = photoDistance(pts[0], pts[1]) || 1;
      photoPinchStartScale = photoScale;
      return;
    }
    if (photoPointers.size === 1) {
      const remId = Array.from(photoPointers.keys())[0];
      setupPhotoPanFromPointer(remId);
      if (photoScale <= 1.01) photoGestureMode = 'swipe';
      return;
    }
    if (photoScale <= 1.01) resetPhotoTransform();
    photoGestureMode = 'idle';
    photoSwipePointerId = null;
    if (photoViewerImg) photoViewerImg.classList.remove('gesture-active');
    return;
  }

  if (photoGestureMode === 'pan') {
    if (photoPointers.size === 1) {
      const remId = Array.from(photoPointers.keys())[0];
      setupPhotoPanFromPointer(remId);
      return;
    }
    photoGestureMode = 'idle';
    photoSwipePointerId = null;
    if (photoViewerImg) photoViewerImg.classList.remove('gesture-active');
    return;
  }

  if (photoGestureMode === 'swipe' && wasPrimary) {
    finishSwipeGesture(p.x, p.y);
    photoGestureMode = 'idle';
    photoSwipePointerId = null;
    if (photoViewerImg) photoViewerImg.classList.remove('gesture-active');
    return;
  }

  if (photoPointers.size === 0) {
    photoGestureMode = 'idle';
    photoSwipePointerId = null;
    if (photoViewerImg) photoViewerImg.classList.remove('gesture-active');
  }
}

function handlePhotoViewerPointerCancel(e) {
  const pointerId = e.pointerId ?? 0;
  photoPointers.delete(pointerId);
  if (photoPointers.size === 0) {
    if (photoGestureMode === 'swipe') {
      setPhotoDragX(0);
    }
    photoGestureMode = 'idle';
    photoSwipePointerId = null;
    if (photoScale <= 1.01) resetPhotoTransform();
    if (photoViewerImg) photoViewerImg.classList.remove('gesture-active');
  }
}

// ════════════════════════════════════════════
// New chat modal
// ════════════════════════════════════════════
function openNewChatModal() {
  newChatModal.hidden = false;
  syncOverlayLock();
  switchTab('direct');
  userSearchInput.value = '';
  userSearchResults.innerHTML = '';
  searchHint.hidden = false;
  userSearchResults.appendChild(searchHint);
  setTimeout(() => userSearchInput.focus(), 50);
}

function closeNewChatModal() {
  newChatModal.hidden = true;
  syncOverlayLock();
}

function switchTab(tab) {
  const isDirect = tab === 'direct';
  tabDirect.classList.toggle('active', isDirect);
  tabGroup.classList.toggle('active', !isDirect);
  tabPanelDirect.hidden = !isDirect;
  tabPanelGroup.hidden  = isDirect;
  if (!isDirect) setTimeout(() => groupNameInput.focus(), 50);
}

tabDirect.addEventListener('click', () => switchTab('direct'));
tabGroup.addEventListener('click',  () => switchTab('group'));

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
    if (!users.length) {
      userSearchResults.innerHTML = '<p class="search-hint">Нікого не знайдено.</p>'; return;
    }
    users.forEach(u => {
      const el = document.createElement('div');
      el.className = 'user-result-item';
      el.innerHTML = `
        <div class="user-result-avatar">${esc(initial(u.full_name))}</div>
        <div>
          <div class="user-result-name">${esc(u.full_name)}</div>
          <div class="user-result-meta">${esc(u.phone || '')}${u.account_number ? ' · ' + u.account_number : ''}</div>
        </div>`;
      el.addEventListener('click', () => startChatWith(u));
      userSearchResults.appendChild(el);
    });
  } catch (err) { showToast(err.message, true); }
}

async function startChatWith(user) {
  closeNewChatModal();
  try {
    const conv = await api('POST', '/messenger/conversations', { user_id: user.id });
    if (!convData.find(c => c.id === conv.id)) convData.unshift(conv);
    renderConvList(convData);
    openChat(conv);
  } catch (err) { showToast(err.message, true); }
}

// ── Group creation ─────────────────────────
async function performGroupUserSearch(q) {
  if (q.length < 2) {
    groupUserResults.innerHTML = '<p class="search-hint">Введіть ім\'я для пошуку</p>'; return;
  }
  try {
    const users = await api('GET', `/messenger/users/search?q=${encodeURIComponent(q)}`);
    groupUserResults.innerHTML = '';
    if (!users.length) {
      groupUserResults.innerHTML = '<p class="search-hint">Нікого не знайдено.</p>'; return;
    }
    users.forEach(u => {
      if (groupSelectedUsers.find(s => s.id === u.id)) return;
      const el = document.createElement('div');
      el.className = 'user-result-item';
      el.innerHTML = `
        <div class="user-result-avatar">${esc(initial(u.full_name))}</div>
        <div>
          <div class="user-result-name">${esc(u.full_name)}</div>
          <div class="user-result-meta">${esc(u.phone || '')}</div>
        </div>`;
      el.addEventListener('click', () => addGroupMember(u));
      groupUserResults.appendChild(el);
    });
  } catch (err) { showToast(err.message, true); }
}

function addGroupMember(u) {
  if (groupSelectedUsers.find(s => s.id === u.id)) return;
  groupSelectedUsers.push(u);
  renderGroupChips();
  groupUserSearch.value = '';
  groupUserResults.innerHTML = '<p class="search-hint">Введіть ім\'я для пошуку</p>';
}

function removeGroupMember(uid) {
  groupSelectedUsers = groupSelectedUsers.filter(u => u.id !== uid);
  renderGroupChips();
}

function renderGroupChips() {
  groupSelectedList.innerHTML = '';
  groupSelectedUsers.forEach(u => {
    const chip = document.createElement('div');
    chip.className = 'group-chip';
    chip.innerHTML = `${esc(u.full_name)}<button data-uid="${u.id}" title="Видалити">×</button>`;
    chip.querySelector('button').addEventListener('click', () => removeGroupMember(u.id));
    groupSelectedList.appendChild(chip);
  });
}

async function createGroup() {
  const name = groupNameInput.value.trim();
  if (!name)                      { showToast('Введіть назву групи.', true); return; }
  if (!groupSelectedUsers.length) { showToast('Додайте хоча б одного учасника.', true); return; }
  try {
    const conv = await api('POST', '/messenger/groups', {
      name, member_ids: groupSelectedUsers.map(u => u.id),
    });
    closeNewChatModal();
    groupSelectedUsers = [];
    renderGroupChips();
    groupNameInput.value = '';
    if (!convData.find(c => c.id === conv.id)) convData.unshift(conv);
    renderConvList(convData);
    openChat(conv);
  } catch (err) { showToast(err.message, true); }
}

// ════════════════════════════════════════════
// WebRTC Calls
// ════════════════════════════════════════════
const STUN_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

function checkWebRTCSupport() {
  if (!window.RTCPeerConnection) {
    showToast('WebRTC не підтримується цим браузером.', true); return false;
  }
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    showToast('Дзвінки доступні лише по HTTPS.', true); return false;
  }
  return true;
}

async function ensureCallAudioCtx() {
  if (!window.AudioContext && !window.webkitAudioContext) return null;
  if (!callAudioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    callAudioCtx = new Ctx();
  }
  if (callAudioCtx.state === 'suspended') {
    try { await callAudioCtx.resume(); } catch (_) {}
  }
  callAudioPrimed = callAudioCtx.state === 'running';
  return callAudioCtx;
}

function toneBeep(freq = 440, duration = 0.12, opts = {}) {
  const ctx = callAudioCtx;
  if (!ctx || ctx.state !== 'running') return;
  const waveform = opts.wave || 'sine';
  const gainV = Number.isFinite(opts.gain) ? opts.gain : 0.028;
  const delay = Number.isFinite(opts.delay) ? opts.delay : 0;
  const now = ctx.currentTime + Math.max(0, delay);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = waveform;
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(gainV, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.03);
}

function stopIncomingTone() {
  if (incomingToneTimer) {
    clearInterval(incomingToneTimer);
    incomingToneTimer = null;
  }
  if (navigator.vibrate) navigator.vibrate(0);
}

function stopOutgoingTone() {
  if (outgoingToneTimer) {
    clearInterval(outgoingToneTimer);
    outgoingToneTimer = null;
  }
}

function stopAllCallTones() {
  stopIncomingTone();
  stopOutgoingTone();
}

function playConnectedTone() {
  toneBeep(740, 0.09, { gain: 0.024 });
  toneBeep(980, 0.11, { gain: 0.024, delay: 0.11 });
}

function playEndTone(error = false) {
  if (error) {
    toneBeep(320, 0.12, { wave: 'square', gain: 0.03 });
    toneBeep(240, 0.14, { wave: 'square', gain: 0.03, delay: 0.14 });
    return;
  }
  toneBeep(520, 0.11, { gain: 0.024 });
  toneBeep(390, 0.13, { gain: 0.024, delay: 0.12 });
}

async function startIncomingTone() {
  stopOutgoingTone();
  await ensureCallAudioCtx();

  const ringBurst = () => {
    toneBeep(760, 0.12, { gain: 0.03 });
    toneBeep(930, 0.15, { gain: 0.03, delay: 0.18 });
  };
  ringBurst();
  incomingToneTimer = setInterval(ringBurst, 2200);
  if (navigator.vibrate) navigator.vibrate([130, 90, 130]);
}

async function startOutgoingTone() {
  stopIncomingTone();
  await ensureCallAudioCtx();

  const ringback = () => {
    toneBeep(430, 0.32, { wave: 'triangle', gain: 0.022 });
    toneBeep(480, 0.32, { wave: 'triangle', gain: 0.016, delay: 0.02 });
  };
  ringback();
  outgoingToneTimer = setInterval(ringback, 1000);
}

function normalizeSdp(raw, label = 'SDP') {
  let sdp = raw;

  if (sdp && typeof sdp === 'object' && typeof sdp.sdp === 'string') {
    sdp = sdp.sdp;
  }

  if (typeof sdp !== 'string') sdp = String(sdp || '');
  sdp = sdp.trim();
  if (!sdp) throw new Error(`${label} порожній.`);

  // Legacy compatibility: some clients stored JSON wrapper or escaped newlines.
  if (sdp[0] === '{' || sdp[0] === '"') {
    try {
      const parsed = JSON.parse(sdp);
      if (parsed && typeof parsed.sdp === 'string') sdp = parsed.sdp;
      else if (typeof parsed === 'string') sdp = parsed;
    } catch (_) {}
  }

  if (sdp.includes('\\r\\n')) sdp = sdp.replace(/\\r\\n/g, '\r\n');
  if (sdp.includes('\\n') && !sdp.includes('\n')) sdp = sdp.replace(/\\n/g, '\n');
  sdp = sdp.replace(/\r?\n/g, '\r\n').trim();

  if (!/^v=0(?:\r\n|\n)/.test(sdp)) {
    throw new Error(`Некоректний формат ${label.toLowerCase()}.`);
  }
  return sdp;
}

function buildPeerConnection() {
  const pc = new RTCPeerConnection(STUN_SERVERS);

  pc.ontrack = e => {
    if (remoteAudio.srcObject !== e.streams[0]) remoteAudio.srcObject = e.streams[0];
  };

  pc.onicecandidate = e => {
    if (!e.candidate) return;
    const cand = e.candidate.toJSON();
    if (activeCallId) {
      api('POST', `/messenger/calls/${activeCallId}/ice`, { candidate: cand }).catch(() => {});
    } else {
      pendingLocalIce.push(cand);
    }
  };

  pc.oniceconnectionstatechange = () => {
    const st = pc.iceConnectionState;
    if (st === 'connected' || st === 'completed') {
      callScreenStatus.textContent = 'Підключено';
      stopAllCallTones();
      if (!callConnectedOnce) {
        callConnectedOnce = true;
        playConnectedTone();
      }
      if (!callWallTimer) startCallTimer();
    } else if (st === 'disconnected') {
      callScreenStatus.textContent = 'Відновлення...';
    } else if (st === 'failed') {
      showToast('З\'єднання перервано.', true);
      hangupCall(true, 'error');
    }
  };

  return pc;
}

async function flushLocalIce() {
  for (const c of pendingLocalIce)
    api('POST', `/messenger/calls/${activeCallId}/ice`, { candidate: c }).catch(() => {});
  pendingLocalIce = [];
}

async function flushRemoteIce(pc) {
  for (const c of pendingRemoteIce) {
    try { await pc.addIceCandidate(c); } catch (_) {}
  }
  pendingRemoteIce = [];
}

// ── Initiate call (caller) ─────────────────
async function initiateCall() {
  if (!activeConvId || !activePartner) return;
  if (activeCallId) { showToast('Дзвінок вже активний.'); return; }
  if (!checkWebRTCSupport()) return;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) { showToast(micError(err), true); return; }

  peerConnection = buildPeerConnection();
  localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    const { call_id } = await api('POST', '/messenger/calls', {
      conversation_id: activeConvId,
      sdp_offer: offer.sdp,
    });
    activeCallId  = call_id;
    remoteSdpSet  = false;
    icePollLastId = 0;
    await flushLocalIce();
    showCallScreen(activePartner.full_name, 'Виклик...');
    startOutgoingTone().catch(() => {});
    startCallPoll();
  } catch (err) {
    stopAllCallTones();
    playEndTone(true);
    showToast(err.message, true);
    cleanupPeer();
  }
}

// ── Incoming call detection ────────────────
function startIncomingCallCheck() {
  clearInterval(incomingCheckTimer);
  checkIncoming().catch(() => {});
  incomingCheckTimer = setInterval(checkIncoming, 4000);
}

async function checkIncoming() {
  if (activeCallId) return;
  try {
    const calls = await api('GET', '/messenger/calls/incoming');
    if (calls?.length && !incomingCallId) {
      const c = calls[0];
      incomingCallId     = c.id;
      incomingCallerName = c.caller_name || 'Невідомий';
      callCallerAvatar.textContent = initial(incomingCallerName);
      callCallerName.textContent   = incomingCallerName;
      callIncoming.hidden = false;
      startIncomingTone().catch(() => {});
      syncOverlayLock();
    } else if (!calls?.length && incomingCallId) {
      hideIncoming(); // cancelled before answer
    }
  } catch (_) {}
}

function hideIncoming() {
  stopIncomingTone();
  callIncoming.hidden = true;
  incomingCallId = null;
  incomingCallerName = '';
  syncOverlayLock();
}

// ── Accept / Reject ────────────────────────
async function acceptCall() {
  if (!incomingCallId) return;
  const callId = incomingCallId;
  hideIncoming();
  if (!checkWebRTCSupport()) {
    api('PUT', `/messenger/calls/${callId}/reject`).catch(() => {}); return;
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (err) {
    showToast(micError(err), true);
    api('PUT', `/messenger/calls/${callId}/reject`).catch(() => {}); return;
  }

  try {
    const callData = await api('GET', `/messenger/calls/${callId}`);
    peerConnection = buildPeerConnection();
    localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
    pendingLocalIce  = [];
    pendingRemoteIce = [];

    const offerSdp = normalizeSdp(callData.sdp_offer, 'SDP offer');
    await peerConnection.setRemoteDescription({ type: 'offer', sdp: offerSdp });
    remoteSdpSet = true;
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    const answerSdp = normalizeSdp(answer.sdp || peerConnection?.localDescription?.sdp || '', 'SDP answer');
    await api('PUT', `/messenger/calls/${callId}/answer`, { sdp_answer: answerSdp });

    activeCallId  = callId;
    icePollLastId = 0;
    callConnectedOnce = false;
    await flushLocalIce();
    showCallScreen(callData.caller_name || 'Дзвінок', 'З\'єднання...');
    startCallPoll();
  } catch (err) {
    showToast(err.message || 'Помилка підключення дзвінка.', true);
    api('PUT', `/messenger/calls/${callId}/reject`).catch(() => {});
    cleanupPeer();
  }
}

async function rejectCall() {
  const id = incomingCallId;
  hideIncoming();
  playEndTone(false);
  if (id) api('PUT', `/messenger/calls/${id}/reject`).catch(() => {});
}

// ── Call polling ───────────────────────────
function startCallPoll() {
  clearInterval(callPollTimer);
  callPollTimer = setInterval(pollCall, 1500);
}

async function pollCall() {
  if (!activeCallId || !peerConnection) return;
  try {
    const cd = await api('GET', `/messenger/calls/${activeCallId}`);
    if (['rejected', 'ended', 'missed'].includes(cd.status)) {
      if (cd.status === 'rejected') showToast('Дзвінок відхилено.');
      if (cd.status === 'ended') showToast('Дзвінок завершено.');
      if (cd.status === 'missed') showToast('Пропущений дзвінок.');
      hangupCall(false, cd.status);
      return;
    }

    // Caller: wait for callee's answer
    if (!remoteSdpSet && peerConnection.signalingState === 'have-local-offer') {
      if (cd.status === 'active' && cd.sdp_answer) {
        const answerSdp = normalizeSdp(cd.sdp_answer, 'SDP answer');
        await peerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
        remoteSdpSet = true;
        stopOutgoingTone();
        callScreenStatus.textContent = 'З\'єднання...';
        await flushRemoteIce(peerConnection);
      }
    }

    // Both: receive ICE candidates from the other peer
    const ices = await api('GET', `/messenger/calls/${activeCallId}/ice?after_id=${icePollLastId}`);
    if (ices?.length) {
      for (const ice of ices) {
        let cand;
        try { cand = typeof ice.candidate === 'string' ? JSON.parse(ice.candidate) : ice.candidate; }
        catch (_) { continue; }
        if (remoteSdpSet && peerConnection) {
          try { await peerConnection.addIceCandidate(cand); } catch (_) {}
        } else {
          pendingRemoteIce.push(cand);
        }
        icePollLastId = ice.id;
      }
    }
  } catch (_) {}
}

// ── Call screen ────────────────────────────
function showCallScreen(name, status) {
  callScreenAvatar.textContent = initial(name);
  callScreenName.textContent   = name;
  callScreenStatus.textContent = status;
  callScreenTimer.hidden       = true;
  callScreen.hidden            = false;
  callConnectedOnce            = false;
  syncOverlayLock();
}

function startCallTimer() {
  callSeconds = 0;
  callScreenTimer.hidden = false;
  callWallTimer = setInterval(() => {
    callSeconds++;
    const m = String(Math.floor(callSeconds / 60)).padStart(2, '0');
    const s = String(callSeconds % 60).padStart(2, '0');
    callScreenTimer.textContent = `${m}:${s}`;
  }, 1000);
}

async function hangupCall(notify = true, reason = 'ended') {
  const hadVisibleCall = !callScreen.hidden || !!activeCallId || callConnectedOnce;
  if (notify && activeCallId)
    api('PUT', `/messenger/calls/${activeCallId}/end`).catch(() => {});
  stopAllCallTones();
  clearInterval(callPollTimer);
  clearInterval(callWallTimer);
  callWallTimer    = null;
  cleanupPeer();
  activeCallId     = null;
  remoteSdpSet     = false;
  icePollLastId    = 0;
  pendingLocalIce  = [];
  pendingRemoteIce = [];
  isMuted          = false;
  callConnectedOnce = false;
  callScreen.hidden       = true;
  callScreenTimer.hidden  = true;
  if (btnMute) btnMute.classList.remove('muted');
  if (hadVisibleCall) {
    playEndTone(reason === 'error');
  }
  syncOverlayLock();
}

function cleanupPeer() {
  if (peerConnection) { try { peerConnection.close(); } catch (_) {} peerConnection = null; }
  if (localStream)    { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (remoteAudio)    remoteAudio.srcObject = null;
}

function primeCallAudioOnUserGesture() {
  ensureCallAudioCtx().catch(() => {});
}

function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
  btnMute.classList.toggle('muted', isMuted);
  btnMute.title = isMuted ? 'Увімкнути мікрофон' : 'Вимкнути мікрофон';
}

// ════════════════════════════════════════════
// Utilities
// ════════════════════════════════════════════
function micError(err) {
  if (err.name === 'NotAllowedError')  return 'Дозвольте доступ до мікрофону в браузері.';
  if (err.name === 'NotFoundError')    return 'Мікрофон не знайдено.';
  if (err.name === 'NotReadableError') return 'Мікрофон зайнятий іншою програмою.';
  return 'Помилка мікрофону: ' + (err.message || err.name);
}

function initial(name) { return (name || '?').trim().charAt(0).toUpperCase(); }

function compactPreview(text) {
  const raw = String(text || '').trim();
  if (!raw) return 'Немає повідомлень';
  if (/^[A-Za-z0-9+/=]{120,}$/.test(raw)) return '🎤 Голосове повідомлення';
  if (raw.length > 180) return raw.slice(0, 177) + '...';
  return raw;
}

function parseImagePayload(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { return []; }

  const srcItems = Array.isArray(parsed?.items)
    ? parsed.items
    : (parsed && parsed.data ? [parsed] : []);
  const out = [];
  srcItems.slice(0, 12).forEach(item => {
    const mime = String(item?.mime || '').toLowerCase().trim();
    const data = String(item?.data || '').trim();
    if (!/^image\/(jpeg|jpg|png|webp|gif|avif)$/i.test(mime)) return;
    if (!/^[A-Za-z0-9+/=]+$/.test(data)) return;
    if (data.length < 64 || data.length > 1_500_000) return;
    out.push({
      mime: mime === 'image/jpg' ? 'image/jpeg' : mime,
      data,
      w: Number(item?.w || 0),
      h: Number(item?.h || 0),
    });
  });
  return out;
}

function imageDataUrl(item) {
  const mime = String(item?.mime || 'image/jpeg').toLowerCase();
  const data = String(item?.data || '');
  return `data:${mime};base64,${data}`;
}

function conversationPreview(msg) {
  if (!msg) return 'Нове повідомлення';
  if (msg.is_deleted) return 'Повідомлення видалено';
  if ((msg.msg_type || 'text') === 'voice') return '🎤 Голосове повідомлення';
  if ((msg.msg_type || 'text') === 'image') return '🖼️ Фото';
  return compactPreview(msg.text || 'Нове повідомлення');
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function updateSendBtn() { btnSend.disabled = !msgInput.value.trim(); }

function autoResizeInput() {
  msgInput.style.height = 'auto';
  msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';
}

function scrollToBottom(instant = false) {
  scrollAnchor.scrollIntoView({ behavior: instant ? 'auto' : 'smooth' });
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  const diff = Math.floor((now - d) / 86400000);
  if (diff === 0) return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  if (diff === 1) return 'вчора';
  if (diff < 7)  return d.toLocaleDateString('uk-UA', { weekday: 'short' });
  return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
}

function formatTimeFromDate(d) {
  return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(d) {
  const now = new Date();
  const tod = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yes = new Date(tod); yes.setDate(yes.getDate() - 1);
  const md  = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (md.getTime() === tod.getTime()) return 'Сьогодні';
  if (md.getTime() === yes.getTime()) return 'Вчора';
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
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
if (btnLogout) btnLogout.addEventListener('click', requestLogout);
if (btnSidebarLogout) btnSidebarLogout.addEventListener('click', requestLogout);
if (btnChatLogout) btnChatLogout.addEventListener('click', requestLogout);
btnNewChat.addEventListener('click', openNewChatModal);
btnCloseModal.addEventListener('click', closeNewChatModal);
newChatModal.addEventListener('click', e => { if (e.target === newChatModal) closeNewChatModal(); });
if (photoViewer) {
  photoViewer.addEventListener('click', e => {
    if (e.target === photoViewer) closePhotoViewer();
  });
}
if (photoViewerImg) {
  photoViewerImg.addEventListener('load', () => {
    photoViewerImg.classList.remove('loading');
    applyPhotoTransform();
  });
  photoViewerImg.addEventListener('error', () => {
    photoViewerImg.classList.remove('loading');
    showToast('Не вдалося відкрити фото.', true);
  });
  photoViewerImg.addEventListener('pointerdown', handlePhotoViewerPointerDown);
  photoViewerImg.addEventListener('pointermove', handlePhotoViewerPointerMove);
  photoViewerImg.addEventListener('pointerup', handlePhotoViewerPointerEnd);
  photoViewerImg.addEventListener('pointercancel', handlePhotoViewerPointerCancel);
  photoViewerImg.addEventListener('lostpointercapture', handlePhotoViewerPointerCancel);
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (photoViewer && !photoViewer.hidden) { closePhotoViewer(); return; }
    closeNewChatModal();
    return;
  }
  if (photoViewer && !photoViewer.hidden) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepPhotoViewer(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); stepPhotoViewer(1); }
  }
});

userSearchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => performUserSearch(userSearchInput.value.trim()), 350);
});
groupUserSearch.addEventListener('input', () => {
  clearTimeout(groupSearchTimer);
  groupSearchTimer = setTimeout(() => performGroupUserSearch(groupUserSearch.value.trim()), 350);
});
btnCreateGroup.addEventListener('click', createGroup);

btnBack.addEventListener('click', () => {
  if (isRecording) stopRecording(false);
  sidebar.classList.remove('hidden');
  activeConvId = null;
  clearInterval(convPollTimer);
  chatView.hidden = true;
  chatEmpty.hidden = false;
  document.querySelectorAll('.conv-item').forEach(el => el.classList.remove('active'));
});

msgInput.addEventListener('input',   () => { autoResizeInput(); updateSendBtn(); });
msgInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
btnSend.addEventListener('click', sendMessage);
if (btnAttachPhoto && inputPhoto) {
  btnAttachPhoto.addEventListener('click', () => {
    if (!activeConvId) { showToast('Спочатку відкрийте чат.', true); return; }
    inputPhoto.value = '';
    inputPhoto.click();
  });
  inputPhoto.addEventListener('change', async e => {
    await sendPhotos(e.target.files);
    e.target.value = '';
  });
}
btnVoice.addEventListener('click', e => {
  // detail===0 => keyboard activation (Enter/Space), keep accessible toggle fallback
  if (e.detail !== 0) return;
  toggleRecording().catch(() => {});
});
btnVoice.addEventListener('pointerdown', handleVoicePointerDown);
btnVoice.addEventListener('pointermove', handleVoicePointerMove);
btnVoice.addEventListener('pointerup', handleVoicePointerUp);
btnVoice.addEventListener('pointercancel', handleVoicePointerCancel);
btnVoice.addEventListener('lostpointercapture', handleVoicePointerCancel);
btnVoice.addEventListener('contextmenu', e => e.preventDefault());
if (btnCancelRecord) btnCancelRecord.addEventListener('click', () => stopRecording(false));
convSearch.addEventListener('input', () => renderConvList(convData));
if (messagesList) {
  messagesList.addEventListener('click', e => {
    if (!(e.target instanceof Element)) return;
    const tile = e.target.closest('.photo-tile');
    if (!tile) return;
    const msgId = String(tile.dataset.photoMsg || '');
    const idx = Number(tile.dataset.photoIndex || 0);
    const items = photosByMessageId.get(msgId) || [];
    if (!items.length) return;
    openPhotoViewer(items, idx);
  });
}
if (btnPhotoClose) btnPhotoClose.addEventListener('click', closePhotoViewer);
if (btnPhotoPrev) btnPhotoPrev.addEventListener('click', () => stepPhotoViewer(-1));
if (btnPhotoNext) btnPhotoNext.addEventListener('click', () => stepPhotoViewer(1));

if (btnCall)       btnCall.addEventListener('click', initiateCall);
if (btnEndCall)    btnEndCall.addEventListener('click', () => hangupCall(true));
if (btnMute)       btnMute.addEventListener('click', toggleMute);
if (btnAcceptCall) btnAcceptCall.addEventListener('click', acceptCall);
if (btnRejectCall) btnRejectCall.addEventListener('click', rejectCall);

function bestEffortEndActiveCall() {
  if (!activeCallId || !token) return;
  fetch(`${API}/messenger/calls/${activeCallId}/end`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    keepalive: true,
  }).catch(() => {});
}
window.addEventListener('pagehide', bestEffortEndActiveCall);
window.addEventListener('beforeunload', bestEffortEndActiveCall);
window.addEventListener('pointerdown', primeCallAudioOnUserGesture, { once: true, passive: true });
window.addEventListener('keydown', primeCallAudioOnUserGesture, { once: true });

// ════════════════════════════════════════════
// Boot
// ════════════════════════════════════════════
if (token && me) showApp();
else showAuth();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(
        `${BASE}/sw-messenger.js?v=${MESSENGER_ASSET_VERSION}`
      );
      reg.update().catch(() => {});
    } catch (_) {}
  });
}

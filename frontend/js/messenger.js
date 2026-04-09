/* ════════════════════════════════════════════
   Army Bank — Messenger PWA
   groups · voice messages · WebRTC calls
════════════════════════════════════════════ */
'use strict';

const BASE = window.ARMY_BANK_BASE || '';
const API  = BASE + '/api';
const MESSENGER_ASSET_VERSION = '5';
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
const msgInputBar       = $('msg-input-bar');
const recordingIndicator= $('recording-indicator');
const recordingTime     = $('recording-time');
const recordingSwipeHint= $('recording-swipe-hint');
const btnCancelRecord   = $('btn-cancel-record');
const btnBack           = $('btn-back');
const btnNewChat        = $('btn-new-chat');
const btnLogout         = $('btn-logout');
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

function doLogout() {
  api('POST', '/auth/logout').catch(() => {});
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
}

function showApp() {
  authScreen.hidden = true;
  appEl.hidden = false;
  if (me && topbarAvatar) topbarAvatar.textContent = initial(me.full_name);
  loadConversations();
  startGlobalPoll();
  pollUnreadBadge();
  startIncomingCallCheck();
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
  } else {
    content = `<div class="msg-bubble">${esc(msg.text)}</div>`;
  }

  wrap.innerHTML = `
    ${!isMe ? `<div class="msg-sender-avatar">${esc(ini)}</div>` : ''}
    <div class="msg-inner">${content}<div class="msg-time">${timeStr}</div></div>`;
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
const HOLD_CANCEL_SWIPE_PX = 72;

async function toggleRecording() {
  if (isRecording) { stopRecording(true); return; }
  await startRecording();
}

async function startRecording() {
  if (recordStartInFlight || isRecording) return;
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
  holdPointerActive = false;
  holdPointerId = null;
  holdCancelTriggered = false;
  cancelPendingStart = false;
  btnVoice.classList.remove('recording');
  btnVoice.title = 'Утримуйте для запису';
  setRecordingUI(false);
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
}

function handleVoicePointerDown(e) {
  if (e.button !== undefined && e.button !== 0) return;
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
  const progress = Math.min(1, leftDistance / HOLD_CANCEL_SWIPE_PX);
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
// New chat modal
// ════════════════════════════════════════════
function openNewChatModal() {
  newChatModal.hidden = false;
  switchTab('direct');
  userSearchInput.value = '';
  userSearchResults.innerHTML = '';
  searchHint.hidden = false;
  userSearchResults.appendChild(searchHint);
  setTimeout(() => userSearchInput.focus(), 50);
}

function closeNewChatModal() { newChatModal.hidden = true; }

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
      if (!callWallTimer) startCallTimer();
    } else if (st === 'disconnected') {
      callScreenStatus.textContent = 'Відновлення...';
    } else if (st === 'failed') {
      showToast('З\'єднання перервано.', true);
      hangupCall(true);
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
    startCallPoll();
  } catch (err) {
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
    } else if (!calls?.length && incomingCallId) {
      hideIncoming(); // cancelled before answer
    }
  } catch (_) {}
}

function hideIncoming() {
  callIncoming.hidden = true;
  incomingCallId = null;
  incomingCallerName = '';
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

    await peerConnection.setRemoteDescription({ type: 'offer', sdp: callData.sdp_offer });
    remoteSdpSet = true;
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    await api('PUT', `/messenger/calls/${callId}/answer`, { sdp_answer: answer.sdp });

    activeCallId  = callId;
    icePollLastId = 0;
    await flushLocalIce();
    showCallScreen(callData.caller_name || 'Дзвінок', 'З\'єднання...');
    startCallPoll();
  } catch (err) {
    showToast(err.message, true);
    cleanupPeer();
  }
}

async function rejectCall() {
  const id = incomingCallId;
  hideIncoming();
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
    // Caller: wait for callee's answer
    if (!remoteSdpSet && peerConnection.signalingState === 'have-local-offer') {
      const cd = await api('GET', `/messenger/calls/${activeCallId}`);
      if (['rejected', 'ended'].includes(cd.status)) {
        if (cd.status === 'rejected') showToast('Дзвінок відхилено.');
        hangupCall(false); return;
      }
      if (cd.status === 'active' && cd.sdp_answer) {
        await peerConnection.setRemoteDescription({ type: 'answer', sdp: cd.sdp_answer });
        remoteSdpSet = true;
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

async function hangupCall(notify = true) {
  if (notify && activeCallId)
    api('PUT', `/messenger/calls/${activeCallId}/end`).catch(() => {});
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
  callScreen.hidden       = true;
  callScreenTimer.hidden  = true;
  if (btnMute) btnMute.classList.remove('muted');
}

function cleanupPeer() {
  if (peerConnection) { try { peerConnection.close(); } catch (_) {} peerConnection = null; }
  if (localStream)    { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (remoteAudio)    remoteAudio.srcObject = null;
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

function conversationPreview(msg) {
  if (!msg) return 'Нове повідомлення';
  if (msg.is_deleted) return 'Повідомлення видалено';
  if ((msg.msg_type || 'text') === 'voice') return '🎤 Голосове повідомлення';
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
btnLogout.addEventListener('click', doLogout);
btnNewChat.addEventListener('click', openNewChatModal);
btnCloseModal.addEventListener('click', closeNewChatModal);
newChatModal.addEventListener('click', e => { if (e.target === newChatModal) closeNewChatModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeNewChatModal(); });

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
if (btnCancelRecord) btnCancelRecord.addEventListener('click', () => stopRecording(false));
convSearch.addEventListener('input', () => renderConvList(convData));

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

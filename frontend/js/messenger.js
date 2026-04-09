/* ════════════════════════════════════════════
   Army Bank — Messenger PWA
   Vanilla JS · groups · voice · WebRTC calls
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

// ── Voice recording state ──────────────────
let mediaRecorder = null;
let audioChunks   = [];
let isRecording   = false;

// ── Call state ─────────────────────────────
let activeCallId   = null;
let peerConnection = null;
let localStream    = null;
let callTimer      = null;
let callSeconds    = 0;
let callPollTimer  = null;
let icePollLastId  = 0;
let isMuted        = false;
let incomingCallId = null;
let incomingCheckTimer = null;

// ── Group creation state ───────────────────
let groupSelectedUsers = [];  // [{id, full_name}]
let groupSearchTimer   = null;

// ── DOM refs ───────────────────────────────
const $ = id => document.getElementById(id);
const authScreen       = $('auth-screen');
const app              = $('app');
const loginForm        = $('login-form');
const authIdentity     = $('auth-identity');
const authPassword     = $('auth-password');
const authError        = $('auth-error');
const btnLogin         = $('btn-login');
const btnLoginText     = $('btn-login-text');
const btnLoginSpin     = $('btn-login-spin');
const btnTogglePw      = $('btn-toggle-pw');
const sidebar          = $('sidebar');
const convList         = $('conv-list');
const convEmpty        = $('conv-empty');
const convSearch       = $('conv-search');
const chatEmpty        = $('chat-empty');
const chatView         = $('chat-view');
const chatAvatar       = $('chat-avatar');
const chatPartnerName  = $('chat-partner-name');
const chatPartnerRole  = $('chat-partner-role');
const messagesWrap     = $('messages-wrap');
const messagesList     = $('messages-list');
const scrollAnchor     = $('scroll-anchor');
const msgInput         = $('msg-input');
const btnSend          = $('btn-send');
const btnVoice         = $('btn-voice');
const btnBack          = $('btn-back');
const btnNewChat       = $('btn-new-chat');
const btnLogout        = $('btn-logout');
const btnCall          = $('btn-call');
const topbarAvatar     = $('topbar-avatar');
const unreadBadge      = $('unread-badge');
const newChatModal     = $('new-chat-modal');
const btnCloseModal    = $('btn-close-modal');
const userSearchInput  = $('user-search-input');
const userSearchResults= $('user-search-results');
const searchHint       = $('search-hint');
const toast            = $('toast');
// Call UI
const callIncoming     = $('call-incoming');
const callCallerAvatar = $('call-caller-avatar');
const callCallerName   = $('call-caller-name');
const btnAcceptCall    = $('btn-accept-call');
const btnRejectCall    = $('btn-reject-call');
const callScreen       = $('call-screen');
const callScreenAvatar = $('call-screen-avatar');
const callScreenName   = $('call-screen-name');
const callScreenStatus = $('call-screen-status');
const callScreenTimer  = $('call-screen-timer');
const btnMute          = $('btn-mute');
const btnEndCall       = $('btn-end-call');
const remoteAudio      = $('remote-audio');
// Group UI
const tabDirect        = $('tab-direct');
const tabGroup         = $('tab-group');
const tabPanelDirect   = $('tab-panel-direct');
const tabPanelGroup    = $('tab-panel-group');
const groupNameInput   = $('group-name-input');
const groupUserSearch  = $('group-user-search');
const groupUserResults = $('group-user-results');
const groupSelectedList= $('group-selected-list');
const btnCreateGroup   = $('btn-create-group');

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
  stopIncomingCallCheck();
  hangupCall(false);
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
  startIncomingCallCheck();
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
    ? items.filter(c => {
        const name = c.is_group ? (c.group_name || 'Група') : (c.partner && c.partner.full_name || '');
        return name.toLowerCase().includes(q);
      })
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

  const isGroup = !!conv.is_group;
  const name    = isGroup ? (conv.group_name || 'Група') : (conv.partner ? conv.partner.full_name : 'Невідомий');
  const initial = name.charAt(0);
  const preview = conv.last_message_text || 'Немає повідомлень';
  const time    = conv.last_message_at ? formatTime(conv.last_message_at) : '';
  const unread  = conv.unread || 0;

  el.innerHTML = `
    <div class="conv-avatar${isGroup ? ' group' : ''}">${esc(initial)}</div>
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

  const isGroup = !!conv.is_group;
  const name    = isGroup ? (conv.group_name || 'Група') : (conv.partner ? conv.partner.full_name : 'Невідомий');
  chatAvatar.textContent = esc(name.charAt(0));
  chatAvatar.className = 'chat-header-avatar' + (isGroup ? ' group' : '');
  chatPartnerName.textContent = name;
  chatPartnerRole.textContent = isGroup ? 'Групова розмова' : roleLabel(conv.partner ? conv.partner.role : '');

  // Show call button only for 1-on-1 chats
  if (btnCall) btnCall.hidden = isGroup;

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

  const name    = msg.sender_name || '';
  const initial = name.charAt(0);
  const timeStr = formatTimeFromDate(new Date(msg.created_at));
  const isDeleted = msg.is_deleted;
  const msgType   = msg.msg_type || 'text';

  let bubbleContent;
  if (isDeleted) {
    bubbleContent = `<div class="msg-bubble deleted">${esc('Повідомлення видалено')}</div>`;
  } else if (msgType === 'voice') {
    const src = 'data:audio/webm;base64,' + msg.text;
    bubbleContent = `
      <div class="msg-bubble" style="padding:8px 12px">
        <div class="voice-player">
          <audio controls src="${src}" preload="none"></audio>
        </div>
      </div>`;
  } else {
    bubbleContent = `<div class="msg-bubble">${esc(msg.text)}</div>`;
  }

  wrap.innerHTML = `
    ${!isMe ? `<div class="msg-sender-avatar">${esc(initial)}</div>` : ''}
    <div class="msg-inner">
      ${bubbleContent}
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
// Voice Recording
// ════════════════════════════════════════════
async function toggleRecording() {
  if (isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  if (!activeConvId) { showToast('Спочатку відкрийте чат.', true); return; }
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';

    mediaRecorder = new MediaRecorder(localStream, { mimeType });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = sendVoiceMessage;
    mediaRecorder.start(250);

    isRecording = true;
    btnVoice.classList.add('recording');
    btnVoice.title = 'Зупинити запис';
  } catch (err) {
    showToast('Немає доступу до мікрофону.', true);
  }
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
  }
  isRecording = false;
  btnVoice.classList.remove('recording');
  btnVoice.title = 'Голосове повідомлення';
}

async function sendVoiceMessage() {
  if (!audioChunks.length || !activeConvId) return;
  const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
  if (blob.size > 600_000) { showToast('Запис занадто довгий.', true); return; }

  const b64 = await blobToBase64(blob);
  try {
    const msg = await api('POST', `/messenger/conversations/${activeConvId}/messages`, {
      text: b64, msg_type: 'voice',
    });
    appendMessage({ ...msg, msg_type: 'voice', text: b64 });
    lastMsgId = msg.id;
  } catch (err) {
    showToast(err.message, true);
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
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
  switchModalTab('direct');
  userSearchInput.value = '';
  userSearchResults.innerHTML = '';
  searchHint.hidden = false;
  userSearchResults.appendChild(searchHint);
  setTimeout(() => userSearchInput.focus(), 50);
}

function closeNewChatModal() { newChatModal.hidden = true; }

function switchModalTab(tab) {
  const isDirect = tab === 'direct';
  tabDirect.classList.toggle('active', isDirect);
  tabGroup.classList.toggle('active', !isDirect);
  tabPanelDirect.hidden = !isDirect;
  tabPanelGroup.hidden  = isDirect;
  if (!isDirect) { setTimeout(() => groupNameInput.focus(), 50); }
}

tabDirect.addEventListener('click', () => switchModalTab('direct'));
tabGroup.addEventListener('click',  () => switchModalTab('group'));

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

// ── Group search ───────────────────────────
async function performGroupUserSearch(q) {
  if (q.length < 2) {
    groupUserResults.innerHTML = '<p class="search-hint">Введіть ім\'я для пошуку</p>';
    return;
  }
  try {
    const users = await api('GET', `/messenger/users/search?q=${encodeURIComponent(q)}`);
    groupUserResults.innerHTML = '';
    if (users.length === 0) {
      groupUserResults.innerHTML = '<p class="search-hint">Нікого не знайдено.</p>';
      return;
    }
    users.forEach(u => {
      if (groupSelectedUsers.find(s => s.id === u.id)) return;
      const el = document.createElement('div');
      el.className = 'user-result-item';
      el.innerHTML = `
        <div class="user-result-avatar">${esc((u.full_name || '?').charAt(0))}</div>
        <div>
          <div class="user-result-name">${esc(u.full_name)}</div>
          <div class="user-result-meta">${esc(u.phone || '')}</div>
        </div>
      `;
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
  if (!name) { showToast('Введіть назву групи.', true); return; }
  if (groupSelectedUsers.length < 1) { showToast('Додайте хоча б одного учасника.', true); return; }

  try {
    const conv = await api('POST', '/messenger/groups', {
      name,
      member_ids: groupSelectedUsers.map(u => u.id),
    });
    closeNewChatModal();
    groupSelectedUsers = [];
    renderGroupChips();
    groupNameInput.value = '';
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
// WebRTC Calls
// ════════════════════════════════════════════
const STUN = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

async function initiateCall() {
  if (!activeConvId || !activePartner) return;
  if (activeCallId) { showToast('Дзвінок вже активний.'); return; }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    showToast('Немає доступу до мікрофону.', true); return;
  }

  peerConnection = new RTCPeerConnection(STUN);
  localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

  peerConnection.ontrack = e => { remoteAudio.srcObject = e.streams[0]; };
  peerConnection.onicecandidate = e => {
    if (e.candidate && activeCallId) {
      api('POST', `/messenger/calls/${activeCallId}/ice`, { candidate: e.candidate.toJSON() }).catch(() => {});
    }
  };
  peerConnection.oniceconnectionstatechange = () => {
    if (['disconnected','failed','closed'].includes(peerConnection.iceConnectionState)) {
      hangupCall(true);
    }
  };

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  try {
    const { call_id } = await api('POST', '/messenger/calls', {
      conversation_id: activeConvId,
      sdp_offer: offer.sdp,
    });
    activeCallId = call_id;
    showCallScreen(activePartner.full_name, false);
    startCallPoll();
  } catch (err) {
    showToast(err.message, true);
    cleanupPeer();
  }
}

// ── Incoming call check ────────────────────
function startIncomingCallCheck() {
  stopIncomingCallCheck();
  incomingCheckTimer = setInterval(checkIncomingCalls, 5000);
}

function stopIncomingCallCheck() {
  clearInterval(incomingCheckTimer);
}

async function checkIncomingCalls() {
  if (activeCallId) return;
  try {
    const calls = await api('GET', '/messenger/calls/incoming');
    if (calls && calls.length > 0 && !incomingCallId) {
      const c = calls[0];
      incomingCallId = c.id;
      showIncomingCall(c);
    }
  } catch (_) {}
}

function showIncomingCall(call) {
  callCallerAvatar.textContent = (call.caller_name || '?').charAt(0).toUpperCase();
  callCallerName.textContent = call.caller_name || 'Невідомий';
  callIncoming.hidden = false;
}

function hideIncomingCall() {
  callIncoming.hidden = true;
  incomingCallId = null;
}

async function acceptCall() {
  if (!incomingCallId) return;
  const callId = incomingCallId;
  hideIncomingCall();

  try {
    const callData = await api('GET', `/messenger/calls/${callId}`);

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      showToast('Немає доступу до мікрофону.', true);
      await api('PUT', `/messenger/calls/${callId}/reject`).catch(() => {});
      return;
    }

    peerConnection = new RTCPeerConnection(STUN);
    localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

    peerConnection.ontrack = e => { remoteAudio.srcObject = e.streams[0]; };
    peerConnection.onicecandidate = e => {
      if (e.candidate && activeCallId) {
        api('POST', `/messenger/calls/${activeCallId}/ice`, { candidate: e.candidate.toJSON() }).catch(() => {});
      }
    };
    peerConnection.oniceconnectionstatechange = () => {
      if (['disconnected','failed','closed'].includes(peerConnection.iceConnectionState)) {
        hangupCall(true);
      }
    };

    await peerConnection.setRemoteDescription({ type: 'offer', sdp: callData.sdp_offer });
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    await api('PUT', `/messenger/calls/${callId}/answer`, { sdp_answer: answer.sdp });

    activeCallId = callId;
    icePollLastId = 0;
    showCallScreen(callData.caller_name || 'Дзвінок', true);
    startCallPoll();
  } catch (err) {
    showToast(err.message, true);
    cleanupPeer();
  }
}

async function rejectCall() {
  if (!incomingCallId) return;
  const id = incomingCallId;
  hideIncomingCall();
  try { await api('PUT', `/messenger/calls/${id}/reject`); } catch (_) {}
}

// ── Call poll (answer + ICE) ───────────────
function startCallPoll() {
  clearInterval(callPollTimer);
  callPollTimer = setInterval(pollCall, 1500);
}

async function pollCall() {
  if (!activeCallId) return;
  try {
    // Poll for answer (caller side)
    if (peerConnection && peerConnection.signalingState === 'have-local-offer') {
      const callData = await api('GET', `/messenger/calls/${activeCallId}`);
      if (callData.status === 'active' && callData.sdp_answer && !peerConnection.remoteDescription) {
        await peerConnection.setRemoteDescription({ type: 'answer', sdp: callData.sdp_answer });
        callScreenStatus.textContent = 'Підключено';
        startCallTimer();
      } else if (['rejected','ended'].includes(callData.status)) {
        hangupCall(false);
        return;
      }
    }

    // Poll ICE candidates from the other side
    const ices = await api('GET', `/messenger/calls/${activeCallId}/ice?after_id=${icePollLastId}`);
    if (ices && ices.length > 0) {
      for (const ice of ices) {
        try {
          await peerConnection.addIceCandidate(JSON.parse(ice.candidate));
        } catch (_) {}
        icePollLastId = ice.id;
      }
    }
  } catch (_) {}
}

// ── Call screen ────────────────────────────
function showCallScreen(name, answered) {
  callScreenAvatar.textContent = (name || '?').charAt(0).toUpperCase();
  callScreenName.textContent   = name;
  callScreenStatus.textContent = answered ? 'Підключено' : 'Виклик...';
  callScreenTimer.hidden = !answered;
  callScreen.hidden = false;
  if (answered) startCallTimer();
}

function startCallTimer() {
  callSeconds = 0;
  callScreenTimer.hidden = false;
  clearInterval(callTimer);
  callTimer = setInterval(() => {
    callSeconds++;
    const m = String(Math.floor(callSeconds / 60)).padStart(2, '0');
    const s = String(callSeconds % 60).padStart(2, '0');
    callScreenTimer.textContent = `${m}:${s}`;
  }, 1000);
}

async function hangupCall(notify = true) {
  if (notify && activeCallId) {
    api('PUT', `/messenger/calls/${activeCallId}/end`).catch(() => {});
  }
  clearInterval(callTimer);
  clearInterval(callPollTimer);
  cleanupPeer();
  activeCallId  = null;
  icePollLastId = 0;
  callScreen.hidden = true;
  callScreenTimer.hidden = true;
  isMuted = false;
  if (btnMute) btnMute.classList.remove('muted');
}

function cleanupPeer() {
  if (peerConnection) { peerConnection.close(); peerConnection = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (remoteAudio) remoteAudio.srcObject = null;
}

function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
  btnMute.classList.toggle('muted', isMuted);
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

groupUserSearch.addEventListener('input', () => {
  clearTimeout(groupSearchTimer);
  groupSearchTimer = setTimeout(() => performGroupUserSearch(groupUserSearch.value.trim()), 350);
});

btnCreateGroup.addEventListener('click', createGroup);

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
btnVoice.addEventListener('click', toggleRecording);
convSearch.addEventListener('input', () => renderConvList(convData));
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeNewChatModal(); });

// Call controls
if (btnCall)      btnCall.addEventListener('click', initiateCall);
if (btnEndCall)   btnEndCall.addEventListener('click', () => hangupCall(true));
if (btnMute)      btnMute.addEventListener('click', toggleMute);
if (btnAcceptCall) btnAcceptCall.addEventListener('click', acceptCall);
if (btnRejectCall) btnRejectCall.addEventListener('click', rejectCall);

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

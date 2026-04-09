/* ════════════════════════════════════════════
   Army Bank — Messenger PWA
   groups · voice messages · WebRTC calls
════════════════════════════════════════════ */
'use strict';

const BASE = window.ARMY_BANK_BASE || '';
const API  = BASE + '/api';
const MESSENGER_ASSET_VERSION = '24';
const TOKEN_KEY = 'msng_token';
const USER_KEY  = 'msng_user';
const CALL_PREFS_KEY = 'msng_call_prefs_v1';
const DEFAULT_MSG_PLACEHOLDER = 'Напишіть повідомлення...';
const DEFAULT_CALL_PREFS = Object.freeze({
  sounds: true,
  vibration: true,
  volume: 0.7,
  outgoingTimeoutSec: 35,
  incomingTimeoutSec: 45,
});

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
let outgoingNoAnswerTimer = null;
let incomingAutoRejectTimer = null;
let incomingCountdownTimer = null;

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
let callAcceptInProgress = false;
let callStartAtMs = 0;
let callQualityTimer = null;
let callQualityLabel = '';
let callStatusBase = 'З\'єднання...';
let callWakeLock = null;
let callBackgroundNotifiedForId = null;
let turnHintShown = false;
let bankSummaryCache = null;
let bankProfileLinked = true;

// ── Call audio state ───────────────────────
let callAudioCtx       = null;
let incomingToneTimer  = null;
let outgoingToneTimer  = null;
let callAudioPrimed    = false;
let callPrefs          = loadCallPrefs();

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
const assistantPanel    = $('assistant-panel');
const assistantQuickActions = $('assistant-quick-actions');
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
const btnBankTools      = $('btn-bank-tools');
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
const callIncomingLabel = $('call-incoming-label');
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
const groupPreviewAvatar = $('group-preview-avatar');
const groupPreviewName = $('group-preview-name');
const groupPreviewSub = $('group-preview-sub');
const groupPreviewBadges = $('group-preview-badges');
const btnCreateGroup    = $('btn-create-group');
const callSettingsModal = $('call-settings-modal');
const btnCloseCallSettings = $('btn-close-call-settings');
const callSoundsToggle = $('call-sounds-toggle');
const callVibrateToggle = $('call-vibrate-toggle');
const callVolumeRange = $('call-volume-range');
const callVolumeValue = $('call-volume-value');
const outgoingTimeoutRange = $('outgoing-timeout-range');
const outgoingTimeoutValue = $('outgoing-timeout-value');
const incomingTimeoutRange = $('incoming-timeout-range');
const incomingTimeoutValue = $('incoming-timeout-value');
const btnCallTestSound = $('btn-call-test-sound');
const btnCallReset = $('btn-call-reset');
const callSettingsButtons = Array.from(document.querySelectorAll('[data-open-call-settings]'));
const bankToolsModal = $('bank-tools-modal');
const btnCloseBankTools = $('btn-close-bank-tools');
const bankLinkStatus = $('bank-link-status');
const bankAccountNumber = $('bank-account-number');
const bankBalance = $('bank-balance');
const bankFromDate = $('bank-from-date');
const bankToDate = $('bank-to-date');
const bankReportType = $('bank-report-type');
const btnBankRefresh = $('btn-bank-refresh');
const btnBankSendSummary = $('btn-bank-send-summary');
const btnBankDownloadPdf = $('btn-bank-download-pdf');
const btnBankDownloadCsv = $('btn-bank-download-csv');
const btnBankSendOrderMsg = $('btn-bank-send-order-msg');

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

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function loadCallPrefs() {
  try {
    const raw = localStorage.getItem(CALL_PREFS_KEY);
    if (!raw) return { ...DEFAULT_CALL_PREFS };
    const parsed = JSON.parse(raw);
    return {
      sounds: parsed?.sounds !== false,
      vibration: parsed?.vibration !== false,
      volume: clampNumber(parsed?.volume, 0, 1, DEFAULT_CALL_PREFS.volume),
      outgoingTimeoutSec: Math.round(clampNumber(parsed?.outgoingTimeoutSec, 15, 90, DEFAULT_CALL_PREFS.outgoingTimeoutSec)),
      incomingTimeoutSec: Math.round(clampNumber(parsed?.incomingTimeoutSec, 15, 90, DEFAULT_CALL_PREFS.incomingTimeoutSec)),
    };
  } catch (_) {
    return { ...DEFAULT_CALL_PREFS };
  }
}

function saveCallPrefs() {
  try {
    localStorage.setItem(CALL_PREFS_KEY, JSON.stringify(callPrefs));
  } catch (_) {}
}

function renderCallSettings() {
  if (callSoundsToggle) callSoundsToggle.checked = !!callPrefs.sounds;
  if (callVibrateToggle) callVibrateToggle.checked = !!callPrefs.vibration;
  if (callVolumeRange) callVolumeRange.value = String(Math.round(callPrefs.volume * 100));
  if (callVolumeValue) callVolumeValue.textContent = `${Math.round(callPrefs.volume * 100)}%`;
  if (outgoingTimeoutRange) outgoingTimeoutRange.value = String(callPrefs.outgoingTimeoutSec);
  if (outgoingTimeoutValue) outgoingTimeoutValue.textContent = `${callPrefs.outgoingTimeoutSec}с`;
  if (incomingTimeoutRange) incomingTimeoutRange.value = String(callPrefs.incomingTimeoutSec);
  if (incomingTimeoutValue) incomingTimeoutValue.textContent = `${callPrefs.incomingTimeoutSec}с`;
}

function openCallSettingsModal() {
  if (!callSettingsModal) return;
  renderCallSettings();
  callSettingsModal.hidden = false;
  syncOverlayLock();
}

function closeCallSettingsModal() {
  if (!callSettingsModal) return;
  callSettingsModal.hidden = true;
  syncOverlayLock();
}

async function previewCallSignal() {
  if (!callPrefs.sounds) {
    showToast('Увімкніть звуки дзвінків, щоб прослухати сигнал.', true);
    return;
  }
  await ensureCallAudioCtx();
  toneBeep(670, 0.11, { gain: 0.03 });
  toneBeep(830, 0.13, { gain: 0.028, delay: 0.13 });
  toneBeep(980, 0.12, { gain: 0.025, delay: 0.28 });
}

function resetCallPrefsToDefaults() {
  callPrefs = { ...DEFAULT_CALL_PREFS };
  saveCallPrefs();
  renderCallSettings();
  stopAllCallTones();
  showToast('Налаштування дзвінків скинуто до стандартних.');
}

function moneyFmt(amount, currency = 'UAH') {
  const value = Number(amount || 0);
  const symbol = (String(currency || 'UAH').toUpperCase() === 'UAH') ? '₴' : String(currency || 'UAH') + ' ';
  return `${symbol}${value.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - Math.max(0, Number(days || 0)));
  return d.toISOString().slice(0, 10);
}

function setBankLinkStatus(text, isWarn = false) {
  if (!bankLinkStatus) return;
  bankLinkStatus.textContent = text;
  bankLinkStatus.classList.toggle('warn', !!isWarn);
}

function closeBankToolsModal() {
  if (!bankToolsModal) return;
  bankToolsModal.hidden = true;
  syncOverlayLock();
}

async function ensureMessengerBankStatus() {
  if (!token) return null;
  try {
    const status = await api('GET', '/messenger/bank/status');
    bankProfileLinked = !!status?.linked;
    if (status?.notice) showToast(status.notice);
    return status;
  } catch (err) {
    bankProfileLinked = false;
    showToast(err.message || 'Банківський профіль недоступний.', true);
    return null;
  }
}

async function loadBankSummary() {
  const summary = await api('GET', '/messenger/bank/summary');
  bankSummaryCache = summary;
  const account = summary?.account || {};
  if (bankAccountNumber) bankAccountNumber.textContent = account.account_number || '—';
  if (bankBalance) bankBalance.textContent = moneyFmt(account.balance, account.currency || 'UAH');
  if (summary?.auto_linked) {
    setBankLinkStatus('Рахунок був створений автоматично і вже синхронізований з месенджером.');
  } else {
    setBankLinkStatus('Bank + Messenger синхронізовано. Можна запитувати виписки та дані по рахунку.');
  }
  return summary;
}

async function openBankToolsModal() {
  if (!bankToolsModal) return;
  if (!token) {
    showToast('Спочатку виконайте вхід.', true);
    return;
  }
  if (!bankFromDate?.value) bankFromDate.value = daysAgoIso(30);
  if (!bankToDate?.value) bankToDate.value = todayIso();
  setBankLinkStatus('Оновлюю банківські дані…');
  bankToolsModal.hidden = false;
  syncOverlayLock();
  const status = await ensureMessengerBankStatus();
  if (!status?.linked) {
    setBankLinkStatus('Банківський профіль не знайдено. Зверніться до підтримки.', true);
    return;
  }
  try {
    await loadBankSummary();
  } catch (err) {
    setBankLinkStatus(err.message || 'Не вдалося завантажити дані банку.', true);
  }
}

function parseFilenameFromDisposition(disposition, fallbackName) {
  const raw = String(disposition || '');
  const utf8Match = raw.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match && utf8Match[1]) {
    try { return decodeURIComponent(utf8Match[1]); } catch (_) {}
  }
  const plainMatch = raw.match(/filename=\"?([^\";]+)\"?/i);
  if (plainMatch && plainMatch[1]) return plainMatch[1];
  return fallbackName;
}

async function downloadProtectedFile(path, fallbackName) {
  if (!token) throw new Error('Потрібна авторизація.');
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      message = j?.error || message;
    } catch (_) {}
    throw new Error(message);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const filename = parseFilenameFromDisposition(disposition, fallbackName);
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1500);
}

async function createStatementOrder(format = 'pdf') {
  const from_date = bankFromDate?.value || daysAgoIso(30);
  const to_date = bankToDate?.value || todayIso();
  if (from_date > to_date) throw new Error('Дата "з" не може бути пізніше дати "по".');
  const report_type = (bankReportType?.value || 'detailed');
  return api('POST', '/messenger/bank/statement/order', { format, from_date, to_date, report_type });
}

async function sendTextToActiveChat(text) {
  if (!activeConvId) throw new Error('Спочатку відкрийте чат, куди надіслати повідомлення.');
  const msg = await api('POST', `/messenger/conversations/${activeConvId}/messages`, { text });
  appendMessage(msg);
  lastMsgId = msg.id;
  updateConvItem(activeConvId, {
    last_message_text: conversationPreview(msg),
    last_message_at: msg.created_at,
  });
}

async function refreshBankPanel() {
  if (!bankToolsModal || bankToolsModal.hidden) return;
  setBankLinkStatus('Оновлюю банківські дані…');
  await loadBankSummary();
}

async function handleBankSummaryShare() {
  const summary = bankSummaryCache || await loadBankSummary();
  const text = summary?.share_text || 'Не вдалося сформувати зведення по рахунку.';
  await sendTextToActiveChat(text);
  showToast('Банківське зведення надіслано в чат.');
}

async function handleBankDownload(format) {
  const order = await createStatementOrder(format);
  const fallbackName = format === 'csv' ? 'armybank_statement.csv' : 'armybank_statement.pdf';
  await downloadProtectedFile(order.download_path, fallbackName);
  showToast(`Виписку ${String(format).toUpperCase()} завантажено.`);
  return order;
}

async function handleBankOrderShare() {
  const order = await createStatementOrder('pdf');
  await sendTextToActiveChat(order.share_text || 'Запит на виписку сформовано.');
  showToast('Запит на виписку надіслано в чат.');
}

function syncOverlayLock() {
  const locked = (
    !!newChatModal && !newChatModal.hidden
  ) || (
    !!bankToolsModal && !bankToolsModal.hidden
  ) || (
    !!callSettingsModal && !callSettingsModal.hidden
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

function applyAuthPayload(data) {
  token = data?.token || null;
  me = data?.user || null;
  if (!token || !me) throw new Error('Некоректна відповідь сервера авторизації.');
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(me));
  const linked = me?.bank_account_linked !== false;
  bankProfileLinked = linked;
  if (data?.bank_notice) showToast(data.bank_notice);
  if (!linked) {
    throw new Error('Банківський профіль не знайдено. Зверніться до підтримки.');
  }
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
    applyAuthPayload(data);
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
    applyAuthPayload(data);
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
  closeBankToolsModal();
  closeCallSettingsModal();
  closePhotoViewer();
  if (isRecording) stopRecording(false);
  token = null; me = null;
  rtcConfigLoaded = false;
  rtcConfig = { iceServers: [...DEFAULT_ICE_SERVERS] };
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  clearPolling();
  clearInterval(incomingCheckTimer);
  hideIncoming();
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
  ensureMessengerBankStatus().catch(() => {});
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

function isAssistantPartner(partner) {
  if (!partner || typeof partner !== 'object') return false;
  const role = String(partner.role || '').toLowerCase();
  if (role === 'assistant_bot') return true;
  const name = String(partner.full_name || '').toLowerCase();
  return (
    name.includes('army bank assistant') ||
    name.includes('bank assistant') ||
    name.includes('банківський асистент')
  );
}

function assistantGlyphMarkup() {
  return `<span class="assistant-glyph" aria-hidden="true">
    <svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="32" height="32" rx="10" fill="#1f6b4c"/>
      <rect x="2" y="2" width="32" height="32" rx="10" fill="rgba(15,59,45,.45)"/>
      <circle cx="27.5" cy="10.5" r="3.4" fill="#d4b070"/>
      <path d="M11 12h14a4.5 4.5 0 0 1 4.5 4.5V21a4.5 4.5 0 0 1-4.5 4.5h-8l-5.5 4 1.2-4H11A4.5 4.5 0 0 1 6.5 21v-4.5A4.5 4.5 0 0 1 11 12z" fill="rgba(255,255,255,.96)"/>
      <text x="18" y="20.3" text-anchor="middle" font-size="8.2" font-family="Manrope, Arial, sans-serif" font-weight="800" fill="#1d5a40">AB</text>
    </svg>
  </span>`;
}

function verifiedBadgeMarkup() {
  return `<span class="verified-inline" title="Верифіковано Army Bank" aria-label="Верифіковано Army Bank">
    <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="#2e8a5f"/>
      <path d="M4.2 8.4 6.6 10.7 11.8 5.5" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </span>`;
}

function renderNameWithVerified(name, isVerified = false) {
  const clean = esc(name || '');
  return isVerified ? `${clean}${verifiedBadgeMarkup()}` : clean;
}

function syncAssistantUi(isAssistant) {
  if (chatView) chatView.classList.toggle('assistant-chat', !!isAssistant);
  if (assistantPanel) assistantPanel.hidden = !isAssistant;
  if (btnBankTools) btnBankTools.hidden = !isAssistant;
  if (msgInput) msgInput.placeholder = isAssistant
    ? 'Спробуйте: Баланс, виписка PDF/CSV, переказ...'
    : DEFAULT_MSG_PLACEHOLDER;
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
  const isAssistant = !isGroup && isAssistantPartner(conv.partner);
  const name    = convName(conv);
  const preview = compactPreview(conv.last_message_text);
  const time    = conv.last_message_at ? formatTime(conv.last_message_at) : '';
  const unread  = conv.unread || 0;
  el.innerHTML = `
    <div class="conv-avatar${isGroup ? ' group' : ''}${isAssistant ? ' assistant' : ''}">${isAssistant ? assistantGlyphMarkup() : esc(initial(name))}</div>
    <div class="conv-info">
      <div class="conv-name${isAssistant ? ' with-verified' : ''}">${renderNameWithVerified(name, isAssistant)}</div>
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
  const isAssistant = !isGroup && isAssistantPartner(conv.partner);
  const name    = convName(conv);
  chatAvatar.innerHTML = isAssistant ? assistantGlyphMarkup() : esc(initial(name));
  chatAvatar.className = 'chat-header-avatar' + (isGroup ? ' group' : '') + (isAssistant ? ' assistant' : '');
  chatPartnerName.classList.toggle('with-verified', isAssistant);
  chatPartnerName.innerHTML = renderNameWithVerified(name, isAssistant);
  chatPartnerRole.textContent = isGroup
    ? 'Групова розмова'
    : (isAssistant ? 'Банківський асистент · Швидкі дії зверху' : '');
  syncAssistantUi(isAssistant);
  if (btnCall) btnCall.hidden = isGroup || isAssistant;

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

function escapeAttr(str) {
  return esc(str).replace(/'/g, '&#39;');
}

function trimLinkTail(raw) {
  let value = String(raw || '');
  let tail = '';
  while (value && /[),.;!?]$/.test(value)) {
    tail = value.slice(-1) + tail;
    value = value.slice(0, -1);
  }
  return { value, tail };
}

function normalizeMessageUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return text;
  if (text.startsWith('/')) return `${window.location.origin}${text}`;
  return text;
}

function formatMessageTextHtml(rawText) {
  const text = String(rawText || '');
  const urlRe = /(https?:\/\/[^\s<]+|\/api\/transactions\/(?:statement|export)\?[^\s<]+)/gi;
  let out = '';
  let lastIdx = 0;
  let match;
  while ((match = urlRe.exec(text)) !== null) {
    const rawUrl = String(match[0] || '');
    const start = match.index || 0;
    out += esc(text.slice(lastIdx, start));
    const cleaned = trimLinkTail(rawUrl);
    const href = normalizeMessageUrl(cleaned.value);
    const label = cleaned.value.length > 86 ? `${cleaned.value.slice(0, 72)}...` : cleaned.value;
    out += `<a class="msg-link" href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>${esc(cleaned.tail)}`;
    lastIdx = start + rawUrl.length;
  }
  out += esc(text.slice(lastIdx));
  return out.replace(/\n/g, '<br>');
}

function parseAssistantStatementInfo(rawText) {
  const text = String(rawText || '');
  if (!/виписк|statement/i.test(text)) return null;
  const linkMatch = text.match(/(https?:\/\/[^\s]+|\/api\/transactions\/(?:statement|export)\?[^\s]+)/i);
  if (!linkMatch) return null;
  const cleaned = trimLinkTail(linkMatch[1]);
  const link = cleaned.value;
  const periodMatch = text.match(/\((\d{4}-\d{2}-\d{2}\s*→\s*\d{4}-\d{2}-\d{2})\)/);
  const kind = /\/api\/transactions\/export\?/i.test(link) || /\bcsv\b/i.test(text) ? 'CSV' : 'PDF';
  const summaryRaw = text.split(/завантажити:/i)[0] || '';
  return {
    link: normalizeMessageUrl(link),
    kind,
    period: periodMatch ? periodMatch[1] : '',
    summary: summaryRaw.trim() || `${kind}-виписка підготовлена.`,
  };
}

function buildAssistantStatementBubble(rawText) {
  const info = parseAssistantStatementInfo(rawText);
  if (!info?.link) return null;
  const icon = info.kind === 'PDF' ? '📄' : '🧾';
  const periodHtml = info.period ? `<div class="assistant-statement-period">Період: ${esc(info.period)}</div>` : '';
  return `<div class="msg-bubble assistant-statement-bubble">
    <div class="assistant-statement-head">
      <span class="assistant-statement-icon" aria-hidden="true">${icon}</span>
      <div>
        <div class="assistant-statement-title">${esc(info.kind)}-виписка готова</div>
        ${periodHtml}
      </div>
    </div>
    <div class="assistant-statement-summary">${formatMessageTextHtml(info.summary)}</div>
    <a class="assistant-statement-btn" href="${escapeAttr(info.link)}" target="_blank" rel="noopener noreferrer">Відкрити ${esc(info.kind)}</a>
    <div class="assistant-statement-note">Завантаження відкриється в захищеному режимі Army Bank.</div>
  </div>`;
}

function buildBubble(msg) {
  const isMe    = msg.sender_id === (me?.id);
  const wrap    = document.createElement('div');
  const assistantIncoming = (!isMe && isAssistantPartner(activePartner));
  wrap.className = `msg-bubble-wrap ${isMe ? 'me' : 'them'}${assistantIncoming ? ' assistant' : ''}`;
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
    const statementBubble = assistantIncoming ? buildAssistantStatementBubble(msg.text) : null;
    content = statementBubble || `<div class="msg-bubble">${formatMessageTextHtml(msg.text)}</div>`;
  }

  wrap.innerHTML = `
    ${!isMe ? `<div class="msg-sender-avatar${assistantIncoming ? ' assistant' : ''}">${assistantIncoming ? assistantGlyphMarkup() : esc(ini)}</div>` : ''}
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
  if (text.startsWith('/')) {
    try {
      const handled = await handleChatCommand(text);
      if (handled) {
        msgInput.value = '';
        msgInput.style.height = 'auto';
        updateSendBtn();
        return;
      }
    } catch (err) {
      showToast(err.message || 'Не вдалося виконати команду.', true);
      return;
    }
  }
  msgInput.value = '';
  msgInput.style.height = 'auto';
  updateSendBtn();
  try {
    await sendTextToActiveChat(text);
  } catch (err) {
    showToast(err.message, true);
    msgInput.value = text;
    updateSendBtn();
  }
}

async function runAssistantQuickAction(action, btnEl = null) {
  if (!activeConvId || !isAssistantPartner(activePartner)) return;
  if (btnEl) btnEl.disabled = true;
  try {
    const sendCommand = async commandText => {
      await sendTextToActiveChat(commandText);
    };
    if (action === 'balance') {
      await sendCommand('/баланс');
      return;
    }
    if (action === 'menu') {
      await sendCommand('/меню');
      return;
    }
    if (action === 'recent') {
      await sendCommand('/операції 7');
      return;
    }
    if (action === 'analytics') {
      await sendCommand('/аналітика');
      return;
    }
    if (action === 'insights') {
      await sendCommand('/інсайти');
      return;
    }
    if (action === 'statement_pdf') {
      await sendCommand('/виписка pdf');
      return;
    }
    if (action === 'statement_csv') {
      await sendCommand('/виписка csv');
      return;
    }
    if (action === 'cards') {
      await sendCommand('/карти');
      return;
    }
    if (action === 'requisites') {
      await sendCommand('/реквізити');
      return;
    }
    if (action === 'goals') {
      await sendCommand('/цілі');
      return;
    }
    if (action === 'templates') {
      await sendCommand('/шаблони');
      return;
    }
    if (action === 'contacts') {
      await sendCommand('/контакти');
      return;
    }
    if (action === 'budget') {
      await sendCommand('/бюджет');
      return;
    }
    if (action === 'debts') {
      await sendCommand('/борги');
      return;
    }
    if (action === 'recurring') {
      await sendCommand('/регулярні');
      return;
    }
    if (action === 'achievements') {
      await sendCommand('/досягнення');
      return;
    }
    if (action === 'security') {
      await sendCommand('/безпека');
      return;
    }
    if (action === 'bank_tools') {
      await openBankToolsModal();
      return;
    }
    if (action === 'transfer_help') {
      await sendCommand('/переказ');
      return;
    }
    await sendCommand(String(action || '/меню'));
  } catch (err) {
    showToast(err.message || 'Не вдалося виконати швидку дію.', true);
  } finally {
    if (btnEl) {
      setTimeout(() => { btnEl.disabled = false; }, 320);
    }
  }
}

async function handleChatCommand(rawText) {
  const cmd = String(rawText || '').trim().toLowerCase();
  if (!cmd) return false;
  if (cmd === '/банк' || cmd === '/bank') {
    await openBankToolsModal();
    return true;
  }
  if (cmd === '/баланс' || cmd === '/balance') {
    const summary = await api('GET', '/messenger/bank/summary');
    await sendTextToActiveChat(summary.share_text || 'Не вдалося сформувати зведення по рахунку.');
    return true;
  }
  if (cmd.startsWith('/виписка') || cmd.startsWith('/statement')) {
    const fmt = cmd.includes('csv') ? 'csv' : 'pdf';
    const order = await createStatementOrder(fmt);
    await sendTextToActiveChat(order.share_text || 'Запит виписки створено.');
    await downloadProtectedFile(
      order.download_path,
      fmt === 'csv' ? 'armybank_statement.csv' : 'armybank_statement.pdf',
    );
    showToast(`Виписку ${fmt.toUpperCase()} підготовлено.`);
    return true;
  }
  return false;
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
  if (groupNameInput) groupNameInput.value = '';
  if (groupUserSearch) groupUserSearch.value = '';
  if (groupUserResults) groupUserResults.innerHTML = '<p class="search-hint">Введіть ім\'я для пошуку</p>';
  groupSelectedUsers = [];
  renderGroupChips();
  renderGroupPreview();
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
  if (!isDirect) {
    renderGroupPreview();
    setTimeout(() => groupNameInput.focus(), 50);
  }
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
  renderGroupPreview();
  groupUserSearch.value = '';
  groupUserResults.innerHTML = '<p class="search-hint">Введіть ім\'я для пошуку</p>';
}

function removeGroupMember(uid) {
  groupSelectedUsers = groupSelectedUsers.filter(u => u.id !== uid);
  renderGroupChips();
  renderGroupPreview();
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

function renderGroupPreview() {
  const name = String(groupNameInput?.value || '').trim() || 'Нова група';
  const count = groupSelectedUsers.length;
  if (groupPreviewAvatar) groupPreviewAvatar.textContent = initial(name);
  if (groupPreviewName) groupPreviewName.textContent = name;
  if (groupPreviewSub) {
    groupPreviewSub.textContent = count > 0
      ? `${count} учасників · готово до створення`
      : 'Додайте учасників для створення';
  }
  if (!groupPreviewBadges) return;
  groupPreviewBadges.innerHTML = '';
  const visible = groupSelectedUsers.slice(0, 3);
  visible.forEach(user => {
    const badge = document.createElement('span');
    badge.className = 'group-preview-badge';
    badge.title = user.full_name || 'Учасник';
    badge.textContent = initial(user.full_name || '');
    groupPreviewBadges.appendChild(badge);
  });
  if (count > visible.length) {
    const more = document.createElement('span');
    more.className = 'group-preview-badge more';
    more.textContent = `+${count - visible.length}`;
    groupPreviewBadges.appendChild(more);
  }
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
    renderGroupPreview();
    if (!convData.find(c => c.id === conv.id)) convData.unshift(conv);
    renderConvList(convData);
    openChat(conv);
  } catch (err) { showToast(err.message, true); }
}

// ════════════════════════════════════════════
// WebRTC Calls
// ════════════════════════════════════════════
const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
let rtcConfig = { iceServers: [...DEFAULT_ICE_SERVERS] };
let rtcConfigLoaded = false;

function checkWebRTCSupport() {
  if (!window.RTCPeerConnection) {
    showToast('WebRTC не підтримується цим браузером.', true); return false;
  }
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    showToast('Дзвінки доступні лише по HTTPS.', true); return false;
  }
  return true;
}

function sanitizeIceServers(servers) {
  if (!Array.isArray(servers)) return [...DEFAULT_ICE_SERVERS];
  const out = [];
  for (const server of servers) {
    if (!server || typeof server !== 'object') continue;
    const urlsRaw = server.urls;
    const urls = Array.isArray(urlsRaw) ? urlsRaw.map(v => String(v || '').trim()).filter(Boolean) : [String(urlsRaw || '').trim()].filter(Boolean);
    if (!urls.length) continue;
    const item = { urls };
    if (server.username !== undefined && server.username !== null) item.username = String(server.username);
    if (server.credential !== undefined && server.credential !== null) item.credential = String(server.credential);
    out.push(item);
  }
  return out.length ? out : [...DEFAULT_ICE_SERVERS];
}

function hasTurnServer(config) {
  const list = Array.isArray(config?.iceServers) ? config.iceServers : [];
  return list.some(server => {
    const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];
    return urls.some(url => /^turns?:/i.test(String(url || '').trim()));
  });
}

async function ensureRtcConfig() {
  if (rtcConfigLoaded || !token) return;
  rtcConfigLoaded = true;
  try {
    const cfg = await api('GET', '/messenger/calls/config');
    rtcConfig = { iceServers: sanitizeIceServers(cfg?.ice_servers) };
  } catch (_) {
    rtcConfig = { iceServers: [...DEFAULT_ICE_SERVERS] };
  }
  if (!turnHintShown && !hasTurnServer(rtcConfig)) {
    turnHintShown = true;
    showToast('Рекомендується налаштувати TURN у Render для стабільних дзвінків.');
  }
}

function renderCallStatus() {
  const suffix = (callStatusBase === 'Підключено' && callQualityLabel) ? ` · ${callQualityLabel}` : '';
  if (callScreenStatus) callScreenStatus.textContent = `${callStatusBase}${suffix}`;
}

function setCallStatusBase(text) {
  callStatusBase = String(text || 'З\'єднання...');
  renderCallStatus();
}

async function requestCallWakeLock() {
  if (!activeCallId && callScreen.hidden) return;
  if (!('wakeLock' in navigator) || document.hidden) return;
  if (callWakeLock) return;
  try {
    callWakeLock = await navigator.wakeLock.request('screen');
    callWakeLock.addEventListener('release', () => { callWakeLock = null; });
  } catch (_) {}
}

async function ensureNotificationPermissionInteractive() {
  if (!window.Notification) return;
  if (Notification.permission !== 'default') return;
  try { await Notification.requestPermission(); } catch (_) {}
}

async function releaseCallWakeLock() {
  if (!callWakeLock) return;
  try { await callWakeLock.release(); } catch (_) {}
  callWakeLock = null;
}

async function getCallAudioStream() {
  const advanced = {
    audio: {
      echoCancellation: { ideal: true },
      noiseSuppression: { ideal: true },
      autoGainControl: { ideal: true },
      channelCount: { ideal: 1 },
      sampleRate: { ideal: 48000 },
      sampleSize: { ideal: 16 },
    },
    video: false,
  };
  try {
    return await navigator.mediaDevices.getUserMedia(advanced);
  } catch (_) {}
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  } catch (_) {}
  return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
}

function optimizeOutgoingAudio(pc, stream) {
  try {
    const track = stream?.getAudioTracks?.()[0];
    if (track && 'contentHint' in track) track.contentHint = 'speech';
  } catch (_) {}
  try {
    const sender = pc?.getSenders?.().find(s => s?.track && s.track.kind === 'audio');
    if (!sender || typeof sender.getParameters !== 'function' || typeof sender.setParameters !== 'function') return;
    const params = sender.getParameters() || {};
    if (!Array.isArray(params.encodings) || !params.encodings.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = 40000;
    params.encodings[0].priority = 'high';
    sender.setParameters(params).catch(() => {});
  } catch (_) {}
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
  if (!ctx || ctx.state !== 'running' || !callPrefs.sounds) return;
  const waveform = opts.wave || 'sine';
  const baseGain = Number.isFinite(opts.gain) ? opts.gain : 0.028;
  const gainV = Math.max(0.0001, baseGain * clampNumber(callPrefs.volume, 0, 1, 0.7));
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
  if (navigator.vibrate && callPrefs.vibration) navigator.vibrate(0);
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
  if (!callPrefs.sounds) return;
  toneBeep(740, 0.09, { gain: 0.024 });
  toneBeep(980, 0.11, { gain: 0.024, delay: 0.11 });
}

function playEndTone(error = false) {
  if (!callPrefs.sounds) return;
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
  if (!callPrefs.sounds && !callPrefs.vibration) return;
  await ensureCallAudioCtx();

  const ringBurst = () => {
    toneBeep(760, 0.12, { gain: 0.03 });
    toneBeep(930, 0.15, { gain: 0.03, delay: 0.18 });
  };
  ringBurst();
  incomingToneTimer = setInterval(ringBurst, 2200);
  if (navigator.vibrate && callPrefs.vibration) navigator.vibrate([130, 90, 130]);
}

async function startOutgoingTone() {
  stopIncomingTone();
  if (!callPrefs.sounds) return;
  await ensureCallAudioCtx();

  const ringback = () => {
    toneBeep(430, 0.32, { wave: 'triangle', gain: 0.022 });
    toneBeep(480, 0.32, { wave: 'triangle', gain: 0.016, delay: 0.02 });
  };
  ringback();
  outgoingToneTimer = setInterval(ringback, 1000);
}

function clearOutgoingNoAnswerTimer() {
  if (outgoingNoAnswerTimer) {
    clearTimeout(outgoingNoAnswerTimer);
    outgoingNoAnswerTimer = null;
  }
}

function clearIncomingTimeoutTimers() {
  if (incomingAutoRejectTimer) {
    clearTimeout(incomingAutoRejectTimer);
    incomingAutoRejectTimer = null;
  }
  if (incomingCountdownTimer) {
    clearInterval(incomingCountdownTimer);
    incomingCountdownTimer = null;
  }
  if (callIncomingLabel) callIncomingLabel.textContent = 'Голосовий дзвінок';
}

function startOutgoingNoAnswerTimer(callId) {
  clearOutgoingNoAnswerTimer();
  const timeoutSec = Math.max(15, Number(callPrefs.outgoingTimeoutSec || 35));
  outgoingNoAnswerTimer = setTimeout(() => {
    if (!activeCallId || activeCallId !== callId) return;
    if (remoteSdpSet || callConnectedOnce) return;
    showToast('Абонент не відповідає.', true);
    hangupCall(true, 'missed');
  }, timeoutSec * 1000);
}

function startIncomingAutoRejectTimer(callId) {
  clearIncomingTimeoutTimers();
  const timeoutSec = Math.max(15, Number(callPrefs.incomingTimeoutSec || 45));
  let remain = timeoutSec;
  if (callIncomingLabel) callIncomingLabel.textContent = `Голосовий дзвінок · ${remain}с`;
  incomingCountdownTimer = setInterval(() => {
    remain = Math.max(0, remain - 1);
    if (callIncomingLabel) callIncomingLabel.textContent = `Голосовий дзвінок · ${remain}с`;
    if (remain <= 0) clearIncomingTimeoutTimers();
  }, 1000);

  incomingAutoRejectTimer = setTimeout(() => {
    if (!incomingCallId || incomingCallId !== callId) return;
    api('PUT', `/messenger/calls/${callId}/reject`).catch(() => {});
    hideIncoming();
    playEndTone(false);
    showToast('Пропущений дзвінок.');
  }, timeoutSec * 1000);
}

function normalizeSdp(raw, label = 'SDP') {
  let sdp = raw;

  if (sdp && typeof sdp === 'object' && typeof sdp.sdp === 'string') {
    sdp = sdp.sdp;
  }

  if (typeof sdp !== 'string') sdp = String(sdp || '');
  sdp = sdp.replace(/^\uFEFF/, '').trim();
  if (!sdp) throw new Error(`${label} порожній.`);

  // Legacy compatibility: some clients stored JSON wrapper or escaped newlines.
  if (sdp[0] === '{' || sdp[0] === '"') {
    try {
      const parsed = JSON.parse(sdp);
      if (parsed && typeof parsed.sdp === 'string') sdp = parsed.sdp;
      else if (typeof parsed === 'string') sdp = parsed;
    } catch (_) {}
  }

  if (sdp.includes('\\r\\n')) sdp = sdp.replace(/\\r\\n/g, '\n');
  if (sdp.includes('\\n') && !sdp.includes('\n')) sdp = sdp.replace(/\\n/g, '\n');
  sdp = sdp.replace(/\r\n?/g, '\n').replace(/\u0000/g, '');

  const rawLines = sdp
    .split('\n')
    .map(line => String(line || '').trim())
    .filter(Boolean);
  const start = rawLines.findIndex(line => line === 'v=0' || line.startsWith('v=0 '));
  if (start > 0) rawLines.splice(0, start);
  const filtered = rawLines.filter(line => /^[a-z]=/i.test(line));
  sdp = filtered.join('\r\n');
  if (sdp) sdp += '\r\n';

  if (!/^v=0(?:\r\n|\n)/.test(sdp)) {
    throw new Error(`Некоректний формат ${label.toLowerCase()}.`);
  }
  return sdp;
}

function cleanupSdpForFallback(sdp, errorMessage = '') {
  const originalLines = String(sdp || '').split(/\r\n|\n|\r/).filter(Boolean);
  if (!originalLines.length) return sdp;

  const msg = String(errorMessage || '');
  let lines = originalLines;
  const lineMatch = msg.match(/([a-z]=[^\r\n]+)\s+Invalid SDP line/i);
  if (lineMatch && lineMatch[1]) {
    const badLine = lineMatch[1].trim();
    lines = lines.filter(line => line.trim() !== badLine);
  }

  const compacted = lines.join('\r\n') + '\r\n';
  if (compacted !== sdp) return compacted;

  // Last-resort compatibility for strict parsers: drop legacy SSRC attributes.
  const relaxed = originalLines.filter(line => !/^a=ssrc(?::|-group:)/i.test(String(line).trim()));
  return (relaxed.join('\r\n') + '\r\n');
}

async function setRemoteDescriptionSafe(pc, desc, label) {
  try {
    await pc.setRemoteDescription(desc);
  } catch (err) {
    const msg = String(err?.message || err || '');
    if (!/Invalid SDP line|Failed to parse SessionDescription|parse SessionDescription|OperationError/i.test(msg)) {
      throw err;
    }
    const fallbackSdp = cleanupSdpForFallback(desc.sdp, msg);
    if (!fallbackSdp || fallbackSdp === desc.sdp) throw err;
    await pc.setRemoteDescription({ ...desc, sdp: fallbackSdp });
  }
}

function normalizeIceCandidate(raw) {
  let cand = raw;
  if (typeof cand === 'string') {
    const text = cand.trim();
    if (!text) return null;
    try {
      cand = JSON.parse(text);
    } catch (_) {
      const line = text.startsWith('a=') ? text.slice(2) : text;
      cand = { candidate: line, sdpMLineIndex: 0, sdpMid: '0' };
    }
  }
  if (!cand || typeof cand !== 'object') return null;
  let candidate = String(cand.candidate || '').trim();
  if (!candidate) return null;
  if (candidate.startsWith('a=')) candidate = candidate.slice(2);
  const out = { candidate };
  if (cand.sdpMid !== undefined && cand.sdpMid !== null && cand.sdpMid !== '') {
    out.sdpMid = String(cand.sdpMid);
  }
  if (cand.sdpMLineIndex !== undefined && cand.sdpMLineIndex !== null && Number.isFinite(Number(cand.sdpMLineIndex))) {
    out.sdpMLineIndex = Number(cand.sdpMLineIndex);
  }
  if (cand.usernameFragment !== undefined && cand.usernameFragment !== null && cand.usernameFragment !== '') {
    out.usernameFragment = String(cand.usernameFragment);
  }
  return out;
}

function stopCallQualityMonitor() {
  if (callQualityTimer) {
    clearInterval(callQualityTimer);
    callQualityTimer = null;
  }
  callQualityLabel = '';
}

async function sampleCallQuality() {
  if (!peerConnection || !callConnectedOnce || typeof peerConnection.getStats !== 'function') return;
  try {
    const stats = await peerConnection.getStats();
    let jitter = null;
    let rtt = null;
    let lossRatio = null;
    stats.forEach(report => {
      if (report.type === 'remote-inbound-rtp' && report.kind === 'audio') {
        if (Number.isFinite(report.jitter)) jitter = report.jitter;
        if (Number.isFinite(report.roundTripTime)) rtt = report.roundTripTime;
        const lost = Number(report.packetsLost || 0);
        const recv = Number(report.packetsReceived || 0);
        if (recv > 0 && lost >= 0) lossRatio = Math.max(0, lost / (recv + lost));
      } else if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        if (Number.isFinite(report.currentRoundTripTime)) rtt = report.currentRoundTripTime;
      }
    });

    let quality = '';
    if ((lossRatio !== null && lossRatio > 0.08) || (jitter !== null && jitter > 0.04) || (rtt !== null && rtt > 0.35)) {
      quality = 'якість слабка';
    } else if ((lossRatio !== null && lossRatio > 0.03) || (jitter !== null && jitter > 0.02) || (rtt !== null && rtt > 0.2)) {
      quality = 'мережа нестабільна';
    } else if (lossRatio !== null || jitter !== null || rtt !== null) {
      quality = 'якість добра';
    }

    if (quality !== callQualityLabel) {
      callQualityLabel = quality;
      renderCallStatus();
    }
  } catch (_) {}
}

function startCallQualityMonitor() {
  stopCallQualityMonitor();
  sampleCallQuality().catch(() => {});
  callQualityTimer = setInterval(() => { sampleCallQuality().catch(() => {}); }, 3500);
}

function buildPeerConnection() {
  const pc = new RTCPeerConnection(rtcConfig);

  pc.ontrack = e => {
    if (remoteAudio.srcObject !== e.streams[0]) remoteAudio.srcObject = e.streams[0];
  };

  pc.onicecandidate = e => {
    if (!e.candidate) return;
    const cand = normalizeIceCandidate(e.candidate?.toJSON ? e.candidate.toJSON() : e.candidate);
    if (!cand) return;
    if (activeCallId) {
      api('POST', `/messenger/calls/${activeCallId}/ice`, { candidate: cand }).catch(() => {});
    } else {
      pendingLocalIce.push(cand);
    }
  };

  pc.oniceconnectionstatechange = () => {
    const st = pc.iceConnectionState;
    if (st === 'connected' || st === 'completed') {
      setCallStatusBase('Підключено');
      stopAllCallTones();
      if (!callConnectedOnce) {
        callConnectedOnce = true;
        playConnectedTone();
      }
      if (!callWallTimer) startCallTimer();
      if (!callQualityTimer) startCallQualityMonitor();
      requestCallWakeLock().catch(() => {});
    } else if (st === 'disconnected') {
      setCallStatusBase('Відновлення...');
      pollCall().catch(() => {});
    } else if (st === 'failed') {
      showToast('З\'єднання перервано.', true);
      hangupCall(true, 'error');
    }
  };

  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (st === 'connected') {
      setCallStatusBase('Підключено');
      if (!callWallTimer) startCallTimer();
      if (!callQualityTimer) startCallQualityMonitor();
      requestCallWakeLock().catch(() => {});
    } else if (st === 'disconnected') {
      setCallStatusBase('Відновлення...');
    } else if (st === 'failed' || st === 'closed') {
      hangupCall(true, 'error');
    }
  };

  return pc;
}

async function flushLocalIce() {
  for (const c of pendingLocalIce) {
    const cand = normalizeIceCandidate(c);
    if (!cand) continue;
    api('POST', `/messenger/calls/${activeCallId}/ice`, { candidate: cand }).catch(() => {});
  }
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
  if (callAcceptInProgress) return;
  if (!checkWebRTCSupport()) return;
  ensureNotificationPermissionInteractive().catch(() => {});
  await ensureRtcConfig();

  try {
    localStream = await getCallAudioStream();
  } catch (err) { showToast(micError(err), true); return; }

  peerConnection = buildPeerConnection();
  localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
  optimizeOutgoingAudio(peerConnection, localStream);

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
    callConnectedOnce = false;
    await flushLocalIce();
    showCallScreen(activePartner.full_name, 'Виклик...');
    startOutgoingTone().catch(() => {});
    startOutgoingNoAnswerTimer(call_id);
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
  incomingCheckTimer = setInterval(checkIncoming, 2000);
}

async function checkIncoming() {
  if (activeCallId || callAcceptInProgress || (callScreen && !callScreen.hidden)) return;
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
      startIncomingAutoRejectTimer(c.id);
      if (document.hidden && window.Notification && Notification.permission === 'granted') {
        try {
          const n = new Notification('Вхідний дзвінок', {
            body: incomingCallerName,
            tag: `ab-incoming-${c.id}`,
            icon: '/icons/chat-icon-180.png',
          });
          n.onclick = () => { try { window.focus(); } catch (_) {} n.close(); };
          setTimeout(() => n.close(), 9000);
        } catch (_) {}
      }
      syncOverlayLock();
    } else if (!calls?.length && incomingCallId) {
      hideIncoming(); // cancelled before answer
    }
  } catch (_) {}
}

function hideIncoming() {
  clearIncomingTimeoutTimers();
  stopIncomingTone();
  if (callIncoming) callIncoming.classList.remove('shake');
  callIncoming.hidden = true;
  incomingCallId = null;
  incomingCallerName = '';
  syncOverlayLock();
}

// ── Accept / Reject ────────────────────────
async function acceptCall() {
  if (!incomingCallId || callAcceptInProgress) return;
  callAcceptInProgress = true;
  const callId = incomingCallId;
  hideIncoming();
  if (!checkWebRTCSupport()) {
    callAcceptInProgress = false;
    api('PUT', `/messenger/calls/${callId}/reject`).catch(() => {}); return;
  }
  ensureNotificationPermissionInteractive().catch(() => {});
  await ensureRtcConfig();

  try {
    localStream = await getCallAudioStream();
  } catch (err) {
    showToast(micError(err), true);
    callAcceptInProgress = false;
    api('PUT', `/messenger/calls/${callId}/reject`).catch(() => {}); return;
  }

  try {
    const callData = await api('GET', `/messenger/calls/${callId}`);
    peerConnection = buildPeerConnection();
    localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
    optimizeOutgoingAudio(peerConnection, localStream);
    pendingLocalIce  = [];
    pendingRemoteIce = [];

    const offerSdp = normalizeSdp(callData.sdp_offer, 'SDP offer');
    await setRemoteDescriptionSafe(peerConnection, { type: 'offer', sdp: offerSdp }, 'SDP offer');
    remoteSdpSet = true;
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    const answerSdp = normalizeSdp(answer.sdp || peerConnection?.localDescription?.sdp || '', 'SDP answer');
    await api('PUT', `/messenger/calls/${callId}/answer`, { sdp_answer: answerSdp });

    activeCallId  = callId;
    icePollLastId = 0;
    callConnectedOnce = false;
    clearOutgoingNoAnswerTimer();
    await flushLocalIce();
    showCallScreen(callData.caller_name || 'Дзвінок', 'З\'єднання...');
    startCallPoll();
  } catch (err) {
    showToast(err.message || 'Помилка підключення дзвінка.', true);
    api('PUT', `/messenger/calls/${callId}/reject`).catch(() => {});
    cleanupPeer();
  } finally {
    callAcceptInProgress = false;
  }
}

async function rejectCall() {
  const id = incomingCallId;
  hideIncoming();
  playEndTone(false);
  clearOutgoingNoAnswerTimer();
  if (id) api('PUT', `/messenger/calls/${id}/reject`).catch(() => {});
}

// ── Call polling ───────────────────────────
function startCallPoll(intervalMs = (document.hidden ? 2500 : 1500)) {
  clearInterval(callPollTimer);
  callPollTimer = setInterval(pollCall, intervalMs);
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
        await setRemoteDescriptionSafe(peerConnection, { type: 'answer', sdp: answerSdp }, 'SDP answer');
        remoteSdpSet = true;
        stopOutgoingTone();
        clearOutgoingNoAnswerTimer();
        setCallStatusBase('З\'єднання...');
        await flushRemoteIce(peerConnection);
      }
    }

    // Both: receive ICE candidates from the other peer
    const ices = await api('GET', `/messenger/calls/${activeCallId}/ice?after_id=${icePollLastId}`);
    if (ices?.length) {
      for (const ice of ices) {
        const cand = normalizeIceCandidate(ice.candidate);
        if (!cand) continue;
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
  hideIncoming();
  callScreenAvatar.textContent = initial(name);
  callScreenName.textContent   = name;
  callStatusBase = String(status || 'З\'єднання...');
  callQualityLabel = '';
  renderCallStatus();
  callScreenTimer.hidden       = true;
  callScreen.hidden            = false;
  callConnectedOnce            = false;
  callStartAtMs                = 0;
  callBackgroundNotifiedForId  = null;
  requestCallWakeLock().catch(() => {});
  syncOverlayLock();
}

function renderCallTimer() {
  const elapsed = Math.max(0, Math.floor((Date.now() - callStartAtMs) / 1000));
  callSeconds = elapsed;
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  callScreenTimer.textContent = `${m}:${s}`;
}

function startCallTimer() {
  if (!callStartAtMs) callStartAtMs = Date.now();
  callScreenTimer.hidden = false;
  renderCallTimer();
  clearInterval(callWallTimer);
  callWallTimer = setInterval(() => {
    renderCallTimer();
  }, 1000);
}

async function hangupCall(notify = true, reason = 'ended') {
  const hadVisibleCall = !callScreen.hidden || !!activeCallId || callConnectedOnce;
  if (notify && activeCallId)
    api('PUT', `/messenger/calls/${activeCallId}/end`).catch(() => {});
  stopAllCallTones();
  clearIncomingTimeoutTimers();
  clearOutgoingNoAnswerTimer();
  clearInterval(callPollTimer);
  clearInterval(callWallTimer);
  callWallTimer    = null;
  stopCallQualityMonitor();
  releaseCallWakeLock().catch(() => {});
  cleanupPeer();
  activeCallId     = null;
  remoteSdpSet     = false;
  icePollLastId    = 0;
  pendingLocalIce  = [];
  pendingRemoteIce = [];
  isMuted          = false;
  callConnectedOnce = false;
  callAcceptInProgress = false;
  callStartAtMs = 0;
  callStatusBase = 'З\'єднання...';
  callQualityLabel = '';
  callBackgroundNotifiedForId = null;
  callScreen.hidden       = true;
  callScreenTimer.hidden  = true;
  if (btnMute) btnMute.classList.remove('muted');
  if (hadVisibleCall) {
    playEndTone(reason === 'error');
  }
  syncOverlayLock();
}

function handleVisibilityChange() {
  if (document.hidden) {
    if (activeCallId) {
      startCallPoll(2500);
      if (window.Notification && Notification.permission === 'granted' && callBackgroundNotifiedForId !== activeCallId) {
        try {
          const title = callConnectedOnce ? 'Дзвінок триває у фоні' : 'Підключення дзвінка у фоні';
          const body = activePartner?.full_name || callScreenName?.textContent || 'Месенджер';
          const n = new Notification(title, {
            body,
            tag: `ab-call-${activeCallId}`,
            icon: '/icons/chat-icon-180.png',
          });
          n.onclick = () => { try { window.focus(); } catch (_) {} n.close(); };
          setTimeout(() => n.close(), 8000);
          callBackgroundNotifiedForId = activeCallId;
        } catch (_) {}
      }
    }
    return;
  }

  if (activeCallId) {
    startCallPoll(1500);
    pollCall().catch(() => {});
    requestCallWakeLock().catch(() => {});
    if (callConnectedOnce && !callWallTimer) startCallTimer();
    if (callConnectedOnce && !callQualityTimer) startCallQualityMonitor();
  }
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
  if (/\/api\/transactions\/statement\?/i.test(raw)) return '📄 PDF-виписка готова';
  if (/\/api\/transactions\/export\?/i.test(raw)) return '🧾 CSV-виписка готова';
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
if (btnBankTools) btnBankTools.addEventListener('click', () => { openBankToolsModal().catch(err => showToast(err.message, true)); });
if (btnCloseBankTools) btnCloseBankTools.addEventListener('click', closeBankToolsModal);
if (bankToolsModal) {
  bankToolsModal.addEventListener('click', e => {
    if (e.target === bankToolsModal) closeBankToolsModal();
  });
}
if (btnBankRefresh) btnBankRefresh.addEventListener('click', () => { refreshBankPanel().catch(err => showToast(err.message, true)); });
if (btnBankSendSummary) btnBankSendSummary.addEventListener('click', () => { handleBankSummaryShare().catch(err => showToast(err.message, true)); });
if (btnBankDownloadPdf) btnBankDownloadPdf.addEventListener('click', () => { handleBankDownload('pdf').catch(err => showToast(err.message, true)); });
if (btnBankDownloadCsv) btnBankDownloadCsv.addEventListener('click', () => { handleBankDownload('csv').catch(err => showToast(err.message, true)); });
if (btnBankSendOrderMsg) btnBankSendOrderMsg.addEventListener('click', () => { handleBankOrderShare().catch(err => showToast(err.message, true)); });
if (btnCloseCallSettings) btnCloseCallSettings.addEventListener('click', closeCallSettingsModal);
if (callSettingsModal) {
  callSettingsModal.addEventListener('click', e => {
    if (e.target === callSettingsModal) closeCallSettingsModal();
  });
}
callSettingsButtons.forEach(btn => {
  btn.addEventListener('click', openCallSettingsModal);
});
if (callSoundsToggle) {
  callSoundsToggle.addEventListener('change', () => {
    callPrefs.sounds = !!callSoundsToggle.checked;
    saveCallPrefs();
    if (!callPrefs.sounds) stopAllCallTones();
  });
}
if (callVibrateToggle) {
  callVibrateToggle.addEventListener('change', () => {
    callPrefs.vibration = !!callVibrateToggle.checked;
    saveCallPrefs();
    if (!callPrefs.vibration && navigator.vibrate) navigator.vibrate(0);
  });
}
if (callVolumeRange) {
  callVolumeRange.addEventListener('input', () => {
    const v = clampNumber(callVolumeRange.value, 0, 100, 70);
    callPrefs.volume = Math.round(v) / 100;
    if (callVolumeValue) callVolumeValue.textContent = `${Math.round(v)}%`;
    saveCallPrefs();
  });
}
if (outgoingTimeoutRange) {
  outgoingTimeoutRange.addEventListener('input', () => {
    const v = Math.round(clampNumber(outgoingTimeoutRange.value, 15, 90, 35));
    callPrefs.outgoingTimeoutSec = v;
    if (outgoingTimeoutValue) outgoingTimeoutValue.textContent = `${v}с`;
    saveCallPrefs();
  });
}
if (incomingTimeoutRange) {
  incomingTimeoutRange.addEventListener('input', () => {
    const v = Math.round(clampNumber(incomingTimeoutRange.value, 15, 90, 45));
    callPrefs.incomingTimeoutSec = v;
    if (incomingTimeoutValue) incomingTimeoutValue.textContent = `${v}с`;
    saveCallPrefs();
  });
}
if (btnCallTestSound) {
  btnCallTestSound.addEventListener('click', () => { previewCallSignal().catch(() => {}); });
}
if (btnCallReset) {
  btnCallReset.addEventListener('click', resetCallPrefsToDefaults);
}
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
    if (bankToolsModal && !bankToolsModal.hidden) { closeBankToolsModal(); return; }
    if (callSettingsModal && !callSettingsModal.hidden) { closeCallSettingsModal(); return; }
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
if (groupNameInput) {
  groupNameInput.addEventListener('input', renderGroupPreview);
}
btnCreateGroup.addEventListener('click', createGroup);

btnBack.addEventListener('click', () => {
  if (isRecording) stopRecording(false);
  sidebar.classList.remove('hidden');
  activeConvId = null;
  activePartner = null;
  clearInterval(convPollTimer);
  chatView.hidden = true;
  chatEmpty.hidden = false;
  syncAssistantUi(false);
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
if (assistantQuickActions) {
  assistantQuickActions.addEventListener('click', e => {
    const btn = e.target instanceof Element ? e.target.closest('.assistant-quick-btn') : null;
    if (!btn) return;
    const action = String(btn.dataset.assistantAction || '').trim();
    if (!action) return;
    runAssistantQuickAction(action, btn);
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
document.addEventListener('visibilitychange', handleVisibilityChange);
window.addEventListener('pageshow', () => {
  handleVisibilityChange();
});
window.addEventListener('pointerdown', primeCallAudioOnUserGesture, { once: true, passive: true });
window.addEventListener('keydown', primeCallAudioOnUserGesture, { once: true });

// ════════════════════════════════════════════
// Boot
// ════════════════════════════════════════════
renderCallSettings();
renderGroupPreview();
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

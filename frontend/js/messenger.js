/* ════════════════════════════════════════════
   ARM CRM — Messenger PWA
   groups · voice messages · WebRTC calls
════════════════════════════════════════════ */
'use strict';

const BASE = window.ARMY_BANK_BASE || '';
const API  = BASE + '/api';
const MESSENGER_ASSET_VERSION = '58';
// Мають точно збігатися з _SAVED_MESSAGES_NAME/_SCHEDULER_NAME у backend/routes/messenger_routes.py
const SAVED_MESSAGES_NAME = '🔖 Збережені повідомлення';
const SCHEDULER_NAME = '📅 Планувальник';
const SELF_CHAT_NAMES = [SAVED_MESSAGES_NAME, SCHEDULER_NAME];
const TOKEN_KEY = 'msng_token';
const USER_KEY  = 'msng_user';
const BANK_TOKEN_KEY = 'army_bank_token';
const CALL_PREFS_KEY = 'msng_call_prefs_v1';
const PERM_STATE_KEY = 'msng_permission_state_v1';
const API_DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_MSG_PLACEHOLDER = 'Напишіть повідомлення...';
const DEFAULT_CALL_PREFS = Object.freeze({
  sounds: true,
  vibration: true,
  volume: 0.7,
  outgoingTimeoutSec: 35,
  incomingTimeoutSec: 45,
  dataSaver: false,
});

// ── Auth state ─────────────────────────────
// "Запам'ятати пароль" вимкнено → сесія лежить у sessionStorage (зникає з
// закриттям вкладки), увімкнено (за замовчуванням) → у localStorage, як і раніше.
let token = localStorage.getItem(TOKEN_KEY) || localStorage.getItem(BANK_TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || null;
let me    = JSON.parse(localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY) || 'null');
if (token && !localStorage.getItem(TOKEN_KEY) && !sessionStorage.getItem(TOKEN_KEY)) {
  localStorage.setItem(TOKEN_KEY, token);
}
if (token) {
  localStorage.setItem(BANK_TOKEN_KEY, token);
}

// ── Chat state ─────────────────────────────
let activeConvId   = null;
let activePartner  = null;
let lastMsgId      = 0;
let convData       = [];
let isLoadingOlder = false;
let noMoreOlder    = false;
let unreadWhileScrolledUp = 0;
let isNearBottom = true;

// ── Timers ─────────────────────────────────
let globalPollTimer    = null;
let convPollTimer      = null;
let presencePollTimer  = null;
let searchTimer        = null;
let toastTimer         = null;
let groupSearchTimer   = null;
let incomingCheckTimer = null;
let callPollTimer      = null;
let callWallTimer      = null;
let outgoingNoAnswerTimer = null;
let incomingAutoRejectTimer = null;
let incomingCountdownTimer = null;
let isAppOnline = navigator.onLine !== false;
let pollBusyConversations = false;
let pollBusyUnread = false;
let pollBusyMessages = false;
let pollBusyPresence = false;
let pollBusyConvPresence = false;
let pollBusyIncoming = false;
let pushActionInFlight = false;
let pushReadyCache = false;
let lastPushSetupError = '';
let lastConvPresenceSyncAt = 0;
let lastFocusSyncAt = 0;

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
let activeCallIsGroup  = false;
let activeCallConvId   = null;
let peerConnection     = null;
let localStream        = null;
let callSeconds        = 0;
let icePollLastId      = 0;
let isMuted            = false;
let remoteSdpSet       = false;
let lastProcessedOfferSdp = null;
let pendingLocalIce    = [];
let pendingRemoteIce   = [];
let incomingCallId     = null;
let incomingCallerName = '';
let callConnectedOnce  = false;
let callAcceptInProgress = false;
let callDialInProgress = false;
let callStartAtMs = 0;
let callQualityTimer = null;
let callQualityLabel = '';
let callStatusBase = 'З\'єднання...';
let callWakeLock = null;
let callBackgroundNotifiedForId = null;
let callIceRecoverTimer = null;
let callIceRecoverAttempts = 0;
let callIceRestartInFlight = false;
let callForceRelay = false;
let turnHintShown = false;
let bankSummaryCache = null;
let bankProfileLinked = true;
let groupSignalLastId = 0;
let incomingCallIsGroup = false;
let incomingCallGroupName = '';
const groupPeerConnections = new Map(); // userId -> { pc, remoteSet, offerSent, name }
const groupPeerAudio = new Map(); // userId -> HTMLAudioElement

// ── Call audio state ───────────────────────
let callAudioCtx       = null;
let incomingToneTimer  = null;
let outgoingToneTimer  = null;
let callAudioPrimed    = false;
let callPrefs          = loadCallPrefs();

// ── Presence cache ─────────────────────────
let presenceCache = {};
let permState = loadPermState();

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
const authRememberMe    = $('auth-remember');
const authError         = $('auth-error');
const btnLogin          = $('btn-login');
const btnLoginText      = $('btn-login-text');
const btnLoginSpin      = $('btn-login-spin');
const btnTogglePw       = $('btn-toggle-pw');
const sidebar           = $('sidebar');
const sidebarSearchEl   = $('sidebar-search');
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
const btnScrollBottom   = $('btn-scroll-bottom');
const scrollBottomUnread = $('scroll-bottom-unread');
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
const btnLeads          = $('btn-leads');
const btnLogout         = $('btn-logout');
const btnSidebarLogout  = $('btn-sidebar-logout');
const btnChatLogout     = $('btn-chat-logout');
const btnCall           = $('btn-call');
const btnBankTools      = $('btn-bank-tools');
const topbarAvatar      = $('topbar-avatar');
const networkPill       = $('network-pill');
const btnUnread         = $('btn-unread');
const unreadBadge       = $('unread-badge');
const btnDiagRefresh    = $('btn-diag-refresh');
const diagOverall       = $('diag-overall');
const diagPush          = $('diag-push');
const diagMic           = $('diag-mic');
const diagCall          = $('diag-call');
const diagNote          = $('diag-note');
const btnPushEnable     = $('btn-push-enable');
const btnPushResubscribe= $('btn-push-resubscribe');
const btnPushTest       = $('btn-push-test');
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
const callScreenMicState= $('call-screen-mic-state');
const callScreenTimer   = $('call-screen-timer');
const callScreenChip    = callScreen ? callScreen.querySelector('.call-screen-chip') : null;
const callScreenPeers   = $('call-screen-peers');
const btnMute           = $('btn-mute');
const callMuteLabel     = $('call-mute-label');
const btnEndCall        = $('btn-end-call');
const remoteAudio       = $('remote-audio');
const remoteAudioMount  = $('remote-audio-mount');
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
const callDataSaverToggle = $('call-data-saver-toggle');
const callDataSaverHint = $('call-data-saver-hint');
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

const leadsSidebarView = $('leads-sidebar-view');
const sidebarTitleEl = $('sidebar-title');
const leadsStatsEl = $('leads-stats');
const leadsSearchInput = $('leads-search');
const leadsFilterOwner = $('leads-filter-owner');
const leadsFilterStage = $('leads-filter-stage');
const leadsFilterPriority = $('leads-filter-priority');
const leadsListEl = $('leads-list');
const leadsEmptyEl = $('leads-empty');
const leadsPaginationEl = $('leads-pagination');
const leadsDueBadge = $('leads-due-badge');
const btnLeadsExport = $('btn-leads-export');
const btnLeadsAdd = $('btn-leads-add');
const leadInfoBanner = $('lead-info-banner');
const leadCreateModal = $('leads-modal');
const btnCloseLeadCreate = $('btn-close-leads');
const btnLeadCreateSave = $('btn-lead-create-save');
const leadNewPriority = $('lead-new-priority');
const leadsKanbanView = $('leads-kanban-view');
const leadsKanbanColumnsEl = $('leads-kanban-columns');
const btnKanbanBack = $('btn-kanban-back');
const leadsKanbanEntry = $('leads-kanban-entry');

const btnIntegrations = $('btn-integrations');
const integrationsView = $('integrations-view');
const btnIntegrationsBack = $('btn-integrations-back');
const integrationsWebhookCard = $('integrations-webhook-card');
const integrationsGridEl = $('integrations-grid');

// ════════════════════════════════════════════
// API helper
// ════════════════════════════════════════════
async function api(method, path, body, options = {}) {
  const timeoutMs = Math.max(3000, Number(options?.timeoutMs || API_DEFAULT_TIMEOUT_MS));
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    try { controller.abort('timeout'); } catch (_) {}
  }, timeoutMs);
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (String(method || '').toUpperCase() === 'GET' && isDataSaverEnabled()) {
    opts.headers['X-Data-Saver'] = '1';
  }
  if (body !== undefined) opts.body = JSON.stringify(body);
  opts.signal = controller.signal;
  let res;
  try {
    res = await fetch(API + path, opts);
  } catch (err) {
    if (err?.name === 'AbortError') {
      const timeoutErr = new Error('Час очікування відповіді вичерпано. Спробуйте ще раз.');
      timeoutErr.code = 'timeout';
      timeoutErr.retryable = true;
      throw timeoutErr;
    }
    const netErr = new Error('Мережа недоступна. Перевірте інтернет-з\'єднання.');
    netErr.code = 'network';
    netErr.retryable = true;
    throw netErr;
  } finally {
    clearTimeout(timeoutId);
  }
  const newTok = res.headers.get('X-Refresh-Token');
  if (newTok) {
    token = newTok;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(BANK_TOKEN_KEY, token);
  }
  const contentType = (res.headers.get('Content-Type') || '').toLowerCase();
  let data = null;
  if (contentType.includes('application/json')) {
    try { data = await res.json(); } catch (_) { data = null; }
  } else {
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      const httpErr = new Error(text || `HTTP ${res.status}`);
      httpErr.status = res.status;
      httpErr.retryable = res.status === 429 || res.status >= 500;
      throw httpErr;
    }
    return null;
  }
  if (!res.ok) {
    const httpErr = new Error(data?.error || `HTTP ${res.status}`);
    httpErr.status = res.status;
    httpErr.retryable = res.status === 429 || res.status >= 500;
    throw httpErr;
  }
  if (!data?.ok) throw new Error(data?.error || 'Помилка запиту');
  return data.data;
}

function isUnauthorizedError(err) {
  return Number(err?.status || 0) === 401 || /\b401\b/.test(String(err?.message || ''));
}

function waitMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function apiGetRetry(path, { retries = 1, timeoutMs = 9000, baseDelayMs = 450 } = {}) {
  let attempt = 0;
  while (attempt <= retries) {
    try {
      return await api('GET', path, undefined, { timeoutMs });
    } catch (err) {
      if (attempt >= retries || !err?.retryable) throw err;
      await waitMs(baseDelayMs * (attempt + 1));
      attempt++;
    }
  }
  return null;
}

function handleConnectivityChange() {
  const online = navigator.onLine !== false;
  if (online === isAppOnline) return;
  isAppOnline = online;
  updateNetworkPill();
  if (!online) {
    showToast('Немає інтернету. Працюємо в offline-режимі.', true);
    runClientDiagnostics().catch(() => {});
    return;
  }
  showToast('З\'єднання відновлено');
  if (token && me) {
    startGlobalPoll(true);
    if (activeConvId) startConvPoll(true);
    startIncomingCallCheck(true);
  }
  runClientDiagnostics().catch(() => {});
}

async function ensurePushSubscriptionSilent() {
  if (!token) return;
  if (!window.Notification || Notification.permission !== 'granted') return;
  try { await subscribeWebPush(); } catch (_) {}
}

function loadPermState() {
  try {
    const raw = localStorage.getItem(PERM_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (_) {
    return {};
  }
}

function savePermState() {
  try { localStorage.setItem(PERM_STATE_KEY, JSON.stringify(permState || {})); } catch (_) {}
}

function setPermFlag(key, value) {
  if (!permState || typeof permState !== 'object') permState = {};
  permState[key] = value;
  savePermState();
}

async function queryPermissionState(name) {
  try {
    if (!navigator?.permissions?.query) return 'unknown';
    const status = await navigator.permissions.query({ name });
    return String(status?.state || 'unknown');
  } catch (_) {
    return 'unknown';
  }
}

function canPromptAgain(flagKey, cooldownMs = 12 * 60 * 60 * 1000) {
  const ts = Number(permState?.[flagKey] || 0);
  if (!ts) return true;
  return (Date.now() - ts) > cooldownMs;
}

async function ensureMicrophonePermission(interactive = false) {
  const cached = String(permState?.microphone || '');
  if (cached === 'granted') return true;

  const current = await queryPermissionState('microphone');
  if (current === 'granted') {
    setPermFlag('microphone', 'granted');
    return true;
  }
  if (current === 'denied') {
    setPermFlag('microphone', 'denied');
    if (interactive) showToast('Мікрофон заблоковано. Дозвольте доступ у налаштуваннях браузера.', true);
    return false;
  }
  if (!interactive) return false;
  if (!canPromptAgain('microphone_prompted_at', 3 * 60 * 1000)) return false;
  setPermFlag('microphone_prompted_at', Date.now());

  if (!(navigator?.mediaDevices?.getUserMedia)) {
    showToast('Браузер не підтримує доступ до мікрофона.', true);
    return false;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach(track => track.stop());
    setPermFlag('microphone', 'granted');
    return true;
  } catch (err) {
    setPermFlag('microphone', 'denied');
    showToast(micError(err), true);
    return false;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(ch => ch.charCodeAt(0)));
}

async function getVapidPublicKey() {
  try {
    const key = await api('GET', '/push/vapid-public-key');
    return typeof key === 'string' ? key : String(key?.key || '');
  } catch (_) {
    return '';
  }
}

function isStandaloneDisplayMode() {
  if (!window.matchMedia) return false;
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches
    );
  } catch (_) {
    return false;
  }
}

function getPushSupportContext() {
  const ua = navigator.userAgent || '';
  const isIOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = document.documentElement.classList.contains('app-standalone')
    || isStandaloneDisplayMode()
    || window.navigator.standalone === true;
  const secureContext = location.protocol === 'https:' || location.hostname === 'localhost';
  const hasNotificationApi = !!window.Notification;
  const hasServiceWorker = ('serviceWorker' in navigator);
  const hasPushManager = ('PushManager' in window);

  if (!secureContext) {
    return { ok: false, message: 'Потрібен HTTPS для push-сповіщень.' };
  }
  if (!hasNotificationApi) {
    return { ok: false, message: 'Браузер не підтримує push-сповіщення.' };
  }
  if (!hasServiceWorker || !hasPushManager) {
    if (isIOS && !standalone) {
      return { ok: false, message: 'На iPhone push працює лише у встановленій PWA. Відкрийте ARM CRM з іконки на Головному екрані.' };
    }
    return { ok: false, message: 'Push API недоступний у поточному браузері.' };
  }
  if (isIOS && !standalone) {
    return { ok: false, message: 'На iPhone push працює лише у встановленій PWA. Додайте ARM CRM на Головний екран і відкрийте з іконки.' };
  }
  return { ok: true, message: '' };
}

async function subscribeWebPush() {
  try {
    if (!token) return false;
    const support = getPushSupportContext();
    if (!support.ok) {
      lastPushSetupError = support.message || '';
      return false;
    }
    const reg = await navigator.serviceWorker.ready;
    const vapid = await getVapidPublicKey();
    if (!vapid) {
      lastPushSetupError = 'Не вдалося отримати VAPID ключ для push.';
      return false;
    }

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid),
      });
    }

    const p256dhKey = sub.getKey('p256dh');
    const authKey = sub.getKey('auth');
    if (!p256dhKey || !authKey) {
      lastPushSetupError = 'Некоректні ключі push-підписки. Оновіть підписку ще раз.';
      return false;
    }
    await api('POST', '/push/subscribe', {
      endpoint: sub.endpoint,
      p256dh: btoa(String.fromCharCode(...new Uint8Array(p256dhKey))),
      auth: btoa(String.fromCharCode(...new Uint8Array(authKey))),
    });
    setPermFlag('push_subscribed', true);
    lastPushSetupError = '';
    return true;
  } catch (err) {
    lastPushSetupError = err?.message || 'Не вдалося створити push-підписку.';
    return false;
  }
}

async function forceResubscribeWebPush() {
  try {
    if (!token) return false;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    const reg = await navigator.serviceWorker.ready;
    const oldSub = await reg.pushManager.getSubscription();
    if (oldSub) {
      try { await oldSub.unsubscribe(); } catch (_) {}
    }
    setPermFlag('push_subscribed', false);
    return subscribeWebPush();
  } catch (err) {
    lastPushSetupError = err?.message || 'Не вдалося оновити push-підписку.';
    return false;
  }
}

async function ensureNotificationPermission(interactive = false) {
  const support = getPushSupportContext();
  if (!support.ok) {
    lastPushSetupError = support.message || '';
    if (interactive) showToast(support.message || 'Push недоступний у поточному режимі.', true);
    return false;
  }

  const perm = Notification.permission;
  if (perm === 'granted') {
    setPermFlag('notifications', 'granted');
    try {
      const subscribed = await subscribeWebPush();
      if (!subscribed && !lastPushSetupError) {
        lastPushSetupError = 'Push не вдалося підписати. Оновіть підписку.';
      }
      return !!subscribed;
    } catch (_) {
      if (!lastPushSetupError) {
        lastPushSetupError = 'Push не вдалося підписати. Спробуйте ще раз.';
      }
      return false;
    }
  }
  if (perm === 'denied') {
    setPermFlag('notifications', 'denied');
    lastPushSetupError = 'Сповіщення заблоковані. Дозвольте їх у налаштуваннях браузера.';
    if (interactive) showToast('Сповіщення заблоковані. Дозвольте їх у налаштуваннях браузера.', true);
    return false;
  }
  if (!interactive) return false;
  if (!canPromptAgain('notifications_prompted_at', 5 * 60 * 1000)) return false;
  setPermFlag('notifications_prompted_at', Date.now());

  try {
    const requested = await Notification.requestPermission();
    if (requested !== 'granted') {
      setPermFlag('notifications', 'denied');
      lastPushSetupError = 'Доступ до push-сповіщень не надано.';
      return false;
    }
    setPermFlag('notifications', 'granted');
    const subscribed = await subscribeWebPush();
    if (!subscribed && !lastPushSetupError) {
      lastPushSetupError = 'Дозвіл надано, але підписка на push не створена.';
    }
    return !!subscribed;
  } catch (_) {
    lastPushSetupError = 'Не вдалося запросити дозвіл на push-сповіщення.';
    return false;
  }
}

async function notifyViaServiceWorker({ title, body = '', tag = '', data = {}, renotify = false, silent = false }) {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (!reg?.showNotification || Notification.permission !== 'granted') return false;
    await reg.showNotification(String(title || 'ARM CRM'), {
      body: String(body || ''),
      tag: tag || undefined,
      icon: '/icons/chat-icon-180.png',
      badge: '/icons/chat-icon-32.png',
      renotify: !!renotify,
      requireInteraction: false,
      silent: !!silent,
      data: { ...(data || {}), url: '/messenger' },
    });
    return true;
  } catch (_) {
    return false;
  }
}

function setDiagRow(el, state, label) {
  if (!el) return;
  el.dataset.state = state;
  const t = el.querySelector('.diag-label');
  if (t && label) t.textContent = label;
}

function setPushActionBusy(busy) {
  pushActionInFlight = !!busy;
  [btnPushEnable, btnPushResubscribe, btnPushTest].forEach(btn => {
    if (btn) btn.disabled = !!busy;
  });
}

function updatePushActionButtons({ notifPerm, swReady, pushSubscribed, pushBlocked }) {
  if (btnPushEnable) btnPushEnable.hidden = !!pushBlocked || (notifPerm === 'granted' && !!pushSubscribed);
  if (btnPushResubscribe) btnPushResubscribe.hidden = !!pushBlocked || notifPerm !== 'granted' || !swReady;
  if (btnPushTest) btnPushTest.hidden = !!pushBlocked || notifPerm !== 'granted' || !swReady || !pushSubscribed;
}

async function runClientDiagnostics(showDoneToast = false) {
  const secureContext = location.protocol === 'https:' || location.hostname === 'localhost';
  const rtcSupported = !!(window.RTCPeerConnection && navigator?.mediaDevices?.getUserMedia);
  const online = navigator.onLine !== false;
  const pushSupport = getPushSupportContext();

  const notifPerm = window.Notification ? Notification.permission : 'unsupported';
  const notifGranted = notifPerm === 'granted';

  const micPerm = await queryPermissionState('microphone');
  const micGranted =
    micPerm === 'granted' ||
    (micPerm === 'unknown' && String(permState?.microphone || '') === 'granted');

  let swReady = false;
  let pushSubscribed = false;
  if (pushSupport.ok && 'serviceWorker' in navigator && 'PushManager' in window) {
    try {
      const reg = await navigator.serviceWorker.ready;
      swReady = !!reg;
      const sub = await reg.pushManager.getSubscription();
      pushSubscribed = !!sub;
    } catch (_) {}
  }
  const pushReady = pushSupport.ok && notifGranted && swReady && pushSubscribed;
  const callReady = secureContext && rtcSupported && micGranted && online;
  const overallOk = callReady && pushReady;
  pushReadyCache = !!pushReady;

  setDiagRow(diagPush, pushReady ? 'ok' : (!pushSupport.ok || notifPerm === 'denied' ? 'bad' : 'warn'), `Push: ${pushReady ? 'готово' : 'потрібно налаштувати'}`);
  setDiagRow(diagMic, micGranted ? 'ok' : (micPerm === 'denied' ? 'bad' : 'warn'), `Мікрофон: ${micGranted ? 'доступ є' : 'немає доступу'}`);
  setDiagRow(diagCall, callReady ? 'ok' : 'warn', `Дзвінки: ${callReady ? 'готово' : 'є обмеження'}`);
  setDiagRow(diagOverall, overallOk ? 'ok' : 'warn', `Загальний стан: ${overallOk ? 'готово' : 'потребує уваги'}`);

  if (diagNote) {
    let note = 'Усе готово: push для повідомлень і дзвінків працює у фоні PWA.';
    if (!secureContext) note = 'Потрібен HTTPS для мікрофона, дзвінків і push.';
    else if (!pushSupport.ok) note = pushSupport.message || 'Push недоступний у поточному режимі.';
    else if (!notifGranted) note = 'Push вимкнено: натисніть "Увімкнути push".';
    else if (!swReady) note = 'Service Worker ще не готовий. Зачекайте 2-3 секунди й натисніть "Оновити".';
    else if (!pushSubscribed) note = 'Push не підписано. Натисніть "Оновити підписку".';
    else if (!micGranted) note = 'Дозвольте доступ до мікрофона у браузері.';
    else if (!online) note = 'Немає мережі. Перевірте інтернет-зʼєднання.';
    diagNote.textContent = note;
  }

  updatePushActionButtons({ notifPerm, swReady, pushSubscribed, pushBlocked: !pushSupport.ok });
  updateNetworkPill();
  updateDataSaverHint();

  if (showDoneToast) showToast(overallOk ? 'Стан системи: готово' : 'Перевірка завершена');
}

// ════════════════════════════════════════════
// Toast
// ════════════════════════════════════════════
function showToast(msg, isError = false) {
  let text = String(msg ?? '').replace(/\s+/g, ' ').trim();
  if (isError) {
    if (/Invalid SDP line|Failed to parse SessionDescription|parse SessionDescription|OperationError/i.test(text)) {
      text = 'Помилка сумісності дзвінка (SDP). Перезапустіть дзвінок або оновіть сторінку.';
    } else if (text.length > 190) {
      text = `${text.slice(0, 187)}...`;
    }
  }
  if (!text) text = isError ? 'Сталася помилка.' : 'Готово';
  toast.textContent = text;
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

function getConnectionState() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  const effectiveType = String(conn?.effectiveType || '').toLowerCase();
  const saveData = !!conn?.saveData;
  const downlink = Number(conn?.downlink || 0);
  const rtt = Number(conn?.rtt || 0);
  return { effectiveType, saveData, downlink, rtt };
}

function isLowBandwidthNetwork() {
  const net = getConnectionState();
  if (!net) return false;
  if (net.saveData) return true;
  if (/(^|-)2g$/.test(net.effectiveType) || /(^|-)3g$/.test(net.effectiveType)) return true;
  return net.downlink > 0 && net.downlink < 1.6;
}

function isDataSaverEnabled() {
  const net = getConnectionState();
  return !!callPrefs?.dataSaver || !!net.saveData;
}

function updateDataSaverHint() {
  if (!callDataSaverHint) return;
  const net = getConnectionState();
  const active = isDataSaverEnabled();
  const netTag = net.effectiveType ? ` (${net.effectiveType.toUpperCase()})` : '';
  if (active) {
    callDataSaverHint.textContent = `Активно: менше фонових запитів і компактні фото${netTag}.`;
  } else {
    callDataSaverHint.textContent = `Стандартний режим: швидкі оновлення чату${netTag}.`;
  }
}

function updateNetworkPill() {
  if (!networkPill) return;
  if (navigator.onLine === false) {
    networkPill.textContent = 'Offline';
    networkPill.dataset.state = 'bad';
    return;
  }
  const net = getConnectionState();
  if (isDataSaverEnabled()) {
    networkPill.textContent = 'Еко-трафік';
    networkPill.dataset.state = 'warn';
    return;
  }
  const label = net.effectiveType ? net.effectiveType.toUpperCase() : 'Online';
  networkPill.textContent = label;
  networkPill.dataset.state = 'ok';
}

function loadCallPrefs() {
  try {
    const raw = localStorage.getItem(CALL_PREFS_KEY);
    if (!raw) {
      return { ...DEFAULT_CALL_PREFS, dataSaver: !!getConnectionState().saveData };
    }
    const parsed = JSON.parse(raw);
    const netSaveData = getConnectionState().saveData;
    const parsedDataSaver = typeof parsed?.dataSaver === 'boolean'
      ? parsed.dataSaver
      : !!netSaveData;
    return {
      sounds: parsed?.sounds !== false,
      vibration: parsed?.vibration !== false,
      volume: clampNumber(parsed?.volume, 0, 1, DEFAULT_CALL_PREFS.volume),
      outgoingTimeoutSec: Math.round(clampNumber(parsed?.outgoingTimeoutSec, 15, 90, DEFAULT_CALL_PREFS.outgoingTimeoutSec)),
      incomingTimeoutSec: Math.round(clampNumber(parsed?.incomingTimeoutSec, 15, 90, DEFAULT_CALL_PREFS.incomingTimeoutSec)),
      dataSaver: parsedDataSaver,
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
  if (callDataSaverToggle) callDataSaverToggle.checked = !!callPrefs.dataSaver;
  if (callVolumeRange) callVolumeRange.value = String(Math.round(callPrefs.volume * 100));
  if (callVolumeValue) callVolumeValue.textContent = `${Math.round(callPrefs.volume * 100)}%`;
  if (outgoingTimeoutRange) outgoingTimeoutRange.value = String(callPrefs.outgoingTimeoutSec);
  if (outgoingTimeoutValue) outgoingTimeoutValue.textContent = `${callPrefs.outgoingTimeoutSec}с`;
  if (incomingTimeoutRange) incomingTimeoutRange.value = String(callPrefs.incomingTimeoutSec);
  if (incomingTimeoutValue) incomingTimeoutValue.textContent = `${callPrefs.incomingTimeoutSec}с`;
  updateDataSaverHint();
  updateNetworkPill();
}

function openCallSettingsModal() {
  if (!callSettingsModal) return;
  renderCallSettings();
  callSettingsModal.hidden = false;
  syncOverlayLock();
  runClientDiagnostics().catch(() => {});
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
  toneBeep(560, 0.13, { gain: 0.024, wave: 'triangle' });
  toneBeep(700, 0.15, { gain: 0.022, wave: 'triangle', delay: 0.14 });
  toneBeep(840, 0.17, { gain: 0.02, wave: 'triangle', delay: 0.31 });
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

// ════════════════════════════════════════════
// Leads / CRM
// ════════════════════════════════════════════
const LEADS_OWNER_FILTER_KEY = 'msng_leads_owner_filter';
const leadsState = {
  page: 1,
  perPage: 30,
  totalPages: 1,
  owner: localStorage.getItem(LEADS_OWNER_FILTER_KEY) || '',
  stage: '',
  priority: '',
  search: '',
  dueToday: false,
  filtersLoaded: false,
  currentLeadId: null,
};

function setLeadsOwnerFilter(owner) {
  leadsState.owner = owner || '';
  if (owner) localStorage.setItem(LEADS_OWNER_FILTER_KEY, owner);
  else localStorage.removeItem(LEADS_OWNER_FILTER_KEY);
}

function leadsQueryString(extra = {}) {
  const params = new URLSearchParams({
    page: String(leadsState.page),
    per_page: String(leadsState.perPage),
  });
  if (leadsState.owner) params.set('owner', leadsState.owner);
  if (leadsState.stage) params.set('stage', leadsState.stage);
  if (leadsState.priority) params.set('priority', leadsState.priority);
  if (leadsState.search) params.set('search', leadsState.search);
  if (leadsState.dueToday) params.set('due_today', '1');
  Object.entries(extra).forEach(([k, v]) => params.set(k, String(v)));
  return params.toString();
}

function fillLeadsSelect(select, values, currentValue, labels) {
  if (!select) return;
  const placeholder = select.options[0];
  select.innerHTML = '';
  select.appendChild(placeholder);
  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = labels ? leadsLabel(labels, v) : v;
    select.appendChild(opt);
  });
  select.value = currentValue || '';
}

async function loadLeadsStats() {
  if (!leadsStatsEl) return;
  try {
    const data = await api('GET', '/leads/stats');
    const chips = [
      { key: 'total', label: 'Всього', value: data.total },
      { key: 'not_contacted', label: 'Не звʼязались', value: data.not_contacted },
      { key: 'due_today', label: 'На сьогодні', value: data.due_today },
      ...(data.by_owner || []).map(o => ({ key: 'owner:' + o.owner, label: leadsLabel(LEADS_OWNER_LABELS, o.owner), value: o.count })),
    ];
    if (leadsDueBadge) leadsDueBadge.hidden = !(data.due_today > 0);
    leadsStatsEl.innerHTML = chips.map(c => `
      <div class="leads-stat-chip" data-chip="${escHtml(c.key)}">
        <div class="leads-stat-value">${c.value}</div>
        <div class="leads-stat-label">${escHtml(c.label)}</div>
      </div>
    `).join('');
    leadsStatsEl.querySelectorAll('.leads-stat-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const key = chip.dataset.chip;
        leadsState.dueToday = false;
        if (key === 'total') {
          setLeadsOwnerFilter(''); leadsState.stage = ''; leadsState.priority = '';
          if (leadsFilterOwner) leadsFilterOwner.value = '';
        } else if (key === 'not_contacted') {
          // handled purely as a visual filter shortcut via search-free reload
        } else if (key === 'due_today') {
          leadsState.dueToday = true;
        } else if (key.startsWith('owner:')) {
          setLeadsOwnerFilter(key.slice(6));
          if (leadsFilterOwner) leadsFilterOwner.value = leadsState.owner;
        }
        leadsState.page = 1;
        loadLeadsList();
      });
    });
    if (!leadsState.filtersLoaded) {
      fillLeadsSelect(leadsFilterOwner, (data.by_owner || []).map(o => o.owner), leadsState.owner, LEADS_OWNER_LABELS);
      fillLeadsSelect(leadsFilterStage, (data.by_stage || []).map(o => o.stage), leadsState.stage, LEADS_STAGE_LABELS);
      fillLeadsSelect(leadsFilterPriority, (data.by_priority || []).map(o => o.priority), leadsState.priority, LEADS_PRIORITY_LABELS);
      leadsState.filtersLoaded = true;
    }
  } catch (err) {
    showToast(err.message || 'Не вдалося завантажити статистику лідів.', true);
  }
}

function channelIcon(primaryChannel) {
  const ch = (primaryChannel || '').trim().toLowerCase();
  if (ch === 'whatsapp') return '<span class="lead-channel-icon" title="WhatsApp">💬</span>';
  if (ch === 'instagram') return '<span class="lead-channel-icon" title="Instagram">📷</span>';
  return '';
}

function leadCardHtml(lead) {
  const loc = [lead.city_area, lead.country].filter(Boolean).join(', ');
  const preview = [lead.category, loc].filter(Boolean).join(' · ') || 'Немає деталей';
  const firstPhone = (lead.phone || lead.whatsapp_viber || '').split(/[;,]/)[0].trim();
  const firstEmail = (lead.email || '').split(/[;,]/)[0].trim();
  const quick = [
    firstPhone ? { href: 'tel:' + firstPhone.replace(/[^\d+]/g, ''), label: '📞', title: 'Зателефонувати' } : null,
    firstPhone ? { href: 'https://wa.me/' + firstPhone.replace(/[^\d]/g, ''), label: '💬', title: 'WhatsApp' } : null,
    firstEmail ? { href: 'mailto:' + firstEmail, label: '✉️', title: 'Написати email' } : null,
  ].filter(Boolean);
  return `
    <div class="leads-card conv-style" data-lead-id="${lead.id}">
      <div class="conv-avatar">${escHtml(initial(lead.business_name || '?'))}</div>
      <div class="leads-card-body">
        <div class="leads-card-name-row">
          <span class="conv-name">${channelIcon(lead.primary_channel)}${escHtml(lead.business_name || '')}</span>
          <span class="leads-badge leads-badge-${escHtml(lead.priority || 'Medium')}">${escHtml(leadsLabel(LEADS_PRIORITY_LABELS, lead.priority))}</span>
        </div>
        <div class="leads-card-preview">${escHtml(preview)}</div>
        <div class="leads-card-badges">
          <span class="leads-badge leads-badge-stage-${escHtml(leadsSlug(lead.stage))}">${escHtml(leadsLabel(LEADS_STAGE_LABELS, lead.stage))}</span>
          <span class="leads-badge leads-badge-owner-${escHtml(leadsSlug(lead.owner))}">${escHtml(leadsLabel(LEADS_OWNER_LABELS, lead.owner) || '—')}</span>
        </div>
        ${quick.length ? `<div class="leads-card-quick">${quick.map(q =>
          `<a class="leads-quick-btn" href="${escHtml(q.href)}" target="_blank" rel="noopener" data-quick-action="1" title="${escHtml(q.title)}">${q.label}</a>`
        ).join('')}</div>` : ''}
      </div>
    </div>
  `;
}

async function loadLeadsList() {
  if (!leadsListEl) return;
  try {
    const res = await api('GET', '/leads?' + leadsQueryString());
    const items = res?.items || [];
    leadsState.totalPages = res?.pages || 1;
    leadsListEl.querySelectorAll('.leads-card:not(#leads-kanban-entry)').forEach(el => el.remove());
    if (!items.length) {
      if (leadsEmptyEl) leadsEmptyEl.hidden = false;
    } else {
      if (leadsEmptyEl) leadsEmptyEl.hidden = true;
      const frag = document.createElement('div');
      frag.innerHTML = items.map(leadCardHtml).join('');
      Array.from(frag.children).forEach(card => {
        card.addEventListener('click', e => {
          if (e.target.closest('[data-quick-action]')) return;
          openLeadDetail(Number(card.dataset.leadId));
        });
        leadsListEl.appendChild(card);
      });
    }
    renderLeadsPagination();
  } catch (err) {
    showToast(err.message || 'Не вдалося завантажити ліди.', true);
  }
}

function renderLeadsPagination() {
  if (!leadsPaginationEl) return;
  leadsPaginationEl.innerHTML = `
    <button id="leads-prev" ${leadsState.page <= 1 ? 'disabled' : ''}>←</button>
    <span>стор. ${leadsState.page} / ${leadsState.totalPages}</span>
    <button id="leads-next" ${leadsState.page >= leadsState.totalPages ? 'disabled' : ''}>→</button>
  `;
  document.getElementById('leads-prev')?.addEventListener('click', () => {
    if (leadsState.page > 1) { leadsState.page--; loadLeadsList(); }
  });
  document.getElementById('leads-next')?.addEventListener('click', () => {
    if (leadsState.page < leadsState.totalPages) { leadsState.page++; loadLeadsList(); }
  });
}

const LEADS_STAGE_OPTIONS = ['New', 'Contacted', 'Replied', 'Qualified', 'Proposal Sent', 'Won', 'Lost'];
const LEADS_OUTREACH_OPTIONS = ['Not contacted', 'Message sent', 'Follow-up sent', 'Call made', 'No reply', 'Replied'];
const LEADS_PRIORITY_OPTIONS = ['Hot', 'High', 'Medium', 'Low', 'Watch'];
const LEADS_OWNER_OPTIONS = ['Manager 1', 'Manager 2'];

// Значення полів зберігаються англійською (сумісність з фільтрами/експортом/API),
// але менеджери працюють з CRM російською — тому текст на екрані перекладається окремо.
const LEADS_STAGE_LABELS = {
  'New': 'Новый', 'Contacted': 'Связались', 'Replied': 'Ответил',
  'Qualified': 'Квалифицирован', 'Proposal Sent': 'Предложение отправлено',
  'Won': 'Выиграно', 'Lost': 'Проиграно',
};
const LEADS_OUTREACH_LABELS = {
  'Not contacted': 'Не связывались', 'Message sent': 'Сообщение отправлено',
  'Follow-up sent': 'Напоминание отправлено', 'Call made': 'Звонок совершён',
  'No reply': 'Без ответа', 'Replied': 'Ответил',
};
const LEADS_PRIORITY_LABELS = {
  'Hot': 'Горячий', 'High': 'Высокий', 'Medium': 'Средний', 'Low': 'Низкий', 'Watch': 'Наблюдение',
};
const LEADS_OWNER_LABELS = { 'Manager 1': 'Менеджер Миша', 'Manager 2': 'Менеджер Едуард' };

function leadsLabel(map, value) {
  return map[value] || value || '';
}
function leadsSlug(value) {
  return String(value || '').trim().replace(/\s+/g, '-');
}

function leadThreadContactIcons(lead) {
  const firstPhone = (lead.phone || lead.whatsapp_viber || '').split(/[;,]/)[0].trim();
  const firstEmail = (lead.email || '').split(/[;,]/)[0].trim();
  const icons = [
    firstPhone ? { href: 'tel:' + firstPhone.replace(/[^\d+]/g, ''), label: '📞', title: 'Зателефонувати' } : null,
    firstPhone ? { href: 'https://wa.me/' + firstPhone.replace(/[^\d]/g, ''), label: '💬', title: 'WhatsApp' } : null,
    firstEmail ? { href: 'mailto:' + firstEmail, label: '✉️', title: 'Написати email' } : null,
    lead.instagram ? { href: 'https://instagram.com/' + String(lead.instagram).replace('@', ''), label: '📷', title: 'Instagram' } : null,
  ].filter(Boolean);
  return icons.map(i => `<a class="leads-quick-btn" href="${escHtml(i.href)}" target="_blank" rel="noopener" title="${escHtml(i.title)}">${i.label}</a>`).join('');
}

function leadThreadPillsHtml(lead) {
  const optSel = (options, current, labels) => options.map(o =>
    `<option value="${escHtml(o)}" ${o === current ? 'selected' : ''}>${escHtml(leadsLabel(labels, o))}</option>`
  ).join('');
  return `
    <select id="lead-edit-owner" class="leads-pill-select">${optSel(LEADS_OWNER_OPTIONS, lead.owner, LEADS_OWNER_LABELS)}</select>
    <select id="lead-edit-priority" class="leads-pill-select">${optSel(LEADS_PRIORITY_OPTIONS, lead.priority, LEADS_PRIORITY_LABELS)}</select>
    <select id="lead-edit-stage" class="leads-pill-select">${optSel(LEADS_STAGE_OPTIONS, lead.stage, LEADS_STAGE_LABELS)}</select>
    <select id="lead-edit-outreach" class="leads-pill-select">${optSel(LEADS_OUTREACH_OPTIONS, lead.outreach_status, LEADS_OUTREACH_LABELS)}</select>
    <input id="lead-edit-followup" class="leads-pill-select" type="date" title="Наступний контакт" value="${escHtml(lead.next_followup_date || '')}"/>
  `;
}

async function openLeadDetail(leadId) {
  if (!leadInfoBanner) return;
  if (window.innerWidth <= 720) sidebar.classList.add('hidden');
  leadsState.currentLeadId = leadId;
  document.querySelectorAll('.leads-card').forEach(el =>
    el.classList.toggle('active', Number(el.dataset.leadId) === leadId));
  try {
    const [lead, convRes] = await Promise.all([
      api('GET', `/leads/${leadId}`),
      api('GET', `/leads/${leadId}/conversation`),
    ]);
    renderLeadInfoBanner(lead);
    await openChat({
      id: convRes.conversation_id,
      is_group: true,
      group_name: lead.business_name,
      partner: null,
    });
    setChatHeaderStatus([lead.category, [lead.city_area, lead.country].filter(Boolean).join(', ')].filter(Boolean).join(' · '));
    if (btnCall) btnCall.hidden = true;
    const groupInfoBtn = document.getElementById('group-info-btn');
    if (groupInfoBtn) groupInfoBtn.hidden = true;
  } catch (err) {
    showToast(err.message || 'Не вдалося завантажити ліда.', true);
  }
}

function renderLeadInfoBanner(lead) {
  const contactsEl = document.getElementById('lead-thread-contacts');
  const pillsEl = document.getElementById('leads-thread-pills');
  const pinnedEl = document.getElementById('lead-first-message-pinned');

  leadInfoBanner.hidden = false;
  if (contactsEl) contactsEl.innerHTML = leadThreadContactIcons(lead);
  if (pillsEl) {
    pillsEl.innerHTML = leadThreadPillsHtml(lead);
    ['owner', 'priority', 'stage', 'outreach'].forEach(field => {
      document.getElementById(`lead-edit-${field}`)?.addEventListener('change', () => saveLeadPillEdit(lead.id));
    });
    document.getElementById('lead-edit-followup')?.addEventListener('change', () => saveLeadPillEdit(lead.id));
  }
  if (pinnedEl) {
    pinnedEl.hidden = !lead.first_message_en;
    pinnedEl.innerHTML = lead.first_message_en ? `
      <div class="leads-fm-label">Заготовка першого повідомлення</div>
      ${escHtml(lead.first_message_en)}
      <div><button class="btn-primary btn-secondary" id="btn-lead-copy-msg" type="button">Скопіювати</button></div>
    ` : '';
    document.getElementById('btn-lead-copy-msg')?.addEventListener('click', () => {
      navigator.clipboard?.writeText(lead.first_message_en || '').then(
        () => showToast('Скопійовано.'),
        () => showToast('Не вдалося скопіювати.', true)
      );
    });
  }
}

async function saveLeadPillEdit(leadId) {
  const payload = {
    owner: document.getElementById('lead-edit-owner')?.value,
    priority: document.getElementById('lead-edit-priority')?.value,
    stage: document.getElementById('lead-edit-stage')?.value,
    outreach_status: document.getElementById('lead-edit-outreach')?.value,
    next_followup_date: document.getElementById('lead-edit-followup')?.value || null,
  };
  try {
    await api('PATCH', `/leads/${leadId}`, payload);
    loadLeadsStats();
    // Стадія/пріоритет тепер дзеркалиться в реальний чат бекендом — підтягуємо свіжі повідомлення одразу.
    if (activeConvId) fetchMessages();
  } catch (err) {
    showToast(err.message || 'Не вдалося зберегти зміни.', true);
  }
}

function closeLeadDetail() {
  if (window.innerWidth <= 720) sidebar.classList.remove('hidden');
  if (leadInfoBanner) leadInfoBanner.hidden = true;
  leadsState.currentLeadId = null;
  document.querySelectorAll('.leads-card').forEach(el => el.classList.remove('active'));
  activeConvId = null;
  activePartner = null;
  clearInterval(convPollTimer);
  if (chatView) chatView.hidden = true;
  if (chatEmpty) chatEmpty.hidden = false;
  if (btnCall) btnCall.hidden = false;
  loadLeadsList();
}

async function openLeadsKanban() {
  if (!leadsKanbanView || !leadsKanbanColumnsEl) return;
  if (window.innerWidth <= 720) sidebar.classList.add('hidden');
  document.querySelectorAll('.leads-card').forEach(el => el.classList.remove('active'));
  if (leadsKanbanEntry) leadsKanbanEntry.classList.add('active');
  activeConvId = null;
  activePartner = null;
  clearInterval(convPollTimer);
  if (chatEmpty) chatEmpty.hidden = true;
  if (chatView) chatView.hidden = true;
  if (leadInfoBanner) leadInfoBanner.hidden = true;
  leadsKanbanView.hidden = false;
  leadsKanbanColumnsEl.innerHTML = '<p class="leads-empty">Завантаження…</p>';
  try {
    const [stats, leadsRes] = await Promise.all([
      api('GET', '/leads/stats'),
      api('GET', '/leads?per_page=200'),
    ]);
    renderLeadsKanban(stats, leadsRes.items || []);
  } catch (err) {
    leadsKanbanColumnsEl.innerHTML = `<p class="leads-empty">${escHtml(err.message || 'Не вдалося завантажити канбан.')}</p>`;
  }
}

function closeLeadsKanban() {
  if (window.innerWidth <= 720) sidebar.classList.remove('hidden');
  if (leadsKanbanView) leadsKanbanView.hidden = true;
  if (leadsKanbanEntry) leadsKanbanEntry.classList.remove('active');
  if (chatEmpty) chatEmpty.hidden = false;
}

// ════════════════════════════════════════════
// Integrations: self-serve WhatsApp/Instagram per manager
// ════════════════════════════════════════════
const INTEGRATIONS_CHANNEL_META = {
  whatsapp: { label: 'WhatsApp', icon: '💬', idLabel: 'Phone Number ID', idField: 'phone_number_id', idPlaceholder: 'Напр. 109876543210987' },
  instagram: { label: 'Instagram', icon: '📷', idLabel: 'Instagram User ID', idField: 'ig_user_id', idPlaceholder: 'Напр. 178414...' },
};

async function openIntegrationsView() {
  if (!integrationsView) return;
  if (window.innerWidth <= 720) sidebar.classList.add('hidden');
  activeConvId = null;
  activePartner = null;
  clearInterval(convPollTimer);
  if (chatEmpty) chatEmpty.hidden = true;
  if (chatView) chatView.hidden = true;
  if (leadInfoBanner) leadInfoBanner.hidden = true;
  if (leadsKanbanView) leadsKanbanView.hidden = true;
  integrationsView.hidden = false;
  if (integrationsGridEl) integrationsGridEl.innerHTML = '<p class="leads-empty">Завантаження…</p>';
  try {
    const [list, webhook] = await Promise.all([
      api('GET', '/integrations'),
      api('GET', '/integrations/webhook-info'),
    ]);
    renderIntegrationsWebhookCard(webhook);
    renderIntegrationsGrid(list);
  } catch (err) {
    if (integrationsGridEl) integrationsGridEl.innerHTML = `<p class="leads-empty">${escHtml(err.message || 'Не вдалося завантажити інтеграції.')}</p>`;
  }
}

function closeIntegrationsView() {
  if (window.innerWidth <= 720) sidebar.classList.remove('hidden');
  if (integrationsView) integrationsView.hidden = true;
  if (chatEmpty) chatEmpty.hidden = false;
}

function renderIntegrationsWebhookCard(info) {
  if (!integrationsWebhookCard) return;
  integrationsWebhookCard.innerHTML = `
    <div class="mono-label">Webhook для Meta (WhatsApp/Instagram)</div>
    <div class="integrations-webhook-row">
      <span class="integrations-webhook-label">Callback URL</span>
      <code class="integrations-webhook-value">${escHtml(info.webhook_url)}</code>
      <button type="button" class="integrations-copy-btn" data-copy="${escHtml(info.webhook_url)}">Копіювати</button>
    </div>
    <div class="integrations-webhook-row">
      <span class="integrations-webhook-label">Verify token</span>
      <code class="integrations-webhook-value">${escHtml(info.verify_token)}</code>
      <button type="button" class="integrations-copy-btn" data-copy="${escHtml(info.verify_token)}">Копіювати</button>
    </div>
    <p class="integrations-webhook-hint">Ці два значення менеджер вставляє у свій Meta App → Webhooks при підписці на WhatsApp/Instagram.</p>
  `;
  integrationsWebhookCard.querySelectorAll('.integrations-copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy || '');
        showToast('Скопійовано.');
      } catch {
        showToast('Не вдалося скопіювати.', true);
      }
    });
  });
}

function integrationCardHtml(item) {
  const meta = INTEGRATIONS_CHANNEL_META[item.channel];
  const hasError = item.status === 'error';
  const connected = item.status === 'connected' || hasError;
  const dotTitle = hasError ? 'Помилка — токен міг протухнути' : (connected ? 'Підключено' : 'Не підключено');
  return `
    <div class="integration-card" data-manager="${escHtml(item.manager)}" data-channel="${escHtml(item.channel)}">
      <div class="integration-card-top">
        <span class="mono-label">${meta.icon} ${meta.label}</span>
        <span class="integration-status-dot ${hasError ? 'error' : (connected ? 'on' : 'off')}" title="${dotTitle}"></span>
      </div>
      <div class="integration-card-manager">${escHtml(item.manager_label)}</div>
      ${connected ? `
        <div class="integration-card-connected">
          <div class="integration-card-display">${escHtml(item.display_label || item.external_id)}</div>
          <div class="integration-card-token">Token: ${escHtml(item.token_preview)}</div>
          ${hasError ? '<div class="integration-card-error">Останню перевірку не пройдено — перевірте токен.</div>' : ''}
          <div class="integration-card-sig ${item.signature_verified ? 'ok' : 'warn'}">
            ${item.signature_verified ? '🔒 Підпис вебхука перевіряється' : '⚠️ Підпис не перевіряється — додайте App Secret'}
          </div>
        </div>
        <div class="integration-card-actions">
          <button type="button" class="integration-check-btn">Перевірити</button>
          <button type="button" class="integration-disconnect-btn">Відключити</button>
        </div>
      ` : `
        <form class="integration-connect-form">
          <input class="integration-input-id" placeholder="${meta.idLabel}" autocomplete="off" required/>
          <input class="integration-input-token" type="password" placeholder="Access Token" autocomplete="off" required/>
          <input class="integration-input-secret" type="password" placeholder="App Secret (опційно, для перевірки підпису)" autocomplete="off"/>
          <button type="submit" class="btn-primary">Підключити</button>
        </form>
      `}
    </div>
  `;
}

function renderIntegrationsGrid(items) {
  if (!integrationsGridEl) return;
  if (!items || !items.length) {
    integrationsGridEl.innerHTML = '<p class="leads-empty">Немає даних.</p>';
    return;
  }
  integrationsGridEl.innerHTML = items.map(integrationCardHtml).join('');

  integrationsGridEl.querySelectorAll('.integration-card').forEach(card => {
    const manager = card.dataset.manager;
    const channel = card.dataset.channel;
    const meta = INTEGRATIONS_CHANNEL_META[channel];

    const form = card.querySelector('.integration-connect-form');
    if (form) {
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const idVal = card.querySelector('.integration-input-id')?.value.trim();
        const tokenVal = card.querySelector('.integration-input-token')?.value.trim();
        const secretVal = card.querySelector('.integration-input-secret')?.value.trim();
        if (!idVal || !tokenVal) return;
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;
        try {
          await api('POST', `/integrations/${channel}`, {
            manager,
            [meta.idField]: idVal,
            access_token: tokenVal,
            app_secret: secretVal || '',
          });
          showToast(`${meta.label} підключено для ${card.querySelector('.integration-card-manager')?.textContent || manager}.`);
          openIntegrationsView();
        } catch (err) {
          showToast(err.message || 'Не вдалося підключити.', true);
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }

    const checkBtn = card.querySelector('.integration-check-btn');
    if (checkBtn) {
      checkBtn.addEventListener('click', async () => {
        checkBtn.disabled = true;
        checkBtn.textContent = 'Перевіряю…';
        try {
          await api('POST', `/integrations/${manager}/${channel}/check`);
          showToast('Підключення робоче.');
          openIntegrationsView();
        } catch (err) {
          showToast(err.message || 'Перевірка не пройшла.', true);
          openIntegrationsView();
        }
      });
    }

    const disconnectBtn = card.querySelector('.integration-disconnect-btn');
    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', async () => {
        disconnectBtn.disabled = true;
        try {
          await api('DELETE', `/integrations/${manager}/${channel}`);
          showToast('Відключено.');
          openIntegrationsView();
        } catch (err) {
          showToast(err.message || 'Не вдалося відключити.', true);
          disconnectBtn.disabled = false;
        }
      });
    }
  });
}

function leadsKanbanCardHtml(lead, stageOptions) {
  const optSel = stageOptions.map(s =>
    `<option value="${escHtml(s)}" ${s === lead.stage ? 'selected' : ''}>${escHtml(leadsLabel(LEADS_STAGE_LABELS, s))}</option>`
  ).join('');
  return `
    <div class="leads-kanban-card" data-lead-id="${lead.id}">
      <div class="leads-kanban-card-name">${channelIcon(lead.primary_channel)}${escHtml(lead.business_name || '')}</div>
      <div class="leads-kanban-card-owner">
        <span class="leads-badge leads-badge-owner-${escHtml(leadsSlug(lead.owner))}">${escHtml(leadsLabel(LEADS_OWNER_LABELS, lead.owner) || '—')}</span>
        <span class="leads-badge leads-badge-${escHtml(lead.priority || 'Medium')}">${escHtml(leadsLabel(LEADS_PRIORITY_LABELS, lead.priority))}</span>
      </div>
      <select class="leads-pill-select leads-kanban-stage-select">${optSel}</select>
    </div>
  `;
}

function renderLeadsKanban(stats, items) {
  const statStages = (stats.by_stage || []).map(s => s.stage).filter(Boolean);
  const allStageOptions = Array.from(new Set([...statStages, ...LEADS_STAGE_OPTIONS]));
  const byStage = new Map();
  allStageOptions.forEach(s => byStage.set(s, []));
  items.forEach(lead => {
    const s = lead.stage || 'New';
    if (!byStage.has(s)) byStage.set(s, []);
    byStage.get(s).push(lead);
  });
  // Фіксований порядок стадій воронки (не сортуємо за кількістю — інакше колонки
  // "стрибають" місцями після кожної зміни стадії, і дошку важко читати).
  const orderedStages = LEADS_STAGE_OPTIONS.filter(s => byStage.has(s))
    .concat([...byStage.keys()].filter(s => !LEADS_STAGE_OPTIONS.includes(s)));

  leadsKanbanColumnsEl.innerHTML = orderedStages.map(stage => `
    <div class="leads-kanban-column leads-kanban-column-${escHtml(leadsSlug(stage))}" data-stage="${escHtml(stage)}">
      <div class="leads-kanban-column-head">
        <span class="leads-kanban-column-title">${escHtml(leadsLabel(LEADS_STAGE_LABELS, stage))}</span>
        <span class="leads-kanban-column-count">${byStage.get(stage).length}</span>
      </div>
      <div class="leads-kanban-cards">
        ${byStage.get(stage).map(lead => leadsKanbanCardHtml(lead, allStageOptions)).join('')}
      </div>
    </div>
  `).join('');
  leadsKanbanColumnsEl.scrollLeft = 0;

  leadsKanbanColumnsEl.querySelectorAll('.leads-kanban-card').forEach(card => {
    const leadId = Number(card.dataset.leadId);
    card.querySelector('.leads-kanban-stage-select')?.addEventListener('change', async e => {
      try {
        await api('PATCH', `/leads/${leadId}`, { stage: e.target.value });
        showToast('Стадію оновлено.');
        openLeadsKanban();
      } catch (err) {
        showToast(err.message || 'Не вдалося оновити стадію.', true);
      }
    });
  });
}

let sidebarMode = 'chats';

function openLeadsSidebar() {
  if (!leadsSidebarView) return;
  if (!token) { showToast('Спочатку виконайте вхід.', true); return; }
  sidebarMode = 'leads';
  if (sidebarSearchEl) sidebarSearchEl.hidden = true;
  if (convList) convList.hidden = true;
  leadsSidebarView.hidden = false;
  if (sidebarTitleEl) sidebarTitleEl.textContent = 'Ліди';
  if (btnLeadsExport) btnLeadsExport.hidden = false;
  if (btnLeadsAdd) btnLeadsAdd.hidden = false;
  if (btnNewChat) btnNewChat.hidden = true;
  if (btnLeads) btnLeads.classList.add('active-mode');
  loadLeadsStats();
  loadLeadsList();
}

function closeLeadsSidebar() {
  sidebarMode = 'chats';
  if (sidebarSearchEl) sidebarSearchEl.hidden = false;
  if (convList) convList.hidden = false;
  if (leadsSidebarView) leadsSidebarView.hidden = true;
  if (sidebarTitleEl) sidebarTitleEl.textContent = 'Чати';
  if (btnLeadsExport) btnLeadsExport.hidden = true;
  if (btnLeadsAdd) btnLeadsAdd.hidden = true;
  if (btnNewChat) btnNewChat.hidden = false;
  if (btnLeads) btnLeads.classList.remove('active-mode');
  closeLeadDetail();
}

function openLeadCreateModal() {
  if (!leadCreateModal) return;
  leadCreateModal.hidden = false;
  syncOverlayLock();
  ['lead-new-name', 'lead-new-country', 'lead-new-city', 'lead-new-phone', 'lead-new-email', 'lead-new-instagram', 'lead-new-notes']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const ownerSel = document.getElementById('lead-new-owner');
  if (ownerSel) ownerSel.value = leadsState.owner || 'Manager 1';
  if (leadNewPriority && !leadNewPriority.options.length) {
    leadNewPriority.innerHTML = LEADS_PRIORITY_OPTIONS.map(p => `<option value="${escHtml(p)}">${escHtml(leadsLabel(LEADS_PRIORITY_LABELS, p))}</option>`).join('');
  }
  if (leadNewPriority) leadNewPriority.value = 'Medium';
}

function closeLeadCreateModal() {
  if (!leadCreateModal) return;
  leadCreateModal.hidden = true;
  syncOverlayLock();
}

async function saveNewLead() {
  const name = document.getElementById('lead-new-name')?.value.trim();
  if (!name) { showToast("Вкажіть назву бізнесу.", true); return; }
  const payload = {
    business_name: name,
    country: document.getElementById('lead-new-country')?.value.trim() || '',
    city_area: document.getElementById('lead-new-city')?.value.trim() || '',
    owner: document.getElementById('lead-new-owner')?.value || 'Manager 1',
    priority: leadNewPriority?.value || 'Medium',
    phone: document.getElementById('lead-new-phone')?.value.trim() || '',
    email: document.getElementById('lead-new-email')?.value.trim() || '',
    instagram: document.getElementById('lead-new-instagram')?.value.trim() || '',
    notes: document.getElementById('lead-new-notes')?.value.trim() || '',
  };
  try {
    await api('POST', '/leads', payload);
    showToast('Лід створено.');
    closeLeadCreateModal();
    loadLeadsStats();
    loadLeadsList();
  } catch (err) {
    showToast(err.message || 'Не вдалося створити лід.', true);
  }
}

async function exportLeadsCsv() {
  try {
    await downloadProtectedFile(`${API}/leads/export?${leadsQueryString()}`, 'leads_export.csv');
  } catch (err) {
    showToast(err.message || 'Не вдалося експортувати CSV.', true);
  }
}

if (btnLeads) btnLeads.addEventListener('click', () => {
  if (sidebarMode === 'leads') closeLeadsSidebar();
  else openLeadsSidebar();
});
if (btnCloseLeadCreate) btnCloseLeadCreate.addEventListener('click', closeLeadCreateModal);
if (btnLeadsAdd) btnLeadsAdd.addEventListener('click', openLeadCreateModal);
if (btnLeadCreateSave) btnLeadCreateSave.addEventListener('click', saveNewLead);
if (btnLeadsExport) btnLeadsExport.addEventListener('click', exportLeadsCsv);
if (leadsKanbanEntry) leadsKanbanEntry.addEventListener('click', openLeadsKanban);
if (btnKanbanBack) btnKanbanBack.addEventListener('click', closeLeadsKanban);
if (btnIntegrations) btnIntegrations.addEventListener('click', () => {
  if (integrationsView && !integrationsView.hidden) closeIntegrationsView();
  else openIntegrationsView();
});
if (btnIntegrationsBack) btnIntegrationsBack.addEventListener('click', closeIntegrationsView);
if (leadCreateModal) {
  leadCreateModal.addEventListener('click', e => { if (e.target === leadCreateModal) closeLeadCreateModal(); });
}
let leadsSearchTimer = null;
if (leadsSearchInput) {
  leadsSearchInput.addEventListener('input', () => {
    clearTimeout(leadsSearchTimer);
    leadsSearchTimer = setTimeout(() => {
      leadsState.search = leadsSearchInput.value.trim();
      leadsState.page = 1;
      loadLeadsList();
    }, 350);
  });
}
if (leadsFilterOwner) leadsFilterOwner.addEventListener('change', () => {
  setLeadsOwnerFilter(leadsFilterOwner.value); leadsState.page = 1; loadLeadsList();
});
if (leadsFilterStage) leadsFilterStage.addEventListener('change', () => {
  leadsState.stage = leadsFilterStage.value; leadsState.page = 1; loadLeadsList();
});
if (leadsFilterPriority) leadsFilterPriority.addEventListener('change', () => {
  leadsState.priority = leadsFilterPriority.value; leadsState.page = 1; loadLeadsList();
});

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
  unreadWhileScrolledUp = 0;
  updateScrollBottomFab();
  updateConvItem(activeConvId, {
    last_message_text: conversationPreview(msg),
    last_message_at: msg.created_at,
  });
  playSendTone().catch(() => {});
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
    !!leadCreateModal && !leadCreateModal.hidden
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
  const remember = !authRememberMe || authRememberMe.checked;
  const store = remember ? localStorage : sessionStorage;
  const other = remember ? sessionStorage : localStorage;
  store.setItem(TOKEN_KEY, token);
  store.setItem(BANK_TOKEN_KEY, token);
  store.setItem(USER_KEY, JSON.stringify(me));
  // Прибираємо сліди з іншого сховища, щоб не лишався застарілий токен від попереднього вибору.
  other.removeItem(TOKEN_KEY);
  other.removeItem(BANK_TOKEN_KEY);
  other.removeItem(USER_KEY);
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
  localStorage.removeItem(BANK_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(BANK_TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
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
  updateNetworkPill();
  syncOverlayLock();
}

function showApp() {
  authScreen.hidden = true;
  appEl.hidden = false;
  if (me && topbarAvatar) topbarAvatar.textContent = initial(me.full_name);
  const isLeadsAdmin = ['admin', 'platform_admin'].includes(me?.role);
  if (btnLeads) btnLeads.hidden = !isLeadsAdmin;
  if (btnIntegrations) btnIntegrations.hidden = !isLeadsAdmin;
  if (isLeadsAdmin) loadLeadsStats().catch(() => {});
  updateNetworkPill();
  ensureMessengerBankStatus().catch(() => {});
  loadConversations();
  ensurePushSubscriptionSilent().catch(() => {});
  startGlobalPoll();
  pollUnreadBadge();
  runClientDiagnostics().catch(() => {});
  startIncomingCallCheck();
  syncOverlayLock();
}

// ════════════════════════════════════════════
// Conversations
// ════════════════════════════════════════════
async function loadConversations() {
  if (!isAppOnline) return;
  if (pollBusyConversations) return;
  pollBusyConversations = true;
  try {
    const compact = isDataSaverEnabled() ? '?compact=1' : '';
    convData = await apiGetRetry(`/messenger/conversations${compact}`, { retries: 1, timeoutMs: 9000 });
    renderConvList(convData);
    if (shouldSyncConversationsPresence()) {
      pollConversationsPresence().catch(() => {});
    }
  } catch (err) {
    if (isUnauthorizedError(err)) doLogout();
  } finally {
    pollBusyConversations = false;
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
    name.includes('arm bank assistant') ||
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
  return `<span class="verified-inline" title="Верифіковано ARM Bank" aria-label="Верифіковано ARM Bank">
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

function setChatHeaderStatus(text, isOnline = false) {
  if (!chatPartnerRole) return;
  chatPartnerRole.textContent = String(text || '');
  chatPartnerRole.classList.toggle('online', !!isOnline);
}

function normalizePresenceTimestamp(value) {
  if (value === null || value === undefined || value === false) return null;
  if (value === true) return new Date().toISOString();
  if (typeof value === 'object') {
    const nested = value.last_seen_at ?? value.lastSeenAt ?? value.last_seen ?? value.ts ?? value.updated_at ?? null;
    if (nested !== null && nested !== undefined) return normalizePresenceTimestamp(nested);
    return null;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function applyPresencePayload(payload) {
  if (!payload) return;
  if (Array.isArray(payload)) {
    payload.forEach(item => {
      const uid = Number(item?.user_id ?? item?.id);
      if (!Number.isFinite(uid)) return;
      const ts = normalizePresenceTimestamp(item?.last_seen_at ?? item?.lastSeenAt ?? item?.ts ?? item?.online);
      if (!ts) return;
      presenceCache[uid] = ts;
    });
  } else if (typeof payload === 'object') {
    Object.entries(payload).forEach(([key, val]) => {
      const uid = Number(key);
      if (!Number.isFinite(uid)) return;
      const ts = normalizePresenceTimestamp(val);
      if (!ts) return;
      presenceCache[uid] = ts;
    });
  }

  convData.forEach(conv => {
    if (conv?.is_group || !conv?.partner?.id) return;
    const uid = Number(conv.partner.id);
    const ts = presenceCache[uid];
    if (ts) conv.partner.last_seen_at = ts;
  });

  if (activePartner?.id) {
    const ts = presenceCache[Number(activePartner.id)];
    if (ts) activePartner.last_seen_at = ts;
  }
}

function updateActivePartnerPresenceStatus() {
  if (!activePartner || isAssistantPartner(activePartner)) return;
  const uid = Number(activePartner.id);
  const knownTs = presenceCache[uid] || activePartner.last_seen_at || null;
  const onlineNow = isOnline(uid);
  if (onlineNow) {
    setChatHeaderStatus('онлайн', true);
    return;
  }
  if (knownTs) {
    setChatHeaderStatus(`востаннє ${relativeTime(knownTs)}`, false);
    return;
  }
  setChatHeaderStatus('статус уточнюється…', false);
}

function collectConversationPartnerIds(limit = 50) {
  const ids = [];
  convData.forEach(conv => {
    if (conv?.is_group || !conv?.partner?.id) return;
    const uid = Number(conv.partner.id);
    if (!Number.isFinite(uid)) return;
    if (!ids.includes(uid)) ids.push(uid);
  });
  return ids.slice(0, Math.max(1, Number(limit || 1)));
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
  const partnerId = !isGroup && conv.partner ? conv.partner.id : null;
  el.innerHTML = `
    <div class="conv-avatar-wrap" style="position:relative;display:inline-flex;flex-shrink:0;">
      <div class="conv-avatar${isGroup ? ' group' : ''}${isAssistant ? ' assistant' : ''}">${isAssistant ? assistantGlyphMarkup() : esc(initial(name))}</div>
      ${partnerId && isOnline(partnerId) ? '<span class="presence-dot"></span>' : ''}
    </div>
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
  const isSelfChat = SELF_CHAT_NAMES.includes(conv.group_name);
  const name    = convName(conv);
  chatAvatar.innerHTML = isAssistant ? assistantGlyphMarkup() : esc(initial(name));
  chatAvatar.className = 'chat-header-avatar' + (isGroup ? ' group' : '') + (isAssistant ? ' assistant' : '');
  chatPartnerName.classList.toggle('with-verified', isAssistant);
  chatPartnerName.innerHTML = renderNameWithVerified(name, isAssistant);
  if (isSelfChat) {
    setChatHeaderStatus('Особисті нотатки · тільки ви');
  } else if (isGroup) {
    setChatHeaderStatus('Групова розмова');
  } else if (isAssistant) {
    setChatHeaderStatus('Банківський асистент · Швидкі дії зверху');
  } else {
    updateActivePartnerPresenceStatus();
  }
  syncAssistantUi(isAssistant);
  if (btnCall) btnCall.hidden = isAssistant || isSelfChat;
  if (btnCall) btnCall.title = isGroup ? 'Груповий дзвінок' : 'Голосовий дзвінок';
  const groupInfoBtn = document.getElementById('group-info-btn');
  if (groupInfoBtn) groupInfoBtn.hidden = !isGroup || isSelfChat;
  if (groupPanelOpen) closeGroupPanel();

  // Opening any chat must dismiss the Kanban board — otherwise tapping a lead
  // card while the board is open leaves both stacked in the flex column
  // (the chat input bar floating above the board).
  if (leadsKanbanView) leadsKanbanView.hidden = true;
  if (leadsKanbanEntry) leadsKanbanEntry.classList.remove('active');
  if (integrationsView) integrationsView.hidden = true;

  chatEmpty.hidden = true;
  chatView.hidden  = false;
  document.querySelectorAll('.conv-item').forEach(el =>
    el.classList.toggle('active', +el.dataset.convId === activeConvId));

  messagesList.innerHTML = '';
  photosByMessageId.clear();
  window._lastRenderKey = null;
  msgInput.value = '';
  unreadWhileScrolledUp = 0;
  isNearBottom = true;
  updateScrollBottomFab();
  updateSendBtn();
  await fetchMessages();
  startConvPoll();
  if (!isGroup && !isAssistant) pollPresence().catch(() => {});
  if (window.innerWidth >= 1024 && msgInput) {
    setTimeout(() => {
      try { msgInput.focus(); } catch (_) {}
    }, 40);
  }
}

// ════════════════════════════════════════════
// Messages
// ════════════════════════════════════════════
async function fetchMessages(prepend = false) {
  if (!activeConvId) return;
  try {
    const fid    = firstMsgId();
    const initialLimit = isDataSaverEnabled() ? 36 : 50;
    const olderLimit = isDataSaverEnabled() ? 20 : 30;
    const params = prepend && fid > 0
      ? `?before_id=${fid}&limit=${olderLimit}`
      : `?limit=${initialLimit}`;
    const msgs   = await api('GET', `/messenger/conversations/${activeConvId}/messages${params}`);
    if (!prepend) {
      messagesList.innerHTML = '';
      photosByMessageId.clear();
      renderMessages(msgs, false);
      if (msgs.length) lastMsgId = msgs[msgs.length - 1].id;
      scrollToBottom(true);
      refreshScrollState();
    } else {
      if (!msgs.length) { noMoreOlder = true; return; }
      const prevFirst = messagesList.firstElementChild;
      renderMessages(msgs, true);
      if (prevFirst) prevFirst.scrollIntoView({ block: 'start' });
      refreshScrollState();
    }
    updateConvItem(activeConvId, { unread: 0 });
  } catch (err) { console.error('[msg] fetch', err); }
}

function firstMsgId() {
  const el = messagesList.querySelector('.msg-bubble-wrap[data-id]');
  return el ? +el.dataset.id : 0;
}

function renderMessages(msgs, prepend = false) {
  // Skip re-render if same messages
  if (!prepend) {
    const newKey = msgs.map(m => m.id).join(',');
    if (window._lastRenderKey === newKey) return;
    window._lastRenderKey = newKey;
  }
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
  const periodMatch = text.match(
    /(?:\(|Період:\s*)(\d{4}-\d{2}-\d{2}\s*(?:→|->)\s*\d{4}-\d{2}-\d{2})\)?/i
  );
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
    <a class="assistant-statement-btn" href="${escapeAttr(info.link)}" target="_blank" rel="noopener noreferrer" data-protected-download="1" data-file-kind="${esc(info.kind)}">Відкрити ${esc(info.kind)}</a>
    <div class="assistant-statement-note">Завантаження відкриється в захищеному режимі ARM Bank.</div>
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
    const voice = parseVoicePayload(msg.text);
    if (!voice) {
      content = `<div class="msg-bubble">${esc('Голосове недоступне')}</div>`;
    } else {
      const src = voiceDataUrl(voice);
      const dur = voice.durationMs > 0 ? ` · ${Math.round(voice.durationMs / 1000)}с` : '';
      content = `<div class="msg-bubble voice-bubble">
        <div class="voice-player">
          <div class="voice-player-head">
            <span class="voice-icon" aria-hidden="true">🎤</span>
            <span class="voice-title">Голосове повідомлення${dur}</span>
          </div>
          <div class="voice-wave" aria-hidden="true">
            <span></span><span></span><span></span><span></span><span></span>
          </div>
          <audio controls playsinline preload="metadata" src="${src}"></audio>
        </div>
      </div>`;
    }
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
  } else if (msgType === 'call') {
    const data = (() => { try { return typeof msg.text === 'string' ? JSON.parse(msg.text) : (msg.text || {}); } catch (_) { return {}; } })();
    const isCaller = data.caller_id === me?.id;
    const callStatus = data.call_status || '';
    const dur = data.duration;
    let icon = '📞', label = '';
    if (callStatus === 'ended' && dur) {
      const m = Math.floor(dur / 60), s = dur % 60;
      label = `Дзвінок · ${m}:${String(s).padStart(2, '0')}`;
      icon = '📞';
    } else if (callStatus === 'missed') {
      label = isCaller ? 'Без відповіді' : 'Пропущений дзвінок';
      icon = '📵';
    } else if (callStatus === 'rejected') {
      label = 'Дзвінок відхилено';
      icon = '📵';
    } else {
      label = 'Дзвінок';
    }
    content = `<div class="msg-bubble call-bubble"><span class="call-icon">${icon}</span> ${esc(label)}</div>`;
  } else {
    const statementBubble = assistantIncoming ? buildAssistantStatementBubble(msg.text) : null;
    content = statementBubble || `<div class="msg-bubble">${formatMessageTextHtml(msg.text)}</div>`;
  }

  const activeConvData = convData.find(c => c.id === activeConvId);
  const showSenderName = !isMe && activeConvData?.is_group;
  const senderNameHtml = showSenderName && msg.sender_name
    ? `<div class="msg-sender-name">${esc(msg.sender_name)}</div>`
    : '';

  wrap.innerHTML = `
    ${!isMe ? `<div class="msg-sender-avatar${assistantIncoming ? ' assistant' : ''}">${assistantIncoming ? assistantGlyphMarkup() : esc(ini)}</div>` : ''}
    <div class="msg-inner">${senderNameHtml}${content}<div class="msg-time">${timeStr}</div></div>`;
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
    if (action === 'marketplace') {
      await sendCommand('/маркет');
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
    const payloadLimit = isDataSaverEnabled() ? 1_400_000 : 2_000_000;
    if (payload.length > payloadLimit) {
      showToast('Фото занадто важкі. Оберіть менше або менший розмір.', true);
      return;
    }
    const msg = await api('POST', `/messenger/conversations/${activeConvId}/messages`, {
      text: payload,
      msg_type: 'image',
    });
    appendMessage(msg);
    lastMsgId = msg.id;
    unreadWhileScrolledUp = 0;
    updateScrollBottomFab();
    updateConvItem(activeConvId, {
      last_message_text: conversationPreview(msg),
      last_message_at: msg.created_at,
    });
    playSendTone().catch(() => {});
    const approxKb = Math.max(1, Math.round((payload.length * 0.75) / 1024));
    showToast(`Фото надіслано · ~${approxKb} KB`);
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
  const saver = isDataSaverEnabled();
  const maxSide = saver ? 1120 : (isLowBandwidthNetwork() ? 1280 : 1480);
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
  const height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, width, height);

  let quality = saver ? 0.74 : 0.82;
  const targetLen = saver ? 340_000 : 560_000;
  const minQuality = saver ? 0.46 : 0.54;
  let out = canvas.toDataURL('image/jpeg', quality);
  while (out.length > targetLen && quality > minQuality) {
    quality -= 0.08;
    out = canvas.toDataURL('image/jpeg', quality);
  }
  const base64 = out.split(',')[1] || '';
  if (!base64) return null;
  return { mime: 'image/jpeg', data: base64, w: width, h: height };
}

function appendMessage(msg, autoScroll = true) {
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
  if (autoScroll) scrollToBottom(false);
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
  if (typeof window.MediaRecorder === 'undefined') {
    showToast('Запис голосових не підтримується цим браузером.', true);
    return;
  }
  const micGranted = await ensureMicrophonePermission(true);
  if (!micGranted) return;
  recordStartInFlight = true;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    audioChunks  = [];
    recSeconds   = 0;
    recStartedAtMs = Date.now();

    const canCheck = typeof MediaRecorder.isTypeSupported === 'function';
    const preferredTypes = [
      'audio/mp4;codecs=mp4a.40.2',
      'audio/mp4',
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
      'audio/aac',
      'audio/x-m4a',
    ];
    const mimeType = canCheck
      ? (preferredTypes.find(t => MediaRecorder.isTypeSupported(t)) || '')
      : '';
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
  const blobMime = normalizeVoiceMime(mediaRecorder?.mimeType || audioChunks[0]?.type || 'audio/webm');
  const blob = new Blob(audioChunks, { type: blobMime });
  const durationMs = Date.now() - (recStartedAtMs || Date.now());
  if (durationMs < MIN_REC_MS) {
    showToast('Утримуйте кнопку довше для голосового.', true);
    vibrate([8, 22, 8]);
    return;
  }
  if (blob.size > 700_000) { showToast('Запис занадто великий (макс. ~90 с).', true); return; }
  const b64 = await blobToBase64(blob);
  const payload = JSON.stringify({
    v: 1,
    mime: blobMime,
    data: b64,
    duration_ms: Math.round(durationMs),
  });
  try {
    const msg = await api('POST', `/messenger/conversations/${activeConvId}/messages`, {
      text: payload, msg_type: 'voice',
    });
    appendMessage(msg);
    lastMsgId = msg.id;
    unreadWhileScrolledUp = 0;
    updateScrollBottomFab();
    updateConvItem(activeConvId, {
      last_message_text: conversationPreview(msg),
      last_message_at: msg.created_at,
    });
    vibrate([12, 28, 18]);
    playSendTone().catch(() => {});
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
function _globalPollInterval() {
  const saver = isDataSaverEnabled();
  if (document.hidden) {
    if (pushReadyCache) return saver ? 90000 : 60000;
    return saver ? 60000 : 28000;
  }
  return saver ? 20000 : 12000;
}

function _convPollInterval() {
  const saver = isDataSaverEnabled();
  if (document.hidden) return saver ? 12000 : 6000;
  return saver ? 4500 : 2500;
}

function _presencePollInterval() {
  const saver = isDataSaverEnabled();
  if (document.hidden) return saver ? 55000 : 34000;
  return saver ? 24000 : 14000;
}

function _incomingPollInterval() {
  const saver = isDataSaverEnabled();
  if (document.hidden) {
    if (pushReadyCache) return saver ? 18000 : 12000;
    return saver ? 12000 : 6000;
  }
  return saver ? 5000 : 2500;
}

function shouldSyncConversationsPresence(force = false) {
  if (force) {
    lastConvPresenceSyncAt = Date.now();
    return true;
  }
  const now = Date.now();
  const minGap = document.hidden
    ? (isDataSaverEnabled() ? 90000 : 50000)
    : (isDataSaverEnabled() ? 45000 : 22000);
  if ((now - lastConvPresenceSyncAt) < minGap) return false;
  lastConvPresenceSyncAt = now;
  return true;
}

function startGlobalPoll(doImmediate = true) {
  clearInterval(globalPollTimer);
  if (doImmediate) {
    loadConversations().catch(() => {});
    pollUnreadBadge().catch(() => {});
  }
  globalPollTimer = setInterval(async () => {
    if (!token || !me || !isAppOnline) return;
    if (document.hidden && pushReadyCache && isDataSaverEnabled()) {
      try { await pollUnreadBadge(); } catch (_) {}
      return;
    }
    try { await loadConversations(); } catch (_) {}
    try { await pollUnreadBadge(); }  catch (_) {}
  }, _globalPollInterval());
}

function startConvPoll(doImmediate = true) {
  clearInterval(convPollTimer);
  if (doImmediate) pollNewMessages().catch(() => {});
  convPollTimer = setInterval(pollNewMessages, _convPollInterval());
  startPresencePoll(doImmediate);
}

function clearPolling() {
  clearInterval(globalPollTimer);
  clearInterval(convPollTimer);
  clearInterval(presencePollTimer);
  presencePollTimer = null;
}

// ── Presence ───────────────────────────────
function isOnline(userId) {
  const uid = Number(userId);
  const ts = presenceCache[uid];
  if (!ts) return false;
  return (Date.now() - new Date(ts).getTime()) < 3 * 60 * 1000;
}

async function pollPresence() {
  if (!isAppOnline) return;
  if (!activeConvId || !activePartner?.id) return;
  if (pollBusyPresence) return;
  pollBusyPresence = true;
  try {
    const data = await apiGetRetry(`/messenger/presence?ids=${activePartner.id}`, { retries: 1, timeoutMs: 8500 });
    applyPresencePayload(data);
    updateActivePartnerPresenceStatus();
    renderConvList(convData);
  } catch (_) {
  } finally {
    pollBusyPresence = false;
  }
}

async function pollConversationsPresence() {
  if (!isAppOnline) return;
  if (document.hidden && pushReadyCache && isDataSaverEnabled()) return;
  const ids = collectConversationPartnerIds(50);
  if (!ids.length) return;
  if (pollBusyConvPresence) return;
  pollBusyConvPresence = true;
  try {
    const data = await apiGetRetry(`/messenger/presence?ids=${ids.join(',')}`, { retries: 1, timeoutMs: 8500 });
    applyPresencePayload(data);
    updateActivePartnerPresenceStatus();
    renderConvList(convData);
  } catch (_) {
  } finally {
    pollBusyConvPresence = false;
  }
}

function startPresencePoll(doImmediate = true) {
  clearInterval(presencePollTimer);
  if (doImmediate) pollPresence().catch(() => {});
  presencePollTimer = setInterval(pollPresence, _presencePollInterval());
}

// ── Visibility change — reset poll intervals ──
document.addEventListener('visibilitychange', () => {
  if (globalPollTimer) {
    startGlobalPoll(!document.hidden);
  }
  if (convPollTimer) {
    startConvPoll(!document.hidden);
  }
  if (activeConvId && activePartner?.id) {
    startPresencePoll(!document.hidden);
  }
  if (incomingCheckTimer) {
    startIncomingCallCheck(!document.hidden);
  }
  if (!document.hidden) {
    if (shouldSyncConversationsPresence(true)) {
      pollConversationsPresence().catch(() => {});
    }
    updateNetworkPill();
  }
});

async function pollNewMessages() {
  if (!isAppOnline) return;
  if (!activeConvId) return;
  if (pollBusyMessages) return;
  pollBusyMessages = true;
  try {
    const msgs = await apiGetRetry(`/messenger/conversations/${activeConvId}/poll?after_id=${lastMsgId}`, { retries: 1, timeoutMs: 9000 });
    if (msgs?.length > 0) {
      const shouldAutoScroll = isScrolledNearBottom();
      msgs.forEach(msg => appendMessage(msg, shouldAutoScroll));
      lastMsgId = msgs[msgs.length - 1].id;
      if (!shouldAutoScroll) {
        const incomingCount = msgs.filter(msg => Number(msg.sender_id) !== Number(me?.id)).length;
        unreadWhileScrolledUp += Math.max(0, incomingCount);
      } else {
        unreadWhileScrolledUp = 0;
      }
      refreshScrollState();
      updateConvItem(activeConvId, {
        last_message_text: conversationPreview(msgs[msgs.length - 1]),
        last_message_at:   msgs[msgs.length - 1].created_at,
        unread: 0,
      });
    }
  } catch (err) {
    if (isUnauthorizedError(err)) doLogout();
  } finally {
    pollBusyMessages = false;
  }
}

async function pollUnreadBadge() {
  if (!isAppOnline) return;
  if (pollBusyUnread) return;
  pollBusyUnread = true;
  try {
    const data = await apiGetRetry('/messenger/unread', { retries: 1, timeoutMs: 8000 });
    unreadBadge.hidden = !data?.unread;
  } catch (_) {
  } finally {
    pollBusyUnread = false;
  }
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
  { urls: 'stun:stun.relay.metered.ca:80' },
  // Metered.ca TURN — real credentials, global relay
  {
    urls: 'turn:global.relay.metered.ca:80',
    username: '666665992002713148080e90',
    credential: 'cG2MBiReuuliDYQB',
  },
  {
    urls: 'turn:global.relay.metered.ca:80?transport=tcp',
    username: '666665992002713148080e90',
    credential: 'cG2MBiReuuliDYQB',
  },
  {
    urls: 'turn:global.relay.metered.ca:443',
    username: '666665992002713148080e90',
    credential: 'cG2MBiReuuliDYQB',
  },
  {
    urls: 'turns:global.relay.metered.ca:443?transport=tcp',
    username: '666665992002713148080e90',
    credential: 'cG2MBiReuuliDYQB',
  },
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
    const backendServers = sanitizeIceServers(cfg?.ice_servers);
    // Always include our built-in TURN servers (metered.ca) as they are reliable.
    // Backend env var may point to stale/dead TURN servers, so we always append ours.
    const turnServers = DEFAULT_ICE_SERVERS.filter(s => {
      const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
      return urls.some(u => String(u).startsWith('turn:') || String(u).startsWith('turns:'));
    });
    rtcConfig = { iceServers: [...backendServers, ...turnServers] };
  } catch (_) {
    rtcConfig = { iceServers: [...DEFAULT_ICE_SERVERS] };
  }
}

function waitForIceGathering(pc, timeoutMs = 7000) {
  return new Promise(resolve => {
    if (pc.iceGatheringState === 'complete') { resolve(); return; }
    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(resolve, timeoutMs);
  });
}

function renderCallStatus() {
  const suffix = (callStatusBase === 'Підключено' && callQualityLabel) ? ` · ${callQualityLabel}` : '';
  if (callScreenStatus) callScreenStatus.textContent = `${callStatusBase}${suffix}`;
}

function setCallStatusBase(text) {
  callStatusBase = String(text || 'З\'єднання...');
  renderCallStatus();
}

function syncMuteUi() {
  const muted = !!isMuted;
  if (btnMute) {
    btnMute.classList.toggle('muted', muted);
    btnMute.setAttribute('aria-pressed', muted ? 'true' : 'false');
    btnMute.title = muted ? 'Увімкнути мікрофон' : 'Вимкнути мікрофон';
  }
  if (callMuteLabel) {
    callMuteLabel.textContent = muted ? 'Мікрофон вимкнено' : 'Мікрофон увімкнено';
  }
  if (callScreenMicState) {
    if (activeCallIsGroup) {
      callScreenMicState.textContent = muted ? 'Ваш мікрофон вимкнено' : 'Ваш мікрофон увімкнено';
    } else {
      callScreenMicState.textContent = muted ? 'Вас не чути' : 'Вас чути';
    }
  }
}

function syncCallButtonState() {
  if (!btnCall) return;
  const hasVisibleCall = !!(callScreen && !callScreen.hidden);
  const hasActiveCall = !!activeCallId || hasVisibleCall;
  const isBusy = !!callDialInProgress || !!callAcceptInProgress;
  btnCall.classList.toggle('active-call', hasActiveCall);
  btnCall.classList.toggle('busy', isBusy && !hasActiveCall);
  btnCall.setAttribute('aria-pressed', hasActiveCall ? 'true' : 'false');
  if (hasActiveCall) {
    btnCall.title = 'Повернутися до дзвінка';
  } else if (isBusy) {
    btnCall.title = 'Підготовка дзвінка...';
  } else {
    btnCall.title = isCurrentConversationGroup() ? 'Груповий дзвінок' : 'Голосовий дзвінок';
  }
}

function activeConversationData() {
  if (!activeConvId) return null;
  return convData.find(c => c.id === activeConvId) || null;
}

function isCurrentConversationGroup() {
  return !!activeConversationData()?.is_group;
}

function parseSignalPayload(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return raw;
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

function memberStateLabel(state) {
  const s = String(state || '').trim();
  if (s === 'joined') return 'у дзвінку';
  if (s === 'invited' || s === 'ringing') return 'очікуємо';
  if (s === 'left') return 'вийшов';
  if (s === 'rejected') return 'відхилив';
  if (s === 'missed') return 'пропущено';
  return 'стан невідомий';
}

function renderCallPeers(members = []) {
  if (!callScreenPeers) return;
  if (!activeCallIsGroup || !Array.isArray(members) || !members.length) {
    callScreenPeers.hidden = true;
    callScreenPeers.innerHTML = '';
    return;
  }
  callScreenPeers.hidden = false;
  callScreenPeers.innerHTML = '';
  const sorted = [...members].sort((a, b) => {
    const score = (m) => (m?.state === 'joined' ? 0 : (m?.state === 'invited' || m?.state === 'ringing' ? 1 : 2));
    return score(a) - score(b);
  });
  sorted.slice(0, 8).forEach(m => {
    const chip = document.createElement('span');
    const state = String(m?.state || '').trim() || 'invited';
    const name = String(m?.full_name || 'Учасник').trim();
    chip.className = `call-peer-chip state-${state}`;
    chip.innerHTML = `<span class="call-peer-chip-dot"></span>${esc(name)} · ${esc(memberStateLabel(state))}`;
    callScreenPeers.appendChild(chip);
  });
}

function closeGroupPeer(userId) {
  const key = Number(userId);
  const entry = groupPeerConnections.get(key);
  if (entry?.pc) {
    try { entry.pc.close(); } catch (_) {}
  }
  groupPeerConnections.delete(key);
  const audioEl = groupPeerAudio.get(key);
  if (audioEl) {
    try {
      audioEl.pause();
      audioEl.srcObject = null;
      audioEl.remove();
    } catch (_) {}
    groupPeerAudio.delete(key);
  }
}

function cleanupGroupCallPeers() {
  Array.from(groupPeerConnections.keys()).forEach(uid => closeGroupPeer(uid));
  groupSignalLastId = 0;
}

function attachGroupRemoteStream(userId, stream) {
  if (!remoteAudioMount || !stream) return;
  const key = Number(userId);
  let audioEl = groupPeerAudio.get(key);
  if (!audioEl) {
    audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.playsInline = true;
    audioEl.dataset.uid = String(key);
    remoteAudioMount.appendChild(audioEl);
    groupPeerAudio.set(key, audioEl);
  }
  if (audioEl.srcObject !== stream) audioEl.srcObject = stream;
}

async function sendGroupSignal(toUserId, signalType, payload) {
  if (!activeCallId) return;
  await api('POST', `/messenger/calls/${activeCallId}/signals`, {
    to_user_id: Number(toUserId),
    signal_type: String(signalType || ''),
    payload,
  });
}

function createGroupPeerConnection(targetUserId, targetName = '') {
  const remoteId = Number(targetUserId);
  if (!Number.isFinite(remoteId) || remoteId <= 0) return null;
  const existing = groupPeerConnections.get(remoteId);
  if (existing?.pc) return existing;
  if (!localStream) return null;

  const pc = new RTCPeerConnection({
    ...rtcConfig,
    iceTransportPolicy: callForceRelay ? 'relay' : 'all',
    bundlePolicy: 'max-bundle',
    iceCandidatePoolSize: callForceRelay ? 0 : 2,
  });

  localStream.getTracks().forEach(track => {
    try { pc.addTrack(track, localStream); } catch (_) {}
  });
  optimizeOutgoingAudio(pc, localStream);

  const entry = {
    pc,
    remoteSet: false,
    offerSent: false,
    name: String(targetName || ''),
  };

  pc.onicecandidate = evt => {
    if (!evt.candidate || !activeCallId || !activeCallIsGroup) return;
    sendGroupSignal(remoteId, 'ice', evt.candidate).catch(() => {});
  };

  pc.ontrack = evt => {
    if (evt?.streams?.[0]) attachGroupRemoteStream(remoteId, evt.streams[0]);
  };

  pc.oniceconnectionstatechange = () => {
    const st = pc.iceConnectionState;
    if (st === 'failed' || st === 'closed') {
      closeGroupPeer(remoteId);
    }
  };

  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (st === 'failed' || st === 'closed') {
      closeGroupPeer(remoteId);
    }
  };

  groupPeerConnections.set(remoteId, entry);
  return entry;
}

async function ensureGroupPeerOffer(userId, name = '') {
  const remoteId = Number(userId);
  if (!Number.isFinite(remoteId) || remoteId <= 0) return;
  if (!me?.id || Number(me.id) === remoteId) return;
  const shouldOffer = Number(me.id) < remoteId;
  const entry = createGroupPeerConnection(remoteId, name);
  if (!entry || !shouldOffer || entry.offerSent) return;
  if (entry.pc.signalingState !== 'stable') return;

  const offer = await entry.pc.createOffer();
  const patched = { type: offer.type, sdp: patchOpusSdp(offer.sdp) };
  await entry.pc.setLocalDescription(patched);
  await sendGroupSignal(remoteId, 'offer', {
    type: entry.pc.localDescription?.type || 'offer',
    sdp: entry.pc.localDescription?.sdp || patched.sdp,
  });
  entry.offerSent = true;
}

async function handleGroupSignal(signal) {
  if (!activeCallId || !activeCallIsGroup || !localStream) return;
  const fromId = Number(signal?.from_user_id || 0);
  if (!Number.isFinite(fromId) || fromId <= 0 || fromId === Number(me?.id || 0)) return;
  const sigType = String(signal?.signal_type || '').trim().toLowerCase();
  const payload = parseSignalPayload(signal?.payload);
  const entry = createGroupPeerConnection(fromId);
  if (!entry) return;

  if (sigType === 'offer') {
    const sdp = typeof payload === 'object' ? payload?.sdp : payload;
    const normalized = normalizeSdp(sdp, 'SDP offer');
    await setRemoteDescriptionSafe(entry.pc, { type: 'offer', sdp: normalized }, 'SDP offer');
    entry.remoteSet = true;
    const answer = await entry.pc.createAnswer();
    const patched = { type: answer.type, sdp: patchOpusSdp(answer.sdp) };
    await entry.pc.setLocalDescription(patched);
    await sendGroupSignal(fromId, 'answer', {
      type: entry.pc.localDescription?.type || 'answer',
      sdp: entry.pc.localDescription?.sdp || patched.sdp,
    });
    return;
  }

  if (sigType === 'answer') {
    const sdp = typeof payload === 'object' ? payload?.sdp : payload;
    if (!sdp) return;
    const normalized = normalizeSdp(sdp, 'SDP answer');
    await setRemoteDescriptionSafe(entry.pc, { type: 'answer', sdp: normalized }, 'SDP answer');
    entry.remoteSet = true;
    return;
  }

  if (sigType === 'ice') {
    const candidate = normalizeIceCandidate(payload);
    if (!candidate) return;
    await entry.pc.addIceCandidate(new RTCIceCandidate(candidate));
    return;
  }

  if (sigType === 'bye') {
    closeGroupPeer(fromId);
  }
}

async function pollGroupSignals() {
  if (!activeCallId || !activeCallIsGroup) return;
  const rows = await api('GET', `/messenger/calls/${activeCallId}/signals?after_id=${groupSignalLastId}`);
  if (!Array.isArray(rows) || !rows.length) return;
  for (const row of rows) {
    groupSignalLastId = Math.max(groupSignalLastId, Number(row?.id || 0));
    try {
      await handleGroupSignal(row);
    } catch (_) {}
  }
}

async function syncGroupCallMembers(members = []) {
  if (!Array.isArray(members)) return;
  renderCallPeers(members);
  const joined = members.filter(m => m?.state === 'joined');
  const joinedIds = joined.map(m => Number(m?.user_id || 0)).filter(v => Number.isFinite(v) && v > 0);
  for (const member of joined) {
    const uid = Number(member?.user_id || 0);
    if (!uid || uid === Number(me?.id || 0)) continue;
    try {
      await ensureGroupPeerOffer(uid, member?.full_name || '');
    } catch (_) {}
  }
  const activeSet = new Set(joinedIds);
  activeSet.delete(Number(me?.id || 0));
  Array.from(groupPeerConnections.keys()).forEach(uid => {
    if (!activeSet.has(uid)) closeGroupPeer(uid);
  });
}

async function pollGroupCall() {
  if (!activeCallId || !activeCallIsGroup) return;
  const cd = await api('GET', `/messenger/calls/${activeCallId}`);
  if (['rejected', 'ended', 'missed'].includes(cd?.status)) {
    if (cd.status === 'rejected') showToast('Груповий дзвінок завершено.');
    if (cd.status === 'ended') showToast('Груповий дзвінок завершено.');
    if (cd.status === 'missed') showToast('Груповий дзвінок пропущено.');
    hangupCall(false, cd.status);
    return;
  }
  const members = Array.isArray(cd?.members) ? cd.members : [];
  const joinedCount = members.filter(m => m?.state === 'joined').length;
  if (joinedCount >= 2) {
    stopOutgoingTone();
    clearOutgoingNoAnswerTimer();
    setCallStatusBase(`У дзвінку · ${joinedCount} учасн.`);
    if (!callConnectedOnce) {
      callConnectedOnce = true;
      playConnectedTone();
    }
    if (!callWallTimer) startCallTimer();
  } else {
    setCallStatusBase('Груповий дзвінок · очікуємо учасників');
  }
  await syncGroupCallMembers(members);
  await pollGroupSignals();
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
  await ensureNotificationPermission(true);
}

async function releaseCallWakeLock() {
  if (!callWakeLock) return;
  try { await callWakeLock.release(); } catch (_) {}
  callWakeLock = null;
}

// Lock-screen / OS media-control integration for active calls (matches the
// pattern used by radio.munister.com.ua's useVoice.ts). Wires the real
// 'hangup' action where supported so a call can be ended from the lock
// screen without opening the app.
function setupCallMediaSession(partnerName) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: partnerName || 'Голосовий дзвінок',
      artist: 'ARM CRM',
    });
    navigator.mediaSession.playbackState = 'playing';
    try {
      navigator.mediaSession.setActionHandler('hangup', () => { hangupCall(true, 'ended'); });
    } catch (_) { /* not supported on this platform */ }
    const resist = () => { navigator.mediaSession.playbackState = 'playing'; };
    navigator.mediaSession.setActionHandler('play', resist);
    navigator.mediaSession.setActionHandler('pause', resist);
  } catch (_) { /* ignore */ }
}

function teardownCallMediaSession() {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
    navigator.mediaSession.setActionHandler('hangup', null);
    navigator.mediaSession.setActionHandler('play', null);
    navigator.mediaSession.setActionHandler('pause', null);
  } catch (_) { /* ignore */ }
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
      latency: { ideal: 0.01 },
      // Chrome-specific flags for better AEC
      googEchoCancellation: true,
      googEchoCancellation2: true,
      googNoiseSuppression: true,
      googNoiseSuppression2: true,
      googAutoGainControl: true,
      googHighpassFilter: true,
      googTypingNoiseDetection: true,
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
    params.encodings[0].maxBitrate   = 64000;  // 64kbps — достатньо для якісної мови
    params.encodings[0].priority     = 'high';
    params.encodings[0].networkPriority = 'high';
    sender.setParameters(params).catch(() => {});
  } catch (_) {}
}

// Modify SDP to add Opus parameters for better voice quality
function patchOpusSdp(sdp) {
  if (!sdp) return sdp;
  // Find Opus payload type
  const opusMatch = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/);
  if (!opusMatch) return sdp;
  const pt = opusMatch[1];
  // Find existing fmtp line for Opus
  const fmtpRe = new RegExp(`(a=fmtp:${pt} .*)`, 'm');
  const newFmtp = `a=fmtp:${pt} minptime=10;ptime=20;maxplaybackrate=48000;useinbandfec=1;usedtx=0;maxaveragebitrate=96000;stereo=0`;
  if (fmtpRe.test(sdp)) {
    return sdp.replace(fmtpRe, newFmtp);
  }
  // Insert after rtpmap line
  return sdp.replace(
    new RegExp(`(a=rtpmap:${pt} opus/48000/2)`),
    `$1\r\n${newFmtp}`
  );
}

function clearCallIceRecoverTimer() {
  if (callIceRecoverTimer) {
    clearTimeout(callIceRecoverTimer);
    callIceRecoverTimer = null;
  }
}

function scheduleCallRecovery({ delayMs = 2100, forceRelay = false } = {}) {
  if (!activeCallId || !peerConnection) return;
  clearCallIceRecoverTimer();
  callIceRecoverTimer = setTimeout(() => {
    if (!activeCallId || !peerConnection) return;
    if (peerConnection.iceConnectionState === 'connected' || peerConnection.iceConnectionState === 'completed') return;
    triggerIceRecovery({ forceRelay }).catch(() => {});
  }, Math.max(300, Number(delayMs || 0)));
}

async function triggerIceRecovery({ forceRelay = false } = {}) {
  if (!peerConnection || !activeCallId || callIceRestartInFlight) return;
  const canTry = callIceRecoverAttempts < 3;
  if (!canTry) return;
  callIceRestartInFlight = true;
  callIceRecoverAttempts += 1;
  clearCallIceRecoverTimer();

  try {
    if (forceRelay && !callForceRelay) {
      callForceRelay = true;
      try {
        peerConnection.setConfiguration({ ...rtcConfig, iceTransportPolicy: 'relay' });
      } catch (_) {}
      setCallStatusBase('Перепідключення через relay...');
    } else {
      setCallStatusBase('Відновлення...');
    }

    const offer = await peerConnection.createOffer({ iceRestart: true });
    const patchedOffer = { type: offer.type, sdp: patchOpusSdp(offer.sdp) };
    await peerConnection.setLocalDescription(patchedOffer);
    await api('PUT', `/messenger/calls/${activeCallId}/offer`, {
      sdp_offer: peerConnection.localDescription?.sdp || patchedOffer.sdp,
    });
    startCallPoll(document.hidden ? 1400 : 900);
    pollCall().catch(() => {});
  } catch (err) {
    if (callIceRecoverAttempts >= 3) {
      showToast('Не вдалося відновити з\'єднання.', true);
      hangupCall(true, 'error');
    }
  } finally {
    callIceRestartInFlight = false;
  }
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
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();

  osc1.type = waveform;
  osc2.type = waveform === 'square' ? 'triangle' : waveform;
  osc1.frequency.setValueAtTime(freq, now);
  osc2.frequency.setValueAtTime(freq * 2.01, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(gainV, now + 0.018);
  gain.gain.exponentialRampToValueAtTime(gainV * 0.58, now + Math.max(0.04, duration * 0.45));
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(ctx.destination);
  osc1.start(now);
  osc2.start(now);
  osc1.stop(now + duration + 0.03);
  osc2.stop(now + duration + 0.03);
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
  toneBeep(660, 0.11, { gain: 0.02, wave: 'triangle' });
  toneBeep(880, 0.14, { gain: 0.019, wave: 'triangle', delay: 0.12 });
}

function playEndTone(error = false) {
  if (!callPrefs.sounds) return;
  if (error) {
    toneBeep(300, 0.13, { wave: 'square', gain: 0.024 });
    toneBeep(220, 0.16, { wave: 'square', gain: 0.024, delay: 0.15 });
    return;
  }
  toneBeep(540, 0.1, { gain: 0.019, wave: 'triangle' });
  toneBeep(420, 0.13, { gain: 0.018, wave: 'triangle', delay: 0.11 });
}

async function playSendTone() {
  if (!callPrefs.sounds) return;
  await ensureCallAudioCtx();
  toneBeep(900, 0.045, { gain: 0.015, wave: 'triangle' });
  toneBeep(1180, 0.052, { gain: 0.012, wave: 'triangle', delay: 0.05 });
}

async function startIncomingTone() {
  stopOutgoingTone();
  if (!callPrefs.sounds && !callPrefs.vibration) return;
  await ensureCallAudioCtx();

  const ringBurst = () => {
    toneBeep(640, 0.16, { gain: 0.022, wave: 'triangle' });
    toneBeep(804, 0.16, { gain: 0.021, wave: 'triangle', delay: 0.2 });
    toneBeep(960, 0.14, { gain: 0.018, wave: 'triangle', delay: 0.38 });
  };
  ringBurst();
  incomingToneTimer = setInterval(ringBurst, 2600);
  if (navigator.vibrate && callPrefs.vibration) navigator.vibrate([130, 90, 130]);
}

async function startOutgoingTone() {
  stopIncomingTone();
  if (!callPrefs.sounds) return;
  await ensureCallAudioCtx();

  const ringback = () => {
    toneBeep(425, 0.26, { wave: 'triangle', gain: 0.016 });
    toneBeep(510, 0.24, { wave: 'triangle', gain: 0.013, delay: 0.03 });
  };
  ringback();
  outgoingToneTimer = setInterval(ringback, 1300);
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
  if (callIncomingLabel) {
    callIncomingLabel.textContent = incomingCallIsGroup ? 'Груповий дзвінок' : 'Голосовий дзвінок';
  }
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
  const baseLabel = incomingCallIsGroup ? 'Груповий дзвінок' : 'Голосовий дзвінок';
  let remain = timeoutSec;
  if (callIncomingLabel) callIncomingLabel.textContent = `${baseLabel} · ${remain}с`;
  incomingCountdownTimer = setInterval(() => {
    remain = Math.max(0, remain - 1);
    if (callIncomingLabel) callIncomingLabel.textContent = `${baseLabel} · ${remain}с`;
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

    // Adaptive bitrate based on network quality
    try {
      const sender = peerConnection?.getSenders?.().find(s => s?.track?.kind === 'audio');
      if (sender && typeof sender.getParameters === 'function') {
        const params = sender.getParameters();
        if (params?.encodings?.[0]) {
          let targetBitrate;
          if (quality === 'якість слабка') {
            targetBitrate = 24000; // Drop to 24kbps on poor network
          } else if (quality === 'мережа нестабільна') {
            targetBitrate = 40000; // 40kbps on unstable
          } else {
            targetBitrate = 64000; // 64kbps on good network
          }
          if (params.encodings[0].maxBitrate !== targetBitrate) {
            params.encodings[0].maxBitrate = targetBitrate;
            sender.setParameters(params).catch(() => {});
          }
        }
      }
    } catch (_) {}
  } catch (_) {}
}

function startCallQualityMonitor() {
  stopCallQualityMonitor();
  sampleCallQuality().catch(() => {});
  callQualityTimer = setInterval(() => { sampleCallQuality().catch(() => {}); }, 3500);
}

function buildPeerConnection() {
  // Use rtcConfig with multiple TURN servers + STUN fallback
  // Browser will try: TURN relay → host candidates → reflexive (if NAT allows)
  const pc = new RTCPeerConnection({
    ...rtcConfig,
    iceTransportPolicy: callForceRelay ? 'relay' : 'all',
    bundlePolicy: 'max-bundle',
    iceCandidatePoolSize: callForceRelay ? 0 : 2,
  });

  pc.ontrack = e => {
    if (remoteAudio.srcObject !== e.streams[0]) remoteAudio.srcObject = e.streams[0];
  };

  // Queue ICE candidates as they arrive (trickle ICE)
  pc.onicecandidate = (evt) => {
    if (evt.candidate) {
      console.log(`[ICE] 🔵 New local candidate: ${evt.candidate.candidate?.substring(0, 50)}`);
      pendingLocalIce.push(evt.candidate);
      // Only flush if we have activeCallId (candidates will be buffered until then)
      if (activeCallId) {
        flushLocalIce().catch(err => {
          console.error('[ICE] Error flushing candidates:', err.message);
        });
      } else {
        console.log('[ICE] ⏳ Buffering candidate (waiting for activeCallId)');
      }
    } else {
      console.log('[ICE] ✓ ICE gathering complete');
    }
  };

  pc.oniceconnectionstatechange = () => {
    const st = pc.iceConnectionState;
    const gathering = pc.iceGatheringState;
    const connState = pc.connectionState;
    console.log(`[ICE] State: ${st} | Gathering: ${gathering} | Connection: ${connState} | Audio tracks: ${localStream?.getAudioTracks().length || 0}`);
    if (st === 'connected' || st === 'completed') {
      console.log('[ICE] ✓✓✓ CONNECTED! Audio should flow now!');
      callIceRecoverAttempts = 0;
      clearCallIceRecoverTimer();
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
      console.log('[ICE] ⚠️ Disconnected - was working before, attempting ICE restart');
      setCallStatusBase('Відновлення...');
      scheduleCallRecovery({ delayMs: 2000, forceRelay: false });
      startCallPoll(document.hidden ? 1400 : 900);
      pollCall().catch(() => {});
    } else if (st === 'failed') {
      console.error('[ICE] ❌ FAILED - no working candidate pairs found, trying relay recovery');
      if (callIceRecoverAttempts >= 2 && callForceRelay) {
        showToast('З\'єднання перервано.', true);
        hangupCall(true, 'error');
        return;
      }
      triggerIceRecovery({ forceRelay: true }).catch(() => {});
    } else if (st === 'checking') {
      console.log('[ICE] 🔍 Checking candidates... (testing connectivity)');
      startCallPoll(document.hidden ? 1300 : 850);
    } else if (st === 'new') {
      console.log('[ICE] 🆕 New state - gathering candidates');
    } else if (st === 'closed') {
      console.log('[ICE] 🔒 Closed');
    }
  };

  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    console.log('[Connection] State changed:', st, '| ICE:', pc.iceConnectionState, '| Audio tracks:', localStream?.getAudioTracks().length || 0);
    if (st === 'connected') {
      console.log('[Connection] ✓ CONNECTED! Audio should flow');
      callIceRecoverAttempts = 0;
      clearCallIceRecoverTimer();
      setCallStatusBase('Підключено');
      if (!callWallTimer) startCallTimer();
      if (!callQualityTimer) startCallQualityMonitor();
      requestCallWakeLock().catch(() => {});
    } else if (st === 'connecting') {
      console.log('[Connection] ⏳ Connecting...');
      setCallStatusBase('З\'єднання...');
    } else if (st === 'disconnected') {
      console.log('[Connection] ⚠️ Disconnected, attempting to reconnect');
      setCallStatusBase('Відновлення...');
      scheduleCallRecovery({ delayMs: 1800, forceRelay: false });
    } else if (st === 'failed' || st === 'closed') {
      console.error('[Connection] ❌ Failed/Closed! ICE state:', pc.iceConnectionState);
      if (st === 'failed') {
        triggerIceRecovery({ forceRelay: true }).catch(() => {});
      } else {
        hangupCall(true, 'error');
      }
    } else if (st === 'new') {
      console.log('[Connection] 🆕 New connection state');
    }
  };

  return pc;
}

async function flushLocalIce() {
  if (!pendingLocalIce.length) {
    console.log('[ICE] No local candidates to flush');
    return;
  }
  if (!activeCallId) {
    console.log('[ICE] ⚠️ Cannot flush: activeCallId not set yet');
    return;
  }
  console.log(`[ICE] 📤 Flushing ${pendingLocalIce.length} local candidates to server (callId=${activeCallId})`);
  const queue = [...pendingLocalIce];
  pendingLocalIce = [];
  let sent = 0;
  let failed = 0;
  const unsent = [];
  await Promise.all(queue.map(async (c) => {
    const cand = normalizeIceCandidate(c);
    if (!cand) {
      failed++;
      return;
    }
    try {
      await api('POST', `/messenger/calls/${activeCallId}/ice`, { candidate: cand });
      sent++;
    } catch (err) {
      failed++;
      unsent.push(c);
    }
  }));
  if (unsent.length) pendingLocalIce.push(...unsent);
  console.log(`[ICE] Flush complete: ${sent} sent, ${failed} failed, ${pendingLocalIce.length} remaining`);
}

async function flushRemoteIce(pc) {
  for (const c of pendingRemoteIce) {
    try { await pc.addIceCandidate(c); } catch (_) {}
  }
  pendingRemoteIce = [];
}

// ── Initiate call (caller) ─────────────────
async function initiateGroupCall() {
  if (!activeConvId) return;
  if (activeCallId) { showToast('Дзвінок вже активний.'); return; }
  if (callAcceptInProgress || callDialInProgress) return;
  callDialInProgress = true;
  syncCallButtonState();
  try {
    if (!checkWebRTCSupport()) return;
    ensureNotificationPermissionInteractive().catch(() => {});
    const micGranted = await ensureMicrophonePermission(true);
    if (!micGranted) return;
    await ensureRtcConfig();
    try {
      localStream = await getCallAudioStream();
    } catch (err) {
      showToast(micError(err), true);
      return;
    }

    const conv = activeConversationData();
    const title = convName(conv || { is_group: true, group_name: 'Група' });
    const data = await api('POST', '/messenger/calls', { conversation_id: activeConvId });
    activeCallId = Number(data.call_id || 0);
    activeCallIsGroup = true;
    activeCallConvId = Number(activeConvId);
    groupSignalLastId = 0;
    cleanupGroupCallPeers();
    showCallScreen(title, 'Груповий дзвінок · запрошуємо учасників');
    setCallStatusBase('Груповий дзвінок · запрошуємо учасників');
    startOutgoingTone().catch(() => {});
    clearOutgoingNoAnswerTimer();
    startCallPoll(1500);
    pollCall().catch(() => {});
  } catch (err) {
    showToast(err.message || 'Не вдалося розпочати груповий дзвінок.', true);
    cleanupPeer();
  } finally {
    callDialInProgress = false;
    syncCallButtonState();
  }
}

async function initiateCall() {
  if (!activeConvId) return;
  if (isCurrentConversationGroup()) {
    await initiateGroupCall();
    return;
  }
  if (!activePartner) return;
  if (activeCallId) { showToast('Дзвінок вже активний.'); return; }
  if (callAcceptInProgress || callDialInProgress) return;
  callDialInProgress = true;
  syncCallButtonState();
  try {
    if (!checkWebRTCSupport()) return;
    ensureNotificationPermissionInteractive().catch(() => {});
    const micGranted = await ensureMicrophonePermission(true);
    if (!micGranted) return;
    await ensureRtcConfig();

    try {
      localStream = await getCallAudioStream();
    } catch (err) { showToast(micError(err), true); return; }

    peerConnection = buildPeerConnection();
    const trackCount = localStream.getTracks().length;
    console.log(`[Initiate] Adding ${trackCount} tracks to peer connection`);
    localStream.getTracks().forEach(t => {
      console.log(`[Initiate] Adding track: ${t.kind} (${t.id})`);
      peerConnection.addTrack(t, localStream);
    });
    console.log('[Initiate] Audio tracks added, optimizing audio');
    optimizeOutgoingAudio(peerConnection, localStream);

    try {
      const offer = await peerConnection.createOffer();
      const patchedOffer = { type: offer.type, sdp: patchOpusSdp(offer.sdp) };
      await peerConnection.setLocalDescription(patchedOffer);
      setCallStatusBase('Запуск...');

      // Send offer immediately with early ICE candidates
      // Don't wait for full gathering (saves 5-7 seconds)
      const { call_id } = await api('POST', '/messenger/calls', {
        conversation_id: activeConvId,
        sdp_offer: peerConnection.localDescription.sdp,
      });
      activeCallId  = call_id;
      activeCallIsGroup = false;
      activeCallConvId = Number(activeConvId);
      remoteSdpSet  = false;
      icePollLastId = 0;
      callConnectedOnce = false;
      callIceRecoverAttempts = 0;
      callForceRelay = false;
      clearCallIceRecoverTimer();

      // Flush any candidates that arrived before activeCallId was set
      console.log(`[Initiate] 🔄 activeCallId set to ${call_id}, buffered candidates: ${pendingLocalIce.length}`);
      await flushLocalIce().catch(err => {
        console.error('[Initiate] Error flushing candidates:', err.message);
      });

      // Show call screen immediately, not after 7s wait
      showCallScreen(activePartner.full_name, 'Виклик...');
      startOutgoingTone().catch(() => {});
      startOutgoingNoAnswerTimer(call_id);

      // Continue gathering candidates in background (will arrive via ICE)
      waitForIceGathering(peerConnection).catch(() => {});

      startCallPoll();
    } catch (err) {
      stopAllCallTones();
      playEndTone(true);
      showToast(err.message, true);
      cleanupPeer();
    }
  } finally {
    callDialInProgress = false;
    syncCallButtonState();
  }
}

// ── Incoming call detection ────────────────
function startIncomingCallCheck(doImmediate = true) {
  clearInterval(incomingCheckTimer);
  if (doImmediate) checkIncoming().catch(() => {});
  incomingCheckTimer = setInterval(checkIncoming, _incomingPollInterval());
}

async function checkIncoming() {
  if (!isAppOnline) return;
  if (activeCallId || callAcceptInProgress || callDialInProgress || peerConnection || localStream || (callScreen && !callScreen.hidden)) return;
  if (pollBusyIncoming) return;
  pollBusyIncoming = true;
  try {
    const calls = await apiGetRetry('/messenger/calls/incoming', { retries: 1, timeoutMs: 9000 });
    if (calls?.length && !incomingCallId) {
      const c = calls[0];
      incomingCallId     = c.id;
      incomingCallIsGroup = !!c.is_group_call;
      incomingCallGroupName = String(c.group_name || '').trim();
      incomingCallerName = c.caller_name || 'Невідомий';
      const incomingTitle = incomingCallIsGroup
        ? (incomingCallGroupName || 'Груповий дзвінок')
        : incomingCallerName;
      callCallerAvatar.textContent = initial(incomingCallerName);
      callCallerName.textContent   = incomingTitle;
      if (callIncomingLabel) {
        if (incomingCallIsGroup) {
          const cnt = Math.max(1, Number(c.participant_count || 0));
          callIncomingLabel.textContent = `Груповий дзвінок · ${cnt} учасн.`;
        } else {
          callIncomingLabel.textContent = 'Голосовий дзвінок';
        }
      }
      callIncoming.hidden = false;
      startIncomingTone().catch(() => {});
      startIncomingAutoRejectTimer(c.id);
      if (document.hidden && window.Notification && Notification.permission === 'granted') {
        notifyViaServiceWorker({
          title: incomingCallIsGroup ? 'Вхідний груповий дзвінок' : 'Вхідний дзвінок',
          body: incomingTitle,
          tag: `ab-incoming-${c.id}`,
          data: { call_id: c.id, type: 'call_incoming', url: '/messenger' },
          renotify: true,
        }).catch(() => {});
      }
      syncOverlayLock();
    } else if (!calls?.length && incomingCallId) {
      hideIncoming(); // cancelled before answer
    }
  } catch (err) {
    if (isUnauthorizedError(err)) doLogout();
  } finally {
    pollBusyIncoming = false;
  }
}

function hideIncoming() {
  clearIncomingTimeoutTimers();
  stopIncomingTone();
  if (callIncoming) callIncoming.classList.remove('shake');
  callIncoming.hidden = true;
  incomingCallId = null;
  incomingCallerName = '';
  incomingCallIsGroup = false;
  incomingCallGroupName = '';
  syncCallButtonState();
  syncOverlayLock();
}

// ── Accept / Reject ────────────────────────
async function acceptGroupCall(callId) {
  if (!callId) return;
  await ensureRtcConfig();
  try {
    localStream = await getCallAudioStream();
  } catch (err) {
    showToast(micError(err), true);
    await api('PUT', `/messenger/calls/${callId}/reject`).catch(() => {});
    return;
  }
  await api('PUT', `/messenger/calls/${callId}/answer`, {});
  const cd = await api('GET', `/messenger/calls/${callId}`);
  activeCallId = Number(callId);
  activeCallIsGroup = true;
  activeCallConvId = Number(cd?.conversation_id || activeConvId || 0);
  groupSignalLastId = 0;
  cleanupGroupCallPeers();
  const displayName = String(cd?.group_name || incomingCallGroupName || 'Груповий дзвінок');
  showCallScreen(displayName, 'Груповий дзвінок · підключення');
  setCallStatusBase('Груповий дзвінок · підключення');
  stopIncomingTone();
  clearOutgoingNoAnswerTimer();
  startCallPoll(1500);
  pollCall().catch(() => {});
}

async function acceptCall() {
  console.log('[Accept] Button clicked, incomingCallId:', incomingCallId);
  if (!incomingCallId || callAcceptInProgress) {
    console.log('[Accept] Rejected: already in progress or no call');
    return;
  }
  callAcceptInProgress = true;
  syncCallButtonState();
  const callId = incomingCallId;
  console.log('[Accept] Accepting call #' + callId);
  const incomingGroup = !!incomingCallIsGroup;
  hideIncoming();
  if (!checkWebRTCSupport()) {
    console.log('[Accept] WebRTC not supported');
    callAcceptInProgress = false;
    syncCallButtonState();
    api('PUT', `/messenger/calls/${callId}/reject`).catch(() => {}); return;
  }
  ensureNotificationPermissionInteractive().catch(() => {});
  const micGranted = await ensureMicrophonePermission(true);
  if (!micGranted) {
    callAcceptInProgress = false;
    syncCallButtonState();
    api('PUT', `/messenger/calls/${callId}/reject`).catch(() => {});
    return;
  }
  if (incomingGroup) {
    try {
      await acceptGroupCall(callId);
    } catch (err) {
      showToast(err?.message || 'Не вдалося приєднатися до групового дзвінка.', true);
      cleanupPeer();
    } finally {
      callAcceptInProgress = false;
      syncCallButtonState();
    }
    return;
  }
  await ensureRtcConfig();

  try {
    console.log('[Accept] Getting audio stream...');
    localStream = await getCallAudioStream();
    console.log('[Accept] Audio stream obtained');
  } catch (err) {
    console.error('[Accept] Mic error:', err.message);
    showToast(micError(err), true);
    callAcceptInProgress = false;
    syncCallButtonState();
    api('PUT', `/messenger/calls/${callId}/reject`).catch(() => {}); return;
  }

  try {
    console.log('[Accept] Fetching call data...');
    const callData = await api('GET', `/messenger/calls/${callId}`);
    peerConnection = buildPeerConnection();
    const trackCount = localStream.getTracks().length;
    console.log(`[Accept] Adding ${trackCount} tracks to peer connection`);
    localStream.getTracks().forEach(t => {
      console.log(`[Accept] Adding track: ${t.kind} (${t.id})`);
      peerConnection.addTrack(t, localStream);
    });
    console.log('[Accept] Audio tracks added, optimizing audio');
    optimizeOutgoingAudio(peerConnection, localStream);
    pendingLocalIce  = [];
    pendingRemoteIce = [];

    const offerSdp = normalizeSdp(callData.sdp_offer, 'SDP offer');
    await setRemoteDescriptionSafe(peerConnection, { type: 'offer', sdp: offerSdp }, 'SDP offer');
    lastProcessedOfferSdp = offerSdp;
    remoteSdpSet = true;
    const answer = await peerConnection.createAnswer();
    const patchedAnswer = { type: answer.type, sdp: patchOpusSdp(answer.sdp) };
    await peerConnection.setLocalDescription(patchedAnswer);
    setCallStatusBase('Прийняття...');

    // Send answer immediately, don't wait for full ICE gathering
    const answerSdp = normalizeSdp(peerConnection.localDescription.sdp, 'SDP answer');
    console.log('[Accept] Sending answer, length:', answerSdp.length);
    await api('PUT', `/messenger/calls/${callId}/answer`, { sdp_answer: answerSdp });
    console.log('[Accept] Answer sent');

    activeCallId  = callId;
    activeCallIsGroup = false;
    activeCallConvId = Number(callData?.conversation_id || activeConvId || 0);
    icePollLastId = 0;
    callConnectedOnce = false;
    callIceRecoverAttempts = 0;
    callForceRelay = false;
    clearCallIceRecoverTimer();
    clearOutgoingNoAnswerTimer();

    // Flush any candidates that arrived before activeCallId was set
    console.log(`[Accept] 🔄 activeCallId set to ${callId}, buffered candidates: ${pendingLocalIce.length}`);
    await flushLocalIce().catch(err => {
      console.error('[Accept] Error flushing candidates:', err.message);
    });

    // Show call screen immediately
    showCallScreen(callData.caller_name || 'Дзвінок', 'З\'єднання...');
    console.log('[Accept] Call screen shown');

    // Continue gathering in background
    waitForIceGathering(peerConnection).catch(() => {});

    startCallPoll();
    console.log('[Accept] ✓ Accept complete, polling started');
  } catch (err) {
    console.error('[Accept] Error:', err.message);
    showToast(err.message || 'Помилка підключення дзвінка.', true);
    api('PUT', `/messenger/calls/${callId}/reject`).catch(() => {});
    cleanupPeer();
  } finally {
    callAcceptInProgress = false;
    syncCallButtonState();
  }
}

async function rejectCall() {
  const id = incomingCallId;
  hideIncoming();
  playEndTone(false);
  clearOutgoingNoAnswerTimer();
  if (id) api('PUT', `/messenger/calls/${id}/reject`).catch(() => {});
}

async function handleCallButtonClick() {
  if (callDialInProgress || callAcceptInProgress) {
    showToast('Триває підготовка дзвінка...');
    return;
  }
  if (activeCallId || (callScreen && !callScreen.hidden)) {
    if (callScreen && callScreen.hidden) {
      callScreen.hidden = false;
      syncOverlayLock();
    }
    syncCallButtonState();
    return;
  }
  await initiateCall();
}

// ── Call polling ───────────────────────────
function startCallPoll(intervalMs = (document.hidden ? 2500 : 1500)) {
  const minimum = document.hidden ? 900 : 700;
  const safeInterval = Math.max(minimum, Number(intervalMs || 0));
  clearInterval(callPollTimer);
  callPollTimer = setInterval(pollCall, safeInterval);
}

async function pollCall() {
  if (!activeCallId) return;
  if (activeCallIsGroup) {
    try {
      await pollGroupCall();
    } catch (_) {}
    return;
  }
  if (!peerConnection) return;
  try {
    const cd = await api('GET', `/messenger/calls/${activeCallId}`);
    console.log(`[Status] Call #${activeCallId}: ${cd.status} | ICE: ${peerConnection.iceConnectionState} | Signaling: ${peerConnection.signalingState} | Connection: ${peerConnection.connectionState}`);
    if (['rejected', 'ended', 'missed'].includes(cd.status)) {
      if (cd.status === 'rejected') {
        console.log('[Status] ❌ Call rejected');
        showToast('Дзвінок відхилено.');
      }
      if (cd.status === 'ended') {
        console.log('[Status] ✓ Call ended');
        showToast('Дзвінок завершено.');
      }
      if (cd.status === 'missed') {
        console.log('[Status] ⏱ Call missed');
        showToast('Пропущений дзвінок.');
      }
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
      }
    }

    // Fetch and add remote ICE candidates from server
    if (remoteSdpSet && activeCallId) {
      try {
        const iceUrl = `/messenger/calls/${activeCallId}/ice?after_id=${icePollLastId}`;
        console.log(`[ICE] 📥 Fetching remote candidates from ${iceUrl}`);
        const iceData = await api('GET', iceUrl);
        // api() already returns data.data, so iceData is the array directly
        if (Array.isArray(iceData)) {
          console.log(`[ICE] Received ${iceData.length} remote candidates`);
          let added = 0, failed = 0;
          for (const row of iceData) {
            icePollLastId = Math.max(icePollLastId, row.id || 0);
            if (row.candidate) {
              try {
                const candidate = typeof row.candidate === 'string' ? JSON.parse(row.candidate) : row.candidate;
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                console.log('[ICE] ✓ Added remote candidate:', candidate.candidate?.substring(0, 50));
                added++;
              } catch (err) {
                console.error('[ICE] ❌ Failed to add candidate:', err.message, 'Data:', row.candidate?.substring(0, 50));
                failed++;
              }
            }
          }
          if (added > 0 || failed > 0) {
            console.log(`[ICE] Fetch complete: ${added} added, ${failed} failed`);
          }
        } else {
          console.log('[ICE] No candidates in response or invalid format. Got:', iceData);
        }
      } catch (err) {
        console.error('[ICE] Error fetching remote candidates:', err.message);
      }
    }

    // Caller ICE restart: send new offer if we initiated restart
    if (peerConnection.signalingState === 'have-local-offer' && remoteSdpSet) {
      // We already have remote SDP but signaling state is 'have-local-offer' (ICE restart)
      // Offer is already in localDescription, just update server with it
      const offer = peerConnection.localDescription;
      if (offer && offer.sdp) {
        await api('PUT', `/messenger/calls/${activeCallId}/offer`, { sdp_offer: offer.sdp }).catch(() => {});
      }
    }

    // Callee: handle ICE restart from caller (new offer with sdp_answer cleared)
    // Only trigger if offer is genuinely different from what we last processed
    if (remoteSdpSet && cd.sdp_offer && !cd.sdp_answer) {
      const newOfferSdp = normalizeSdp(cd.sdp_offer, 'New SDP offer (ICE restart)');
      if (newOfferSdp !== lastProcessedOfferSdp) {
        lastProcessedOfferSdp = newOfferSdp;
        try {
          await setRemoteDescriptionSafe(peerConnection, { type: 'offer', sdp: newOfferSdp }, 'New offer');
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          setCallStatusBase('Збір ICE...');
          await waitForIceGathering(peerConnection);
          const answerSdp = normalizeSdp(peerConnection.localDescription.sdp, 'SDP answer (ICE restart)');
          await api('PUT', `/messenger/calls/${activeCallId}/answer`, { sdp_answer: answerSdp });
        } catch (_) {}
      }
    }

  } catch (_) {}
}

// ── Call screen ────────────────────────────
function showCallScreen(name, status) {
  hideIncoming();
  callScreenAvatar.textContent = initial(name);
  callScreenName.textContent   = name;
  if (callScreenChip) {
    callScreenChip.textContent = activeCallIsGroup ? 'ARM CRM GROUP CALL' : 'ARM CRM SECURE CALL';
  }
  callStatusBase = String(status || 'З\'єднання...');
  callQualityLabel = '';
  renderCallStatus();
  callScreenTimer.hidden       = true;
  callScreen.hidden            = false;
  callConnectedOnce            = false;
  callStartAtMs                = 0;
  callIceRecoverAttempts       = 0;
  callForceRelay               = false;
  callIceRestartInFlight       = false;
  isMuted                      = false;
  clearCallIceRecoverTimer();
  callBackgroundNotifiedForId  = null;
  if (activeCallIsGroup) {
    if (callScreenMicState) callScreenMicState.textContent = 'Груповий режим · mesh';
  } else if (callScreenMicState) {
    callScreenMicState.textContent = 'Вас чути';
  }
  renderCallPeers([]);
  syncMuteUi();
  syncCallButtonState();
  requestCallWakeLock().catch(() => {});
  setupCallMediaSession(name);
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
  if (activeCallIsGroup && activeCallId) {
    Array.from(groupPeerConnections.keys()).forEach(uid => {
      sendGroupSignal(uid, 'bye', { reason: 'leave' }).catch(() => {});
    });
  }
  stopAllCallTones();
  clearIncomingTimeoutTimers();
  clearOutgoingNoAnswerTimer();
  clearCallIceRecoverTimer();
  clearInterval(callPollTimer);
  clearInterval(callWallTimer);
  callWallTimer    = null;
  stopCallQualityMonitor();
  releaseCallWakeLock().catch(() => {});
  teardownCallMediaSession();
  cleanupPeer();
  cleanupGroupCallPeers();
  activeCallId          = null;
  activeCallIsGroup     = false;
  activeCallConvId      = null;
  remoteSdpSet          = false;
  lastProcessedOfferSdp = null;
  icePollLastId         = 0;
  pendingLocalIce       = [];
  pendingRemoteIce      = [];
  isMuted          = false;
  callDialInProgress = false;
  callConnectedOnce = false;
  callAcceptInProgress = false;
  callStartAtMs = 0;
  callStatusBase = 'З\'єднання...';
  callQualityLabel = '';
  callBackgroundNotifiedForId = null;
  callIceRecoverAttempts = 0;
  callForceRelay = false;
  callIceRestartInFlight = false;
  groupSignalLastId = 0;
  callScreen.hidden       = true;
  callScreenTimer.hidden  = true;
  renderCallPeers([]);
  syncMuteUi();
  syncCallButtonState();
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
        const title = callConnectedOnce ? 'Дзвінок триває у фоні' : 'Підключення дзвінка у фоні';
        const body = activePartner?.full_name || callScreenName?.textContent || 'Месенджер';
        notifyViaServiceWorker({
          title,
          body,
          tag: `ab-call-${activeCallId}`,
          data: { call_id: activeCallId, type: 'call_background', url: '/messenger' },
          renotify: false,
          silent: true,
        }).then(ok => {
          if (ok) callBackgroundNotifiedForId = activeCallId;
        }).catch(() => {});
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
  const tracks = localStream.getAudioTracks();
  if (!tracks.length) {
    showToast('Мікрофон недоступний.', true);
    return;
  }
  isMuted = !isMuted;
  tracks.forEach(t => { t.enabled = !isMuted; });
  syncMuteUi();
  showToast(isMuted ? 'Мікрофон вимкнено' : 'Мікрофон увімкнено');
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

function normalizeVoiceMime(rawMime) {
  const base = String(rawMime || '').toLowerCase().split(';')[0].trim();
  if (!base) return 'audio/webm';
  if (base === 'audio/x-m4a') return 'audio/mp4';
  const allowed = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav']);
  return allowed.has(base) ? base : 'audio/webm';
}

function parseVoicePayload(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const data = String(parsed.data || '').trim();
      if (!/^[A-Za-z0-9+/=]+$/.test(data)) return null;
      if (data.length < 64 || data.length > 800_000) return null;
      return {
        mime: normalizeVoiceMime(parsed.mime || ''),
        data,
        durationMs: Math.max(0, Number(parsed.duration_ms || 0) || 0),
      };
    }
  } catch (_) {}
  if (!/^[A-Za-z0-9+/=]+$/.test(raw)) return null;
  if (raw.length < 64 || raw.length > 800_000) return null;
  return { mime: 'audio/webm', data: raw, durationMs: 0 };
}

function voiceDataUrl(item) {
  return `data:${item.mime};base64,${item.data}`;
}

function conversationPreview(msg) {
  if (!msg) return 'Нове повідомлення';
  if (msg.is_deleted) return 'Повідомлення видалено';
  const ownPrefix = Number(msg.sender_id) === Number(me?.id) ? 'Ви: ' : '';
  if ((msg.msg_type || 'text') === 'voice') return `${ownPrefix}🎤 Голосове повідомлення`;
  if ((msg.msg_type || 'text') === 'image') return `${ownPrefix}🖼️ Фото`;
  if ((msg.msg_type || 'text') === 'call') return `${ownPrefix}📞 Дзвінок`;
  return ownPrefix + compactPreview(msg.text || 'Нове повідомлення');
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

function isScrolledNearBottom() {
  if (!messagesWrap) return true;
  const tail = messagesWrap.scrollHeight - messagesWrap.clientHeight - messagesWrap.scrollTop;
  return tail <= 84;
}

function updateScrollBottomFab() {
  if (!btnScrollBottom) return;
  const show = !!activeConvId && !chatView.hidden && !isNearBottom;
  btnScrollBottom.hidden = !show;
  btnScrollBottom.classList.toggle('visible', show);
  if (scrollBottomUnread) {
    const count = Math.max(0, Number(unreadWhileScrolledUp || 0));
    scrollBottomUnread.hidden = !(show && count > 0);
    scrollBottomUnread.textContent = count > 99 ? '99+' : String(count);
  }
}

function refreshScrollState() {
  const nearBottomNow = isScrolledNearBottom();
  isNearBottom = nearBottomNow;
  if (nearBottomNow && unreadWhileScrolledUp) unreadWhileScrolledUp = 0;
  updateScrollBottomFab();
}

function scrollToBottom(instant = false) {
  scrollAnchor.scrollIntoView({ behavior: instant ? 'auto' : 'smooth' });
  isNearBottom = true;
  unreadWhileScrolledUp = 0;
  updateScrollBottomFab();
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
  refreshScrollState();
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
if (callDataSaverToggle) {
  callDataSaverToggle.addEventListener('change', () => {
    callPrefs.dataSaver = !!callDataSaverToggle.checked;
    saveCallPrefs();
    renderCallSettings();
    if (token && me) {
      startGlobalPoll(false);
      if (activeConvId) startConvPoll(false);
      startIncomingCallCheck(false);
    }
    showToast(callPrefs.dataSaver ? 'Економія трафіку увімкнена' : 'Економія трафіку вимкнена');
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
// ── Group panel ──────────────────────────
let groupPanelOpen = false;
let groupMembers   = [];

async function openGroupPanel() {
  if (!activeConvId) return;
  const panel = document.getElementById('group-panel');
  const nameEl = document.getElementById('group-panel-name');
  nameEl.textContent = activePartner?.full_name || 'Група';
  panel.hidden = false;
  groupPanelOpen = true;
  await refreshGroupMembers();
}

function closeGroupPanel() {
  document.getElementById('group-panel').hidden = true;
  groupPanelOpen = false;
}

async function refreshGroupMembers() {
  if (!activeConvId) return;
  try {
    const members = await api('GET', `/messenger/conversations/${activeConvId}/members`);
    groupMembers = Array.isArray(members) ? members : [];
    renderGroupMembers();
  } catch (_) {}
}

function renderGroupMembers() {
  const list = document.getElementById('group-members-list');
  if (!list) return;
  const myId = me?.id;
  const amAdmin = groupMembers.some(m => m.id === myId && m.is_admin);

  list.innerHTML = groupMembers.map(m => {
    const onlineNow = isOnline(m.id);
    const statusText = onlineNow ? 'онлайн' : (m.last_seen_at ? `${relativeTime(m.last_seen_at)}` : '');
    const canRemove = amAdmin && m.id !== myId;
    return `<li class="group-member-item" data-uid="${m.id}">
      <div class="group-member-avatar" style="position:relative">
        ${escHtml(initial(m.full_name))}
        ${onlineNow ? '<span class="presence-dot"></span>' : ''}
      </div>
      <div class="group-member-info">
        <div class="group-member-name">${escHtml(m.full_name)}${m.id === myId ? ' <span style="color:var(--text-muted,#6b7280);font-size:11px">(ви)</span>' : ''}</div>
        ${statusText ? `<div class="group-member-status">${escHtml(statusText)}</div>` : ''}
      </div>
      ${m.is_admin ? '<span class="group-member-badge">адмін</span>' : ''}
      ${canRemove ? `<button class="group-member-remove" onclick="removeMember(${m.id})" title="Видалити">✕</button>` : ''}
    </li>`;
  }).join('');
}

async function removeMember(userId) {
  if (!activeConvId) return;
  if (!confirm('Видалити учасника з групи?')) return;
  try {
    await api('DELETE', `/messenger/conversations/${activeConvId}/members/${userId}`);
    await refreshGroupMembers();
  } catch (err) { showToast(err.message, true); }
}

async function addMemberToGroup() {
  if (!activeConvId) return;
  const phone = prompt('Телефон учасника (+380...)');
  if (!phone) return;
  try {
    // Search user by phone first
    const users = await api('GET', `/messenger/users/search?q=${encodeURIComponent(phone)}`);
    const found = Array.isArray(users) ? users.find(u => u.phone === phone || u.phone === phone.replace(/\s/g, '')) : null;
    if (!found) { showToast('Користувача не знайдено.', true); return; }
    await api('POST', `/messenger/conversations/${activeConvId}/members`, { user_id: found.id });
    await refreshGroupMembers();
    showToast(`${found.full_name} доданий.`);
  } catch (err) { showToast(err.message, true); }
}

async function leaveGroup() {
  if (!activeConvId) return;
  if (!confirm('Вийти з групи?')) return;
  try {
    await api('DELETE', `/messenger/conversations/${activeConvId}/leave`);
    closeGroupPanel();
    activeConvId = null;
    await loadConversations();
    showToast('Ви вийшли з групи.');
  } catch (err) { showToast(err.message, true); }
}

async function renameGroup() {
  if (!activeConvId) return;
  const current = activePartner?.full_name || '';
  const newName = prompt('Нова назва групи:', current);
  if (!newName || newName.trim() === current) return;
  try {
    await api('PUT', `/messenger/conversations/${activeConvId}/group-name`, { group_name: newName.trim() });
    if (activePartner) activePartner.full_name = newName.trim();
    document.getElementById('group-panel-name').textContent = newName.trim();
    const convNameEl = document.getElementById('conv-name');
    if (convNameEl) convNameEl.textContent = newName.trim();
    await loadConversations();
    showToast('Назву змінено.');
  } catch (err) { showToast(err.message, true); }
}

function relativeTime(ts) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return 'щойно';
  if (diff < 3600) return `${Math.floor(diff / 60)} хв тому`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} год тому`;
  return `${Math.floor(diff / 86400)} дн тому`;
}

function escHtml(str) {
  return esc(String(str || ''));
}

document.getElementById('group-info-btn')?.addEventListener('click', openGroupPanel);
document.getElementById('group-panel-close')?.addEventListener('click', closeGroupPanel);
document.getElementById('group-add-member-btn')?.addEventListener('click', addMemberToGroup);
document.getElementById('group-leave-btn')?.addEventListener('click', leaveGroup);
document.getElementById('group-rename-btn')?.addEventListener('click', renameGroup);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (photoViewer && !photoViewer.hidden) { closePhotoViewer(); return; }
    if (bankToolsModal && !bankToolsModal.hidden) { closeBankToolsModal(); return; }
    if (leadCreateModal && !leadCreateModal.hidden) { closeLeadCreateModal(); return; }
    if (leadInfoBanner && !leadInfoBanner.hidden) { closeLeadDetail(); return; }
    if (leadsKanbanView && !leadsKanbanView.hidden) { closeLeadsKanban(); return; }
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
  if (leadsState.currentLeadId) { closeLeadDetail(); return; }
  sidebar.classList.remove('hidden');
  activeConvId = null;
  activePartner = null;
  unreadWhileScrolledUp = 0;
  isNearBottom = true;
  updateScrollBottomFab();
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
msgInput.addEventListener('paste', e => {
  if (!activeConvId) return;
  const items = Array.from(e.clipboardData?.items || []);
  const imageFiles = items
    .filter(item => /^image\//i.test(String(item.type || '')))
    .map(item => item.getAsFile())
    .filter(Boolean);
  if (!imageFiles.length) return;
  e.preventDefault();
  sendPhotos(imageFiles).catch(() => {});
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
    const dlBtn = e.target.closest('.assistant-statement-btn[data-protected-download="1"]');
    if (dlBtn) {
      e.preventDefault();
      const href = String(dlBtn.getAttribute('href') || '').trim();
      if (!href) {
        showToast('Посилання на виписку недоступне.', true);
        return;
      }
      const kind = String(dlBtn.getAttribute('data-file-kind') || 'PDF').toUpperCase();
      const fallbackName = kind === 'CSV' ? 'armybank_statement.csv' : 'armybank_statement.pdf';
      downloadProtectedFile(href, fallbackName)
        .then(() => showToast(`${kind}-виписку завантажено.`))
        .catch(err => showToast(err?.message || 'Не вдалося завантажити виписку.', true));
      return;
    }
    const msgLink = e.target.closest('.msg-link');
    if (msgLink) {
      const href = String(msgLink.getAttribute('href') || '').trim();
      if (/\/api\/transactions\/(?:statement|export)\?/i.test(href)) {
        e.preventDefault();
        const isCsv = /\/api\/transactions\/export\?/i.test(href);
        const fallbackName = isCsv ? 'armybank_statement.csv' : 'armybank_statement.pdf';
        const label = isCsv ? 'CSV' : 'PDF';
        downloadProtectedFile(href, fallbackName)
          .then(() => showToast(`${label}-виписку завантажено.`))
          .catch(err => showToast(err?.message || 'Не вдалося завантажити виписку.', true));
      }
      return;
    }
    const tile = e.target.closest('.photo-tile');
    if (!tile) return;
    const msgId = String(tile.dataset.photoMsg || '');
    const idx = Number(tile.dataset.photoIndex || 0);
    const items = photosByMessageId.get(msgId) || [];
    if (!items.length) return;
    openPhotoViewer(items, idx);
  });
  messagesList.addEventListener('contextmenu', e => {
    if (!(e.target instanceof Element)) return;
    const bubble = e.target.closest('.msg-bubble');
    if (!bubble) return;
    const text = String(bubble.textContent || '').trim();
    if (!text) return;
    e.preventDefault();
    navigator.clipboard?.writeText(text)
      .then(() => showToast('Текст повідомлення скопійовано'))
      .catch(() => showToast('Не вдалося скопіювати текст', true));
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

if (btnCall)       btnCall.addEventListener('click', handleCallButtonClick);
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
window.addEventListener('focus', () => {
  if (!token || !me) return;
  const now = Date.now();
  if ((now - lastFocusSyncAt) < 1800) return;
  lastFocusSyncAt = now;
  loadConversations().catch(() => {});
  pollUnreadBadge().catch(() => {});
  ensurePushSubscriptionSilent().catch(() => {});
  if (shouldSyncConversationsPresence(true)) {
    pollConversationsPresence().catch(() => {});
  }
  if (activePartner?.id) pollPresence().catch(() => {});
  if (activeConvId) pollNewMessages().catch(() => {});
  runClientDiagnostics().catch(() => {});
});
window.addEventListener('online', handleConnectivityChange);
window.addEventListener('offline', handleConnectivityChange);
const _networkConn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
if (_networkConn && typeof _networkConn.addEventListener === 'function') {
  _networkConn.addEventListener('change', () => {
    updateNetworkPill();
    updateDataSaverHint();
    if (token && me) {
      startGlobalPoll(false);
      if (activeConvId) startConvPoll(false);
      startIncomingCallCheck(false);
    }
  });
}
document.addEventListener('visibilitychange', handleVisibilityChange);
window.addEventListener('pageshow', () => {
  handleVisibilityChange();
});
window.addEventListener('pointerdown', primeCallAudioOnUserGesture, { once: true, passive: true });
window.addEventListener('keydown', primeCallAudioOnUserGesture, { once: true });
if (btnScrollBottom) {
  btnScrollBottom.addEventListener('click', () => {
    scrollToBottom(false);
  });
}
if (btnUnread) {
  btnUnread.addEventListener('click', async () => {
    const ok = await ensureNotificationPermission(true);
    if (ok) {
      showToast('Push-сповіщення активовано');
      pollUnreadBadge().catch(() => {});
    }
    runClientDiagnostics().catch(() => {});
  });
}
if (btnPushEnable) {
  btnPushEnable.addEventListener('click', async () => {
    if (pushActionInFlight) return;
    setPushActionBusy(true);
    try {
      const ok = await ensureNotificationPermission(true);
      if (ok) showToast('Push-сповіщення увімкнено.');
      else showToast(lastPushSetupError || 'Не вдалося увімкнути push. Перевірте доступ у браузері.', true);
      await runClientDiagnostics();
    } finally {
      setPushActionBusy(false);
    }
  });
}
if (btnPushResubscribe) {
  btnPushResubscribe.addEventListener('click', async () => {
    if (pushActionInFlight) return;
    setPushActionBusy(true);
    try {
      const notifOk = await ensureNotificationPermission(true);
      if (!notifOk) {
        showToast(lastPushSetupError || 'Спочатку дозвольте сповіщення.', true);
      } else {
        const ok = await forceResubscribeWebPush();
        if (ok) showToast('Push-підписку оновлено.');
        else showToast(lastPushSetupError || 'Не вдалося оновити push-підписку.', true);
      }
      await runClientDiagnostics();
    } finally {
      setPushActionBusy(false);
    }
  });
}
if (btnPushTest) {
  btnPushTest.addEventListener('click', async () => {
    if (pushActionInFlight) return;
    setPushActionBusy(true);
    try {
      const data = await api('POST', '/push/test', {});
      const sentTo = Number(data?.sent_to || 0);
      if (sentTo > 0) {
        showToast(`Тестовий push надіслано (${sentTo}).`);
      } else {
        showToast('Тестовий push надіслано.');
      }
      await runClientDiagnostics();
    } catch (err) {
      showToast(err?.message || 'Тест push не вдався. Оновіть підписку.', true);
    } finally {
      setPushActionBusy(false);
    }
  });
}
if (btnDiagRefresh) {
  btnDiagRefresh.addEventListener('click', () => {
    runClientDiagnostics(true).catch(() => showToast('Не вдалося оновити стан', true));
  });
}

// ════════════════════════════════════════════
// Boot
// ════════════════════════════════════════════
renderCallSettings();
renderGroupPreview();
syncMuteUi();
syncCallButtonState();
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

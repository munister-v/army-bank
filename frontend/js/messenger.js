/* ════════════════════════════════════════════
   ARM CRM — Messenger PWA
   groups · voice messages · WebRTC calls
════════════════════════════════════════════ */
'use strict';

const BASE = window.ARMY_BANK_BASE || '';
const API  = BASE + '/api';
const MESSENGER_ASSET_VERSION = '345';
// Мають точно збігатися з _SAVED_MESSAGES_NAME/_SCHEDULER_NAME у backend/routes/messenger_routes.py
const SAVED_MESSAGES_NAME = 'Збережені повідомлення';
const SCHEDULER_NAME = 'Планувальник';
const SELF_CHAT_NAMES = [SAVED_MESSAGES_NAME, SCHEDULER_NAME];
const TOKEN_KEY = 'msng_token';
const USER_KEY  = 'msng_user';
const BANK_TOKEN_KEY = 'army_bank_token';
const COOKIE_SESSION_TOKEN = '__http_only_cookie__';
const CALL_PREFS_KEY = 'msng_call_prefs_v1';
const PERM_STATE_KEY = 'msng_permission_state_v1';
const API_DEFAULT_TIMEOUT_MS = 12000;
// On tablet widths the workspace needs the whole canvas; a split view clips
// CRM controls and makes the next action ambiguous.
const COMPACT_LAYOUT_MAX_WIDTH = 960;
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
// BUG-009 FIX: Only sync BANK_TOKEN_KEY to the same store as TOKEN_KEY
// Don't unconditionally write to localStorage — breaks "no remember" sessions
if (token && localStorage.getItem(TOKEN_KEY)) {
  localStorage.setItem(BANK_TOKEN_KEY, token);
} else if (token && sessionStorage.getItem(TOKEN_KEY)) {
  sessionStorage.setItem(BANK_TOKEN_KEY, token);
}

// ── Chat state ─────────────────────────────
let activeConvId   = null;
let activePartner  = null;
let lastMsgId      = 0;
let convData       = [];
let teamDirectoryUsers = [];
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
// BUG-016 FIX: Eviction limit to prevent memory leak in long sessions
const PHOTO_MAP_MAX_SIZE = 200;
function evictPhotoMap() {
  if (photosByMessageId.size <= PHOTO_MAP_MAX_SIZE) return;
  const toDelete = photosByMessageId.size - PHOTO_MAP_MAX_SIZE;
  let count = 0;
  for (const key of photosByMessageId.keys()) {
    if (count >= toDelete) break;
    photosByMessageId.delete(key);
    count++;
  }
}
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
const btnPasskeyLogin   = $('btn-passkey-login');
const btnTogglePw       = $('btn-toggle-pw');
const sidebar           = $('sidebar');
const sidebarSearchEl   = $('sidebar-search');
const convList          = $('conv-list');
const convEmpty         = $('conv-empty');
const convSearch        = $('conv-search');
const chatEmpty         = $('chat-empty');
const crmHomeLeads      = $('crm-home-leads');
const crmHomeDay        = $('crm-home-day');
const crmHomeKanban     = $('crm-home-kanban');
const crmHomeOpenings   = $('crm-home-openings');
const crmHomePlanner    = $('crm-home-planner');
const crmHomeNewChat    = $('crm-home-new-chat');
const crmHomeAddLead    = $('crm-home-add-lead');
const crmHomeSecurity   = $('crm-home-security');
const crmHomeSearch     = $('crm-home-search');
const crmHomeLeadsCount = $('crm-home-leads-count');
const crmHomeDayCount   = $('crm-home-day-count');
const chatView          = $('chat-view');
const chatAvatar        = $('chat-avatar');
const chatPartnerName   = $('chat-partner-name');
const chatPartnerRole   = $('chat-partner-role');
const assistantPanel    = $('assistant-panel');
const assistantQuickActions = $('assistant-quick-actions');
const schedulerOverviewEl = $('scheduler-overview');
const schedulerDashboardEl = $('scheduler-dashboard');
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
const chatChannelGate   = $('chat-channel-gate');
const chatChannelGateMark = $('chat-channel-gate-mark');
const chatChannelGateTitle = $('chat-channel-gate-title');
const chatChannelGateText = $('chat-channel-gate-text');
const chatChannelGateAction = $('chat-channel-gate-action');
const recordingIndicator= $('recording-indicator');
const recordingTime     = $('recording-time');
const recordingSwipeHint= $('recording-swipe-hint');
const btnCancelRecord   = $('btn-cancel-record');
const btnBack           = $('btn-back');
const btnNewChat        = $('btn-new-chat');
const btnLeads          = $('btn-leads');
const btnLogout         = $('btn-logout');
const btnSecurity       = $('btn-security');
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
const securityModal     = $('security-modal');
const btnCloseSecurity  = $('btn-close-security');
const btnPasskeyManage  = $('btn-passkey-manage');
const passkeyStatusText = $('passkey-status-text');
const securitySessionList = $('security-session-list');
const btnRevokeOthers   = $('btn-revoke-others');
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
const leadsDirectoryView = $('leads-directory-view');
const sidebarTitleEl = $('sidebar-title');
const chatTopbarSectionEl = $('chat-topbar-section');
const workspaceChatsEl = $('workspace-chats');
const workspaceLeadsEntry = $('workspace-leads-entry');
const workspaceDayEntry = $('workspace-day-entry');
const workspaceKanbanEntry = $('workspace-kanban-entry');
const workspaceSearchEntry = $('workspace-search-entry');
const workspaceOpeningsEntry = $('workspace-openings-entry');
const workspaceIntegrationsEntry = $('workspace-integrations-entry');
const workspaceGuideEntry = $('workspace-guide-entry');
const workspaceActivityEntry = $('workspace-activity-entry');
const teamDirectory = $('team-directory');
const teamDirectoryList = $('team-directory-list');
const teamDirectoryCount = $('team-directory-count');
const workspaceActivityCount = $('workspace-activity-count');
const workspaceNotificationsEntry = $('workspace-notifications-entry');
const notificationsView = $('notifications-view');
const btnNotificationsBack = $('btn-notifications-back');
const btnNotificationsEnable = $('btn-notifications-enable');
const notificationSettingsState = $('notification-settings-state');
const notificationToggleEls = {
  push: $('notif-push-toggle'),
  messages: $('notif-messages-toggle'),
  planner: $('notif-planner-toggle'),
  calls: $('notif-calls-toggle'),
};
const activityLogView = $('activity-log-view');
const btnActivityBack = $('btn-activity-back');
const btnActivityRefresh = $('btn-activity-refresh');
const btnActivityExportCsv = $('btn-activity-export-csv');
const btnActivityExportJson = $('btn-activity-export-json');
const btnActivityClear = $('btn-activity-clear');
const activityLogList = $('activity-log-list');
const activityLogCount = $('activity-log-count');
const activityLogSummaryLabel = $('activity-log-summary-label');
const activityLogSearch = $('activity-log-search');
const activityLogKind = $('activity-log-kind');
const btnActivityReset = $('btn-activity-reset');
const activitySyncState = $('activity-sync-state');
const guideView = $('guide-view');
const btnGuideBack = $('btn-guide-back');
const workspaceLeadsCount = $('workspace-leads-count');
const workspaceDayCount = $('workspace-day-count');
const leadsStatsEl = $('leads-stats');
const leadsSearchInput = $('leads-search');
const leadsFilterOwner = $('leads-filter-owner');
const leadsFilterStage = $('leads-filter-stage');
const leadsFilterPriority = $('leads-filter-priority');
const leadsFilterCountry = $('leads-filter-country');
const leadsFilterOutreach = $('leads-filter-outreach');
const leadsFilterChannel = $('leads-filter-channel');
const leadsSortEl = $('leads-sort');
const leadsResultMeta = $('leads-result-meta');
const leadsListEl = $('leads-list');
const leadsEmptyEl = $('leads-empty');
const leadsPaginationEl = $('leads-pagination');
const leadsDueBadge = $('leads-due-badge');
const btnLeadsExport = $('btn-leads-export');
const btnLeadsAdd = $('btn-leads-add');
const btnLeadsSelect = $('btn-leads-select');
const leadsBulkBar = $('leads-bulk-bar');
const leadsBulkCount = $('leads-bulk-count');
const leadsBulkStageEl = $('leads-bulk-stage');
const leadsBulkOwnerEl = $('leads-bulk-owner');
const btnLeadsBulkCancel = $('btn-leads-bulk-cancel');
const btnLeadsBulkApply = $('btn-leads-bulk-apply');
const btnLeadsDirectoryBack = $('btn-leads-directory-back');
const btnLeadsDirectoryExport = $('btn-leads-directory-export');
const btnLeadsDirectoryImport = $('btn-leads-directory-import');
const leadsImportFile = $('leads-import-file');
const btnLeadsImportTemplate = $('btn-leads-import-template');
const btnLeadsDirectoryAdd = $('btn-leads-directory-add');
const leadsSyncStatus = $('leads-sync-status');
const btnLeadsDirectorySelect = $('btn-leads-directory-select');
const leadsFilterStatus = $('leads-filter-status');
const leadsFilterStatusText = $('leads-filter-status-text');
const btnLeadsFilterReset = $('btn-leads-filter-reset');
let leadsSelectMode = false;
const leadInfoBanner = $('lead-info-banner');
const leadCreateModal = $('leads-modal');
const btnCloseLeadCreate = $('btn-close-leads');
const btnLeadCreateSave = $('btn-lead-create-save');
const leadNewPriority = $('lead-new-priority');
const leadsKanbanView = $('leads-kanban-view');
const leadsKanbanColumnsEl = $('leads-kanban-columns');
const kanbanOverviewEl = $('kanban-overview');
const kanbanHeaderSummaryEl = $('kanban-header-summary');
const kanbanSearchEl = $('kanban-search');
const kanbanOwnerFilterEl = $('kanban-owner-filter');
const kanbanPriorityFilterEl = $('kanban-priority-filter');
const btnKanbanBack = $('btn-kanban-back');
const leadsKanbanEntry = $('leads-kanban-entry');
const leadsWorkQueueView = $('leads-work-queue-view');
const leadsWorkQueueEntry = $('workspace-day-entry');
const leadsWorkQueueBadge = $('workspace-day-count');
const workQueueOwnerEl = $('work-queue-owner');
const workQueueDateEl = $('work-queue-date');
const workQueueSummaryEl = $('work-queue-summary');
const workQueueSectionsEl = $('work-queue-sections');
const btnWorkQueueBack = $('btn-work-queue-back');
const btnWorkQueueRefresh = $('btn-work-queue-refresh');

const aiDraftPanelEl = $('ai-draft-panel');
const btnAiSuggest = $('btn-ai-suggest');
const aiReplySuggestionsEl = $('ai-reply-suggestions');
const leadNudgePanelEl = $('lead-nudge-panel');

const btnIntegrations = $('btn-integrations');
const integrationsView = $('integrations-view');
const btnIntegrationsBack = $('btn-integrations-back');
const integrationsWebhookCard = $('integrations-webhook-card');
const integrationsGridEl = $('integrations-grid');
const googleKeyCardEl = $('google-key-card');
const integrationsReadinessEl = $('integrations-readiness');

const btnProspecting = $('btn-prospecting');
const prospectingView = $('prospecting-view');
const btnProspectingBack = $('btn-prospecting-back');
const prospectingForm = $('prospecting-form');
const prospCategoryEl = $('prosp-category');
const prospQualifiersEl = $('prosp-qualifiers');
const prospResultsEl = $('prosp-results');
const prospImportBar = $('prosp-import-bar');
const prospSelectedCount = $('prosp-selected-count');
const btnProspImport = $('btn-prosp-import');
const btnProspEnrichSelected = $('btn-prosp-enrich-selected');
const prospTabOsm = $('prosp-tab-osm');
const prospTabGoogle = $('prosp-tab-google');
const prospTabBoth = $('prosp-tab-both');
const prospGoogleFiltersEl = $('prosp-google-filters');
const prospOsmFiltersEl = $('prosp-osm-filters');
const prospHintEl = $('prosp-hint');
const prospSourceSubEl = $('prospecting-source-sub');
const prospCountryEl = $('prosp-country');
const prospSavedRowEl = $('prosp-saved-row');
const openingsView = $('openings-view');
const openingsEntry = $('workspace-openings-entry');
const btnOpeningsBack = $('btn-openings-back');
const openingsListEl = $('openings-list');
const openingsFeedbackEl = $('openings-feedback');
const openingsPaginationEl = $('openings-pagination');
const openingsTotalEl = $('openings-total');
const workspaceOpeningsCountEl = $('workspace-openings-count');
const openingsSearchEl = $('openings-search');
const openingsMonthEl = $('openings-month');
const openingsCityTierEl = $('openings-city-tier');
const openingsCountryEl = $('openings-country');
const openingsCategoryEl = $('openings-category');
const openingsVerificationEl = $('openings-verification');
let openingsPage = 1;
let openingsFiltersLoaded = false;
let openingsSearchTimer = null;
let openingsItemsById = new Map();
const prospSavedChipsEl = $('prosp-saved-chips');
const prospHistoryListEl = $('prosp-history-list');
const prospHistoryCountEl = $('prosp-history-count');
const prospJobPanelEl = $('prosp-job-panel');
const prospJobKickerEl = $('prosp-job-kicker');
const prospJobTitleEl = $('prosp-job-title');
const prospJobDetailEl = $('prosp-job-detail');
const prospJobProgressBarEl = $('prosp-job-progress-bar');
const prospJobLocationsEl = $('prosp-job-locations');
const prospJobResultsEl = $('prosp-job-results');
const prospJobErrorsEl = $('prosp-job-errors');
const btnProspJobCancel = $('btn-prosp-job-cancel');
const btnProspJobRetry = $('btn-prosp-job-retry');
const btnProspJobResults = $('btn-prosp-job-results');
const btnProspSave = $('btn-prosp-save');
const prospQuickFilterRow = $('prosp-quick-filter-row');
const prospQuickFilterEl = $('prosp-quick-filter');
let prospCandidates = [];
let prospLastResult = null;
let prospCatalogLoaded = false;
let prospSource = 'osm';
let prospGoogleConfigured = false;
let prospSavedSearches = [];
let prospImportPreview = null;
let prospResultMode = 'list';
let prospMap = null;
const PROSP_LAST_SEARCH_KEY = 'prosp_last_search';
const PROSP_ACTIVE_JOB_KEY = 'prosp_active_job';
let activeProspJob = null;
let prospJobPollTimer = null;

// ════════════════════════════════════════════
// API helper
// ════════════════════════════════════════════
function stripHtmlForMessage(text) {
  return String(text || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function friendlyApiMessage(err) {
  const status = Number(err?.status || 0);
  const raw = stripHtmlForMessage(err?.message || err || '');
  const lower = raw.toLowerCase();
  if (err?.code === 'timeout' || status === 504 || lower.includes('gateway time-out') || lower.includes('gateway timeout')) {
    return 'Пошук зайняв більше часу, ніж очікувалось. Зменшіть ліміт, звузьте місто або повторіть запит.';
  }
  if (err?.code === 'network' || lower.includes('failed to fetch') || lower.includes('network')) {
    return 'Не вдалося зʼєднатися з сервером. Перевірте інтернет або повторіть запит за хвилину.';
  }
  if (status === 429) return 'Сервіс тимчасово обмежив кількість запитів. Спробуйте ще раз трохи пізніше.';
  if (status >= 500) return 'Сервер не встиг обробити запит. Спробуйте менший ліміт або іншу категорію.';
  if (raw && raw.length <= 220) return raw;
  if (raw) return raw.slice(0, 220) + '…';
  return 'Запит не завершився. Спробуйте ще раз.';
}

async function api(method, path, body, options = {}) {
  const timeoutMs = Math.max(3000, Number(options?.timeoutMs || API_DEFAULT_TIMEOUT_MS));
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    try { controller.abort('timeout'); } catch (_) {}
  }, timeoutMs);
  const opts = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include' };
  if (token && token !== COOKIE_SESSION_TOKEN) opts.headers['Authorization'] = 'Bearer ' + token;
  const unsafeMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method || '').toUpperCase());
  if (unsafeMethod) {
    const csrf = readCookie('arm_csrf');
    if (csrf) opts.headers['X-CSRF-Token'] = csrf;
  }
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
      const timeoutErr = new Error('Пошук зайняв більше часу, ніж очікувалось. Зменшіть ліміт або повторіть запит.');
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
  if (newTok && token !== COOKIE_SESSION_TOKEN) {
    token = newTok;
    // BUG-009 FIX: Refresh token in the same storage where it was originally saved
    const _isInSession = !!sessionStorage.getItem(TOKEN_KEY);
    const _tokenStore = _isInSession ? sessionStorage : localStorage;
    _tokenStore.setItem(TOKEN_KEY, token);
    _tokenStore.setItem(BANK_TOKEN_KEY, token);
  }
  const contentType = (res.headers.get('Content-Type') || '').toLowerCase();
  let data = null;
  if (contentType.includes('application/json')) {
    try { data = await res.json(); } catch (_) { data = null; }
  } else {
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      const httpErr = new Error(friendlyApiMessage({ status: res.status, message: text || `HTTP ${res.status}` }));
      httpErr.rawMessage = text;
      httpErr.status = res.status;
      httpErr.retryable = res.status === 429 || res.status >= 500;
      throw httpErr;
    }
    return null;
  }
  if (!res.ok) {
    const httpErr = new Error(friendlyApiMessage({ status: res.status, message: data?.error || `HTTP ${res.status}` }));
    httpErr.status = res.status;
    httpErr.retryable = res.status === 429 || res.status >= 500;
    // BUG-005 FIX: Global 401 handler — auto logout on expired token
    if (res.status === 401 && token && !path.includes('/auth/')) {
      console.warn('[ARM CRM] Token expired (401). Auto logout.');
      setTimeout(() => { try { doLogout(); } catch(_) {} }, 0);
    }
    throw httpErr;
  }
  if (!data?.ok) throw new Error(data?.error || 'Помилка запиту');
  return data.data;
}

function readCookie(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of String(document.cookie || '').split(';')) {
    const value = part.trim();
    if (value.startsWith(prefix)) return decodeURIComponent(value.slice(prefix.length));
  }
  return '';
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
    const notificationType = data?.type === 'call_incoming' || data?.type === 'call_background' ? 'calls' : data?.type === 'message' ? 'messages' : data?.type === 'planner' ? 'planner' : 'push';
    if (notificationPrefs[notificationType] === false || notificationPrefs.push === false) return false;
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
const LEADS_SORT_KEY = 'msng_leads_sort';
const LAST_WORKSPACE_KEY = 'msng_last_workspace';
const savedLeadsSort = localStorage.getItem(LEADS_SORT_KEY) || 'score';
const leadsState = {
  page: 1,
  perPage: 12,
  totalPages: 1,
  total: 0,
  owner: localStorage.getItem(LEADS_OWNER_FILTER_KEY) || '',
  stage: '',
  priority: '',
  outreachStatus: '',
  country: '',
  channel: '',
  sort: ['score', 'followup', 'newest', 'name'].includes(savedLeadsSort) ? savedLeadsSort : 'score',
  search: '',
  dueToday: false,
  filtersLoaded: false,
  currentLeadId: null,
  currentLead: null,
  channelReadiness: null,
};

// ── Instant activity journal ─────────────────
// The journal is intentionally local-first: every successful CRM mutation is
// visible immediately, survives a refresh, and syncs between open tabs.
const ACTIVITY_LOG_KEY = 'arm_crm_activity_log_v1';
const ACTIVITY_LOG_LIMIT = 250;
let activityServerLoaded = false;
const NOTIFICATION_PREFS_KEY = 'arm_crm_notification_prefs_v1';
const DEFAULT_NOTIFICATION_PREFS = { push: true, messages: true, planner: true, calls: true };
let notificationPrefs = { ...DEFAULT_NOTIFICATION_PREFS };
try {
  const savedNotificationPrefs = JSON.parse(localStorage.getItem(NOTIFICATION_PREFS_KEY) || 'null');
  if (savedNotificationPrefs && typeof savedNotificationPrefs === 'object') notificationPrefs = { ...DEFAULT_NOTIFICATION_PREFS, ...savedNotificationPrefs };
} catch (_) {}

function saveNotificationPrefs() {
  try { localStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(notificationPrefs)); } catch (_) {}
  if (notificationSettingsState) notificationSettingsState.textContent = 'Збережено щойно';
  window.setTimeout(() => { if (notificationSettingsState) notificationSettingsState.textContent = 'Синхронізовано'; }, 1600);
}

function syncNotificationSettingsForm() {
  Object.entries(notificationToggleEls).forEach(([key, el]) => { if (el) el.checked = notificationPrefs[key] !== false; });
}

function openNotificationsView() {
  if (!prepareWorkspaceView(notificationsView, workspaceNotificationsEntry, 'Сповіщення')) return;
  syncNotificationSettingsForm();
}

function readActivityLog() {
  try {
    const value = JSON.parse(localStorage.getItem(ACTIVITY_LOG_KEY) || '[]');
    return Array.isArray(value) ? value.filter(item => item && item.created_at).slice(0, ACTIVITY_LOG_LIMIT) : [];
  } catch (_) {
    return [];
  }
}

function formatActivityTime(value) {
  try {
    return new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  } catch (_) {
    return value || '';
  }
}

function formatActivityDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Раніше';
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const iso = date.toISOString().slice(0, 10);
  if (iso === today.toISOString().slice(0, 10)) return 'Сьогодні';
  if (iso === yesterday.toISOString().slice(0, 10)) return 'Учора';
  return new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long' }).format(date);
}

function activityKindLabel(kind) {
  return ({ lead: 'Лід', planner: 'Планування', message: 'Повідомлення', crm: 'CRM' })[kind] || 'CRM';
}

function activityActorName() {
  return me?.name || me?.full_name || me?.email || 'Ви';
}

const activityFilterState = { search: '', kind: '' };

function renderActivityLog() {
  const allItems = readActivityLog();
  const query = activityFilterState.search.trim().toLowerCase();
  const items = allItems.filter(item => {
    if (activityFilterState.kind && (item.kind || 'crm') !== activityFilterState.kind) return false;
    if (!query) return true;
    return [item.title, item.detail, item.actor, item.lead_name].filter(Boolean).join(' ').toLowerCase().includes(query);
  });
  if (activityLogCount) activityLogCount.textContent = String(items.length);
  if (activityLogSummaryLabel) activityLogSummaryLabel.textContent = items.length === allItems.length
    ? 'подій у журналі'
    : `показано з ${allItems.length}`;
  if (workspaceActivityCount) {
    workspaceActivityCount.textContent = items.length > 99 ? '99+' : String(items.length);
    workspaceActivityCount.hidden = items.length === 0;
  }
  if (!activityLogList) return;
  if (!items.length) {
    activityLogList.innerHTML = allItems.length
      ? '<div class="activity-log-empty"><strong>За фільтрами нічого немає</strong><span>Змініть пошук або тип дії.</span></div>'
      : '<div class="activity-log-empty"><strong>Журнал поки порожній</strong><span>Зміни статусу, реквізитів і плану зʼявляться тут автоматично.</span></div>';
    return;
  }
  const grouped = items.reduce((groups, item) => {
    const key = formatActivityDay(item.created_at);
    (groups[key] ||= []).push(item);
    return groups;
  }, {});
  activityLogList.innerHTML = Object.entries(grouped).map(([day, dayItems]) => `
    <section class="activity-log-day">
      <div class="activity-log-day-head"><span>${escHtml(day)}</span><small>${dayItems.length}</small></div>
      <div class="activity-log-day-items">${dayItems.map(item => `
        <article class="activity-log-item activity-kind-${escHtml(item.kind || 'crm')}" data-activity-id="${escHtml(item.id || '')}">
          <span class="activity-log-mark" aria-hidden="true"></span>
          <div class="activity-log-copy"><div class="activity-log-title-row"><strong>${escHtml(item.title || 'Дію виконано')}</strong><span class="activity-log-kind">${escHtml(activityKindLabel(item.kind || 'crm'))}</span></div>${item.lead_name ? `<button type="button" class="activity-log-lead" data-activity-open="${Number(item.lead_id || 0)}">${escHtml(item.lead_name)}</button>` : ''}${item.detail ? `<span>${escHtml(item.detail)}</span>` : ''}<small>${escHtml(item.actor || 'Ви')} · ${escHtml(formatActivityTime(item.created_at))}</small></div>
        </article>`).join('')}</div>
    </section>`).join('');
}

function recordActivity({ title, detail = '', kind = 'crm', leadId = null, leadName = '' } = {}) {
  if (!title) return;
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    created_at: new Date().toISOString(),
    actor: activityActorName(),
    title,
    detail,
    kind,
    lead_id: leadId,
    lead_name: leadName,
  };
  const items = [entry, ...readActivityLog()].slice(0, ACTIVITY_LOG_LIMIT);
  try { localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(items)); } catch (_) {}
  renderActivityLog();
  if (activitySyncState) {
    activitySyncState.textContent = 'Синхронізовано щойно';
    window.setTimeout(() => { if (activitySyncState) activitySyncState.textContent = 'Синхронізовано'; }, 1800);
  }
  window.dispatchEvent(new CustomEvent('arm:activity-updated', { detail: entry }));
  if (token && me) {
    api('POST', '/leads/activity-log', { kind, title, detail, lead_id: leadId, lead_name: leadName }).then(serverEntry => {
      const current = readActivityLog();
      const local = current.find(item => item.id === entry.id);
      if (local && serverEntry?.server_id) {
        local.server_id = serverEntry.server_id;
        try { localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(current)); } catch (_) {}
      }
    }).catch(() => {});
  }
}

async function loadActivityLogFromServer() {
  if (!token || !me || activityServerLoaded) return;
  try {
    const remote = await api('GET', '/leads/activity-log?limit=250');
    const local = readActivityLog();
    const remoteItems = Array.isArray(remote) ? remote : [];
    const localUnsynced = local.filter(item => !item.server_id);
    const merged = [...remoteItems, ...localUnsynced]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, ACTIVITY_LOG_LIMIT);
    try { localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(merged)); } catch (_) {}
    activityServerLoaded = true;
    renderActivityLog();
    if (activitySyncState) activitySyncState.textContent = 'Синхронізовано';
  } catch (_) {}
}

async function clearActivityLog() {
  try { localStorage.removeItem(ACTIVITY_LOG_KEY); } catch (_) {}
  renderActivityLog();
  if (activitySyncState) activitySyncState.textContent = 'Журнал очищено';
  if (token && me) {
    try {
      const result = await api('DELETE', '/leads/activity-log');
      if (activitySyncState) activitySyncState.textContent = `Видалено ${Number(result?.deleted || 0)} записів`;
    } catch (_) {
      if (activitySyncState) activitySyncState.textContent = 'Локально очищено · сервер недоступний';
    }
  }
}

async function downloadActivityLog(format = 'csv') {
  if (token && me) {
    try {
      const response = await fetch(`${API}/leads/activity-log/export?format=${encodeURIComponent(format)}`, { credentials: 'include' });
      if (response.ok) {
        const blob = await response.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `arm-crm-activity-${new Date().toISOString().slice(0, 10)}.${format}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(link.href);
        if (activitySyncState) activitySyncState.textContent = `Експортовано ${format.toUpperCase()}`;
        return;
      }
    } catch (_) {
      // Local fallback below keeps export usable offline.
    }
  }
  const items = readActivityLog();
  if (!items.length) { showToast('Журнал поки порожній.', true); return; }
  const stamp = new Date().toISOString().slice(0, 10);
  let content;
  let mime;
  let extension;
  if (format === 'json') {
    content = JSON.stringify(items, null, 2);
    mime = 'application/json;charset=utf-8';
    extension = 'json';
  } else {
    const columns = ['created_at', 'actor', 'kind', 'title', 'lead_name', 'lead_id', 'detail'];
    const csvCell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    content = [columns.join(','), ...items.map(item => columns.map(column => csvCell(item[column])).join(','))].join('\n');
    mime = 'text/csv;charset=utf-8';
    extension = 'csv';
  }
  const blob = new Blob([content], { type: mime });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `arm-crm-activity-${stamp}.${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  if (activitySyncState) activitySyncState.textContent = `Експортовано ${format.toUpperCase()}`;
}

window.addEventListener('storage', event => {
  if (event.key === ACTIVITY_LOG_KEY) renderActivityLog();
});
renderActivityLog();

function setLeadsOwnerFilter(owner) {
  leadsState.owner = owner || '';
  if (owner) localStorage.setItem(LEADS_OWNER_FILTER_KEY, owner);
  else localStorage.removeItem(LEADS_OWNER_FILTER_KEY);
}

function leadsQueryString(extra = {}) {
  const params = new URLSearchParams({
    page: String(leadsState.page),
    per_page: String(leadsState.perPage),
    sort: leadsState.sort,
  });
  if (leadsState.owner) params.set('owner', leadsState.owner);
  if (leadsState.stage) params.set('stage', leadsState.stage);
  if (leadsState.priority) params.set('priority', leadsState.priority);
  if (leadsState.outreachStatus) params.set('outreach_status', leadsState.outreachStatus);
  if (leadsState.country) params.set('country', leadsState.country);
  if (leadsState.channel) params.set('channel', leadsState.channel);
  if (leadsState.search) params.set('search', leadsState.search);
  if (leadsState.dueToday) params.set('due_today', '1');
  Object.entries(extra).forEach(([k, v]) => params.set(k, String(v)));
  return params.toString();
}

function syncLeadsFilterStatus() {
  const labels = [];
  if (leadsState.search) labels.push(`Пошук: «${leadsState.search}»`);
  if (leadsState.owner) labels.push(leadsLabel(LEADS_OWNER_LABELS, leadsState.owner));
  if (leadsState.stage) labels.push(leadsLabel(LEADS_STAGE_LABELS, leadsState.stage));
  if (leadsState.priority) labels.push(leadsLabel(LEADS_PRIORITY_LABELS, leadsState.priority));
  if (leadsState.outreachStatus) labels.push(leadsLabel(LEADS_OUTREACH_LABELS, leadsState.outreachStatus));
  if (leadsState.country) labels.push(leadsState.country);
  if (leadsState.channel) labels.push(leadsState.channel);
  if (leadsState.dueToday) labels.push('Контакт на сьогодні');
  if (leadsFilterStatus) leadsFilterStatus.hidden = labels.length === 0;
  if (leadsFilterStatusText) leadsFilterStatusText.textContent = labels.length ? `Активні фільтри (${labels.length}): ${labels.join(' · ')}` : '';
}

// Одна точка застосування фільтрів CRM: список, чіпи, бейдж "Мого дня" і
// відкрита воронка мусять оновитись разом — інакше екрани розходяться між собою.
// Після кожної перемальовки чіпів підсвітка активного фільтра губилась —
// відновлюємо її з leadsState, щоб було видно, що список звужений.
function markActiveLeadsChip() {
  if (!leadsStatsEl) return;
  let activeKey = '';
  if (leadsState.dueToday) activeKey = 'due_today';
  else if (leadsState.outreachStatus === 'Not contacted') activeKey = 'not_contacted';
  else if (leadsState.owner) activeKey = 'owner:' + leadsState.owner;
  else if (!leadsState.stage && !leadsState.priority && !leadsState.search
           && !leadsState.country && !leadsState.channel) activeKey = 'total';
  leadsStatsEl.querySelectorAll('.leads-stat-chip').forEach(item => {
    const on = item.dataset.chip === activeKey;
    item.classList.toggle('active', on);
    item.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function applyLeadsFilterChange() {
  leadsState.page = 1;
  syncLeadsFilterStatus();
  loadLeadsList();
  // /leads/stats рахує по всій базі й від фільтрів не залежить — перезапитувати
  // його тут не треба (а перемальовка чіпів ще й гасила б активний чіп).
  loadLeadsWorkQueueBadge().catch(() => {});
  if (leadsWorkQueueView && !leadsWorkQueueView.hidden) loadLeadsWorkQueue().catch(() => {});
  if (leadsKanbanView && !leadsKanbanView.hidden) {
    kanbanState.owner = leadsState.owner || '';
    kanbanState.priority = leadsState.priority || '';
    kanbanState.search = (leadsState.search || '').toLowerCase();
    if (kanbanOwnerFilterEl) kanbanOwnerFilterEl.value = kanbanState.owner;
    if (kanbanPriorityFilterEl) kanbanPriorityFilterEl.value = kanbanState.priority;
    if (kanbanSearchEl) kanbanSearchEl.value = leadsState.search || '';
    resetKanbanStageLimits();
    refreshKanbanFromFilters();
  }
}

function resetLeadsFilters() {
  leadsState.search = '';
  leadsState.stage = '';
  leadsState.priority = '';
  leadsState.outreachStatus = '';
  leadsState.country = '';
  leadsState.channel = '';
  leadsState.dueToday = false;
  leadsState.page = 1;
  setLeadsOwnerFilter('');
  if (leadsSearchInput) leadsSearchInput.value = '';
  if (leadsFilterOwner) leadsFilterOwner.value = '';
  if (leadsFilterStage) leadsFilterStage.value = '';
  if (leadsFilterPriority) leadsFilterPriority.value = '';
  if (leadsFilterCountry) leadsFilterCountry.value = '';
  if (leadsFilterOutreach) leadsFilterOutreach.value = '';
  if (leadsFilterChannel) leadsFilterChannel.value = '';
  leadsStatsEl?.querySelectorAll('.leads-stat-chip').forEach(item => {
    item.classList.remove('active');
    item.setAttribute('aria-pressed', 'false');
  });
  applyLeadsFilterChange();
}

function renderLeadsResultMeta() {
  if (!leadsResultMeta) return;
  const total = Number(leadsState.total || 0);
  if (!total) {
    leadsResultMeta.textContent = '0 результатів';
    return;
  }
  const start = (leadsState.page - 1) * leadsState.perPage + 1;
  const end = Math.min(total, start + leadsState.perPage - 1);
  leadsResultMeta.textContent = `Показано ${start}–${end} із ${total}`;
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
      ...(data.by_owner || []).map(o => ({ key: 'owner:' + (o.owner || '__unassigned'), label: leadsLabel(LEADS_OWNER_LABELS, o.owner) || 'Без менеджера', value: o.count })),
    ];
    if (leadsDueBadge) leadsDueBadge.hidden = !(data.due_today > 0);
    if (workspaceLeadsCount) workspaceLeadsCount.textContent = String(data.total || 0);
    if (crmHomeLeadsCount) crmHomeLeadsCount.textContent = String(data.total || 0);
    if (crmHomeDayCount) crmHomeDayCount.textContent = String(data.due_today || 0);
    if (workspaceDayCount) {
      const actionable = Number(data.due_today || 0);
      workspaceDayCount.textContent = actionable > 99 ? '99+' : String(actionable);
      workspaceDayCount.hidden = actionable === 0;
    }
    leadsStatsEl.innerHTML = chips.map(c => `
      <button type="button" class="leads-stat-chip" data-chip="${escHtml(c.key)}" aria-pressed="false">
        <div class="leads-stat-value">${c.value}</div>
        <div class="leads-stat-label">${escHtml(c.label)}</div>
      </button>
    `).join('');
    leadsStatsEl.querySelectorAll('.leads-stat-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        leadsStatsEl.querySelectorAll('.leads-stat-chip').forEach(item => {
          item.classList.toggle('active', item === chip);
          item.setAttribute('aria-pressed', item === chip ? 'true' : 'false');
        });
        const key = chip.dataset.chip;
        leadsState.dueToday = false;
        leadsState.outreachStatus = '';
        if (leadsFilterOutreach) leadsFilterOutreach.value = '';
        if (key === 'total') {
          setLeadsOwnerFilter(''); leadsState.stage = ''; leadsState.priority = '';
          leadsState.country = ''; leadsState.channel = '';
          if (leadsFilterOwner) leadsFilterOwner.value = '';
          if (leadsFilterStage) leadsFilterStage.value = '';
          if (leadsFilterPriority) leadsFilterPriority.value = '';
          if (leadsFilterCountry) leadsFilterCountry.value = '';
          if (leadsFilterChannel) leadsFilterChannel.value = '';
        } else if (key === 'not_contacted') {
          leadsState.outreachStatus = 'Not contacted';
          if (leadsFilterOutreach) leadsFilterOutreach.value = 'Not contacted';
        } else if (key === 'due_today') {
          leadsState.dueToday = true;
        } else if (key.startsWith('owner:')) {
          setLeadsOwnerFilter(key.slice(6));
          if (leadsFilterOwner) leadsFilterOwner.value = leadsState.owner;
        }
        applyLeadsFilterChange();
      });
    });
    markActiveLeadsChip();
    if (!leadsState.filtersLoaded) {
      fillLeadsSelect(leadsFilterOwner, (data.by_owner || []).map(o => o.owner), leadsState.owner, LEADS_OWNER_LABELS);
      fillLeadsSelect(leadsFilterStage, (data.by_stage || []).map(o => o.stage), leadsState.stage, LEADS_STAGE_LABELS);
      fillLeadsSelect(leadsFilterPriority, (data.by_priority || []).map(o => o.priority), leadsState.priority, LEADS_PRIORITY_LABELS);
      // Країни й канали беремо з реальних даних (37 країн і список змінюється
      // після кожного імпорту), статуси контакту — з фіксованого набору воронки.
      fillLeadsSelect(leadsFilterCountry, (data.by_country || []).map(o => o.country), leadsState.country, null);
      fillLeadsSelect(leadsFilterChannel, (data.by_channel || []).map(o => o.channel).filter(Boolean), leadsState.channel, null);
      fillLeadsSelect(leadsFilterOutreach, LEADS_OUTREACH_OPTIONS, leadsState.outreachStatus, LEADS_OUTREACH_LABELS);
      leadsState.filtersLoaded = true;
    }
    loadLeadsWorkQueueBadge().catch(() => {});
  } catch (err) {
    showToast(err.message || 'Не вдалося завантажити статистику лідів.', true);
  }
}

async function loadLeadsWorkQueueBadge() {
  if (!leadsWorkQueueBadge) return;
  // Бейдж мусить рахувати те саме, що покаже сам екран "Мій день".
  const data = await api('GET', '/leads/work-queue?' + workQueueQueryString());
  const total = Number(data.summary?.total_actionable || 0);
  leadsWorkQueueBadge.textContent = total > 99 ? '99+' : String(total);
  leadsWorkQueueBadge.hidden = total === 0;
  if (workspaceDayCount) {
    workspaceDayCount.textContent = total > 99 ? '99+' : String(total);
    workspaceDayCount.hidden = total === 0;
  }
}

function channelIcon(primaryChannel) {
  const ch = (primaryChannel || '').trim().toLowerCase();
  if (ch === 'whatsapp') return '<span class="lead-channel-icon" title="WhatsApp" aria-label="WhatsApp"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.6a8 8 0 0 1-11.8 7L4 20l1.4-4.1A8 8 0 1 1 20 11.6Z"/><path d="M9 8.5c.4 2 2 3.6 4 4l1-1c.2-.2.5-.3.8-.2l2 .7"/></svg></span>';
  if (ch === 'instagram') return '<span class="lead-channel-icon" title="Instagram" aria-label="Instagram"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="12" cy="12" r="3.5"/><circle cx="17.3" cy="6.8" r=".8" class="fill-dot"/></svg></span>';
  return '';
}

function crmActionIcon(kind) {
  const icons = {
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.2 3.8 10 7.6 8.5 9.2c1.1 2.4 3 4.3 5.4 5.4l1.6-1.5 3.8 2.8-.4 2.3c-.2 1-1.1 1.8-2.2 1.8C9.7 20 4 14.3 4 7.3c0-1.1.7-2 1.8-2.2l1.4-.3Z"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.6a8 8 0 0 1-11.8 7L4 20l1.4-4.1A8 8 0 1 1 20 11.6Z"/><path d="M9 8.5c.4 2 2 3.6 4 4l1-1c.2-.2.5-.3.8-.2l2 .7"/></svg>',
    email: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m5 7 7 5 7-5"/></svg>',
    website: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9S14.5 18.3 12 21c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z"/></svg>',
    source: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1"/></svg>',
  };
  return icons[kind] || '';
}

function workspaceStateHtml(kind, title, detail = '', retry = '') {
  const icon = kind === 'loading'
    ? '<span class="workspace-state-spinner" aria-hidden="true"></span>'
    : kind === 'error'
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5M12 16.5h.01"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 9.2 17 19 7"/></svg>';
  return `<div class="workspace-state workspace-state-${escHtml(kind)}" role="${kind === 'error' ? 'alert' : 'status'}">
    <span class="workspace-state-icon">${icon}</span>
    <div><strong>${escHtml(title)}</strong>${detail ? `<span>${escHtml(detail)}</span>` : ''}${retry ? `<button type="button" class="workspace-state-retry" data-workspace-retry="${escHtml(retry)}">Спробувати ще раз</button>` : ''}</div>
  </div>`;
}

function leadDateMeta(lead) {
  const raw = String(lead.next_followup_date || '').slice(0, 10);
  if (!raw) return '';
  const today = localIsoDate(0);
  const label = raw === today ? 'Сьогодні' : raw < today ? 'Прострочено' : new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: 'short' }).format(new Date(`${raw}T12:00:00`));
  const tone = raw < today ? 'overdue' : raw === today ? 'today' : 'planned';
  return `<span class="lead-next-action lead-next-action-${tone}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>${escHtml(label)}</span>`;
}

// Статус контакту прямо на картці: без нього не видно, писали вже ліду чи ні —
// це було видно лише всередині відкритого ліда. CSS-бейджі вже існували.
function leadOutreachBadgeHtml(lead) {
  const st = lead.outreach_status || 'Not contacted';
  const touch = String(lead.last_touch_date || '').slice(0, 10);
  const title = touch ? `Останній контакт: ${touch}` : 'Контакту ще не було';
  return `<span class="leads-badge leads-badge-outreach-${escHtml(leadsSlug(st))}" title="${escHtml(title)}">${escHtml(leadsLabel(LEADS_OUTREACH_LABELS, st))}</span>`;
}

/* Діагноз у списку — короткий бейдж, щоб чергу можна було читати очима, не
   відкриваючи картки. Два діагнози позначені як службові (`is-mute`): це не
   привід писати, і плутати їх з поломкою не можна. */
const LEAD_DIAGNOSIS_BADGE = {
  dead_dns:       ['Домен мертвий', 'hot'],
  unreachable:    ['Не відповідає', 'hot'],
  http_5xx:       ['Помилка сервера', 'hot'],
  broken_shop:    ['Магазин зламано', 'hot'],
  tls_expired:    ['Сертифікат протух', 'warm'],
  parked:         ['Заглушка', 'warm'],
  placeholder:    ['Coming soon', 'warm'],
  no_shop:        ['Без магазину', 'warm'],
  social_only:    ['Тільки соцмережі', 'warm'],
  blocked:        ['Захист від ботів', 'mute'],
  domain_unknown: ['Сайт не знайдено', 'mute'],
  ok:             ['Сайт працює', 'mute'],
};

function leadDiagnosisBadge(lead) {
  const meta = LEAD_DIAGNOSIS_BADGE[String(lead.diagnosis || '')];
  if (!meta) return '';
  const evidence = String(lead.diagnosis_evidence || '');
  return `<span class="leads-diag is-${meta[1]}" title="${escHtml(evidence)}">${escHtml(meta[0])}</span>`;
}

function leadCardHtml(lead) {
  /* city_area часто містить і місто, і повну вулицю ("Bakersfield, CA · 1600
     20th Street, Bakersfield"). У списку від цього тільки шум: місто двічі, а
     країна однакова в усій базі. Показуємо перший сегмент, повне — у підказці. */
  const fullLoc = [lead.city_area, lead.country].filter(Boolean).join(', ');
  const shortLoc = String(lead.city_area || '').split('·')[0].trim() || lead.country || '';
  const category = lead.category || 'Категорія не визначена';
  const firstPhone = (lead.phone || lead.whatsapp_viber || '').split(/[;,]/)[0].trim();
  const firstEmail = (lead.email || '').split(/[;,]/)[0].trim();
  const score = Number(lead.score || lead.lead_score || 0);
  const owner = leadsLabel(LEADS_OWNER_LABELS, lead.owner) || '';
  const followup = String(lead.next_followup_date || '').slice(0, 10);

  /* Рядок дії — те єдине, що менеджер має зробити далі. Раніше сюди підмішувався
     діагноз сайту, і коли дати не було, «наступний крок» показував причину ліда.
     Тепер діагноз має власний бейдж, а тут лишається тільки дія. */
  const nextAction = followup
    ? `Наступний контакт · ${followup}`
    : 'Наступний крок не заплановано';

  const quick = [
    firstPhone ? { href: 'tel:' + firstPhone.replace(/[^\d+]/g, ''), icon: 'phone', title: 'Зателефонувати' } : null,
    firstPhone ? { href: 'https://wa.me/' + firstPhone.replace(/[^\d]/g, ''), icon: 'whatsapp', title: 'Відкрити WhatsApp' } : null,
    firstEmail ? { href: 'mailto:' + firstEmail, icon: 'email', title: 'Написати email' } : null,
  ].filter(Boolean);

  return `
    <article class="leads-card lead-card-v2" data-lead-id="${lead.id}">
      <label class="leads-select-check" onclick="event.stopPropagation()">
        <input type="checkbox" class="leads-select-input" data-lead-id="${lead.id}"/>
      </label>

      <header class="lead-v2-head">
        <div class="lead-v2-avatar">${escHtml(initial(lead.business_name || '?'))}</div>
        <div class="lead-v2-title">
          <h3>${escHtml(lead.business_name || 'Без назви')}</h3>
          <p class="lead-v2-where" title="${escHtml(fullLoc)}">${escHtml(category)}${shortLoc ? ` · ${escHtml(shortLoc)}` : ''}</p>
        </div>
        <div class="lead-v2-rank">
          <span class="leads-badge leads-badge-${escHtml(lead.priority || 'Medium')}">${escHtml(leadsLabel(LEADS_PRIORITY_LABELS, lead.priority))}</span>
          ${score ? `<span class="lead-v2-score" title="Оцінка ліда: ${score} зі 100">${score}</span>` : ''}
        </div>
      </header>

      <div class="lead-v2-chips">
        ${leadDiagnosisBadge(lead)}
        ${leadOutreachBadgeHtml(lead)}
        ${owner ? `<span class="lead-v2-chip">${escHtml(owner)}</span>`
                : '<span class="lead-v2-chip is-muted">Без відповідального</span>'}
      </div>

      <footer class="lead-v2-foot">
        <span class="lead-v2-next${followup ? '' : ' is-muted'}">${escHtml(nextAction)}</span>
        ${quick.length ? `<span class="lead-v2-actions">${quick.map(q =>
          `<a class="lead-v2-action" href="${escHtml(q.href)}" target="_blank" rel="noopener" data-quick-action="1" title="${escHtml(q.title)}" aria-label="${escHtml(q.title)}">${crmActionIcon(q.icon)}</a>`
        ).join('')}</span>` : ''}
      </footer>
    </article>
  `;
}

let leadsListRequestId = 0;
async function loadLeadsList() {
  if (!leadsListEl) return;
  syncLeadsFilterStatus();
  const requestId = ++leadsListRequestId;
  leadsListEl.querySelector('.workspace-state')?.remove();
  leadsListEl.insertAdjacentHTML('afterbegin', workspaceStateHtml('loading', 'Завантажуємо ліди', 'Оновлюємо список за вибраними фільтрами.'));
  try {
    const res = await api('GET', '/leads?' + leadsQueryString());
    if (requestId !== leadsListRequestId) return;
    const items = res?.items || [];
    leadsState.totalPages = res?.pages || 1;
    leadsState.total = Number(res?.total || 0);
    renderLeadsResultMeta();
    leadsListEl.querySelector('.workspace-state')?.remove();
    leadsListEl.querySelectorAll('.leads-card:not(#leads-kanban-entry):not(#leads-work-queue-entry):not(#leads-openings-entry)').forEach(el => el.remove());
    if (!items.length) {
      if (leadsEmptyEl) {
        leadsEmptyEl.innerHTML = `<strong>За цими умовами лідів немає</strong><span>Скиньте частину фільтрів або змініть пошуковий запит.</span>`;
        leadsEmptyEl.hidden = false;
      }
    } else {
      if (leadsEmptyEl) leadsEmptyEl.hidden = true;
      const frag = document.createElement('div');
      frag.innerHTML = items.map(leadCardHtml).join('');
      Array.from(frag.children).forEach(card => {
        card.addEventListener('click', e => {
          if (e.target.closest('[data-quick-action]')) return;
          if (leadsSelectMode) {
            const cb = card.querySelector('.leads-select-input');
            if (cb) { cb.checked = !cb.checked; updateLeadsBulkBar(); }
            return;
          }
          openLeadDetail(Number(card.dataset.leadId));
        });
        leadsListEl.appendChild(card);
      });
    }
    renderLeadsPagination();
  } catch (err) {
    if (requestId !== leadsListRequestId) return;
    leadsListEl.querySelector('.workspace-state')?.remove();
    leadsListEl.insertAdjacentHTML('afterbegin', workspaceStateHtml('error', 'Список не завантажився', err.message || 'Перевірте зʼєднання та спробуйте ще раз.', 'leads'));
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
let LEADS_OWNER_OPTIONS = [];
let leadsOwnersPromise = null;

function conciseOwnerLabel(value) {
  const name = String(value || '').trim();
  if (name === 'Михайло Хлюпін') return 'Михайло';
  if (name === 'Едуард Нестеров') return 'Едуард';
  return name;
}

// Список менеджерів приходить з /auth/managers (users.crm_owner + full_name).
// Без цього LEADS_OWNER_OPTIONS лишався порожнім, і всюди, крім списку лідів,
// зникав вибір менеджера: у воронці, в "Моєму дні" і в редакторі ліда — тобто
// не було видно, за ким лід закріплений і кому писали.
function ensureLeadsOwnerOptions(force = false) {
  if (force) leadsOwnersPromise = null;
  if (leadsOwnersPromise) return leadsOwnersPromise;
  leadsOwnersPromise = api('GET', '/auth/managers')
    .then(list => {
      const managers = Array.isArray(list) ? list : [];
      LEADS_OWNER_OPTIONS = managers.map(m => String(m.crm_owner || '').trim()).filter(Boolean);
      LEADS_OWNER_LABELS = managers.reduce((acc, m) => {
        const key = String(m.crm_owner || '').trim();
        if (key) acc[key] = conciseOwnerLabel(m.full_name || key);
        return acc;
      }, {});
      return LEADS_OWNER_OPTIONS;
    })
    .catch(err => {
      leadsOwnersPromise = null;   // дозволяємо повтор при наступному відкритті екрана
      throw err;
    });
  return leadsOwnersPromise;
}

// Значення полів зберігаються англійською (сумісність з фільтрами/експортом/API),
// але менеджери працюють з CRM російською — тому текст на екрані перекладається окремо.
const LEADS_STAGE_LABELS = {
  'New': 'Новий', 'Contacted': 'Звʼязались', 'Replied': 'Відповів',
  'Qualified': 'Кваліфікований', 'Proposal Sent': 'Пропозицію надіслано',
  'Won': 'Успішно', 'Lost': 'Втрачено',
};
const LEADS_OUTREACH_LABELS = {
  'Not contacted': 'Не звʼязувалися', 'Message sent': 'Повідомлення надіслано',
  'Follow-up sent': 'Нагадування надіслано', 'Call made': 'Дзвінок виконано',
  'No reply': 'Без відповіді', 'Replied': 'Відповів',
};
const LEADS_PRIORITY_LABELS = {
  'Hot': 'Гарячий', 'High': 'Високий', 'Medium': 'Середній', 'Low': 'Низький', 'Watch': 'Спостереження',
};
let LEADS_OWNER_LABELS = {};

function leadsLabel(map, value) {
  return map[value] || conciseOwnerLabel(value);
}
function leadsSlug(value) {
  return String(value || '').trim().replace(/\s+/g, '-');
}

// ── Bulk actions: обрати кілька лідів у списку й змінити стадію/власника одразу ──
function populateLeadsBulkSelects() {
  if (leadsBulkStageEl && leadsBulkStageEl.options.length <= 1) {
    leadsBulkStageEl.innerHTML = '<option value="">Стадія — без змін</option>' +
      LEADS_STAGE_OPTIONS.map(s => `<option value="${escHtml(s)}">${escHtml(leadsLabel(LEADS_STAGE_LABELS, s))}</option>`).join('');
  }
  if (leadsBulkOwnerEl && leadsBulkOwnerEl.options.length <= 1) {
    leadsBulkOwnerEl.innerHTML = '<option value="">Власник — без змін</option>' +
      LEADS_OWNER_OPTIONS.map(o => `<option value="${escHtml(o)}">${escHtml(leadsLabel(LEADS_OWNER_LABELS, o))}</option>`).join('');
  }
}
populateLeadsBulkSelects();

function setLeadsSelectMode(on) {
  leadsSelectMode = on;
  if (leadsListEl) leadsListEl.classList.toggle('select-mode', on);
  if (btnLeadsSelect) btnLeadsSelect.classList.toggle('active-mode', on);
  if (btnLeadsDirectorySelect) btnLeadsDirectorySelect.classList.toggle('active-mode', on);
  if (!on) {
    leadsListEl?.querySelectorAll('.leads-select-input').forEach(cb => { cb.checked = false; });
  }
  updateLeadsBulkBar();
}

function selectedLeadIds() {
  return Array.from(leadsListEl?.querySelectorAll('.leads-select-input:checked') || [])
    .map(cb => Number(cb.dataset.leadId))
    .filter(Boolean);
}

function updateLeadsBulkBar() {
  const ids = selectedLeadIds();
  if (leadsBulkCount) leadsBulkCount.textContent = `Обрано: ${ids.length}`;
  if (leadsBulkBar) leadsBulkBar.hidden = !leadsSelectMode || ids.length === 0;
}

async function applyLeadsBulkAction() {
  const ids = selectedLeadIds();
  if (!ids.length) return;
  const payload = {};
  if (leadsBulkStageEl?.value) payload.stage = leadsBulkStageEl.value;
  if (leadsBulkOwnerEl?.value) payload.owner = leadsBulkOwnerEl.value;
  if (!Object.keys(payload).length) { showToast('Оберіть стадію або власника для зміни.', true); return; }

  if (btnLeadsBulkApply) { btnLeadsBulkApply.disabled = true; btnLeadsBulkApply.textContent = 'Застосовую…'; }
  try {
    const results = await Promise.allSettled(ids.map(id => api('PATCH', `/leads/${id}`, payload)));
    const failed = results.filter(r => r.status === 'rejected').length;
    showToast(
      failed ? `Оновлено ${ids.length - failed} з ${ids.length}, помилок: ${failed}.` : `Оновлено ${ids.length} лід(ів).`,
      !!failed
    );
    if (leadsBulkStageEl) leadsBulkStageEl.value = '';
    if (leadsBulkOwnerEl) leadsBulkOwnerEl.value = '';
    setLeadsSelectMode(false);
    loadLeadsList();
    loadLeadsStats().catch(() => {});
    if (ids.length - failed) recordActivity({
      kind: 'lead',
      title: `Оновлено ${ids.length - failed} лідів`,
      detail: [payload.stage ? `стадія: ${payload.stage}` : '', payload.owner ? `власник: ${payload.owner}` : ''].filter(Boolean).join(' · '),
    });
  } finally {
    if (btnLeadsBulkApply) { btnLeadsBulkApply.disabled = false; btnLeadsBulkApply.textContent = 'Застосувати'; }
  }
}

if (btnLeadsSelect) btnLeadsSelect.addEventListener('click', () => setLeadsSelectMode(!leadsSelectMode));
if (btnLeadsDirectorySelect) btnLeadsDirectorySelect.addEventListener('click', () => setLeadsSelectMode(!leadsSelectMode));
if (btnLeadsBulkCancel) btnLeadsBulkCancel.addEventListener('click', () => setLeadsSelectMode(false));
if (btnLeadsBulkApply) btnLeadsBulkApply.addEventListener('click', applyLeadsBulkAction);
// Делегування на контейнер — картки перерендерюються при кожному loadLeadsList().
if (leadsListEl) {
  leadsListEl.addEventListener('change', e => {
    if (e.target.classList.contains('leads-select-input')) updateLeadsBulkBar();
  });
}

function sourceBucketLabel(value) {
  const raw = String(value || '').trim();
  if (!raw || /^(?:curated|opening_registry|prospecting|import|manual|osm|google)[_-]/i.test(raw)) return '';
  return raw.replace(/[_-]+/g, ' ').trim();
}

function publicSourceUrl(value, normalise) {
  const raw = String(value || '').trim();
  if (!raw || /^(?:curated|opening_registry|prospecting|import|manual|osm|google)[_-]/i.test(raw)) return '';
  return normalise(raw);
}

function leadThreadContactIcons(lead) {
  const firstPhone = (lead.phone || lead.whatsapp_viber || '').split(/[;,]/)[0].trim();
  const firstEmail = (lead.email || '').split(/[;,]/)[0].trim();
  const phoneHref = firstPhone ? 'tel:' + firstPhone.replace(/[^\d+]/g, '') : '';
  const whatsappNumber = (lead.whatsapp_viber || '').split(/[;,]/)[0].trim();
  const whatsappHref = whatsappNumber ? 'https://wa.me/' + whatsappNumber.replace(/[^\d]/g, '') : '';
  const emailHref = firstEmail ? 'mailto:' + firstEmail : '';
  const webUrl = value => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  };
  const sourceRaw = String(lead.source_url || '').trim();
  // Registry/import identifiers are not URLs. Do not render a fake link such as
  // https://curated_2026... and do not expose implementation names in the profile.
  const sourceHref = publicSourceUrl(sourceRaw, webUrl);
  const sourceEditorValue = sourceHref ? sourceRaw : '';
  const websiteHref = webUrl(lead.website_url);
  const instagramHref = lead.instagram
    ? webUrl(String(lead.instagram).includes('instagram.com') ? lead.instagram : `instagram.com/${String(lead.instagram).replace('@', '')}`)
    : '';
  const facebookHref = webUrl(lead.facebook_other_social);
  const location = [lead.city_area, lead.country].filter(Boolean).join(', ') || 'Не вказано';
  const opening = lead.opening_date || lead.opening_window || 'Не вказано';
  const contactCount = [lead.phone || lead.whatsapp_viber, lead.email, lead.instagram, lead.website_url, sourceHref]
    .filter(Boolean).length;
  const contactCard = (kind, label, value, href, emptyLabel = 'Не знайдено') => `
    <article class="lead-profile-card lead-profile-${kind}${value ? '' : ' is-empty'}">
      <span class="lead-profile-icon" aria-hidden="true">${crmActionIcon(kind)}</span>
      <span class="lead-profile-label">${escHtml(label)}</span>
      ${value
        ? `<a class="lead-profile-value" href="${escHtml(href)}" ${href.startsWith('http') ? 'target="_blank" rel="noopener"' : ''}>${escHtml(value)}</a>`
        : `<span class="lead-profile-value">${escHtml(emptyLabel)}</span>`}
    </article>`;
  return `
    <div class="lead-profile-shell">
    <div class="lead-profile-head">
      <div><span class="mono-label">ПРОФІЛЬ ЛІДА · КОНТАКТИ</span><strong>Контакти та реквізити</strong><small>Перевірені канали й дані для наступної дії</small></div>
      <span class="lead-profile-quality">${contactCount}/5 каналів · ${escHtml(String(lead.lead_score || 0))} балів</span>
    </div>
    <div class="lead-profile-grid">
      ${contactCard('phone', 'Телефон', firstPhone, phoneHref)}
      ${contactCard('whatsapp', 'WhatsApp', lead.whatsapp_viber || '', lead.whatsapp_viber ? 'https://wa.me/' + String(lead.whatsapp_viber).replace(/[^\d]/g, '') : '')}
      ${contactCard('email', 'Email', firstEmail, emailHref)}
      ${contactCard('website', 'Сайт', lead.website_url, websiteHref)}
      ${contactCard('source', 'Джерело', sourceHref ? 'Відкрити джерело' : '', sourceHref)}
    </div>
    <div class="lead-profile-actions">
      ${firstPhone ? `<a class="is-primary" href="${escHtml(phoneHref)}">Зателефонувати</a>` : ''}
      ${whatsappNumber ? `<a href="${escHtml(whatsappHref)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
      ${firstEmail ? `<a href="${escHtml(emailHref)}">Написати email</a>` : ''}
      ${instagramHref ? `<a href="${escHtml(instagramHref)}" target="_blank" rel="noopener">Instagram</a>` : ''}
      ${facebookHref ? `<a href="${escHtml(facebookHref)}" target="_blank" rel="noopener">Facebook</a>` : ''}
    </div>
    <div class="lead-profile-context-label">Контекст ліда</div>
    <div class="lead-profile-meta">
      <div><span>Локація</span><strong>${escHtml(location)}</strong></div>
      <div><span>Категорія</span><strong>${escHtml(lead.category || 'Не вказано')}</strong></div>
      <div><span>Відкриття</span><strong>${escHtml(opening)}</strong></div>
      <div><span>Відповідальний</span><strong>${escHtml(leadsLabel(LEADS_OWNER_LABELS, lead.owner) || lead.owner || 'Не призначено')}</strong></div>
      <div><span>Основний канал</span><strong>${escHtml(lead.primary_channel || 'Не вказано')}</strong></div>
      <div><span>Потреба</span><strong>${escHtml(lead.need_type || 'Не вказано')}</strong></div>
    </div>
    ${lead.notes ? `<div class="lead-profile-warning"><strong>Перевірити перед контактом</strong><span>${escHtml(lead.notes)}</span></div>` : ''}
    <details class="lead-profile-edit">
      <summary><span>Доповнити дані</span><small>тільки підтверджені контакти й джерела</small></summary>
      <div class="lead-profile-edit-grid">
        <label><span>Телефон</span><input id="lead-data-phone" type="tel" value="${escHtml(lead.phone || '')}" autocomplete="tel"/></label>
        <label><span>WhatsApp</span><input id="lead-data-whatsapp" type="tel" value="${escHtml(lead.whatsapp_viber || '')}" autocomplete="tel"/></label>
        <label><span>Email</span><input id="lead-data-email" type="email" value="${escHtml(lead.email || '')}" autocomplete="email"/></label>
        <label><span>Instagram</span><input id="lead-data-instagram" type="text" value="${escHtml(lead.instagram || '')}" placeholder="@business"/></label>
        <label><span>Офіційний сайт</span><input id="lead-data-website" type="url" value="${escHtml(lead.website_url || '')}" placeholder="https://…"/></label>
        <label><span>Посилання на джерело</span><input id="lead-data-source" type="url" value="${escHtml(sourceEditorValue)}" data-preserve-source="${sourceHref ? '0' : '1'}" placeholder="https://…"/></label>
        <label class="lead-profile-edit-wide"><span>Чому це в роботі</span><textarea id="lead-data-rationale" rows="2" placeholder="Конкретна причина звернення, підтверджена джерелом">${escHtml(lead.why_help_fits || '')}</textarea></label>
        <label class="lead-profile-edit-wide"><span>Що запропонувати</span><textarea id="lead-data-offer" rows="2" placeholder="Релевантна перша пропозиція">${escHtml(lead.suggested_first_offer || '')}</textarea></label>
      </div>
      <div class="lead-profile-edit-actions">
        <button type="button" class="btn-secondary" id="btn-lead-enrich" ${lead.website_url ? '' : 'disabled'}>Перевірити офіційний сайт</button>
        <button type="button" class="btn-primary" id="btn-lead-data-save">Зберегти дані</button>
      </div>
      <p class="lead-profile-edit-help">Перевірка сайту додає лише знайдені публічні контакти й не перезаписує введені вручну поля.</p>
    </details>
    </div>
  `;
}

function leadThreadPillsHtml(lead) {
  const optSel = (options, current, labels) => options.map(o =>
    `<option value="${escHtml(o)}" ${o === current ? 'selected' : ''}>${escHtml(leadsLabel(labels, o))}</option>`
  ).join('');
  const verifiedChannels = [lead.phone || lead.whatsapp_viber, lead.email, lead.instagram, lead.website_url, lead.source_url].filter(Boolean).length;
  const contactHint = verifiedChannels ? `${verifiedChannels}/5 каналів заповнено` : 'Спочатку додайте реквізити';
  return `
    <div class="lead-editor-head"><div><span class="mono-label">СТАТУС КОНТАКТУ</span><strong>Статус</strong></div><span class="lead-editor-context">${escHtml(contactHint)}</span></div>
    <label class="lead-editor-field"><span>Менеджер</span><select id="lead-edit-owner" class="leads-pill-select">${optSel(LEADS_OWNER_OPTIONS, lead.owner, LEADS_OWNER_LABELS)}</select></label>
    <label class="lead-editor-field"><span>Пріоритет</span><select id="lead-edit-priority" class="leads-pill-select">${optSel(LEADS_PRIORITY_OPTIONS, lead.priority, LEADS_PRIORITY_LABELS)}</select></label>
    <label class="lead-editor-field"><span>Стадія</span><select id="lead-edit-stage" class="leads-pill-select">${optSel(LEADS_STAGE_OPTIONS, lead.stage, LEADS_STAGE_LABELS)}</select></label>
    <label class="lead-editor-field"><span>Контакт</span><select id="lead-edit-outreach" class="leads-pill-select">${optSel(LEADS_OUTREACH_OPTIONS, lead.outreach_status, LEADS_OUTREACH_LABELS)}</select></label>
    <label class="lead-editor-field lead-editor-date"><span>Наступна дія</span><input id="lead-edit-followup" class="leads-pill-select" type="date" title="Наступний контакт" value="${escHtml(lead.next_followup_date || '')}"/></label>
  `;
}

async function openLeadDetail(leadId) {
  if (!leadInfoBanner) return;
  if (window.innerWidth <= COMPACT_LAYOUT_MAX_WIDTH) sidebar.classList.add('hidden');
  hideWorkspaceViews();
  leadsState.currentLeadId = leadId;
  leadsState.channelReadiness = null;
  applyLeadChannelReadiness(null, true);
  document.querySelectorAll('.leads-card').forEach(el =>
    el.classList.toggle('active', Number(el.dataset.leadId) === leadId));
  try {
    const [lead, convRes, readiness] = await Promise.all([
      api('GET', `/leads/${leadId}`),
      api('GET', `/leads/${leadId}/conversation`),
      api('GET', `/messenger/leads/${leadId}/channel-readiness`),
    ]);
    leadsState.currentLead = lead;
    renderLeadInfoBanner(lead);
    await openChat({
      id: convRes.conversation_id,
      is_group: true,
      group_name: lead.business_name,
      partner: null,
      lead_id: lead.id,
    });
    applyLeadChannelReadiness(readiness);
    activateWorkspaceEntry(workspaceLeadsEntry);
    if (chatTopbarSectionEl) chatTopbarSectionEl.textContent = 'Ліди';
    setChatHeaderStatus([lead.category, [lead.city_area, lead.country].filter(Boolean).join(', ')].filter(Boolean).join(' · '));
    if (btnCall) btnCall.hidden = true;
    const groupInfoBtn = document.getElementById('group-info-btn');
    if (groupInfoBtn) groupInfoBtn.hidden = true;
  } catch (err) {
    showToast(err.message || 'Не вдалося завантажити ліда.', true);
  }
}

function channelLabel(channel) {
  return channel === 'whatsapp' ? 'WhatsApp' : channel === 'instagram' ? 'Instagram' : 'Канал';
}

function resetLeadChannelState() {
  leadsState.currentLeadId = null;
  leadsState.currentLead = null;
  leadsState.channelReadiness = null;
  if (leadInfoBanner) leadInfoBanner.hidden = true;
  if (chatChannelGate) chatChannelGate.hidden = true;
  msgInput.disabled = false;
  if (btnAttachPhoto) btnAttachPhoto.hidden = false;
  if (btnVoice) btnVoice.hidden = false;
  msgInput.placeholder = 'Напишіть повідомлення...';
}

function applyLeadChannelReadiness(readiness, loading = false) {
  leadsState.channelReadiness = readiness;
  if (!chatChannelGate) return;
  chatChannelGate.hidden = false;
  chatChannelGate.classList.toggle('is-ready', !!readiness?.ready);
  chatChannelGate.classList.toggle('is-blocked', !loading && !readiness?.ready);

  if (loading) {
    chatChannelGateMark.textContent = '···';
    chatChannelGateTitle.textContent = 'Перевіряємо канал';
    chatChannelGateText.textContent = 'Поле вводу відкриється після перевірки.';
    chatChannelGateAction.hidden = true;
    msgInput.disabled = true;
    msgInput.placeholder = 'Перевіряємо підключення…';
  } else if (readiness?.ready) {
    const label = channelLabel(readiness.channel);
    chatChannelGateMark.textContent = '✓';
    chatChannelGateTitle.textContent = `${label} готовий`;
    chatChannelGateText.textContent = [readiness.manager_label, readiness.account_label, 'текст надсилається реально'].filter(Boolean).join(' · ');
    chatChannelGateAction.hidden = true;
    msgInput.disabled = false;
    msgInput.placeholder = `Написати через ${label}…`;
  } else {
    const label = channelLabel(readiness?.channel);
    chatChannelGateMark.textContent = '!';
    chatChannelGateTitle.textContent = `${label} не готовий`;
    chatChannelGateText.textContent = readiness?.reason || 'Підключіть канал, щоб писати клієнту.';
    const canOpenIntegrations = ['integration_missing', 'token_error', 'delivery_failed', 'integration_changed'].includes(readiness?.code);
    chatChannelGateAction.hidden = !canOpenIntegrations;
    chatChannelGateAction.textContent = readiness?.code === 'token_error' ? 'Перепідключити' : 'Підключити';
    msgInput.disabled = true;
    msgInput.placeholder = 'Відправка заблокована до налаштування каналу';
  }

  // External Meta delivery in this version is intentionally text-only.
  if (btnAttachPhoto) btnAttachPhoto.hidden = true;
  if (btnVoice) btnVoice.hidden = true;
  updateSendBtn();
}

async function refreshLeadChannelReadiness() {
  if (!leadsState.currentLeadId) return;
  try {
    const readiness = await api('GET', `/messenger/leads/${leadsState.currentLeadId}/channel-readiness`);
    applyLeadChannelReadiness(readiness);
  } catch (err) {
    applyLeadChannelReadiness({ ready: false, code: 'status_unavailable', reason: err.message || 'Не вдалося перевірити канал.' });
  }
}

chatChannelGateAction?.addEventListener('click', () => openIntegrationsView('channels'));

function renderLeadInfoBanner(lead) {
  const contactsEl = document.getElementById('lead-thread-contacts');
  const pillsEl = document.getElementById('leads-thread-pills');
  const pinnedEl = document.getElementById('lead-first-message-pinned');
  const intelligenceEl = document.getElementById('lead-intelligence-panel');

  leadInfoBanner.hidden = false;
  leadInfoBanner.scrollTop = 0;
  if (contactsEl) {
    const inlineStatus = `<div class="lead-status-inline"><div class="leads-thread-pills">${leadThreadPillsHtml(lead)}</div></div>`;
    contactsEl.innerHTML = leadThreadContactIcons(lead).replace('<div class="lead-profile-meta">', `${inlineStatus}<div class="lead-profile-meta">`);
    document.getElementById('btn-lead-data-save')?.addEventListener('click', () => saveLeadProfileData(lead));
    document.getElementById('btn-lead-enrich')?.addEventListener('click', () => enrichLeadFromWebsite(lead));
  }
  if (pillsEl) {
    // The status controls now live directly in the profile surface above.
    // Keep this legacy mount empty so the old detached inspector cannot render.
    pillsEl.innerHTML = '';
    pillsEl.hidden = true;
    ['owner', 'priority', 'stage', 'outreach'].forEach(field => {
      document.getElementById(`lead-edit-${field}`)?.addEventListener('change', () => saveLeadPillEdit(lead.id));
    });
    document.getElementById('lead-edit-followup')?.addEventListener('change', () => saveLeadPillEdit(lead.id));
  }
  // Profile view stays focused on verified data and explicit user actions.
  // AI suggestions, generated drafts and message templates are intentionally removed.
  if (intelligenceEl) { intelligenceEl.hidden = true; intelligenceEl.innerHTML = ''; }
  if (pinnedEl) { pinnedEl.hidden = true; pinnedEl.innerHTML = ''; }
  if (aiDraftPanelEl) { aiDraftPanelEl.hidden = true; aiDraftPanelEl.innerHTML = ''; }
  if (leadNudgePanelEl) { leadNudgePanelEl.hidden = true; leadNudgePanelEl.innerHTML = ''; }
  if (btnAiSuggest) btnAiSuggest.hidden = true;
}

const aiAnalysisCache = {};

function leadIntelligenceHtml(intel, opts) {
  const reasons = Array.isArray(intel.reasons) ? intel.reasons : [];
  const strengthLabel = { high: 'сильний набір сигналів', medium: 'є робочі сигнали', low: 'потрібна перевірка' }[intel.strength] || 'потрібна перевірка';
  const primaryReason = reasons[0]?.text || intel.description || 'Перевірте профіль перед першим контактом.';
  const aiBadge = opts?.aiGenerated
    ? `<span class="lead-intelligence-ai-badge" title="${escHtml(opts.modelUsed || '')}">✨ AI</span>`
    : '';
  const genBtn = opts?.aiGenerated
    ? `<button type="button" class="lead-intelligence-regen-btn" id="btn-lead-intel-regen">↻ Оновити</button>`
    : `<button type="button" class="lead-intelligence-regen-btn is-primary" id="btn-lead-intel-regen">✨ AI-аналітика замість шаблону</button>`;
  return `
    <div class="lead-intelligence-head">
      <div><span class="mono-label">Аналітика контакту ${aiBadge}</span><strong>Коротко про можливість</strong></div>
      <span class="lead-intelligence-score lead-intelligence-${escHtml(intel.strength || 'low')}">${escHtml(String(intel.score || 0))}/100 · ${escHtml(strengthLabel)}</span>
    </div>
    <div class="lead-intelligence-highlights">
      <article class="lead-intelligence-highlight is-now"><span class="mono-label">Чому зараз</span><p>${escHtml(primaryReason)}</p></article>
      <article class="lead-intelligence-highlight is-offer"><span class="mono-label">Що запропонувати</span><p>${escHtml(intel.recommended_offer || 'Короткий аудит цифрової присутності')}</p></article>
      <article class="lead-intelligence-highlight is-next"><span class="mono-label">Наступний крок</span><p>${escHtml(intel.next_step || 'Перевірити контакт і підготувати коротке звернення.')}</p></article>
    </div>
    <details class="lead-intelligence-details" ${opts?.aiGenerated ? 'open' : ''}>
      <summary><span>Повна аналітика</span><small>${reasons.length} сигналів</small></summary>
      <div class="lead-intelligence-details-body">
        ${intel.description ? `<p>${escHtml(intel.description)}</p>` : ''}
        <div>${reasons.map(reason => `<article><strong>${escHtml(reason.label || 'Сигнал')}</strong><span>${escHtml(reason.text || '')}</span></article>`).join('')}</div>
        ${intel.outreach_angle ? `<p><strong>Кут звернення:</strong> ${escHtml(intel.outreach_angle)}</p>` : ''}
      </div>
    </details>
    <div class="lead-intelligence-actions">${genBtn}</div>
  `;
}

function renderLeadIntelligence(container, lead) {
  const cached = aiAnalysisCache[lead.id];
  if (cached) {
    container.hidden = false;
    container.innerHTML = leadIntelligenceHtml(cached, { aiGenerated: true, modelUsed: cached.model_used });
    document.getElementById('btn-lead-intel-regen')?.addEventListener('click', () => generateAiAnalysis(lead, container));
    return;
  }
  const intel = lead.intelligence || {};
  const reasons = Array.isArray(intel.reasons) ? intel.reasons : [];
  if (!intel.description && !reasons.length) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }
  container.hidden = false;
  container.innerHTML = leadIntelligenceHtml(intel, { aiGenerated: false });
  document.getElementById('btn-lead-intel-regen')?.addEventListener('click', () => generateAiAnalysis(lead, container));
}

async function generateAiAnalysis(lead, container) {
  const btn = document.getElementById('btn-lead-intel-regen');
  if (btn) { btn.disabled = true; btn.textContent = 'Аналізую…'; }
  try {
    const data = await api('POST', `/leads/${lead.id}/ai-analysis`, undefined, { timeoutMs: 30000 });
    aiAnalysisCache[lead.id] = data;
    container.hidden = false;
    container.innerHTML = leadIntelligenceHtml(data, { aiGenerated: true, modelUsed: data.model_used });
    document.getElementById('btn-lead-intel-regen')?.addEventListener('click', () => generateAiAnalysis(lead, container));
  } catch (err) {
    showToast(err.message || 'Не вдалося згенерувати AI-аналітику.', true);
    if (btn) { btn.disabled = false; btn.textContent = '✨ AI-аналітика замість шаблону'; }
  }
}

// Дні від next_followup_date до сьогодні; null якщо дата не задана або ще не настала.
function leadOverdueDays(lead) {
  const raw = (lead.next_followup_date || '').trim();
  if (!raw) return null;
  const due = new Date(raw + 'T00:00:00');
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((today - due) / 86400000);
  return days >= 0 ? days : null;
}

function renderAiDraftPanel(lead) {
  if (!aiDraftPanelEl) return;
  aiDraftPanelEl.hidden = false;
  aiDraftPanelEl.innerHTML = `<button type="button" class="ai-draft-generate-btn" id="btn-ai-draft-gen">✨ AI-чернетка першого контакту</button>`;
  document.getElementById('btn-ai-draft-gen')?.addEventListener('click', () => generateAiDraft(lead));
}

async function generateAiDraft(lead) {
  const btn = document.getElementById('btn-ai-draft-gen');
  if (btn) { btn.disabled = true; btn.textContent = 'Генерую…'; }
  try {
    const data = await api('POST', `/leads/${lead.id}/ai-draft`, undefined, { timeoutMs: 60000 });
    const variants = [
      ...(data.variants_en || []).map((text, i) => ({ label: `EN — варіант ${i + 1}`, text })),
      ...(data.local ? [{ label: data.local.lang, text: data.local.text }] : []),
    ];
    if (!variants.length) {
      showToast('AI не повернув варіантів. Спробуйте ще раз.', true);
      renderAiDraftPanel(lead);
      return;
    }
    aiDraftPanelEl.innerHTML = `
      <div class="ai-draft-variants">
        ${variants.map((v, i) => `
          <div class="ai-draft-variant">
            <div class="ai-draft-variant-label mono-label">${escHtml(v.label)}</div>
            <div class="ai-draft-variant-text">${escHtml(v.text)}</div>
            <button type="button" class="ai-draft-use-btn" data-variant-idx="${i}">Використати</button>
          </div>
        `).join('')}
      </div>
      <button type="button" class="ai-draft-generate-btn" id="btn-ai-draft-regen">🔄 Ще варіанти</button>
    `;
    aiDraftPanelEl.querySelectorAll('.ai-draft-use-btn').forEach(useBtn => {
      useBtn.addEventListener('click', async () => {
        const idx = Number(useBtn.dataset.variantIdx);
        const chosen = variants[idx];
        useBtn.disabled = true;
        try {
          await api('PATCH', `/leads/${lead.id}`, { first_message_en: chosen.text });
          showToast('Заготовку збережено.');
          const fresh = await api('GET', `/leads/${lead.id}`);
          renderLeadInfoBanner(fresh);
        } catch (err) {
          showToast(err.message || 'Не вдалося зберегти.', true);
          useBtn.disabled = false;
        }
      });
    });
    document.getElementById('btn-ai-draft-regen')?.addEventListener('click', () => generateAiDraft(lead));
  } catch (err) {
    showToast(err.message || 'Не вдалося згенерувати чернетку.', true);
    renderAiDraftPanel(lead);
  }
}

// Прострочений follow-up: пропонуємо нагадування, але НІЧОГО не надсилається
// автоматично — обраний варіант лише підставляється в звичайний чат-інпут,
// відправка — завжди ручна дія менеджера (btn-send / sendMessage()).
function renderLeadNudgePanel(lead) {
  if (!leadNudgePanelEl) return;
  const days = leadOverdueDays(lead);
  if (days === null) { leadNudgePanelEl.hidden = true; leadNudgePanelEl.innerHTML = ''; return; }
  leadNudgePanelEl.hidden = false;
  const daysLabel = days === 0 ? 'сьогодні' : `${days} дн. тому`;
  leadNudgePanelEl.innerHTML = `
    <div class="lead-nudge-warn">⏰ Follow-up прострочено — ${escHtml(daysLabel)}</div>
    <button type="button" class="ai-draft-generate-btn" id="btn-lead-nudge-gen">🔔 Запропонувати нагадування</button>
  `;
  document.getElementById('btn-lead-nudge-gen')?.addEventListener('click', () => generateLeadNudge(lead));
}

async function generateLeadNudge(lead) {
  const btn = document.getElementById('btn-lead-nudge-gen');
  if (btn) { btn.disabled = true; btn.textContent = 'Генерую…'; }
  try {
    const data = await api('POST', `/leads/${lead.id}/ai-nudge`, undefined, { timeoutMs: 60000 });
    const variants = [
      ...(data.variants_en || []).map((text, i) => ({ label: `EN — варіант ${i + 1}`, text })),
      ...(data.local ? [{ label: data.local.lang, text: data.local.text }] : []),
    ];
    if (!variants.length) {
      showToast('AI не повернув варіантів. Спробуйте ще раз.', true);
      renderLeadNudgePanel(lead);
      return;
    }
    const daysLabel = data.days_overdue === 0 ? 'сьогодні' : `${data.days_overdue} дн. тому`;
    leadNudgePanelEl.innerHTML = `
      <div class="lead-nudge-warn">⏰ Follow-up прострочено — ${escHtml(daysLabel)}</div>
      <div class="ai-draft-variants">
        ${variants.map((v, i) => `
          <div class="ai-draft-variant">
            <div class="ai-draft-variant-label mono-label">${escHtml(v.label)}</div>
            <div class="ai-draft-variant-text">${escHtml(v.text)}</div>
            <button type="button" class="ai-draft-use-btn" data-variant-idx="${i}">Підставити в чат</button>
          </div>
        `).join('')}
      </div>
      <button type="button" class="ai-draft-generate-btn" id="btn-lead-nudge-regen">🔄 Ще варіанти</button>
    `;
    leadNudgePanelEl.querySelectorAll('.ai-draft-use-btn').forEach(useBtn => {
      useBtn.addEventListener('click', () => {
        const idx = Number(useBtn.dataset.variantIdx);
        const chosen = variants[idx];
        if (!msgInput) return;
        msgInput.value = chosen.text;
        autoResizeInput();
        updateSendBtn();
        msgInput.focus();
        showToast('Текст підставлено в поле — перевірте й натисніть Надіслати.');
      });
    });
    document.getElementById('btn-lead-nudge-regen')?.addEventListener('click', () => generateLeadNudge(lead));
  } catch (err) {
    showToast(err.message || 'Не вдалося згенерувати нагадування.', true);
    renderLeadNudgePanel(lead);
  }
}

async function toggleAiReplySuggestions() {
  if (!aiReplySuggestionsEl || !leadsState.currentLeadId) return;
  const leadId = leadsState.currentLeadId;
  if (!aiReplySuggestionsEl.hidden) {
    aiReplySuggestionsEl.hidden = true;
    aiReplySuggestionsEl.innerHTML = '';
    return;
  }
  aiReplySuggestionsEl.hidden = false;
  aiReplySuggestionsEl.innerHTML = '<div class="ai-reply-loading">Підбираю варіанти відповіді…</div>';
  if (btnAiSuggest) btnAiSuggest.disabled = true;
  try {
    const data = await api('POST', `/leads/${leadId}/ai-reply-suggestions`, { count: 2 }, { timeoutMs: 60000 });
    const variants = data.variants || [];
    if (!variants.length) {
      aiReplySuggestionsEl.innerHTML = '<div class="ai-reply-loading">Немає варіантів — спробуйте ще раз.</div>';
      return;
    }
    aiReplySuggestionsEl.innerHTML = variants.map((v, i) => `
      <button type="button" class="ai-reply-chip" data-idx="${i}">
        <span class="ai-reply-chip-lang mono-label">${escHtml(v.lang)}</span>
        <span class="ai-reply-chip-text">${escHtml(v.text)}</span>
        ${v.gloss ? `<span class="ai-reply-chip-gloss">${escHtml(v.gloss)}</span>` : ''}
      </button>
    `).join('');
    aiReplySuggestionsEl.querySelectorAll('.ai-reply-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const v = variants[Number(chip.dataset.idx)];
        if (msgInput) {
          msgInput.value = v.text;
          msgInput.dispatchEvent(new Event('input'));
          msgInput.focus();
        }
        aiReplySuggestionsEl.hidden = true;
        aiReplySuggestionsEl.innerHTML = '';
      });
    });
  } catch (err) {
    aiReplySuggestionsEl.innerHTML = `<div class="ai-reply-loading">${escHtml(err.message || 'Помилка генерації.')}</div>`;
  } finally {
    if (btnAiSuggest) btnAiSuggest.disabled = false;
  }
}

if (btnAiSuggest) btnAiSuggest.addEventListener('click', toggleAiReplySuggestions);

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
    const currentLead = leadsState.currentLead;
    recordActivity({
      kind: 'lead',
      leadId,
      leadName: currentLead?.business_name || '',
      title: 'Оновлено статус контакту',
      detail: [payload.stage, payload.priority, payload.outreach_status].filter(Boolean).join(' · '),
    });
    loadLeadsList().catch(() => {});
    // Стадія/пріоритет тепер дзеркалиться в реальний чат бекендом — підтягуємо свіжі повідомлення одразу.
    if (activeConvId) fetchMessages();
  } catch (err) {
    showToast(err.message || 'Не вдалося зберегти зміни.', true);
  }
}

async function saveLeadProfileData(lead) {
  const btn = document.getElementById('btn-lead-data-save');
  const sourceInput = document.getElementById('lead-data-source');
  const preserveInternalSource = sourceInput?.dataset.preserveSource === '1' && !sourceInput.value.trim();
  const payload = {
    phone: document.getElementById('lead-data-phone')?.value.trim() || '',
    whatsapp_viber: document.getElementById('lead-data-whatsapp')?.value.trim() || '',
    email: document.getElementById('lead-data-email')?.value.trim() || '',
    instagram: document.getElementById('lead-data-instagram')?.value.trim() || '',
    website_url: document.getElementById('lead-data-website')?.value.trim() || '',
    // Keep a hidden internal registry value intact when the user saves another field.
    // A visible URL supplied by the user still replaces it as expected.
    source_url: preserveInternalSource ? String(lead.source_url || '') : (sourceInput?.value.trim() || ''),
    why_help_fits: document.getElementById('lead-data-rationale')?.value.trim() || '',
    suggested_first_offer: document.getElementById('lead-data-offer')?.value.trim() || '',
  };
  if (btn) { btn.disabled = true; btn.textContent = 'Зберігаємо…'; }
  try {
    const fresh = await api('PATCH', `/leads/${lead.id}`, payload);
    leadsState.currentLead = fresh;
    renderLeadInfoBanner(fresh);
    loadLeadsList();
    loadLeadsStats().catch(() => {});
    recordActivity({ kind: 'lead', leadId: lead.id, leadName: fresh.business_name || lead.business_name || '', title: 'Оновлено реквізити ліда', detail: 'Контакти та дані профілю збережено' });
    showToast('Контакти й обґрунтування збережено.');
  } catch (err) {
    showToast(err.message || 'Не вдалося зберегти дані ліда.', true);
    if (btn) { btn.disabled = false; btn.textContent = 'Зберегти дані'; }
  }
}

async function enrichLeadFromWebsite(lead) {
  const btn = document.getElementById('btn-lead-enrich');
  if (btn) { btn.disabled = true; btn.textContent = 'Перевіряємо сайт…'; }
  try {
    const result = await api('POST', `/leads/${lead.id}/enrich`, {} , { timeoutMs: 45000 });
    const fresh = result.lead || lead;
    leadsState.currentLead = fresh;
    renderLeadInfoBanner(fresh);
    loadLeadsList();
    loadLeadsStats().catch(() => {});
    const changed = (result.updated_fields || []).length;
    recordActivity({ kind: 'lead', leadId: lead.id, leadName: fresh.business_name || lead.business_name || '', title: 'Перевірено сайт ліда', detail: changed ? `Додано підтверджених полів: ${changed}` : 'Нових публічних контактів не знайдено' });
    showToast(changed ? `Додано перевірені поля: ${changed}.` : 'Нових публічних контактів на сайті не знайдено.');
  } catch (err) {
    showToast(err.message || 'Не вдалося перевірити сайт.', true);
    if (btn) { btn.disabled = false; btn.textContent = 'Перевірити офіційний сайт'; }
  }
}

function closeLeadDetail() {
  if (leadInfoBanner) leadInfoBanner.hidden = true;
  if (btnAiSuggest) btnAiSuggest.hidden = true;
  if (aiReplySuggestionsEl) { aiReplySuggestionsEl.hidden = true; aiReplySuggestionsEl.innerHTML = ''; }
  leadsState.currentLeadId = null;
  document.querySelectorAll('.leads-card').forEach(el => el.classList.remove('active'));
  activeConvId = null;
  activePartner = null;
  clearInterval(convPollTimer);
  if (chatView) chatView.hidden = true;
  if (btnCall) btnCall.hidden = false;
  openLeadsSidebar();
}

function localIsoDate(offsetDays = 0) {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + offsetDays);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function workQueueLeadHtml(lead) {
  const location = [lead.city_area, lead.country].filter(Boolean).join(', ');
  const due = String(lead.next_followup_date || '').slice(0, 10);
  const reason = lead.queue_reason || '';
  const dueLabel = reason === 'overdue' ? `Прострочено: ${due}`
    : reason === 'today' ? 'Заплановано на сьогодні'
    : 'Наступну дію не заплановано';
  const actionLabel = due ? 'Завтра' : 'Запланувати';
  return `
    <article class="work-queue-card" data-lead-id="${Number(lead.id)}">
      <div class="work-queue-avatar" aria-hidden="true">${escHtml(initial(lead.business_name || '?'))}</div>
      <div class="work-queue-card-main">
        <div class="work-queue-card-title-row">
          <strong>${escHtml(lead.business_name || 'Без назви')}</strong>
          <span class="work-queue-priority priority-${escHtml(lead.priority || 'Medium')}">${escHtml(leadsLabel(LEADS_PRIORITY_LABELS, lead.priority || 'Medium'))}</span>
        </div>
        <div class="work-queue-card-meta">${escHtml([lead.category, location].filter(Boolean).join(' · ') || 'Деталі не вказані')}</div>
        <div class="work-queue-card-due">${escHtml(dueLabel)} · ${escHtml(leadsLabel(LEADS_OWNER_LABELS, lead.owner || '') || 'Без менеджера')}</div>
      </div>
      <div class="work-queue-card-actions">
        <button type="button" class="btn-secondary" data-work-open="${Number(lead.id)}">Деталі</button>
        <button type="button" class="btn-secondary work-queue-plan-btn" data-work-plan="${Number(lead.id)}" data-has-due="${due ? '1' : '0'}">${actionLabel}</button>
      </div>
    </article>`;
}

function renderLeadsWorkQueue(data) {
  const summary = data.summary || {};
  if (workQueueSummaryEl) {
    const stats = [
      ['overdue', 'Прострочено'], ['today', 'Сьогодні'],
      ['hot_unscheduled', 'Гарячі без дати'], ['untouched', 'Не опрацьовано'],
    ];
    workQueueSummaryEl.innerHTML = stats.map(([key, label]) => `
      <button type="button" class="work-queue-stat work-queue-stat-${key}" data-work-group="${escHtml(key)}" aria-label="Показати: ${escHtml(label)}">
        <strong>${Number(summary[key] || 0)}</strong><span>${label}</span>
      </button>`).join('');
  }
  if (!workQueueSectionsEl) return;
  const groups = data.groups || [];
  const total = Number(summary.total_actionable || 0);
  if (!total) {
    workQueueSectionsEl.innerHTML = `
      <div class="work-queue-empty">
        <strong>На зараз усе опрацьовано</strong>
        <span>Нові прострочені або заплановані дії автоматично зʼявляться тут.</span>
      </div>`;
    return;
  }
  workQueueSectionsEl.innerHTML = groups.filter(group => group.count > 0).map(group => `
    <section class="work-queue-group" data-work-group-section="${escHtml(group.key || '')}">
      <div class="work-queue-group-head">
        <div><h3>${escHtml(group.label)}</h3><p>${escHtml(group.description)}</p></div>
        <span>${Number(group.count || 0)}</span>
      </div>
      <div class="work-queue-list">${(group.items || []).map(workQueueLeadHtml).join('')}</div>
    </section>`).join('');
}

function schedulerFocusItemHtml(lead) {
  const due = String(lead.next_followup_date || '').slice(0, 10);
  const reason = lead.queue_reason || '';
  const status = reason === 'overdue' ? `Прострочено · ${due}`
    : reason === 'today' ? 'Сьогодні'
    : reason === 'hot_unscheduled' ? 'Гарячий · без дати'
    : 'Новий контакт';
  return `<button type="button" class="scheduler-focus-item" data-scheduler-lead="${Number(lead.id)}">
    <span class="scheduler-focus-mark priority-${escHtml(lead.priority || 'Medium')}" aria-hidden="true">${escHtml(initial(lead.business_name || '?'))}</span>
    <span class="scheduler-focus-copy"><strong>${escHtml(lead.business_name || 'Без назви')}</strong><small>${escHtml(status)} · ${escHtml(leadsLabel(LEADS_OWNER_LABELS, lead.owner || '') || 'Без менеджера')}</small></span>
    <span class="scheduler-focus-score">${Number(lead.lead_score || 0)}</span>
  </button>`;
}

async function loadSchedulerOverview() {
  if (!schedulerDashboardEl || schedulerOverviewEl?.hidden) return;
  schedulerDashboardEl.innerHTML = workspaceStateHtml('loading', 'Оновлюємо план', '');
  try {
      const data = await api('GET', '/leads/work-queue');
    const summary = data.summary || {};
    const metrics = [
      ['overdue', 'Прострочено', 'Повернути в роботу'], ['today', 'На сьогодні', 'Заплановані контакти'],
      ['hot_unscheduled', 'Гарячі без дати', 'Варто запланувати'], ['untouched', 'Нові без контакту', 'Ще не опрацьовані'],
    ];
    const focus = (data.groups || []).flatMap(group => group.items || []).slice(0, 6);
      schedulerDashboardEl.innerHTML = `
      <div class="scheduler-metrics">${metrics.map(([key, label, hint]) => `
        <button type="button" class="scheduler-metric is-${key}" data-open-workday="1">
          <span class="scheduler-metric-head"><i aria-hidden="true"></i>${escHtml(label)}</span>
          <strong>${Number(summary[key] || 0)}</strong><small>${escHtml(hint)}</small>
        </button>`).join('')}</div>
      <div class="scheduler-focus">
        <div class="scheduler-focus-head"><strong>У фокусі</strong><span>${Number(summary.total_actionable || 0)} дій</span></div>
        ${focus.length ? `<div class="scheduler-focus-list">${focus.map(schedulerFocusItemHtml).join('')}</div>`
          : '<div class="scheduler-focus-empty"><strong>План чистий</strong><span>Нові дії зʼявляться тут автоматично.</span></div>'}
      </div>`;
      // The overview is inserted above the message list asynchronously. Keep
      // the scheduler chat anchored to the latest digest instead of leaving
      // the old scroll position underneath the new dashboard.
      if (chatView?.classList.contains('scheduler-chat') && activeConvId) {
        requestAnimationFrame(() => scrollToBottom(true));
      }
  } catch (err) {
    schedulerDashboardEl.innerHTML = workspaceStateHtml('error', 'Планувальник недоступний', err.message || 'Спробуйте оновити сторінку.');
  }
}

// "Мій день" читає ті самі фільтри CRM (менеджер/стадія/статус/пріоритет/пошук).
// due_today свідомо не передаємо: цей екран сам розкладає ліди на прострочені,
// сьогоднішні та без дати — серверний зріз "тільки на сьогодні" вбив би дві секції.
function workQueueQueryString() {
  const params = new URLSearchParams();
  const owner = workQueueOwnerEl?.value || leadsState.owner || '';
  if (owner) params.set('owner', owner);
  if (leadsState.stage) params.set('stage', leadsState.stage);
  if (leadsState.priority) params.set('priority', leadsState.priority);
  if (leadsState.outreachStatus) params.set('outreach_status', leadsState.outreachStatus);
  if (leadsState.country) params.set('country', leadsState.country);
  if (leadsState.channel) params.set('channel', leadsState.channel);
  if (leadsState.search) params.set('search', leadsState.search);
  return params.toString();
}

async function loadLeadsWorkQueue() {
  if (!workQueueSectionsEl) return;
  workQueueSectionsEl.innerHTML = workspaceStateHtml('loading', 'Готуємо робочий день', 'Збираємо прострочені та заплановані контакти.');
  try {
    const data = await api('GET', '/leads/work-queue?' + workQueueQueryString());
    renderLeadsWorkQueue(data);
    const total = Number(data.summary?.total_actionable || 0);
    if (leadsWorkQueueBadge) {
      leadsWorkQueueBadge.textContent = total > 99 ? '99+' : String(total);
      leadsWorkQueueBadge.hidden = total === 0;
    }
  } catch (err) {
    workQueueSectionsEl.innerHTML = workspaceStateHtml('error', 'Робочий список недоступний', err.message || 'Повторіть спробу за хвилину.', 'day');
  }
}

function activateWorkspaceEntry(activeEntry = null) {
  [workspaceLeadsEntry, workspaceDayEntry, workspaceKanbanEntry, workspaceSearchEntry,
    workspaceOpeningsEntry, workspaceIntegrationsEntry, workspaceActivityEntry, workspaceNotificationsEntry].forEach(entry => {
    entry?.classList.toggle('active', entry === activeEntry);
  });
}

function getAllWorkspaceViews() {
  const aug = document.getElementById('august-schedule-view');
  const anl = document.getElementById('analytics-dashboard-view');
  const activity = document.getElementById('activity-log-view');
  const notifications = document.getElementById('notifications-view');
  return [guideView, leadsDirectoryView, leadsWorkQueueView, leadsKanbanView, integrationsView,
    prospectingView, openingsView, aug, anl, activity, notifications].filter(Boolean);
}

function hideWorkspaceViews(except = null) {
  getAllWorkspaceViews().forEach(view => {
    if (view && view !== except) view.hidden = true;
  });
}

function hasOpenWorkspace() {
  return getAllWorkspaceViews().some(view => view && !view.hidden);
}

function syncWorkspaceResponsiveLayout() {
  if (window.innerWidth <= COMPACT_LAYOUT_MAX_WIDTH) {
    sidebar.classList.toggle('hidden', hasOpenWorkspace() || Boolean(activeConvId));
  } else {
    sidebar.classList.remove('hidden');
  }
}

function prepareWorkspaceView(view, entry, title) {
  if (!view) return false;
  if (window.innerWidth <= COMPACT_LAYOUT_MAX_WIDTH) sidebar.classList.add('hidden');
  activeConvId = null;
  activePartner = null;
  clearInterval(convPollTimer);
  if (chatEmpty) chatEmpty.hidden = true;
  if (chatView) chatView.hidden = true;
  if (leadInfoBanner) leadInfoBanner.hidden = true;
  if (btnAiSuggest) btnAiSuggest.hidden = true;
  if (aiReplySuggestionsEl) {
    aiReplySuggestionsEl.hidden = true;
    aiReplySuggestionsEl.innerHTML = '';
  }
  if (btnNewChat) btnNewChat.hidden = true;
  hideWorkspaceViews(view);
  view.hidden = false;
  activateWorkspaceEntry(entry);
  if (chatTopbarSectionEl) chatTopbarSectionEl.textContent = title || 'CRM';
  try { sessionStorage.setItem(LAST_WORKSPACE_KEY, view.id || ''); } catch (_) {}
  return true;
}

function closeWorkspaceView() {
  sidebarMode = 'chats';
  if (btnLeadsExport) btnLeadsExport.hidden = true;
  if (btnLeadsAdd) btnLeadsAdd.hidden = true;
  if (btnLeadsSelect) btnLeadsSelect.hidden = true;
  if (btnLeads) btnLeads.classList.remove('active-mode');
  if (btnNewChat) btnNewChat.hidden = false;
  setLeadsSelectMode(false);
  hideWorkspaceViews();
  activateWorkspaceEntry(null);
  if (chatTopbarSectionEl) chatTopbarSectionEl.textContent = 'Месенджер';
  if (chatEmpty) chatEmpty.hidden = false;
  if (window.innerWidth <= COMPACT_LAYOUT_MAX_WIDTH) sidebar.classList.remove('hidden');
  try { sessionStorage.removeItem(LAST_WORKSPACE_KEY); } catch (_) {}
}

function openActivityLogView() {
  if (!prepareWorkspaceView(activityLogView, workspaceActivityEntry, 'Журнал дій')) return;
  renderActivityLog();
}

async function openLeadsWorkQueue() {
  if (!prepareWorkspaceView(leadsWorkQueueView, workspaceDayEntry, 'Мій день')) return;
  if (workQueueDateEl) {
    const label = new Intl.DateTimeFormat('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    workQueueDateEl.textContent = label.charAt(0).toUpperCase() + label.slice(1);
  }
  document.querySelectorAll('.leads-card').forEach(el => el.classList.remove('active'));
  leadsWorkQueueEntry?.classList.add('active');
  await ensureLeadsOwnerOptions().catch(() => {});
  if (workQueueOwnerEl && !workQueueOwnerEl.options.length) {
    workQueueOwnerEl.innerHTML = '<option value="">Усі менеджери</option>' + LEADS_OWNER_OPTIONS.map(owner =>
      `<option value="${escHtml(owner)}">${escHtml(leadsLabel(LEADS_OWNER_LABELS, owner))}</option>`
    ).join('');
  }
  if (workQueueOwnerEl) workQueueOwnerEl.value = leadsState.owner || '';
  await loadLeadsWorkQueue();
}

function closeLeadsWorkQueue() {
  leadsWorkQueueEntry?.classList.remove('active');
  closeWorkspaceView();
}

async function handleWorkQueueClick(event) {
  const summaryButton = event.target.closest('[data-work-group]');
  if (summaryButton) {
    const target = workQueueSectionsEl?.querySelector(`[data-work-group-section="${CSS.escape(summaryButton.dataset.workGroup || '')}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const openButton = event.target.closest('[data-work-open]');
  if (openButton) {
    leadsWorkQueueView.hidden = true;
    leadsWorkQueueEntry?.classList.remove('active');
    await openLeadDetail(Number(openButton.dataset.workOpen));
    return;
  }
  const planButton = event.target.closest('[data-work-plan]');
  if (!planButton) return;
  const leadId = Number(planButton.dataset.workPlan);
  planButton.disabled = true;
  try {
    await api('PATCH', `/leads/${leadId}`, {
      next_followup_date: localIsoDate(planButton.dataset.hasDue === '1' ? 1 : 0),
    });
    recordActivity({ kind: 'planner', leadId, title: planButton.dataset.hasDue === '1' ? 'Контакт перенесено на завтра' : 'Контакт заплановано на сьогодні', detail: 'Мій день · синхронізовано з CRM' });
    showToast(planButton.dataset.hasDue === '1' ? 'Контакт перенесено на завтра і додано в календар.' : 'Контакт заплановано на сьогодні й додано в календар.');
    await loadLeadsWorkQueue();
    loadLeadsStats().catch(() => {});
    loadLeadsList().catch(() => {});
    if (augView && !augView.hidden) loadAugustData().catch(() => {});
  } catch (err) {
    showToast(err.message || 'Не вдалося оновити дату.', true);
    planButton.disabled = false;
  }
}

const KANBAN_STAGE_BATCH = 50;
const kanbanState = { stats: null, items: [], search: '', owner: '', priority: '', stageLimits: {} };

function resetKanbanStageLimits() {
  kanbanState.stageLimits = {};
}

// Воронка тягне той самий набір фільтрів, що й список лідів (стадія, статус
// контакту, пріоритет, менеджер, пошук, "на сьогодні"). Раніше вона запитувала
// /leads без фільтрів — і вибраний у лідах статус ніяк не відбивався на дошці.
async function fetchAllKanbanLeads() {
  const query = page => leadsQueryString({ page, per_page: 200, sort: 'score' });
  const first = await api('GET', '/leads?' + query(1));
  const pages = Number(first.pages || 1);
  const items = [...(first.items || [])];
  if (pages > 1) {
    const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, index) =>
      api('GET', '/leads?' + query(index + 2))
    ));
    rest.forEach(page => items.push(...(page.items || [])));
  }
  return items;
}

async function bindKanbanFilters() {
  await ensureLeadsOwnerOptions().catch(() => {});
  if (kanbanOwnerFilterEl) {
    kanbanOwnerFilterEl.innerHTML = '<option value="">Всі менеджери</option>' + LEADS_OWNER_OPTIONS.map(owner =>
      `<option value="${escHtml(owner)}">${escHtml(leadsLabel(LEADS_OWNER_LABELS, owner))}</option>`
    ).join('');
    kanbanOwnerFilterEl.value = kanbanState.owner;
    kanbanOwnerFilterEl.onchange = () => {
      kanbanState.owner = kanbanOwnerFilterEl.value;
      // Фільтри дошки — це ті самі фільтри CRM: пишемо їх у leadsState, щоб
      // список, чіпи і "Мій день" не розходились із тим, що видно на воронці.
      setLeadsOwnerFilter(kanbanState.owner);
      if (leadsFilterOwner) leadsFilterOwner.value = kanbanState.owner;
      applyLeadsFilterChange();
    };
  }
  if (kanbanPriorityFilterEl) {
    kanbanPriorityFilterEl.innerHTML = '<option value="">Всі пріоритети</option>' + LEADS_PRIORITY_OPTIONS.map(priority =>
      `<option value="${escHtml(priority)}">${escHtml(leadsLabel(LEADS_PRIORITY_LABELS, priority))}</option>`
    ).join('');
    kanbanPriorityFilterEl.value = kanbanState.priority;
    kanbanPriorityFilterEl.onchange = () => {
      kanbanState.priority = kanbanPriorityFilterEl.value;
      leadsState.priority = kanbanState.priority;
      if (leadsFilterPriority) leadsFilterPriority.value = kanbanState.priority;
      applyLeadsFilterChange();
    };
  }
  if (kanbanSearchEl) {
    kanbanSearchEl.value = kanbanState.search;
    kanbanSearchEl.oninput = () => {
      kanbanState.search = kanbanSearchEl.value.trim().toLowerCase();
      resetKanbanStageLimits();
      // Пошук фільтруємо на клієнті (дані вже в пам'яті) — без зайвого запиту,
      // але той самий рядок кладемо в leadsState, щоб список показав те саме.
      leadsState.search = kanbanSearchEl.value.trim();
      if (leadsSearchInput) leadsSearchInput.value = leadsState.search;
      syncLeadsFilterStatus();
      renderLeadsKanban(kanbanState.stats, kanbanState.items);
    };
  }
}

// Перезапит воронки після зміни спільних фільтрів + підтягування списку/чіпів,
// щоб усі три екрани CRM показували один і той самий зріз даних.
async function refreshKanbanFromFilters() {
  try {
    kanbanState.items = await fetchAllKanbanLeads();
    renderLeadsKanban(kanbanState.stats, kanbanState.items);
  } catch (err) {
    showToast(err.message || 'Не вдалося оновити воронку.', true);
  }
}

async function openLeadsKanban() {
  if (!leadsKanbanColumnsEl || !prepareWorkspaceView(leadsKanbanView, workspaceKanbanEntry, 'Воронка')) return;
  document.querySelectorAll('.leads-card').forEach(el => el.classList.remove('active'));
  if (leadsKanbanEntry) leadsKanbanEntry.classList.add('active');
  // Дошка відкривається з тими ж фільтрами, що активні у списку лідів —
  // інакше перехід "Ліди → Воронка" молча скидав вибраний менеджер/пріоритет.
  kanbanState.owner = leadsState.owner || '';
  kanbanState.priority = leadsState.priority || '';
  kanbanState.search = (leadsState.search || '').toLowerCase();
  resetKanbanStageLimits();
  leadsKanbanColumnsEl.innerHTML = workspaceStateHtml('loading', 'Будуємо воронку', 'Розподіляємо ліди за поточними стадіями.');
  try {
    const [stats, items] = await Promise.all([
      api('GET', '/leads/stats'),
      fetchAllKanbanLeads(),
    ]);
    kanbanState.stats = stats;
    kanbanState.items = items;
    await bindKanbanFilters();
    renderLeadsKanban(stats, items);
  } catch (err) {
    leadsKanbanColumnsEl.innerHTML = workspaceStateHtml('error', 'Воронка недоступна', err.message || 'Повторіть спробу за хвилину.', 'kanban');
  }
}

function closeLeadsKanban() {
  if (leadsKanbanEntry) leadsKanbanEntry.classList.remove('active');
  closeWorkspaceView();
}

// ════════════════════════════════════════════
// Integrations: self-serve WhatsApp/Instagram per manager
// ════════════════════════════════════════════
const INTEGRATIONS_CHANNEL_META = {
  whatsapp: { label: 'WhatsApp Business', mark: 'WA', idLabel: 'Phone Number ID', idField: 'phone_number_id', idPlaceholder: 'Напр. 109876543210987' },
  instagram: { label: 'Instagram', mark: 'IG', idLabel: 'Instagram User ID', idField: 'ig_user_id', idPlaceholder: 'Напр. 178414...' },
};

function setIntegrationsTab(tabName) {
  document.querySelectorAll('[data-integrations-tab]').forEach(button => {
    const active = button.dataset.integrationsTab === tabName;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('[data-integrations-panel]').forEach(panel => {
    panel.hidden = panel.dataset.integrationsPanel !== tabName;
  });
}

document.querySelectorAll('[data-integrations-tab]').forEach(button => {
  button.addEventListener('click', () => setIntegrationsTab(button.dataset.integrationsTab || 'channels'));
});

/* Інструкція — закріплений перший пункт списку. Тримається як звичайний
   workspace-екран, а не модалка: її відкривають посеред роботи, і повертатися
   треба туди ж, звідки прийшли.

   Дві речі роблять її живою, а не полотном тексту:
   — розділ адміністратора ховається від менеджерів (CSS-клас на корені, а не
     видалення вузла: адмін має бачити те саме, що бачить менеджер);
   — чек-лист готовності читає СПРАВЖНІЙ стан із тих самих ендпоінтів, що й
     сторінка інтеграцій. Інакше це була б інструкція, яка не знає, чи ви їй
     слідували. */
function guideStepHtml(done, title, text, action) {
  return `<li class="guide-check ${done ? 'is-done' : 'is-todo'}">
    <span class="guide-check-mark">${done ? '✓' : ''}</span>
    <span class="guide-check-copy">
      <b>${escHtml(title)}</b>
      <small>${escHtml(text)}</small>
    </span>
    ${done || !action ? '' : `<button type="button" class="guide-check-cta" data-guide-goto="${action}">Подключить</button>`}
  </li>`;
}

async function renderGuideChecklist() {
  const list = document.getElementById('guide-checklist-items');
  const state = document.getElementById('guide-checklist-state');
  if (!list) return;

  const isManager = me?.role === 'manager';
  let hasKey = false;
  let channels = [];
  try {
    const key = await api('GET', '/prospecting/google-key');
    hasKey = !!(key.has_own_key || key.active);
  } catch (_) { /* немає доступу або мережа — крок просто лишиться незакритим */ }
  try {
    const list2 = await api('GET', '/integrations');
    const rows = Array.isArray(list2) ? list2 : (list2.items || []);
    channels = rows.filter(r => !isManager || r.manager === me?.crm_owner);
  } catch (_) {}

  const hasChannel = channels.some(c => c.status === 'connected');
  const steps = [
    guideStepHtml(hasKey, 'Ключ Google подключён',
      hasKey ? 'Поиск сайтов работает.' : 'Без него сайт находится примерно у четверти лидов.', 'integrations'),
    guideStepHtml(hasChannel, 'Канал для переписки подключён',
      hasChannel ? `Подключено каналов: ${channels.length}.` : 'WhatsApp или Instagram — если пишете прямо из системы.', 'integrations'),
    guideStepHtml(false, 'Первый поиск клиентов',
      'Страна, город, категория — и лиды появятся в вашем списке.', 'search'),
  ];
  list.innerHTML = steps.join('');
  const doneCount = [hasKey, hasChannel].filter(Boolean).length;
  if (state) {
    state.textContent = doneCount === 2 ? 'всё подключено' : `${doneCount} из 2 подключено`;
    state.classList.toggle('is-ready', doneCount === 2);
  }
}

function openGuideView() {
  if (!prepareWorkspaceView(guideView, workspaceGuideEntry, 'Инструкция')) return;
  if (!guideView) return;
  guideView.scrollTop = 0;

  const isAdmin = me?.role === 'admin' || me?.role === 'platform_admin';
  guideView.classList.toggle('is-admin', isAdmin);

  const name = (me?.crm_owner || me?.full_name || '').trim();
  const title = document.getElementById('guide-hero-title');
  const sub = document.getElementById('guide-hero-sub');
  const badges = document.getElementById('guide-role-badges');
  if (title) title.textContent = name ? `${name}, начнём сначала` : 'Начнём сначала';
  if (sub) {
    sub.textContent = isAdmin
      ? 'Старая база лидов очищена, проработанные карточки сохранены. Ниже — то же, что видят менеджеры, плюс раздел администратора.'
      : 'Старая база лидов очищена. Дальше система ищет не «ещё названий», а бизнесы, до которых можно достучаться и у которых есть что чинить.';
  }
  if (badges) {
    badges.innerHTML = `<span class="guide-badge">${escHtml(isAdmin ? 'Администратор' : 'Менеджер')}</span>`
      + (name && !isAdmin ? `<span class="guide-badge is-soft">Ваши лиды: ${escHtml(name)}</span>` : '');
  }
  renderGuideChecklist();
}

document.addEventListener('click', e => {
  const target = e.target.closest('[data-guide-goto]');
  if (!target) return;
  const where = target.dataset.guideGoto;
  if (where === 'integrations') openIntegrationsView();
  else if (where === 'search') openProspectingView();
});

async function openIntegrationsView(initialTab = 'channels') {
  if (!prepareWorkspaceView(integrationsView, workspaceIntegrationsEntry, 'Інтеграції')) return;
  setIntegrationsTab(typeof initialTab === 'string' ? initialTab : 'channels');
  if (integrationsGridEl) integrationsGridEl.innerHTML = workspaceStateHtml('loading', 'Перевіряємо підключення', 'Оновлюємо статус каналів менеджерів.');
  loadGoogleKeyCard();
  try {
    const [list, webhook] = await Promise.all([
      api('GET', '/integrations'),
      api('GET', '/integrations/webhook-info'),
    ]);
    renderIntegrationsWebhookCard(webhook);
    renderIntegrationsGrid(list);
  } catch (err) {
    if (integrationsGridEl) integrationsGridEl.innerHTML = workspaceStateHtml('error', 'Інтеграції недоступні', err.message || 'Перевірте налаштування та повторіть спробу.', 'integrations');
  }
}

async function loadGoogleKeyCard() {
  if (!googleKeyCardEl) return;
  googleKeyCardEl.innerHTML = workspaceStateHtml('loading', 'Перевіряємо Google Search');
  try {
    const status = await api('GET', '/prospecting/google-key');
    renderGoogleKeyCard(status);
  } catch (err) {
    googleKeyCardEl.innerHTML = workspaceStateHtml('error', 'Налаштування недоступні', err.message || 'Повторіть спробу.', 'google-key');
  }
}

function renderGoogleKeyCard(status) {
  if (!googleKeyCardEl) return;
  const hasOwn = !!status.has_own_key;
  const activeVia = hasOwn ? 'власний ключ' : (status.has_global_fallback ? 'спільний серверний ключ' : '');
  const statusLine = status.active
    ? `<span class="gkey-dot on"></span> Активно${activeVia ? ` · ${escHtml(activeVia)}` : ''}`
    : `<span class="gkey-dot off"></span> Не налаштовано — Google-пошук вимкнено`;
  googleKeyCardEl.innerHTML = `
    <div class="gkey-head">
      <span class="mono-label">🔎 Google Custom Search — власний ключ</span>
      <span class="gkey-status">${statusLine}</span>
    </div>
    <p class="gkey-hint">Ключ особистий: квота Google рахується на ключ, тому спільний згорів би за один прогін.
      Зберігається зашифрованим, у відповідях сервера показується лише маска, інші менеджери його не бачать.
      Безкоштовний ліміт — <b>100 запитів на добу</b>, цього вистачає приблизно на 100 лідів.</p>
    <details class="gkey-guide">
      <summary>Як отримати ключ за 5 хвилин</summary>
      <ol class="gkey-steps">
        <li><b>Створіть проєкт.</b> <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">console.cloud.google.com/projectcreate</a> → назва будь-яка → <i>Create</i>.</li>
        <li><b>Увімкніть Custom Search API.</b> <a href="https://console.cloud.google.com/apis/library/customsearch.googleapis.com" target="_blank" rel="noopener">Сторінка API</a> → <i>Enable</i>. Без цього кроку ключ віддаватиме 403.</li>
        <li><b>Створіть API key.</b> <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Credentials</a> → <i>Create credentials</i> → <i>API key</i>. Рядок виду <code>AIza…</code> — це поле «Google API key» нижче.</li>
        <li><b>Створіть пошукову систему.</b> <a href="https://programmablesearchengine.google.com/controlpanel/create" target="_blank" rel="noopener">programmablesearchengine.google.com</a> → увімкніть <b>«Search the entire web»</b> (інакше пошук шукатиме лише по вказаних сайтах і нічого не знайде) → <i>Create</i>.</li>
        <li><b>Скопіюйте Search Engine ID.</b> У створеній системі → <i>Overview</i> → <b>Search engine ID</b>. Це поле «cx» нижче.</li>
        <li>Вставте обидва значення й натисніть «Перевірити й зберегти» — ми зробимо тестовий запит і збережемо ключ, тільки якщо він справді працює.</li>
      </ol>
      <p class="gkey-note">Платити не потрібно: 100 запитів на добу безкоштовні. Якщо захочете більше —
        <a href="https://developers.google.com/custom-search/v1/overview#pricing" target="_blank" rel="noopener">тарифи Google</a> (5 $ за 1000 запитів).
        Ключ можна будь-коли видалити кнопкою нижче — він зникає з бази повністю.</p>
    </details>
    ${hasOwn ? `
      <div class="gkey-saved">
        <div class="gkey-saved-row"><span class="gkey-saved-label">API key</span><code>${escHtml(status.key_preview)}</code></div>
        <div class="gkey-saved-row"><span class="gkey-saved-label">cx</span><code>${escHtml(status.cx)}</code></div>
        ${status.verified_at ? `<div class="gkey-saved-verified">✓ Перевірено: ${escHtml(String(status.verified_at).slice(0, 16).replace('T', ' '))}</div>` : ''}
      </div>
      <div class="gkey-actions">
        <button type="button" class="integration-check-btn" id="btn-gkey-recheck">Перевірити ще раз</button>
        <button type="button" class="integration-disconnect-btn" id="btn-gkey-delete">Видалити ключ</button>
      </div>
    ` : `
      <form class="gkey-form" id="gkey-form">
        <input class="gkey-input" id="gkey-api-key" type="password" placeholder="Google API key" autocomplete="off" required/>
        <input class="gkey-input" id="gkey-cx" type="text" placeholder="Search Engine ID (cx)" autocomplete="off" required/>
        <button type="submit" class="btn-primary" id="btn-gkey-save">Перевірити й зберегти</button>
      </form>
    `}
  `;

  const form = document.getElementById('gkey-form');
  if (form) {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const apiKey = document.getElementById('gkey-api-key')?.value.trim();
      const cx = document.getElementById('gkey-cx')?.value.trim();
      if (!apiKey || !cx) return;
      const saveBtn = document.getElementById('btn-gkey-save');
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Перевіряю…'; }
      try {
        const status2 = await api('POST', '/prospecting/google-key', { api_key: apiKey, cx }, { timeoutMs: 20000 });
        showToast('Ключ перевірено й збережено — Google-пошук увімкнено.');
        renderGoogleKeyCard(status2);
      } catch (err) {
        showToast(err.message || 'Ключ не пройшов перевірку.', true);
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Перевірити й зберегти'; }
      }
    });
  }

  const recheckBtn = document.getElementById('btn-gkey-recheck');
  if (recheckBtn) {
    recheckBtn.addEventListener('click', async () => {
      recheckBtn.disabled = true;
      recheckBtn.textContent = 'Перевіряю…';
      try {
        // Re-run a live enrich as a cheap connectivity probe against the saved key.
        await api('POST', '/prospecting/enrich', { business_name: 'coffee shop' }, { timeoutMs: 20000 });
        showToast('Ключ робочий.');
      } catch (err) {
        showToast(err.message || 'Перевірка не пройшла — можливо, вичерпано квоту.', true);
      } finally {
        recheckBtn.disabled = false;
        recheckBtn.textContent = 'Перевірити ще раз';
      }
    });
  }

  const delBtn = document.getElementById('btn-gkey-delete');
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      delBtn.disabled = true;
      try {
        const status2 = await api('DELETE', '/prospecting/google-key');
        showToast('Ключ видалено.');
        renderGoogleKeyCard(status2);
      } catch (err) {
        showToast(err.message || 'Не вдалося видалити.', true);
        delBtn.disabled = false;
      }
    });
  }
}

function closeIntegrationsView() {
  closeWorkspaceView();
}

// ════════════════════════════════════════════
// Prospecting: конструктор пошуку клієнтів (OpenStreetMap)
// ════════════════════════════════════════════
async function openProspectingView() {
  if (!prepareWorkspaceView(prospectingView, workspaceSearchEntry, 'Дослідження ринку')) return;
  if (!prospCatalogLoaded) await loadProspectingCatalog();
}

function closeProspectingView() {
  closeWorkspaceView();
}

function openingMonthLabel(value) {
  return ({ '09': 'Вересень', '10': 'Жовтень', '11': 'Листопад' })[value] || value || '2026';
}

function openingCardHtml(item) {
  const population = Number(item.city_population || 0).toLocaleString('uk-UA');
  const confirmed = item.verification_status === 'confirmed';
  const dateMatch = String(item.opening_date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const dateDay = dateMatch ? dateMatch[3] : '—';
  const dateYear = dateMatch ? dateMatch[1] : '2026';
  return `
    <article class="opening-card" data-opening-id="${escHtml(item.id || '')}">
      <div class="opening-card-date"><span>${escHtml(openingMonthLabel(item.opening_month))}</span><strong>${escHtml(dateDay)}</strong><small>${escHtml(dateYear)}</small></div>
      <div class="opening-card-main">
        <div class="opening-card-topline">
          <span class="opening-type">${escHtml(item.category_label || 'Локальний обʼєкт')}</span>
          <span class="opening-status ${confirmed ? 'is-confirmed' : ''}">${escHtml(item.verification_label || 'Потребує перевірки')}</span>
        </div>
        <h3>${escHtml(item.business_name || '')}</h3>
        <p class="opening-location">${escHtml(item.city_area || '')} · ${population} мешканців</p>
        <p class="opening-description">${escHtml(item.description || '')}</p>
        <div class="opening-card-actions">
          <a href="${escHtml(item.source_url || '#')}" target="_blank" rel="noopener">${crmActionIcon('source')}<span>${escHtml(item.source_name || 'Відкрити джерело')}</span></a>
        </div>
      </div>
    </article>`;
}

async function loadOpenings(page = 1) {
  if (!openingsListEl) return;
  openingsPage = page;
  openingsFeedbackEl.textContent = 'Оновлюю реєстр…';
  openingsFeedbackEl.hidden = false;
  const params = new URLSearchParams({ page: String(page), per_page: '24' });
  if (openingsSearchEl?.value.trim()) params.set('q', openingsSearchEl.value.trim());
  if (openingsMonthEl?.value) params.set('month', openingsMonthEl.value);
  if (openingsCityTierEl?.value) params.set('city_tier', openingsCityTierEl.value);
  if (openingsCountryEl?.value) params.set('country', openingsCountryEl.value);
  if (openingsCategoryEl?.value) params.set('category', openingsCategoryEl.value);
  if (openingsVerificationEl?.value) params.set('verification', openingsVerificationEl.value);
  try {
    const data = await api('GET', '/prospecting/openings?' + params.toString());
    if (!openingsFiltersLoaded) {
      openingsCountryEl.innerHTML = '<option value="">Усі країни</option>' + (data.countries || []).map(x => `<option value="${escHtml(x.code)}">${escHtml(x.label)}</option>`).join('');
      openingsCategoryEl.innerHTML = '<option value="">Усі типи</option>' + (data.categories || []).map(x => `<option value="${escHtml(x.key)}">${escHtml(x.label)}</option>`).join('');
      openingsFiltersLoaded = true;
    }
    openingsTotalEl.textContent = String(data.total || 0);
    if (workspaceOpeningsCountEl) workspaceOpeningsCountEl.textContent = String(data.registry_count || data.total || 0);
    openingsFeedbackEl.textContent = data.total ? `Знайдено ${data.total}. Кожна дата має окреме джерело та статус перевірки.` : 'За цими фільтрами записів немає.';
    openingsItemsById = new Map((data.records || []).map(item => [item.id, item]));
    openingsListEl.innerHTML = (data.records || []).map(openingCardHtml).join('');
    const pages = Math.max(1, Math.ceil((data.total || 0) / (data.per_page || 24)));
    openingsPaginationEl.innerHTML = pages > 1 ? `<button type="button" data-opening-page="${Math.max(1, page - 1)}" ${page <= 1 ? 'disabled' : ''}>Назад</button><span>${page} / ${pages}</span><button type="button" data-opening-page="${Math.min(pages, page + 1)}" ${page >= pages ? 'disabled' : ''}>Далі</button>` : '';
  } catch (err) {
    openingsFeedbackEl.textContent = err.message || 'Не вдалося завантажити реєстр.';
    openingsListEl.innerHTML = '';
  }
}

async function loadOpeningsCount() {
  if (!workspaceOpeningsCountEl) return;
  try {
    const data = await api('GET', '/prospecting/openings?per_page=12');
    workspaceOpeningsCountEl.textContent = String(data.registry_count || data.total || 0);
  } catch (_) {
    workspaceOpeningsCountEl.textContent = '—';
  }
}

async function openOpeningsView() {
  if (!prepareWorkspaceView(openingsView, workspaceOpeningsEntry, 'Відкриття 2026')) return;
  await loadOpenings(1);
}

function closeOpeningsView() {
  closeWorkspaceView();
}

async function importOpeningById(id) {
  const button = openingsListEl?.querySelector(`[data-opening-import="${CSS.escape(id)}"]`);
  const card = button?.closest('.opening-card');
  if (!button || !card) return;
  button.disabled = true;
  button.textContent = 'Додаю…';
  try {
    const item = openingsItemsById.get(id);
    if (!item) throw new Error('Запис не знайдено.');
    const result = await api('POST', '/prospecting/import', { candidates: [item], owner: LEADS_OWNER_OPTIONS[0] || '' });
    if (result.created) {
      button.textContent = 'У CRM';
      card.classList.add('is-imported');
      showToast('Лід додано менеджеру Міші.');
    } else {
      button.textContent = 'Вже у CRM';
      showToast('Такий лід уже є у CRM.');
    }
  } catch (err) {
    button.disabled = false;
    button.textContent = 'Додати в CRM';
    showToast(err.message || 'Не вдалося додати лід.', true);
  }
}

async function loadProspectingCatalog() {
  try {
    const data = await api('GET', '/prospecting/categories');
    if (prospCategoryEl) {
      prospCategoryEl.innerHTML = (data.categories || []).map(c => `<option value="${escHtml(c.key)}">${escHtml(c.label)}</option>`).join('');
    }
    if (prospQualifiersEl) {
      prospQualifiersEl.innerHTML = (data.qualifiers || []).map(q => `
        <label class="prospecting-checkbox">
          <input type="checkbox" class="prosp-qualifier" value="${escHtml(q.key)}"/>
          <span>${escHtml(q.label)}</span>
        </label>
      `).join('');
    }
    prospGoogleConfigured = !!data.google_configured;
    if (prospTabGoogle && !prospGoogleConfigured) {
      prospTabGoogle.innerHTML = '<span>Google</span><small>потрібен ключ</small>';
    }
    prospCatalogLoaded = true;
    loadSavedSearches().catch(() => {});
    loadProspSearchRuns().catch(() => {});
    restoreLastProspSearch();
    restoreActiveProspJob();
  } catch (err) {
    if (prospResultsEl) {
      prospResultsEl.innerHTML = renderProspStatusHtml('error', 'Категорії не завантажились', friendlyApiMessage(err));
      bindProspRecoveryActions();
    }
  }
}

function renderProspStatusHtml(type, title, text, actions = '') {
  const klass = type === 'loading' ? 'prosp-loading-card' : type === 'empty' ? 'prosp-empty-card' : 'prosp-error-card';
  return `
    <div class="${klass}">
      <p class="mono-label">${type === 'loading' ? 'SEARCHING' : type === 'empty' ? 'NO RESULTS' : 'NEEDS ATTENTION'}</p>
      <h3>${escHtml(title)}</h3>
      <p>${escHtml(text)}</p>
      ${actions}
    </div>
  `;
}

function renderProspLoading(label) {
  if (!prospResultsEl) return;
  prospResultsEl.innerHTML = renderProspStatusHtml('loading', 'Шукаю кандидатів', label);
}

function renderProspError(err) {
  if (!prospResultsEl) return;
  const actions = `
    <div class="prosp-error-actions">
      <button type="button" data-prosp-retry>Повторити пошук</button>
      <button type="button" data-prosp-limit20>Зменшити ліміт до 20</button>
    </div>
  `;
  prospResultsEl.innerHTML = renderProspStatusHtml('error', 'Пошук не завершився', friendlyApiMessage(err), actions);
  bindProspRecoveryActions();
}

function bindProspRecoveryActions() {
  prospResultsEl?.querySelector('[data-prosp-retry]')?.addEventListener('click', () => runProspectingSearch());
  prospResultsEl?.querySelector('[data-prosp-limit20]')?.addEventListener('click', () => {
    const limitEl = document.getElementById('prosp-limit');
    const googleLimitEl = document.getElementById('prosp-g-num');
    if (limitEl) limitEl.value = '20';
    if (googleLimitEl) googleLimitEl.value = '10';
    runProspectingSearch();
  });
}

function prospSignalBadges(cand) {
  const badges = [];
  if (cand.source === 'google') {
    const sig = cand.signals || {};
    if (sig.is_listicle) {
      badges.push('<span class="prosp-badge prosp-badge-listicle">Огляд / список — не один бізнес</span>');
    } else if (sig.platform_only) {
      badges.push('<span class="prosp-badge prosp-badge-gap">Тільки платформа, не власний сайт</span>');
    } else if (cand.website_url) {
      badges.push('<span class="prosp-badge prosp-badge-new">Власний сайт знайдено</span>');
    }
    if (cand.phone) badges.push('<span class="prosp-badge prosp-badge-new">Телефон у видачі</span>');
    return badges.join('');
  }
  if (cand.opened) {
    const m = cand.opened.months_ago;
    const label = cand.opened.status === 'planned'
      ? `Планується ${cand.opened.date}`
      : (m < 12 ? `Відкрито ${m} міс тому` : `Відкрито ${Math.floor(m / 12)} р тому`);
    badges.push(`<span class="prosp-badge prosp-badge-new">${escHtml(label)}</span>`);
  }
  const sig = cand.signals || {};
  if (sig.no_website) badges.push('<span class="prosp-badge prosp-badge-gap">Немає сайту</span>');
  if (sig.no_instagram) badges.push('<span class="prosp-badge prosp-badge-gap">Немає Instagram</span>');
  if (sig.no_facebook) badges.push('<span class="prosp-badge prosp-badge-gap">Немає Facebook</span>');
  return badges.join('');
}

function prospSourceLabel(source) {
  if (source === 'google') return 'Google';
  if (source === 'both') return 'OSM + Google';
  return 'OSM';
}

function prospReasonLabel(reason) {
  const labels = {
    duplicate_phone: 'уже є в CRM за телефоном',
    duplicate_domain: 'уже є в CRM за доменом сайту',
    duplicate_name_city: 'уже є в CRM за назвою і містом',
  };
  return labels[reason] || reason || '';
}

function prospResultMetrics(list) {
  const active = (list || []).filter(c => !c.__hidden);
  return {
    hot: active.filter(c => Number(c.score || 0) > 0).length,
    contacts: active.filter(c => c.phone || c.email).length,
    websites: active.filter(c => c.website_url).length,
    gaps: active.filter(c => (c.signals || {}).no_website || (c.signals || {}).no_instagram || (c.signals || {}).no_facebook).length,
  };
}

function visibleProspCards() {
  return Array.from(prospResultsEl?.querySelectorAll('.prosp-card') || [])
    .filter(card => card.style.display !== 'none' && !card.classList.contains('prosp-card-disabled'));
}

function setVisibleProspSelection(checked) {
  visibleProspCards().forEach(card => {
    const cb = card.querySelector('.prosp-select:not(:disabled)');
    if (cb) cb.checked = checked;
  });
  updateProspImportBar();
}

function hideProspCandidate(idx) {
  const cand = prospCandidates[idx];
  if (!cand) return;
  cand.__hidden = true;
  renderProspResults({ ...(prospLastResult || {}), candidates: prospCandidates });
  showToast('Кандидата приховано з поточної видачі.');
}

function renderProspResults(result, resultSource = prospSource) {
  if (prospMap) { prospMap.remove(); prospMap = null; }
  prospLastResult = result;
  prospCandidates = result.candidates || [];
  prospImportPreview = null;
  if (!prospResultsEl) return;
  if (prospQuickFilterRow) prospQuickFilterRow.hidden = !prospCandidates.length;
  const visibleCandidates = prospCandidates.filter(c => !c.__hidden);
  if (!visibleCandidates.length) {
    const note = result.recent_filter_applied
      ? 'Не знайдено бізнесів із відомою датою відкриття в цьому вікні. Спробуйте без фільтра «щойно відкриті» — OSM рідко має дату.'
      : 'Нічого не знайдено. Спробуйте іншу категорію, місто, або зніміть частину фільтрів.';
    prospResultsEl.innerHTML = renderProspStatusHtml('empty', 'Нічого не знайдено', note);
    updateProspImportBar();
    return;
  }
  const excludedNote = result.excluded_existing
    ? `<span><b>${result.excluded_existing}</b> вже в CRM приховано</span>`
    : '';
  const metrics = prospResultMetrics(prospCandidates);
  const locationWarnings = (result.location_errors || []).map(item => `${item.location}: ${item.message}`);
  const warningNote = [result.osm_error ? `OSM: ${result.osm_error}` : '', result.google_error ? `Google: ${result.google_error}` : '', ...locationWarnings]
    .filter(Boolean)
    .map(t => `<span class="prosp-results-warning">${escHtml(t)}</span>`)
    .join('');
  const filterSummary = result.filter_summary || {};
  const filterSummaryHtml = filterSummary.active
    ? `<div class="prosp-filter-summary">Розумний фільтр: ${Number(filterSummary.before || 0)} до перевірки · ${Number(filterSummary.after || 0)} збігів${filterSummary.unknown ? ` · ${Number(filterSummary.unknown)} невідомих значень` : ''}</div>`
    : '';
  const queryPlanHtml = result.passes_completed
    ? `<div class="prosp-query-plan"><b>${Number(result.passes_completed)} пошукових проходи</b>${(result.query_plan || []).map(item => `<span>${escHtml(item.label || item.kind || 'Пошук')}</span>`).join('')}</div>`
    : '';
  const catalogStats = result.catalog_stats || {};
  const catalogHtml = (catalogStats.new || catalogStats.updated)
    ? `<div class="prosp-catalog-note"><b>Власна база:</b> ${Number(catalogStats.new || 0)} нових · ${Number(catalogStats.updated || 0)} повторно підтверджено</div>`
    : '';
  const head = `
    <div class="prosp-results-head">
      <div>
        <strong>${escHtml(prospSourceLabel(resultSource))}</strong>
        <span>знайдено <b>${visibleCandidates.length}</b></span>
        <span>усього: ${Number(result.total_found || prospCandidates.length)}</span>
        ${excludedNote}
      </div>
      ${result.partial ? '<span class="prosp-partial-badge">Частковий результат</span>' : ''}
      <small>${escHtml(result.area || 'Поточний пошук')}</small>
      <div class="prosp-results-metrics">
        <span><b>${metrics.hot}</b> гарячих</span>
        <span><b>${metrics.contacts}</b> з контактами</span>
        <span><b>${metrics.websites}</b> із сайтом</span>
        <span><b>${metrics.gaps}</b> з прогалинами</span>
      </div>
      ${filterSummaryHtml}
      ${queryPlanHtml}
      ${catalogHtml}
      <div class="prosp-results-actions">
        <div class="prosp-view-switch" role="group" aria-label="Вигляд результатів">
          <button type="button" data-prosp-view="list" class="${prospResultMode === 'list' ? 'active' : ''}">Список</button>
          <button type="button" data-prosp-view="map" class="${prospResultMode === 'map' ? 'active' : ''}">Карта</button>
        </div>
      </div>
      ${warningNote ? `<div class="prosp-results-warnings">${warningNote}</div>` : ''}
    </div>`;
  const rows = prospCandidates.map((c, i) => {
    if (c.__hidden) return '';
    const isGoogle = c.source === 'google';
    const isListicle = isGoogle && !!(c.signals || {}).is_listicle;
    const metaLine = isGoogle
      ? escHtml(c.snippet || c.domain || '')
      : escHtml([c.category, c.city_area].filter(Boolean).join(' · '));
    const avatar = (isGoogle && c.thumbnail)
      ? `<img class="prosp-card-avatar prosp-card-avatar-img" src="${escHtml(c.thumbnail)}" alt=""/>`
      : `<div class="prosp-card-avatar">${escHtml((c.business_name || '?').trim().charAt(0) || '?')}</div>`;
    const searchBlob = escHtml([c.business_name, c.domain, c.snippet, c.category, c.city_area].filter(Boolean).join(' ').toLowerCase());
    return `
    <div class="prosp-card${isListicle ? ' prosp-card-disabled' : ''}" data-search="${searchBlob}" data-idx="${i}">
      ${avatar}
      <div class="prosp-card-body">
        <div class="prosp-card-name">${escHtml(c.business_name)}${isGoogle ? ' <span class="prosp-badge prosp-badge-google">G</span>' : ''}${(c.score > 0 && !isListicle) ? ` <span class="prosp-score" title="Орієнтовна гарячість ліда">HOT ${c.score}</span>` : ''}</div>
        <div class="prosp-card-meta">${metaLine}</div>
        <div class="prosp-card-contacts">
          ${c.phone ? `<span class="prosp-contact">phone · ${escHtml(c.phone)}</span>` : ''}
          ${c.website_url ? `<a class="prosp-contact" href="${escHtml(c.website_url)}" target="_blank" rel="noopener">${isGoogle ? escHtml(c.domain || 'сайт') : 'site'}</a>` : ''}
          ${c.instagram ? `<span class="prosp-contact">instagram · ${escHtml(c.instagram)}</span>` : ''}
          ${c.facebook ? `<a class="prosp-contact" href="${escHtml(c.facebook)}" target="_blank" rel="noopener">Facebook</a>` : ''}
          ${c.linkedin ? `<a class="prosp-contact" href="${escHtml(c.linkedin)}" target="_blank" rel="noopener">LinkedIn</a>` : ''}
          ${c.whatsapp ? `<a class="prosp-contact" href="${escHtml(c.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
          ${c.source_url && !isGoogle ? `<a class="prosp-contact" href="${escHtml(c.source_url)}" target="_blank" rel="noopener">OSM</a>` : ''}
          ${c.source_url && isGoogle && !c.website_url ? `<a class="prosp-contact" href="${escHtml(c.source_url)}" target="_blank" rel="noopener">↗ переглянути</a>` : ''}
        </div>
        <div class="prosp-card-badges">${prospSignalBadges(c)}</div>
        ${c.discovery_evidence?.length ? `<div class="prosp-discovery-proof"><b>Знайдено через:</b> ${c.discovery_evidence.map(item => escHtml(item.label)).join(' · ')}</div>` : ''}
        ${c.match_reasons?.length ? `<div class="prosp-match-reasons">${c.match_reasons.map(reason => `<span>${escHtml(reason)}</span>`).join('')}</div>` : ''}
        ${c.enrichment_sources?.length ? `<div class="prosp-enrichment-proof"><b>Якість ${Number(c.enrichment_quality || 0)}/100</b> · перевірено ${c.enrichment_sources.length} стор.${c.enrichment_structured ? ' · Schema.org' : ''}${c.enrichment_cache_hit ? ` · ${c.enrichment_cache_layer === 'persistent' ? 'серверний кеш' : 'швидкий кеш'}` : ''}${c.enrichment_languages?.length ? ` · ${escHtml(c.enrichment_languages.join(', ').toUpperCase())}` : ''} · <a href="${escHtml(c.enrichment_sources[0])}" target="_blank" rel="noopener">джерело ↗</a></div>` : ''}
        ${c.enrichment_address ? `<div class="prosp-card-address">${escHtml(c.enrichment_address)}</div>` : ''}
        ${c.suggested_first_offer ? `<div class="prosp-card-offer">${escHtml(c.suggested_first_offer)}</div>` : ''}
        <div class="prosp-card-actions">
          ${(!isListicle && !c.phone && !c.email) ? `<button type="button" class="prosp-enrich-btn" data-idx="${i}">Знайти контакти</button>` : ''}
          ${(!isListicle && c.enrichment_sources?.length) ? `<button type="button" class="prosp-enrich-btn" data-idx="${i}" data-force-refresh="1">Оновити перевірку</button>` : ''}
          ${c.website_url ? `<a class="prosp-card-link" href="${escHtml(c.website_url)}" target="_blank" rel="noopener">Відкрити сайт</a>` : ''}
          <button type="button" class="prosp-hide-btn" data-idx="${i}">Сховати</button>
        </div>
      </div>
    </div>
  `;
  }).join('');
  const mapVisibleCandidates = prospCandidates.filter(c => !c.__hidden);
  const mappedCount = mapVisibleCandidates.filter(hasProspCoordinates).length;
  prospResultsEl.innerHTML = head + `
    <div class="prosp-map-shell" id="prosp-map-shell" ${prospResultMode === 'map' ? '' : 'hidden'}>
      <div class="prosp-map-meta">
        <div><strong>${mappedCount}</strong> на карті <span>· ${mapVisibleCandidates.length - mappedCount} без координат у списку</span></div>
        <div class="prosp-map-tools">
          <span>Колесо миші не змінює масштаб</span>
          <button type="button" id="btn-prosp-map-fit">Показати всі точки</button>
        </div>
      </div>
      <div class="prosp-map" id="prosp-map" aria-label="Карта знайдених бізнесів"></div>
    </div>
    <div class="prosp-cards" ${prospResultMode === 'map' ? 'hidden' : ''}>${rows}</div>`;
  prospResultsEl.querySelectorAll('[data-prosp-view]').forEach(btn => {
    btn.addEventListener('click', () => setProspResultMode(btn.dataset.prospView));
  });
  prospResultsEl.querySelectorAll('.prosp-enrich-btn').forEach(btnEl => {
    btnEl.addEventListener('click', () => enrichProspCandidate(Number(btnEl.dataset.idx), btnEl.dataset.forceRefresh === '1', btnEl));
  });
  prospResultsEl.querySelectorAll('.prosp-hide-btn').forEach(btnEl => {
    btnEl.addEventListener('click', () => hideProspCandidate(Number(btnEl.dataset.idx)));
  });
  updateProspImportBar();
  if (prospResultMode === 'map') requestAnimationFrame(() => renderProspMap());
}

function setProspResultMode(mode) {
  prospResultMode = mode === 'map' ? 'map' : 'list';
  const mapShell = document.getElementById('prosp-map-shell');
  const cards = prospResultsEl?.querySelector('.prosp-cards');
  if (mapShell) mapShell.hidden = prospResultMode !== 'map';
  if (cards) cards.hidden = prospResultMode === 'map';
  prospResultsEl?.querySelectorAll('[data-prosp-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.prospView === prospResultMode));
  if (prospResultMode === 'map') requestAnimationFrame(() => renderProspMap());
}

function hasProspCoordinates(candidate) {
  if (!candidate) return false;
  const lat = candidate.latitude;
  const lon = candidate.longitude;
  if (lat === null || lat === undefined || lat === '' || lon === null || lon === undefined || lon === '') return false;
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lon));
}

function renderProspMap() {
  const mapEl = document.getElementById('prosp-map');
  if (!mapEl || mapEl.offsetParent === null) return;
  const located = prospCandidates
    .filter(candidate => !candidate.__hidden && hasProspCoordinates(candidate))
    .map((candidate, idx) => ({ candidate, idx, lat: Number(candidate.latitude), lon: Number(candidate.longitude) }))
    .filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lon));
  if (!window.L) {
    mapEl.innerHTML = '<div class="prosp-map-empty">Картографічний модуль не завантажився. Список результатів залишається доступним.</div>';
    return;
  }
  if (!located.length) {
    mapEl.innerHTML = '<div class="prosp-map-empty">У цих результатах немає координат. Перейдіть до списку або виконайте пошук через OSM.</div>';
    return;
  }
  if (prospMap) { prospMap.invalidateSize(); return; }
  prospMap = window.L.map(mapEl, { scrollWheelZoom: false, zoomControl: true });
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(prospMap);
  const bounds = [];
  located.forEach(({ candidate, idx, lat, lon }) => {
    bounds.push([lat, lon]);
    const popupContacts = [
      candidate.phone ? `<a href="tel:${escHtml(String(candidate.phone).replace(/[^+\d]/g, ''))}">${escHtml(candidate.phone)}</a>` : '',
      candidate.website_url ? `<a href="${escHtml(candidate.website_url)}" target="_blank" rel="noopener">Сайт ↗</a>` : '',
    ].filter(Boolean).join('');
    const popup = `<div class="prosp-map-popup"><strong>${escHtml(candidate.business_name || 'Без назви')}</strong><span>${escHtml([candidate.category, candidate.city_area].filter(Boolean).join(' · '))}</span>${popupContacts ? `<div class="prosp-map-popup-contacts">${popupContacts}</div>` : ''}<button type="button" data-map-card="${idx}">Показати у списку</button></div>`;
    window.L.marker([lat, lon]).addTo(prospMap).bindPopup(popup).on('popupopen', event => {
      event.popup.getElement()?.querySelector('[data-map-card]')?.addEventListener('click', () => {
        setProspResultMode('list');
        const card = prospResultsEl?.querySelector(`.prosp-card[data-idx="${idx}"]`);
        card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card?.classList.add('prosp-card-highlight');
        setTimeout(() => card?.classList.remove('prosp-card-highlight'), 1800);
      }, { once: true });
    });
  });
  prospMap.fitBounds(bounds, { padding: [28, 28], maxZoom: 14 });
  document.getElementById('btn-prosp-map-fit')?.addEventListener('click', () => {
    prospMap?.fitBounds(bounds, { padding: [28, 28], maxZoom: 14 });
  });
}

function renderProspImportPreview(preview, selected) {
  if (!prospResultsEl) return;
  prospImportPreview = preview;
  document.getElementById('prosp-import-preview')?.remove();
  const summary = preview.summary || {};
  const rows = preview.rows || [];
  const newIndexes = new Set(rows.filter(r => r.status === 'new').map(r => Number(r.idx)));
  const selectedRows = rows.slice(0, 18).map(r => {
    const statusLabel = r.status === 'new' ? 'додасться' : r.status === 'duplicate' ? 'дубль' : 'проблема';
    return `
      <div class="prosp-preview-row prosp-preview-${escHtml(r.status)}">
        <span class="prosp-preview-status">${escHtml(statusLabel)}</span>
        <strong>${escHtml(r.business_name || 'Без назви')}</strong>
        <small>${escHtml([r.city_area, r.phone, r.website_url].filter(Boolean).join(' · '))}</small>
        ${r.reason ? `<em>${escHtml(prospReasonLabel(r.reason))}</em>` : ''}
      </div>
    `;
  }).join('');
  const more = rows.length > 18 ? `<p class="prosp-preview-more">Показано 18 з ${rows.length}. Усі рядки будуть враховані при додаванні.</p>` : '';
  const cleanSelected = selected.filter((_, idx) => newIndexes.has(idx));
  const panel = document.createElement('div');
  panel.id = 'prosp-import-preview';
  panel.className = 'prosp-import-preview';
  panel.innerHTML = `
    <div class="prosp-preview-head">
      <div>
        <p class="mono-label">Перевірка перед імпортом</p>
        <h3>${Number(summary.new || 0)} нових · ${Number(summary.duplicate || 0)} дублів · ${Number(summary.invalid || 0)} проблем</h3>
        <p>CRM перевірила телефон, домен сайту, назву й місто. Додамо тільки чисті записи.</p>
      </div>
      <div class="prosp-preview-actions">
        <button type="button" class="btn-secondary" id="btn-prosp-preview-back">Повернутись</button>
        <button type="button" class="btn-primary" id="btn-prosp-preview-confirm" ${cleanSelected.length ? '' : 'disabled'}>Додати ${cleanSelected.length} нових</button>
      </div>
    </div>
    <div class="prosp-preview-list">${selectedRows}</div>
    ${more}
  `;
  prospResultsEl.prepend(panel);
  document.getElementById('btn-prosp-preview-back')?.addEventListener('click', () => {
    prospImportPreview = null;
    panel.remove();
  });
  document.getElementById('btn-prosp-preview-confirm')?.addEventListener('click', () => {
    commitProspImport(cleanSelected);
  });
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function enrichProspCandidate(idx, forceRefresh = false, triggerButton = null) {
  const cand = prospCandidates[idx];
  if (!cand) return;
  const btnEl = triggerButton || prospResultsEl?.querySelector(`.prosp-enrich-btn[data-idx="${idx}"]`);
  const originalBtnText = btnEl?.textContent || 'Знайти контакти';
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Шукаю…'; }
  try {
    const data = await api('POST', '/prospecting/enrich', {
      business_name: cand.business_name,
      website_url: cand.website_url || '',
      city: cand.city_area,
      country: cand.country || document.getElementById('prosp-country')?.value.trim() || '',
      force_refresh: forceRefresh,
    }, { timeoutMs: 35000 });
    if (data.blocked_by_robots) {
      showToast('Сайт заборонив автоматичну перевірку. Відкрийте його вручну.', true);
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = originalBtnText; }
      return;
    }
    if (!applyProspEnrichment(cand, data)) {
      const crawlError = Array.isArray(data.crawl_errors) ? data.crawl_errors[0] : '';
      if (crawlError) showToast(`Не вдалося перевірити сайт: ${crawlError}`, true);
      else showToast('На публічних сторінках контактів не знайдено.');
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = originalBtnText; }
      return;
    }
    const checked = Number(data.pages_checked || 0);
    showToast(checked ? `Контакти оновлено · перевірено сторінок: ${checked}` : 'Контакти оновлено.');
    if (prospLastResult) renderProspResults({ ...prospLastResult, candidates: prospCandidates });
  } catch (err) {
    showToast(err.message || 'Не вдалося знайти контакти.', true);
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = originalBtnText; }
  }
}

function applyProspEnrichment(cand, data) {
  const hadWebsite = Boolean(cand.website_url);
  const foundContact = Boolean(data.phone || data.email || data.instagram || data.facebook || data.linkedin || data.whatsapp);
  const foundWebsite = Boolean(data.website_url && !hadWebsite);
  if (data.phone) cand.phone = data.phone;
  if (data.email) cand.email = data.email;
  if (data.website_url && !cand.website_url) cand.website_url = data.website_url;
  if (data.instagram) cand.instagram = data.instagram;
  if (data.facebook) cand.facebook = data.facebook;
  if (data.linkedin) cand.linkedin = data.linkedin;
  if (data.whatsapp) cand.whatsapp = data.whatsapp;
  if (data.description && !cand.snippet) cand.snippet = data.description;
  cand.enrichment_sources = data.sources || [];
  cand.enrichment_evidence = data.evidence || [];
  cand.enrichment_cache_hit = Boolean(data.cache_hit);
  cand.enrichment_cache_layer = data.cache_layer || '';
  cand.enrichment_cache_age = Number(data.cache_age_seconds || 0);
  cand.enrichment_structured = Boolean(data.structured_data_found);
  cand.enrichment_quality = Number(data.contact_quality_score || 0);
  cand.enrichment_address = data.address || '';
  cand.enrichment_languages = data.site_languages || [];
  cand.enrichment_opening_hours = data.opening_hours || [];
  cand.enrichment_schema_types = data.schema_types || [];
  return foundContact || foundWebsite;
}

async function enrichSelectedProspCandidates() {
  const selectedIndexes = Array.from(prospResultsEl?.querySelectorAll('.prosp-select:checked') || [])
    .map(cb => Number(cb.dataset.idx))
    .filter(idx => prospCandidates[idx]);
  if (!selectedIndexes.length || !btnProspEnrichSelected) return;
  const queue = selectedIndexes.slice(0, 10);
  if (selectedIndexes.length > queue.length) showToast('За один запуск перевіряємо до 10 сайтів. Решта залишилася обраною.');
  let updated = 0;
  let unavailable = 0;
  btnProspEnrichSelected.disabled = true;
  if (btnProspImport) btnProspImport.disabled = true;
  try {
    for (let position = 0; position < queue.length; position += 1) {
      const idx = queue[position];
      const cand = prospCandidates[idx];
      btnProspEnrichSelected.textContent = `Перевіряю ${position + 1}/${queue.length}`;
      try {
        const data = await api('POST', '/prospecting/enrich', {
          business_name: cand.business_name,
          website_url: cand.website_url || '',
          city: cand.city_area,
          country: cand.country || document.getElementById('prosp-country')?.value.trim() || '',
        }, { timeoutMs: 35000 });
        if (!data.blocked_by_robots && applyProspEnrichment(cand, data)) updated += 1;
        else unavailable += 1;
      } catch (_) {
        unavailable += 1;
      }
    }
    if (prospLastResult) {
      renderProspResults({ ...prospLastResult, candidates: prospCandidates });
      selectedIndexes.forEach(idx => {
        const checkbox = prospResultsEl?.querySelector(`.prosp-select[data-idx="${idx}"]`);
        if (checkbox && !checkbox.disabled) checkbox.checked = true;
      });
      updateProspImportBar();
    }
    showToast(`Перевірено ${queue.length}: оновлено ${updated}, без нових контактів ${unavailable}.`);
  } finally {
    btnProspEnrichSelected.disabled = false;
    btnProspEnrichSelected.textContent = 'Знайти контакти';
    if (btnProspImport) btnProspImport.disabled = false;
    updateProspImportBar();
  }
}

function selectedProspCandidates() {
  if (!prospResultsEl) return [];
  return Array.from(prospResultsEl.querySelectorAll('.prosp-select:checked'))
    .map(cb => prospCandidates[Number(cb.dataset.idx)])
    .filter(Boolean);
}

function updateProspImportBar() {
  const selected = selectedProspCandidates();
  if (prospImportPreview) {
    prospImportPreview = null;
    document.getElementById('prosp-import-preview')?.remove();
  }
  if (prospSelectedCount) prospSelectedCount.textContent = `Обрано: ${selected.length}`;
  if (btnProspEnrichSelected) btnProspEnrichSelected.disabled = selected.length === 0;
  if (prospImportBar) prospImportBar.hidden = selected.length === 0;
}

function setProspSource(source) {
  prospSource = (source === 'google' || source === 'both') ? source : 'osm';
  if (prospTabOsm) prospTabOsm.classList.toggle('active', prospSource === 'osm');
  if (prospTabGoogle) prospTabGoogle.classList.toggle('active', prospSource === 'google');
  if (prospTabBoth) prospTabBoth.classList.toggle('active', prospSource === 'both');
  if (prospGoogleFiltersEl) prospGoogleFiltersEl.hidden = prospSource !== 'google';
  if (prospOsmFiltersEl) prospOsmFiltersEl.hidden = prospSource === 'google';
  const smartFilters = document.getElementById('prosp-smart-filters');
  if (smartFilters) smartFilters.hidden = false;
  if (prospCountryEl) prospCountryEl.required = prospSource !== 'google';
  if (prospSourceSubEl) {
    prospSourceSubEl.textContent = prospSource === 'google'
      ? 'Знаходьте бізнеси через веб-пошук Google · корисно там, де OSM бідний на дані'
      : prospSource === 'both'
      ? 'Одночасно OSM + Google, з дедупом між джерелами · найповніший результат'
      : "Знаходьте бізнеси по світу та додавайте в роботу · дані OpenStreetMap";
  }
  if (prospHintEl) {
    prospHintEl.textContent = prospSource === 'google'
      ? 'Google-пошук повертає веб-сторінки, а не готовий реєстр бізнесів — назва підбирається евристично з заголовка сторінки. «Тільки платформа» = знайдено лише профіль на Facebook/Instagram/довіднику, власного сайту не видно.'
      : prospSource === 'both'
      ? 'Обидва джерела одночасно: результати об’єднуються і дедупляться (телефон → домен → назва+місто), сортуються за «гарячістю». Google-частина використовує типові налаштування (без розширених фільтрів нижче).'
      : 'Дані OpenStreetMap — community-джерело. Покриття краще в Європі; телефон/сайт присутні не завжди. Сигнали «схоже, немає…» орієнтовні.';
  }
  // Підказка «налаштувати ключ» — коли обрано Google/Обидва, але ключа немає.
  const setupEl = document.getElementById('prosp-google-setup');
  if (setupEl) setupEl.hidden = !((prospSource === 'google' || prospSource === 'both') && !prospGoogleConfigured);
}
if (prospTabOsm) prospTabOsm.addEventListener('click', () => setProspSource('osm'));
if (prospTabGoogle) prospTabGoogle.addEventListener('click', () => setProspSource('google'));
if (prospTabBoth) prospTabBoth.addEventListener('click', () => setProspSource('both'));
{
  const setupKeyBtn = document.getElementById('btn-prosp-setup-key');
  if (setupKeyBtn) setupKeyBtn.addEventListener('click', () => openIntegrationsView('search'));
}

function sortProspCandidates(list, sortMode) {
  const arr = list.slice();
  if (sortMode === 'name') {
    arr.sort((a, b) => (a.business_name || '').localeCompare(b.business_name || ''));
  } else if (sortMode === 'newest') {
    arr.sort((a, b) => {
      const am = a.opened ? a.opened.months_ago : Infinity;
      const bm = b.opened ? b.opened.months_ago : Infinity;
      return am - bm;
    });
  }
  return arr;
}

function selectedProspCategoryKeys() {
  return Array.from(prospCategoryEl?.selectedOptions || []).map(o => o.value).filter(Boolean);
}

function parsedProspLocations() {
  const raw = document.getElementById('prosp-locations')?.value || '';
  return raw.split(/\n+/).map(line => line.trim()).filter(Boolean).slice(0, 8).map(line => {
    const parts = line.split(/\s*[|;]\s*/);
    return { country: (parts[0] || '').trim(), city: (parts.slice(1).join(' ') || '').trim() };
  }).filter(item => item.country);
}

function currentProspLanguage() {
  return document.getElementById('prosp-language')?.value || document.getElementById('prosp-g-lang')?.value || 'en';
}

function selectedValues(id) {
  const el = document.getElementById(id);
  return el ? Array.from(el.selectedOptions || []).map(option => option.value).filter(Boolean) : [];
}

function gatherProspAdvancedFilters() {
  return {
    city_sizes: selectedValues('prosp-city-size'),
    zone_types: selectedValues('prosp-zone-type'),
    opening_status: document.getElementById('prosp-opening-status')?.value || 'any',
    recent_months: Number(document.getElementById('prosp-recent-months')?.value || 0),
    opening_month: Number(document.getElementById('prosp-opening-month')?.value || 0),
    opening_year: Number(document.getElementById('prosp-opening-year')?.value || 0),
    digital_modes: selectedValues('prosp-digital-mode'),
    filter_mode: document.getElementById('prosp-filter-mode')?.value || 'all',
    unknown_policy: document.getElementById('prosp-unknown-policy')?.value || 'exclude',
  };
}

function updateProspFilterExplain() {
  const f = gatherProspAdvancedFilters();
  const parts = [];
  if (f.city_sizes.length) parts.push(`${f.city_sizes.length} масштаби міста`);
  if (f.zone_types.length) parts.push(`${f.zone_types.length} профілі місцевості`);
  if (f.opening_status !== 'any') parts.push(`статус: ${f.opening_status}`);
  if (f.recent_months) parts.push(`за ${f.recent_months} міс.`);
  if (f.opening_month) parts.push(`місяць ${String(f.opening_month).padStart(2, '0')}`);
  if (f.opening_year) parts.push(`рік ${f.opening_year}`);
  if (f.digital_modes.length) parts.push(`${f.digital_modes.length} digital-умови`);
  const count = parts.length;
  const countEl = document.getElementById('prosp-smart-count');
  const explainEl = document.getElementById('prosp-filter-explain');
  if (countEl) countEl.textContent = count ? `${count} активних` : 'Не застосовано';
  if (explainEl) explainEl.textContent = count
    ? `Показувати кандидатів, які виконують ${f.filter_mode === 'all' ? 'усі' : 'хоча б одну'} умови: ${parts.join(' · ')}. Невідомі значення ${f.unknown_policy === 'include' ? 'не виключають кандидата' : 'виключають кандидата'}.`
    : 'Додаткові умови не застосовані.';
}

function applyProspAdvancedFilters(filters = {}) {
  const selectMany = (id, values) => {
    const el = document.getElementById(id);
    if (el) Array.from(el.options).forEach(option => { option.selected = (values || []).includes(option.value); });
  };
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value ?? ''; };
  selectMany('prosp-city-size', filters.city_sizes);
  selectMany('prosp-zone-type', filters.zone_types);
  selectMany('prosp-digital-mode', filters.digital_modes);
  set('prosp-opening-status', filters.opening_status || 'any');
  set('prosp-recent-months', String(filters.recent_months || 0));
  set('prosp-opening-month', String(filters.opening_month || 0));
  set('prosp-opening-year', filters.opening_year || '');
  set('prosp-filter-mode', filters.filter_mode || 'all');
  set('prosp-unknown-policy', filters.unknown_policy || 'exclude');
  updateProspFilterExplain();
}

async function runProspectingSearch(e) {
  if (e) e.preventDefault();
  const categoryKeys = selectedProspCategoryKeys();
  const country = document.getElementById('prosp-country')?.value.trim() || '';
  const city = document.getElementById('prosp-city')?.value.trim() || '';
  const locations = parsedProspLocations();
  const lang = currentProspLanguage();
  const customQuery = document.getElementById('prosp-g-custom')?.value.trim() || '';
  if (prospSource !== 'google' || !customQuery) {
    if (!categoryKeys.length) { showToast('Оберіть хоча б одну категорію.', true); return; }
  }
  const excludeExisting = !!document.getElementById('prosp-exclude-existing')?.checked;

  const discoveryDepth = document.getElementById('prosp-discovery-depth')?.value || 'standard';
  const commonJobParams = {
    category_keys: categoryKeys, country, city, locations, lang,
    discovery_depth: discoveryDepth,
    exclude_existing: excludeExisting,
  };
  if (locations.length > 1) {
    const advancedFilters = gatherProspAdvancedFilters();
    const qualifiers = Array.from(prospQualifiersEl?.querySelectorAll('.prosp-qualifier:checked') || []).map(cb => cb.value);
    const params = prospSource === 'google' ? {
      ...commonJobParams,
      advanced_filters: advancedFilters,
      custom_query: customQuery,
      exact_terms: document.getElementById('prosp-g-exact')?.value.trim() || '',
      exclude_terms: document.getElementById('prosp-g-exclude')?.value.trim() || '',
      gl: document.getElementById('prosp-g-gl')?.value.trim().toLowerCase() || '',
      date_restrict: document.getElementById('prosp-g-date')?.value || '',
      exclude_platforms: document.getElementById('prosp-g-exclude-platforms')?.checked !== false,
      limit: Number(document.getElementById('prosp-g-num')?.value || 20),
    } : {
      ...commonJobParams,
      qualifiers,
      advanced_filters: advancedFilters,
      limit: Number(document.getElementById('prosp-limit')?.value || 30),
    };
    await startProspBackgroundJob(prospSource, params);
    saveLastProspSearch();
    return;
  }

  const btn = document.getElementById('btn-prosp-search');
  if (btn) { btn.disabled = true; btn.textContent = 'Шукаю…'; }
  if (prospQuickFilterEl) prospQuickFilterEl.value = '';

  if (prospSource === 'google') {
    if (!customQuery && !country && !city && !locations.length) { showToast('Вкажіть країну, місто або список локацій.', true); if (btn) { btn.disabled = false; btn.textContent = 'Шукати'; } return; }
    renderProspLoading('Перевіряю веб-видачу, прибираю сторінки-агрегатори та готую короткий список кандидатів.');
    try {
      const result = await api('POST', '/prospecting/search-google', {
        category_keys: categoryKeys, country, city, locations, custom_query: customQuery,
        discovery_depth: discoveryDepth,
        advanced_filters: gatherProspAdvancedFilters(),
        exact_terms: document.getElementById('prosp-g-exact')?.value.trim() || '',
        exclude_terms: document.getElementById('prosp-g-exclude')?.value.trim() || '',
        gl: document.getElementById('prosp-g-gl')?.value.trim().toLowerCase() || '',
        lang,
        date_restrict: document.getElementById('prosp-g-date')?.value || '',
        exclude_platforms: document.getElementById('prosp-g-exclude-platforms')?.checked !== false,
        exclude_existing: excludeExisting,
        limit: Number(document.getElementById('prosp-g-num')?.value || 20),
      }, { timeoutMs: 30000 });
      renderProspResults(result);
      saveLastProspSearch();
    } catch (err) {
      renderProspError(err);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Шукати'; }
      loadProspSearchRuns().catch(() => {});
    }
    return;
  }

  if (!country && !locations.length) { showToast('Вкажіть країну або додайте список локацій.', true); if (btn) { btn.disabled = false; btn.textContent = 'Шукати'; } return; }
  const advancedFilters = gatherProspAdvancedFilters();
  const qualifiers = Array.from(prospQualifiersEl?.querySelectorAll('.prosp-qualifier:checked') || [])
    .map(cb => cb.value);
  const limit = Number(document.getElementById('prosp-limit')?.value || 30);
  const sortMode = document.getElementById('prosp-sort')?.value || 'default';

  if (prospSource === 'both') {
    renderProspLoading('Збираю OSM і Google в один список, дедуплюю за телефоном, доменом і назвою.');
    try {
      const result = await api('POST', '/prospecting/search-both', {
        category_keys: categoryKeys, country, city, locations, lang, qualifiers,
        discovery_depth: discoveryDepth,
        advanced_filters: advancedFilters, limit, exclude_existing: excludeExisting,
      }, { timeoutMs: 70000 });
      if (result.osm_error) showToast(`OSM: ${result.osm_error}`, true);
      if (result.google_error) showToast(`Google: ${result.google_error}`, true);
      renderProspResults(result);
      saveLastProspSearch();
    } catch (err) {
      renderProspError(err);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Шукати'; }
      loadProspSearchRuns().catch(() => {});
    }
    return;
  }

  renderProspLoading('Шукаю в OpenStreetMap. Якщо місто велике, краще тримати ліміт 20-30 для стабільної відповіді.');
  try {
    const result = await api('POST', '/prospecting/search', {
      category_keys: categoryKeys, country, city, locations, lang, qualifiers,
      advanced_filters: advancedFilters, limit, exclude_existing: excludeExisting,
    }, { timeoutMs: 70000 });
    result.candidates = sortProspCandidates(result.candidates || [], sortMode);
    renderProspResults(result);
    saveLastProspSearch();
  } catch (err) {
    renderProspError(err);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Шукати'; }
    loadProspSearchRuns().catch(() => {});
  }
}

function gatherProspFilters() {
  const excludeExisting = !!document.getElementById('prosp-exclude-existing')?.checked;
  const locations = parsedProspLocations();
  const lang = currentProspLanguage();
  if (prospSource === 'google') {
    return {
      category_keys: selectedProspCategoryKeys(),
      country: document.getElementById('prosp-country')?.value.trim() || '',
      city: document.getElementById('prosp-city')?.value.trim() || '',
      locations,
      locations_text: document.getElementById('prosp-locations')?.value || '',
      market_lang: lang,
      discovery_depth: document.getElementById('prosp-discovery-depth')?.value || 'standard',
      custom_query: document.getElementById('prosp-g-custom')?.value.trim() || '',
      exact_terms: document.getElementById('prosp-g-exact')?.value.trim() || '',
      exclude_terms: document.getElementById('prosp-g-exclude')?.value.trim() || '',
      gl: document.getElementById('prosp-g-gl')?.value.trim() || '',
      lang,
      date_restrict: document.getElementById('prosp-g-date')?.value || '',
      exclude_platforms: document.getElementById('prosp-g-exclude-platforms')?.checked !== false,
      exclude_existing: excludeExisting,
      advanced_filters: gatherProspAdvancedFilters(),
      num: document.getElementById('prosp-g-num')?.value || '20',
    };
  }
  return {
    category_keys: selectedProspCategoryKeys(),
    country: document.getElementById('prosp-country')?.value.trim() || '',
    city: document.getElementById('prosp-city')?.value.trim() || '',
    locations,
    locations_text: document.getElementById('prosp-locations')?.value || '',
    market_lang: lang,
    discovery_depth: document.getElementById('prosp-discovery-depth')?.value || 'standard',
    qualifiers: Array.from(prospQualifiersEl?.querySelectorAll('.prosp-qualifier:checked') || []).map(cb => cb.value),
    advanced_filters: gatherProspAdvancedFilters(),
    exclude_existing: excludeExisting,
    limit: document.getElementById('prosp-limit')?.value || '30',
    sort: document.getElementById('prosp-sort')?.value || 'default',
  };
}

function applyProspFilters(source, params) {
  setProspSource(source);
  if (prospCategoryEl) {
    const keys = params.category_keys || (params.category_key ? [params.category_key] : []);
    Array.from(prospCategoryEl.options).forEach(o => { o.selected = keys.includes(o.value); });
  }
  const countryEl = document.getElementById('prosp-country');
  const cityEl = document.getElementById('prosp-city');
  if (countryEl) countryEl.value = params.country || '';
  if (cityEl) cityEl.value = params.city || '';
  const locationsEl = document.getElementById('prosp-locations');
  if (locationsEl) locationsEl.value = params.locations_text || (params.locations || []).map(item => `${item.country}${item.city ? ` | ${item.city}` : ''}`).join('\n');
  const languageEl = document.getElementById('prosp-language');
  if (languageEl) languageEl.value = params.market_lang || params.lang || 'en';
  const discoveryDepthEl = document.getElementById('prosp-discovery-depth');
  if (discoveryDepthEl) discoveryDepthEl.value = params.discovery_depth || 'standard';
  const exclExistingEl = document.getElementById('prosp-exclude-existing');
  if (exclExistingEl) exclExistingEl.checked = !!params.exclude_existing;
  if (source === 'google') {
    applyProspAdvancedFilters(params.advanced_filters || {});
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
    set('prosp-g-custom', params.custom_query);
    set('prosp-g-exact', params.exact_terms);
    set('prosp-g-exclude', params.exclude_terms);
    set('prosp-g-gl', params.gl);
    set('prosp-g-lang', params.lang);
    set('prosp-g-date', params.date_restrict);
    set('prosp-g-num', params.num || '20');
    const excl = document.getElementById('prosp-g-exclude-platforms');
    if (excl) excl.checked = params.exclude_platforms !== false;
  } else {
    applyProspAdvancedFilters(params.advanced_filters || (params.recent ? { recent_months: 12, opening_status: 'recent' } : {}));
    const limitEl = document.getElementById('prosp-limit');
    if (limitEl) limitEl.value = params.limit || '30';
    const sortEl = document.getElementById('prosp-sort');
    if (sortEl) sortEl.value = params.sort || 'default';
    prospQualifiersEl?.querySelectorAll('.prosp-qualifier').forEach(cb => {
      cb.checked = (params.qualifiers || []).includes(cb.value);
    });
  }
}

function saveLastProspSearch() {
  try {
    localStorage.setItem(PROSP_LAST_SEARCH_KEY, JSON.stringify({ source: prospSource, params: gatherProspFilters() }));
  } catch (err) { /* localStorage недоступний (приватний режим тощо) — не критично */ }
}

function setProspSearchButtonBusy(busy) {
  const btn = document.getElementById('btn-prosp-search');
  if (!btn) return;
  btn.disabled = busy;
  btn.textContent = busy ? 'Пошук триває…' : 'Шукати';
}

function stopProspJobPolling() {
  if (prospJobPollTimer) window.clearTimeout(prospJobPollTimer);
  prospJobPollTimer = null;
}

function renderProspJob(job) {
  if (!prospJobPanelEl || !job) return;
  activeProspJob = job;
  prospJobPanelEl.hidden = false;
  const status = job.status || 'queued';
  const done = Number(job.completed_locations || 0);
  const total = Number(job.total_locations || 0);
  const progress = Math.max(0, Math.min(100, Number(job.progress || 0)));
  const errors = job.error_data || [];
  const result = job.result_data || {};
  const candidates = result.candidates || [];
  const terminal = ['completed', 'partial', 'error', 'cancelled'].includes(status);
  const statusCopy = {
    queued: ['У черзі', 'Підготовка фонового пошуку'],
    running: [job.parent_job_id ? 'Повторюю невдалі' : 'Пошук триває', `Опрацьовано ${done} з ${total} локацій`],
    completed: ['Готово', 'Усі локації опрацьовано'],
    partial: ['Потрібна увага', 'Результати готові, але частина локацій не відповіла'],
    error: ['Пошук не завершено', 'Жодна локація не повернула результат'],
    cancelled: ['Скасовано', candidates.length ? 'Збережено вже знайдені результати' : 'Пошук зупинено'],
  }[status] || ['Фоновий пошук', 'Оновлюю стан'];
  if (prospJobKickerEl) prospJobKickerEl.textContent = statusCopy[0];
  if (prospJobTitleEl) prospJobTitleEl.textContent = statusCopy[1];
  if (prospJobDetailEl) prospJobDetailEl.textContent = terminal
    ? (errors[0]?.message || 'Можна перейти до результатів або запустити новий пошук.')
    : (job.current_location
      ? `${job.current_location} · спроба ${Number(job.current_attempt || 1)} з 2`
      : 'Можна працювати в інших розділах CRM — цей процес продовжиться у фоні.');
  if (prospJobProgressBarEl) prospJobProgressBarEl.style.transform = `scaleX(${progress / 100})`;
  const progressEl = prospJobPanelEl.querySelector('.prosp-job-progress');
  if (progressEl) progressEl.setAttribute('aria-valuenow', String(progress));
  if (prospJobLocationsEl) prospJobLocationsEl.textContent = `${done} / ${total} локацій`;
  if (prospJobResultsEl) prospJobResultsEl.textContent = `${candidates.length} кандидатів${job.parent_job_id ? ' разом' : ''}`;
  if (prospJobErrorsEl) prospJobErrorsEl.textContent = errors.length ? `${errors.length} помилок` : 'Без помилок';
  if (btnProspJobCancel) btnProspJobCancel.hidden = terminal;
  if (btnProspJobRetry) btnProspJobRetry.hidden = !terminal || !errors.length;
  if (btnProspJobResults) btnProspJobResults.hidden = !candidates.length;
  setProspSearchButtonBusy(!terminal);
  prospJobPanelEl.dataset.status = status;
}

function showProspJobResults() {
  const result = activeProspJob?.result_data;
  if (!result) return;
  renderProspResults(result, activeProspJob?.source || prospSource);
  prospResultsEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function pollProspJob(jobId) {
  stopProspJobPolling();
  try {
    const job = await api('GET', `/prospecting/search-jobs/${jobId}`);
    renderProspJob(job);
    const terminal = ['completed', 'partial', 'error', 'cancelled'].includes(job.status);
    if (terminal) {
      localStorage.removeItem(PROSP_ACTIVE_JOB_KEY);
      if ((job.result_data?.candidates || []).length) showProspJobResults();
      loadProspSearchRuns().catch(() => {});
      return;
    }
    prospJobPollTimer = window.setTimeout(() => pollProspJob(jobId), 1400);
  } catch (err) {
    setProspSearchButtonBusy(false);
    if (prospJobDetailEl) prospJobDetailEl.textContent = 'Не вдалося оновити прогрес. Повторюю з’єднання…';
    prospJobPollTimer = window.setTimeout(() => pollProspJob(jobId), 3500);
  }
}

async function startProspBackgroundJob(source, params) {
  setProspSearchButtonBusy(true);
  renderProspLoading(`Запускаю фоновий пошук у ${params.locations.length} локаціях.`);
  try {
    const job = await api('POST', '/prospecting/search-jobs', { source, params });
    localStorage.setItem(PROSP_ACTIVE_JOB_KEY, String(job.id));
    renderProspJob(job);
    pollProspJob(job.id);
  } catch (err) {
    setProspSearchButtonBusy(false);
    renderProspError(err);
  }
}

async function restoreActiveProspJob() {
  const storedJobId = Number(localStorage.getItem(PROSP_ACTIVE_JOB_KEY) || 0);
  if (storedJobId) {
    pollProspJob(storedJobId);
    return;
  }
  try {
    const jobs = await api('GET', '/prospecting/search-jobs?limit=8');
    const active = (jobs || []).find(job => ['queued', 'running'].includes(job.status));
    if (!active) return;
    localStorage.setItem(PROSP_ACTIVE_JOB_KEY, String(active.id));
    renderProspJob(active);
    pollProspJob(active.id);
  } catch (err) {
    // The discovery workspace still works without restoring old jobs.
  }
}

btnProspJobCancel?.addEventListener('click', async () => {
  if (!activeProspJob?.id) return;
  btnProspJobCancel.disabled = true;
  try {
    const job = await api('POST', `/prospecting/search-jobs/${activeProspJob.id}/cancel`, {});
    renderProspJob(job);
  } catch (err) {
    showToast(err.message || 'Не вдалося скасувати пошук.', true);
  } finally {
    btnProspJobCancel.disabled = false;
  }
});

btnProspJobRetry?.addEventListener('click', async () => {
  if (!activeProspJob?.id) return;
  btnProspJobRetry.disabled = true;
  try {
    const job = await api('POST', `/prospecting/search-jobs/${activeProspJob.id}/retry-errors`, {});
    localStorage.setItem(PROSP_ACTIVE_JOB_KEY, String(job.id));
    renderProspJob(job);
    pollProspJob(job.id);
  } catch (err) {
    showToast(err.message || 'Не вдалося повторити невдалі локації.', true);
  } finally {
    btnProspJobRetry.disabled = false;
  }
});
btnProspJobResults?.addEventListener('click', showProspJobResults);

function restoreLastProspSearch() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(PROSP_LAST_SEARCH_KEY) || 'null'); } catch (err) { saved = null; }
  if (saved && saved.params) applyProspFilters(saved.source || 'osm', saved.params);
}

async function loadSavedSearches() {
  try {
    prospSavedSearches = await api('GET', '/prospecting/saved-searches');
  } catch (err) {
    prospSavedSearches = [];
  }
  renderSavedChips();
}

function prospRunLocation(params) {
  const locations = params.locations || [];
  if (locations.length > 1) return `${locations.length} локацій`;
  const first = locations[0] || params;
  return [first.city, first.country].filter(Boolean).join(', ') || 'Без локації';
}

function prospRunCategories(params) {
  const keys = params.category_keys || [];
  const labels = keys.map(key => prospCategoryEl?.querySelector(`option[value="${CSS.escape(key)}"]`)?.textContent || key);
  return labels.slice(0, 2).join(', ') + (labels.length > 2 ? ` +${labels.length - 2}` : '') || params.custom_query || 'Власний запит';
}

async function loadProspSearchRuns() {
  if (!prospHistoryListEl) return;
  const runs = await api('GET', '/prospecting/search-runs?limit=12');
  if (prospHistoryCountEl) prospHistoryCountEl.textContent = String(runs.length || 0);
  if (!runs.length) {
    prospHistoryListEl.innerHTML = '<p class="prosp-history-empty">Історія з\'явиться після першого пошуку.</p>';
    return;
  }
  prospHistoryListEl.innerHTML = runs.map(run => {
    const params = run.params || {};
    const statusLabel = run.status === 'success' ? 'Готово' : run.status === 'partial' ? 'Частково' : 'Помилка';
    const d = new Date(run.created_at);
    const when = Number.isNaN(d.getTime()) ? '' : `${formatDate(d)} · ${formatTimeFromDate(d)}`;
    return `
      <article class="prosp-history-item prosp-history-${escHtml(run.status)}" data-id="${run.id}">
        <span class="prosp-history-status">${statusLabel}</span>
        <div class="prosp-history-main">
          <strong>${escHtml(prospRunCategories(params))}</strong>
          <small>${escHtml(prospRunLocation(params))} · ${escHtml(prospSourceLabel(run.source))}</small>
          ${run.error_text ? `<em>${escHtml(run.error_text)}</em>` : ''}
        </div>
        <div class="prosp-history-meta">
          <b>${Number(run.result_count || 0)}</b><small>результатів</small>
          <span>${Math.max(0, Number(run.duration_ms || 0) / 1000).toFixed(1)} с</span>
        </div>
        <div class="prosp-history-actions">
          <span>${escHtml(when)}</span>
          <button type="button" data-prosp-run="${run.id}">Повторити</button>
        </div>
      </article>`;
  }).join('');
  prospHistoryListEl.querySelectorAll('[data-prosp-run]').forEach(btnEl => {
    btnEl.addEventListener('click', () => {
      const run = runs.find(item => String(item.id) === btnEl.dataset.prospRun);
      if (!run) return;
      applyProspFilters(run.source || 'osm', run.params || {});
      runProspectingSearch();
    });
  });
}

const PROSP_SOURCE_ICONS = { google: 'G', both: 'G+O', osm: 'OSM' };
const PROSP_SCHEDULE_CYCLE = { off: 'daily', daily: 'weekly', weekly: 'off' };
const PROSP_SCHEDULE_LABEL = { off: 'Вимкн.', daily: 'Щодня', weekly: 'Щотижня' };

function renderSavedChips() {
  if (!prospSavedRowEl || !prospSavedChipsEl) return;
  if (!prospSavedSearches.length) { prospSavedRowEl.hidden = true; prospSavedChipsEl.innerHTML = ''; return; }
  prospSavedRowEl.hidden = false;
  prospSavedChipsEl.innerHTML = prospSavedSearches.map(s => {
    const schedule = s.schedule || 'off';
    return `
    <span class="prosp-saved-chip" data-id="${s.id}">
      <button type="button" class="prosp-saved-chip-load" data-id="${s.id}">${PROSP_SOURCE_ICONS[s.source] || 'OSM'} · ${escHtml(s.name)}</button>
      <button type="button" class="prosp-saved-chip-schedule" data-id="${s.id}" data-schedule="${schedule}" title="Авто-перезапуск і сповіщення про нові результати — клік перемикає режим">${PROSP_SCHEDULE_LABEL[schedule]}</button>
      <button type="button" class="prosp-saved-chip-del" data-id="${s.id}" title="Видалити">✕</button>
    </span>
  `;
  }).join('');
  prospSavedChipsEl.querySelectorAll('.prosp-saved-chip-load').forEach(btnEl => {
    btnEl.addEventListener('click', () => {
      const saved = prospSavedSearches.find(s => String(s.id) === btnEl.dataset.id);
      if (!saved) return;
      applyProspFilters(saved.source, saved.params || {});
      runProspectingSearch();
    });
  });
  prospSavedChipsEl.querySelectorAll('.prosp-saved-chip-schedule').forEach(btnEl => {
    btnEl.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const next = PROSP_SCHEDULE_CYCLE[btnEl.dataset.schedule] || 'off';
      try {
        await api('PATCH', `/prospecting/saved-searches/${btnEl.dataset.id}`, { schedule: next });
        if (next !== 'off') showToast(`Авто-перезапуск: ${next === 'daily' ? 'щодня' : 'щотижня'}. Нові результати з'являться в «Планувальнику».`);
        await loadSavedSearches();
      } catch (err) {
        showToast(err.message || 'Не вдалося змінити розклад.', true);
      }
    });
  });
  prospSavedChipsEl.querySelectorAll('.prosp-saved-chip-del').forEach(btnEl => {
    btnEl.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      try {
        await api('DELETE', `/prospecting/saved-searches/${btnEl.dataset.id}`);
        await loadSavedSearches();
      } catch (err) {
        showToast(err.message || 'Не вдалося видалити.', true);
      }
    });
  });
}

async function saveCurrentSearch() {
  const name = (window.prompt('Назва для цього пошуку (напр. «Перукарні Польща»):') || '').trim();
  if (!name) return;
  if (btnProspSave) { btnProspSave.disabled = true; }
  try {
    await api('POST', '/prospecting/saved-searches', { name, source: prospSource, params: gatherProspFilters() });
    showToast('Пошук збережено.');
    await loadSavedSearches();
  } catch (err) {
    showToast(err.message || 'Не вдалося зберегти пошук.', true);
  } finally {
    if (btnProspSave) { btnProspSave.disabled = false; }
  }
}
if (btnProspSave) btnProspSave.addEventListener('click', saveCurrentSearch);

if (prospQuickFilterEl) prospQuickFilterEl.addEventListener('input', () => {
  const q = prospQuickFilterEl.value.trim().toLowerCase();
  prospResultsEl?.querySelectorAll('.prosp-card').forEach(card => {
    card.style.display = (!q || (card.dataset.search || '').includes(q)) ? '' : 'none';
  });
});

async function importProspCandidates() {
  const selected = selectedProspCandidates();
  if (!selected.length) return;
  const owner = document.getElementById('prosp-owner')?.value || LEADS_OWNER_OPTIONS[0];
  const country = document.getElementById('prosp-country')?.value.trim() || '';
  const payload = selected.map(c => ({ ...c, country }));
  if (btnProspImport) { btnProspImport.disabled = true; btnProspImport.textContent = 'Перевіряю…'; }
  try {
    const preview = await api('POST', '/prospecting/import-preview', { candidates: payload, owner });
    renderProspImportPreview(preview, payload);
  } catch (err) {
    showToast(err.message || 'Не вдалося перевірити кандидатів.', true);
  } finally {
    if (btnProspImport) { btnProspImport.disabled = false; btnProspImport.textContent = 'Перевірити і додати'; }
  }
}

async function commitProspImport(payload) {
  if (!payload.length) return;
  const owner = document.getElementById('prosp-owner')?.value || LEADS_OWNER_OPTIONS[0];
  const confirmBtn = document.getElementById('btn-prosp-preview-confirm');
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Додаю…'; }
  try {
    const res = await api('POST', '/prospecting/import', { candidates: payload, owner });
    let msg = `Додано ${res.created} лід(ів).`;
    if (res.skipped) msg += ` Пропущено дублікатів: ${res.skipped}.`;
    showToast(msg);
    // Uncheck imported rows and refresh the leads badge count.
    prospResultsEl?.querySelectorAll('.prosp-select:checked').forEach(cb => { cb.checked = false; });
    updateProspImportBar();
    loadLeadsStats().catch(() => {});
  } catch (err) {
    showToast(err.message || 'Не вдалося додати лідів.', true);
  } finally {
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = `Додати ${payload.length} нових`; }
  }
}

if (btnProspecting) btnProspecting.addEventListener('click', () => {
  if (prospectingView && !prospectingView.hidden) closeProspectingView();
  else openProspectingView();
});
if (btnProspectingBack) btnProspectingBack.addEventListener('click', closeProspectingView);
if (prospectingForm) prospectingForm.addEventListener('submit', runProspectingSearch);
document.getElementById('prosp-smart-filters')?.querySelectorAll('select, input').forEach(control => {
  control.addEventListener('change', updateProspFilterExplain);
  control.addEventListener('input', updateProspFilterExplain);
});
updateProspFilterExplain();
if (openingsEntry) openingsEntry.addEventListener('click', openOpeningsView);
if (btnOpeningsBack) btnOpeningsBack.addEventListener('click', closeOpeningsView);
for (const control of [openingsMonthEl, openingsCityTierEl, openingsCountryEl, openingsCategoryEl, openingsVerificationEl]) {
  if (control) control.addEventListener('change', () => loadOpenings(1));
}
if (openingsSearchEl) openingsSearchEl.addEventListener('input', () => {
  clearTimeout(openingsSearchTimer);
  openingsSearchTimer = setTimeout(() => loadOpenings(1), 280);
});
if (openingsPaginationEl) openingsPaginationEl.addEventListener('click', event => {
  const button = event.target.closest('[data-opening-page]');
  if (button && !button.disabled) loadOpenings(Number(button.dataset.openingPage || 1));
});
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
    <section class="integration-channel ${connected ? 'is-connected' : ''} ${hasError ? 'has-error' : ''}" data-manager="${escHtml(item.manager)}" data-channel="${escHtml(item.channel)}">
      <div class="integration-card-top">
        <div class="integration-channel-name"><span class="integration-channel-mark">${meta.mark}</span><div><strong>${meta.label}</strong><small>${meta.idLabel}</small></div></div>
        <span class="integration-status ${hasError ? 'error' : (connected ? 'on' : 'off')}" title="${dotTitle}">${hasError ? 'Потрібна увага' : (connected ? 'Підключено' : 'Не підключено')}</span>
      </div>
      ${connected ? `
        <div class="integration-card-connected">
          <div class="integration-card-display">${escHtml(item.display_label || item.external_id)}</div>
          <div class="integration-card-token">ID ${escHtml(item.external_id)} · токен ${escHtml(item.token_preview)}</div>
          ${hasError ? '<div class="integration-card-error">Meta відхилила останню перевірку. Оновіть токен або перепідключіть канал.</div>' : ''}
          <div class="integration-card-sig ${item.signature_verified ? 'ok' : 'warn'}">
            ${item.signature_verified ? 'Підпис webhook захищено' : 'Додайте App Secret для перевірки підпису'}
          </div>
        </div>
        <div class="integration-card-actions">
          <button type="button" class="integration-check-btn">Перевірити доступ</button>
          <button type="button" class="integration-disconnect-btn">Відключити</button>
        </div>
      ` : `
        <form class="integration-connect-form">
          <label><span>${meta.idLabel}</span><input class="integration-input-id" placeholder="${meta.idPlaceholder}" inputmode="numeric" autocomplete="off" required/></label>
          <label><span>Access Token</span><input class="integration-input-token" type="password" placeholder="Вставте постійний токен Meta" autocomplete="new-password" required/></label>
          <details class="integration-secret-details">
            <summary>Захист webhook <span>рекомендовано</span></summary>
            <label><span>App Secret</span><input class="integration-input-secret" type="password" placeholder="З Meta App → Settings → Basic" autocomplete="new-password"/></label>
          </details>
          <div class="integration-connect-footer"><small>Перед збереженням CRM перевірить ID і токен реальним запитом до Meta.</small><button type="submit" class="btn-primary">Перевірити й підключити</button></div>
        </form>
      `}
    </section>
  `;
}

function renderIntegrationsReadiness(connectedCount, total) {
  if (!integrationsReadinessEl) return;
  const state = total === 0 ? 'empty' : connectedCount === 0 ? 'empty' : connectedCount === total ? 'complete' : 'partial';
  integrationsReadinessEl.className = `integrations-readiness is-${state}`;
  const segs = total > 0
    ? Array.from({ length: total }, (_, i) => `<span class="integrations-readiness-seg${i < connectedCount ? ' is-done' : ''}"></span>`).join('')
    : '';
  integrationsReadinessEl.innerHTML = `
    <div class="integrations-readiness-value"><strong>${connectedCount}/${total}</strong><span>каналів готово</span></div>
    ${segs ? `<div class="integrations-readiness-bar" role="progressbar" aria-valuenow="${connectedCount}" aria-valuemin="0" aria-valuemax="${total}">${segs}</div>` : ''}
  `;
}

function renderIntegrationsGrid(items) {
  if (!integrationsGridEl) return;
  if (!items || !items.length) {
    renderIntegrationsReadiness(0, 0);
    integrationsGridEl.innerHTML = '<p class="leads-empty">Немає даних.</p>';
    return;
  }
  const connectedCount = items.filter(item => item.status === 'connected').length;
  renderIntegrationsReadiness(connectedCount, items.length);
  const managers = Array.from(new Map(items.map(item => [item.manager, item.manager_label])).entries());
  integrationsGridEl.innerHTML = managers.map(([manager, label]) => {
    const managerItems = items.filter(item => item.manager === manager);
    const ready = managerItems.filter(item => item.status === 'connected').length;
    return `<article class="integration-manager" data-manager-row="${escHtml(manager)}">
      <header class="integration-manager-head">
        <div class="integration-manager-avatar">${escHtml(String(label || manager).replace('Менеджер ', '').slice(0, 1))}</div>
        <div><h4>${escHtml(label)}</h4><p>${ready === 2 ? 'Обидва канали готові до роботи' : ready === 1 ? 'Підключено один із двох каналів' : 'Підключення ще не налаштовані'}</p></div>
        <span class="integration-manager-progress ${ready === 2 ? 'complete' : ''}">${ready}/2</span>
      </header>
      <div class="integration-manager-channels">${managerItems.map(integrationCardHtml).join('')}</div>
    </article>`;
  }).join('');

  integrationsGridEl.querySelectorAll('.integration-channel').forEach(card => {
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
          const managerLabel = card.closest('.integration-manager')?.querySelector('h4')?.textContent || manager;
          showToast(`${meta.label} підключено для ${managerLabel}.`);
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
        if (!window.confirm(`Відключити ${meta.label}? Нові повідомлення цього менеджера не надходитимуть у CRM.`)) return;
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
  const location = [lead.city_area, lead.country].filter(Boolean).join(', ');
  const due = String(lead.next_followup_date || '').slice(0, 10);
  const today = localIsoDate();
  const dueClass = due && due < today ? 'is-overdue' : (due === today ? 'is-today' : '');
  const dueLabel = due ? (due < today ? `Прострочено · ${due}` : (due === today ? 'Дія сьогодні' : `Наступна дія · ${due}`)) : 'Дату не заплановано';
  return `
    <article class="leads-kanban-card" data-lead-id="${lead.id}" draggable="true" tabindex="0" aria-label="${escHtml(lead.business_name || 'Лід')}">
      <div class="leads-kanban-card-top">
        <span class="leads-kanban-card-avatar" aria-hidden="true">${escHtml(initial(lead.business_name || '?'))}</span>
        <div class="leads-kanban-card-heading">
          <div class="leads-kanban-card-name">${channelIcon(lead.primary_channel)}${escHtml(lead.business_name || '')}</div>
          <div class="leads-kanban-card-location">${escHtml(location || lead.category || 'Деталі не вказані')}</div>
        </div>
        <span class="leads-kanban-card-score">${Number(lead.lead_score || 0)}</span>
      </div>
      <div class="leads-kanban-card-owner">
        <span class="leads-badge leads-badge-owner-${escHtml(leadsSlug(lead.owner))}">${escHtml(leadsLabel(LEADS_OWNER_LABELS, lead.owner) || '—')}</span>
        <span class="leads-badge leads-badge-${escHtml(lead.priority || 'Medium')}">${escHtml(leadsLabel(LEADS_PRIORITY_LABELS, lead.priority))}</span>
        ${leadOutreachBadgeHtml(lead)}
      </div>
      <div class="leads-kanban-card-foot">
        <span class="leads-kanban-due ${dueClass}">${escHtml(dueLabel)}</span>
        <select class="leads-pill-select leads-kanban-stage-select" aria-label="Стадія ліда" title="Змінити етап">${optSel}</select>
      </div>
    </article>
  `;
}

function renderLeadsKanban(stats, items) {
  const previousScrollLeft = leadsKanbanColumnsEl.scrollLeft;
  const filteredItems = items.filter(lead => {
    if (kanbanState.owner && lead.owner !== kanbanState.owner) return false;
    if (kanbanState.priority && lead.priority !== kanbanState.priority) return false;
    if (kanbanState.search) {
      const haystack = [lead.business_name, lead.city_area, lead.country, lead.category].join(' ').toLowerCase();
      if (!haystack.includes(kanbanState.search)) return false;
    }
    return true;
  });
  const statStages = (stats.by_stage || []).map(s => s.stage).filter(Boolean);
  const allStageOptions = Array.from(new Set([...statStages, ...LEADS_STAGE_OPTIONS]));
  const byStage = new Map();
  allStageOptions.forEach(s => byStage.set(s, []));
  filteredItems.forEach(lead => {
    const s = lead.stage || 'New';
    if (!byStage.has(s)) byStage.set(s, []);
    byStage.get(s).push(lead);
  });
  // Фіксований порядок стадій воронки (не сортуємо за кількістю — інакше колонки
  // "стрибають" місцями після кожної зміни стадії, і дошку важко читати).
  const orderedStages = LEADS_STAGE_OPTIONS.filter(s => byStage.has(s))
    .concat([...byStage.keys()].filter(s => !LEADS_STAGE_OPTIONS.includes(s)));

  const today = localIsoDate();
  const active = filteredItems.filter(lead => !['Won', 'Lost'].includes(lead.stage)).length;
  const hot = filteredItems.filter(lead => ['Hot', 'High'].includes(lead.priority)).length;
  const due = filteredItems.filter(lead => {
    const value = String(lead.next_followup_date || '').slice(0, 10);
    return value && value <= today && !['Won', 'Lost'].includes(lead.stage);
  }).length;
  const won = filteredItems.filter(lead => lead.stage === 'Won').length;
  if (kanbanHeaderSummaryEl) kanbanHeaderSummaryEl.textContent = `${filteredItems.length} із ${items.length} лідів · ${orderedStages.length} етапів`;
  if (kanbanOverviewEl) {
    kanbanOverviewEl.innerHTML = [
      ['active', 'В роботі', active], ['hot', 'Гарячі', hot],
      ['due', 'Потребують дії', due], ['won', 'Успішно', won],
    ].map(([key, label, value]) => `<div class="kanban-overview-tile is-${key}"><span>${label}</span><strong>${value}</strong></div>`).join('');
  }

  leadsKanbanColumnsEl.innerHTML = orderedStages.map(stage => {
    const stageItems = byStage.get(stage);
    const limit = kanbanState.stageLimits[stage] || KANBAN_STAGE_BATCH;
    const visibleItems = stageItems.slice(0, limit);
    const remaining = Math.max(0, stageItems.length - visibleItems.length);
    const share = filteredItems.length ? Math.round((stageItems.length / filteredItems.length) * 100) : 0;
    return `
      <div class="leads-kanban-column leads-kanban-column-${escHtml(leadsSlug(stage).toLowerCase())}" data-stage="${escHtml(stage)}">
        <div class="leads-kanban-column-head">
          <span class="leads-kanban-column-copy">
            <span class="leads-kanban-column-title">${escHtml(leadsLabel(LEADS_STAGE_LABELS, stage))}</span>
            <small>${share}% воронки</small>
          </span>
          <span class="leads-kanban-column-count">${stageItems.length}</span>
        </div>
        <div class="leads-kanban-cards">
          ${stageItems.length ? visibleItems.map(lead => leadsKanbanCardHtml(lead, allStageOptions)).join('') : '<div class="leads-kanban-empty-stage"><strong>Поки порожньо</strong><span>Перетягніть сюди потрібний лід</span></div>'}
          ${remaining ? `<button type="button" class="kanban-load-more" data-kanban-more="${escHtml(stage)}">Показати ще ${Math.min(KANBAN_STAGE_BATCH, remaining)}<span>${remaining} залишилось</span></button>` : ''}
        </div>
      </div>`;
  }).join('');
  leadsKanbanColumnsEl.scrollLeft = previousScrollLeft;

  leadsKanbanColumnsEl.querySelectorAll('[data-kanban-more]').forEach(button => {
    button.addEventListener('click', () => {
      const stage = button.dataset.kanbanMore || '';
      kanbanState.stageLimits[stage] = (kanbanState.stageLimits[stage] || KANBAN_STAGE_BATCH) + KANBAN_STAGE_BATCH;
      renderLeadsKanban(kanbanState.stats, kanbanState.items);
    });
  });

  leadsKanbanColumnsEl.querySelectorAll('.leads-kanban-card').forEach(card => {
    const leadId = Number(card.dataset.leadId);
    card.addEventListener('click', event => {
      if (event.target.closest('select')) return;
      openLeadDetail(leadId);
    });
    card.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('select')) {
        event.preventDefault();
        openLeadDetail(leadId);
      }
    });
    card.addEventListener('dragstart', event => {
      card.classList.add('is-dragging');
      event.dataTransfer?.setData('text/plain', String(leadId));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('is-dragging');
      leadsKanbanColumnsEl.querySelectorAll('.is-drop-target').forEach(column => column.classList.remove('is-drop-target'));
    });
    card.querySelector('.leads-kanban-stage-select')?.addEventListener('change', async e => {
      try {
        await api('PATCH', `/leads/${leadId}`, { stage: e.target.value });
        const lead = kanbanState.items.find(item => Number(item.id) === leadId);
        if (lead) lead.stage = e.target.value;
        showToast('Стадію оновлено.');
        renderLeadsKanban(kanbanState.stats, kanbanState.items);
      } catch (err) {
        showToast(err.message || 'Не вдалося оновити стадію.', true);
      }
    });
  });
  leadsKanbanColumnsEl.querySelectorAll('.leads-kanban-column').forEach(column => {
    column.addEventListener('dragover', event => {
      event.preventDefault();
      column.classList.add('is-drop-target');
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    });
    column.addEventListener('dragleave', event => {
      if (!column.contains(event.relatedTarget)) column.classList.remove('is-drop-target');
    });
    column.addEventListener('drop', async event => {
      event.preventDefault();
      column.classList.remove('is-drop-target');
      const leadId = Number(event.dataTransfer?.getData('text/plain'));
      const stage = column.dataset.stage || '';
      const lead = kanbanState.items.find(item => Number(item.id) === leadId);
      if (!lead || !stage || lead.stage === stage) return;
      const previous = lead.stage;
      lead.stage = stage;
      renderLeadsKanban(kanbanState.stats, kanbanState.items);
      try {
        await api('PATCH', `/leads/${leadId}`, { stage });
        showToast('Лід переміщено.');
      } catch (err) {
        lead.stage = previous;
        renderLeadsKanban(kanbanState.stats, kanbanState.items);
        showToast(err.message || 'Не вдалося перемістити лід.', true);
      }
    });
  });
}

let sidebarMode = 'chats';

function openLeadsSidebar() {
  if (!leadsDirectoryView) return;
  if (!token) { showToast('Спочатку виконайте вхід.', true); return; }
  sidebarMode = 'leads';
  prepareWorkspaceView(leadsDirectoryView, workspaceLeadsEntry, 'Ліди');
  if (sidebarSearchEl) sidebarSearchEl.hidden = false;
  if (convList) convList.hidden = false;
  if (leadsSidebarView) leadsSidebarView.hidden = true;
  if (sidebarTitleEl) sidebarTitleEl.textContent = 'ARM CRM';
  if (btnLeadsExport) btnLeadsExport.hidden = false;
  if (btnLeadsAdd) btnLeadsAdd.hidden = false;
  if (btnLeadsSelect) btnLeadsSelect.hidden = false;
  if (btnNewChat) btnNewChat.hidden = true;
  if (btnLeads) btnLeads.classList.add('active-mode');
  loadLeadsStats();
  loadLeadsList();
}

function closeLeadsSidebar() {
  sidebarMode = 'chats';
  if (btnLeadsExport) btnLeadsExport.hidden = true;
  if (btnLeadsAdd) btnLeadsAdd.hidden = true;
  if (btnLeadsSelect) btnLeadsSelect.hidden = true;
  if (btnLeads) btnLeads.classList.remove('active-mode');
  setLeadsSelectMode(false);
  if (leadInfoBanner) leadInfoBanner.hidden = true;
  closeWorkspaceView();
}

function openLeadCreateModal() {
  if (!leadCreateModal) return;
  leadCreateModal.hidden = false;
  syncOverlayLock();
  ['lead-new-name', 'lead-new-country', 'lead-new-city', 'lead-new-phone', 'lead-new-email', 'lead-new-instagram', 'lead-new-notes']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const ownerSel = document.getElementById('lead-new-owner');
  if (ownerSel) ownerSel.value = leadsState.owner || LEADS_OWNER_OPTIONS[0];
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
    owner: document.getElementById('lead-new-owner')?.value || LEADS_OWNER_OPTIONS[0],
    priority: leadNewPriority?.value || 'Medium',
    phone: document.getElementById('lead-new-phone')?.value.trim() || '',
    email: document.getElementById('lead-new-email')?.value.trim() || '',
    instagram: document.getElementById('lead-new-instagram')?.value.trim() || '',
    notes: document.getElementById('lead-new-notes')?.value.trim() || '',
  };
  try {
    await api('POST', '/leads', payload);
    recordActivity({ kind: 'lead', leadName: name, title: 'Створено нового ліда', detail: [payload.city_area, payload.country].filter(Boolean).join(' · ') });
    showToast('Лід створено.');
    closeLeadCreateModal();
    loadLeadsStats();
    loadLeadsList();
  } catch (err) {
    showToast(err.message || 'Не вдалося створити лід.', true);
  }
}

async function fetchLeadsExportText() {
  if (!token) throw new Error('Потрібна авторизація.');
  const headers = token !== COOKIE_SESSION_TOKEN ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${API}/leads/export?${leadsQueryString()}`, { headers, credentials: 'include' });
  if (res.ok) return res.text();
  // Some deployments do not expose the CSV route yet. Build a valid CSV from
  // the same filtered list so export remains useful instead of silently failing.
  const fallback = await api('GET', '/leads?' + leadsQueryString({ page: 1, per_page: 500 }));
  const items = Array.isArray(fallback?.items) ? fallback.items : [];
  if (!items.length) throw new Error(`Експорт недоступний (HTTP ${res.status})`);
  const cols = ['lead_id', 'business_name', 'city_area', 'country', 'category', 'phone', 'whatsapp_viber', 'email', 'website_url', 'owner', 'priority', 'stage', 'outreach_status', 'next_followup_date', 'opening_date', 'lead_score', 'notes'];
  const csvCell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...items.map(row => cols.map(col => csvCell(row[col])).join(','))].join('\n');
}

function parseLeadCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i], next = text[i + 1];
    if (ch === '"' && quoted && next === '"') { cell += '"'; i += 1; continue; }
    if (ch === '"') { quoted = !quoted; continue; }
    if (!quoted && ch === ',') { row.push(cell.trim()); cell = ''; continue; }
    if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell.trim()); cell = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  if (cell || row.length) { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); }
  if (rows.length < 2) throw new Error('Файл порожній або містить лише заголовок.');
  const headers = rows.shift().map(h => h.toLowerCase().replace(/^\ufeff/, '').trim());
  return rows.map(values => Object.fromEntries(headers.map((h, i) => [h, values[i] || ''])));
}

async function importLeadsFromFile(file) {
  const rows = parseLeadCsv(await file.text());
  const aliases = { name: 'business_name', business: 'business_name', city: 'city_area', country_name: 'country', website: 'website_url', url: 'website_url' };
  const seen = new Set(), valid = [], errors = [];
  rows.forEach((raw, index) => {
    const row = { ...raw };
    Object.entries(aliases).forEach(([from, to]) => { if (!row[to] && row[from]) row[to] = row[from]; });
    const name = String(row.business_name || '').trim();
    const key = `${name.toLowerCase()}|${String(row.country || '').toLowerCase()}|${String(row.city_area || '').toLowerCase()}`;
    if (!name) errors.push(`Рядок ${index + 2}: немає business_name`);
    else if (seen.has(key)) errors.push(`Рядок ${index + 2}: дубль у файлі`);
    else { seen.add(key); valid.push({ business_name: name, country: row.country || '', city_area: row.city_area || '', phone: row.phone || '', email: row.email || '', website_url: row.website_url || '', instagram: row.instagram || '', notes: row.notes || '', owner: row.owner || '', priority: row.priority || 'Medium' }); }
  });
  if (!valid.length) throw new Error(`Немає коректних рядків. ${errors.slice(0, 2).join(' ')}`);
  if (!window.confirm(`Імпортувати ${valid.length} лідів? Помилкових рядків: ${errors.length}. Дані будуть збережені на сервері.`)) return;
  if (leadsSyncStatus) leadsSyncStatus.textContent = `Синхронізація: 0/${valid.length}…`;
  let created = 0, failed = 0;
  for (const [index, payload] of valid.entries()) {
    try { await api('POST', '/leads', payload); created += 1; } catch (_) { failed += 1; }
    if (leadsSyncStatus) leadsSyncStatus.textContent = `Синхронізація: ${index + 1}/${valid.length}…`;
  }
  recordActivity({ kind: 'lead', title: 'Імпорт лідів', detail: `Створено: ${created}; помилок: ${failed}; пропущено: ${errors.length}` });
  showToast(`Імпорт завершено: ${created} створено${failed ? `, ${failed} не вдалося` : ''}.`);
  if (leadsSyncStatus) leadsSyncStatus.textContent = `Синхронізовано на сервері: ${created} лідів · видно команді за правами доступу.`;
  leadsState.page = 1;
  await loadLeadsList();
}

async function importLeadsViaServer(file) {
  /* Заливка одним запитом на сервер: усі колонки ліда, матчинг по lead_id.
     Старий шлях слав по одному POST на рядок і знав лише десяток полів —
     повний файл, вивантажений з CRM, через нього не заїжджав. */
  if (!token) throw new Error('Потрібна авторизація.');
  const headers = token !== COOKIE_SESSION_TOKEN ? { Authorization: `Bearer ${token}` } : {};
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API}/leads/import-file`, {
    method: 'POST', headers, credentials: 'include', body: form,
  });
  if (res.status === 404 || res.status === 405) {
    const e = new Error('no-server-import'); e.code = 'FALLBACK'; throw e;
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  const d = json.data || {};
  let msg = `Імпорт завершено: додано ${d.created || 0}, оновлено ${d.updated || 0}`;
  if (d.skipped) msg += `, пропущено ${d.skipped}`;
  showToast(msg);
  recordActivity({ kind: 'lead', title: 'Імпорт лідів з файлу', detail: msg });
  if (leadsSyncStatus) leadsSyncStatus.textContent = `${msg} · дані на сервері.`;
  /* Пропущені рядки показуємо, а не ховаємо: інакше менеджер вважає,
     що заїхало все, і не помічає втрачених записів. */
  if (d.errors?.length) {
    console.warn('Import issues:', d.errors);
    showToast(`Не заїхало: ${d.errors.slice(0, 3).join(' · ')}`, true);
  }
  leadsState.page = 1;
  await loadLeadsList();
  loadLeadsStats();
}

async function importLeadsSmart(file) {
  const isExcel = /\.(xlsx|xlsm)$/i.test(file.name || '');
  try {
    await importLeadsViaServer(file);
  } catch (err) {
    if (err?.code !== 'FALLBACK') throw err;
    if (isExcel) throw new Error('Сервер не приймає Excel. Збережіть файл як CSV UTF-8.');
    await importLeadsFromFile(file);   // старий CSV-шлях на старих збірках
  }
}

function downloadTextFile(text, filename, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = href; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1500);
}

function leadExportRows(text) {
  const rows = parseLeadCsv(text);
  if (!rows.length) throw new Error('За вибраними фільтрами немає лідів для експорту.');
  return rows;
}

function makeWordLeadReport(rows) {
  const value = (row, key) => escHtml(row[key] || '—');
  const cards = rows.map((row, index) => `<section class="lead"><div class="num">${index + 1}</div><h2>${value(row, 'компанія')}</h2><p class="sub">${value(row, 'категорія')} · ${value(row, 'локація')}</p><dl><div><dt>Контакти</dt><dd>${value(row, 'контакти')}</dd></div><div><dt>Сайт</dt><dd>${value(row, 'сайт')}</dd></div><div><dt>Відповідальний</dt><dd>${value(row, 'відповідальний')}</dd></div><div><dt>Статус</dt><dd>${value(row, 'стадія')} · ${value(row, 'статус контакту')}</dd></div><div><dt>Наступна дія</dt><dd>${value(row, 'наступна дія')}</dd></div><div><dt>Відкриття</dt><dd>${value(row, 'відкриття')}</dd></div></dl>${row['нотатки'] ? `<p class="note">${value(row, 'нотатки')}</p>` : ''}</section>`).join('');
  return `<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>Ліди ARM CRM</title><style>body{font-family:Arial,sans-serif;color:#1d1d1f;margin:32px;line-height:1.45}h1{font-size:24px;margin:0 0 4px}.meta{color:#6e6e73;margin:0 0 24px}.lead{position:relative;border:1px solid #d2d2d7;border-radius:10px;padding:18px 20px;margin:0 0 16px;page-break-inside:avoid}.num{position:absolute;right:18px;top:18px;color:#6e6e73;font-size:12px}h2{font-size:18px;margin:0 36px 3px 0}.sub{margin:0 0 14px;color:#6e6e73;font-size:13px}dl{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;margin:0}dt{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#6e6e73}dd{margin:2px 0 0;font-size:13px;overflow-wrap:anywhere}.note{margin:14px 0 0;padding-top:12px;border-top:1px solid #e5e5ea;font-size:13px}@media print{body{margin:18mm}.lead{break-inside:avoid}}</style></head><body><h1>Ліди</h1><p class="meta">ARM CRM · ${new Date().toLocaleDateString('uk-UA')} · ${rows.length} записів</p>${cards}</body></html>`;
}

async function exportLeadsFormat(format = 'csv') {
  try {
    if (leadsSyncStatus) leadsSyncStatus.textContent = `Готуємо експорт ${format.toUpperCase()}…`;
    // Excel і PDF тепер робить сервер. Раніше «Excel» був XML-таблицею .xls,
    // зібраною з CSV на клієнті, а «PDF» — друком сторінки браузером, тобто
    // тим, що на екрані: картки, обрізані колонки, випадкові розриви.
    const serverFiles = {
      'xlsx-full': [`${API}/leads/export.xlsx?${leadsQueryString()}`, 'leads_export.xlsx', 'Excel (усі поля)'],
      'xlsx': [`${API}/leads/export.xlsx?scope=work&${leadsQueryString()}`, 'leads_work.xlsx', 'Excel (робочі поля)'],
      'pdf': [`${API}/leads/export.pdf?${leadsQueryString()}`, 'leads.pdf', 'PDF (таблиця)'],
    };
    if (serverFiles[format]) {
      const [url, filename, label] = serverFiles[format];
      await downloadProtectedFile(url, filename);
      recordActivity({ kind: 'lead', title: `Експорт лідів · ${label}`, detail: 'Поточні фільтри' });
      if (leadsSyncStatus) leadsSyncStatus.textContent = `${label} завантажено · фільтри збережено.`;
      return;
    }
    const text = await fetchLeadsExportText();
    const rows = leadExportRows(text);
    if (format === 'csv') downloadTextFile(text, 'leads_export.csv', 'text/csv;charset=utf-8');
    if (format === 'docx') downloadTextFile(makeWordLeadReport(rows), 'leads_report.doc', 'application/msword;charset=utf-8');
    recordActivity({ kind: 'lead', title: `Експорт лідів · ${format.toUpperCase()}`, detail: 'Поточні фільтри' });
    if (leadsSyncStatus) leadsSyncStatus.textContent = `Експорт ${format.toUpperCase()} завантажено · фільтри збережено.`;
  } catch (err) { showToast(err.message || 'Не вдалося експортувати дані.', true); }
}

function closeLeadsExportMenu() { document.querySelector('.leads-export-menu')?.remove(); }
function openLeadsExportMenu(anchor) {
  closeLeadsExportMenu();
  const menu = document.createElement('div'); menu.className = 'leads-export-menu';
  menu.innerHTML = '<strong>Завантажити поточний список</strong><small class="export-menu-help">«Усі поля» — повне вивантаження: правте і заливайте назад через Імпорт. Решта форматів — короткий зріз за поточними фільтрами.</small><button type="button" data-export-format="xlsx-full">Excel · усі поля</button><button type="button" data-export-format="xlsx">Excel · робочі поля</button><button type="button" data-export-format="pdf">PDF · таблиця</button><button type="button" data-export-format="csv">CSV · таблиця</button><button type="button" data-export-format="docx">Word · звіт за лідами</button>';
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect(); menu.style.top = `${rect.bottom + 8}px`; menu.style.left = `${Math.max(12, rect.right - menu.offsetWidth)}px`;
  menu.querySelectorAll('[data-export-format]').forEach(btn => btn.addEventListener('click', () => { const format = btn.dataset.exportFormat; closeLeadsExportMenu(); exportLeadsFormat(format); }));
  setTimeout(() => document.addEventListener('click', function close(event) { if (!menu.contains(event.target) && event.target !== anchor) { closeLeadsExportMenu(); document.removeEventListener('click', close); } }, { once: true }), 0);
}

if (btnLeads) btnLeads.addEventListener('click', () => {
  if (sidebarMode === 'leads') closeLeadsSidebar();
  else openLeadsSidebar();
});
if (workspaceLeadsEntry) workspaceLeadsEntry.addEventListener('click', openLeadsSidebar);
if (workspaceDayEntry) workspaceDayEntry.addEventListener('click', openLeadsWorkQueue);
if (workspaceKanbanEntry) workspaceKanbanEntry.addEventListener('click', openLeadsKanban);
if (workspaceSearchEntry) workspaceSearchEntry.addEventListener('click', openProspectingView);
if (crmHomeLeads) crmHomeLeads.addEventListener('click', openLeadsSidebar);
if (crmHomeDay) crmHomeDay.addEventListener('click', openLeadsWorkQueue);
if (crmHomeKanban) crmHomeKanban.addEventListener('click', openLeadsKanban);
if (crmHomeOpenings) crmHomeOpenings.addEventListener('click', openOpeningsView);
if (crmHomePlanner) crmHomePlanner.addEventListener('click', openAugustScheduleView);
if (crmHomeNewChat) crmHomeNewChat.addEventListener('click', () => btnNewChat?.click());
if (crmHomeAddLead) crmHomeAddLead.addEventListener('click', openLeadCreateModal);
if (crmHomeSecurity) crmHomeSecurity.addEventListener('click', () => btnSecurity?.click());
if (crmHomeSearch) crmHomeSearch.addEventListener('click', openProspectingView);
if (workspaceOpeningsEntry) workspaceOpeningsEntry.addEventListener('click', openOpeningsView);
if (workspaceIntegrationsEntry) workspaceIntegrationsEntry.addEventListener('click', openIntegrationsView);
if (workspaceActivityEntry) workspaceActivityEntry.addEventListener('click', openActivityLogView);
if (btnActivityBack) btnActivityBack.addEventListener('click', closeWorkspaceView);
if (btnActivityRefresh) btnActivityRefresh.addEventListener('click', renderActivityLog);
if (btnActivityExportCsv) btnActivityExportCsv.addEventListener('click', () => downloadActivityLog('csv'));
if (btnActivityExportJson) btnActivityExportJson.addEventListener('click', () => downloadActivityLog('json'));
if (activityLogList) activityLogList.addEventListener('click', event => {
  const leadButton = event.target.closest('[data-activity-open]');
  const leadId = Number(leadButton?.dataset.activityOpen || 0);
  if (!leadId) return;
  activityLogView.hidden = true;
  openLeadDetail(leadId);
});
if (activityLogSearch) activityLogSearch.addEventListener('input', () => {
  activityFilterState.search = activityLogSearch.value;
  renderActivityLog();
});
if (activityLogKind) activityLogKind.addEventListener('change', () => {
  activityFilterState.kind = activityLogKind.value;
  renderActivityLog();
});
if (btnActivityReset) btnActivityReset.addEventListener('click', () => {
  activityFilterState.search = '';
  activityFilterState.kind = '';
  if (activityLogSearch) activityLogSearch.value = '';
  if (activityLogKind) activityLogKind.value = '';
  renderActivityLog();
});
if (btnActivityClear) btnActivityClear.addEventListener('click', () => {
  if (window.confirm('Очистити всі ваші записи журналу на цьому пристрої та сервері?')) clearActivityLog().catch(() => {});
});
if (workspaceNotificationsEntry) workspaceNotificationsEntry.addEventListener('click', openNotificationsView);
if (btnNotificationsBack) btnNotificationsBack.addEventListener('click', closeWorkspaceView);
Object.entries(notificationToggleEls).forEach(([key, el]) => el?.addEventListener('change', () => {
  notificationPrefs[key] = !!el.checked;
  saveNotificationPrefs();
}));
if (btnNotificationsEnable) btnNotificationsEnable.addEventListener('click', async () => {
  const ok = await ensureNotificationPermission(true);
  if (ok) {
    notificationPrefs.push = true;
    if (notificationToggleEls.push) notificationToggleEls.push.checked = true;
    saveNotificationPrefs();
    showToast('Системні сповіщення увімкнено.');
  } else showToast(lastPushSetupError || 'Не вдалося увімкнути сповіщення.', true);
});
if (btnCloseLeadCreate) btnCloseLeadCreate.addEventListener('click', closeLeadCreateModal);
if (btnLeadsAdd) btnLeadsAdd.addEventListener('click', openLeadCreateModal);
if (btnLeadsDirectoryAdd) btnLeadsDirectoryAdd.addEventListener('click', openLeadCreateModal);
if (btnLeadsDirectoryImport && leadsImportFile) {
  btnLeadsDirectoryImport.addEventListener('click', () => leadsImportFile.click());
  leadsImportFile.addEventListener('change', async () => {
    const file = leadsImportFile.files?.[0];
    leadsImportFile.value = '';
    if (!file) return;
    try { await importLeadsSmart(file); } catch (err) { showToast(err.message || 'Не вдалося імпортувати файл.', true); }
  });
}
if (btnLeadsImportTemplate) btnLeadsImportTemplate.addEventListener('click', () => { downloadTextFile('business_name,country,city_area,phone,email,website_url,instagram,notes\nHotel Example,Ukraine,Kyiv,+380501234567,hello@example.com,https://example.com,@example,Потенційний клієнт\n', 'leads_import_template.csv', 'text/csv;charset=utf-8'); if (leadsSyncStatus) leadsSyncStatus.textContent = 'Шаблон CSV завантажено · заповніть business_name і збережіть UTF-8.'; });
if (btnLeadCreateSave) btnLeadCreateSave.addEventListener('click', saveNewLead);
if (btnLeadsExport) btnLeadsExport.addEventListener('click', () => openLeadsExportMenu(btnLeadsExport));
if (btnLeadsDirectoryExport) btnLeadsDirectoryExport.addEventListener('click', () => openLeadsExportMenu(btnLeadsDirectoryExport));
if (btnLeadsDirectoryBack) btnLeadsDirectoryBack.addEventListener('click', closeLeadsSidebar);
if (leadsKanbanEntry) leadsKanbanEntry.addEventListener('click', openLeadsKanban);
if (btnKanbanBack) btnKanbanBack.addEventListener('click', closeLeadsKanban);
if (leadsWorkQueueEntry) leadsWorkQueueEntry.addEventListener('click', openLeadsWorkQueue);
if (btnWorkQueueBack) btnWorkQueueBack.addEventListener('click', closeLeadsWorkQueue);
if (btnWorkQueueRefresh) btnWorkQueueRefresh.addEventListener('click', loadLeadsWorkQueue);
if (workQueueOwnerEl) workQueueOwnerEl.addEventListener('change', () => {
  // Вибір менеджера в "Моєму дні" — це той самий фільтр CRM, тому він
  // запам'ятовується і застосовується до списку, чіпів і воронки.
  setLeadsOwnerFilter(workQueueOwnerEl.value);
  if (leadsFilterOwner) leadsFilterOwner.value = leadsState.owner;
  leadsState.page = 1;
  syncLeadsFilterStatus();
  loadLeadsWorkQueue();
  loadLeadsList().catch(() => {});
  loadLeadsStats().catch(() => {});
});
if (workQueueSectionsEl) workQueueSectionsEl.addEventListener('click', handleWorkQueueClick);
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
      applyLeadsFilterChange();
    }, 350);
  });
}
if (leadsFilterOwner) leadsFilterOwner.addEventListener('change', () => {
  setLeadsOwnerFilter(leadsFilterOwner.value); applyLeadsFilterChange();
});
if (leadsFilterStage) leadsFilterStage.addEventListener('change', () => {
  leadsState.stage = leadsFilterStage.value; applyLeadsFilterChange();
});
if (leadsFilterPriority) leadsFilterPriority.addEventListener('change', () => {
  leadsState.priority = leadsFilterPriority.value; applyLeadsFilterChange();
});
if (leadsFilterCountry) leadsFilterCountry.addEventListener('change', () => {
  leadsState.country = leadsFilterCountry.value; applyLeadsFilterChange();
});
if (leadsFilterOutreach) leadsFilterOutreach.addEventListener('change', () => {
  leadsState.outreachStatus = leadsFilterOutreach.value; applyLeadsFilterChange();
});
if (leadsFilterChannel) leadsFilterChannel.addEventListener('change', () => {
  leadsState.channel = leadsFilterChannel.value; applyLeadsFilterChange();
});
if (leadsSortEl) {
  leadsSortEl.value = leadsState.sort;
  leadsSortEl.addEventListener('change', () => {
    leadsState.sort = leadsSortEl.value || 'score';
    leadsState.page = 1;
    localStorage.setItem(LEADS_SORT_KEY, leadsState.sort);
    loadLeadsList();
  });
}
if (btnLeadsFilterReset) btnLeadsFilterReset.addEventListener('click', resetLeadsFilters);

document.addEventListener('click', event => {
  const retry = event.target.closest('[data-workspace-retry]');
  if (!retry) return;
  const actions = {
    leads: loadLeadsList,
    day: loadLeadsWorkQueue,
    kanban: openLeadsKanban,
    integrations: openIntegrationsView,
    'google-key': loadGoogleKeyCard,
  };
  const action = actions[retry.dataset.workspaceRetry];
  if (action) action();
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
  const headers = {};
  if (token !== COOKIE_SESSION_TOKEN) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, {
    headers,
    credentials: 'include',
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
  recordActivity({ kind: 'message', title: 'Надіслано повідомлення', detail: activePartner?.full_name || activePartner?.name || 'Розмова' });
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
    !!securityModal && !securityModal.hidden
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
function base64urlToBytes(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

function bytesToBase64url(value) {
  if (!value) return null;
  const bytes = new Uint8Array(value);
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function normalizeCredentialOptions(options, mode) {
  const result = { ...options, challenge: base64urlToBytes(options.challenge) };
  if (mode === 'create' && result.user?.id) {
    result.user = { ...result.user, id: base64urlToBytes(result.user.id) };
  }
  const key = mode === 'create' ? 'excludeCredentials' : 'allowCredentials';
  if (Array.isArray(result[key])) {
    result[key] = result[key].map(item => ({ ...item, id: base64urlToBytes(item.id) }));
  }
  return result;
}

function serializeCredential(credential) {
  const response = credential.response || {};
  const data = {
    id: credential.id,
    rawId: bytesToBase64url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment || undefined,
    clientExtensionResults: credential.getClientExtensionResults?.() || {},
    response: {
      clientDataJSON: bytesToBase64url(response.clientDataJSON),
    },
  };
  if (response.attestationObject) data.response.attestationObject = bytesToBase64url(response.attestationObject);
  if (response.authenticatorData) data.response.authenticatorData = bytesToBase64url(response.authenticatorData);
  if (response.signature) data.response.signature = bytesToBase64url(response.signature);
  if (response.userHandle) data.response.userHandle = bytesToBase64url(response.userHandle);
  if (typeof response.getTransports === 'function') data.response.transports = response.getTransports();
  return data;
}

function passkeyAvailable() {
  return !!(window.PublicKeyCredential && navigator.credentials);
}

async function loginWithPasskey() {
  if (!passkeyAvailable()) throw new Error('Цей браузер не підтримує Passkey.');
  const options = await api('POST', '/auth/passkey/login-options', {});
  const credential = await navigator.credentials.get({ publicKey: normalizeCredentialOptions(options, 'get') });
  if (!credential) throw new Error('Вхід скасовано.');
  const data = await api('POST', '/auth/passkey/login', {
    credential: serializeCredential(credential),
    remember: !authRememberMe || authRememberMe.checked,
  });
  applyAuthPayload(data);
  showApp();
}

function deviceLabel(userAgent) {
  const ua = String(userAgent || '');
  const browser = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Браузер';
  const device = /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Пристрій';
  return `${browser} · ${device}`;
}

function formatSessionTime(value) {
  if (!value) return 'час не визначено';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('uk-UA', { dateStyle: 'medium', timeStyle: 'short' });
}

async function loadSecurityCenter() {
  if (!securitySessionList) return;
  securitySessionList.innerHTML = '<div class="security-loading">Завантажую активні входи…</div>';
  const [passkey, sessions] = await Promise.all([
    api('GET', '/auth/passkey/status').catch(() => ({ has_passkey: false })),
    api('GET', '/auth/sessions'),
  ]);
  const hasPasskey = !!passkey?.has_passkey;
  if (passkeyStatusText) passkeyStatusText.textContent = hasPasskey
    ? 'Passkey активний. Вхід підтверджується біометрією або кодом пристрою.'
    : 'Додайте Passkey, щоб входити без введення пароля.';
  if (btnPasskeyManage) {
    btnPasskeyManage.textContent = hasPasskey ? 'Видалити Passkey' : 'Додати Passkey';
    btnPasskeyManage.dataset.enabled = hasPasskey ? '1' : '0';
  }
  securitySessionList.innerHTML = (sessions || []).map(item => `
    <article class="security-session ${item.is_current ? 'is-current' : ''}">
      <div class="security-session-icon">${item.auth_method === 'passkey' ? 'PK' : 'PW'}</div>
      <div class="security-session-copy">
        <strong>${escHtml(deviceLabel(item.user_agent))}${item.is_current ? ' · цей пристрій' : ''}</strong>
        <span>${escHtml(item.ip_address || 'IP не визначено')} · ${escHtml(formatSessionTime(item.last_seen_at || item.created_at))}</span>
      </div>
      ${item.is_current ? '<span class="security-current">Активний</span>' : `<button class="security-revoke" data-session-id="${Number(item.id)}">Завершити</button>`}
    </article>`).join('') || '<div class="security-loading">Активних входів не знайдено.</div>';
}

async function openSecurityCenter() {
  if (!securityModal) return;
  securityModal.hidden = false;
  syncOverlayLock();
  try { await loadSecurityCenter(); }
  catch (err) { securitySessionList.innerHTML = `<div class="security-loading is-error">${escHtml(err.message || 'Не вдалося завантажити входи.')}</div>`; }
}

function closeSecurityCenter() {
  if (!securityModal) return;
  securityModal.hidden = true;
  syncOverlayLock();
}

function setAuthMode(mode) {
  authMode = mode;
  const isReg = mode === 'register';
  if (authFormTitle)      authFormTitle.textContent = isReg ? 'Реєстрація' : 'Вхід';
  if (authRegisterFields) authRegisterFields.hidden = !isReg;
  if (btnLoginText)       btnLoginText.textContent  = isReg ? 'Зареєструватися' : 'Увійти';
  if (authSwitchHint)     authSwitchHint.textContent = isReg ? 'Вже є акаунт?' : 'Немає акаунту?';
  if (authSwitchBtn)      authSwitchBtn.textContent  = isReg ? 'Увійти' : 'Зареєструватися';
  if (authError)          authError.hidden = true;
  if (btnPasskeyLogin) btnPasskeyLogin.hidden = isReg || !passkeyAvailable();
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
  token = data?.cookie_auth ? COOKIE_SESSION_TOKEN : (data?.token || null);
  me = data?.user || null;
  if (!token || !me) throw new Error('Некоректна відповідь сервера авторизації.');
  const remember = !authRememberMe || authRememberMe.checked;
  const store = remember ? localStorage : sessionStorage;
  const other = remember ? sessionStorage : localStorage;
  if (token !== COOKIE_SESSION_TOKEN) {
    store.setItem(TOKEN_KEY, token);
    store.setItem(BANK_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(BANK_TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(BANK_TOKEN_KEY);
  }
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
    const data = await api('POST', '/auth/login', {
      identity, password,
      remember: !authRememberMe || authRememberMe.checked,
      use_cookie: true,
    });
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
      remember: !authRememberMe || authRememberMe.checked,
      use_cookie: true,
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
  sessionStorage.removeItem(LAST_WORKSPACE_KEY);
  clearPolling();
  clearInterval(incomingCheckTimer);
  hideIncoming();
  hangupCall(false);
  showAuth();
}

btnTogglePw.addEventListener('click', () => {
  authPassword.type = authPassword.type === 'text' ? 'password' : 'text';
});

if (btnPasskeyLogin) {
  btnPasskeyLogin.hidden = !passkeyAvailable();
  btnPasskeyLogin.addEventListener('click', async () => {
    btnPasskeyLogin.disabled = true;
    authError.hidden = true;
    try { await loginWithPasskey(); }
    catch (err) {
      authError.textContent = err?.name === 'NotAllowedError' ? 'Вхід скасовано або не підтверджено.' : (err.message || 'Не вдалося увійти з Passkey.');
      authError.hidden = false;
    } finally { btnPasskeyLogin.disabled = false; }
  });
}

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
  const isLeadsAdmin = ['admin', 'platform_admin', 'manager'].includes(me?.role);
  // Менеджер бачить лише своїх лідів (сервер це і забезпечує), тому вибір
  // "за яким менеджером" фільтрувати/призначати для нього беззмістовний:
  // будь-яке інше значення поверне порожньо або 403. Ховаємо самі контроли,
  // а не лише опції — інакше лишається керування, яке нічого не робить.
  if (me?.role === 'manager') {
    ['leads-filter-owner', 'leads-bulk-owner', 'work-queue-owner',
     'kanban-owner-filter', 'prosp-owner', 'lead-new-owner'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const holder = el.closest('label') || el;
      holder.hidden = true;
      holder.style.display = 'none';
    });
  }
  if (workspaceChatsEl) workspaceChatsEl.hidden = !isLeadsAdmin;
  if (btnLeads) btnLeads.hidden = !isLeadsAdmin;
  if (btnIntegrations) btnIntegrations.hidden = !isLeadsAdmin;
  if (btnProspecting) btnProspecting.hidden = !isLeadsAdmin;
  if (isLeadsAdmin) {
    ensureLeadsOwnerOptions().catch(() => {});
    loadLeadsStats().catch(() => {});
    loadOpeningsCount().catch(() => {});
  }
  updateNetworkPill();
  ensureMessengerBankStatus().catch(() => {});
  loadConversations();
  loadTeamDirectory().catch(() => {});
  window.setTimeout(() => {
    const search = new URLSearchParams(window.location.search);
    const requestedLead = Number(search.get('lead') || 0);
    if (isLeadsAdmin && requestedLead > 0) {
      window.history.replaceState({}, document.title, window.location.pathname);
      openLeadDetail(requestedLead).catch(error => showToast(error.message || 'Не вдалося відкрити лід.', true));
      return;
    }
    // The map asks unauthenticated visitors to sign in here first. Only allow
    // the single local CRM destination, never an arbitrary redirect URL.
    if (isLeadsAdmin && search.get('next') === '/leads-map') {
      window.location.assign(`${BASE}/leads-map`);
      return;
    }
    restoreLastWorkspace();
  }, 0);
  ensurePushSubscriptionSilent().catch(() => {});
  startGlobalPoll();
  pollUnreadBadge();
  runClientDiagnostics().catch(() => {});
  startIncomingCallCheck();
  syncOverlayLock();
}

if (btnSecurity) btnSecurity.addEventListener('click', openSecurityCenter);
if (btnCloseSecurity) btnCloseSecurity.addEventListener('click', closeSecurityCenter);
if (securityModal) securityModal.addEventListener('click', event => {
  if (event.target === securityModal) closeSecurityCenter();
});
if (btnPasskeyManage) btnPasskeyManage.addEventListener('click', async () => {
  btnPasskeyManage.disabled = true;
  try {
    if (btnPasskeyManage.dataset.enabled === '1') {
      if (!window.confirm('Видалити Passkey для цього акаунта?')) return;
      await api('DELETE', '/auth/passkey/remove');
      showToast('Passkey видалено.');
    } else {
      if (!passkeyAvailable()) throw new Error('Цей браузер не підтримує Passkey.');
      const options = await api('POST', '/auth/passkey/register-options', {});
      const credential = await navigator.credentials.create({ publicKey: normalizeCredentialOptions(options, 'create') });
      if (!credential) throw new Error('Створення Passkey скасовано.');
      await api('POST', '/auth/passkey/register', serializeCredential(credential));
      showToast('Passkey додано. Тепер можна входити без пароля.');
    }
    await loadSecurityCenter();
  } catch (err) {
    showToast(err?.name === 'NotAllowedError' ? 'Налаштування Passkey скасовано.' : (err.message || 'Не вдалося змінити Passkey.'), true);
  } finally { btnPasskeyManage.disabled = false; }
});
if (securitySessionList) securitySessionList.addEventListener('click', async event => {
  const button = event.target.closest('[data-session-id]');
  if (!button) return;
  button.disabled = true;
  try {
    await api('DELETE', `/auth/sessions/${Number(button.dataset.sessionId)}`);
    await loadSecurityCenter();
    showToast('Вхід на пристрої завершено.');
  } catch (err) { showToast(err.message || 'Не вдалося завершити вхід.', true); }
});
if (btnRevokeOthers) btnRevokeOthers.addEventListener('click', async () => {
  if (!window.confirm('Завершити всі інші активні входи?')) return;
  btnRevokeOthers.disabled = true;
  try {
    const data = await api('DELETE', '/auth/sessions');
    await loadSecurityCenter();
    showToast(`Завершено входів: ${Number(data?.revoked || 0)}.`);
  } catch (err) { showToast(err.message || 'Не вдалося завершити інші входи.', true); }
  finally { btnRevokeOthers.disabled = false; }
});

function restoreLastWorkspace() {
  if (!['admin', 'platform_admin', 'manager'].includes(me?.role)) return;
  let workspace = '';
  try { workspace = sessionStorage.getItem(LAST_WORKSPACE_KEY) || ''; } catch (_) {}
  const openers = {
    'leads-directory-view': openLeadsSidebar,
    'leads-work-queue-view': openLeadsWorkQueue,
    'leads-kanban-view': openLeadsKanban,
    'openings-view': openOpeningsView,
  };
  if (openers[workspace]) openers[workspace]();
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

// Keep service chats compatible with backend names while presenting a quiet macOS label.
function displayConvName(conv) {
  const name = convName(conv);
  if (name === SAVED_MESSAGES_NAME) return 'Збережені повідомлення';
  if (name === SCHEDULER_NAME) return 'Планувальник';
  return name.replace(/^[\p{Extended_Pictographic}\uFE0F]+\s*/u, '');
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
  if (workspaceChatsEl) {
    workspaceChatsEl.querySelectorAll('.workspace-chat').forEach(entry => {
      entry.hidden = Boolean(q) && !entry.textContent.toLowerCase().includes(q);
    });
  }
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
  const name    = displayConvName(conv);
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
  try { sessionStorage.removeItem(LAST_WORKSPACE_KEY); } catch (_) {}
  if (window.innerWidth <= COMPACT_LAYOUT_MAX_WIDTH) sidebar.classList.add('hidden');
  sidebarMode = 'chats';
  if (btnLeadsExport) btnLeadsExport.hidden = true;
  if (btnLeadsAdd) btnLeadsAdd.hidden = true;
  if (btnLeadsSelect) btnLeadsSelect.hidden = true;
  if (btnLeads) btnLeads.classList.remove('active-mode');
  setLeadsSelectMode(false);
  activateWorkspaceEntry(null);
  hideWorkspaceViews();
  const isLeadChat = Number(conv.lead_id || 0) > 0;
  if (!isLeadChat) resetLeadChannelState();
  if (chatTopbarSectionEl) chatTopbarSectionEl.textContent = 'Месенджер';
  activeConvId  = conv.id;
  activePartner = conv.partner || null;
  lastMsgId     = 0;
  noMoreOlder   = false;

  const isGroup = !!conv.is_group;
  const isAssistant = !isGroup && isAssistantPartner(conv.partner);
  const isSelfChat = SELF_CHAT_NAMES.includes(conv.group_name);
  const isSchedulerChat = conv.group_name === SCHEDULER_NAME;
  chatView.classList.toggle('scheduler-chat', isSchedulerChat);
  if (schedulerOverviewEl) schedulerOverviewEl.hidden = !isSchedulerChat;
  const name    = displayConvName(conv);
  chatAvatar.innerHTML = isAssistant ? assistantGlyphMarkup() : esc(initial(name));
  chatAvatar.className = 'chat-header-avatar' + (isGroup ? ' group' : '') + (isAssistant ? ' assistant' : '');
  chatPartnerName.classList.toggle('with-verified', isAssistant);
  chatPartnerName.innerHTML = renderNameWithVerified(name, isAssistant);
  if (isSelfChat) {
    setChatHeaderStatus(isSchedulerChat ? 'Робочий ритм · черга та календар' : 'Особисті нотатки · тільки ви');
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
  if (leadsWorkQueueView) leadsWorkQueueView.hidden = true;
  if (leadsWorkQueueEntry) leadsWorkQueueEntry.classList.remove('active');
  if (integrationsView) integrationsView.hidden = true;
  if (prospectingView) prospectingView.hidden = true;
  if (openingsView) openingsView.hidden = true;
  const _augV = document.getElementById('august-schedule-view'); if (_augV) _augV.hidden = true;
  const _anlV = document.getElementById('analytics-dashboard-view'); if (_anlV) _anlV.hidden = true;

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
  if (isSchedulerChat) loadSchedulerOverview();
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

function buildSchedulerDigestBubble(rawText) {
  const lines = String(rawText || '').split('\n').map(line => line.trim()).filter(Boolean);
  if (!lines[0]?.startsWith('Нагадування на ')) return null;
  const date = lines[0].match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
  const tasks = lines.slice(1).map(line => line.replace(/^•\s*/, ''));
  const empty = !tasks.length && /немає/i.test(lines[0]);
  return `<div class="scheduler-digest-card ${empty ? 'is-clear' : 'has-tasks'}">
    <div class="scheduler-digest-head">
      <span class="scheduler-digest-icon" aria-hidden="true">${empty ? '✓' : '!'}</span>
      <div><strong>${empty ? 'На сьогодні все спокійно' : `Потребують уваги: ${tasks.length}`}</strong><small>${esc(date || 'Щоденний огляд')}</small></div>
    </div>
    ${tasks.length ? `<ul>${tasks.map(task => `<li>${esc(task)}</li>`).join('')}</ul>` : '<p>Прострочених контактів немає. Нові задачі зʼявляться тут автоматично.</p>'}
    <button type="button" class="scheduler-open-day" data-open-workday="1">Відкрити «Мій день»</button>
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
  const schedulerDigest = buildSchedulerDigestBubble(msg.text);
  if (schedulerDigest) wrap.className = 'msg-bubble-wrap system-event';

  let content;
  if (deleted) {
    content = `<div class="msg-bubble deleted">${esc('Повідомлення видалено')}</div>`;
  } else if (schedulerDigest) {
    content = schedulerDigest;
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

  wrap.innerHTML = schedulerDigest
    ? `<div class="msg-inner">${content}<div class="msg-time">${timeStr}</div></div>`
    : `${!isMe ? `<div class="msg-sender-avatar${assistantIncoming ? ' assistant' : ''}">${assistantIncoming ? assistantGlyphMarkup() : esc(ini)}</div>` : ''}
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
    if (leadsState.currentLeadId) refreshLeadChannelReadiness();
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
  return saver ? 6000 : 2000;
}

function _convPollInterval() {
  const saver = isDataSaverEnabled();
  if (document.hidden) return saver ? 12000 : 6000;
  return saver ? 1200 : 800;
}

function _presencePollInterval() {
  const saver = isDataSaverEnabled();
  if (document.hidden) return saver ? 15000 : 8000;
  return saver ? 8000 : 5000;
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
    : (isDataSaverEnabled() ? 12000 : 5000);
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

async function loadTeamDirectory() {
  if (!teamDirectory || !teamDirectoryList || !token) return;
  try {
    const users = await api('GET', '/messenger/users');
    const list = Array.isArray(users) ? users : [];
    teamDirectoryUsers = list;
    teamDirectory.hidden = list.length === 0;
    if (teamDirectoryCount) teamDirectoryCount.textContent = list.length ? String(list.length) : '';
    teamDirectoryList.innerHTML = list.map(user => `
      <button type="button" class="team-user${user.is_current ? ' is-current' : ''}" data-team-user-id="${Number(user.id)}"${user.is_current ? ' aria-current="true"' : ''}>
        <span class="team-user-avatar">${esc(initial(user.full_name || '?'))}</span>
        <span class="team-user-copy"><strong>${esc(user.full_name || 'Користувач')}</strong><small>${user.is_current ? 'Ви' : esc(user.role || 'Учасник')}</small></span>
      </button>`).join('');
  } catch (_) {
    teamDirectory.hidden = true;
  }
}

teamDirectoryList?.addEventListener('click', event => {
  const button = event.target.closest('[data-team-user-id]');
  if (!button) return;
  const userId = Number(button.dataset.teamUserId);
  const user = teamDirectoryUsers.find(item => Number(item.id) === userId);
  if (user && !user.is_current) startChatWith(user);
});

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
  if (/\/api\/transactions\/statement\?/i.test(raw)) return 'PDF-виписка готова';
  if (/\/api\/transactions\/export\?/i.test(raw)) return 'CSV-виписка готова';
  if (/^[A-Za-z0-9+/=]{120,}$/.test(raw)) return 'Голосове повідомлення';
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
  if ((msg.msg_type || 'text') === 'voice') return `${ownPrefix}Голосове повідомлення`;
  if ((msg.msg_type || 'text') === 'image') return `${ownPrefix}Фото`;
  if ((msg.msg_type || 'text') === 'call') return `${ownPrefix}Дзвінок`;
  return ownPrefix + compactPreview(msg.text || 'Нове повідомлення');
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function updateSendBtn() {
  const channelBlocked = !!leadsState.currentLeadId && !leadsState.channelReadiness?.ready;
  btnSend.disabled = !msgInput.value.trim() || channelBlocked || msgInput.disabled;
}

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
  if (messagesWrap) {
    messagesWrap.scrollTo({ top: messagesWrap.scrollHeight, behavior: instant ? 'auto' : 'smooth' });
  }
  if (chatView) chatView.scrollTop = 0;
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
  const query = prompt('Ім’я або телефон учасника');
  if (!query || query.trim().length < 2) return;
  try {
    const users = await api('GET', `/messenger/users/search?q=${encodeURIComponent(query.trim())}`);
    const candidates = Array.isArray(users) ? users : [];
    if (!candidates.length) { showToast('Користувача не знайдено.', true); return; }
    const found = candidates[0];
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
    if (leadsWorkQueueView && !leadsWorkQueueView.hidden) { closeLeadsWorkQueue(); return; }
    if (leadsKanbanView && !leadsKanbanView.hidden) { closeLeadsKanban(); return; }
    if (leadsDirectoryView && !leadsDirectoryView.hidden) { closeLeadsSidebar(); return; }
    if (prospectingView && !prospectingView.hidden) { closeProspectingView(); return; }
    if (openingsView && !openingsView.hidden) { closeOpeningsView(); return; }
    if (integrationsView && !integrationsView.hidden) { closeIntegrationsView(); return; }
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
  activateWorkspaceEntry(null);
  if (chatTopbarSectionEl) chatTopbarSectionEl.textContent = 'Месенджер';
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
    const workdayBtn = e.target.closest('[data-open-workday="1"]');
    if (workdayBtn) {
      openLeadsWorkQueue();
      return;
    }
    const kanbanBtn = e.target.closest('[data-open-kanban="1"]');
    if (kanbanBtn) {
      openLeadsKanban();
      return;
    }
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
if (schedulerOverviewEl) {
  schedulerOverviewEl.addEventListener('click', e => {
    if (!(e.target instanceof Element)) return;
    if (e.target.closest('[data-open-workday="1"]')) {
      openLeadsWorkQueue();
      return;
    }
    if (e.target.closest('[data-open-kanban="1"]')) {
      openLeadsKanban();
      return;
    }
    const leadButton = e.target.closest('[data-scheduler-lead]');
    if (leadButton) openLeadDetail(Number(leadButton.dataset.schedulerLead));
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
  const headers = {};
  if (token !== COOKIE_SESSION_TOKEN) headers.Authorization = `Bearer ${token}`;
  fetch(`${API}/messenger/calls/${activeCallId}/end`, {
    method: 'PUT',
    headers,
    credentials: 'include',
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
let workspaceResizeFrame = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(workspaceResizeFrame);
  workspaceResizeFrame = requestAnimationFrame(syncWorkspaceResponsiveLayout);
}, { passive: true });
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
async function bootAuthenticatedApp() {
  if (token && me) {
    if (token !== COOKIE_SESSION_TOKEN) {
      try {
        await api('POST', '/auth/browser-session', { remember: true });
        token = COOKIE_SESSION_TOKEN;
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(BANK_TOKEN_KEY);
        sessionStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(BANK_TOKEN_KEY);
      } catch (_) {
        // Legacy Bearer remains usable if migration is temporarily unavailable.
      }
    }
    showApp();
    loadActivityLogFromServer().catch(() => {});
    return;
  }
  try {
    const user = await api('GET', '/auth/me');
    token = COOKIE_SESSION_TOKEN;
    me = user;
    localStorage.setItem(USER_KEY, JSON.stringify(me));
    showApp();
    loadActivityLogFromServer().catch(() => {});
  } catch (_) {
    token = null;
    showAuth();
  }
}
bootAuthenticatedApp();

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


// ════════════════════════════════════════════════════════════
// AUGUST SCHEDULER — frontend logic
// ════════════════════════════════════════════════════════════

let augScheduleData   = {};   // { owner: { '2026-08-01': [...] }, ... }
let augProgress       = {};   // { ok, generated, owners, today }
let augSelectedOwner  = null;
let augSelectedDay    = null;
let augCurrentMonth   = '2026-08';  // 'YYYY-MM' — current viewed month

const augView         = document.getElementById('august-schedule-view');
const augBtnBack      = document.getElementById('btn-august-back');
const augBtnGenerate  = document.getElementById('btn-august-generate');
const augBtnPrev      = document.getElementById('btn-aug-prev');
const augBtnNext      = document.getElementById('btn-aug-next');
const augMonthTitle   = document.getElementById('aug-month-title');
let AUG_SCHED_MONTHS = ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01'];
const AUG_MONTH_LABELS = {
  '2026-08': 'СЕРПЕНЬ 2026',
  '2026-09': 'ВЕРЕСЕНЬ 2026',
  '2026-10': 'ЖОВТЕНЬ 2026',
  '2026-11': 'ЛИСТОПАД 2026',
  '2026-12': 'ГРУДЕНЬ 2026',
  '2027-01': 'СІЧЕНЬ 2027',
};
const augCalGrid      = document.getElementById('august-cal-grid');
const augDaySection   = document.getElementById('august-day-section');
const augDayHeader    = document.getElementById('august-day-header');
const augDayCards     = document.getElementById('august-day-cards');
const augBarM1        = document.getElementById('aug-bar-m1');
const augBarM2        = document.getElementById('aug-bar-m2');
const augCountM1      = document.getElementById('aug-count-m1');
const augCountM2      = document.getElementById('aug-count-m2');
const augTabEls       = document.querySelectorAll('.august-tab');
const workspaceAugEntry = document.getElementById('workspace-august-entry');
const workspaceAugMeta  = document.getElementById('workspace-august-meta');
const plannerFocusEl = document.getElementById('planner-focus');
const plannerSettingsEl = document.getElementById('planner-settings');
const btnPlannerSettings = document.getElementById('btn-planner-settings');
const btnPlannerSettingsClose = document.getElementById('btn-planner-settings-close');
const btnPlannerSettingsSave = document.getElementById('btn-planner-settings-save');
const btnPlannerRefresh = document.getElementById('btn-planner-refresh');
const btnPlannerToday = document.getElementById('btn-planner-today');
const btnPlannerGenerate = document.getElementById('btn-planner-generate');
const btnPlannerLeads = document.getElementById('btn-planner-leads');
const plannerQuotaEl = document.getElementById('planner-quota');
const plannerSortEl = document.getElementById('planner-sort');
const plannerOwnerEl = document.getElementById('planner-owner');
const plannerSettingsStatusEl = document.getElementById('planner-settings-status');
const plannerWeekdayEls = document.querySelectorAll('.planner-weekday');
const plannerBriefQuotaEl = document.getElementById('planner-brief-quota');
const plannerBriefDaysEl = document.getElementById('planner-brief-days');
const plannerBriefSortEl = document.getElementById('planner-brief-sort');
const PLANNER_PREFS_KEY = 'arm_crm_planner_prefs_v1';
const DEFAULT_PLANNER_PREFS = { quota: 5, sort: 'priority', owner: 'Михайло Хлюпін', weekdays: [1, 2, 3, 4, 5] };
let plannerPrefs = { ...DEFAULT_PLANNER_PREFS };

try {
  const savedPlannerPrefs = JSON.parse(localStorage.getItem(PLANNER_PREFS_KEY) || 'null');
  if (savedPlannerPrefs && typeof savedPlannerPrefs === 'object') plannerPrefs = { ...DEFAULT_PLANNER_PREFS, ...savedPlannerPrefs };
} catch (_) {}

function syncPlannerSettingsForm() {
  if (plannerQuotaEl) plannerQuotaEl.value = String(plannerPrefs.quota || 5);
  if (plannerSortEl) plannerSortEl.value = plannerPrefs.sort || 'priority';
  if (plannerOwnerEl) plannerOwnerEl.value = plannerPrefs.owner || DEFAULT_PLANNER_PREFS.owner;
  const weekdays = Array.isArray(plannerPrefs.weekdays) ? plannerPrefs.weekdays : DEFAULT_PLANNER_PREFS.weekdays;
  plannerWeekdayEls.forEach(el => { el.checked = weekdays.includes(Number(el.value)); });
}

function renderPlannerBrief() {
  const dayLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
  const weekdays = Array.isArray(plannerPrefs.weekdays) && plannerPrefs.weekdays.length ? plannerPrefs.weekdays : DEFAULT_PLANNER_PREFS.weekdays;
  const first = Math.min(...weekdays);
  const last = Math.max(...weekdays);
  const contiguous = weekdays.length === (last - first + 1);
  const dayLabel = contiguous ? `${dayLabels[first - 1]}–${dayLabels[last - 1]}` : weekdays.map(day => dayLabels[day - 1]).join(' · ');
  const sortLabel = { priority: 'Гарячі першими', oldest: 'Найдавніші', owner: 'За менеджером' }[plannerPrefs.sort] || 'Гарячі першими';
  if (plannerBriefQuotaEl) plannerBriefQuotaEl.textContent = String(plannerPrefs.quota || DEFAULT_PLANNER_PREFS.quota);
  if (plannerBriefDaysEl) plannerBriefDaysEl.textContent = dayLabel;
  if (plannerBriefSortEl) plannerBriefSortEl.textContent = sortLabel;
}

function renderPlannerFocus() {
  if (!plannerFocusEl) return;
  const dateStr = augSelectedDay || augProgress.today || '';
  const ownerData = augScheduleData[augSelectedOwner] || {};
  const items = dateStr ? (ownerData[dateStr] || []) : [];
  const done = items.filter(item => item.status === 'done').length;
  const pending = items.filter(item => item.status !== 'done' && item.status !== 'skipped');
  const dateLabel = dateStr ? dateStr.split('-').reverse().join('.') : 'сьогодні';
  const focusLabel = dateStr === augProgress.today ? 'Сьогодні' : dateLabel;
  const ownerLabel = leadsLabel(LEADS_OWNER_LABELS, augSelectedOwner || plannerPrefs.owner || '');
  const hasPlan = Boolean(augProgress.generated);
  const emptyTitle = hasPlan ? 'На цей день дій немає' : 'Робочий ритм ще не налаштовано';
  const emptyText = hasPlan
    ? `Усі заплановані дії на ${dateStr === augProgress.today ? 'сьогодні' : 'цю дату'} завершені.`
    : 'Оберіть темп роботи — CRM розкладе нові ліди за робочими днями. Це можна змінити будь-коли.';
  plannerFocusEl.innerHTML = `
    <div class="planner-focus-kicker">${escHtml(focusLabel)}</div>
    <div class="planner-focus-main"><div><h2>${pending.length ? `${pending.length} дій у черзі` : emptyTitle}</h2><p>${pending.length ? `${escHtml(ownerLabel || 'Оберіть менеджера')} · ${done} виконано з ${items.length}` : emptyText}</p></div>${items.length ? `<span class="planner-focus-count">${done}/${items.length}</span>` : ''}</div>
    ${pending.length ? `<div class="planner-focus-list">${pending.slice(0, 3).map(item => `<button type="button" class="planner-focus-item" data-planner-lead="${Number(item.lead_id)}"><span>${escHtml(item.business_name || 'Без назви')}</span><small>${escHtml(AUG_PRI_LABEL[item.priority] || AUG_PRI_LABEL[`${item.priority || ''}`.replace(/^./, char => char.toUpperCase())] || 'Звичайний')}</small></button>`).join('')}</div>` : `<div class="planner-focus-empty"><button type="button" class="planner-empty-action" data-planner-empty-action="${hasPlan ? 'leads' : 'generate'}">${hasPlan ? 'Відкрити ліди' : 'Налаштувати ритм'}</button></div>`}
  `;
  plannerFocusEl.querySelectorAll('[data-planner-lead]').forEach(btn => btn.addEventListener('click', () => openLeadDetail(Number(btn.dataset.plannerLead))));
  plannerFocusEl.querySelector('[data-planner-empty-action]')?.addEventListener('click', (event) => {
    const action = event.currentTarget.dataset.plannerEmptyAction;
    if (action === 'generate') btnPlannerGenerate?.click();
    else openLeadsSidebar();
  });
}

function setPlannerSettingsOpen(open) {
  if (!plannerSettingsEl) return;
  plannerSettingsEl.hidden = !open;
  document.body.classList.toggle('planner-settings-open', open);
  if (open) {
    syncPlannerSettingsForm();
    requestAnimationFrame(() => plannerQuotaEl?.focus());
  } else {
    btnPlannerSettings?.focus();
  }
}

async function savePlannerSettings() {
  if (btnPlannerSettingsSave?.disabled) return;
  plannerPrefs = {
    quota: Math.min(30, Math.max(1, Number(plannerQuotaEl?.value || 5))),
    sort: plannerSortEl?.value || 'priority',
    owner: plannerOwnerEl?.value || DEFAULT_PLANNER_PREFS.owner,
    weekdays: Array.from(plannerWeekdayEls).filter(el => el.checked).map(el => Number(el.value)),
  };
  if (!plannerPrefs.weekdays.length) plannerPrefs.weekdays = [...DEFAULT_PLANNER_PREFS.weekdays];
  try { localStorage.setItem(PLANNER_PREFS_KEY, JSON.stringify(plannerPrefs)); } catch (_) {}
  renderPlannerBrief();
  if (plannerSettingsStatusEl) plannerSettingsStatusEl.textContent = 'Застосовую зміни…';
  if (btnPlannerSettingsSave) {
    btnPlannerSettingsSave.disabled = true;
    btnPlannerSettingsSave.textContent = 'Застосовую…';
  }
  const isAdmin = me?.role === 'admin' || me?.role === 'platform_admin';
  if (isAdmin) {
    try {
      await api('POST', '/leads/schedule/generate', {
        reset_future_only: true,
        quota: plannerPrefs.quota,
        sort: plannerPrefs.sort,
        weekdays: plannerPrefs.weekdays,
      });
      await loadAugustData();
      if (plannerSettingsStatusEl) plannerSettingsStatusEl.textContent = 'Застосовано щойно · план оновлено.';
      recordActivity({ kind: 'planner', title: 'Змінено налаштування плану', detail: `${plannerPrefs.quota} контактів · ${plannerPrefs.sort}` });
      setPlannerSettingsOpen(false);
      showToast('Налаштування збережено. План перебудовано.');
    } catch (err) {
      if (plannerSettingsStatusEl) plannerSettingsStatusEl.textContent = 'Не вдалося оновити план. Перевірте з’єднання й спробуйте ще раз.';
      if (btnPlannerSettingsSave) {
        btnPlannerSettingsSave.disabled = false;
        btnPlannerSettingsSave.textContent = 'Спробувати ще раз';
      }
      showToast(err.message || 'Не вдалося перебудувати план.', true);
    }
  } else {
    if (plannerSettingsStatusEl) plannerSettingsStatusEl.textContent = 'Збережено для цього браузера.';
    if (augSelectedOwner !== plannerPrefs.owner && augScheduleData[plannerPrefs.owner]) {
      augSelectedOwner = plannerPrefs.owner;
      renderAugustCalendar();
      renderPlannerFocus();
    }
    recordActivity({ kind: 'planner', title: 'Змінено налаштування плану', detail: `${plannerPrefs.quota} контактів · ${plannerPrefs.sort}` });
    setPlannerSettingsOpen(false);
    showToast('Налаштування збережено для цього браузера.');
  }
  if (btnPlannerSettingsSave) {
    btnPlannerSettingsSave.disabled = false;
    btnPlannerSettingsSave.textContent = 'Зберегти й застосувати';
  }
}

const AUG_DAYS = ['ПН','ВТ','СР','ЧТ','ПТ','СБ','НД'];
const AUG_MONTHS_UA = ['Січень','Лютий','Березень','Квітень','Травень','Червень',
                       'Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
const AUG_WEEKDAYS_UA = ['Неділя','Понеділок','Вівторок','Середа','Четвер','Пятниця','Субота'];

const AUG_PRIORITY_ORDER = { Hot: 0, High: 1, Medium: 2, Low: 3, Watch: 4 };
const AUG_PRI_LABEL = { Hot: 'Гарячий', High: 'Високий пріоритет', Medium: 'Звичайний', Low: 'Низький', Watch: 'Спостереження' };

function renderAugOwnerTabs(owners) {
  const tabsContainer = document.querySelector('.august-tabs');
  const availableOwners = (owners || []).filter(Boolean);
  if (!tabsContainer || !availableOwners.length) return;
  if (!augSelectedOwner || !availableOwners.includes(augSelectedOwner)) {
    augSelectedOwner = availableOwners.includes(plannerPrefs.owner) ? plannerPrefs.owner : availableOwners[0];
  }
  tabsContainer.hidden = availableOwners.length < 2;
  tabsContainer.innerHTML = availableOwners.map((owner) =>
    `<button type="button" class="august-tab ${augSelectedOwner === owner ? 'active' : ''}" data-owner="${escHtml(owner)}">${escHtml(leadsLabel(LEADS_OWNER_LABELS, owner))}</button>`
  ).join('');
  tabsContainer.querySelectorAll('.august-tab').forEach(tabEl => {
    tabEl.addEventListener('click', () => {
      tabsContainer.querySelectorAll('.august-tab').forEach(item => item.classList.remove('active'));
      tabEl.classList.add('active');
      augSelectedOwner = tabEl.dataset.owner;
      augSelectedDay = null;
      if (augDaySection) augDaySection.hidden = true;
      renderAugustCalendar();
      renderPlannerFocus();
    });
  });
}

function openAugustScheduleView() {
  const v = document.getElementById('august-schedule-view');
  syncPlannerSettingsForm();
  renderAugOwnerTabs(
    (me && me.role === 'manager' && me.crm_owner) ? [me.crm_owner] : LEADS_OWNER_OPTIONS
  );
  if (v && prepareWorkspaceView && typeof prepareWorkspaceView === 'function') {
    if (!prepareWorkspaceView(v, workspaceAugEntry, 'План контактів')) return;
  } else {
    hideWorkspaceViews(v);
    if (v) v.hidden = false;
  }
  loadAugustData();
}

async function loadAugustData() {
  if (plannerFocusEl) {
    plannerFocusEl.innerHTML = '<div class="planner-focus-main"><div><h2>Оновлюю робочий ритм…</h2><p>Звіряємо чергу з CRM та календарем.</p></div></div>';
  }
  if (augDaySection) augDaySection.hidden = true;
  const loadingCalendar = augCalGrid?.closest('.august-calendar-section');
  if (loadingCalendar) loadingCalendar.hidden = true;
  try {
    const progress = await api('GET', '/leads/schedule/progress');
    augProgress = progress;
    if (Array.isArray(progress.months) && progress.months.length) {
      AUG_SCHED_MONTHS = progress.months;
      const todayMonth = String(progress.today || '').slice(0, 7);
      if (todayMonth && AUG_SCHED_MONTHS.includes(todayMonth)) augCurrentMonth = todayMonth;
      else if (!AUG_SCHED_MONTHS.includes(augCurrentMonth)) augCurrentMonth = AUG_SCHED_MONTHS[0];
    }
    renderPlannerBrief();
    updateAugProgressBars(progress);

    if (!progress.generated) {
      renderAugEmptyState();
      return;
    }
    const schedData = await api('GET', '/leads/schedule/august');
    augScheduleData = schedData;
    renderAugOwnerTabs(Object.keys(schedData));
    renderAugustCalendar();
    renderPlannerFocus();

    // Відкрити сьогодні, а якщо сьогодні порожньо — найближчий запланований день.
    // Користувач одразу бачить робочу чергу, а не порожній календар.
    const today = progress.today;
    const ownerData = augScheduleData[augSelectedOwner] || {};
    const plannedDays = Object.keys(ownerData).filter(date => (ownerData[date] || []).length).sort();
    const firstUpcomingDay = plannedDays.find(date => !today || date >= today);
    const initialDay = today && (ownerData[today] || []).length ? today : (firstUpcomingDay || plannedDays[plannedDays.length - 1]);
    if (initialDay && AUG_SCHED_MONTHS.some(month => initialDay.startsWith(month))) {
      augSelectedDay = initialDay;
      renderAugDayCards(initialDay);
      renderPlannerFocus();
    }
  } catch (err) {
    renderAugLoadError(err);
    showToast(err.message || 'Не вдалося оновити робочий ритм.', true);
  }
}

function renderAugLoadError(err) {
  if (augDaySection) augDaySection.hidden = true;
  const calendarSection = augCalGrid?.closest('.august-calendar-section');
  if (calendarSection) calendarSection.hidden = true;
  if (!plannerFocusEl) return;
  plannerFocusEl.innerHTML = `
    <div class="planner-focus-main">
      <div><h2>Не вдалося оновити чергу</h2><p>${escHtml(err?.message || 'Сервер короткочасно недоступний. Дані не змінені.')}</p></div>
      <button type="button" class="btn-secondary planner-retry-btn" data-planner-retry>Спробувати ще раз</button>
    </div>`;
  plannerFocusEl.querySelector('[data-planner-retry]')?.addEventListener('click', () => loadAugustData());
}

function updateAugProgressBars(progress) {
  const owners = progress.owners || {};
  const ownerKeys = LEADS_OWNER_OPTIONS.length ? LEADS_OWNER_OPTIONS : Object.keys(owners);
  const m1 = owners[ownerKeys[0]] || {};
  const m2 = owners[ownerKeys[1]] || {};
  const row1 = document.getElementById('august-progress-m1');
  const row2 = document.getElementById('august-progress-m2');
  const name1 = row1 && row1.querySelector('.august-owner-name');
  const name2 = row2 && row2.querySelector('.august-owner-name');
  if (name1 && ownerKeys[0]) name1.textContent = `Менеджер ${leadsLabel(LEADS_OWNER_LABELS, ownerKeys[0])}`;
  if (name2 && ownerKeys[1]) name2.textContent = `Менеджер ${leadsLabel(LEADS_OWNER_LABELS, ownerKeys[1])}`;
  if (row1) row1.hidden = !ownerKeys[0] || !owners[ownerKeys[0]];
  if (row2) row2.hidden = !ownerKeys[1] || !owners[ownerKeys[1]];

  if (augBarM1)  augBarM1.style.width  = (m1.percent || 0) + '%';
  if (augBarM2)  augBarM2.style.width  = (m2.percent || 0) + '%';
  if (augCountM1) augCountM1.textContent = m1.total ? `${m1.done}/${m1.total} (${m1.percent}%)` : '—';
  if (augCountM2) augCountM2.textContent = m2.total ? `${m2.done}/${m2.total} (${m2.percent}%)` : '—';

  // Update sidebar meta
  const myOwner = (me && me.role === 'manager') ? me.crm_owner : LEADS_OWNER_OPTIONS[0];
  const myData = owners[myOwner] || {};
  if (workspaceAugMeta) {
    if (myData.today_total) {
      workspaceAugMeta.textContent = `${myData.today_done}/${myData.today_total} ✓`;
    } else {
      workspaceAugMeta.textContent = '—';
    }
  }
}

function renderAugEmptyState() {
  if (augCalGrid) augCalGrid.innerHTML = '';
  if (augDaySection) augDaySection.hidden = true;
  const calendarSection = augCalGrid?.closest('.august-calendar-section');
  if (calendarSection) {
    calendarSection.hidden = true;
  }
  renderPlannerFocus();
}

function renderAugustCalendar() {
  if (!augCalGrid) return;
  const calendarSection = augCalGrid.closest('.august-calendar-section');
  if (calendarSection) calendarSection.hidden = false;
  augCalGrid.innerHTML = '';

  // Update month title and nav buttons
  if (augMonthTitle) augMonthTitle.textContent = AUG_MONTH_LABELS[augCurrentMonth] || augCurrentMonth;
  if (augBtnPrev) augBtnPrev.disabled = augCurrentMonth === AUG_SCHED_MONTHS[0];
  if (augBtnNext) augBtnNext.disabled = augCurrentMonth === AUG_SCHED_MONTHS[AUG_SCHED_MONTHS.length - 1];

  // Header row: ПН ВТ СР ЧТ ПТ СБ НД
  AUG_DAYS.forEach(d => {
    const el = document.createElement('div');
    el.className = 'aug-cal-day-label';
    el.textContent = d;
    augCalGrid.appendChild(el);
  });

  // Month-aware first day offset (Monday-first)
  const [year, month] = augCurrentMonth.split('-').map(Number);
  const firstDay = new Date(year, month - 1, 1).getDay();
  const offset = firstDay === 0 ? 6 : firstDay - 1;
  const daysInMonth = new Date(year, month, 0).getDate();

  // Empty cells before 1st
  for (let i = 0; i < offset; i++) {
    const el = document.createElement('div');
    augCalGrid.appendChild(el);
  }

  const today = (augProgress.today || '');
  const ownerData = augScheduleData[augSelectedOwner] || {};

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${augCurrentMonth}-${String(d).padStart(2, '0')}`;
    const dayLeads = ownerData[dateStr] || [];
    const done = dayLeads.filter(l => l.status === 'done').length;
    const total = dayLeads.length;
    const isPast = dateStr < today;
    const isToday = dateStr === today;
    const isSelected = dateStr === augSelectedDay;

    const el = document.createElement('div');
    el.className = 'aug-cal-day';
    if (!total) el.classList.add('aug-empty');
    else if (isPast) el.classList.add('aug-past');
    if (isToday) el.classList.add('aug-today');
    if (isSelected) el.classList.add('aug-selected');
    if (total && done === total) el.classList.add('aug-done');

    el.innerHTML = `
      <span class="aug-cal-num">${d}</span>
      ${total ? `<span class="aug-cal-status">${done === total ? 'Виконано' : `${total} задач`}</span>` : ''}
    `;

    if (total) {
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', `${d} ${AUG_MONTHS_UA[month - 1]}: ${done} виконано з ${total}`);
      const selectDay = () => {
        augSelectedDay = dateStr;
        document.querySelectorAll('.aug-cal-day.aug-selected').forEach(e => e.classList.remove('aug-selected'));
        el.classList.add('aug-selected');
        renderAugDayCards(dateStr);
        renderPlannerFocus();
      };
      el.addEventListener('click', selectDay);
      el.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectDay();
        }
      });
    }
    augCalGrid.appendChild(el);
  }
}

function renderAugDayCards(dateStr) {
  if (!augDaySection || !augDayCards || !augDayHeader) return;
  const ownerData = augScheduleData[augSelectedOwner] || {};
  const items = ownerData[dateStr] || [];
  const done = items.filter(l => l.status === 'done').length;
  const today = augProgress.today || '';

  // Parse date for display
  const [y, m, d] = dateStr.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const weekdayName = AUG_WEEKDAYS_UA[dateObj.getDay()];
  const allDone = items.length > 0 && done === items.length;

  augDayHeader.innerHTML = `
    <div class="august-day-title">${weekdayName}, ${d} ${AUG_MONTHS_UA[m - 1].toLowerCase()}</div>
    <div class="august-day-progress ${allDone ? 'all-done' : ''}">${allDone ? '✓ Виконано' : `${done} з ${items.length}`}</div>
  `;

  if (!items.length) {
    augDayCards.innerHTML = '<div class="august-empty"><p>На цей день лідів не заплановано.</p></div>';
    augDaySection.hidden = false;
    return;
  }

  augDayCards.innerHTML = items.map(item => {
    const priClass = `aug-pri-${item.priority || 'Medium'}`;
    const cardClass = item.status === 'done' ? 'aug-card-done' : item.status === 'skipped' ? 'aug-card-skipped' : '';
    const metaLine = [item.category, item.city_area, item.country].filter(Boolean).join(' · ');
    const phoneHref = String(item.phone || '').replace(/[^+\d]/g, '');
    const igHandle = String(item.instagram || '').replace(/^@/, '');
    const contactLinks = [
      igHandle ? `<a href="https://instagram.com/${escHtml(igHandle)}" target="_blank" rel="noopener">Instagram</a>` : '',
      phoneHref ? `<a href="tel:${escHtml(phoneHref)}">Зателефонувати</a>` : '',
      item.email ? `<a href="mailto:${escHtml(item.email)}">Написати email</a>` : '',
    ].filter(Boolean);
    return `
      <div class="aug-lead-card ${cardClass}" data-sched-id="${item.sched_id}">
        <span class="aug-slot-num">#${item.slot}</span>
        <div class="aug-lead-name">${escHtml(item.business_name || 'Без назви')}</div>
        <span class="aug-lead-priority ${priClass}">${AUG_PRI_LABEL[item.priority] || 'Звичайний'}</span>
        ${metaLine ? `<div class="aug-lead-meta">${escHtml(metaLine)}</div>` : ''}
        <div class="aug-contact-status">${contactLinks.length ? `Доступно каналів: ${contactLinks.length}` : 'Контакт потребує перевірки'}</div>
        <div class="aug-card-actions">
          <button type="button" class="aug-btn-done" data-sched-id="${item.sched_id}" data-status="${item.status}">
            ${item.status === 'done' ? '✓ Зроблено' : '✓ Зробити'}
          </button>
          <details class="aug-card-menu">
            <summary aria-label="Додаткові дії">•••</summary>
            <div class="aug-card-menu-popover">
              ${contactLinks.length ? `<div class="aug-card-menu-links">${contactLinks.join('')}</div>` : ''}
              <button type="button" class="aug-btn-open" data-lead-id="${item.lead_id}">Відкрити картку</button>
              <button type="button" class="aug-btn-skip" data-sched-id="${item.sched_id}">${item.status === 'skipped' ? 'Повернути в план' : 'Пропустити'}</button>
            </div>
          </details>
        </div>
      </div>`;
  }).join('');

  // Bind card action buttons
  augDayCards.querySelectorAll('.aug-btn-done').forEach(btn => {
    btn.addEventListener('click', async () => {
      const sid = Number(btn.dataset.schedId);
      const curStatus = btn.dataset.status;
      const newStatus = curStatus === 'done' ? 'pending' : 'done';
      await markAugScheduleLead(sid, newStatus, dateStr);
    });
  });
  augDayCards.querySelectorAll('.aug-btn-skip').forEach(btn => {
    btn.addEventListener('click', async () => {
      const sid = Number(btn.dataset.schedId);
      const card = btn.closest('.aug-lead-card');
      const curStatus = card.classList.contains('aug-card-skipped') ? 'pending' : 'skipped';
      await markAugScheduleLead(sid, curStatus, dateStr);
    });
  });
  augDayCards.querySelectorAll('.aug-btn-open').forEach(btn => {
    btn.addEventListener('click', () => openLeadDetail(Number(btn.dataset.leadId)));
  });

  augDaySection.hidden = false;
}

async function markAugScheduleLead(schedId, status, dateStr) {
  try {
    await api('PATCH', `/leads/schedule/${schedId}/status`, { status });
    // Update local data
    const ownerData = augScheduleData[augSelectedOwner] || {};
    const items = ownerData[dateStr] || [];
    const item = items.find(i => i.sched_id === schedId);
    if (item) {
      item.status = status;
      item.completed_at = status === 'done' ? new Date().toISOString() : null;
      recordActivity({ kind: 'planner', leadId: item.lead_id, leadName: item.business_name || '', title: status === 'done' ? 'Контакт позначено виконаним' : status === 'skipped' ? 'Контакт пропущено' : 'Повернуто контакт у план', detail: `${dateStr} · планувальник` });
    }
    // Refresh progress
    const progress = await api('GET', '/leads/schedule/progress');
    augProgress = progress;
    updateAugProgressBars(progress);
    // Re-render calendar and day
    renderAugustCalendar();
    renderAugDayCards(dateStr);
    renderPlannerFocus();
  } catch (err) {
    showToast(err.message || 'Помилка оновлення', true);
  }
}

// Month navigation
if (augBtnPrev) {
  augBtnPrev.addEventListener('click', () => {
    const idx = AUG_SCHED_MONTHS.indexOf(augCurrentMonth);
    if (idx > 0) {
      augCurrentMonth = AUG_SCHED_MONTHS[idx - 1];
      augSelectedDay = null;
      if (augDaySection) augDaySection.hidden = true;
      renderAugustCalendar();
    }
  });
}
if (augBtnNext) {
  augBtnNext.addEventListener('click', () => {
    const idx = AUG_SCHED_MONTHS.indexOf(augCurrentMonth);
    if (idx < AUG_SCHED_MONTHS.length - 1) {
      augCurrentMonth = AUG_SCHED_MONTHS[idx + 1];
      augSelectedDay = null;
      if (augDaySection) augDaySection.hidden = true;
      renderAugustCalendar();
    }
  });
}

// Back button
if (augBtnBack) {
  augBtnBack.addEventListener('click', () => {
    closeWorkspaceView();
  });
}

if (btnPlannerSettings) btnPlannerSettings.addEventListener('click', () => setPlannerSettingsOpen(true));
if (btnPlannerSettingsClose) btnPlannerSettingsClose.addEventListener('click', () => setPlannerSettingsOpen(false));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && plannerSettingsEl && !plannerSettingsEl.hidden) setPlannerSettingsOpen(false);
});
if (btnPlannerSettingsSave) btnPlannerSettingsSave.addEventListener('click', savePlannerSettings);
if (btnPlannerRefresh) btnPlannerRefresh.addEventListener('click', () => loadAugustData());
if (btnPlannerToday) btnPlannerToday.addEventListener('click', () => {
  const today = augProgress.today || '';
  if (!today) return;
  augCurrentMonth = today.slice(0, 7);
  augSelectedDay = today;
  renderAugustCalendar();
  renderAugDayCards(today);
  renderPlannerFocus();
});
if (btnPlannerLeads) btnPlannerLeads.addEventListener('click', () => openLeadsSidebar());
if (btnPlannerGenerate) btnPlannerGenerate.addEventListener('click', async () => {
  btnPlannerGenerate.disabled = true;
  btnPlannerGenerate.textContent = 'Пересобираю…';
  try {
    const res = await api('POST', '/leads/schedule/generate', { reset_future_only: false });
    recordActivity({ kind: 'planner', title: 'Перебудовано план контактів', detail: 'Синхронізовано з CRM' });
    showToast(`План оновлено: ${Number(res?.results?.reduce((sum, item) => sum + Number(item.scheduled || 0), 0) || 0)} контактів.`);
    await loadAugustData();
  } catch (err) {
    showToast(err.message || 'Не вдалося оновити план.', true);
  } finally {
    btnPlannerGenerate.disabled = false;
    btnPlannerGenerate.textContent = 'Оновити план';
  }
});

// Generate schedule (legacy admin affordance, kept for compatibility)
if (augBtnGenerate) {
  augBtnGenerate.addEventListener('click', async () => {
    const already = augProgress.generated;
    if (already) {
      const ok = window.confirm('Розклад вже існує. Перегенерувати (скинути всі невиконані дні)?');
      if (!ok) return;
    }
    augBtnGenerate.disabled = true;
    augBtnGenerate.textContent = 'Генерую…';
    try {
      const res = await api('POST', '/leads/schedule/generate', { reset_future_only: false });
      const results = res.results || [];
      recordActivity({ kind: 'planner', title: 'Згенеровано розклад контактів', detail: `${results.reduce((sum, item) => sum + Number(item.scheduled || 0), 0)} контактів` });
      showToast(`Розклад серпня створено: ${results.map(r => `${r.owner.replace('Manager ', 'М')}: ${r.scheduled} лідів`).join(', ')}`);
      await loadAugustData();
    } catch (err) {
      showToast(err.message || 'Помилка генерації', true);
    } finally {
      augBtnGenerate.disabled = false;
      augBtnGenerate.textContent = 'Згенерувати розклад';
    }
  });
}

// Sidebar entry
if (workspaceAugEntry) {
  workspaceAugEntry.addEventListener('click', openAugustScheduleView);
}


// ════════════════════════════════════════════════════════════
// ANALYTICS DASHBOARD
// ════════════════════════════════════════════════════════════

const analyticsView      = document.getElementById('analytics-dashboard-view');
const workspaceAnalytics = document.getElementById('workspace-analytics-entry');
const btnAnalyticsBack   = document.getElementById('btn-analytics-back');
const btnAnalyticsRef    = document.getElementById('btn-analytics-refresh');
const analyticsLoading   = document.getElementById('analytics-loading');
const analyticsGrid      = document.getElementById('analytics-grid');

function openAnalyticsDashboard() {
  const v = document.getElementById('analytics-dashboard-view');
  if (v && prepareWorkspaceView && typeof prepareWorkspaceView === 'function') {
    if (!prepareWorkspaceView(v, workspaceAnalytics, 'Аналітика')) return;
  } else {
    hideWorkspaceViews(v);
    if (v) v.hidden = false;
  }
  loadAnalyticsData();
}

async function loadAnalyticsData() {
  if (analyticsLoading) {
    analyticsLoading.hidden = false;
    analyticsLoading.innerHTML = '<div class="wow-spinner" aria-hidden="true"></div><div>Оновлюємо аналітику…</div>';
  }
  if (analyticsGrid) analyticsGrid.hidden = true;
  
  try {
    const data = await api('GET', '/leads/analytics/dashboard');
    renderAnalytics(data);
    if (analyticsLoading) analyticsLoading.hidden = true;
    if (analyticsGrid) analyticsGrid.hidden = false;
  } catch (err) {
    if (analyticsLoading) {
      analyticsLoading.innerHTML = `<strong>Не вдалося завантажити аналітику</strong><span>${escHtml(err.message || 'Спробуйте оновити ще раз.')}</span>`;
    }
  }
}


// WOW Analytics animations
function animateValue(obj, start, end, duration) {
  if (!obj) return;
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    obj.innerHTML = Math.floor(progress * (end - start) + start);
    if (progress < 1) {
      window.requestAnimationFrame(step);
    }
  };
  window.requestAnimationFrame(step);
}

function renderAnalytics(data) {
  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };
  const renderCol = (ownerId, m) => {
    const id = ownerId === LEADS_OWNER_OPTIONS[0] ? 'm1' : 'm2';
    
    // Animate numbers
    const totalEl = document.getElementById(`an-total-${id}`);
    if (totalEl) totalEl.textContent = `${m.total_leads} в роботі`;
    
    // Donut animations
    setTimeout(() => {
      const contactSvg = document.getElementById(`an-contact-svg-${id}`);
      const winSvg = document.getElementById(`an-win-svg-${id}`);
      if (contactSvg) contactSvg.setAttribute('stroke-dasharray', `${m.contact_rate}, 100`);
      if (winSvg) winSvg.setAttribute('stroke-dasharray', `${m.win_rate}, 100`);
    }, 100);
    
    animateValue(document.getElementById(`an-contact-rate-${id}`), 0, m.contact_rate, 1500);
    animateValue(document.getElementById(`an-win-rate-${id}`), 0, m.win_rate, 1500);
    setTimeout(() => {
       const contactRate = document.getElementById(`an-contact-rate-${id}`);
       const winRate = document.getElementById(`an-win-rate-${id}`);
       if (contactRate) contactRate.textContent += '%';
       if (winRate) winRate.textContent += '%';
    }, 1510);
    
    // Speed
    const speedEl = document.getElementById(`an-speed-${id}`);
    if (m.avg_speed_hours !== null) {
      speedEl.textContent = m.avg_speed_hours;
    } else {
      speedEl.textContent = '—';
    }
    const speedMark = document.getElementById(`an-crown-speed-${id}`);
    if (speedMark) speedMark.hidden = !m.is_winner_speed;
    
    // Schedule
    setText(`an-sched-rate-${id}`, m.sched_rate + '%');
    setTimeout(() => {
      const bar = document.getElementById(`an-sched-bar-${id}`);
      if (bar) bar.style.width = m.sched_rate + '%';
    }, 200);
    setText(`an-sched-val-${id}`, `${m.sched_done}/${m.sched_total}`);
    
    // Activity
    animateValue(document.getElementById(`an-act-${id}`), 0, m.activity_count, 1000);
    
    // WOW logic: Power Score and Ranks
    animateValue(document.getElementById(`wow-score-${id}`), 0, m.power_score, 2000);
    setText(`wow-rank-${id}`, m.rank);
    
    // Leader & Fire styling
    const colEl = document.getElementById(`analytics-${id}`);
    const hdrEl = document.getElementById(`wow-header-${id}`);
    if (m.is_leader && colEl && hdrEl) {
      colEl.classList.add('wow-is-leader');
      hdrEl.classList.add('wow-glow-green');
    } else if (colEl && hdrEl) {
      colEl.classList.remove('wow-is-leader');
      hdrEl.classList.remove('wow-glow-green');
    }
    
    if (m.is_on_fire && colEl) {
      colEl.classList.add('wow-on-fire');
    } else if (colEl) {
      colEl.classList.remove('wow-on-fire');
    }
  };
  
  
  const ownerOne = LEADS_OWNER_OPTIONS[0];
  const ownerTwo = LEADS_OWNER_OPTIONS[1];
  const colOne = document.getElementById('analytics-m1');
  const colTwo = document.getElementById('analytics-m2');
  if (colOne) colOne.hidden = !ownerOne || !data[ownerOne];
  if (colTwo) colTwo.hidden = !ownerTwo || !data[ownerTwo];

  // Update manager names in headers
  if (LEADS_OWNER_OPTIONS[0]) {
    const titleM1 = document.querySelector('#wow-header-m1 .wow-owner-name');
    if (titleM1) titleM1.textContent = leadsLabel(LEADS_OWNER_LABELS, LEADS_OWNER_OPTIONS[0]);
    if (data[LEADS_OWNER_OPTIONS[0]]) renderCol(LEADS_OWNER_OPTIONS[0], data[LEADS_OWNER_OPTIONS[0]]);
  }
  if (LEADS_OWNER_OPTIONS[1]) {
    const titleM2 = document.querySelector('#wow-header-m2 .wow-owner-name');
    if (titleM2) titleM2.textContent = leadsLabel(LEADS_OWNER_LABELS, LEADS_OWNER_OPTIONS[1]);
    if (data[LEADS_OWNER_OPTIONS[1]]) renderCol(LEADS_OWNER_OPTIONS[1], data[LEADS_OWNER_OPTIONS[1]]);
  }
  
  // Update VS text
  const vsText = document.getElementById('wow-h2h-vs');
  const visibleOwners = Object.keys(data);
  const scoreOne = document.querySelector('.wow-h2h-m1');
  const scoreTwo = document.querySelector('.wow-h2h-m2');
  if (scoreOne) scoreOne.hidden = !ownerOne || !data[ownerOne];
  if (scoreTwo) scoreTwo.hidden = !ownerTwo || !data[ownerTwo];
  const columnsWrap = document.querySelector('.wow-cols-wrap');
  if (columnsWrap) columnsWrap.classList.toggle('wow-single-owner', visibleOwners.length === 1);
  if (!vsText) return;
  if (visibleOwners.length === 1) {
    vsText.textContent = 'МОЇ РЕЗУЛЬТАТИ';
  } else if (LEADS_OWNER_OPTIONS[0] && data[LEADS_OWNER_OPTIONS[0]]?.is_leader) {
    vsText.innerHTML = '<span style="color:#4caf82">ВЕДЕ В РАХУНКУ</span> ←';
  } else if (LEADS_OWNER_OPTIONS[1] && data[LEADS_OWNER_OPTIONS[1]]?.is_leader) {
    vsText.innerHTML = '→ <span style="color:#4caf82">ВЕДЕ В РАХУНКУ</span>';
  } else {
    vsText.textContent = 'НІЧИЯ';
  }
}

if (workspaceAnalytics) workspaceAnalytics.addEventListener('click', openAnalyticsDashboard);
if (btnAnalyticsBack) btnAnalyticsBack.addEventListener('click', () => {
  if (analyticsView) analyticsView.hidden = true;
  openLeadsWorkQueue();
});
if (btnAnalyticsRef) btnAnalyticsRef.addEventListener('click', loadAnalyticsData);

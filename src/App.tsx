import React, { useState, Fragment, useEffect, createContext, useContext, Component, useRef, useMemo } from 'react';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import florenceCardImage from './assets/cards/florence.png';
import tuscanyHillsCardImage from './assets/cards/tuscany-hills.png';
import veniceCardImage from './assets/cards/venice.png';
import tuscanyVillaCardImage from './assets/cards/tuscany-villa.png';
import veniceCityImage from './assets/italy/venice-city.png';
import florenceDuomoImage from './assets/italy/florence-duomo.png';
import valdorciaHillsImage from './assets/italy/valdorcia-hills.png';
import valdorciaChapelImage from './assets/italy/valdorcia-chapel.png';
import sicilyEmblemImage from './assets/italy/sicily-emblem.png';

export class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: string | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(err: Error): { error: string | null } { return { error: err.message }; }
  render() {
    if (this.state.error) {
      const tt = translations[getStoredLanguage()];
      return (
        <div style={{ position: 'fixed', inset: 0, background: '#07150f', color: '#ddd8cc', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, fontFamily: 'sans-serif' }}>
          <div style={{ fontSize: 20 }}>{tt.error_boundary_title}</div>
          <div style={{ fontSize: 13, color: 'rgba(220,215,200,0.6)', maxWidth: 400, textAlign: 'center' }}>{this.state.error}</div>
          <button onClick={() => window.location.reload()} style={{ marginTop: 8, padding: '10px 20px', borderRadius: 10, background: gold, color: text.primary, border: 'none', cursor: 'pointer', fontWeight: 600 }}>{tt.error_boundary_refresh}</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Design tokens ────────────────────────────────────────────
// Champagne-platinum palette — muted, private-banking feel
const gold        = '#b8b09a';   // warm platinum (was bright gold)
const goldDark    = '#7a7265';   // dark platinum
const goldLight   = '#d4ccbc';   // light champagne
const bg = {
  card:   'rgba(255,255,255,0.042)',
  card2:  'rgba(255,255,255,0.026)',
  border: 'rgba(180,172,155,0.08)',
  hover:  'rgba(255,255,255,0.06)',
};
const text = {
  primary:   '#f0ece4',
  secondary: '#ddd8cc',
  muted:     'rgba(200,194,180,0.62)',
  dim:       'rgba(200,194,180,0.38)',
  gold:      gold,
};
const radius = { sm: 10, md: 14, lg: 18, xl: 22, '2xl': 28 };
const fontFamily = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// ─── Type scale helpers ───────────────────────────────────────
const T = {
  /** 36px display — balance hero */
  hero:    { fontSize: 36, fontWeight: 700, letterSpacing: -1.2, lineHeight: 1.1 } as React.CSSProperties,
  /** 28px screen title */
  h1:      { fontSize: 28, fontWeight: 700, letterSpacing: -0.7, lineHeight: 1.2 } as React.CSSProperties,
  /** 22px section heading */
  h2:      { fontSize: 22, fontWeight: 600, letterSpacing: -0.4, lineHeight: 1.25 } as React.CSSProperties,
  /** 17px card/panel title */
  h3:      { fontSize: 17, fontWeight: 600, letterSpacing: -0.2, lineHeight: 1.3 } as React.CSSProperties,
  /** 15px body large */
  bodyLg:  { fontSize: 15, fontWeight: 400, lineHeight: 1.5 } as React.CSSProperties,
  /** 14px body default */
  body:    { fontSize: 14, fontWeight: 400, lineHeight: 1.5 } as React.CSSProperties,
  /** 13px small */
  sm:      { fontSize: 13, fontWeight: 400, lineHeight: 1.45 } as React.CSSProperties,
  /** 11px caption — uppercase labels */
  caption: { fontSize: 11, fontWeight: 600, letterSpacing: 1.1, textTransform: 'uppercase' as const, lineHeight: 1.2 } as React.CSSProperties,
  /** tabular numbers */
  num:     { fontFeatureSettings: '"tnum" 1, "kern" 1' } as React.CSSProperties,
};

// ─── Liquid glass card ────────────────────────────────────────
const glassCard = (extra?: React.CSSProperties): React.CSSProperties => ({
  background: 'rgba(255,255,255,0.05)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: `1px solid ${bg.border}`,
  borderRadius: radius.xl,
  ...extra,
});

function BrandMark({
  size,
  radiusValue,
  elevated = false,
}: {
  size: number;
  radiusValue: number;
  elevated?: boolean;
}) {
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: radiusValue,
      position: 'relative',
      overflow: 'hidden',
      flexShrink: 0,
      background: 'linear-gradient(155deg, rgba(20,42,30,0.98) 0%, rgba(9,20,14,0.98) 100%)',
      border: '1px solid rgba(212,204,188,0.16)',
      boxShadow: elevated
        ? '0 12px 28px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.08)'
        : '0 4px 14px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.06)',
    }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(circle at 28% 24%, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 56%)',
        pointerEvents: 'none',
      }} />
      <img
        src={sicilyEmblemImage}
        alt="ARM Bank Sicily emblem"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
          transform: elevated ? 'scale(1.02)' : 'scale(1)',
          filter: elevated ? 'saturate(0.96) contrast(1.03)' : 'saturate(0.94) contrast(1.02)',
        }}
      />
    </div>
  );
}

// ─── Shared section-label style ───────────────────────────────
const sectionLabel: React.CSSProperties = {
  ...T.caption, color: text.dim, padding: '0 6px 10px',
};

// ─── Layout context ───────────────────────────────────────────
const LayoutCtx = createContext<'mobile' | 'desktop'>('mobile');
const useLayout = () => useContext(LayoutCtx);

// ─── App context (logout + navigation + toast + user + data) ─
type TabKey = 'overview' | 'operations' | 'cards' | 'market' | 'profile';
type TransferMode = 'topup' | 'by_card' | 'by_account';
interface UserInfo { full_name: string; phone: string; email: string; bank_account_number?: string; }
interface AccountInfo { id: number; account_number: string; balance: number; currency: string; }
interface TxItem { id: number; tx_type: string; direction: 'in' | 'out'; amount: number; description: string; created_at: string; related_account?: string; }
interface CardInfo { id: number; masked_number: string; expiry_display: string; card_type: string; design: string; status: string; holder_name: string; }
interface AppCtxType {
  logout: () => void; goTo: (tab: TabKey) => void; toast: (msg: string) => void;
  user: UserInfo | null; account: AccountInfo | null;
  transactions: TxItem[]; cards: CardInfo[]; refreshDashboard: () => void;
  openTransfer: (mode: TransferMode) => void;
  setTabBarHidden: (hidden: boolean) => void;
}
const AppCtx = createContext<AppCtxType>({
  logout: () => {},
  goTo: () => {},
  toast: () => {},
  user: null,
  account: null,
  transactions: [],
  cards: [],
  refreshDashboard: () => {},
  openTransfer: () => {},
  setTabBarHidden: () => {},
});
const useApp = () => useContext(AppCtx);

interface PreferencesCtxType {
  profilePhoto: string;
  setProfilePhotoValue: (value: string) => void;
  lang: AppLang;
  setLang: (lang: AppLang) => void;
  t: (key: TranslationKey) => string;
}

const PreferencesCtx = createContext<PreferencesCtxType>({
  profilePhoto: '',
  setProfilePhotoValue: () => {},
  lang: 'uk',
  setLang: () => {},
  t: (key: TranslationKey) => translations.uk[key],
});
const usePreferences = () => useContext(PreferencesCtx);

type ApiUser = {
  id: number;
  full_name: string;
  phone: string;
  email: string;
  role?: string;
};

type ApiAccount = {
  id: number;
  account_number: string;
  balance: number;
  currency?: string;
};

type ApiCard = {
  id: number;
  masked_number?: string;
  expiry_display?: string;
  card_type?: string;
  status?: string;
  design?: string;
};

type ApiTransaction = {
  id: number;
  tx_type: string;
  direction: 'in' | 'out' | string;
  amount: number;
  description: string;
  related_account?: string | null;
  created_at: string;
  note?: string | null;
};

type ApiNotification = {
  id: number;
  title: string;
  body: string;
  icon: string;
  type: string;
  is_read: boolean;
  created_at: string;
};

type BalancePoint = { day: string; balance: number };

type Achievement = { id: string; title: string; desc: string; icon: string; done: boolean };

type SpendingInsight = { icon: string; text: string };

type TopRecipient = { related_account: string; total_sent: number; tx_count: number };

type ApiAnalyticsByType = {
  tx_type: string;
  direction: string;
  total: number;
  cnt?: number;
};

type ApiAnalytics = {
  current_month?: {
    total_in?: number;
    total_out?: number;
    tx_count?: number;
  };
  prev_month?: {
    total_in?: number;
    total_out?: number;
    tx_count?: number;
  };
  by_type?: ApiAnalyticsByType[];
  monthly?: { month: string; total_in: number; total_out: number }[];
};

interface BankDataCtxType {
  loading: boolean;
  refreshing: boolean;
  error: string;
  user: ApiUser | null;
  account: ApiAccount | null;
  cards: ApiCard[];
  transactions: ApiTransaction[];
  analytics: ApiAnalytics | null;
  refresh: () => Promise<void>;
  mutateCard: (cardId: number, action: 'block' | 'close') => Promise<void>;
  issueCard: () => Promise<void>;
}

const BankDataCtx = createContext<BankDataCtxType>({
  loading: true,
  refreshing: false,
  error: '',
  user: null,
  account: null,
  cards: [],
  transactions: [],
  analytics: null,
  refresh: async () => {},
  mutateCard: async () => {},
  issueCard: async () => {},
});
const useBankData = () => useContext(BankDataCtx);

const API_BASE = (typeof window !== 'undefined' && (window as { ARMY_BANK_BASE?: string }).ARMY_BANK_BASE) || '';
const uahFmt = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function localeForLang(lang: AppLang): string {
  return lang === 'en' ? 'en-US'
    : lang === 'it' ? 'it-IT'
    : lang === 'es' ? 'es-ES'
    : 'uk-UA';
}

function formatUah(value: number): string {
  return `₴ ${uahFmt.format(Number.isFinite(value) ? value : 0)}`;
}

function analyticsChangeLabel(analytics?: ApiAnalytics | null): string {
  const lang = getStoredLanguage();
  const tt = translations[lang];
  if (!analytics?.current_month || !analytics?.prev_month) return tt.no_dynamics;
  const curIn = Number(analytics.current_month.total_in || 0);
  const curOut = Number(analytics.current_month.total_out || 0);
  const prevIn = Number(analytics.prev_month.total_in || 0);
  const prevOut = Number(analytics.prev_month.total_out || 0);
  const curNet = curIn - curOut;
  const prevNet = prevIn - prevOut;
  if (Math.abs(prevNet) < 0.01) return curNet === 0 ? tt.no_change : tt.new_cash_flow;
  const pct = ((curNet - prevNet) / Math.abs(prevNet)) * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}% ${tt.analytics_prev_month_suffix}`;
}

function initials(fullName?: string | null): string {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'AB';
  return (parts[0].charAt(0) + (parts[1]?.charAt(0) || '')).toUpperCase();
}

function shortName(fullName?: string | null): string {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return translations[getStoredLanguage()].user_fallback;
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[1].charAt(0)}.`;
}

function cardTail(masked?: string): string {
  const digits = String(masked || '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : '----';
}

const CARD_INDEX_STORAGE_KEY = 'army_bank_selected_card_idx';
const PROFILE_PHOTO_STORAGE_KEY = 'army_bank_profile_photo';
const LANGUAGE_STORAGE_KEY = 'army_bank_language';
const ACTIVE_TAB_STORAGE_KEY = 'army_bank_active_tab';
const MARKET_TAB_STORAGE_KEY = 'army_bank_market_tab';
const APP_CONTINUATION_STORAGE_KEY = 'army_bank_recently_active';

type AppLang = 'uk' | 'en' | 'it' | 'es';

const translations = {
  uk: {
    user_fallback: 'Користувач',
    greeting_morning: 'Доброго ранку',
    greeting_day: 'Добрий день',
    greeting_evening: 'Доброго вечора',
    greeting_night: 'Доброї ночі',
    tabs_overview: 'Огляд',
    tabs_operations: 'Операції',
    tabs_cards: 'Картки',
    tabs_market: 'Магазин',
    tabs_profile: 'Профіль',
    quick_topup: 'Поповнити',
    quick_by_card: 'На картку',
    quick_by_account: 'За рахунком',
    quick_market: 'Магазин',
    balance_total: 'Загальний баланс',
    cards_mine: 'Мої картки',
    all: 'Усі',
    quick_actions: 'Швидкі дії',
    recent_activity: 'Остання активність',
    history: 'Історія',
    no_transactions_yet: 'Транзакцій ще немає',
    topup_or_transfer: 'Поповніть рахунок або зробіть переказ',
    profile_verified: 'Верифікований',
    profile_name: "Ім'я",
    profile_phone: 'Телефон',
    profile_email: 'Email',
    profile_account: 'Рахунок',
    profile_security: 'Безпека',
    profile_password: 'Пароль',
    profile_change_photo: 'Змінити фото',
    profile_remove_photo: 'Видалити',
    profile_change_password: 'Змінити пароль',
    profile_current_password: 'Поточний пароль',
    profile_new_password: 'Новий пароль',
    profile_save: 'Зберегти',
    profile_logout: 'Вийти з акаунту',
    settings_language: 'Мова',
    settings_language_sub: 'Інтерфейс застосунку',
    lang_uk: 'Українська',
    lang_en: 'English',
    lang_it: 'Italiano',
    lang_es: 'Español',
    personal_cabinet: 'Особистий кабінет',
    face_id_unavailable: 'Недоступно на цьому пристрої',
    push_notifications: 'Push-сповіщення',
    twofa_sms: 'Підтвердження за SMS',
    unavailable: 'Недоступно',
    no_change: 'Без змін',
    new_cash_flow: 'Новий рух коштів',
    no_dynamics: 'Без динаміки',
    receipt_opened: 'Чек відкрито',
    request_error: 'Помилка запиту.',
    transfer_topup_title: 'Поповнити рахунок',
    transfer_by_card_title: 'Переказ на картку',
    transfer_by_account_title: 'Переказ за рахунком',
    transfer_card_number: 'Номер картки',
    transfer_account_number: 'Номер рахунку',
    transfer_optional_desc: 'Опис (опційно)',
    transfer_comment: 'Коментар',
    amount_label: 'Сума (₴)',
    enter_amount: 'Вкажіть суму',
    enter_recipient: 'Вкажіть отримувача',
    session_expired: 'Сесія завершилась. Увійдіть повторно.',
    operation_error: 'Помилка операції',
    topup_success: 'Рахунок поповнено на',
    transfer_success: 'Переказ виконано на',
    cards_not_issued: 'Картки ще не випущено',
    cards_issue_hint: 'Перейдіть у розділ «Картки», щоб випустити першу картку.',
    open_cards: 'Відкрити картки',
    spending_this_month: 'Витрати цього місяця',
    insufficient_spend_data: 'Недостатньо даних для розподілу витрат.',
    spend_transfer: 'Перекази',
    spend_food: 'Їжа',
    spend_transport: 'Транспорт',
    spend_utility: 'Комунальні',
    spend_shopping: 'Покупки',
    spend_subscription: 'Підписки',
    cards_title: 'Мої картки',
    card_not_found: 'Картку не знайдено.',
    pin_change_error: 'Помилка зміни PIN',
    pin_saved: 'PIN картки змінено',
    card_blocked: 'Картку заморожено',
    card_unblocked: 'Картку розморожено',
    card_closed: 'Картку закрито',
    card_active_status: 'Активна',
    card_frozen_status: 'Заморожена',
    card_design_error: 'Помилка дизайну картки',
    card_details: 'Деталі',
    account_label: 'Рахунок',
    new_pin_4_digits: 'Новий PIN (4 цифри)',
    saving: 'Збереження…',
    save_pin: 'Зберегти PIN',
    operations_title: 'Операції',
    download_csv: 'Завантажити CSV',
    search_transactions: 'Пошук транзакцій...',
    nothing_found_for: 'Нічого не знайдено за',
    download_receipt: 'Завантажити чек',
    receipt_download_error: 'Помилка завантаження чека',
    download_error: 'Помилка завантаження',
    export_error: 'Помилка експорту',
    statement_error: 'Помилка виписки',
    face_id_on: 'Face ID увімкнено ✓',
    face_id_off: 'Face ID вимкнено',
    password_changed: 'Пароль змінено успішно',
    pick_image: 'Оберіть зображення',
    photo_too_large: 'Фото завелике (до 3MB)',
    photo_read_error: 'Не вдалося прочитати фото',
    photo_updated: 'Фото профілю оновлено',
    photo_upload_error: 'Не вдалося завантажити фото',
    photo_removed: 'Фото видалено',
    profile_photo_alt: 'Фото профілю',
    market_out_of_stock: 'Немає в наявності',
    add_to_cart: 'Додати до кошика',
    cart_title: 'Кошик',
    delivery_title: 'Доставка',
    cart_empty: 'Кошик порожній',
    added_to_cart: 'додано до кошика',
    checkout_success: 'Замовлення оформлено!',
    checkout_error: 'Помилка оформлення',
    orders_tab: 'Замовлення',
    invoices_tab: 'Інвойси',
    market_title: 'Магазин',
    loading: 'Завантаження…',
    market_empty: 'Магазин порожній',
    try_another_query: 'Спробуй інший запит',
    no_results: 'Нічого не знайдено',
    products_not_added: 'Товари ще не додано.',
    orders_empty: 'Замовлень ще немає',
    invoices_empty: 'Інвойсів ще немає',
    invoices_after_orders: 'Інвойси з\'являться після оформлення замовлень.',
    invoice_label: 'Інвойс',
    order_label: 'Замовлення',
    login_tab: 'Вхід',
    register_tab: 'Реєстрація',
    wait_processing: 'Обробка…',
    login_with_face_id: 'Увійти з Face ID',
    full_name_label: 'Повне ім\'я',
    email_label: 'Email',
    phone_or_email: 'Телефон або Email',
    phone_or_email_placeholder: 'Телефон або email',
    password_label: 'Пароль',
    forgot_password: 'Забули пароль?',
    confirm_password: 'Підтвердити пароль',
    repeat_password: 'Повторіть пароль',
    sign_in: 'Увійти',
    create_account: 'Створити акаунт',
    issue_card: 'Випустити',
    creating: 'Створення...',
    invalid_credentials: 'Невірні дані',
    registration_error: 'Помилка реєстрації',
    verification_error: 'Помилка верифікації',
    face_id_error: 'Помилка Face ID',
    loading_data: 'Завантаження даних...',
    change_pin: 'Змінити PIN',
    choose_card_design: 'Оберіть дизайн картки',
    issue_new_card: 'Випуск нової картки',
    applying: 'Застосування…',
    apply_design: 'Застосувати дизайн',
    issue_card_full: 'Випустити картку',
    face_id_transfer_sub: 'Вхід та підтвердження переказів',
    in_stock: 'Є в наявності',
    next_delivery: 'Далі → Доставка',
    cart_items_count: 'товарів',
    total_label: 'Разом',
    recipient_label: 'Отримувач',
    delivery_phone: 'Телефон',
    delivery_address: 'Адреса доставки',
    pay_total: 'До оплати',
    place_order: 'Оформити замовлення',
    checkout_processing: 'Оформлення…',
    catalog_tab: 'Каталог',
    product_search: 'Пошук товарів…',
    catalog_first_order_hint: 'Оформіть перше замовлення в каталозі.',
    receipt_short: 'Чек',
    last_items: 'Останніх',
    card_physical: 'Фізична',
    card_virtual: 'Віртуальна',
    card_valid_until: 'до',
    card_design_label: 'Дизайн',
    change_label: 'Змінити',
    account_activity_month: 'Активність рахунку за місяць',
    operations_short: 'оп.',
    spent_label: 'витрат',
    account_balance_label: 'Баланс рахунку',
    design_action: 'Дизайн',
    freeze_card: 'Заморозити',
    unfreeze_card: 'Розморозити',
    close_card: 'Закрити',
    error_boundary_title: '⚠️ Щось пішло не так',
    error_boundary_refresh: 'Оновити сторінку',
    analytics_prev_month_suffix: 'до минулого місяця',
    api_health_temporarily_unavailable: 'API тимчасово недоступне. Спробуйте через кілька секунд.',
    api_health_status_unavailable: 'API статус недоступний.',
    api_health_no_connection: 'Немає зʼєднання з API. Перевірте мережу або спробуйте пізніше.',
    design_subtitle_gold: 'Базовий стиль ARM',
    design_subtitle_forest: 'Глибокий зелений',
    design_subtitle_slate: 'Світлий металік',
    design_subtitle_dark: 'Темний мінімал',
    design_subtitle_florence: 'Купол і старе місто',
    design_subtitle_venice: 'Канали та площа',
    design_subtitle_tuscany_hills: 'Тосканські поля',
    design_subtitle_tuscany_villa: 'Теплий пейзаж',
    today_label: 'Сьогодні',
    yesterday_label: 'Вчора',
    no_new_notifications: 'Нових сповіщень немає',
    demo_pin_unavailable: 'Демо-режим: зміна PIN недоступна',
    demo_api_unavailable: 'Демо-режим: API не підключено',
    no_card_for_design_change: 'Немає картки для зміни дизайну',
    card_design_update_failed: 'Не вдалося оновити дизайн',
    card_design_updated: 'Дизайн картки оновлено',
    card_issue_failed: 'Не вдалося випустити картку',
    new_card_issued: 'Нову картку випущено',
    card_short_label: 'Картка',
    confirm_pin: 'Підтвердити PIN',
    pin_mismatch: 'PIN-коди не збігаються',
    choose_style_then_issue: 'Оберіть стиль, потім випустіть віртуальну картку',
    selected_label: 'Обрано',
    cancel_label: 'Скасувати',
    period_week_short: 'Т',
    period_month_short: 'М',
    period_year_short: 'Р',
    statement_pdf: 'Виписка PDF',
    copy_success: 'Скопійовано',
    copy_failed: 'Не вдалось скопіювати',
    last_items_badge: 'ОСТАННІ',
    shipping_name_placeholder: "Прізвище Ім'я По-батькові",
    shipping_address_placeholder: 'м. Київ, вул. Хрещатик 1, кв. 5',
    order_items_suffix: 'поз.',
    due_prefix: 'до',
    passwords_do_not_match: 'Паролі не збігаються',
    forgot_password_contact_support: 'Зверніться до підтримки для відновлення пароля',
    full_name_placeholder: 'Іван Петренко',
    data_load_failed: 'Не вдалося завантажити дані.',
    active_cards_metric: 'Активні картки',
    cardholder_label: 'Cardholder',
    valid_label: 'Valid',
    transfer_placeholder_card: '4721 •••• •••• ••••',
    transfer_placeholder_account: 'AB-100011',
    filter_all: 'Всі',
    filter_income: 'Надходження',
    filter_outcome: 'Витрати',
    notifications_center: 'Сповіщення',
    balance_history_title: 'Динаміка балансу',
    achievements_title: 'Досягнення',
    achievements_progress: 'виконано',
    insights_title: 'Аналітика',
    tx_note_label: 'Нотатка',
    tx_note_placeholder: 'Додати нотатку...',
    tx_note_saved: 'Нотатку збережено',
    top_recipients_title: 'Часті отримувачі',
    mark_all_read: 'Прочитати всі',
    sent_label: 'переказів',
  },
  en: {
    user_fallback: 'User',
    greeting_morning: 'Good morning',
    greeting_day: 'Good afternoon',
    greeting_evening: 'Good evening',
    greeting_night: 'Good night',
    tabs_overview: 'Overview',
    tabs_operations: 'Activity',
    tabs_cards: 'Cards',
    tabs_market: 'Store',
    tabs_profile: 'Profile',
    quick_topup: 'Top up',
    quick_by_card: 'To card',
    quick_by_account: 'By account',
    quick_market: 'Store',
    balance_total: 'Total balance',
    cards_mine: 'My cards',
    all: 'All',
    quick_actions: 'Quick actions',
    recent_activity: 'Recent activity',
    history: 'History',
    no_transactions_yet: 'No transactions yet',
    topup_or_transfer: 'Top up your account or make a transfer',
    profile_verified: 'Verified',
    profile_name: 'Name',
    profile_phone: 'Phone',
    profile_email: 'Email',
    profile_account: 'Account',
    profile_security: 'Security',
    profile_password: 'Password',
    profile_change_photo: 'Change photo',
    profile_remove_photo: 'Remove',
    profile_change_password: 'Change password',
    profile_current_password: 'Current password',
    profile_new_password: 'New password',
    profile_save: 'Save',
    profile_logout: 'Sign out',
    settings_language: 'Language',
    settings_language_sub: 'App interface',
    lang_uk: 'Ukrainian',
    lang_en: 'English',
    lang_it: 'Italian',
    lang_es: 'Spanish',
    personal_cabinet: 'Personal banking',
    face_id_unavailable: 'Unavailable on this device',
    push_notifications: 'Push notifications',
    twofa_sms: 'SMS confirmation',
    unavailable: 'Unavailable',
    no_change: 'No change',
    new_cash_flow: 'New cash flow',
    no_dynamics: 'No dynamics',
    receipt_opened: 'Receipt opened',
    request_error: 'Request error.',
    transfer_topup_title: 'Top up account',
    transfer_by_card_title: 'Transfer to card',
    transfer_by_account_title: 'Transfer by account',
    transfer_card_number: 'Card number',
    transfer_account_number: 'Account number',
    transfer_optional_desc: 'Description (optional)',
    transfer_comment: 'Comment',
    amount_label: 'Amount (₴)',
    enter_amount: 'Enter amount',
    enter_recipient: 'Enter recipient',
    session_expired: 'Session expired. Sign in again.',
    operation_error: 'Operation error',
    topup_success: 'Account topped up by',
    transfer_success: 'Transfer completed for',
    cards_not_issued: 'No cards issued yet',
    cards_issue_hint: 'Go to the Cards section to issue your first card.',
    open_cards: 'Open cards',
    spending_this_month: 'Spending this month',
    insufficient_spend_data: 'Not enough data to break down spending.',
    spend_transfer: 'Transfers',
    spend_food: 'Food',
    spend_transport: 'Transport',
    spend_utility: 'Utilities',
    spend_shopping: 'Shopping',
    spend_subscription: 'Subscriptions',
    cards_title: 'My cards',
    card_not_found: 'Card not found.',
    pin_change_error: 'PIN change error',
    pin_saved: 'Card PIN updated',
    card_blocked: 'Card frozen',
    card_unblocked: 'Card unfrozen',
    card_closed: 'Card closed',
    card_active_status: 'Active',
    card_frozen_status: 'Frozen',
    card_design_error: 'Card design error',
    card_details: 'Details',
    account_label: 'Account',
    new_pin_4_digits: 'New PIN (4 digits)',
    saving: 'Saving…',
    save_pin: 'Save PIN',
    operations_title: 'Operations',
    download_csv: 'Download CSV',
    search_transactions: 'Search transactions...',
    nothing_found_for: 'Nothing found for',
    download_receipt: 'Download receipt',
    receipt_download_error: 'Receipt download error',
    download_error: 'Download error',
    export_error: 'Export error',
    statement_error: 'Statement error',
    face_id_on: 'Face ID enabled ✓',
    face_id_off: 'Face ID disabled',
    password_changed: 'Password changed successfully',
    pick_image: 'Choose an image',
    photo_too_large: 'Photo is too large (up to 3MB)',
    photo_read_error: 'Could not read photo',
    photo_updated: 'Profile photo updated',
    photo_upload_error: 'Could not upload photo',
    photo_removed: 'Photo removed',
    profile_photo_alt: 'Profile photo',
    market_out_of_stock: 'Out of stock',
    add_to_cart: 'Add to cart',
    cart_title: 'Cart',
    delivery_title: 'Delivery',
    cart_empty: 'Cart is empty',
    added_to_cart: 'added to cart',
    checkout_success: 'Order placed!',
    checkout_error: 'Checkout error',
    orders_tab: 'Orders',
    invoices_tab: 'Invoices',
    market_title: 'Store',
    loading: 'Loading…',
    market_empty: 'Store is empty',
    try_another_query: 'Try another query',
    no_results: 'Nothing found',
    products_not_added: 'Products have not been added yet.',
    orders_empty: 'No orders yet',
    invoices_empty: 'No invoices yet',
    invoices_after_orders: 'Invoices will appear after orders are placed.',
    invoice_label: 'Invoice',
    order_label: 'Order',
    login_tab: 'Sign in',
    register_tab: 'Register',
    wait_processing: 'Processing…',
    login_with_face_id: 'Sign in with Face ID',
    full_name_label: 'Full name',
    email_label: 'Email',
    phone_or_email: 'Phone or Email',
    phone_or_email_placeholder: 'Phone or email',
    password_label: 'Password',
    forgot_password: 'Forgot password?',
    confirm_password: 'Confirm password',
    repeat_password: 'Repeat password',
    sign_in: 'Sign in',
    create_account: 'Create account',
    issue_card: 'Issue card',
    creating: 'Creating...',
    invalid_credentials: 'Invalid credentials',
    registration_error: 'Registration error',
    verification_error: 'Verification error',
    face_id_error: 'Face ID error',
    loading_data: 'Loading data...',
    change_pin: 'Change PIN',
    choose_card_design: 'Choose card design',
    issue_new_card: 'Issue new card',
    applying: 'Applying…',
    apply_design: 'Apply design',
    issue_card_full: 'Issue card',
    face_id_transfer_sub: 'Sign-in and transfer confirmation',
    in_stock: 'In stock',
    next_delivery: 'Next → Delivery',
    cart_items_count: 'items',
    total_label: 'Total',
    recipient_label: 'Recipient',
    delivery_phone: 'Phone',
    delivery_address: 'Delivery address',
    pay_total: 'To pay',
    place_order: 'Place order',
    checkout_processing: 'Placing order…',
    catalog_tab: 'Catalog',
    product_search: 'Search products…',
    catalog_first_order_hint: 'Place your first order in the catalog.',
    receipt_short: 'Receipt',
    last_items: 'Last',
    card_physical: 'Physical',
    card_virtual: 'Virtual',
    card_valid_until: 'until',
    card_design_label: 'Design',
    change_label: 'Change',
    account_activity_month: 'Monthly account activity',
    operations_short: 'ops',
    spent_label: 'spent',
    account_balance_label: 'Account balance',
    design_action: 'Design',
    freeze_card: 'Freeze',
    unfreeze_card: 'Unfreeze',
    close_card: 'Close',
    error_boundary_title: '⚠️ Something went wrong',
    error_boundary_refresh: 'Reload page',
    analytics_prev_month_suffix: 'vs previous month',
    api_health_temporarily_unavailable: 'API is temporarily unavailable. Please try again in a few seconds.',
    api_health_status_unavailable: 'API status is unavailable.',
    api_health_no_connection: 'No connection to API. Check your network or try again later.',
    design_subtitle_gold: 'ARM base style',
    design_subtitle_forest: 'Deep green tone',
    design_subtitle_slate: 'Light metallic',
    design_subtitle_dark: 'Dark minimal look',
    design_subtitle_florence: 'Dome and old city',
    design_subtitle_venice: 'Canals and square',
    design_subtitle_tuscany_hills: 'Tuscan fields',
    design_subtitle_tuscany_villa: 'Warm landscape',
    today_label: 'Today',
    yesterday_label: 'Yesterday',
    no_new_notifications: 'No new notifications',
    demo_pin_unavailable: 'Demo mode: PIN change unavailable',
    demo_api_unavailable: 'Demo mode: API is not connected',
    no_card_for_design_change: 'No card available for design change',
    card_design_update_failed: 'Failed to update design',
    card_design_updated: 'Card design updated',
    card_issue_failed: 'Failed to issue card',
    new_card_issued: 'New card issued',
    card_short_label: 'Card',
    confirm_pin: 'Confirm PIN',
    pin_mismatch: 'PIN codes do not match',
    choose_style_then_issue: 'Choose a style, then issue a virtual card',
    selected_label: 'Selected',
    cancel_label: 'Cancel',
    period_week_short: 'W',
    period_month_short: 'M',
    period_year_short: 'Y',
    statement_pdf: 'PDF statement',
    copy_success: 'Copied',
    copy_failed: 'Failed to copy',
    last_items_badge: 'LAST',
    shipping_name_placeholder: 'Full name',
    shipping_address_placeholder: 'Kyiv, Khreshchatyk St 1, apt. 5',
    order_items_suffix: 'items',
    due_prefix: 'due',
    passwords_do_not_match: 'Passwords do not match',
    forgot_password_contact_support: 'Contact support to recover your password',
    full_name_placeholder: 'John Doe',
    data_load_failed: 'Failed to load data.',
    active_cards_metric: 'Active cards',
    cardholder_label: 'Cardholder',
    valid_label: 'Valid',
    transfer_placeholder_card: '4721 •••• •••• ••••',
    transfer_placeholder_account: 'AB-100011',
    filter_all: 'All',
    filter_income: 'Income',
    filter_outcome: 'Expenses',
    notifications_center: 'Notifications',
    balance_history_title: 'Balance History',
    achievements_title: 'Achievements',
    achievements_progress: 'completed',
    insights_title: 'Insights',
    tx_note_label: 'Note',
    tx_note_placeholder: 'Add a note...',
    tx_note_saved: 'Note saved',
    top_recipients_title: 'Frequent Recipients',
    mark_all_read: 'Mark all read',
    sent_label: 'transfers',
  },
  it: {
    user_fallback: 'Utente',
    greeting_morning: 'Buongiorno',
    greeting_day: 'Buon pomeriggio',
    greeting_evening: 'Buonasera',
    greeting_night: 'Buonanotte',
    tabs_overview: 'Panoramica',
    tabs_operations: 'Operazioni',
    tabs_cards: 'Carte',
    tabs_market: 'Negozio',
    tabs_profile: 'Profilo',
    quick_topup: 'Ricarica',
    quick_by_card: 'Alla carta',
    quick_by_account: 'Per conto',
    quick_market: 'Negozio',
    balance_total: 'Saldo totale',
    cards_mine: 'Le mie carte',
    all: 'Tutte',
    quick_actions: 'Azioni rapide',
    recent_activity: 'Attività recente',
    history: 'Cronologia',
    no_transactions_yet: 'Nessuna transazione',
    topup_or_transfer: 'Ricarica il conto o effettua un trasferimento',
    profile_verified: 'Verificato',
    profile_name: 'Nome',
    profile_phone: 'Telefono',
    profile_email: 'Email',
    profile_account: 'Conto',
    profile_security: 'Sicurezza',
    profile_password: 'Password',
    profile_change_photo: 'Cambia foto',
    profile_remove_photo: 'Rimuovi',
    profile_change_password: 'Cambia password',
    profile_current_password: 'Password attuale',
    profile_new_password: 'Nuova password',
    profile_save: 'Salva',
    profile_logout: 'Esci',
    settings_language: 'Lingua',
    settings_language_sub: 'Interfaccia dell’app',
    lang_uk: 'Ucraino',
    lang_en: 'Inglese',
    lang_it: 'Italiano',
    lang_es: 'Spagnolo',
    personal_cabinet: 'Private banking',
    face_id_unavailable: 'Non disponibile su questo dispositivo',
    push_notifications: 'Notifiche push',
    twofa_sms: 'Conferma via SMS',
    unavailable: 'Non disponibile',
    no_change: 'Nessuna variazione',
    new_cash_flow: 'Nuovo flusso di cassa',
    no_dynamics: 'Nessuna dinamica',
    receipt_opened: 'Ricevuta aperta',
    request_error: 'Errore di richiesta.',
    transfer_topup_title: 'Ricarica conto',
    transfer_by_card_title: 'Trasferimento alla carta',
    transfer_by_account_title: 'Trasferimento per conto',
    transfer_card_number: 'Numero carta',
    transfer_account_number: 'Numero conto',
    transfer_optional_desc: 'Descrizione (opzionale)',
    transfer_comment: 'Commento',
    amount_label: 'Importo (₴)',
    enter_amount: 'Inserisci importo',
    enter_recipient: 'Inserisci destinatario',
    session_expired: 'Sessione scaduta. Accedi di nuovo.',
    operation_error: 'Errore operazione',
    topup_success: 'Conto ricaricato di',
    transfer_success: 'Trasferimento eseguito per',
    cards_not_issued: 'Nessuna carta emessa',
    cards_issue_hint: 'Vai alla sezione Carte per emettere la tua prima carta.',
    open_cards: 'Apri carte',
    spending_this_month: 'Spese di questo mese',
    insufficient_spend_data: 'Dati insufficienti per suddividere le spese.',
    spend_transfer: 'Trasferimenti',
    spend_food: 'Cibo',
    spend_transport: 'Trasporto',
    spend_utility: 'Utenze',
    spend_shopping: 'Shopping',
    spend_subscription: 'Abbonamenti',
    cards_title: 'Le mie carte',
    card_not_found: 'Carta non trovata.',
    pin_change_error: 'Errore cambio PIN',
    pin_saved: 'PIN carta aggiornato',
    card_blocked: 'Carta bloccata',
    card_unblocked: 'Carta sbloccata',
    card_closed: 'Carta chiusa',
    card_active_status: 'Attiva',
    card_frozen_status: 'Bloccata',
    card_design_error: 'Errore design carta',
    card_details: 'Dettagli',
    account_label: 'Conto',
    new_pin_4_digits: 'Nuovo PIN (4 cifre)',
    saving: 'Salvataggio…',
    save_pin: 'Salva PIN',
    operations_title: 'Operazioni',
    download_csv: 'Scarica CSV',
    search_transactions: 'Cerca transazioni...',
    nothing_found_for: 'Nessun risultato per',
    download_receipt: 'Scarica ricevuta',
    receipt_download_error: 'Errore scaricamento ricevuta',
    download_error: 'Errore di download',
    export_error: 'Errore esportazione',
    statement_error: 'Errore estratto conto',
    face_id_on: 'Face ID attivato ✓',
    face_id_off: 'Face ID disattivato',
    password_changed: 'Password cambiata con successo',
    pick_image: 'Scegli un’immagine',
    photo_too_large: 'Foto troppo grande (max 3MB)',
    photo_read_error: 'Impossibile leggere la foto',
    photo_updated: 'Foto profilo aggiornata',
    photo_upload_error: 'Impossibile caricare la foto',
    photo_removed: 'Foto rimossa',
    profile_photo_alt: 'Foto profilo',
    market_out_of_stock: 'Non disponibile',
    add_to_cart: 'Aggiungi al carrello',
    cart_title: 'Carrello',
    delivery_title: 'Consegna',
    cart_empty: 'Carrello vuoto',
    added_to_cart: 'aggiunto al carrello',
    checkout_success: 'Ordine effettuato!',
    checkout_error: 'Errore checkout',
    orders_tab: 'Ordini',
    invoices_tab: 'Fatture',
    market_title: 'Negozio',
    loading: 'Caricamento…',
    market_empty: 'Negozio vuoto',
    try_another_query: 'Prova un’altra ricerca',
    no_results: 'Nessun risultato',
    products_not_added: 'I prodotti non sono ancora stati aggiunti.',
    orders_empty: 'Nessun ordine',
    invoices_empty: 'Nessuna fattura',
    invoices_after_orders: 'Le fatture appariranno dopo gli ordini.',
    invoice_label: 'Fattura',
    order_label: 'Ordine',
    login_tab: 'Accesso',
    register_tab: 'Registrazione',
    wait_processing: 'Elaborazione…',
    login_with_face_id: 'Accedi con Face ID',
    full_name_label: 'Nome completo',
    email_label: 'Email',
    phone_or_email: 'Telefono o Email',
    phone_or_email_placeholder: 'Telefono o email',
    password_label: 'Password',
    forgot_password: 'Password dimenticata?',
    confirm_password: 'Conferma password',
    repeat_password: 'Ripeti password',
    sign_in: 'Accedi',
    create_account: 'Crea account',
    issue_card: 'Emetti carta',
    creating: 'Creazione...',
    invalid_credentials: 'Dati non validi',
    registration_error: 'Errore registrazione',
    verification_error: 'Errore verifica',
    face_id_error: 'Errore Face ID',
    loading_data: 'Caricamento dati...',
    change_pin: 'Cambia PIN',
    choose_card_design: 'Scegli il design della carta',
    issue_new_card: 'Emissione nuova carta',
    applying: 'Applicazione…',
    apply_design: 'Applica design',
    issue_card_full: 'Emetti carta',
    face_id_transfer_sub: 'Accesso e conferma trasferimenti',
    in_stock: 'Disponibili',
    next_delivery: 'Avanti → Consegna',
    cart_items_count: 'articoli',
    total_label: 'Totale',
    recipient_label: 'Destinatario',
    delivery_phone: 'Telefono',
    delivery_address: 'Indirizzo di consegna',
    pay_total: 'Da pagare',
    place_order: 'Conferma ordine',
    checkout_processing: 'Ordine in corso…',
    catalog_tab: 'Catalogo',
    product_search: 'Cerca prodotti…',
    catalog_first_order_hint: 'Effettua il primo ordine dal catalogo.',
    receipt_short: 'Ricevuta',
    last_items: 'Ultimi',
    card_physical: 'Fisica',
    card_virtual: 'Virtuale',
    card_valid_until: 'fino al',
    card_design_label: 'Design',
    change_label: 'Cambia',
    account_activity_month: 'Attività mensile del conto',
    operations_short: 'op.',
    spent_label: 'spesi',
    account_balance_label: 'Saldo conto',
    design_action: 'Design',
    freeze_card: 'Blocca',
    unfreeze_card: 'Sblocca',
    close_card: 'Chiudi',
    error_boundary_title: '⚠️ Qualcosa è andato storto',
    error_boundary_refresh: 'Ricarica pagina',
    analytics_prev_month_suffix: 'rispetto al mese scorso',
    api_health_temporarily_unavailable: 'API temporaneamente non disponibile. Riprova tra qualche secondo.',
    api_health_status_unavailable: 'Stato API non disponibile.',
    api_health_no_connection: "Nessuna connessione all'API. Controlla la rete o riprova più tardi.",
    design_subtitle_gold: 'Stile base ARM',
    design_subtitle_forest: 'Verde profondo',
    design_subtitle_slate: 'Metallico chiaro',
    design_subtitle_dark: 'Minimal scuro',
    design_subtitle_florence: 'Cupola e città antica',
    design_subtitle_venice: 'Canali e piazza',
    design_subtitle_tuscany_hills: 'Campi toscani',
    design_subtitle_tuscany_villa: 'Paesaggio caldo',
    today_label: 'Oggi',
    yesterday_label: 'Ieri',
    no_new_notifications: 'Nessuna nuova notifica',
    demo_pin_unavailable: 'Modalità demo: cambio PIN non disponibile',
    demo_api_unavailable: 'Modalità demo: API non connessa',
    no_card_for_design_change: 'Nessuna carta per cambiare design',
    card_design_update_failed: 'Impossibile aggiornare il design',
    card_design_updated: 'Design della carta aggiornato',
    card_issue_failed: 'Impossibile emettere la carta',
    new_card_issued: 'Nuova carta emessa',
    card_short_label: 'Carta',
    confirm_pin: 'Conferma PIN',
    pin_mismatch: 'I PIN non coincidono',
    choose_style_then_issue: 'Scegli uno stile, poi emetti una carta virtuale',
    selected_label: 'Selezionato',
    cancel_label: 'Annulla',
    period_week_short: 'S',
    period_month_short: 'M',
    period_year_short: 'A',
    statement_pdf: 'Estratto PDF',
    copy_success: 'Copiato',
    copy_failed: 'Impossibile copiare',
    last_items_badge: 'ULTIMI',
    shipping_name_placeholder: 'Nome e cognome',
    shipping_address_placeholder: 'Kyiv, via Khreshchatyk 1, apt. 5',
    order_items_suffix: 'art.',
    due_prefix: 'entro',
    passwords_do_not_match: 'Le password non coincidono',
    forgot_password_contact_support: 'Contatta il supporto per recuperare la password',
    full_name_placeholder: 'Mario Rossi',
    data_load_failed: 'Impossibile caricare i dati.',
    active_cards_metric: 'Carte attive',
    cardholder_label: 'Cardholder',
    valid_label: 'Valid',
    transfer_placeholder_card: '4721 •••• •••• ••••',
    transfer_placeholder_account: 'AB-100011',
    filter_all: 'Tutti',
    filter_income: 'Entrate',
    filter_outcome: 'Uscite',
    notifications_center: 'Notifiche',
    balance_history_title: 'Storico Saldo',
    achievements_title: 'Traguardi',
    achievements_progress: 'completati',
    insights_title: 'Analisi',
    tx_note_label: 'Nota',
    tx_note_placeholder: 'Aggiungi una nota...',
    tx_note_saved: 'Nota salvata',
    top_recipients_title: 'Destinatari frequenti',
    mark_all_read: 'Segna tutto come letto',
    sent_label: 'trasferimenti',
  },
  es: {
    user_fallback: 'Usuario',
    greeting_morning: 'Buenos días',
    greeting_day: 'Buenas tardes',
    greeting_evening: 'Buenas noches',
    greeting_night: 'Buenas noches',
    tabs_overview: 'Resumen',
    tabs_operations: 'Operaciones',
    tabs_cards: 'Tarjetas',
    tabs_market: 'Tienda',
    tabs_profile: 'Perfil',
    quick_topup: 'Recargar',
    quick_by_card: 'A tarjeta',
    quick_by_account: 'Por cuenta',
    quick_market: 'Tienda',
    balance_total: 'Balance total',
    cards_mine: 'Mis tarjetas',
    all: 'Todas',
    quick_actions: 'Acciones rápidas',
    recent_activity: 'Actividad reciente',
    history: 'Historial',
    no_transactions_yet: 'Aún no hay transacciones',
    topup_or_transfer: 'Recarga tu cuenta o realiza una transferencia',
    profile_verified: 'Verificado',
    profile_name: 'Nombre',
    profile_phone: 'Teléfono',
    profile_email: 'Email',
    profile_account: 'Cuenta',
    profile_security: 'Seguridad',
    profile_password: 'Contraseña',
    profile_change_photo: 'Cambiar foto',
    profile_remove_photo: 'Eliminar',
    profile_change_password: 'Cambiar contraseña',
    profile_current_password: 'Contraseña actual',
    profile_new_password: 'Nueva contraseña',
    profile_save: 'Guardar',
    profile_logout: 'Cerrar sesión',
    settings_language: 'Idioma',
    settings_language_sub: 'Interfaz de la app',
    lang_uk: 'Ucraniano',
    lang_en: 'Inglés',
    lang_it: 'Italiano',
    lang_es: 'Español',
    personal_cabinet: 'Banca privada',
    face_id_unavailable: 'No disponible en este dispositivo',
    push_notifications: 'Notificaciones push',
    twofa_sms: 'Confirmación por SMS',
    unavailable: 'No disponible',
    no_change: 'Sin cambios',
    new_cash_flow: 'Nuevo flujo de caja',
    no_dynamics: 'Sin dinámica',
    receipt_opened: 'Recibo abierto',
    request_error: 'Error de solicitud.',
    transfer_topup_title: 'Recargar cuenta',
    transfer_by_card_title: 'Transferencia a tarjeta',
    transfer_by_account_title: 'Transferencia por cuenta',
    transfer_card_number: 'Número de tarjeta',
    transfer_account_number: 'Número de cuenta',
    transfer_optional_desc: 'Descripción (opcional)',
    transfer_comment: 'Comentario',
    amount_label: 'Importe (₴)',
    enter_amount: 'Introduce el importe',
    enter_recipient: 'Introduce el destinatario',
    session_expired: 'La sesión ha expirado. Inicia sesión de nuevo.',
    operation_error: 'Error de operación',
    topup_success: 'Cuenta recargada por',
    transfer_success: 'Transferencia realizada por',
    cards_not_issued: 'Aún no hay tarjetas',
    cards_issue_hint: 'Ve a la sección Tarjetas para emitir tu primera tarjeta.',
    open_cards: 'Abrir tarjetas',
    spending_this_month: 'Gastos de este mes',
    insufficient_spend_data: 'No hay datos suficientes para desglosar gastos.',
    spend_transfer: 'Transferencias',
    spend_food: 'Comida',
    spend_transport: 'Transporte',
    spend_utility: 'Servicios',
    spend_shopping: 'Compras',
    spend_subscription: 'Suscripciones',
    cards_title: 'Mis tarjetas',
    card_not_found: 'Tarjeta no encontrada.',
    pin_change_error: 'Error al cambiar PIN',
    pin_saved: 'PIN de la tarjeta actualizado',
    card_blocked: 'Tarjeta bloqueada',
    card_unblocked: 'Tarjeta desbloqueada',
    card_closed: 'Tarjeta cerrada',
    card_active_status: 'Activa',
    card_frozen_status: 'Congelada',
    card_design_error: 'Error de diseño de tarjeta',
    card_details: 'Detalles',
    account_label: 'Cuenta',
    new_pin_4_digits: 'Nuevo PIN (4 dígitos)',
    saving: 'Guardando…',
    save_pin: 'Guardar PIN',
    operations_title: 'Operaciones',
    download_csv: 'Descargar CSV',
    search_transactions: 'Buscar transacciones...',
    nothing_found_for: 'No se encontró nada para',
    download_receipt: 'Descargar recibo',
    receipt_download_error: 'Error al descargar recibo',
    download_error: 'Error de descarga',
    export_error: 'Error de exportación',
    statement_error: 'Error del extracto',
    face_id_on: 'Face ID activado ✓',
    face_id_off: 'Face ID desactivado',
    password_changed: 'Contraseña cambiada correctamente',
    pick_image: 'Elige una imagen',
    photo_too_large: 'La foto es demasiado grande (hasta 3MB)',
    photo_read_error: 'No se pudo leer la foto',
    photo_updated: 'Foto de perfil actualizada',
    photo_upload_error: 'No se pudo subir la foto',
    photo_removed: 'Foto eliminada',
    profile_photo_alt: 'Foto de perfil',
    market_out_of_stock: 'Sin stock',
    add_to_cart: 'Añadir al carrito',
    cart_title: 'Carrito',
    delivery_title: 'Entrega',
    cart_empty: 'El carrito está vacío',
    added_to_cart: 'añadido al carrito',
    checkout_success: '¡Pedido realizado!',
    checkout_error: 'Error en el pedido',
    orders_tab: 'Pedidos',
    invoices_tab: 'Facturas',
    market_title: 'Tienda',
    loading: 'Cargando…',
    market_empty: 'La tienda está vacía',
    try_another_query: 'Prueba otra búsqueda',
    no_results: 'No se encontró nada',
    products_not_added: 'Aún no se han añadido productos.',
    orders_empty: 'Aún no hay pedidos',
    invoices_empty: 'Aún no hay facturas',
    invoices_after_orders: 'Las facturas aparecerán después de realizar pedidos.',
    invoice_label: 'Factura',
    order_label: 'Pedido',
    login_tab: 'Acceso',
    register_tab: 'Registro',
    wait_processing: 'Procesando…',
    login_with_face_id: 'Entrar con Face ID',
    full_name_label: 'Nombre completo',
    email_label: 'Email',
    phone_or_email: 'Teléfono o Email',
    phone_or_email_placeholder: 'Teléfono o email',
    password_label: 'Contraseña',
    forgot_password: '¿Olvidaste la contraseña?',
    confirm_password: 'Confirmar contraseña',
    repeat_password: 'Repite la contraseña',
    sign_in: 'Entrar',
    create_account: 'Crear cuenta',
    issue_card: 'Emitir tarjeta',
    creating: 'Creando...',
    invalid_credentials: 'Datos incorrectos',
    registration_error: 'Error de registro',
    verification_error: 'Error de verificación',
    face_id_error: 'Error de Face ID',
    loading_data: 'Cargando datos...',
    change_pin: 'Cambiar PIN',
    choose_card_design: 'Elige el diseño de la tarjeta',
    issue_new_card: 'Emitir nueva tarjeta',
    applying: 'Aplicando…',
    apply_design: 'Aplicar diseño',
    issue_card_full: 'Emitir tarjeta',
    face_id_transfer_sub: 'Inicio y confirmación de transferencias',
    in_stock: 'Disponible',
    next_delivery: 'Siguiente → Entrega',
    cart_items_count: 'artículos',
    total_label: 'Total',
    recipient_label: 'Destinatario',
    delivery_phone: 'Teléfono',
    delivery_address: 'Dirección de entrega',
    pay_total: 'A pagar',
    place_order: 'Realizar pedido',
    checkout_processing: 'Realizando pedido…',
    catalog_tab: 'Catálogo',
    product_search: 'Buscar productos…',
    catalog_first_order_hint: 'Realiza tu primer pedido en el catálogo.',
    receipt_short: 'Recibo',
    last_items: 'Últimos',
    card_physical: 'Física',
    card_virtual: 'Virtual',
    card_valid_until: 'hasta',
    card_design_label: 'Diseño',
    change_label: 'Cambiar',
    account_activity_month: 'Actividad mensual de la cuenta',
    operations_short: 'op.',
    spent_label: 'gastado',
    account_balance_label: 'Saldo de cuenta',
    design_action: 'Diseño',
    freeze_card: 'Congelar',
    unfreeze_card: 'Descongelar',
    close_card: 'Cerrar',
    error_boundary_title: '⚠️ Algo salió mal',
    error_boundary_refresh: 'Recargar página',
    analytics_prev_month_suffix: 'vs. mes anterior',
    api_health_temporarily_unavailable: 'La API está temporalmente no disponible. Inténtalo de nuevo en unos segundos.',
    api_health_status_unavailable: 'Estado de API no disponible.',
    api_health_no_connection: 'Sin conexión con la API. Revisa tu red o inténtalo más tarde.',
    design_subtitle_gold: 'Estilo base ARM',
    design_subtitle_forest: 'Verde profundo',
    design_subtitle_slate: 'Metálico claro',
    design_subtitle_dark: 'Minimalista oscuro',
    design_subtitle_florence: 'Cúpula y ciudad antigua',
    design_subtitle_venice: 'Canales y plaza',
    design_subtitle_tuscany_hills: 'Campos toscanos',
    design_subtitle_tuscany_villa: 'Paisaje cálido',
    today_label: 'Hoy',
    yesterday_label: 'Ayer',
    no_new_notifications: 'No hay notificaciones nuevas',
    demo_pin_unavailable: 'Modo demo: cambio de PIN no disponible',
    demo_api_unavailable: 'Modo demo: API no conectada',
    no_card_for_design_change: 'No hay tarjeta para cambiar el diseño',
    card_design_update_failed: 'No se pudo actualizar el diseño',
    card_design_updated: 'Diseño de tarjeta actualizado',
    card_issue_failed: 'No se pudo emitir la tarjeta',
    new_card_issued: 'Se emitió una nueva tarjeta',
    card_short_label: 'Tarjeta',
    confirm_pin: 'Confirmar PIN',
    pin_mismatch: 'Los PIN no coinciden',
    choose_style_then_issue: 'Elige un estilo y luego emite una tarjeta virtual',
    selected_label: 'Seleccionado',
    cancel_label: 'Cancelar',
    period_week_short: 'S',
    period_month_short: 'M',
    period_year_short: 'A',
    statement_pdf: 'Extracto PDF',
    copy_success: 'Copiado',
    copy_failed: 'No se pudo copiar',
    last_items_badge: 'ÚLTIMOS',
    shipping_name_placeholder: 'Nombre completo',
    shipping_address_placeholder: 'Kyiv, calle Khreshchatyk 1, apto. 5',
    order_items_suffix: 'art.',
    due_prefix: 'hasta',
    passwords_do_not_match: 'Las contraseñas no coinciden',
    forgot_password_contact_support: 'Contacta al soporte para recuperar tu contraseña',
    full_name_placeholder: 'Juan Pérez',
    data_load_failed: 'No se pudieron cargar los datos.',
    active_cards_metric: 'Tarjetas activas',
    cardholder_label: 'Cardholder',
    valid_label: 'Valid',
    transfer_placeholder_card: '4721 •••• •••• ••••',
    transfer_placeholder_account: 'AB-100011',
    filter_all: 'Todos',
    filter_income: 'Ingresos',
    filter_outcome: 'Gastos',
    notifications_center: 'Notificaciones',
    balance_history_title: 'Historial de Saldo',
    achievements_title: 'Logros',
    achievements_progress: 'completados',
    insights_title: 'Análisis',
    tx_note_label: 'Nota',
    tx_note_placeholder: 'Agregar nota...',
    tx_note_saved: 'Nota guardada',
    top_recipients_title: 'Destinatarios frecuentes',
    mark_all_read: 'Marcar todo como leído',
    sent_label: 'transferencias',
  },
} as const;

type TranslationKey = keyof typeof translations.uk;

function readSelectedCardIndex(): number {
  try {
    const raw = localStorage.getItem(CARD_INDEX_STORAGE_KEY);
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function persistSelectedCardIndex(idx: number) {
  try {
    localStorage.setItem(CARD_INDEX_STORAGE_KEY, String(Math.max(0, Math.floor(idx))));
  } catch {
    // ignore storage errors (private mode / quota)
  }
}

function getToken(): string {
  return localStorage.getItem('army_bank_token') || '';
}

function clearToken() {
  localStorage.removeItem('army_bank_token');
  localStorage.removeItem('arm_cart');
}

let apiHealthCache: { ok: boolean; ts: number } | null = null;

async function ensureApiStatusHealthy(): Promise<void> {
  const tt = translations[getStoredLanguage()];
  const now = Date.now();
  if (apiHealthCache && (now - apiHealthCache.ts) < 15000) {
    if (!apiHealthCache.ok) throw new Error(tt.api_health_temporarily_unavailable);
    return;
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch('/api-status', {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'text/html' },
    });
    const ok = res.ok;
    apiHealthCache = { ok, ts: now };
    if (!ok) throw new Error(tt.api_health_status_unavailable);
  } catch {
    apiHealthCache = { ok: false, ts: now };
    throw new Error(tt.api_health_no_connection);
  } finally {
    window.clearTimeout(timer);
  }
}

async function apiRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const fullUrl = (url.startsWith('http') || url.startsWith('//')) ? url : `${API_BASE}${url}`;
  const token = getToken();
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(fullUrl, { ...options, headers });
  const refreshed = response.headers.get('X-Refresh-Token');
  if (refreshed) localStorage.setItem('army_bank_token', refreshed);

  let payload: Record<string, unknown> = {};
  try {
    const raw = await response.text();
    payload = raw ? JSON.parse(raw) as Record<string, unknown> : {};
  } catch {
    payload = {};
  }

  if (!response.ok || payload.ok === false) {
    const msg = String(payload.error || payload.message || translations[getStoredLanguage()].request_error);
    const err = new Error(msg) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }
  return ((payload.data ?? payload) as T);
}

function getProfilePhoto(): string {
  try {
    return localStorage.getItem(PROFILE_PHOTO_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function setProfilePhoto(value: string) {
  try {
    if (value) localStorage.setItem(PROFILE_PHOTO_STORAGE_KEY, value);
    else localStorage.removeItem(PROFILE_PHOTO_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

function getStoredLanguage(): AppLang {
  try {
    const raw = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (raw === 'uk' || raw === 'en' || raw === 'it' || raw === 'es') return raw;
  } catch {
    // ignore storage errors
  }
  return 'uk';
}

function setStoredLanguage(value: AppLang) {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, value);
  } catch {
    // ignore storage errors
  }
}

function markAppContinuation() {
  try {
    localStorage.setItem(APP_CONTINUATION_STORAGE_KEY, String(Date.now()));
  } catch {
    // ignore storage errors
  }
}

function shouldShowInitialSplash(): boolean {
  try {
    const lastActive = Number(localStorage.getItem(APP_CONTINUATION_STORAGE_KEY) || 0);
    if (Number.isFinite(lastActive) && Date.now() - lastActive < 15 * 60_000) return false;
  } catch {
    // ignore storage errors
  }
  return true;
}

function readStoredTab(): TabKey {
  try {
    const raw = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    if (raw === 'overview' || raw === 'operations' || raw === 'cards' || raw === 'market' || raw === 'profile') return raw;
  } catch {
    // ignore storage errors
  }
  return 'overview';
}

function readStoredMarketTab(): 'catalog' | 'orders' | 'invoices' {
  try {
    const raw = localStorage.getItem(MARKET_TAB_STORAGE_KEY);
    if (raw === 'catalog' || raw === 'orders' || raw === 'invoices') return raw;
  } catch {
    // ignore storage errors
  }
  return 'catalog';
}

function openPdfBlobInNewTab(blob: Blob, fallbackFileName: string, toast?: (msg: string) => void) {
  markAppContinuation();
  const blobUrl = URL.createObjectURL(blob);
  const popup = window.open(blobUrl, '_blank', 'noopener,noreferrer');
  if (popup) {
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    return;
  }

  // Fallback for popup blockers.
  const a = document.createElement('a');
  a.href = blobUrl;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.download = fallbackFileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 5_000);
  if (toast) toast(translations[getStoredLanguage()].receipt_opened);
}

// ─── Toast notification ───────────────────────────────────────
function Toast({ msg }: { msg: string }) {
  return (
    <div style={{
      position: 'fixed', bottom: 'calc(90px + env(safe-area-inset-bottom, 0px))',
      left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999, pointerEvents: 'none',
      padding: '10px 20px', borderRadius: 100,
      background: 'rgba(12,28,20,0.94)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
      border: '1px solid rgba(180,172,155,0.22)',
      color: text.primary, ...T.sm, fontWeight: 500,
      boxShadow: '0 12px 32px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(180,172,155,0.1)',
      maxWidth: 'calc(100vw - 48px)', textAlign: 'center', whiteSpace: 'nowrap',
    }}>{msg}</div>
  );
}

function useWindowWidth() {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const handler = () => setW(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return w;
}

function useSheetSwipeClose(onClose: () => void, threshold = 88) {
  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const axisRef = useRef<'x' | 'y' | null>(null);
  const activeRef = useRef(false);
  const [offsetY, setOffsetY] = useState(0);
  const [dragging, setDragging] = useState(false);

  function reset() {
    startXRef.current = null;
    startYRef.current = null;
    axisRef.current = null;
    activeRef.current = false;
    setDragging(false);
    setOffsetY(0);
  }

  function onTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    const t = e.touches[0];
    const el = e.currentTarget;
    const canDrag = (el.scrollTop || 0) <= 0;
    activeRef.current = canDrag;
    startXRef.current = t.clientX;
    startYRef.current = t.clientY;
    axisRef.current = null;
    setDragging(false);
  }

  function onTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (!activeRef.current || startXRef.current == null || startYRef.current == null) return;
    const t = e.touches[0];
    const dx = t.clientX - startXRef.current;
    const dy = t.clientY - startYRef.current;
    if (!axisRef.current && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      axisRef.current = Math.abs(dy) >= Math.abs(dx) ? 'y' : 'x';
    }
    if (axisRef.current !== 'y' || dy <= 0) return;
    e.preventDefault();
    setDragging(true);
    setOffsetY(Math.max(0, Math.min(220, dy)));
  }

  function onTouchEnd() {
    if (offsetY >= threshold) {
      onClose();
    }
    reset();
  }

  return {
    offsetY,
    progress: Math.max(0, Math.min(1, offsetY / 180)),
    dragging,
    sheetProps: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: onTouchEnd,
    },
    sheetStyle: {
      transform: `translate3d(0, ${offsetY}px, 0)`,
      transition: dragging ? 'none' : 'transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1)',
      willChange: 'transform',
    } as React.CSSProperties,
  };
}

// ─── Shared helpers ───────────────────────────────────────────
function Chevron({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M6 4l4 4-4 4" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Premium card ─────────────────────────────────────────────
type CardVariant =
  | 'gold'
  | 'emerald'
  | 'platinum'
  | 'obsidian'
  | 'florence'
  | 'tuscany_hills'
  | 'venice'
  | 'tuscany_villa';

interface CardData {
  variant: CardVariant;
  design?: string;
  number: string;
  name: string;
  expiry: string;
  type?: string;
  status?: string;
  limit?: string;
  used?: string;
}

const DESIGN_TO_VARIANT: Record<string, CardVariant> = {
  gold: 'gold',
  navy: 'obsidian',
  forest: 'emerald',
  rose: 'platinum',
  slate: 'platinum',
  camo: 'emerald',
  dark: 'obsidian',
  florence: 'florence',
  tuscany_hills: 'tuscany_hills',
  venice: 'venice',
  tuscany_villa: 'tuscany_villa',
};

function cardVariantFromDesign(design?: string | null): CardVariant {
  return DESIGN_TO_VARIANT[String(design || '').toLowerCase()] ?? 'gold';
}

function toUiCard(card: ApiCard, holderName: string): CardData {
  const tt = translations[getStoredLanguage()];
  return {
    design: (card.design || 'gold').toLowerCase(),
    variant: cardVariantFromDesign(card.design),
    number: cardTail(card.masked_number),
    name: (holderName || 'ARMY BANK').toUpperCase().slice(0, 26),
    expiry: card.expiry_display || '--/--',
    type: card.card_type === 'physical' ? tt.card_physical : tt.card_virtual,
    status: card.status || 'active',
  };
}

const CARD_VARIANTS: Record<CardVariant, {
  bg: string;
  text: string;
  muted: string;
  shimmer: string;
  overlay: string;
  image?: string;
  numberPlate: string;
  bottomPlate: string;
  badgePlate: string;
}> = {
  gold: {
    bg: 'linear-gradient(135deg, #1e2820 0%, #3a4438 28%, #6a7068 50%, #b0aca0 62%, #585450 82%, #141814 100%)',
    text: '#f0ece4', muted: 'rgba(240,236,228,0.55)',
    shimmer: 'linear-gradient(115deg, transparent 40%, rgba(220,215,200,0.3) 50%, transparent 60%)',
    overlay: 'linear-gradient(180deg, rgba(10,14,11,0.1) 0%, rgba(10,14,11,0.22) 100%)',
    numberPlate: 'rgba(10,14,11,0.32)',
    bottomPlate: 'rgba(10,14,11,0.24)',
    badgePlate: 'rgba(12,16,12,0.36)',
  },
  emerald: {
    bg: 'linear-gradient(135deg, #0a2018 0%, #143028 30%, #1f4238 55%, #2d5e4a 75%, #0a2018 100%)',
    text: '#ddd8cc', muted: 'rgba(220,215,200,0.55)',
    shimmer: 'linear-gradient(115deg, transparent 40%, rgba(180,172,155,0.15) 50%, transparent 60%)',
    overlay: 'linear-gradient(180deg, rgba(8,16,12,0.06) 0%, rgba(8,16,12,0.24) 100%)',
    numberPlate: 'rgba(8,16,12,0.3)',
    bottomPlate: 'rgba(8,16,12,0.24)',
    badgePlate: 'rgba(8,16,12,0.38)',
  },
  platinum: {
    bg: 'linear-gradient(135deg, #3a3f45 0%, #6b7280 30%, #b8bec5 55%, #e5e7eb 65%, #8a9098 85%, #2d3036 100%)',
    text: '#1a1d20', muted: 'rgba(26,29,32,0.55)',
    shimmer: 'linear-gradient(115deg, transparent 40%, rgba(255,255,255,0.4) 50%, transparent 60%)',
    overlay: 'linear-gradient(180deg, rgba(245,247,250,0.03) 0%, rgba(20,28,35,0.12) 100%)',
    numberPlate: 'rgba(245,247,250,0.28)',
    bottomPlate: 'rgba(245,247,250,0.22)',
    badgePlate: 'rgba(245,247,250,0.34)',
  },
  obsidian: {
    bg: 'linear-gradient(135deg, #0a0a0a 0%, #1f1f1f 40%, #2a2a2a 60%, #0a0a0a 100%)',
    text: '#ddd8cc', muted: 'rgba(220,215,200,0.5)',
    shimmer: 'linear-gradient(115deg, transparent 40%, rgba(180,172,155,0.12) 50%, transparent 60%)',
    overlay: 'linear-gradient(180deg, rgba(0,0,0,0.06) 0%, rgba(0,0,0,0.22) 100%)',
    numberPlate: 'rgba(0,0,0,0.35)',
    bottomPlate: 'rgba(0,0,0,0.3)',
    badgePlate: 'rgba(0,0,0,0.42)',
  },
  florence: {
    bg: 'linear-gradient(135deg, #2f241d 0%, #77543f 40%, #a16f52 70%, #2a2119 100%)',
    text: '#f6f0e7',
    muted: 'rgba(246,240,231,0.7)',
    shimmer: 'linear-gradient(115deg, transparent 35%, rgba(255,234,210,0.18) 50%, transparent 65%)',
    overlay: 'linear-gradient(180deg, rgba(16,11,8,0.52) 0%, rgba(16,11,8,0.28) 44%, rgba(16,11,8,0.68) 100%)',
    image: florenceCardImage,
    numberPlate: 'rgba(10,8,7,0.46)',
    bottomPlate: 'rgba(10,8,7,0.4)',
    badgePlate: 'rgba(10,8,7,0.5)',
  },
  tuscany_hills: {
    bg: 'linear-gradient(135deg, #1f3a1f 0%, #53772b 35%, #6f8d3b 65%, #1c3017 100%)',
    text: '#f3f0e6',
    muted: 'rgba(243,240,230,0.72)',
    shimmer: 'linear-gradient(115deg, transparent 30%, rgba(235,242,208,0.14) 50%, transparent 70%)',
    overlay: 'linear-gradient(180deg, rgba(12,18,9,0.44) 0%, rgba(12,18,9,0.18) 45%, rgba(12,18,9,0.64) 100%)',
    image: tuscanyHillsCardImage,
    numberPlate: 'rgba(8,14,7,0.44)',
    bottomPlate: 'rgba(8,14,7,0.38)',
    badgePlate: 'rgba(8,14,7,0.48)',
  },
  venice: {
    bg: 'linear-gradient(135deg, #2c3f48 0%, #5b757f 35%, #8fa9b1 62%, #334a52 100%)',
    text: '#f1ece5',
    muted: 'rgba(241,236,229,0.7)',
    shimmer: 'linear-gradient(115deg, transparent 36%, rgba(224,244,255,0.18) 50%, transparent 64%)',
    overlay: 'linear-gradient(180deg, rgba(10,15,18,0.5) 0%, rgba(10,15,18,0.2) 44%, rgba(10,15,18,0.66) 100%)',
    image: veniceCardImage,
    numberPlate: 'rgba(8,12,14,0.46)',
    bottomPlate: 'rgba(8,12,14,0.4)',
    badgePlate: 'rgba(8,12,14,0.5)',
  },
  tuscany_villa: {
    bg: 'linear-gradient(135deg, #473225 0%, #866047 36%, #b58d62 68%, #493024 100%)',
    text: '#f8f0e3',
    muted: 'rgba(248,240,227,0.72)',
    shimmer: 'linear-gradient(115deg, transparent 34%, rgba(255,238,216,0.2) 50%, transparent 66%)',
    overlay: 'linear-gradient(180deg, rgba(20,13,9,0.46) 0%, rgba(20,13,9,0.18) 44%, rgba(20,13,9,0.68) 100%)',
    image: tuscanyVillaCardImage,
    numberPlate: 'rgba(14,9,7,0.46)',
    bottomPlate: 'rgba(14,9,7,0.4)',
    badgePlate: 'rgba(14,9,7,0.5)',
  },
};

type CardDesignOption = {
  design: string;
  variant: CardVariant;
  title: string;
  subtitleKey: TranslationKey;
};

const CARD_DESIGN_OPTIONS: CardDesignOption[] = [
  { design: 'gold', variant: 'gold', title: 'Classic Gold', subtitleKey: 'design_subtitle_gold' },
  { design: 'forest', variant: 'emerald', title: 'Forest', subtitleKey: 'design_subtitle_forest' },
  { design: 'slate', variant: 'platinum', title: 'Slate', subtitleKey: 'design_subtitle_slate' },
  { design: 'dark', variant: 'obsidian', title: 'Obsidian', subtitleKey: 'design_subtitle_dark' },
  { design: 'florence', variant: 'florence', title: 'Firenze', subtitleKey: 'design_subtitle_florence' },
  { design: 'venice', variant: 'venice', title: 'Venezia', subtitleKey: 'design_subtitle_venice' },
  { design: 'tuscany_hills', variant: 'tuscany_hills', title: "Val d'Orcia", subtitleKey: 'design_subtitle_tuscany_hills' },
  { design: 'tuscany_villa', variant: 'tuscany_villa', title: 'Villa Toscana', subtitleKey: 'design_subtitle_tuscany_villa' },
];

// ─── Data helpers ─────────────────────────────────────────────
function fmtInt(n: number) {
  return Math.floor(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
}
function fmtDec(n: number) { return ',' + (Math.abs(n) % 1).toFixed(2).slice(2); }
function fmtDateLabel(iso: string, lang: AppLang = getStoredLanguage()): string {
  const tt = translations[lang];
  const locale = localeForLang(lang);
  if (!iso) return '—';
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return iso.slice(0, 10) || '—';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yest = new Date(today); yest.setDate(today.getDate() - 1);
  if (d >= today) return tt.today_label;
  if (d >= yest) return tt.yesterday_label;
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'long' });
}
function fmtTime(iso: string, lang: AppLang = getStoredLanguage()): string {
  const locale = localeForLang(lang);
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(11, 16) || '—';
  return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}
function txToCat(tx: TxItem): TxCat {
  if (tx.direction === 'in') return 'income';
  const m: Record<string, TxCat> = { food: 'food', transport: 'transport', utility: 'utility', shopping: 'shopping', subscription: 'subscription', transfer: 'transfer' };
  return (m[tx.tx_type] ?? 'transfer') as TxCat;
}
function apiCardToData(c: CardInfo, holderFallback = 'ARMY BANK'): CardData & { id: number; type: string; limit: string; used: string; statusRaw: string; cardTypeRaw: string } {
  const tt = translations[getStoredLanguage()];
  const normalizedDesign = String(c.design || 'gold').toLowerCase();
  return {
    id: c.id,
    design: normalizedDesign,
    variant: DESIGN_TO_VARIANT[normalizedDesign] ?? 'gold',
    number: String(c.masked_number || '').slice(-4) || '0000',
    name: (holderFallback !== 'ARMY BANK' ? holderFallback : (c.holder_name || holderFallback)).toUpperCase().slice(0, 26),
    expiry: c.expiry_display || '--/--',
    type: c.card_type === 'virtual' ? tt.card_virtual : tt.card_physical,
    status: c.status === 'active' ? tt.card_active_status : c.status === 'blocked' ? tt.card_frozen_status : tt.card_closed,
    statusRaw: c.status,
    cardTypeRaw: c.card_type,
    limit: '—',
    used: '—',
  };
}

function PremiumCard({ variant, number, name, expiry, type, style = {} }: CardData & { style?: React.CSSProperties }) {
  const v = CARD_VARIANTS[variant] ?? CARD_VARIANTS.gold;
  const tt = translations[getStoredLanguage()];
  const patId = `g-${variant}`;
  const hasPhoto = Boolean(v.image);
  const titleShadow = hasPhoto ? '0 1px 3px rgba(0,0,0,0.62)' : '0 1px 1px rgba(0,0,0,0.2)';
  return (
    <div style={{
      position: 'relative', aspectRatio: '1.586 / 1', borderRadius: 22,
      background: v.bg,
      boxShadow: '0 20px 40px -12px rgba(0,0,0,0.55), 0 6px 16px -8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.18)',
      color: v.text, overflow: 'hidden',
      fontFamily: '"SF Pro Display", -apple-system, system-ui',
      ...style,
    }}>
      <div style={{ position: 'absolute', inset: 0, background: v.bg }} />
      {v.image && (
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url(${v.image})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          transform: 'scale(1.03)',
          filter: 'saturate(1.02) contrast(1.01)',
        }} />
      )}
      <div style={{ position: 'absolute', inset: 0, background: v.overlay }} />
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity: hasPhoto ? 0.06 : 0.12, mixBlendMode: 'overlay' }}>
        <defs>
          <pattern id={patId} x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
            <circle cx="30" cy="30" r="28" fill="none" stroke="currentColor" strokeWidth="0.4" />
            <circle cx="30" cy="30" r="20" fill="none" stroke="currentColor" strokeWidth="0.4" />
            <circle cx="0" cy="0" r="28" fill="none" stroke="currentColor" strokeWidth="0.4" />
            <circle cx="60" cy="0" r="28" fill="none" stroke="currentColor" strokeWidth="0.4" />
            <circle cx="0" cy="60" r="28" fill="none" stroke="currentColor" strokeWidth="0.4" />
            <circle cx="60" cy="60" r="28" fill="none" stroke="currentColor" strokeWidth="0.4" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patId})`} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, background: v.shimmer, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, padding: 22, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="24" height="24" viewBox="0 0 24 24">
              <path d="M12 2L3 20h3.5l1.8-4h7.4l1.8 4H21L12 2zm-2.6 11L12 7.3 14.6 13H9.4z" fill={v.text} />
            </svg>
            <span style={{ fontSize: 15, fontWeight: 500, letterSpacing: 0.5, textShadow: titleShadow }}>
              ARM<span style={{ fontWeight: 300 }}>Bank</span>
            </span>
          </div>
          <span style={{
            fontSize: 9, fontWeight: 600, letterSpacing: 1.8, color: v.muted, textTransform: 'uppercase',
            padding: 0,
            background: 'transparent',
          }}>{type || tt.card_virtual}</span>
        </div>
        <div style={{
          fontFamily: '"SF Mono", monospace', fontSize: 20, fontWeight: 600, letterSpacing: 2,
          color: v.text, textShadow: titleShadow,
          display: 'flex', gap: 14, alignItems: 'center', marginBottom: -8,
          padding: 0,
          background: 'transparent',
        }}>
          <span style={{ color: v.muted }}>••••</span>
          <span style={{ color: v.muted }}>••••</span>
          <span style={{ color: v.muted }}>••••</span>
          <span>{number}</span>
        </div>
        <div style={{
          display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
          padding: 0,
          background: 'transparent',
        }}>
          <div>
            <div style={{ fontSize: 8, fontWeight: 500, letterSpacing: 1.2, color: v.muted, textTransform: 'uppercase', marginBottom: 3 }}>{tt.cardholder_label}</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: 0.4, textShadow: titleShadow }}>{name}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 8, fontWeight: 500, letterSpacing: 1.2, color: v.muted, textTransform: 'uppercase', marginBottom: 3 }}>{tt.valid_label}</div>
              <div style={{ fontSize: 12.5, fontWeight: 600, fontFamily: '"SF Mono", monospace', textShadow: titleShadow }}>{expiry}</div>
            </div>
            <div style={{ position: 'relative', width: 34, height: 22 }}>
              <div style={{ position: 'absolute', left: 0, top: 0, width: 22, height: 22, borderRadius: '50%', background: '#eb001b' }} />
              <div style={{ position: 'absolute', right: 0, top: 0, width: 22, height: 22, borderRadius: '50%', background: '#f79e1b', mixBlendMode: 'multiply' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Screen top padding helper ───────────────────────────────
function useTopPad() {
  const layout = useLayout();
  return layout === 'desktop' ? '28px' : 'max(20px, calc(env(safe-area-inset-top, 0px) + 12px))';
}

// ─── Desktop content wrapper: max-width + padding ────────────
function ContentWrap({ children, maxW = 720 }: { children: React.ReactNode; maxW?: number }) {
  const layout = useLayout();
  if (layout !== 'desktop') return <>{children}</>;
  return (
    <div style={{ maxWidth: maxW, margin: '0 auto', padding: '0 32px', width: '100%', boxSizing: 'border-box' }}>
      {children}
    </div>
  );
}

// Desktop screen header — replaces the mobile avatar+greeting bar
function DesktopHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
      <div>
        {subtitle && <div style={{ ...T.caption, color: text.muted, marginBottom: 4 }}>{subtitle}</div>}
        <div style={{ ...T.h1, color: text.primary }}>{title}</div>
      </div>
      {children && <div style={{ display: 'flex', gap: 10 }}>{children}</div>}
    </div>
  );
}

function timeGreeting(lang: AppLang): string {
  const h = new Date().getHours();
  if (h >= 6 && h < 12) return translations[lang].greeting_morning;
  if (h >= 12 && h < 18) return translations[lang].greeting_day;
  if (h >= 18 && h < 23) return translations[lang].greeting_evening;
  return translations[lang].greeting_night;
}

// ─── Balance History Chart ────────────────────────────────────
function BalanceHistoryChart() {
  const { t, lang } = usePreferences();
  const [points, setPoints] = useState<BalancePoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('army_bank_token');
    if (!token) { setLoading(false); return; }
    fetch('/api/analytics/balance-history?days=14', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j?.ok && Array.isArray(j.data)) setPoints(j.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading || points.length < 2) return null;

  const min = Math.min(...points.map(p => p.balance));
  const max = Math.max(...points.map(p => p.balance));
  const range = max - min || 1;
  const W = 280, H = 60;
  const toY = (v: number) => H - ((v - min) / range) * (H - 8) - 4;
  const toX = (i: number) => (i / (points.length - 1)) * W;
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.balance).toFixed(1)}`).join(' ');
  const areaD = `${pathD} L ${W} ${H} L 0 ${H} Z`;
  const locale = localeForLang(lang);
  const startDay = new Date(points[0].day).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  const endDay = new Date(points[points.length - 1].day).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  const lastBalance = points[points.length - 1].balance;
  const firstBalance = points[0].balance;
  const diff = lastBalance - firstBalance;
  const isUp = diff >= 0;

  return (
    <div style={{ padding: '0 22px 20px' }}>
      <div style={{ padding: '16px 18px', ...glassCard() }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: text.muted, textTransform: 'uppercase', letterSpacing: 0.8 }}>{t('balance_history_title')}</span>
          <span style={{ fontSize: 12, color: isUp ? '#7fb896' : '#e07070', fontWeight: 600, fontFeatureSettings: '"tnum"' }}>
            {isUp ? '+' : ''}{fmtInt(diff)}{fmtDec(diff)} ₴
          </span>
        </div>
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', height: 52, overflow: 'visible' }}>
          <defs>
            <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isUp ? '#7fb896' : '#e07070'} stopOpacity="0.25" />
              <stop offset="100%" stopColor={isUp ? '#7fb896' : '#e07070'} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaD} fill="url(#balGrad)" />
          <path d={pathD} fill="none" stroke={isUp ? '#7fb896' : '#e07070'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
          <span style={{ fontSize: 10, color: text.dim }}>{startDay}</span>
          <span style={{ fontSize: 10, color: text.dim }}>{endDay}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Spending Insights Strip ──────────────────────────────────
function InsightsStrip() {
  const { t } = usePreferences();
  const [insights, setInsights] = useState<SpendingInsight[]>([]);

  useEffect(() => {
    const token = localStorage.getItem('army_bank_token');
    if (!token) return;
    fetch('/api/analytics/insights', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j?.ok && j.data?.insights) setInsights(j.data.insights); })
      .catch(() => {});
  }, []);

  if (!insights.length) return null;

  return (
    <div style={{ padding: '0 22px 20px' }}>
      <div style={{ fontSize: 11, color: text.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>{t('insights_title')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {insights.map((ins, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(180,172,155,0.1)', borderRadius: 14 }}>
            <span style={{ fontSize: 16, flexShrink: 0, lineHeight: 1.4 }}>{ins.icon}</span>
            <span style={{ fontSize: 12, color: text.secondary, lineHeight: 1.5 }}>{ins.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Top Recipients Mini ──────────────────────────────────────
function TopRecipientsMini({ onTransfer }: { onTransfer: (account: string) => void }) {
  const { t } = usePreferences();
  const [recipients, setRecipients] = useState<TopRecipient[]>([]);

  useEffect(() => {
    const token = localStorage.getItem('army_bank_token');
    if (!token) return;
    fetch('/api/analytics/top-recipients', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j?.ok && Array.isArray(j.data)) setRecipients(j.data); })
      .catch(() => {});
  }, []);

  if (!recipients.length) return null;

  return (
    <div style={{ padding: '0 22px 20px' }}>
      <div style={{ fontSize: 11, color: text.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>{t('top_recipients_title')}</div>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 2 }}>
        {recipients.map((r, i) => (
          <button key={i} onClick={() => onTransfer(r.related_account)} style={{
            flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
            padding: '10px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(180,172,155,0.12)',
            borderRadius: 16, cursor: 'pointer', minWidth: 80,
          }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: `linear-gradient(135deg, ${gold}30, ${goldDark}30)`, border: `1px solid ${gold}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: gold, fontFamily: 'monospace' }}>
              {r.related_account.slice(-2)}
            </div>
            <span style={{ fontSize: 10, color: text.muted, fontFamily: 'monospace', letterSpacing: 0.5 }}>••{r.related_account.slice(-4)}</span>
            <span style={{ fontSize: 10, color: text.dim }}>{r.tx_count} {t('sent_label')}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Overview screen ──────────────────────────────────────────
function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9,
      padding: '14px 6px', background: bg.card, border: `1px solid rgba(180,172,155,0.14)`,
      borderRadius: radius.lg, color: text.secondary, fontFamily: 'inherit', ...T.caption,
      letterSpacing: 0.4, cursor: 'pointer', transition: 'background 0.15s, border-color 0.15s',
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 12,
        background: `linear-gradient(135deg, ${gold} 0%, ${goldDark} 100%)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `0 4px 10px -4px rgba(180,172,155,0.5), inset 0 1px 0 rgba(230,225,210,0.5)`,
      }}>{icon}</div>
      <span>{label}</span>
    </button>
  );
}

function ActivityRow({ iconBg, iconEl, title, subtitle, amount, positive, onClick }: {
  iconBg: string; iconEl: React.ReactNode; title: string; subtitle: string; amount: string; positive?: boolean; onClick?: () => void;
}) {
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: onClick ? 'pointer' : 'default' }}>
      <div style={{
        width: 38, height: 38, borderRadius: 11, background: iconBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        border: `1px solid rgba(180,172,155,0.15)`,
      }}>{iconEl}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...T.body, fontWeight: 500, color: text.secondary, marginBottom: 2 }}>{title}</div>
        <div style={{ ...T.sm, color: text.muted }}>{subtitle}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ ...T.body, fontWeight: 600, color: positive ? '#7fb896' : text.secondary, ...T.num }}>
          {positive ? '+' : ''}{amount}
        </div>
        {onClick && <Chevron size={13} color="rgba(220,215,200,0.3)" />}
      </div>
    </div>
  );
}

function txActivityVisual(tx: ApiTransaction) {
  if (tx.direction === 'in') {
    return {
      iconBg: 'rgba(127,184,150,0.1)',
      iconEl: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M6 16l6 6 6-6" stroke="#7fb896" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>,
      positive: true,
    };
  }
  if (tx.tx_type === 'transfer') {
    return {
      iconBg: 'rgba(220,215,200,0.08)',
      iconEl: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 12h16M4 12l5-5M4 12l5 5" stroke="#ddd8cc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>,
      positive: false,
    };
  }
  if (tx.tx_type === 'topup') {
    return {
      iconBg: 'rgba(127,184,150,0.1)',
      iconEl: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M6 16l6 6 6-6" stroke="#7fb896" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>,
      positive: true,
    };
  }
  return {
    iconBg: 'rgba(180,172,155,0.1)',
    iconEl: <svg width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke={gold} strokeWidth="1.8" /><path d="M8 12h8M12 8v8" stroke={gold} strokeWidth="1.8" strokeLinecap="round" /></svg>,
    positive: false,
  };
}

function BalanceBlock({ visible, onToggle, balance, accountNumber }: { visible: boolean; onToggle: () => void; balance: number; accountNumber: string }) {
  const { t } = usePreferences();
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ ...T.caption, color: text.muted }}>{t('balance_total')}</span>
        <button onClick={onToggle} style={{ width: 22, height: 22, borderRadius: '50%', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {visible
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" stroke={text.muted} strokeWidth="1.6" /><circle cx="12" cy="12" r="3" stroke={text.muted} strokeWidth="1.6" /></svg>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.4 5.1A10.9 10.9 0 0112 5c6 0 10 7 10 7a18 18 0 01-3.2 3.9M6.6 6.6A18 18 0 002 12s4 7 10 7a11 11 0 003.4-.5" stroke={text.muted} strokeWidth="1.6" strokeLinecap="round" /></svg>
          }
        </button>
      </div>
      <div style={{ ...T.num, fontSize: 48, fontWeight: 300, letterSpacing: -2, color: text.primary, lineHeight: 1, display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: 28, fontWeight: 500, color: gold, letterSpacing: -0.5 }}>₴</span>
        <span>{visible ? fmtInt(balance) : '• • • • • • •'}</span>
        <span style={{ fontSize: 26, fontWeight: 300, color: 'rgba(244,235,208,0.42)', letterSpacing: -0.5 }}>{visible ? fmtDec(balance) : ''}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        {accountNumber && accountNumber !== '—' && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', background: 'rgba(255,255,255,0.04)', border: `1px solid rgba(180,172,155,0.15)`, borderRadius: 100, fontSize: 11, color: 'rgba(220,215,200,0.7)', fontWeight: 500 }}>
            {accountNumber}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" /><path d="M5 15V5a2 2 0 012-2h10" stroke="currentColor" strokeWidth="2" /></svg>
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityFeed({ title = true, transactions }: { title?: boolean; transactions: TxItem[] }) {
  const { goTo } = useApp();
  const { t, lang } = usePreferences();
  const rows = transactions.slice(0, 5).map(tx => {
    const cat = txToCat(tx);
    const s = CAT_STYLES[cat];
    return { iconBg: s.bg, iconEl: s.icon, title: tx.description, subtitle: fmtTime(tx.created_at, lang), amount: `₴\u00a0${fmtInt(tx.amount)}${fmtDec(tx.amount)}`, positive: tx.direction === 'in' };
  });
  return (
    <div>
      {title && (
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ ...T.h3, color: text.secondary }}>{t('recent_activity')}</span>
          <div style={{ flex: 1 }} />
          <button onClick={() => goTo('operations')} style={{ ...T.sm, color: gold, background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: 3, fontFamily: 'inherit', fontWeight: 600, cursor: 'pointer', letterSpacing: -0.1 }}>
            {t('history')} <Chevron size={12} color={gold} />
          </button>
        </div>
      )}
      <div style={{ background: bg.card, border: `1px solid ${bg.border}`, borderRadius: 18, overflow: 'hidden' }}>
        {rows.length === 0 ? (
          <div style={{ padding: '28px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: text.muted, marginBottom: 4 }}>{t('no_transactions_yet')}</div>
            <div style={{ fontSize: 11, color: text.dim }}>{t('topup_or_transfer')}</div>
          </div>
        ) : rows.map((r, i) => (
          <Fragment key={i}>
            <ActivityRow {...r} onClick={() => goTo('operations')} />
            {i < rows.length - 1 && <div style={{ height: 1, background: 'rgba(180,172,155,0.08)', margin: '0 16px' }} />}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// ─── Transfer modal ───────────────────────────────────────────
function TransferModal({ mode, onClose }: { mode: TransferMode; onClose: () => void }) {
  const { toast, refreshDashboard } = useApp();
  const { t } = usePreferences();
  const sheetSwipe = useSheetSwipeClose(onClose);
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const cfg = {
    topup:      { title: t('transfer_topup_title'), recipientLabel: '', placeholder: t('transfer_optional_desc') },
    by_card:    { title: t('transfer_by_card_title'),  recipientLabel: t('transfer_card_number'),   placeholder: t('transfer_comment') },
    by_account: { title: t('transfer_by_account_title'), recipientLabel: t('transfer_account_number'),  placeholder: t('transfer_comment') },
  }[mode];

  function parseAmount(value: string): number {
    const normalized = String(value || '')
      .replace(/\s+/g, '')
      .replace(',', '.')
      .replace(/[^\d.]/g, '');
    return parseFloat(normalized);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const amtNum = parseAmount(amount);
    if (!amtNum || amtNum <= 0) { setError(t('enter_amount')); return; }
    if (mode !== 'topup' && !recipient.trim()) { setError(t('enter_recipient')); return; }
    setLoading(true);
    const token = localStorage.getItem('army_bank_token');
    if (!token) { setLoading(false); setError(t('session_expired')); return; }
    const idempotencyKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await ensureApiStatusHealthy();
      const url = mode === 'topup' ? '/api/transactions/topup'
        : mode === 'by_card' ? '/api/transactions/transfer-by-card'
        : '/api/transactions/transfer';
      const normalizedCard = recipient.replace(/\D/g, '').slice(0, 16);
      const body = mode === 'topup'
        ? { amount: amtNum, description: description || t('transfer_topup_title'), idempotency_key: idempotencyKey }
        : mode === 'by_card'
        ? { card_number: normalizedCard, amount: amtNum, description: description || t('transfer_by_card_title'), idempotency_key: idempotencyKey }
        : { recipient_account_number: recipient.trim(), amount: amtNum, description: description || t('transfer_by_account_title'), idempotency_key: idempotencyKey };
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      const raw = await r.text();
      let j: Record<string, unknown> = {};
      try { j = raw ? JSON.parse(raw) : {}; } catch { j = {}; }
      if (!r.ok || j.ok === false) {
        const backendMsg = String((j && (j.error || j.message)) || '').trim();
        throw new Error(backendMsg || `${t('operation_error')} (${r.status})`);
      }
      toast(mode === 'topup' ? `${t('topup_success')} ₴\u00a0${amtNum.toFixed(2)}` : `${t('transfer_success')} ₴\u00a0${amtNum.toFixed(2)}`);
      refreshDashboard();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('operation_error'));
    } finally {
      setLoading(false);
    }
  }

  const inp: React.CSSProperties = {
    width: '100%', padding: '12px 14px', boxSizing: 'border-box',
    background: 'rgba(255,255,255,0.05)', border: `1px solid rgba(180,172,155,0.16)`,
    borderRadius: 12, color: '#f4ebd0', fontSize: 15, outline: 'none', fontFamily: 'inherit',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div
        {...sheetSwipe.sheetProps}
        style={{ width: '100%', maxWidth: 480, background: 'linear-gradient(180deg,#112820 0%,#0b1e16 100%)', border: '1px solid rgba(180,172,155,0.2)', borderRadius: '24px 24px 0 0', padding: '28px 24px 40px', boxShadow: '0 -20px 60px rgba(0,0,0,0.5)', ...sheetSwipe.sheetStyle }}
      >
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(180,172,155,0.25)', margin: '-8px auto 16px' }} />
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24 }}>
          <div style={{ ...T.h2, color: text.primary, flex: 1 }}>{cfg.title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(220,215,200,0.5)', padding: 4 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mode !== 'topup' && (
            <div>
              <label style={{ ...T.caption, color: text.muted, display: 'block', marginBottom: 6 }}>{cfg.recipientLabel}</label>
              <input style={inp} value={recipient} onChange={e => setRecipient(e.target.value)} placeholder={mode === 'by_card' ? t('transfer_placeholder_card') : t('transfer_placeholder_account')} />
            </div>
          )}
          <div>
            <label style={{ ...T.caption, color: text.muted, display: 'block', marginBottom: 6 }}>{t('amount_label')}</label>
            <input
              style={{ ...inp, fontSize: 26, fontWeight: 300, letterSpacing: -0.5 }}
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0,00"
            />
          </div>
          <div>
            <input style={{ ...inp, fontSize: 13 }} value={description} onChange={e => setDescription(e.target.value)} placeholder={cfg.placeholder} />
          </div>
          {error && <div style={{ padding: '10px 14px', background: 'rgba(200,60,60,0.12)', border: '1px solid rgba(200,60,60,0.25)', borderRadius: 10, color: '#f08080', fontSize: 13 }}>{error}</div>}
          <button type="submit" disabled={loading} style={{
            marginTop: 4, padding: '15px', borderRadius: 14,
            border: `1px solid ${bg.border}`,
            background: loading ? 'rgba(40,55,45,0.4)' : 'linear-gradient(160deg, rgba(40,58,48,0.95) 0%, rgba(22,38,28,1) 100%)',
            color: loading ? text.dim : text.primary, fontSize: 15, fontWeight: 600,
            cursor: loading ? 'default' : 'pointer', fontFamily: 'inherit',
            boxShadow: loading ? 'none' : '0 1px 0 rgba(255,255,255,0.05) inset',
            letterSpacing: 0.3,
          }}>{loading ? '…' : cfg.title}</button>
        </form>
      </div>
    </div>
  );
}

function getQuickActions(t: (key: TranslationKey) => string): { label: string; icon: React.ReactNode; action: TabKey | TransferMode }[] {
  return [
    { label: t('quick_topup'), action: 'topup', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 19V5M5 12l7-7 7 7" stroke="#1c2e22" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg> },
    { label: t('quick_by_card'), action: 'by_card', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M12 5l7 7-7 7" stroke="#1c2e22" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg> },
    { label: t('quick_by_account'), action: 'by_account', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 9h18M3 15h18M6 5v14M18 5v14" stroke="#1c2e22" strokeWidth="2" strokeLinecap="round" /></svg> },
    { label: t('quick_market'), action: 'market', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13l-1.5 6h12" stroke="#1c2e22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="9" cy="21" r="1" fill="#1c2e22" /><circle cx="19" cy="21" r="1" fill="#1c2e22" /></svg> },
  ];
}

function OverviewScreen() {
  const layout = useLayout();
  const topPad = useTopPad();
  const { goTo, toast, user, account, transactions, cards: apiCards, openTransfer } = useApp();
  const { profilePhoto, lang, t } = usePreferences();
  function handleQuickAction(action: TabKey | TransferMode) {
    if (action === 'topup' || action === 'by_card' || action === 'by_account') openTransfer(action);
    else goTo(action as TabKey);
  }
  const { analytics } = useBankData();
  const displayName = user?.full_name ?? t('user_fallback');
  const firstName = displayName.split(/\s+/)[0];
  const avatarInitials = initials(displayName);
  const quickActions = getQuickActions(t);
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [cardIdx, setCardIdx] = useState(() => readSelectedCardIndex());
  const [ovFlipped, setOvFlipped] = useState(false);
  const [ovRevealed, setOvRevealed] = useState<{ card_number: string; cvv: string } | null>(null);
  const [ovRevealing, setOvRevealing] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [apiNotifications, setApiNotifications] = useState<ApiNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const token = localStorage.getItem('army_bank_token');
    if (!token) return;
    fetch('/api/notifications/unread-count', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j?.ok) setUnreadCount(j.data?.count ?? 0); })
      .catch(() => {});
  }, []);

  async function openNotificationsPanel() {
    const token = localStorage.getItem('army_bank_token');
    setShowNotifications(true);
    try {
      const [notifRes] = await Promise.all([
        fetch('/api/notifications', { headers: { Authorization: `Bearer ${token ?? ''}` } }),
        token ? fetch('/api/notifications/read-all', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }) : Promise.resolve(null),
      ]);
      if (notifRes.ok) {
        const j = await notifRes.json();
        if (j?.ok && Array.isArray(j.data)) setApiNotifications(j.data);
      }
      setUnreadCount(0);
    } catch { /* ignore */ }
  }

  const userNameUp = (user?.full_name || 'ARMY BANK').toUpperCase();
  const cards: CardData[] = apiCards.length > 0 ? apiCards.map(c => apiCardToData(c, userNameUp)) : [
    { variant: 'gold', number: '0001', name: userNameUp, expiry: '03/29' },
    { variant: 'emerald', number: '1183', name: userNameUp, expiry: '02/29' },
    { variant: 'platinum', number: '7147', name: userNameUp, expiry: '08/28' },
    { variant: 'obsidian', number: '4402', name: userNameUp, expiry: '11/30' },
  ];
  const safeCardIdx = Math.min(cardIdx, Math.max(0, cards.length - 1));
  const swipeStartXRef = useRef<number | null>(null);
  const swipeStartYRef = useRef<number | null>(null);
  const swipeAxisRef = useRef<'x' | 'y' | null>(null);
  const cardViewportRef = useRef<HTMLDivElement | null>(null);
  const [cardViewportWidth, setCardViewportWidth] = useState(0);
  const [dragOffsetX, setDragOffsetX] = useState(0);
  const [isCardDragging, setIsCardDragging] = useState(false);

  useEffect(() => {
    if (cardIdx !== safeCardIdx) setCardIdx(safeCardIdx);
  }, [cardIdx, safeCardIdx]);

  useEffect(() => {
    persistSelectedCardIndex(safeCardIdx);
  }, [safeCardIdx]);

  useEffect(() => {
    function syncCardViewport() {
      const nextWidth = cardViewportRef.current?.clientWidth || 0;
      if (nextWidth > 0) setCardViewportWidth(nextWidth);
    }
    syncCardViewport();
    window.addEventListener('resize', syncCardViewport);
    window.visualViewport?.addEventListener('resize', syncCardViewport);
    return () => {
      window.removeEventListener('resize', syncCardViewport);
      window.visualViewport?.removeEventListener('resize', syncCardViewport);
    };
  }, []);

  function resetCardSwipe() {
    swipeStartXRef.current = null;
    swipeStartYRef.current = null;
    swipeAxisRef.current = null;
    setIsCardDragging(false);
    setDragOffsetX(0);
  }

  function handleCardTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    if (cards.length < 2) return;
    const t = e.touches[0];
    swipeStartXRef.current = t.clientX;
    swipeStartYRef.current = t.clientY;
    swipeAxisRef.current = null;
    setIsCardDragging(true);
    setDragOffsetX(0);
  }

  function handleCardTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (cards.length < 2) return;
    if (swipeStartXRef.current == null || swipeStartYRef.current == null) return;
    const t = e.touches[0];
    const dx = t.clientX - swipeStartXRef.current;
    const dy = t.clientY - swipeStartYRef.current;
    if (!swipeAxisRef.current) {
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        swipeAxisRef.current = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      }
    }
    if (swipeAxisRef.current !== 'x') return;
    e.preventDefault();
    const bounded = Math.max(-150, Math.min(150, dx));
    setDragOffsetX(bounded);
  }

  function handleCardTouchEnd() {
    if (cards.length < 2) {
      resetCardSwipe();
      return;
    }
    const threshold = 52;
    const swipe = dragOffsetX;
    if (Math.abs(swipe) >= threshold) {
      const dir = swipe < 0 ? 1 : -1;
      setCardIdx(prev => Math.max(0, Math.min(cards.length - 1, prev + dir)));
    }
    resetCardSwipe();
  }

  const cardSection = (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <span style={{ ...T.h3, color: text.secondary }}>{t('cards_mine')}</span>
        <span style={{ ...T.sm, color: text.dim }}>• {cards.length}</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => goTo('cards')} style={{ fontSize: 12, color: gold, background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: 3, fontFamily: 'inherit', fontWeight: 500, cursor: 'pointer' }}>
          {t('all')} <Chevron size={12} color={gold} />
        </button>
      </div>
      {!cards.length ? (
        <div style={{ maxWidth: 380, padding: '16px 18px', borderRadius: 16, border: `1px solid ${bg.border}`, background: bg.card }}>
          <div style={{ fontSize: 14, color: text.secondary, marginBottom: 6 }}>{t('cards_not_issued')}</div>
          <div style={{ fontSize: 12, color: text.muted, marginBottom: 12 }}>{t('cards_issue_hint')}</div>
          <button
            onClick={() => goTo('cards')}
            style={{ padding: '8px 12px', borderRadius: 10, border: `1px solid ${bg.border}`, background: 'rgba(255,255,255,0.03)', color: text.secondary, cursor: 'pointer' }}
          >
            {t('open_cards')}
          </button>
        </div>
      ) : (
        <>
          <div
            ref={cardViewportRef}
            data-no-tab-swipe="true"
            style={{
              maxWidth: 380,
              overflow: 'hidden',
              borderRadius: 22,
              touchAction: 'pan-y',
            }}
            onTouchStart={handleCardTouchStart}
            onTouchMove={handleCardTouchMove}
            onTouchEnd={handleCardTouchEnd}
            onTouchCancel={handleCardTouchEnd}
          >
            <div
              style={{
                display: 'flex',
                width: '100%',
                transform: `translate3d(${dragOffsetX - safeCardIdx * (cardViewportWidth || 0)}px, 0, 0)`,
                transition: isCardDragging ? 'none' : 'transform 320ms cubic-bezier(0.22, 0.61, 0.36, 1)',
                willChange: 'transform',
              }}
            >
              {cards.map((c, i) => (
                <div key={`${c.number}-${i}`} style={{ flex: '0 0 100%' }}>
                  <PremiumCard {...c} />
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 14 }}>
            {cards.map((_, i) => (
              <button key={i} onClick={() => setCardIdx(i)} style={{ width: i === safeCardIdx ? 20 : 6, height: 6, borderRadius: 3, background: i === safeCardIdx ? gold : 'rgba(180,172,155,0.25)', border: 'none', padding: 0, cursor: 'pointer', transition: 'all 0.25s' }} />
            ))}
          </div>
        </>
      )}
    </div>
  );

  const quickActionsSection = (
    <div>
      <div style={{ ...T.h3, color: text.secondary, marginBottom: 12 }}>{t('quick_actions')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {quickActions.map(a => <Fragment key={a.label}><QuickAction icon={a.icon} label={a.label} onClick={() => handleQuickAction(a.action)} /></Fragment>)}
      </div>
    </div>
  );

  const byType = (analytics?.by_type || []).filter(r => r.direction === 'out');
  const totalOut = byType.reduce((s, r) => s + Number(r.total), 0);
  const monthIn = Number(analytics?.current_month?.total_in || 0);
  const monthOut = Number(analytics?.current_month?.total_out || 0);
  const flowNet = monthIn - monthOut;
  const flowNetSign = flowNet >= 0 ? '+' : '−';
  const SPEND_LABELS: Record<string, string> = { transfer: t('spend_transfer'), food: t('spend_food'), transport: t('spend_transport'), utility: t('spend_utility'), shopping: t('spend_shopping'), subscription: t('spend_subscription') };
  const SPEND_COLORS: Record<string, string> = { transfer: '#ddd8cc', food: '#e8a864', transport: '#88a8e8', utility: gold, shopping: '#c97db4', subscription: '#78c8b4' };
  const spendRows = totalOut > 0 ? byType.map(r => ({
    label: SPEND_LABELS[r.tx_type] || r.tx_type,
    pct: Math.round(Number(r.total) / totalOut * 100),
    color: SPEND_COLORS[r.tx_type] || gold,
  })) : [];

  const greeting = timeGreeting(lang);

  if (layout === 'desktop') {
    return (
      <div style={{ padding: `${topPad} 32px 48px`, minHeight: '100%' }}>
        {/* Top greeting bar */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 32 }}>
          <div>
            <div style={{ ...T.sm, color: text.muted, marginBottom: 4 }}>{greeting}</div>
            <div style={{ ...T.h1, fontSize: 26, color: text.primary }}>{displayName}</div>
          </div>
          <div style={{ flex: 1 }} />
          {[
            <svg key="chat" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 12a8 8 0 01-11.6 7.1L3 21l1.9-6.4A8 8 0 1121 12z" stroke="#ddd8cc" strokeWidth="1.6" strokeLinejoin="round" /></svg>,
            <svg key="bell" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 004 0" stroke="#ddd8cc" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>,
          ].map((icon, i) => (
            <button key={i} onClick={() => i === 0 ? window.open('https://munister.com.ua/messenger', '_blank') : openNotificationsPanel()} style={{ width: 40, height: 40, borderRadius: 12, background: bg.card, border: `1px solid ${bg.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', marginLeft: 10, position: 'relative' }}>
              {icon}
              {i === 1 && unreadCount > 0 && <span style={{ position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: '50%', background: '#e07070', border: '1.5px solid rgba(7,21,15,0.9)' }} />}
            </button>
          ))}
        </div>

        {/* 2-column grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: 24, alignItems: 'start' }}>
          {/* Left: balance + card + quick actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{ padding: 24, background: bg.card, border: `1px solid ${bg.border}`, borderRadius: 22 }}>
              <BalanceBlock visible={balanceVisible} onToggle={() => setBalanceVisible(v => !v)} balance={account?.balance ?? 0} accountNumber={account?.account_number ?? '—'} />
            </div>
            {cardSection}
            {quickActionsSection}
          </div>
          {/* Right: activity feed */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <ActivityFeed transactions={transactions} />
            {/* Spending stats mini */}
            <div style={{ padding: 20, background: bg.card, border: `1px solid ${bg.border}`, borderRadius: 22 }}>
              <div style={{ ...T.h3, color: text.secondary, marginBottom: 14 }}>{t('spending_this_month')}</div>
              {!spendRows.length && (
                <div style={{ fontSize: 12, color: text.muted }}>{t('insufficient_spend_data')}</div>
              )}
              {spendRows.map(({ label, pct, color }) => (
                <div key={label} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontSize: 12, color: text.secondary }}>{label}</span>
                    <span style={{ fontSize: 12, color: text.muted, fontFeatureSettings: '"tnum"' }}>{pct}%</span>
                  </div>
                  <div style={{ height: 4, background: 'rgba(180,172,155,0.1)', borderRadius: 4 }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, opacity: 0.8 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Mobile layout ──
  return (
    <>
    <div style={{ paddingBottom: 20 }}>
      <div style={{ padding: `${topPad} 22px 8px` }}>
        <div style={{
          padding: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: '50%', background: `linear-gradient(135deg, ${gold} 0%, ${goldDark} 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1a2820', fontSize: 13, fontWeight: 700, boxShadow: 'inset 0 1px 0 rgba(230,225,210,0.5), 0 2px 6px rgba(0,0,0,0.3)', overflow: 'hidden', flexShrink: 0 }}>
              {profilePhoto ? <img src={profilePhoto} alt={t('profile_photo_alt')} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : avatarInitials}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: text.muted, letterSpacing: 0.5, marginBottom: 2 }}>{greeting}</div>
              <div style={{ fontSize: 19, fontWeight: 700, color: text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.1 }}>{firstName}</div>
            </div>
            {[
              <svg key="chat" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 12a8 8 0 01-11.6 7.1L3 21l1.9-6.4A8 8 0 1121 12z" stroke="#ddd8cc" strokeWidth="1.6" strokeLinejoin="round" /></svg>,
              <svg key="bell" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 004 0" stroke="#ddd8cc" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>,
            ].map((icon, i) => (
              <button key={i} onClick={() => i === 0 ? window.open('https://munister.com.ua/messenger', '_blank') : openNotificationsPanel()} style={{ width: 38, height: 38, borderRadius: 12, background: 'rgba(255,255,255,0.035)', border: 'none', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, position: 'relative' }}>
                {icon}
                {i === 1 && unreadCount > 0 && <span style={{ position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: '50%', background: '#e07070', border: '1.5px solid rgba(7,21,15,0.9)' }} />}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: '24px 22px 18px' }}>
        <div style={{ padding: 0 }}>
          <BalanceBlock visible={balanceVisible} onToggle={() => setBalanceVisible(v => !v)} balance={account?.balance ?? 0} accountNumber={account?.account_number ?? '—'} />
        </div>
      </div>

      <div style={{ padding: '0 22px 4px' }}>
        <div style={{ padding: 0 }}>
          {cardSection}
        </div>
      </div>

      <div style={{ padding: '22px 22px 0' }}>
        <div style={{ padding: 0 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {quickActions.map(a => <Fragment key={a.label}><QuickAction icon={a.icon} label={a.label} onClick={() => handleQuickAction(a.action)} /></Fragment>)}
          </div>
        </div>
      </div>

      <div style={{ height: 20 }} />
      <BalanceHistoryChart />
      <TopRecipientsMini onTransfer={acc => { openTransfer('by_account'); }} />

      <div style={{ padding: '0 22px 0' }}>
        <div style={{ padding: 0 }}>
          <ActivityFeed transactions={transactions} />
        </div>
      </div>
    </div>
    {showNotifications && (
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 300, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setShowNotifications(false)}>
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} />
        <div onClick={e => e.stopPropagation()} style={{
          position: 'relative', width: '100%', maxWidth: 520,
          background: 'linear-gradient(180deg,rgba(17,40,32,0.98) 0%,rgba(11,30,22,0.98) 100%)',
          backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
          borderRadius: '24px 24px 0 0',
          padding: '28px 24px calc(32px + env(safe-area-inset-bottom,0px))',
          border: '1px solid rgba(180,172,155,0.15)', borderBottom: 'none',
        }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(180,172,155,0.25)', margin: '0 auto 20px' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: text.primary }}>{t('notifications_center')}</div>
              {apiNotifications.filter(n => !n.is_read).length > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: '#e07070', borderRadius: 100, padding: '1px 6px', letterSpacing: 0.3 }}>
                  {apiNotifications.filter(n => !n.is_read).length}
                </span>
              )}
            </div>
            <button onClick={() => setShowNotifications(false)} style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(180,172,155,0.1)', border: 'none', cursor: 'pointer', color: text.muted, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          </div>
          {apiNotifications.length === 0 ? (
            <div style={{ padding: '28px 0', textAlign: 'center', color: text.muted, fontSize: 14 }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>🔔</div>
              {t('no_new_notifications')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, background: bg.card, border: `1px solid ${bg.border}`, borderRadius: 18, overflow: 'hidden', maxHeight: '60vh', overflowY: 'auto' }}>
              {apiNotifications.map((notif, i) => (
                <Fragment key={notif.id}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px', opacity: notif.is_read ? 0.65 : 1 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: notif.is_read ? 'rgba(180,172,155,0.08)' : 'rgba(127,184,150,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 17 }}>
                      {notif.icon || '🔔'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <div style={{ fontSize: 13, fontWeight: notif.is_read ? 400 : 600, color: text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{notif.title}</div>
                        {!notif.is_read && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#7fb896', flexShrink: 0, display: 'inline-block' }} />}
                      </div>
                      {notif.body ? <div style={{ fontSize: 11, color: text.muted, lineHeight: 1.4 }}>{notif.body}</div> : null}
                      <div style={{ fontSize: 10, color: text.dim, marginTop: 3 }}>{fmtTime(notif.created_at, lang)}</div>
                    </div>
                  </div>
                  {i < apiNotifications.length - 1 && <div style={{ height: 1, background: 'rgba(180,172,155,0.07)', margin: '0 16px 0 64px' }} />}
                </Fragment>
              ))}
            </div>
          )}
        </div>
      </div>
    )}
    </>
  );
}

// ─── Cards screen ─────────────────────────────────────────────
function CardsScreen() {
  const layout = useLayout();
  const topPad = useTopPad();
  const { toast, cards: apiCards, refreshDashboard, transactions: allTx, account, user } = useApp();
  const { t } = usePreferences();
  const { refresh } = useBankData();
  const userNameUp = (user?.full_name || 'ARMY BANK').toUpperCase();
  const statusText = (status?: string) => status === 'active' ? t('card_active_status') : status === 'blocked' ? t('card_frozen_status') : t('card_closed');
  const FALLBACK_CARDS: (CardData & { id: number; type: string; limit: string; used: string; statusRaw: string; cardTypeRaw: string })[] = [
    { id: 0, design: 'gold', variant: 'gold', number: '0001', name: userNameUp, expiry: '03/29', type: t('card_virtual'), limit: '150 000', used: '48 230', status: statusText('active'), statusRaw: 'active', cardTypeRaw: 'virtual' },
    { id: 0, design: 'florence', variant: 'florence', number: '1183', name: userNameUp, expiry: '02/29', type: t('card_physical'), limit: '80 000', used: '12 400', status: statusText('active'), statusRaw: 'active', cardTypeRaw: 'physical' },
    { id: 0, design: 'venice', variant: 'venice', number: '7147', name: userNameUp, expiry: '08/28', type: t('card_physical'), limit: '500 000', used: '215 800', status: statusText('active'), statusRaw: 'active', cardTypeRaw: 'physical' },
    { id: 0, design: 'tuscany_villa', variant: 'tuscany_villa', number: '4402', name: userNameUp, expiry: '11/30', type: t('card_virtual'), limit: '50 000', used: '0', status: statusText('blocked'), statusRaw: 'blocked', cardTypeRaw: 'virtual' },
  ];
  const [designOverrides, setDesignOverrides] = useState<Record<number, string>>({});
  const cards = apiCards.length > 0
    ? apiCards.map(c => {
      const mapped = apiCardToData(c, userNameUp);
      mapped.type = c.card_type === 'physical' ? t('card_physical') : t('card_virtual');
      mapped.status = statusText(c.status);
      const forcedDesign = designOverrides[c.id];
      if (forcedDesign) {
        mapped.design = forcedDesign;
        mapped.variant = DESIGN_TO_VARIANT[forcedDesign] ?? mapped.variant;
      }
      return mapped;
    })
    : FALLBACK_CARDS;
  const [selected, setSelected] = useState(() => readSelectedCardIndex());
  const [pinModal, setPinModal] = useState(false);
  const [pinValue, setPinValue] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinLoading, setPinLoading] = useState(false);
  const [designModal, setDesignModal] = useState(false);
  const [designMode, setDesignMode] = useState<'current' | 'issue'>('current');
  const [designLoading, setDesignLoading] = useState(false);
  const [selectedDesign, setSelectedDesign] = useState<string>('gold');
  const safeIdx = Math.min(selected, Math.max(0, cards.length - 1));
  const card = cards[safeIdx];

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthTransactions = allTx.filter(tx => new Date(tx.created_at) >= monthStart);
  const monthOut = monthTransactions.filter(tx => tx.direction === 'out').reduce((s, tx) => s + tx.amount, 0);
  const busyCardId: number | null = designLoading && designMode === 'current' ? (apiCards[safeIdx]?.id ?? null) : null;
  const statusLabel = card?.status || t('unavailable');
  const currentDesignOption = CARD_DESIGN_OPTIONS.find(opt => opt.design === String(card?.design || '').toLowerCase());
  const activeDesignOption = CARD_DESIGN_OPTIONS.find(opt => opt.design === selectedDesign) ?? CARD_DESIGN_OPTIONS[0];

  useEffect(() => {
    if (card?.design) setSelectedDesign(card.design);
    else if (!card) setSelectedDesign('florence');
  }, [card?.id, card?.design]);

  useEffect(() => {
    if (selected !== safeIdx) setSelected(safeIdx);
  }, [selected, safeIdx]);

  useEffect(() => {
    persistSelectedCardIndex(safeIdx);
  }, [safeIdx]);

  async function changePin() {
    if (pinValue.length !== 4 || !/^\d{4}$/.test(pinValue)) { toast(t('new_pin_4_digits')); return; }
    if (pinValue !== pinConfirm) { toast(t('pin_mismatch')); return; }
    if (apiCards.length === 0) { toast(t('demo_pin_unavailable')); return; }
    const c = apiCards[safeIdx];
    const token = localStorage.getItem('army_bank_token');
    setPinLoading(true);
    try {
      const r = await fetch(`/api/cards/${c.id}/pin`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pin: pinValue }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.message || t('pin_change_error'));
      toast(`✓ ${t('pin_saved')} •• ${card.number}`);
      setPinModal(false); setPinValue(''); setPinConfirm('');
    } catch (e: unknown) { toast(e instanceof Error ? e.message : t('pin_change_error')); }
    finally { setPinLoading(false); }
  }

  async function toggleBlock() {
    if (apiCards.length === 0) { toast(t('demo_api_unavailable')); return; }
    const c = apiCards[safeIdx];
    const token = localStorage.getItem('army_bank_token');
    try {
      const r = await fetch(`/api/cards/${c.id}/block`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.message || t('operation_error'));
      toast(c.status === 'active' ? `${t('card_blocked')} •• ${card.number}` : `${t('card_unblocked')} •• ${card.number}`);
      refreshDashboard();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : t('operation_error')); }
  }

  async function closeCard() {
    if (apiCards.length === 0) { toast(t('demo_api_unavailable')); return; }
    const c = apiCards[safeIdx];
    const token = localStorage.getItem('army_bank_token');
    try {
      const r = await fetch(`/api/cards/${c.id}/close`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.message || t('operation_error'));
      toast(`${t('card_closed')} •• ${card.number}`);
      refreshDashboard();
      setSelected(0);
    } catch (e: unknown) { toast(e instanceof Error ? e.message : t('operation_error')); }
  }

  function openDesignModal(mode: 'current' | 'issue') {
    setDesignMode(mode);
    if (mode === 'current' && card?.design) setSelectedDesign(card.design);
    else if (mode === 'issue') setSelectedDesign('florence');
    setDesignModal(true);
  }

  async function applyCardDesign() {
    if (!selectedDesign) return;
    const token = localStorage.getItem('army_bank_token');
    if (!token) {
      toast(t('session_expired'));
      return;
    }
    setDesignLoading(true);
    try {
      if (designMode === 'current') {
        if (apiCards.length === 0) {
          toast(t('no_card_for_design_change'));
          return;
        }
        const c = apiCards[safeIdx];
        if (!c) throw new Error(t('card_not_found'));
        const r = await fetch(`/api/cards/${c.id}/design`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ design: selectedDesign }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.message || t('card_design_update_failed'));
        setDesignOverrides(prev => ({ ...prev, [c.id]: selectedDesign }));
        toast(`${t('card_design_updated')} •• ${card.number}`);
      } else {
        const r = await fetch('/api/cards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ card_type: 'virtual', design: selectedDesign }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.message || t('card_issue_failed'));
        toast(t('new_card_issued'));
      }
      await refresh().catch(() => {});
      await refreshDashboard();
      setDesignModal(false);
      if (designMode === 'issue') setSelected(0);
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : t('card_design_error'));
    } finally {
      setDesignLoading(false);
    }
  }

  const isFrozen = apiCards.length > 0 ? apiCards[safeIdx]?.status === 'blocked' : card?.statusRaw === 'blocked';

  return (
    <>
    <ContentWrap maxW={760}>
    <div style={{ paddingBottom: layout === 'desktop' ? 80 : 24 }}>
      <div style={{ padding: `${topPad} 22px 16px`, display: 'flex', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 12, color: text.muted, fontWeight: 500, marginBottom: 4 }}>{t('cards_title')}</div>
          <div style={{ ...T.h1, color: text.primary }}>{t('cards_title')}</div>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => openDesignModal('issue')} style={{
          padding: '10px 16px', background: `linear-gradient(135deg, ${gold} 0%, ${goldDark} 100%)`,
          color: text.primary, border: 'none', borderRadius: 100, fontSize: 13, fontWeight: 600,
          fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
          boxShadow: `0 4px 10px -4px rgba(180,172,155,0.5), inset 0 1px 0 rgba(230,225,210,0.5)`,
          opacity: designLoading && designMode === 'issue' ? 0.65 : 1,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="#1c2e22" strokeWidth="2.4" strokeLinecap="round" /></svg>
          {designLoading && designMode === 'issue' ? t('creating') : t('issue_card')}
        </button>
      </div>

      {/* Horizontal card scroll */}
      <div style={{
        display: 'flex', gap: 12, padding: '0 22px 8px',
        overflowX: 'auto', scrollSnapType: 'x mandatory', scrollbarWidth: 'none',
      }}>
        {cards.map((c, i) => (
          <div key={i} style={{ flexShrink: 0, width: 260, scrollSnapAlign: 'center' }}>
            <button onClick={() => setSelected(i)} style={{
              width: '100%', padding: 0, background: 'transparent', border: 'none', cursor: 'pointer',
              textAlign: 'left', opacity: i === safeIdx ? 1 : 0.55, transition: 'opacity 0.3s',
              filter: i === safeIdx ? 'none' : 'saturate(0.7)',
            }}>
              <PremiumCard {...c} style={{ width: '100%' }} />
            </button>
          </div>
        ))}
        {!cards.length && (
          <div style={{ padding: '20px', borderRadius: 18, border: `1px solid ${bg.border}`, background: bg.card, color: text.muted, minWidth: 280 }}>
            {t('cards_not_issued')}
          </div>
        )}
      </div>

      {/* Card details */}
      <div style={{ padding: '20px 22px 0' }}>
        <div style={{ background: bg.card, border: `1px solid ${bg.border}`, borderRadius: 22, padding: 20 }}>
          {!card ? (
            <div style={{ color: text.muted }}>{t('card_not_found')}</div>
          ) : (
          <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <div style={{ fontFamily: '"SF Mono", monospace', fontSize: 16, fontWeight: 600, color: text.primary, letterSpacing: 1 }}>•• {card.number}</div>
            <div style={{
              padding: '3px 8px', borderRadius: 100, background: card.statusRaw === 'active' ? 'rgba(127,184,150,0.15)' : 'rgba(220,215,200,0.1)',
              color: card.statusRaw === 'active' ? '#7fb896' : 'rgba(220,215,200,0.7)',
              fontSize: 10.5, fontWeight: 600, letterSpacing: 0.3,
            }}>{statusLabel}</div>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 11, color: text.muted }}>{card.cardTypeRaw === 'physical' ? t('card_physical') : t('card_virtual')} • {t('card_valid_until')} {card.expiry}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 10 }}>
            <div style={{ fontSize: 12, color: text.muted }}>
              {t('card_design_label')}: <span style={{ color: text.secondary, fontWeight: 600 }}>{currentDesignOption?.title || 'Classic Gold'}</span>
            </div>
            <button
              onClick={() => openDesignModal('current')}
              style={{
                padding: '7px 12px', borderRadius: 10, border: '1px solid rgba(180,172,155,0.24)',
                background: 'rgba(255,255,255,0.04)', color: text.secondary, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >{t('change_label')}</button>
          </div>

          {/* Account activity */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'baseline' }}>
              <span style={{ ...T.caption, color: text.muted }}>{t('account_activity_month')}</span>
              <span style={{ fontSize: 12, color: 'rgba(220,215,200,0.6)', fontFeatureSettings: '"tnum"' }}>{monthTransactions.length} {t('operations_short')}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 22, fontWeight: 600, color: text.primary, fontFeatureSettings: '"tnum"' }}>{formatUah(monthOut)}</span>
              <span style={{ fontSize: 13, color: text.dim, fontFeatureSettings: '"tnum"' }}>{t('spent_label')}</span>
            </div>
            <div style={{ fontSize: 12, color: text.muted }}>
              {t('account_balance_label')}: {formatUah(Number(account?.balance || 0))}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
            {[
              { label: t('card_details'), msg: `${t('cards_title')} •• ${card.number} · ${t('card_valid_until')} ${card.expiry}`, icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="13" rx="2" stroke={gold} strokeWidth="1.6" /><path d="M3 10h18" stroke={gold} strokeWidth="1.6" /></svg> },
              { label: 'PIN', action: () => setPinModal(true), icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="4" y="11" width="16" height="10" rx="2" stroke={gold} strokeWidth="1.6" /><path d="M8 11V8a4 4 0 018 0v3" stroke={gold} strokeWidth="1.6" /></svg> },
              { label: t('design_action'), action: () => openDesignModal('current'), icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h16M4 18h16" stroke={gold} strokeWidth="1.8" strokeLinecap="round" /><circle cx="8" cy="6" r="2" fill={gold} /><circle cx="16" cy="12" r="2" fill={gold} /><circle cx="11" cy="18" r="2" fill={gold} /></svg> },
              { label: t('account_label'), msg: `${t('account_label')}: ${account?.account_number || '—'}`, icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 12a8 8 0 1116 0" stroke={gold} strokeWidth="1.6" strokeLinecap="round" /><path d="M12 12l4-4" stroke={gold} strokeWidth="1.6" strokeLinecap="round" /><circle cx="12" cy="12" r="1.5" fill={gold} /></svg> },
            ].map((a, i) => (
              <button key={i} onClick={() => 'action' in a ? a.action() : toast(a.msg as string)} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                padding: '10px 4px', background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(180,172,155,0.1)', borderRadius: 14,
                color: '#ddd8cc', fontSize: 11, fontFamily: 'inherit', fontWeight: 500, cursor: 'pointer',
              }}>
                {a.icon}{a.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={toggleBlock} style={{
              flex: 1, padding: '12px', background: isFrozen ? 'rgba(127,184,150,0.08)' : 'rgba(232,168,100,0.08)',
              border: `1px solid ${isFrozen ? 'rgba(127,184,150,0.2)' : 'rgba(232,168,100,0.2)'}`, borderRadius: 12,
              color: isFrozen ? '#7fb896' : '#e8a864', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              opacity: busyCardId === card.id || card.statusRaw === 'closed' ? 0.6 : 1,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="4" y="11" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" /><path d="M8 11V8a4 4 0 018 0v3" stroke="currentColor" strokeWidth="1.8" /></svg>
              {isFrozen ? t('unfreeze_card') : t('freeze_card')}
            </button>
            <button onClick={closeCard} style={{
              flex: 1, padding: '12px', background: 'rgba(220,100,110,0.06)',
              border: '1px solid rgba(220,100,110,0.2)', borderRadius: 12,
              color: '#dc646e', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              opacity: busyCardId === card.id || card.statusRaw === 'closed' ? 0.6 : 1,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              {t('close_card')}
            </button>
          </div>
          </>
          )}
        </div>
      </div>
    </div>
    </ContentWrap>

    {/* PIN Change Modal */}
    {pinModal && (
      <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setPinModal(false)}>
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} />
        <div onClick={e => e.stopPropagation()} style={{
          position: 'relative', width: '100%', maxWidth: 480,
          background: 'linear-gradient(180deg,rgba(17,40,32,0.98) 0%,rgba(11,30,22,0.98) 100%)',
          backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
          borderRadius: '24px 24px 0 0', padding: '28px 24px calc(32px + env(safe-area-inset-bottom,0px))',
          border: '1px solid rgba(180,172,155,0.15)', borderBottom: 'none',
        }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(180,172,155,0.25)', margin: '0 auto 20px' }} />
          <div style={{ fontSize: 18, fontWeight: 700, color: text.primary, marginBottom: 4 }}>{t('change_pin')}</div>
          <div style={{ fontSize: 12, color: text.muted, marginBottom: 20 }}>{t('card_short_label')} •• {card.number}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 11, color: text.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5, display: 'block' }}>{t('new_pin_4_digits')}</label>
              <input
                type="password" inputMode="numeric" maxLength={4}
                value={pinValue} onChange={e => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="••••"
                style={{ width: '100%', padding: '12px 14px', background: 'rgba(255,255,255,0.05)', border: `1px solid rgba(180,172,155,0.18)`, borderRadius: 12, color: text.primary, fontSize: 20, outline: 'none', fontFamily: fontFamily, letterSpacing: 8, boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: text.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5, display: 'block' }}>{t('confirm_pin')}</label>
              <input
                type="password" inputMode="numeric" maxLength={4}
                value={pinConfirm} onChange={e => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="••••"
                style={{ width: '100%', padding: '12px 14px', background: 'rgba(255,255,255,0.05)', border: `1px solid ${pinConfirm && pinValue !== pinConfirm ? 'rgba(220,80,80,0.5)' : 'rgba(180,172,155,0.18)'}`, borderRadius: 12, color: text.primary, fontSize: 20, outline: 'none', fontFamily: fontFamily, letterSpacing: 8, boxSizing: 'border-box' }}
              />
              {pinConfirm && pinValue !== pinConfirm && <div style={{ fontSize: 11, color: '#e07070', marginTop: 4 }}>{t('pin_mismatch')}</div>}
            </div>
            {/* 4-dot indicator */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 14, margin: '4px 0' }}>
              {[0,1,2,3].map(i => (
                <div key={i} style={{ width: 14, height: 14, borderRadius: '50%', background: i < pinValue.length ? gold : 'rgba(180,172,155,0.2)', transition: 'background 0.15s', boxShadow: i < pinValue.length ? `0 0 8px ${gold}88` : 'none' }} />
              ))}
            </div>
            <button
              onClick={changePin} disabled={pinLoading || pinValue.length !== 4 || pinValue !== pinConfirm}
              style={{
                width: '100%', padding: '14px', borderRadius: 16, border: 'none', fontSize: 15, fontWeight: 700,
                background: (pinLoading || pinValue.length !== 4 || pinValue !== pinConfirm) ? 'rgba(100,95,80,0.3)' : `linear-gradient(135deg, ${goldDark}, ${gold})`,
                color: text.primary, cursor: (pinLoading || pinValue.length !== 4 || pinValue !== pinConfirm) ? 'default' : 'pointer', fontFamily: fontFamily,
              }}>{pinLoading ? t('saving') : t('save_pin')}</button>
          </div>
        </div>
      </div>
    )}
    {designModal && (
      <div style={{ position: 'fixed', inset: 0, zIndex: 320, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => !designLoading && setDesignModal(false)}>
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(4px)' }} />
        <div onClick={e => e.stopPropagation()} style={{
          position: 'relative', width: '100%', maxWidth: 620,
          background: 'linear-gradient(180deg,rgba(17,40,32,0.98) 0%,rgba(11,30,22,0.98) 100%)',
          backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
          borderRadius: '24px 24px 0 0', padding: '24px 20px calc(22px + env(safe-area-inset-bottom,0px))',
          border: '1px solid rgba(180,172,155,0.15)', borderBottom: 'none',
          maxHeight: '82vh', overflowY: 'auto',
        }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(180,172,155,0.25)', margin: '0 auto 18px' }} />
          <div style={{ fontSize: 18, fontWeight: 700, color: text.primary, marginBottom: 4 }}>
            {designMode === 'current' ? t('choose_card_design') : t('issue_new_card')}
          </div>
          <div style={{ fontSize: 12, color: text.muted, marginBottom: 16 }}>
            {designMode === 'current'
              ? `${t('card_short_label')} •• ${card?.number || '0000'}`
              : t('choose_style_then_issue')}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            {CARD_DESIGN_OPTIONS.map((opt) => (
              <button
                key={opt.design}
                onClick={() => setSelectedDesign(opt.design)}
                style={{
                  padding: 10,
                  borderRadius: 14,
                  border: selectedDesign === opt.design ? '1px solid rgba(220,215,200,0.42)' : '1px solid rgba(180,172,155,0.18)',
                  background: selectedDesign === opt.design ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
                  color: text.secondary,
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <PremiumCard
                  variant={opt.variant}
                  number={card?.number || '0001'}
                  name={card?.name || userNameUp}
                  expiry={card?.expiry || '03/29'}
                  type={card?.type || t('card_virtual')}
                  style={{ width: '100%' }}
                />
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: text.primary }}>{opt.title}</div>
                  <div style={{ fontSize: 11, color: text.muted }}>{t(opt.subtitleKey)}</div>
                </div>
              </button>
            ))}
          </div>

          <div style={{ marginTop: 14, fontSize: 12, color: text.muted }}>
            {t('selected_label')}: <span style={{ color: text.secondary, fontWeight: 700 }}>{activeDesignOption.title}</span>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button
              onClick={() => setDesignModal(false)}
              disabled={designLoading}
              style={{
                flex: 1, padding: '13px 12px', borderRadius: 14, border: '1px solid rgba(180,172,155,0.22)',
                background: 'rgba(255,255,255,0.03)', color: text.secondary, fontSize: 14, fontWeight: 600, cursor: designLoading ? 'default' : 'pointer',
              }}
            >{t('cancel_label')}</button>
            <button
              onClick={applyCardDesign}
              disabled={designLoading}
              style={{
                flex: 1.2, padding: '13px 12px', borderRadius: 14, border: 'none',
                background: `linear-gradient(135deg, ${goldDark}, ${gold})`,
                color: '#1c2e22', fontSize: 14, fontWeight: 800, cursor: designLoading ? 'default' : 'pointer',
                opacity: designLoading ? 0.7 : 1,
              }}
            >{designLoading ? t('applying') : (designMode === 'current' ? t('apply_design') : t('issue_card_full'))}</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

// ─── Operations screen ────────────────────────────────────────
type TxCat = 'income' | 'food' | 'transport' | 'utility' | 'shopping' | 'transfer' | 'subscription';

const CAT_STYLES: Record<TxCat, { bg: string; color: string; icon: React.ReactNode }> = {
  income:       { bg: 'rgba(127,184,150,0.12)', color: '#7fb896', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M6 16l6 6 6-6" stroke="#7fb896" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  food:         { bg: 'rgba(232,168,100,0.12)', color: '#e8a864', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 2v8a3 3 0 006 0V2M9 2v6M18 2c-2 0-3 2-3 5s1 5 3 5v8" stroke="#e8a864" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  transport:    { bg: 'rgba(136,168,232,0.12)', color: '#88a8e8', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 17h14l-2-8H7l-2 8zM7 17v2M17 17v2M9 9V6a3 3 0 016 0v3" stroke="#88a8e8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  utility:      { bg: 'rgba(180,172,155,0.12)', color: gold, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2L4 7v6c0 5 4 8 8 9 4-1 8-4 8-9V7l-8-5zM12 8v4l3 2" stroke={gold} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  shopping:     { bg: 'rgba(201,125,180,0.12)', color: '#c97db4', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 7h16l-1.5 11a2 2 0 01-2 1.8h-9a2 2 0 01-2-1.8L4 7zM9 7V5a3 3 0 016 0v2" stroke="#c97db4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  transfer:     { bg: 'rgba(220,215,200,0.1)', color: '#ddd8cc', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M7 17l-4-4 4-4M3 13h13M17 7l4 4-4 4M21 11H8" stroke="#ddd8cc" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  subscription: { bg: 'rgba(120,200,180,0.12)', color: '#78c8b4', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 12a9 9 0 0115-6.7L21 8M21 3v5h-5M21 12a9 9 0 01-15 6.7L3 16M3 21v-5h5" stroke="#78c8b4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> },
};

function OperationsScreen() {
  const layout = useLayout();
  const { t, lang } = usePreferences();
  const topPad = useTopPad();
  const { toast, transactions, account } = useApp();
  const [period, setPeriod] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [txFilter, setTxFilter] = useState<'all' | 'in' | 'out'>('all');
  const [dlReceipt, setDlReceipt] = useState<number | null>(null);
  const [dlExport, setDlExport] = useState(false);
  const [selectedTxId, setSelectedTxId] = useState<number | null>(null);
  const [txNote, setTxNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const token = localStorage.getItem('army_bank_token');

  const selectedTxData = selectedTxId ? transactions.find(tx => tx.id === selectedTxId) ?? null : null;

  async function saveNote() {
    if (!selectedTxId || !token) return;
    setSavingNote(true);
    try {
      const r = await fetch(`/api/transactions/${selectedTxId}/note`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ note: txNote }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.message || t('operation_error'));
      toast(t('tx_note_saved'));
      setSelectedTxId(null);
    } catch (e: unknown) { toast(e instanceof Error ? e.message : t('operation_error')); }
    finally { setSavingNote(false); }
  }

  const locale = localeForLang(lang);
  const periodLabels = [t('period_week_short'), t('period_month_short'), t('period_year_short')];
  const periodDays = [7, 30, 365][period];
  const periodMs = periodDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const startTs = now - periodMs;
  const bucketMs = periodMs / 7;
  const values = Array.from({ length: 7 }, (_, i) => {
    const bucketStart = startTs + i * bucketMs;
    const bucketEnd = bucketStart + bucketMs;
    return transactions.filter(tx => tx.direction === 'out' && new Date(tx.created_at).getTime() >= bucketStart && new Date(tx.created_at).getTime() < bucketEnd).reduce((s, tx) => s + tx.amount, 0);
  });
  const max = Math.max(...values, 1);
  const labels = Array.from({ length: 7 }, (_, i) => {
    const stamp = new Date(startTs + (i + 1) * bucketMs);
    return period === 2
      ? stamp.toLocaleDateString(locale, { month: 'short' })
      : stamp.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
  });

  async function downloadReceipt(txId: number) {
    setDlReceipt(txId);
    try {
      const r = await fetch(`/api/transactions/${txId}/receipt`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { toast(t('receipt_download_error')); return; }
      const blob = await r.blob();
      openPdfBlobInNewTab(blob, `receipt-${txId}.pdf`, toast);
    } catch { toast(t('download_error')); } finally { setDlReceipt(null); }
  }

  async function downloadExport() {
    setDlExport(true);
    try {
      const r = await fetch('/api/transactions/export', { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { toast(t('export_error')); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'army_bank_transactions.csv'; a.click();
      URL.revokeObjectURL(url);
    } catch { toast(t('download_error')); } finally { setDlExport(false); }
  }

  async function downloadStatement() {
    try {
      const r = await fetch('/api/transactions/statement', { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { toast(t('statement_error')); return; }
      const blob = await r.blob();
      openPdfBlobInNewTab(blob, 'statement.pdf', toast);
    } catch { toast(t('download_error')); }
  }

  // Build tx groups from real API data (or fallback to static)
  const STATIC_GROUPS: { group: string; items: { txId?: number; title: string; subtitle: string; amount: string; positive?: boolean; cat: TxCat }[] }[] = [
    { group: t('today_label'), items: [
      { title: 'Income • FOP', subtitle: '14:32', amount: '+84 200,00', positive: true, cat: 'income' },
      { title: 'Silpo', subtitle: `12:18 • ${t('card_short_label')} •• 0001`, amount: '-1 247,50', cat: 'food' },
      { title: 'Uklon', subtitle: '09:42 • Apple Pay', amount: '-148,00', cat: 'transport' },
    ]},
    { group: t('yesterday_label'), items: [
      { title: 'Utilities', subtitle: 'Kyivenergo', amount: '-3 180,00', cat: 'utility' },
      { title: 'Rozetka', subtitle: 'Online shopping', amount: '-6 420,00', cat: 'shopping' },
    ]},
  ];

  const filtered = (searchQuery.trim()
    ? transactions.filter(tx => tx.description.toLowerCase().includes(searchQuery.toLowerCase()))
    : transactions
  ).filter(tx => txFilter === 'all' || tx.direction === txFilter);

  const apiGroups = (() => {
    const map: Record<string, TxItem[]> = {};
    for (const tx of filtered) { const k = tx.created_at.slice(0, 10); if (!map[k]) map[k] = []; map[k].push(tx); }
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a)).map(([dateKey, items]) => ({
      group: fmtDateLabel(dateKey, lang),
      items: items.map(tx => ({
        txId: tx.id,
        title: tx.description,
        subtitle: fmtTime(tx.created_at, lang) + (tx.related_account ? ` • ${tx.related_account}` : ''),
        amount: (tx.direction === 'in' ? '+' : '-') + fmtInt(tx.amount) + fmtDec(tx.amount),
        positive: tx.direction === 'in',
        cat: txToCat(tx),
      })),
    }));
  })();

  const txGroups = apiGroups.length > 0 ? apiGroups : (searchQuery ? [] : STATIC_GROUPS);

  // Spending total from real data
  const totalSpent = transactions.filter(t => t.direction === 'out').reduce((s, t) => s + t.amount, 0);
  const spentLabel = account && transactions.length > 0 ? `₴\u00a0${fmtInt(totalSpent)}${fmtDec(totalSpent)}` : '₴\u00a042\u00a0380';

  return (
    <>
    <ContentWrap maxW={720}>
    <div style={{ paddingBottom: layout === 'desktop' ? 80 : 24 }}>
      <div style={{ padding: `${topPad} 22px 14px` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ ...T.h1, color: text.primary }}>{t('operations_title')}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={downloadExport} disabled={dlExport} title={t('download_csv')} style={{ width: 36, height: 36, borderRadius: 10, background: bg.card, border: `1px solid ${bg.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: gold, fontSize: 16 }}>{dlExport ? '…' : '📊'}</button>
            <button onClick={downloadStatement} title={t('statement_pdf')} style={{ width: 36, height: 36, borderRadius: 10, background: bg.card, border: `1px solid ${bg.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: gold, fontSize: 16 }}>📄</button>
          </div>
        </div>
        {/* Search */}
        <div style={{ position: 'relative' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', opacity: 0.5 }}><circle cx="11" cy="11" r="7" stroke="#ddd8cc" strokeWidth="1.8" /><path d="M20 20l-3-3" stroke="#ddd8cc" strokeWidth="1.8" strokeLinecap="round" /></svg>
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t('search_transactions')}
            style={{ width: '100%', padding: '10px 14px 10px 36px', background: 'rgba(255,255,255,0.04)', border: `1px solid rgba(180,172,155,0.14)`, borderRadius: 12, color: '#ddd8cc', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
        </div>
        {/* Type filter */}
        <div style={{ display: 'flex', gap: 4, padding: '3px', background: 'rgba(26,40,32,0.5)', borderRadius: 100, marginTop: 10 }}>
          {(['all', 'in', 'out'] as const).map(f => (
            <button key={f} onClick={() => setTxFilter(f)} style={{
              flex: 1, padding: '5px 8px', fontSize: 11, fontWeight: 500,
              background: f === txFilter ? `linear-gradient(135deg, ${gold}, ${goldDark})` : 'transparent',
              color: f === txFilter ? '#0c1a12' : 'rgba(220,215,200,0.6)',
              border: 'none', borderRadius: 100, cursor: 'pointer', fontFamily: 'inherit',
              transition: 'background 0.2s, color 0.2s',
            }}>
              {f === 'all' ? t('filter_all') : f === 'in' ? t('filter_income') : t('filter_outcome')}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div style={{ padding: '0 22px 18px' }}>
        <div style={{ padding: 20, ...glassCard() }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <div style={{ ...sectionLabel, padding: 0, marginBottom: 4 }}>{t('spending_this_month')}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ ...T.h1, ...T.num, color: text.primary }}>{spentLabel}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4, padding: 3, background: 'rgba(26,40,32,0.5)', borderRadius: 100 }}>
              {periodLabels.map((p, i) => (
                <button key={p} onClick={() => setPeriod(i)} style={{
                  padding: '4px 11px', fontSize: 11, fontWeight: 500,
                  background: i === period ? `linear-gradient(135deg, ${gold}, ${goldDark})` : 'transparent',
                  color: i === period ? '#0c1a12' : 'rgba(220,215,200,0.6)',
                  border: 'none', borderRadius: 100, cursor: 'pointer', fontFamily: 'inherit',
                }}>{p}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 90, marginBottom: 8 }}>
            {values.map((v, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                <div style={{
                  width: '100%', height: `${(v / max) * 100}%`,
                  background: i === 6
                    ? `linear-gradient(180deg, ${goldLight} 0%, ${gold} 50%, ${goldDark} 100%)`
                    : 'linear-gradient(180deg, rgba(180,172,155,0.35) 0%, rgba(100,95,80,0.15) 100%)',
                  borderRadius: 6,
                  boxShadow: i === 6 ? '0 0 20px rgba(180,172,155,0.4)' : 'none',
                }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {labels.map((d, i) => (
              <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: i === 6 ? gold : 'rgba(220,215,200,0.4)', fontWeight: i === 6 ? 600 : 400 }}>{d}</div>
            ))}
          </div>
        </div>
      </div>

      {/* Category breakdown (only in "all" or "outcome" mode with real data) */}
      {(() => {
        const outTx = filtered.filter(tx => tx.direction === 'out');
        if (outTx.length === 0) return null;
        const catTotals: Record<string, number> = {};
        for (const tx of outTx) {
          const cat = txToCat(tx);
          catTotals[cat] = (catTotals[cat] || 0) + tx.amount;
        }
        const total = outTx.reduce((s, tx) => s + tx.amount, 0);
        const rows = Object.entries(catTotals)
          .sort(([, a], [, b]) => b - a)
          .map(([cat, amt]) => ({
            cat: cat as TxCat,
            pct: Math.round(amt / total * 100),
            amt,
          }));
        if (!rows.length) return null;
        const SPEND_LABELS: Record<string, string> = { transfer: t('spend_transfer'), food: t('spend_food'), transport: t('spend_transport'), utility: t('spend_utility'), shopping: t('spend_shopping'), subscription: t('spend_subscription'), income: t('filter_income') };
        return (
          <div style={{ padding: '0 22px 18px' }}>
            <div style={{ padding: 20, ...glassCard() }}>
              <div style={{ fontSize: 11, color: text.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 14 }}>{t('filter_outcome')}</div>
              {rows.map(({ cat, pct, amt }) => {
                const s = CAT_STYLES[cat];
                return (
                  <div key={cat} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <div style={{ width: 20, height: 20, borderRadius: 6, background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{s.icon}</div>
                        <span style={{ fontSize: 12, color: text.secondary }}>{SPEND_LABELS[cat] || cat}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontSize: 12, color: text.secondary, fontFeatureSettings: '"tnum"' }}>{fmtInt(amt)}{fmtDec(amt)} ₴</span>
                        <span style={{ fontSize: 10, color: text.muted }}>{pct}%</span>
                      </div>
                    </div>
                    <div style={{ height: 4, background: 'rgba(180,172,155,0.1)', borderRadius: 4 }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: s.color, borderRadius: 4, opacity: 0.75, transition: 'width 0.4s ease' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {txFilter === 'all' && <InsightsStrip />}

      {/* Transactions */}
      {txGroups.length === 0 && (
        <div style={{ padding: '40px 22px', textAlign: 'center', color: text.muted, fontSize: 14 }}>
          {searchQuery ? `${t('nothing_found_for')} «${searchQuery}»` : t('no_transactions_yet')}
        </div>
      )}
      {txGroups.map((g, gi) => (
        <div key={gi} style={{ padding: '4px 22px 12px' }}>
          <div style={{ ...sectionLabel }}>{g.group}</div>
          <div style={{ background: bg.card, border: `1px solid ${bg.border}`, borderRadius: 18, overflow: 'hidden' }}>
            {g.items.map((item, i) => {
              const s = CAT_STYLES[item.cat];
              return (
                <Fragment key={i}>
                  <div
                    onClick={() => { if (item.txId) { setSelectedTxId(item.txId); const tx = transactions.find(tx => tx.id === item.txId); setTxNote(tx?.note ?? ''); } }}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: item.txId ? 'pointer' : 'default' }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, background: s.bg,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      border: `1px solid ${s.color}22`,
                    }}>{s.icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ ...T.body, fontWeight: 500, color: text.secondary, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</div>
                      <div style={{ ...T.sm, color: text.muted }}>{item.subtitle}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ ...T.body, fontWeight: 600, color: item.positive ? '#7fb896' : text.secondary, ...T.num }}>{item.amount} ₴</div>
                      {item.txId ? (
                        <button onClick={e => { e.stopPropagation(); downloadReceipt(item.txId!); }} disabled={dlReceipt === item.txId} title={t('download_receipt')} style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(180,172,155,0.08)', border: `1px solid rgba(180,172,155,0.15)`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 13 }}>{dlReceipt === item.txId ? '…' : '🧾'}</button>
                      ) : (
                        <Chevron size={12} color="rgba(220,215,200,0.3)" />
                      )}
                    </div>
                  </div>
                  {i < g.items.length - 1 && <div style={{ height: 1, background: 'rgba(180,172,155,0.08)', margin: '0 16px 0 64px' }} />}
                </Fragment>
              );
            })}
          </div>
        </div>
      ))}
    </div>
    </ContentWrap>

    {/* Transaction detail sheet */}
    {selectedTxId && selectedTxData && (
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 300, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setSelectedTxId(null)}>
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} />
        <div onClick={e => e.stopPropagation()} style={{
          position: 'relative', width: '100%', maxWidth: 520,
          background: 'linear-gradient(180deg,rgba(17,40,32,0.98) 0%,rgba(11,30,22,0.98) 100%)',
          backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
          borderRadius: '24px 24px 0 0', padding: '28px 24px calc(32px + env(safe-area-inset-bottom,0px))',
          border: '1px solid rgba(180,172,155,0.15)', borderBottom: 'none',
        }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(180,172,155,0.25)', margin: '0 auto 20px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
            {(() => { const s = CAT_STYLES[txToCat(selectedTxData)]; return <div style={{ width: 44, height: 44, borderRadius: 14, background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{s.icon}</div>; })()}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedTxData.description}</div>
              <div style={{ fontSize: 12, color: text.muted, marginTop: 3 }}>{fmtTime(selectedTxData.created_at, lang)}</div>
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: selectedTxData.direction === 'in' ? '#7fb896' : text.primary, fontFeatureSettings: '"tnum"', flexShrink: 0 }}>
              {selectedTxData.direction === 'in' ? '+' : '-'}{fmtInt(selectedTxData.amount)}{fmtDec(selectedTxData.amount)} ₴
            </div>
          </div>
          <label style={{ fontSize: 11, color: text.muted, textTransform: 'uppercase', letterSpacing: 0.8, display: 'block', marginBottom: 8 }}>{t('tx_note_label')}</label>
          <textarea
            value={txNote}
            onChange={e => setTxNote(e.target.value)}
            placeholder={t('tx_note_placeholder')}
            rows={3}
            style={{ width: '100%', padding: '12px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(180,172,155,0.18)', borderRadius: 14, color: text.primary, fontSize: 14, outline: 'none', fontFamily: 'inherit', resize: 'none', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button onClick={() => setSelectedTxId(null)} style={{ flex: 1, padding: '12px', background: 'rgba(180,172,155,0.07)', border: '1px solid rgba(180,172,155,0.15)', borderRadius: 14, color: text.muted, fontSize: 14, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer' }}>
              {t('cancel_label')}
            </button>
            <button onClick={saveNote} disabled={savingNote} style={{ flex: 2, padding: '12px', background: `linear-gradient(135deg, ${gold}, ${goldDark})`, border: 'none', borderRadius: 14, color: '#0c1a12', fontSize: 14, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', opacity: savingNote ? 0.7 : 1 }}>
              {savingNote ? '…' : t('profile_save')}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

// ─── Profile screen ───────────────────────────────────────────
function ProfileRow({ label, value, mono, copyable, last }: { label: string; value: string; mono?: boolean; copyable?: boolean; last?: boolean }) {
  const { toast } = useApp();
  const copy = () => {
    const tt = translations[getStoredLanguage()];
    navigator.clipboard.writeText(value).then(() => toast(`${tt.copy_success}: ${value}`)).catch(() => toast(tt.copy_failed));
  };
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', gap: 12 }}>
        <span style={{ ...T.caption, color: text.muted }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{
            fontSize: 14, color: text.secondary, fontWeight: 500,
            fontFamily: mono ? '"SF Mono", monospace' : 'inherit',
            fontFeatureSettings: '"tnum"', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{value}</span>
          {copyable && (
            <button onClick={copy} style={{
              width: 26, height: 26, borderRadius: 7, background: `rgba(180,172,155,0.1)`,
              border: `1px solid rgba(180,172,155,0.2)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, flexShrink: 0,
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke={gold} strokeWidth="2" /><path d="M5 15V5a2 2 0 012-2h10" stroke={gold} strokeWidth="2" /></svg>
            </button>
          )}
        </div>
      </div>
      {!last && <div style={{ height: 1, background: 'rgba(180,172,155,0.08)', margin: '0 18px' }} />}
    </>
  );
}

function ProfileToggle({ label, sub, on, onChange, icon }: { label: string; sub?: string; on: boolean; onChange: (v: boolean) => void; icon: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px' }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10, background: 'rgba(180,172,155,0.1)',
        border: `1px solid rgba(180,172,155,0.18)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, color: text.secondary, fontWeight: 500, marginBottom: 2 }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: text.muted }}>{sub}</div>}
      </div>
      <button onClick={() => onChange(!on)} style={{
        width: 44, height: 26, borderRadius: 100,
        background: on ? `linear-gradient(135deg, ${goldDark}, ${gold})` : 'rgba(180,172,155,0.15)',
        border: 'none', padding: 0, cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
        boxShadow: on ? 'inset 0 1px 0 rgba(230,225,210,0.4)' : 'none',
      }}>
        <div style={{
          position: 'absolute', top: 3, left: on ? 21 : 3,
          width: 20, height: 20, borderRadius: '50%', background: '#fff',
          transition: 'left 0.2s',
          boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
        }} />
      </button>
    </div>
  );
}

function ProfileScreen() {
  const layout = useLayout();
  const topPad = useTopPad();
  const { logout, user, account, toast } = useApp();
  const { profilePhoto, setProfilePhotoValue, lang, setLang, t } = usePreferences();
  const [faceid, setFaceid] = useState(false);
  const [faceIdReady, setFaceIdReady] = useState(false); // platform auth available
  const [faceIdBusy, setFaceIdBusy] = useState(false);
  const [push, setPush] = useState(true);
  const [twofa, setTwofa] = useState(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  // Check passkey status on mount
  useEffect(() => {
    const checkFaceId = async () => {
      if (!window.PublicKeyCredential) return;
      const available = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false);
      if (!available) return;
      setFaceIdReady(true);
      const token = localStorage.getItem('army_bank_token');
      const res = await fetch('/api/auth/passkey/status', { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
      if (res?.ok) {
        const json = await res.json();
        setFaceid(json.data?.has_passkey ?? false);
      }
    };
    checkFaceId();
  }, []);

  async function handleFaceIdToggle(on: boolean) {
    if (faceIdBusy) return;
    setFaceIdBusy(true);
    const token = localStorage.getItem('army_bank_token');
    try {
      if (on) {
        // Register passkey
        const optRes = await fetch('/api/auth/passkey/register-options', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}',
        });
        const optJson = await optRes.json();
        if (!optRes.ok || !optJson.ok) throw new Error(optJson.error || t('operation_error'));
        const attResp = await startRegistration({ optionsJSON: optJson.data });
        const verRes = await fetch('/api/auth/passkey/register', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(attResp),
        });
        const verJson = await verRes.json();
        if (!verRes.ok || !verJson.ok) throw new Error(verJson.error || t('registration_error'));
        setFaceid(true);
        toast(t('face_id_on'));
      } else {
        // Remove passkey
        const res = await fetch('/api/auth/passkey/remove', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || t('operation_error'));
        setFaceid(false);
        toast(t('face_id_off'));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('operation_error');
      if (!msg.toLowerCase().includes('cancel') && !msg.toLowerCase().includes('abort') && !msg.toLowerCase().includes('not allowed')) {
        toast(msg);
      }
    } finally {
      setFaceIdBusy(false);
    }
  }
  const [changingPwd, setChangingPwd] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  const [achievements, setAchievements] = useState<{ achievements: Achievement[]; done: number; total: number } | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('army_bank_token');
    if (!token) return;
    fetch('/api/achievements', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j?.ok && j.data) setAchievements(j.data); })
      .catch(() => {});
  }, []);

  const displayName = user?.full_name ?? t('user_fallback');
  const userInitials = initials(displayName);
  const phone = user?.phone
    ? ('+' + user.phone.replace(/^\+/, '')).replace(/^\+(\d{3})(\d{2})(\d{3})(\d{2})(\d{2})$/, '+$1 $2 $3 $4 $5')
    : '—';

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwdLoading(true);
    try {
      const token = localStorage.getItem('army_bank_token');
      const res = await fetch('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ old_password: oldPwd, new_password: newPwd }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.message || t('operation_error'));
      toast(t('password_changed'));
      setChangingPwd(false); setOldPwd(''); setNewPwd('');
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : t('operation_error'));
    } finally {
      setPwdLoading(false);
    }
  }

  function onPickProfilePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast(t('pick_image'));
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      toast(t('photo_too_large'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      if (!value) {
        toast(t('photo_read_error'));
        return;
      }
      setProfilePhoto(value);
      setProfilePhotoValue(value);
      toast(t('photo_updated'));
    };
    reader.onerror = () => toast(t('photo_upload_error'));
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function removeProfilePhoto() {
    setProfilePhoto('');
    setProfilePhotoValue('');
    toast(t('photo_removed'));
  }

  const languageOptions: { value: AppLang; label: string }[] = [
    { value: 'uk', label: t('lang_uk') },
    { value: 'en', label: t('lang_en') },
    { value: 'it', label: t('lang_it') },
    { value: 'es', label: t('lang_es') },
  ];

  const section = (children: React.ReactNode) => (
    <div style={{ background: bg.card, border: `1px solid ${bg.border}`, borderRadius: 20, overflow: 'hidden', margin: '0 22px 14px' }}>
      {children}
    </div>
  );

  return (
    <ContentWrap maxW={680}>
    <div style={{ paddingBottom: layout === 'desktop' ? 80 : 24 }}>
      {/* Avatar */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: `${topPad} 22px 28px` }}>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          onChange={onPickProfilePhoto}
          style={{ display: 'none' }}
        />
        <div style={{
          width: 80, height: 80, borderRadius: '50%',
          background: `linear-gradient(135deg, ${gold} 0%, ${goldDark} 100%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28, fontWeight: 700, color: '#1a2820', letterSpacing: 0.5,
          boxShadow: `0 0 0 3px rgba(0,0,0,0.6), 0 0 0 5px ${gold}55, inset 0 1px 0 rgba(230,225,210,0.5)`,
          marginBottom: 14,
          overflow: 'hidden',
        }}>
          {profilePhoto ? (
            <img src={profilePhoto} alt={t('profile_photo_alt')} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            userInitials
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button
            onClick={() => photoInputRef.current?.click()}
            style={{
              padding: '6px 12px', borderRadius: 10, border: '1px solid rgba(180,172,155,0.24)',
              background: 'rgba(255,255,255,0.05)', color: text.secondary, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {t('profile_change_photo')}
          </button>
          {profilePhoto && (
            <button
              onClick={removeProfilePhoto}
              style={{
                padding: '6px 12px', borderRadius: 10, border: '1px solid rgba(220,100,110,0.25)',
                background: 'rgba(220,100,110,0.08)', color: '#f2b6be', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {t('profile_remove_photo')}
            </button>
          )}
        </div>
        <div style={{ ...T.h2, color: text.primary, marginBottom: 4 }}>{displayName}</div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', background: 'rgba(127,184,150,0.12)', border: '1px solid rgba(127,184,150,0.25)', borderRadius: 100 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#7fb896' }} />
          <span style={{ fontSize: 11.5, color: '#7fb896', fontWeight: 500 }}>{t('profile_verified')}</span>
        </div>
      </div>

      {/* Account info */}
      {section(<>
        <ProfileRow label={t('profile_name')} value={displayName} />
        <ProfileRow label={t('profile_phone')} value={phone} mono />
        <ProfileRow label={t('profile_email')} value={user?.email ?? '—'} copyable />
        <ProfileRow label={t('profile_account')} value={account?.account_number ?? '—'} mono copyable last />
      </>)}

      <div style={{ padding: '4px 22px 8px' }}>
        <div style={{ ...sectionLabel }}>{t('settings_language')}</div>
      </div>
      {section(
        <div style={{ padding: '14px 18px' }}>
          <div style={{ fontSize: 14, color: text.secondary, fontWeight: 500, marginBottom: 4 }}>{t('settings_language')}</div>
          <div style={{ fontSize: 11.5, color: text.muted, marginBottom: 12 }}>{t('settings_language_sub')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            {languageOptions.map(option => {
              const active = option.value === lang;
              return (
                <button
                  key={option.value}
                  onClick={() => setLang(option.value)}
                  style={{
                    padding: '11px 12px',
                    borderRadius: 12,
                    border: active ? `1px solid rgba(180,172,155,0.34)` : '1px solid rgba(180,172,155,0.14)',
                    background: active ? 'linear-gradient(135deg, rgba(180,172,155,0.16), rgba(100,95,80,0.08))' : 'rgba(255,255,255,0.04)',
                    color: active ? text.primary : text.secondary,
                    fontSize: 13,
                    fontWeight: active ? 700 : 500,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Security */}
      <div style={{ padding: '4px 22px 8px' }}>
        <div style={{ ...sectionLabel }}>{t('profile_security')}</div>
      </div>
      {section(<>
        {faceIdReady ? (
          <ProfileToggle
            label="Face ID"
            sub={faceIdBusy ? t('wait_processing') : t('face_id_transfer_sub')}
            on={faceid}
            onChange={handleFaceIdToggle}
            icon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={gold} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 9V5a2 2 0 012-2h3M2 15v4a2 2 0 002 2h3M22 9V5a2 2 0 00-2-2h-3M22 15v4a2 2 0 01-2 2h-3"/>
                <circle cx="9" cy="10" r="0.6" fill={gold} stroke="none"/>
                <circle cx="15" cy="10" r="0.6" fill={gold} stroke="none"/>
                <path d="M9 15c0 0 1 1.5 3 1.5s3-1.5 3-1.5"/>
                <path d="M12 7v2"/>
              </svg>
            }
          />
        ) : (
          <ProfileToggle label="Face ID" sub={t('face_id_unavailable')} on={false} onChange={() => {}}
            icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(180,172,155,0.35)" strokeWidth="1.5" strokeLinecap="round"><path d="M2 9V5a2 2 0 012-2h3M2 15v4a2 2 0 002 2h3M22 9V5a2 2 0 00-2-2h-3M22 15v4a2 2 0 01-2 2h-3"/></svg>}
          />
        )}
        <div style={{ height: 1, background: 'rgba(180,172,155,0.08)', margin: '0 18px' }} />
        <ProfileToggle label={t('push_notifications')} on={push} onChange={setPush}
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 004 0" stroke={gold} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        />
        <div style={{ height: 1, background: 'rgba(180,172,155,0.08)', margin: '0 18px' }} />
        <ProfileToggle label="2FA" sub={t('twofa_sms')} on={twofa} onChange={setTwofa}
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="4" y="11" width="16" height="10" rx="2" stroke={gold} strokeWidth="1.6" /><path d="M8 11V8a4 4 0 018 0v3" stroke={gold} strokeWidth="1.6" /></svg>}
        />
      </>)}

      {/* Change password */}
      <div style={{ padding: '4px 22px 8px' }}>
        <div style={{ ...sectionLabel }}>{t('profile_password')}</div>
      </div>
      {section(<>
        <div
          onClick={() => setChangingPwd(v => !v)}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', cursor: 'pointer' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(180,172,155,0.1)', border: `1px solid rgba(180,172,155,0.18)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="4" y="11" width="16" height="10" rx="2" stroke={gold} strokeWidth="1.6" /><path d="M8 11V8a4 4 0 018 0v3" stroke={gold} strokeWidth="1.6" /></svg>
            </div>
            <span style={{ fontSize: 14, color: text.secondary, fontWeight: 500 }}>{t('profile_change_password')}</span>
          </div>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ transform: changingPwd ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>
            <path d="M6 4l4 4-4 4" stroke={text.muted} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        {changingPwd && (
          <>
            <div style={{ height: 1, background: 'rgba(180,172,155,0.08)', margin: '0 18px' }} />
            <form onSubmit={changePassword} style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                type="password" placeholder={t('profile_current_password')} value={oldPwd} onChange={e => setOldPwd(e.target.value)} required
                style={{ padding: '11px 14px', background: 'rgba(255,255,255,0.05)', border: `1px solid rgba(180,172,155,0.14)`, borderRadius: 10, color: text.primary, fontSize: 14, outline: 'none', fontFamily: 'inherit' }}
              />
              <input
                type="password" placeholder={t('profile_new_password')} value={newPwd} onChange={e => setNewPwd(e.target.value)} required
                style={{ padding: '11px 14px', background: 'rgba(255,255,255,0.05)', border: `1px solid rgba(180,172,155,0.14)`, borderRadius: 10, color: text.primary, fontSize: 14, outline: 'none', fontFamily: 'inherit' }}
              />
              <button type="submit" disabled={pwdLoading} style={{
                padding: '11px', background: pwdLoading ? 'rgba(100,95,80,0.3)' : `linear-gradient(135deg, ${goldDark}, ${gold})`,
                border: 'none', borderRadius: 10, color: text.primary, fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: pwdLoading ? 'default' : 'pointer',
              }}>{pwdLoading ? '…' : t('profile_save')}</button>
            </form>
          </>
        )}
      </>)}

      {/* Achievements */}
      {achievements && (
        <div style={{ margin: '0 22px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ ...T.h3, color: text.secondary }}>{t('achievements_title')}</span>
            <span style={{ fontSize: 12, color: text.muted }}>{achievements.done}/{achievements.total} {t('achievements_progress')}</span>
          </div>
          <div style={{ height: 3, background: 'rgba(180,172,155,0.1)', borderRadius: 3, marginBottom: 14, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(achievements.done / achievements.total) * 100}%`, background: `linear-gradient(90deg, ${gold}, ${goldDark})`, borderRadius: 3, transition: 'width 0.6s ease' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {achievements.achievements.map(a => (
              <div key={a.id} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '10px 6px',
                background: a.done ? 'rgba(127,184,150,0.07)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${a.done ? 'rgba(127,184,150,0.2)' : 'rgba(180,172,155,0.08)'}`,
                borderRadius: 14, opacity: a.done ? 1 : 0.45, transition: 'opacity 0.3s',
              }}>
                <span style={{ fontSize: 22, filter: a.done ? 'none' : 'grayscale(1)' }}>{a.icon}</span>
                <span style={{ fontSize: 9, color: a.done ? text.secondary : text.muted, textAlign: 'center', lineHeight: 1.3, fontWeight: a.done ? 600 : 400 }}>{a.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sign out */}
      <div style={{ padding: '8px 22px' }}>
        <button onClick={logout} style={{
          width: '100%', padding: '14px', borderRadius: 16,
          background: 'rgba(220,100,110,0.06)', border: '1px solid rgba(220,100,110,0.18)',
          color: '#dc646e', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M17 16l4-4-4-4M21 12H9M13 4a9 9 0 100 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {t('profile_logout')}
        </button>
      </div>
    </div>
    </ContentWrap>
  );
}

// ─── Bottom tab bar ───────────────────────────────────────────

// ─── Marketplace screen ───────────────────────────────────────
interface Product { id: number; title: string; description?: string; price: number; currency?: string; image_emoji?: string; image_url?: string; badge?: string; stock?: number; slug?: string; }
interface MarketOrder { id: number; total_amount: number; currency: string; status: string; invoice_number?: string; invoice_status?: string; created_at?: string; items_count?: number; }
interface MarketInvoice { invoice_number: string; amount: number; currency: string; status: string; due_at?: string; paid_at?: string; created_at?: string; order_id?: number; }
interface CartItem { product: Product; qty: number; }

const BADGE_COLORS: Record<string, { bg: string; color: string }> = {
  'HOT':      { bg: 'rgba(220,60,60,0.15)', color: '#e07070' },
  'NEW':      { bg: 'rgba(60,180,120,0.15)', color: '#7fb896' },
  'TOP':      { bg: 'rgba(200,170,60,0.15)', color: gold },
  'SALE':     { bg: 'rgba(220,120,40,0.15)', color: '#e09060' },
  'PRO':      { bg: 'rgba(120,100,200,0.15)', color: '#a090e0' },
  'GAMING':   { bg: 'rgba(200,60,220,0.15)', color: '#d070d0' },
  'ARM DEAL': { bg: 'rgba(180,172,155,0.15)', color: gold },
  'M3':       { bg: 'rgba(60,120,200,0.15)', color: '#70a0e0' },
  'M4':       { bg: 'rgba(60,120,200,0.15)', color: '#70a0e0' },
};

function BadgePill({ badge }: { badge: string }) {
  const c = BADGE_COLORS[badge] || { bg: 'rgba(180,172,155,0.12)', color: gold };
  return (
    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: c.bg, color: c.color, letterSpacing: 0.5, textTransform: 'uppercase' }}>{badge}</span>
  );
}

function ProductVisual({ product, size = 'card' }: { product: Product; size?: 'card' | 'detail' | 'cart' }) {
  const emoji = product.image_emoji || '🛍️';
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = String(product.image_url || '').trim();
  const preferFallback = /^arm-/i.test(product.slug || '');

  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl, product.id]);

  if (imageUrl && !imageFailed && !preferFallback) {
    return (
      <img
        src={imageUrl}
        alt={product.title}
        loading="lazy"
        onError={() => setImageFailed(true)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
          padding: size === 'cart' ? 0 : 8,
          boxSizing: 'border-box',
          transform: size === 'detail' ? 'scale(1.01)' : 'scale(1)',
        }}
      />
    );
  }
  return (
    <span style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: size === 'detail' ? 62 : size === 'cart' ? 24 : 42,
      lineHeight: 1,
      background: size === 'cart'
        ? 'rgba(221,216,204,0.06)'
        : 'radial-gradient(circle at 32% 24%, rgba(221,216,204,0.18), transparent 38%), linear-gradient(145deg, rgba(20,50,38,0.82), rgba(7,20,14,0.92))',
    }}>
      {emoji}
    </span>
  );
}

function ProductDetailDrawer({ product, onClose, onAddToCart }: { product: Product; onClose: () => void; onAddToCart: (p: Product) => void }) {
  const { t } = usePreferences();
  const sheetSwipe = useSheetSwipeClose(onClose);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }} onClick={onClose}>
      <div style={{ background: `rgba(0,0,0,${0.5 - sheetSwipe.progress * 0.32})`, position: 'absolute', inset: 0, transition: sheetSwipe.dragging ? 'none' : 'background 200ms ease' }} />
      <div
        {...sheetSwipe.sheetProps}
        onClick={e => e.stopPropagation()}
        style={{
        position: 'relative', background: 'linear-gradient(180deg,#112820 0%,#0b1e16 100%)',
        borderRadius: '24px 24px 0 0', padding: '28px 24px 48px',
        boxShadow: '0 -20px 60px rgba(0,0,0,0.6)', maxHeight: '85vh', overflowY: 'auto',
        border: '1px solid rgba(180,172,155,0.15)', borderBottom: 'none',
        ...sheetSwipe.sheetStyle,
      }}
      >
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(180,172,155,0.25)', margin: '0 auto 24px' }} />
        <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
          {product.badge && <BadgePill badge={product.badge} />}
          {product.stock !== undefined && product.stock <= 5 && product.stock > 0 && (
            <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: 'rgba(220,100,60,0.15)', color: '#e07858', letterSpacing: 0.5 }}>{t('last_items_badge')} {product.stock}</span>
          )}
        </div>
        <div style={{
          height: 176,
          borderRadius: 24,
          overflow: 'hidden',
          marginBottom: 18,
          background: 'radial-gradient(circle at 35% 20%, rgba(221,216,204,0.16), transparent 38%), rgba(255,255,255,0.04)',
          border: '1px solid rgba(221,216,204,0.12)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 18px 40px rgba(0,0,0,0.28)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <ProductVisual product={product} size="detail" />
        </div>
        <div style={{ ...T.h2, color: text.primary, marginBottom: 8 }}>{product.title}</div>
        {product.description && (
          <div style={{ ...T.bodyLg, color: text.muted, lineHeight: 1.6, marginBottom: 20 }}>{product.description}</div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div style={{ ...T.hero, fontWeight: 800, color: gold, ...T.num }}>₴{fmtInt(product.price)}{fmtDec(product.price)}</div>
          {product.stock !== undefined && (
            <div style={{ fontSize: 12, color: product.stock > 0 ? text.muted : '#e07070' }}>
              {product.stock > 0 ? `${t('in_stock')}: ${product.stock}` : t('market_out_of_stock')}
            </div>
          )}
        </div>
        <button
          onClick={() => { onAddToCart(product); onClose(); }}
          disabled={product.stock !== undefined && product.stock <= 0}
          style={{
            width: '100%', padding: '15px', borderRadius: 16, border: 'none', fontSize: 16, fontWeight: 700,
            background: (product.stock !== undefined && product.stock <= 0) ? 'rgba(100,95,80,0.25)' : `linear-gradient(135deg, ${goldDark}, ${gold})`,
            color: text.primary, cursor: (product.stock !== undefined && product.stock <= 0) ? 'default' : 'pointer', fontFamily: 'inherit',
          }}
        >
          {(product.stock !== undefined && product.stock <= 0) ? t('market_out_of_stock') : t('add_to_cart')}
        </button>
      </div>
    </div>
  );
}

function CartDrawer({ cart, onClose, onQtyChange, onRemove, onCheckout, checkingOut, user }: {
  cart: CartItem[]; onClose: () => void;
  onQtyChange: (id: number, delta: number) => void;
  onRemove: (id: number) => void;
  onCheckout: (shipping: { name: string; phone: string; address: string }) => void;
  checkingOut: boolean;
  user: { full_name: string; phone: string } | null;
}) {
  const { t } = usePreferences();
  const sheetSwipe = useSheetSwipeClose(onClose);
  const total = cart.reduce((s, i) => s + i.product.price * i.qty, 0);
  const [step, setStep] = useState<'cart' | 'shipping'>('cart');
  const [shipName, setShipName] = useState(user?.full_name || '');
  const [shipPhone, setShipPhone] = useState(user?.phone || '');
  const [shipAddr, setShipAddr] = useState('');
  const cartCount = cart.reduce((s, i) => s + i.qty, 0);
  const cartRowsMaxHeight = cart.length > 3 ? 'min(42dvh, 360px)' : undefined;

  const fieldStyle: React.CSSProperties = {
    width: '100%', padding: '11px 14px', background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(180,172,155,0.18)', borderRadius: 12,
    color: text.primary, fontSize: 14, outline: 'none', fontFamily: fontFamily,
    boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = { fontSize: 11, color: text.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5, display: 'block' };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }} onClick={onClose}>
      <div style={{ background: `rgba(0,0,0,${0.5 - sheetSwipe.progress * 0.32})`, position: 'absolute', inset: 0, transition: sheetSwipe.dragging ? 'none' : 'background 200ms ease' }} />
      <div
        {...sheetSwipe.sheetProps}
        onClick={e => e.stopPropagation()}
        style={{
        position: 'relative',
        background: 'linear-gradient(180deg,rgba(17,40,32,0.98) 0%,rgba(11,30,22,0.98) 100%)',
        backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
        borderRadius: '28px 28px 0 0',
        padding: '18px 18px 0',
        boxShadow: '0 -20px 60px rgba(0,0,0,0.6)',
        height: 'auto',
        maxHeight: 'min(86dvh, 720px)',
        overflow: 'hidden',
        border: '1px solid rgba(180,172,155,0.15)', borderBottom: 'none',
        display: 'flex',
        flexDirection: 'column',
        ...sheetSwipe.sheetStyle,
      }}
      >
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(180,172,155,0.25)', margin: '0 auto 16px', flexShrink: 0 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          {step === 'shipping' && (
            <button onClick={() => setStep('cart')} style={{ width: 32, height: 32, borderRadius: 10, background: 'rgba(180,172,155,0.1)', border: '1px solid rgba(180,172,155,0.18)', color: gold, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 4L6 8l4 4" stroke={gold} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          )}
          <div style={{ ...T.h2, color: text.primary, flex: 1 }}>
            {step === 'cart' ? t('cart_title') : t('delivery_title')}
          </div>
          {step === 'cart' && <div style={{ ...T.body, color: text.muted }}>{cartCount} {t('cart_items_count')}</div>}
        </div>

        {step === 'cart' && (
          cart.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: text.muted }}>{t('cart_empty')}</div>
          ) : (
            <>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                overflowY: cart.length > 3 ? 'auto' : 'visible',
                maxHeight: cartRowsMaxHeight,
                paddingBottom: 14,
                WebkitOverflowScrolling: 'touch',
              }}>
                {cart.map(item => (
                  <div key={item.product.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 12px', background: 'rgba(255,255,255,0.04)', border: `1px solid ${bg.border}`, borderRadius: 16 }}>
                    <div style={{ width: 46, height: 46, borderRadius: 13, overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(221,216,204,0.06)' }}>
                      <ProductVisual product={item.product} size="cart" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: text.secondary, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.product.title}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: gold }}>₴{fmtInt(item.product.price * item.qty)}{fmtDec(item.product.price * item.qty)}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button onClick={() => onQtyChange(item.product.id, -1)} style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(180,172,155,0.1)', border: `1px solid rgba(180,172,155,0.2)`, color: gold, fontSize: 16, cursor: 'pointer', fontFamily: fontFamily, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                      <span style={{ fontSize: 14, fontWeight: 600, color: text.primary, minWidth: 20, textAlign: 'center' }}>{item.qty}</span>
                      <button onClick={() => onQtyChange(item.product.id, 1)} style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(180,172,155,0.1)', border: `1px solid rgba(180,172,155,0.2)`, color: gold, fontSize: 16, cursor: 'pointer', fontFamily: fontFamily, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                      <button onClick={() => onRemove(item.product.id)} style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(220,80,80,0.08)', border: '1px solid rgba(220,80,80,0.15)', color: '#e07070', fontSize: 14, cursor: 'pointer', fontFamily: fontFamily, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{
                margin: '0 -18px',
                padding: '16px 18px calc(18px + env(safe-area-inset-bottom, 0px))',
                background: 'linear-gradient(180deg, rgba(11,30,22,0.98) 0%, rgba(7,21,15,0.99) 100%)',
                borderTop: '1px solid rgba(221,216,204,0.08)',
                boxShadow: '0 -20px 38px rgba(0,0,0,0.22)',
              }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14, padding: '0 4px' }}>
                <span style={{ fontSize: 14, color: text.muted }}>{t('total_label')}:</span>
                <span style={{ ...T.h2, fontWeight: 800, color: gold, ...T.num }}>₴{fmtInt(total)}{fmtDec(total)}</span>
              </div>
                <button onClick={() => setStep('shipping')} style={{
                  width: '100%', padding: '15px', borderRadius: 16, border: 'none', fontSize: 16, fontWeight: 700,
                  background: `linear-gradient(135deg, ${goldDark}, ${gold})`,
                  color: text.primary, cursor: 'pointer', fontFamily: fontFamily,
                }}>{t('next_delivery')}</button>
              </div>
            </>
          )
        )}

        {step === 'shipping' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', paddingBottom: 'calc(18px + env(safe-area-inset-bottom, 0px))' }}>
            <div>
              <label style={labelStyle}>{t('recipient_label')}</label>
              <input value={shipName} onChange={e => setShipName(e.target.value)} placeholder={t('shipping_name_placeholder')} style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t('delivery_phone')}</label>
              <input value={shipPhone} onChange={e => setShipPhone(e.target.value)} placeholder="+380XXXXXXXXX" style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t('delivery_address')}</label>
              <input value={shipAddr} onChange={e => setShipAddr(e.target.value)} placeholder={t('shipping_address_placeholder')} style={fieldStyle} />
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '4px 4px 0' }}>
              <span style={{ fontSize: 13, color: text.muted }}>{t('pay_total')}:</span>
              <span style={{ ...T.h2, fontWeight: 800, color: gold, ...T.num }}>₴{fmtInt(total)}{fmtDec(total)}</span>
            </div>
            <button
              onClick={() => onCheckout({ name: shipName, phone: shipPhone, address: shipAddr })}
              disabled={checkingOut || shipName.trim().length < 2 || shipAddr.trim().length < 8}
              style={{
                width: '100%', padding: '15px', borderRadius: 16, border: 'none', fontSize: 16, fontWeight: 700,
                background: (checkingOut || shipName.trim().length < 2 || shipAddr.trim().length < 8)
                  ? 'rgba(100,95,80,0.3)' : `linear-gradient(135deg, ${goldDark}, ${gold})`,
                color: text.primary, cursor: (checkingOut || shipName.trim().length < 2 || shipAddr.trim().length < 8) ? 'default' : 'pointer',
                fontFamily: fontFamily,
              }}>{checkingOut ? t('checkout_processing') : `✓ ${t('place_order')}`}</button>
          </div>
        )}
      </div>
    </div>
  );
}

type MarketTab = 'catalog' | 'orders' | 'invoices';

function MarketplaceScreen() {
  const PRODUCTS_PER_PAGE = 4;
  const layout = useLayout();
  const { t, lang } = usePreferences();
  const topPad = useTopPad();
  const { toast, refreshDashboard, user: mktUser, setTabBarHidden } = useApp();
  const [tab, setTabState] = useState<MarketTab>(() => readStoredMarketTab());
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<MarketOrder[]>([]);
  const [invoices, setInvoices] = useState<MarketInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [dlPdf, setDlPdf] = useState<string | null>(null);
  const [preview, setPreview] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartItem[]>(() => {
    try { return JSON.parse(localStorage.getItem('arm_cart') || '[]'); } catch { return []; }
  });
  const [showCart, setShowCart] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [search, setSearch] = useState('');
  const [catalogPage, setCatalogPage] = useState(1);
  const marketTopRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { localStorage.setItem('arm_cart', JSON.stringify(cart)); }, [cart]);
  useEffect(() => {
    const hidden = Boolean(showCart || preview);
    setTabBarHidden(hidden);
    return () => setTabBarHidden(false);
  }, [showCart, preview, setTabBarHidden]);

  const token = localStorage.getItem('army_bank_token');

  const setTab = React.useCallback((next: MarketTab) => {
    setTabState(next);
    markAppContinuation();
    try {
      localStorage.setItem(MARKET_TAB_STORAGE_KEY, next);
    } catch {
      // ignore storage errors
    }
  }, []);

  function addToCart(product: Product) {
    setCart(prev => {
      const existing = prev.find(i => i.product.id === product.id);
      if (existing) return prev.map(i => i.product.id === product.id ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { product, qty: 1 }];
    });
    toast(`✓ ${product.title} — ${t('added_to_cart')}`);
  }

  function changeQty(id: number, delta: number) {
    setCart(prev => prev.map(i => i.product.id === id ? { ...i, qty: Math.max(1, i.qty + delta) } : i));
  }

  function removeFromCart(id: number) {
    setCart(prev => prev.filter(i => i.product.id !== id));
  }

  async function checkoutCart(shipping: { name: string; phone: string; address: string }) {
    if (cart.length === 0) return;
    setCheckingOut(true);
    const idempotencyKey = `cart-${Date.now()}`;
    try {
      await ensureApiStatusHealthy();
      const r = await fetch('/api/marketplace/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          items: cart.map(i => ({ product_id: i.product.id, qty: i.qty })),
          shipping_name: shipping.name.trim(),
          shipping_phone: shipping.phone.trim(),
          shipping_address: shipping.address.trim(),
          payment_mode: 'pay_now',
          idempotency_key: idempotencyKey,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.message || j.error || t('checkout_error'));
      toast(`✓ ${t('checkout_success')}`);
      setCart([]);
      setShowCart(false);
      refreshDashboard();
      setTimeout(() => setTab('orders'), 800);
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : t('checkout_error'));
    } finally {
      setCheckingOut(false);
    }
  }

  const cartCount = cart.reduce((s, i) => s + i.qty, 0);

  useEffect(() => {
    if (tab === 'catalog') {
      setLoading(true);
      fetch('/api/marketplace/catalog?per_page=96&sort=newest', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(j => { if (j.ok) setProducts(Array.isArray(j.data?.items) ? j.data.items : (Array.isArray(j.data) ? j.data : [])); })
        .catch(() => {})
        .finally(() => setLoading(false));
    } else if (tab === 'orders') {
      setLoading(true);
      fetch('/api/marketplace/orders', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(j => { if (j.ok) setOrders(Array.isArray(j.data?.orders) ? j.data.orders : []); })
        .catch(() => {})
        .finally(() => setLoading(false));
    } else if (tab === 'invoices') {
      setLoading(true);
      fetch('/api/marketplace/invoices', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(j => { if (j.ok) setInvoices(Array.isArray(j.data?.invoices) ? j.data.invoices : []); })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [tab]);

  async function downloadOrderReceipt(orderId: number) {
    setDlPdf(`order-${orderId}`);
    try {
      const r = await fetch(`/api/marketplace/order/${orderId}/receipt`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { toast(t('receipt_download_error')); return; }
      const blob = await r.blob();
      openPdfBlobInNewTab(blob, `receipt-${orderId}.pdf`, toast);
    } catch { toast(t('download_error')); } finally { setDlPdf(null); }
  }

  const MARKET_TABS: { k: MarketTab; label: string }[] = [
    { k: 'catalog', label: t('catalog_tab') },
    { k: 'orders', label: t('orders_tab') },
    { k: 'invoices', label: t('invoices_tab') },
  ];

  const statusTone: Record<string, { fg: string; bg: string; border: string }> = {
    paid: { fg: '#86ca9f', bg: 'rgba(75,155,105,0.16)', border: 'rgba(134,202,159,0.35)' },
    active: { fg: '#86ca9f', bg: 'rgba(75,155,105,0.16)', border: 'rgba(134,202,159,0.35)' },
    issued: { fg: '#d8c9a6', bg: 'rgba(184,176,154,0.15)', border: 'rgba(216,201,166,0.3)' },
    pending: { fg: '#d8c9a6', bg: 'rgba(184,176,154,0.15)', border: 'rgba(216,201,166,0.3)' },
    overdue: { fg: '#f09b96', bg: 'rgba(190,85,80,0.14)', border: 'rgba(240,155,150,0.35)' },
    cancelled: { fg: '#c4bdaf', bg: 'rgba(160,150,132,0.12)', border: 'rgba(196,189,175,0.25)' },
    expired: { fg: '#c4bdaf', bg: 'rgba(160,150,132,0.12)', border: 'rgba(196,189,175,0.25)' },
  };
  function toneOf(status: string) {
    return statusTone[String(status || '').toLowerCase()] || { fg: gold, bg: 'rgba(184,176,154,0.14)', border: 'rgba(184,176,154,0.3)' };
  }
  function formatUkDate(v?: string) {
    if (!v) return '—';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(localeForLang(lang));
  }
  function formatUkDateTime(v?: string) {
    if (!v) return '—';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(localeForLang(lang), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  const filteredProducts = search.trim()
    ? products.filter(p => p.title.toLowerCase().includes(search.toLowerCase()) || (p.description || '').toLowerCase().includes(search.toLowerCase()))
    : products;
  const totalCatalogPages = Math.max(1, Math.ceil(filteredProducts.length / PRODUCTS_PER_PAGE));
  const pagedProducts = filteredProducts.slice((catalogPage - 1) * PRODUCTS_PER_PAGE, catalogPage * PRODUCTS_PER_PAGE);
  const catalogPages = useMemo<(number | 'gap-left' | 'gap-right')[]>(() => {
    if (totalCatalogPages <= 7) return Array.from({ length: totalCatalogPages }, (_, i) => i + 1);

    const set = new Set<number>([1, totalCatalogPages, catalogPage - 1, catalogPage, catalogPage + 1]);
    if (catalogPage <= 3) [2, 3, 4].forEach(p => set.add(p));
    if (catalogPage >= totalCatalogPages - 2) [totalCatalogPages - 3, totalCatalogPages - 2, totalCatalogPages - 1].forEach(p => set.add(p));

    const sorted = Array.from(set).filter(p => p >= 1 && p <= totalCatalogPages).sort((a, b) => a - b);
    const result: (number | 'gap-left' | 'gap-right')[] = [];
    sorted.forEach((page, idx) => {
      const prev = sorted[idx - 1];
      if (prev && page - prev > 1) result.push(prev === 1 ? 'gap-left' : 'gap-right');
      result.push(page);
    });
    return result;
  }, [catalogPage, totalCatalogPages]);

  function goToCatalogPage(nextPage: number) {
    const next = Math.max(1, Math.min(totalCatalogPages, nextPage));
    setCatalogPage(next);
    window.setTimeout(() => {
      marketTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  useEffect(() => {
    setCatalogPage(1);
  }, [search, tab]);

  useEffect(() => {
    if (catalogPage > totalCatalogPages) setCatalogPage(totalCatalogPages);
  }, [catalogPage, totalCatalogPages]);

  const isMobileMarket = layout !== 'desktop';
  const marketGridGap = isMobileMarket ? 8 : 10;
  const marketCardHeight = isMobileMarket ? 202 : 230;
  const marketImageHeight = isMobileMarket ? 84 : 108;
  const marketCardPad = isMobileMarket ? '9px 10px 10px' : '10px 12px 12px';
  const marketTitleClamp: React.CSSProperties = isMobileMarket
    ? { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 34 }
    : {};

  return (
    <>
    {preview && <ProductDetailDrawer product={preview} onClose={() => setPreview(null)} onAddToCart={addToCart} />}
    {showCart && <CartDrawer cart={cart} onClose={() => setShowCart(false)} onQtyChange={changeQty} onRemove={removeFromCart} onCheckout={checkoutCart} checkingOut={checkingOut} user={mktUser} />}
    {!showCart && !preview && tab === 'catalog' && cartCount > 0 && (
      <button
        onClick={() => setShowCart(true)}
        style={{
          position: 'fixed',
          right: 16,
          bottom: 'calc(112px + env(safe-area-inset-bottom, 0px))',
          zIndex: 160,
          border: '1px solid rgba(180,172,155,0.3)',
          borderRadius: 14,
          background: 'linear-gradient(135deg, rgba(32,56,44,0.92), rgba(20,36,28,0.94))',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          color: text.primary,
          padding: '10px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          boxShadow: '0 12px 24px rgba(0,0,0,0.35)',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
          <span style={{ fontSize: 16 }}>⌁</span>
        <span style={{ fontSize: 12, fontWeight: 700 }}>{cartCount}</span>
      </button>
    )}
    <ContentWrap maxW={800}>
    <div style={{ paddingBottom: layout === 'desktop' ? 80 : 'calc(104px + env(safe-area-inset-bottom, 0px))', overflowX: 'hidden' }}>
      <div ref={marketTopRef} style={{ padding: `${topPad} 22px 12px` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ ...T.h1, color: text.primary }}>{t('market_title')}</div>
          <button onClick={() => setShowCart(true)} style={{ position: 'relative', width: 44, height: 44, borderRadius: 14, background: bg.card, border: `1px solid ${bg.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 20 }}>
            ⌁
            {cartCount > 0 && (
              <span style={{ position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: '50%', background: gold, color: text.primary, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{cartCount > 9 ? '9+' : cartCount}</span>
            )}
          </button>
        </div>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, padding: 4, background: 'rgba(26,40,32,0.5)', borderRadius: 14, width: 'fit-content', marginBottom: tab === 'catalog' ? 12 : 0 }}>
          {MARKET_TABS.map(t => (
            <button key={t.k} onClick={() => setTab(t.k)} style={{
              padding: '6px 16px', borderRadius: 10, fontSize: 13, fontWeight: 500, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              background: tab === t.k ? `linear-gradient(135deg, ${goldDark}, ${gold})` : 'transparent',
              color: tab === t.k ? '#0c1a12' : text.muted,
            }}>{t.label}</button>
          ))}
        </div>
        {/* Search (catalog only) */}
        {tab === 'catalog' && (
          <div style={{ position: 'relative' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', opacity: 0.4 }}><circle cx="11" cy="11" r="7" stroke="#ddd8cc" strokeWidth="1.8" /><path d="M20 20l-3-3" stroke="#ddd8cc" strokeWidth="1.8" strokeLinecap="round" /></svg>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('product_search')} style={{ width: '100%', padding: '10px 14px 10px 36px', background: 'rgba(255,255,255,0.04)', border: `1px solid rgba(180,172,155,0.14)`, borderRadius: 12, color: '#ddd8cc', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
          </div>
        )}
      </div>

      {loading && <div style={{ padding: 60, textAlign: 'center', color: text.muted, fontSize: 14 }}>{t('loading')}</div>}

      {/* ── CATALOG ── */}
      {!loading && tab === 'catalog' && (
        <>
          {filteredProducts.length === 0 ? (
            <div style={{ padding: '60px 22px', textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🛍️</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: text.secondary, marginBottom: 6 }}>{search ? t('no_results') : t('market_empty')}</div>
              <div style={{ fontSize: 13, color: text.muted }}>{search ? t('try_another_query') : t('products_not_added')}</div>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: marketGridGap, padding: isMobileMarket ? '6px 22px' : '8px 22px' }}>
                {pagedProducts.map(p => (
                  <div key={p.id} onClick={() => setPreview(p)} style={{ background: 'rgba(255,255,255,0.036)', border: '1px solid rgba(180,172,155,0.07)', borderRadius: 18, overflow: 'hidden', display: 'flex', flexDirection: 'column', cursor: 'pointer', transition: 'background 0.15s', height: marketCardHeight }}>
                    <div style={{ height: marketImageHeight, flexShrink: 0, background: `linear-gradient(135deg, rgba(180,172,155,0.08), rgba(100,95,80,0.04))`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 42, position: 'relative', overflow: 'hidden' }}>
                      <ProductVisual product={p} />
                      {p.badge && (
                        <div style={{ position: 'absolute', top: 8, right: 8 }}><BadgePill badge={p.badge} /></div>
                      )}
                    </div>
                    <div style={{ padding: marketCardPad, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ ...T.sm, fontSize: isMobileMarket ? 13 : T.sm.fontSize, fontWeight: 600, color: text.secondary, lineHeight: 1.25, ...marketTitleClamp }}>{p.title}</div>
                      <div style={{ marginTop: 'auto', paddingTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                        <span style={{ ...T.body, fontWeight: 700, color: gold, ...T.num }}>₴{fmtInt(p.price)}</span>
                        <button onClick={e => { e.stopPropagation(); addToCart(p); }} disabled={p.stock !== undefined && p.stock <= 0} style={{
                          width: 28, height: 28, borderRadius: 8, border: `1px solid ${bg.border}`, fontSize: 14, fontWeight: 700,
                          background: (p.stock !== undefined && p.stock <= 0) ? 'rgba(30,45,35,0.4)' : 'rgba(180,172,155,0.15)',
                          color: text.secondary, cursor: (p.stock !== undefined && p.stock <= 0) ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>+</button>
                      </div>
                      {p.stock !== undefined && p.stock > 0 && p.stock <= 5 && (
                        <div style={{ fontSize: 9, color: '#e0a070', fontWeight: 600 }}>{t('last_items')}: {p.stock}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {filteredProducts.length > PRODUCTS_PER_PAGE && (
                <div data-no-tab-swipe="true" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '12px 22px 16px', position: 'relative', zIndex: 2, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => goToCatalogPage(catalogPage - 1)}
                    disabled={catalogPage === 1}
                    style={{
                      width: 32, height: 32, borderRadius: 10, border: `1px solid ${bg.border}`,
                      background: catalogPage === 1 ? 'rgba(255,255,255,0.03)' : 'rgba(180,172,155,0.12)',
                      color: catalogPage === 1 ? text.dim : text.secondary, cursor: catalogPage === 1 ? 'default' : 'pointer',
                      fontFamily: 'inherit', fontWeight: 700,
                    }}
                  >‹</button>
                  {catalogPages.map(page => (
                    typeof page === 'number' ? (
                    <button
                      key={page}
                      onClick={() => goToCatalogPage(page)}
                      style={{
                        minWidth: 32, height: 32, padding: '0 8px', borderRadius: 10, border: 'none',
                        background: page === catalogPage ? `linear-gradient(135deg, ${goldDark}, ${gold})` : 'rgba(255,255,255,0.04)',
                        color: page === catalogPage ? '#0c1a12' : text.secondary, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                      }}
                    >{page}</button>
                    ) : (
                      <span key={page} style={{ minWidth: 18, color: text.dim, textAlign: 'center', fontWeight: 700 }}>…</span>
                    )
                  ))}
                  <button
                    onClick={() => goToCatalogPage(catalogPage + 1)}
                    disabled={catalogPage === totalCatalogPages}
                    style={{
                      width: 32, height: 32, borderRadius: 10, border: `1px solid ${bg.border}`,
                      background: catalogPage === totalCatalogPages ? 'rgba(255,255,255,0.03)' : 'rgba(180,172,155,0.12)',
                      color: catalogPage === totalCatalogPages ? text.dim : text.secondary, cursor: catalogPage === totalCatalogPages ? 'default' : 'pointer',
                      fontFamily: 'inherit', fontWeight: 700,
                    }}
                  >›</button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── ORDERS ── */}
      {!loading && tab === 'orders' && (
        <div style={{ padding: '8px 22px' }}>
          {orders.length === 0 ? (
            <div style={{ padding: '60px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: text.secondary, marginBottom: 6 }}>{t('orders_empty')}</div>
              <div style={{ fontSize: 13, color: text.muted }}>{t('catalog_first_order_hint')}</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {orders.map(o => {
                const tone = toneOf(o.status);
                return (
                <div key={o.id} style={{
                  background: 'linear-gradient(160deg, rgba(18,40,30,0.72) 0%, rgba(9,22,16,0.9) 100%)',
                  border: `1px solid rgba(180,172,155,0.24)`,
                  borderRadius: 18,
                  padding: '14px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  boxShadow: 'inset 0 1px 0 rgba(230,225,210,0.08), 0 12px 26px rgba(0,0,0,0.22)',
                }}>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: text.secondary }}>{t('order_label')} #{o.id}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', padding: '3px 8px', borderRadius: 100, background: tone.bg, border: `1px solid ${tone.border}`, color: tone.fg }}>{o.status}</span>
                    </div>
                    <div style={{ fontSize: 12, color: text.muted }}>{o.items_count || 0} {t('order_items_suffix')} · {formatUkDateTime(o.created_at)}</div>
                    {o.invoice_number && <div style={{ fontSize: 11, color: text.dim, marginTop: 1, fontFamily: 'monospace' }}>{t('invoice_label')}: {o.invoice_number}</div>}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ ...T.bodyLg, fontWeight: 700, color: gold, ...T.num }}>₴{fmtInt(o.total_amount)}{fmtDec(o.total_amount)}</div>
                    <button onClick={() => downloadOrderReceipt(o.id)} disabled={dlPdf === `order-${o.id}`} style={{
                      marginTop: 7,
                      padding: '5px 11px',
                      borderRadius: 10,
                      border: `1px solid rgba(184,176,154,0.38)`,
                      background: 'linear-gradient(135deg, rgba(184,176,154,0.25), rgba(122,114,101,0.2))',
                      color: text.primary,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      letterSpacing: 0.2,
                    }}>{dlPdf === `order-${o.id}` ? '…' : `🧾 ${t('receipt_short')}`}</button>
                  </div>
                </div>
              );})}
            </div>
          )}
        </div>
      )}

      {/* ── INVOICES ── */}
      {!loading && tab === 'invoices' && (
        <div style={{ padding: '8px 22px' }}>
          {invoices.length === 0 ? (
            <div style={{ padding: '60px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🧾</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: text.secondary, marginBottom: 6 }}>{t('invoices_empty')}</div>
              <div style={{ fontSize: 13, color: text.muted }}>{t('invoices_after_orders')}</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {invoices.map(inv => {
                const tone = toneOf(inv.status);
                return (
                <div key={inv.invoice_number} style={{
                  background: 'linear-gradient(160deg, rgba(18,40,30,0.78) 0%, rgba(10,24,18,0.9) 100%)',
                  border: `1px solid rgba(180,172,155,0.22)`,
                  borderRadius: 16,
                  padding: '14px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  boxShadow: 'inset 0 1px 0 rgba(230,225,210,0.08), 0 10px 22px rgba(0,0,0,0.2)',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: text.secondary, fontFamily: 'monospace' }}>{inv.invoice_number}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', padding: '3px 8px', borderRadius: 100, background: tone.bg, border: `1px solid ${tone.border}`, color: tone.fg }}>{inv.status}</span>
                    </div>
                    <div style={{ fontSize: 12, color: text.muted }}>
                      {formatUkDate(inv.created_at)}
                      {inv.due_at ? ` · ${t('due_prefix')} ${formatUkDate(inv.due_at)}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ ...T.bodyLg, fontWeight: 700, color: gold, ...T.num }}>₴{fmtInt(inv.amount)}{fmtDec(inv.amount)}</div>
                    {inv.status === 'issued' && inv.order_id && (
                      <button onClick={() => downloadOrderReceipt(inv.order_id!)} disabled={dlPdf === `order-${inv.order_id}`} style={{
                        marginTop: 7,
                        padding: '5px 11px',
                        borderRadius: 10,
                        border: `1px solid rgba(184,176,154,0.38)`,
                        background: 'linear-gradient(135deg, rgba(184,176,154,0.25), rgba(122,114,101,0.2))',
                        color: text.primary,
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        letterSpacing: 0.2,
                      }}>{dlPdf === `order-${inv.order_id}` ? '…' : `🧾 ${t('receipt_short')}`}</button>
                    )}
                  </div>
                </div>
              );})}
            </div>
          )}
        </div>
      )}
    </div>
    </ContentWrap>
    </>
  );
}

function getTabs(t: (key: TranslationKey) => string): { k: TabKey; label: string; icon: (c: string) => React.ReactNode }[] {
  return [
    { k: 'overview', label: t('tabs_overview'), icon: c => <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7.5" height="7.5" rx="2" stroke={c} strokeWidth="1.8" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" stroke={c} strokeWidth="1.8" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" stroke={c} strokeWidth="1.8" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" stroke={c} strokeWidth="1.8" /></svg> },
    { k: 'operations', label: t('tabs_operations'), icon: c => <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M3 12h3l3-8 4 16 3-8h5" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> },
    { k: 'cards', label: t('tabs_cards'), icon: c => <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="2.5" y="5" width="19" height="14" rx="2.5" stroke={c} strokeWidth="1.8" /><path d="M2.5 10h19" stroke={c} strokeWidth="1.8" /></svg> },
    { k: 'market', label: t('tabs_market'), icon: c => <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13l-1.5 6h12" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><circle cx="9" cy="21" r="1" fill={c} /><circle cx="19" cy="21" r="1" fill={c} /></svg> },
    { k: 'profile', label: t('tabs_profile'), icon: c => <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke={c} strokeWidth="1.8" /><path d="M4 21a8 8 0 0116 0" stroke={c} strokeWidth="1.8" strokeLinecap="round" /></svg> },
  ];
}

function TabBar({ active, onChange }: { active: TabKey; onChange: (k: TabKey) => void }) {
  const { t } = usePreferences();
  const tabs = getTabs(t);
  const activeIdx = tabs.findIndex(tab => tab.k === active);
  return (
    <div style={{
      position: 'fixed',
      left: 0, right: 0, bottom: 0,
      zIndex: 120,
      backgroundColor: appBgBase,
      backgroundImage: 'linear-gradient(180deg, rgba(7,21,15,0) 0%, rgba(7,21,15,0.82) 48%, rgb(7,21,15) 100%)',
      padding: '10px 14px',
      paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)',
      backdropFilter: 'blur(24px) saturate(180%)',
      WebkitBackdropFilter: 'blur(24px) saturate(180%)',
      pointerEvents: 'none',
    }}>
      <div style={{
        position: 'relative',
        padding: '5px',
        background: 'rgba(12,26,20,0.6)',
        border: '1px solid rgba(180,172,155,0.2)',
        borderRadius: 28,
        display: 'flex',
        boxShadow: '0 8px 22px rgba(0,0,0,0.3), inset 0 1px 0 rgba(230,225,210,0.08)',
        pointerEvents: 'auto',
      }}>
        <div style={{
          position: 'absolute', top: 5, bottom: 5,
          left: `calc(${activeIdx * 20}% + 5px)`, width: 'calc(20% - 10px)',
          background: 'linear-gradient(135deg, rgba(180,172,155,0.22) 0%, rgba(100,95,80,0.12) 100%)',
          border: '1px solid rgba(180,172,155,0.32)', borderRadius: 22,
          transition: 'left 0.32s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: 'inset 0 1px 0 rgba(230,225,210,0.12)',
          pointerEvents: 'none',
        }} />
        {tabs.map(tab => {
          const isActive = tab.k === active;
          const color = isActive ? goldLight : 'rgba(220,215,200,0.48)';
          return (
            <button key={tab.k} onClick={() => onChange(tab.k)} style={{
              flex: 1, padding: '9px 4px 7px', background: 'transparent', border: 'none', cursor: 'pointer',
              position: 'relative', zIndex: 1,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              color, fontSize: 10, fontWeight: isActive ? 700 : 500,
              letterSpacing: 0.3, fontFamily: 'inherit', transition: 'color 0.2s',
            }}>
              {tab.icon(color)}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Desktop sidebar ──────────────────────────────────────────
function DesktopSidebar({ active, onChange }: { active: TabKey; onChange: (k: TabKey) => void }) {
  const { logout, user, account } = useApp();
  const { profilePhoto, t } = usePreferences();
  const tabs = getTabs(t);
  const name = user?.full_name ?? t('user_fallback');
  const userInitials = initials(name);
  return (
    <div style={{
      width: 252, flexShrink: 0,
      display: 'flex', flexDirection: 'column',
      borderRight: `1px solid ${bg.border}`,
      background: 'rgba(6,18,12,0.72)',
      backdropFilter: 'blur(28px)',
      WebkitBackdropFilter: 'blur(28px)',
    }}>
      {/* Logo */}
      <div style={{ padding: '30px 22px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <BrandMark size={36} radiusValue={10} />
          <div>
            <div style={{ ...T.h3, color: text.primary, lineHeight: 1.1 }}>
              ARM<span style={{ fontWeight: 300, opacity: 0.8 }}>Bank</span>
            </div>
            <div style={{ fontSize: 10, color: text.dim, letterSpacing: 0.6, marginTop: 1 }}>{t('personal_cabinet')}</div>
          </div>
        </div>
      </div>

      {/* User */}
      <div style={{ padding: '14px 22px 16px', borderTop: `1px solid ${bg.border}`, borderBottom: `1px solid ${bg.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
            background: `linear-gradient(145deg, ${gold} 0%, ${goldDark} 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 700, color: '#1a2820',
            boxShadow: `0 0 0 2px rgba(0,0,0,0.5), 0 0 0 3.5px ${gold}50`,
            overflow: 'hidden',
          }}>
            {profilePhoto ? <img src={profilePhoto} alt={t('profile_photo_alt')} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : userInitials}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...T.body, fontWeight: 600, color: text.primary, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#6ec98a', boxShadow: '0 0 6px #6ec98a88' }} />
              <span style={{ fontSize: 10.5, color: '#6ec98a', fontWeight: 500, letterSpacing: 0.2 }}>{t('profile_verified')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
        {tabs.map(t => {
          const isActive = t.k === active;
          return (
            <button key={t.k} onClick={() => onChange(t.k)} style={{
              display: 'flex', alignItems: 'center', gap: 11,
              padding: '10px 13px', borderRadius: 12,
              background: isActive ? 'linear-gradient(135deg, rgba(180,172,155,0.16) 0%, rgba(100,95,80,0.08) 100%)' : 'transparent',
              border: isActive ? `1px solid rgba(180,172,155,0.24)` : '1px solid transparent',
              color: isActive ? text.primary : text.muted,
              fontFamily, fontSize: 13.5, fontWeight: isActive ? 600 : 450,
              cursor: 'pointer', transition: 'color 0.15s, background 0.15s, border-color 0.15s',
              textAlign: 'left', letterSpacing: -0.1,
            }}>
              {t.icon(isActive ? gold : text.muted)}
              {t.label}
            </button>
          );
        })}
      </nav>

      {/* Balance summary */}
      <div style={{ margin: '0 10px 10px', padding: '14px 16px', borderRadius: 14, background: bg.card, border: `1px solid ${bg.border}` }}>
        <div style={{ ...sectionLabel, padding: 0, marginBottom: 7 }}>{t('balance_total')}</div>
        <div style={{ ...T.num, fontSize: 21, fontWeight: 600, color: text.primary, letterSpacing: -0.7 }}>
          <span style={{ fontSize: 13, color: gold, fontWeight: 500 }}>₴ </span>
          {account ? fmtInt(account.balance) + fmtDec(account.balance) : '———'}
        </div>
        {account?.account_number && (
          <div style={{ marginTop: 5, fontSize: 10.5, color: text.dim, fontWeight: 500, letterSpacing: 0.3 }}>
            {account.account_number}
          </div>
        )}
      </div>

      {/* Logout */}
      <div style={{ padding: '0 10px 20px' }}>
        <button onClick={logout} style={{
          width: '100%', padding: '10px', borderRadius: 11,
          background: 'transparent', border: '1px solid rgba(220,100,110,0.16)',
          color: 'rgba(220,110,118,0.65)', fontFamily, fontSize: 12.5, fontWeight: 500,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          transition: 'border-color 0.15s, color 0.15s', letterSpacing: 0.1,
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M17 16l4-4-4-4M21 12H9M13 4a9 9 0 100 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {t('profile_logout')}
        </button>
      </div>
    </div>
  );
}

// ─── Root app ─────────────────────────────────────────────────
const SCREENS = { overview: OverviewScreen, operations: OperationsScreen, cards: CardsScreen, market: MarketplaceScreen, profile: ProfileScreen };
const ENABLE_MOBILE_TAB_SWIPE = false;

// Solid base — must equal html/body background AND gradient bottom stop.
// Appended to the shorthand → becomes CSS background-color, painting UNDER
// all gradient layers so any edge-pixel gap is invisible on OLED.
const appBgBase = '#07150f';
const appBg = `radial-gradient(ellipse 92% 66% at 18% -4%, rgba(48,88,64,0.78) 0%, rgba(18,48,35,0.38) 42%, transparent 72%), radial-gradient(ellipse 74% 48% at 102% 104%, rgba(118,74,28,0.34) 0%, rgba(82,49,23,0.16) 44%, transparent 72%), linear-gradient(180deg, #0b241a 0%, #081b13 50%, ${appBgBase} 100%) ${appBgBase}`;

const appBase: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: appBg,
  color: text.secondary,
  fontFamily,
  width: '100vw',
  maxWidth: '100vw',
  overflowX: 'hidden',
  WebkitFontSmoothing: 'antialiased',
  MozOsxFontSmoothing: 'grayscale',
  textRendering: 'optimizeLegibility',
};

const AUTH_STATIC_BG = florenceDuomoImage;
const SPLASH_BASE_BG = tuscanyHillsCardImage;
const SPLASH_STATIC_BG = valdorciaHillsImage;

function LuxuryAmbientFx() {
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      <div style={{
        position: 'absolute',
        width: 560,
        height: 560,
        top: -230,
        right: -190,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(168,226,190,0.13) 0%, rgba(95,170,126,0.07) 38%, rgba(150,220,185,0) 72%)',
        filter: 'blur(20px)',
      }} />
      <div style={{
        position: 'absolute',
        width: 520,
        height: 520,
        bottom: -260,
        left: -170,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(214,174,121,0.14) 0%, rgba(152,98,42,0.06) 42%, rgba(214,174,121,0) 74%)',
        filter: 'blur(22px)',
      }} />
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(180deg, rgba(255,255,255,0.018) 0%, rgba(255,255,255,0) 32%, rgba(0,0,0,0.13) 100%)',
        opacity: 0.72,
        mixBlendMode: 'soft-light',
      }} />
    </div>
  );
}

function PremiumStatusStrip() {
  const chips = [
    { label: 'Live API', tone: 'rgba(130,210,160,0.16)', color: '#92d5aa' },
    { label: 'End-to-End Secure', tone: 'rgba(190,180,160,0.16)', color: '#d2cab8' },
    { label: 'Private Session', tone: 'rgba(170,150,210,0.14)', color: '#b7aad8' },
  ];
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 6 }}>
      {chips.map(chip => (
        <div key={chip.label} style={{
          padding: '5px 9px',
          borderRadius: 999,
          border: '1px solid rgba(220,215,200,0.18)',
          background: chip.tone,
          color: chip.color,
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: 0.45,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}>
          {chip.label}
        </div>
      ))}
    </div>
  );
}

function WowSplash() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, overflow: 'hidden', background: '#07150f' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 86% 56% at 50% 14%, rgba(34,74,52,0.64) 0%, rgba(10,26,18,0.92) 65%, rgba(6,16,11,1) 100%)' }} />
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `url(${SPLASH_BASE_BG})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center bottom',
        opacity: 0.46,
        filter: 'saturate(1.02) contrast(1.01)',
      }} />
      <div style={{
        position: 'absolute',
        inset: '-4%',
        backgroundImage: `url(${SPLASH_STATIC_BG})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center bottom',
        opacity: 0.52,
        filter: 'blur(22px) saturate(1.04)',
      }} />
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `url(${SPLASH_STATIC_BG})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center bottom',
        opacity: 0.82,
        filter: 'saturate(1.06) contrast(1.02)',
      }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(6,15,10,0.3) 0%, rgba(6,15,10,0.7) 100%)' }} />
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(115deg, transparent 0%, rgba(255,245,220,0.12) 48%, transparent 78%)',
        opacity: 0.28,
      }} />
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -0.8, color: text.primary }}>
            ARM<span style={{ fontWeight: 300, color: 'rgba(220,215,200,0.82)' }}>Bank</span>
          </div>
          <div style={{ ...T.caption, color: 'rgba(220,215,200,0.72)', marginTop: 8, letterSpacing: 2.2 }}>
            Toscana Private Flow
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Login screen ─────────────────────────────────────────────
function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const { t } = usePreferences();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [faceIdLoading, setFaceIdLoading] = useState(false);
  const [hasPlatformAuth, setHasPlatformAuth] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.PublicKeyCredential) {
      window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
        .then(ok => setHasPlatformAuth(ok))
        .catch(() => setHasPlatformAuth(false));
    }
  }, []);

  async function handleFaceIdLogin() {
    setFaceIdLoading(true);
    setError('');
    try {
      // 1. Get challenge
      const optRes = await fetch('/api/auth/passkey/login-options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const optJson = await optRes.json();
      if (!optRes.ok || !optJson.ok) throw new Error(optJson.error || t('registration_error'));
      // 2. Trigger Face ID
      const assertion = await startAuthentication({ optionsJSON: optJson.data });
      // 3. Verify
      const verRes = await fetch('/api/auth/passkey/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(assertion),
      });
      const verJson = await verRes.json();
      if (!verRes.ok || !verJson.ok) throw new Error(verJson.error || t('verification_error'));
      localStorage.setItem('army_bank_token', verJson.data.token);
      onLogin();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('face_id_error');
      if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('abort') || msg.toLowerCase().includes('not allowed')) {
        setError('');
      } else {
        setError(msg);
      }
    } finally {
      setFaceIdLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (mode === 'register' && password !== confirmPass) { setError(t('passwords_do_not_match')); return; }
    setLoading(true);
    try {
      const isReg = mode === 'register';
      const res = await fetch(isReg ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isReg
          ? { full_name: fullName.trim(), phone: phone.trim(), email: email.trim(), password }
          : { identity: identity.trim(), password }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || json.message || (isReg ? t('registration_error') : t('invalid_credentials')));
      localStorage.setItem('army_bank_token', json.data.token);
      onLogin();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('operation_error'));
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '13px 16px', background: 'rgba(6,14,10,0.52)',
    border: `1px solid rgba(220,215,200,0.26)`, borderRadius: radius.md,
    color: text.primary, fontSize: 15, outline: 'none', fontFamily, boxSizing: 'border-box',
    transition: 'border-color 0.15s, background 0.15s',
    WebkitAppearance: 'none',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', ...T.caption, color: 'rgba(230,225,210,0.78)', marginBottom: 7,
  };
  const fieldStyle = { marginBottom: 14 };

  return (
    <div style={{ ...appBase, overflowY: 'auto' }}>
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', background: '#07150f' }} />
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none',
        backgroundImage: `url(${AUTH_STATIC_BG})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center top',
        opacity: 0.82,
      }} />
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 72% 50% at 50% 0%, rgba(20,46,32,0.48) 0%, rgba(6,14,10,0.74) 58%, rgba(5,11,8,0.9) 100%)',
      }} />
      <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 20px', position: 'relative' }}>
      <div style={{ width: '100%', maxWidth: 380 }}>

        {/* Logo block */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
            <BrandMark size={72} radiusValue={22} elevated />
          </div>
          {/* Wordmark */}
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5, color: text.primary, fontFamily, lineHeight: 1 }}>
            ARM<span style={{ fontWeight: 300, color: text.muted }}>Bank</span>
          </div>
          <div style={{ ...T.caption, color: text.dim, marginTop: 8, letterSpacing: 2, textTransform: 'uppercase' }}>
            {t('personal_cabinet')}
          </div>
        </div>

        <div style={{
          borderRadius: 22,
          border: '1px solid rgba(220,215,200,0.22)',
          background: 'linear-gradient(180deg, rgba(8,18,13,0.74) 0%, rgba(6,12,9,0.78) 100%)',
          boxShadow: '0 20px 50px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.08)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          padding: '14px 14px 16px',
        }}>
        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 18, borderBottom: `1px solid rgba(220,215,200,0.2)` }}>
          {(['login', 'register'] as const).map(m => (
            <button key={m} type="button" onClick={() => { setMode(m); setError(''); setConfirmPass(''); }} style={{
              flex: 1, padding: '10px', background: 'transparent', border: 'none',
              borderBottom: mode === m ? `2px solid ${gold}` : '2px solid transparent',
              marginBottom: -1,
              color: mode === m ? text.primary : 'rgba(220,215,200,0.72)',
              fontSize: 13, fontWeight: mode === m ? 600 : 400, fontFamily,
              cursor: 'pointer', transition: 'all 0.18s', letterSpacing: 0.3,
            }}>{m === 'login' ? t('login_tab') : t('register_tab')}</button>
          ))}
        </div>

        {/* Face ID button — only on login tab, only if platform auth available */}
        {mode === 'login' && hasPlatformAuth && (
          <button
            type="button"
            onClick={handleFaceIdLogin}
            disabled={faceIdLoading}
            style={{
              width: '100%', padding: '14px', marginBottom: 16, borderRadius: radius.md,
              border: '1px solid rgba(220,215,200,0.28)',
              background: 'linear-gradient(160deg, rgba(20,36,28,0.95) 0%, rgba(9,18,13,0.96) 100%)',
              color: faceIdLoading ? text.dim : text.primary,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              cursor: faceIdLoading ? 'default' : 'pointer',
              fontFamily, fontSize: 15, fontWeight: 500, letterSpacing: 0.2,
              boxShadow: '0 1px 0 rgba(255,255,255,0.05) inset',
              transition: 'all 0.18s',
            }}
          >
            {faceIdLoading ? (
              <span style={{ opacity: 0.6 }}>{t('wait_processing')}</span>
            ) : (
              <>
                {/* Face ID icon */}
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={gold} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 9V5a2 2 0 012-2h3M2 15v4a2 2 0 002 2h3M22 9V5a2 2 0 00-2-2h-3M22 15v4a2 2 0 01-2 2h-3"/>
                  <circle cx="9" cy="10" r="0.5" fill={gold} stroke="none"/>
                  <circle cx="15" cy="10" r="0.5" fill={gold} stroke="none"/>
                  <path d="M9 15c0 0 1 1.5 3 1.5s3-1.5 3-1.5"/>
                  <path d="M12 7v2"/>
                </svg>
                <span>{t('login_with_face_id')}</span>
              </>
            )}
          </button>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {mode === 'register' && <>
              <div style={fieldStyle}>
                <label style={labelStyle}>{t('full_name_label')}</label>
                <input style={inputStyle} type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder={t('full_name_placeholder')} required />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>{t('profile_phone')}</label>
                <input style={inputStyle} type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+380XXXXXXXXX" required />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>{t('email_label')}</label>
                <input style={inputStyle} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" required />
              </div>
            </>}

            {mode === 'login' && (
              <div style={fieldStyle}>
                <label style={labelStyle}>{t('phone_or_email')}</label>
                <input style={inputStyle} type="text" value={identity} onChange={e => setIdentity(e.target.value)} placeholder={t('phone_or_email_placeholder')} autoComplete="username" required />
              </div>
            )}

            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>{t('password_label')}</label>
                {mode === 'login' && (
                  <button type="button" onClick={() => setError(t('forgot_password_contact_support'))} style={{ fontSize: 11, color: 'rgba(220,215,200,0.78)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: 0.2 }}>
                    {t('forgot_password')}
                  </button>
                )}
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  style={{ ...inputStyle, paddingRight: 44 }}
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                />
                <button type="button" onClick={() => setShowPass(v => !v)} style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: text.muted, padding: 4,
                  display: 'flex', alignItems: 'center',
                }}>
                  {showPass
                    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.4 5.1A10.9 10.9 0 0112 5c6 0 10 7 10 7a18 18 0 01-3.2 3.9M6.6 6.6A18 18 0 002 12s4 7 10 7a11 11 0 003.4-.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                    : <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" stroke="currentColor" strokeWidth="1.6" /><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" /></svg>
                  }
                </button>
              </div>
            </div>

            {mode === 'register' && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>{t('confirm_password')}</label>
                </div>
                <div style={{ position: 'relative' }}>
                  <input
                    style={{ ...inputStyle, paddingRight: 44 }}
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPass}
                    onChange={e => setConfirmPass(e.target.value)}
                    placeholder={t('repeat_password')}
                    autoComplete="new-password"
                    required
                  />
                  <button type="button" onClick={() => setShowConfirm(v => !v)} style={{
                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', color: text.muted, padding: 4,
                    display: 'flex', alignItems: 'center',
                  }}>
                    {showConfirm
                      ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.4 5.1A10.9 10.9 0 0112 5c6 0 10 7 10 7a18 18 0 01-3.2 3.9M6.6 6.6A18 18 0 002 12s4 7 10 7a11 11 0 003.4-.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                      : <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" stroke="currentColor" strokeWidth="1.6" /><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" /></svg>
                    }
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div style={{ marginBottom: 14, padding: '10px 14px', background: 'rgba(200,60,60,0.1)', border: '1px solid rgba(200,60,60,0.22)', borderRadius: radius.sm, color: '#f09090', ...T.sm }}>{error}</div>
            )}

            <button type="submit" disabled={loading} style={{
              width: '100%', padding: '15px', borderRadius: radius.md, border: `1px solid rgba(180,172,155,0.22)`,
              background: loading
                ? 'rgba(90,85,75,0.25)'
                : 'linear-gradient(160deg, rgba(58,72,60,0.94) 0%, rgba(34,48,38,0.96) 100%)',
              color: loading ? text.dim : text.primary,
              ...T.bodyLg, fontWeight: 600, cursor: loading ? 'default' : 'pointer',
              fontFamily, letterSpacing: 0.4,
              boxShadow: loading ? 'none' : '0 1px 0 rgba(255,255,255,0.06) inset, 0 8px 20px rgba(0,0,0,0.35)',
              transition: 'all 0.18s',
            }}>{loading ? t('wait_processing') : mode === 'login' ? t('sign_in') : t('create_account')}</button>
          </div>
        </form>
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: 24, ...T.caption, color: 'rgba(220,215,200,0.72)', letterSpacing: 0.6 }}>
          ARMBank · {t('personal_cabinet')}
        </div>
      </div>
      </div>
    </div>
  );
}

// ─── App root ─────────────────────────────────────────────────
export default function App() {
  const [authed, setAuthed] = useState(() => !!getToken());
  const [showSplash, setShowSplash] = useState(() => shouldShowInitialSplash());
  const [tab, setTabState] = useState<TabKey>(() => readStoredTab());
  const [profilePhoto, setProfilePhotoState] = useState<string>(() => getProfilePhoto());
  const [lang, setLangState] = useState<AppLang>(() => getStoredLanguage());
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const touchAxisRef = useRef<'x' | 'y' | null>(null);
  const tabSwipeEnabledRef = useRef(false);
  const [screenDragX, setScreenDragX] = useState(0);
  const [screenDragging, setScreenDragging] = useState(false);
  const [tabBarHidden, setTabBarHidden] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [user, setUser] = useState<UserInfo | null>(null);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [transactions, setTransactions] = useState<TxItem[]>([]);
  const [cards, setCards] = useState<CardInfo[]>([]);
  const [loadingData, setLoadingData] = useState(() => !!getToken());
  const [refreshingData, setRefreshingData] = useState(false);
  const [dataError, setDataError] = useState('');
  const [analytics, setAnalytics] = useState<ApiAnalytics | null>(null);
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const width = useWindowWidth();
  const isDesktop = width >= 768;
  const Screen = SCREENS[tab];
  const t = React.useCallback((key: TranslationKey) => translations[lang][key], [lang]);
  const tabs = React.useMemo(() => getTabs(t), [t]);
  const tabIndex = tabs.findIndex(t => t.k === tab);

  const setTab = React.useCallback((next: TabKey) => {
    setTabState(next);
    markAppContinuation();
    try {
      localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, next);
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = React.useCallback((nextLang: AppLang) => {
    setStoredLanguage(nextLang);
    setLangState(nextLang);
  }, []);

  const setProfilePhotoValue = React.useCallback((value: string) => {
    setProfilePhotoState(value);
  }, []);

  function shouldIgnoreTabSwipe(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return true;
    if (target.closest('[data-no-tab-swipe="true"]')) return true;
    if (target.closest('input, textarea, select, button, a, [role="button"], [contenteditable="true"]')) return true;
    return false;
  }

  function resetTabSwipe() {
    touchStartXRef.current = null;
    touchStartYRef.current = null;
    touchAxisRef.current = null;
    tabSwipeEnabledRef.current = false;
    setScreenDragX(0);
    setScreenDragging(false);
  }

  function handleMobileTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    if (!ENABLE_MOBILE_TAB_SWIPE) return;
    if (tabBarHidden || transferModal) return;
    if (shouldIgnoreTabSwipe(e.target)) return;
    const t = e.touches[0];
    touchStartXRef.current = t.clientX;
    touchStartYRef.current = t.clientY;
    touchAxisRef.current = null;
    tabSwipeEnabledRef.current = true;
    setScreenDragX(0);
    setScreenDragging(false);
  }

  function handleMobileTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (!tabSwipeEnabledRef.current) return;
    if (touchStartXRef.current == null || touchStartYRef.current == null) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStartXRef.current;
    const dy = t.clientY - touchStartYRef.current;
    if (!touchAxisRef.current && (Math.abs(dx) > 9 || Math.abs(dy) > 9)) {
      touchAxisRef.current = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    }
    if (touchAxisRef.current !== 'x') return;
    e.preventDefault();
    setScreenDragging(true);
    setScreenDragX(Math.max(-120, Math.min(120, dx)));
  }

  function handleMobileTouchEnd() {
    if (!tabSwipeEnabledRef.current) return;
    const threshold = 72;
    if (Math.abs(screenDragX) >= threshold) {
      if (screenDragX < 0 && tabIndex < tabs.length - 1) {
        setTab(tabs[tabIndex + 1].k);
      } else if (screenDragX > 0 && tabIndex > 0) {
        setTab(tabs[tabIndex - 1].k);
      }
    }
    resetTabSwipe();
  }

  useEffect(() => {
    const id = setTimeout(() => setShowSplash(false), 3600);
    if (showSplash) markAppContinuation();
    return () => clearTimeout(id);
  }, [showSplash]);

  const fetchDashboard = React.useCallback(async () => {
    const token = localStorage.getItem('army_bank_token');
    if (!token) return;
    try {
      const [dashRes, cardsRes] = await Promise.all([
        fetch('/api/dashboard', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/cards', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const dashJson = await dashRes.json();
      if (dashJson.ok) {
        setUser(dashJson.data.user);
        setAccount(dashJson.data.account);
        setTransactions(dashJson.data.transactions || []);
      }
      const cardsJson = await cardsRes.json();
      if (cardsJson.ok) setCards(cardsJson.data || []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (!authed) { setUser(null); setAccount(null); setTransactions([]); setCards([]); return; }
    fetchDashboard();
  }, [authed, fetchDashboard]);

  const showToast = (msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastMsg(msg);
    toastTimer.current = setTimeout(() => setToastMsg(''), 2500);
  };

  const logout = () => {
    clearToken();
    setAuthed(false);
    setTab('overview');
    setUser(null);
    setAccount(null);
    setCards([]);
    setTransactions([]);
    setAnalytics(null);
    setDataError('');
    setLoadingData(false);
  };

  const loadBankData = async (silent = false) => {
    if (!authed) return;
    if (silent) setRefreshingData(true);
    else setLoadingData(true);
    setDataError('');
    try {
      let userData: ApiUser | null = null;
      let accountData: ApiAccount | null = null;
      let txData: ApiTransaction[] = [];

      try {
        const dashboard = await apiRequest<{
          user?: ApiUser;
          account?: ApiAccount;
          transactions?: ApiTransaction[];
        }>('/api/dashboard');
        userData = dashboard?.user || null;
        accountData = dashboard?.account || null;
        txData = Array.isArray(dashboard?.transactions) ? dashboard.transactions : [];
      } catch {
        const [me, acc, history] = await Promise.all([
          apiRequest<ApiUser>('/api/auth/me'),
          apiRequest<ApiAccount>('/api/accounts/main'),
          apiRequest<ApiTransaction[]>('/api/transactions/history'),
        ]);
        userData = me || null;
        accountData = acc || null;
        txData = Array.isArray(history) ? history : [];
      }

      const cardsData = await apiRequest<ApiCard[]>('/api/cards');
      let analyticsData: ApiAnalytics | null = null;
      try {
        analyticsData = await apiRequest<ApiAnalytics>('/api/analytics/summary');
      } catch {
        analyticsData = null;
      }

      setUser(userData);
      setAccount(accountData);
      setTransactions(txData);
      setCards(Array.isArray(cardsData) ? cardsData : []);
      setAnalytics(analyticsData);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('data_load_failed');
      setDataError(message);
      if ((err as { status?: number }).status === 401) {
        logout();
        return;
      }
      if (!silent) showToast(message);
    } finally {
      if (silent) setRefreshingData(false);
      else setLoadingData(false);
    }
  };

  useEffect(() => {
    if (!authed) return;
    loadBankData(false).catch(() => {});
    // Auto-refresh every 30s (admin sync — picks up admin balance/card changes)
    const interval = setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        loadBankData(true).catch(() => {});
      }
    }, 30_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  const mutateCard = async (cardId: number, action: 'block' | 'close') => {
    const endpoint = action === 'block' ? 'block' : 'close';
    await apiRequest(`/api/cards/${cardId}/${endpoint}`, { method: 'PATCH' });
    await loadBankData(true);
  };

  const issueCard = async () => {
    await apiRequest('/api/cards', {
      method: 'POST',
      body: JSON.stringify({ card_type: 'virtual', design: 'gold' }),
    });
    await loadBankData(true);
  };

  const [transferModal, setTransferModal] = useState<TransferMode | null>(null);

  const appCtx: AppCtxType = {
    logout,
    goTo: (t: TabKey) => setTab(t),
    toast: showToast,
    user,
    account,
    transactions,
    cards,
    refreshDashboard: fetchDashboard,
    openTransfer: (mode: TransferMode) => setTransferModal(mode),
    setTabBarHidden,
  };

  const bankCtx: BankDataCtxType = {
    loading: loadingData,
    refreshing: refreshingData,
    error: dataError,
    user,
    account,
    cards,
    transactions,
    analytics,
    refresh: async () => loadBankData(true),
    mutateCard,
    issueCard,
  };

  const preferencesCtx: PreferencesCtxType = {
    profilePhoto,
    setProfilePhotoValue,
    lang,
    setLang,
    t,
  };

  if (showSplash) {
    return <WowSplash />;
  }

  if (!authed) {
    return <LoginScreen onLogin={() => setAuthed(true)} />;
  }

  if (isDesktop) {
    return (
      <PreferencesCtx.Provider value={preferencesCtx}>
      <AppCtx.Provider value={appCtx}>
        <BankDataCtx.Provider value={bankCtx}>
          <LayoutCtx.Provider value="desktop">
            <div style={{ ...appBase, display: 'flex' }}>
              <LuxuryAmbientFx />
              <DesktopSidebar active={tab} onChange={setTab} />
              <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
                {dataError && (
                  <div style={{ margin: '12px 16px 0', padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(220,100,110,0.25)', background: 'rgba(220,100,110,0.08)', color: '#ffb6bd', fontSize: 13 }}>
                    {dataError}
                  </div>
                )}
                {loadingData ? (
                  <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', color: text.muted }}>{t('loading_data')}</div>
                ) : (
                  <Screen />
                )}
              </div>
            </div>
            {toastMsg && <Toast msg={toastMsg} />}
            {transferModal && <TransferModal mode={transferModal} onClose={() => setTransferModal(null)} />}
          </LayoutCtx.Provider>
        </BankDataCtx.Provider>
      </AppCtx.Provider>
      </PreferencesCtx.Provider>
    );
  }

  return (
    <PreferencesCtx.Provider value={preferencesCtx}>
    <AppCtx.Provider value={appCtx}>
      <BankDataCtx.Provider value={bankCtx}>
        <LayoutCtx.Provider value="mobile">
          <div style={{ ...appBase, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'fixed' }}>
            <LuxuryAmbientFx />
            <div style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              overflowX: 'hidden',
              width: '100%',
              maxWidth: '100vw',
              touchAction: 'pan-y',
              paddingBottom: 'calc(78px + env(safe-area-inset-bottom, 0px))',
              scrollPaddingBottom: 'calc(78px + env(safe-area-inset-bottom, 0px))',
              overscrollBehavior: 'contain',
              WebkitOverflowScrolling: 'touch',
            }}
            onTouchStart={handleMobileTouchStart}
            onTouchMove={handleMobileTouchMove}
            onTouchEnd={handleMobileTouchEnd}
            onTouchCancel={handleMobileTouchEnd}
            >
              <div
                style={{
                  width: '100%',
                  maxWidth: '100vw',
                  overflowX: 'hidden',
                  transform: ENABLE_MOBILE_TAB_SWIPE ? `translate3d(${screenDragX}px,0,0)` : 'none',
                  transition: screenDragging ? 'none' : 'transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1)',
                  willChange: 'transform',
                }}
              >
              {dataError && (
                <div style={{ margin: '10px 12px 0', padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(220,100,110,0.25)', background: 'rgba(220,100,110,0.08)', color: '#ffb6bd', fontSize: 13 }}>
                  {dataError}
                </div>
              )}
              {loadingData ? (
                <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', color: text.muted }}>{t('loading_data')}</div>
              ) : (
                <Screen />
              )}
              </div>
            </div>
            {!tabBarHidden && <TabBar active={tab} onChange={setTab} />}
            {toastMsg && <Toast msg={toastMsg} />}
            {transferModal && <TransferModal mode={transferModal} onClose={() => setTransferModal(null)} />}
          </div>
        </LayoutCtx.Provider>
      </BankDataCtx.Provider>
    </AppCtx.Provider>
    </PreferencesCtx.Provider>
  );
}

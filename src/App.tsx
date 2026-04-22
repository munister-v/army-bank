import React, { useState, Fragment, useEffect, createContext, useContext, Component, useRef } from 'react';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import florenceCardImage from './assets/cards/florence.png';
import tuscanyHillsCardImage from './assets/cards/tuscany-hills.png';
import veniceCardImage from './assets/cards/venice.png';
import tuscanyVillaCardImage from './assets/cards/tuscany-villa.png';

export class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: string | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(err: Error): { error: string | null } { return { error: err.message }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ position: 'fixed', inset: 0, background: '#07150f', color: '#ddd8cc', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, fontFamily: 'sans-serif' }}>
          <div style={{ fontSize: 20 }}>⚠️ Щось пішло не так</div>
          <div style={{ fontSize: 13, color: 'rgba(220,215,200,0.6)', maxWidth: 400, textAlign: 'center' }}>{this.state.error}</div>
          <button onClick={() => window.location.reload()} style={{ marginTop: 8, padding: '10px 20px', borderRadius: 10, background: gold, color: text.primary, border: 'none', cursor: 'pointer', fontWeight: 600 }}>Оновити сторінку</button>
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
  border: 'rgba(180,172,155,0.13)',
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
}
const AppCtx = createContext<AppCtxType>({ logout: () => {}, goTo: () => {}, toast: () => {}, user: null, account: null, transactions: [], cards: [], refreshDashboard: () => {}, openTransfer: () => {} });
const useApp = () => useContext(AppCtx);

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
};

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

function formatUah(value: number): string {
  return `₴ ${uahFmt.format(Number.isFinite(value) ? value : 0)}`;
}

function analyticsChangeLabel(analytics?: ApiAnalytics | null): string {
  if (!analytics?.current_month || !analytics?.prev_month) return 'Без динаміки';
  const curIn = Number(analytics.current_month.total_in || 0);
  const curOut = Number(analytics.current_month.total_out || 0);
  const prevIn = Number(analytics.prev_month.total_in || 0);
  const prevOut = Number(analytics.prev_month.total_out || 0);
  const curNet = curIn - curOut;
  const prevNet = prevIn - prevOut;
  if (Math.abs(prevNet) < 0.01) return curNet === 0 ? 'Без змін' : 'Новий рух коштів';
  const pct = ((curNet - prevNet) / Math.abs(prevNet)) * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}% до минулого місяця`;
}

function initials(fullName?: string | null): string {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'AB';
  return (parts[0].charAt(0) + (parts[1]?.charAt(0) || '')).toUpperCase();
}

function shortName(fullName?: string | null): string {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Користувач';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[1].charAt(0)}.`;
}

function cardTail(masked?: string): string {
  const digits = String(masked || '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : '----';
}

const CARD_INDEX_STORAGE_KEY = 'army_bank_selected_card_idx';

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
    const msg = String(payload.error || payload.message || 'Помилка запиту.');
    const err = new Error(msg) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }
  return ((payload.data ?? payload) as T);
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
  return {
    design: (card.design || 'gold').toLowerCase(),
    variant: cardVariantFromDesign(card.design),
    number: cardTail(card.masked_number),
    name: (holderName || 'ARMY BANK').toUpperCase().slice(0, 26),
    expiry: card.expiry_display || '--/--',
    type: card.card_type === 'physical' ? 'Physical' : 'Virtual',
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
  subtitle: string;
};

const CARD_DESIGN_OPTIONS: CardDesignOption[] = [
  { design: 'gold', variant: 'gold', title: 'Classic Gold', subtitle: 'Базовий стиль ARM' },
  { design: 'forest', variant: 'emerald', title: 'Forest', subtitle: 'Глибокий зелений' },
  { design: 'slate', variant: 'platinum', title: 'Slate', subtitle: 'Світлий металік' },
  { design: 'dark', variant: 'obsidian', title: 'Obsidian', subtitle: 'Темний мінімал' },
  { design: 'florence', variant: 'florence', title: 'Firenze', subtitle: 'Купол і старе місто' },
  { design: 'venice', variant: 'venice', title: 'Venezia', subtitle: 'Канали та площа' },
  { design: 'tuscany_hills', variant: 'tuscany_hills', title: "Val d'Orcia", subtitle: 'Тосканські поля' },
  { design: 'tuscany_villa', variant: 'tuscany_villa', title: 'Villa Toscana', subtitle: 'Теплий пейзаж' },
];

// ─── Data helpers ─────────────────────────────────────────────
function fmtInt(n: number) {
  return Math.floor(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
}
function fmtDec(n: number) { return ',' + (Math.abs(n) % 1).toFixed(2).slice(2); }
function fmtDateLabel(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return iso.slice(0, 10) || '—';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yest = new Date(today); yest.setDate(today.getDate() - 1);
  if (d >= today) return 'Сьогодні';
  if (d >= yest) return 'Вчора';
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
}
function fmtTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(11, 16) || '—';
  return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}
function txToCat(tx: TxItem): TxCat {
  if (tx.direction === 'in') return 'income';
  const m: Record<string, TxCat> = { food: 'food', transport: 'transport', utility: 'utility', shopping: 'shopping', subscription: 'subscription', transfer: 'transfer' };
  return (m[tx.tx_type] ?? 'transfer') as TxCat;
}
function apiCardToData(c: CardInfo, holderFallback = 'ARMY BANK'): CardData & { id: number; type: string; limit: string; used: string; statusRaw: string; cardTypeRaw: string } {
  const normalizedDesign = String(c.design || 'gold').toLowerCase();
  return {
    id: c.id,
    design: normalizedDesign,
    variant: DESIGN_TO_VARIANT[normalizedDesign] ?? 'gold',
    number: String(c.masked_number || '').slice(-4) || '0000',
    name: (holderFallback !== 'ARMY BANK' ? holderFallback : (c.holder_name || holderFallback)).toUpperCase().slice(0, 26),
    expiry: c.expiry_display || '--/--',
    type: c.card_type === 'virtual' ? 'Віртуальна' : 'Фізична',
    status: c.status === 'active' ? 'Активна' : c.status === 'blocked' ? 'Заморожена' : 'Закрита',
    statusRaw: c.status,
    cardTypeRaw: c.card_type,
    limit: '—',
    used: '—',
  };
}

function PremiumCard({ variant, number, name, expiry, type, style = {} }: CardData & { style?: React.CSSProperties }) {
  const v = CARD_VARIANTS[variant] ?? CARD_VARIANTS.gold;
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
          }}>{type || 'Virtual'}</span>
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
            <div style={{ fontSize: 8, fontWeight: 500, letterSpacing: 1.2, color: v.muted, textTransform: 'uppercase', marginBottom: 3 }}>Cardholder</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: 0.4, textShadow: titleShadow }}>{name}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 8, fontWeight: 500, letterSpacing: 1.2, color: v.muted, textTransform: 'uppercase', marginBottom: 3 }}>Valid</div>
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
  return layout === 'desktop' ? '28px' : 'max(20px, env(safe-area-inset-top, 20px))';
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

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h >= 6 && h < 12) return 'Доброго ранку';
  if (h >= 12 && h < 18) return 'Добрий день';
  if (h >= 18 && h < 23) return 'Доброго вечора';
  return 'Доброї ночі';
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
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ ...T.caption, color: text.muted }}>Загальний баланс</span>
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
  const rows = transactions.slice(0, 5).map(tx => {
    const cat = txToCat(tx);
    const s = CAT_STYLES[cat];
    return { iconBg: s.bg, iconEl: s.icon, title: tx.description, subtitle: fmtTime(tx.created_at), amount: `₴\u00a0${fmtInt(tx.amount)}${fmtDec(tx.amount)}`, positive: tx.direction === 'in' };
  });
  return (
    <div>
      {title && (
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ ...T.h3, color: text.secondary }}>Остання активність</span>
          <div style={{ flex: 1 }} />
          <button onClick={() => goTo('operations')} style={{ ...T.sm, color: gold, background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: 3, fontFamily: 'inherit', fontWeight: 600, cursor: 'pointer', letterSpacing: -0.1 }}>
            Історія <Chevron size={12} color={gold} />
          </button>
        </div>
      )}
      <div style={{ background: bg.card, border: `1px solid ${bg.border}`, borderRadius: 18, overflow: 'hidden' }}>
        {rows.length === 0 ? (
          <div style={{ padding: '28px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: text.muted, marginBottom: 4 }}>Транзакцій ще немає</div>
            <div style={{ fontSize: 11, color: text.dim }}>Поповніть рахунок або зробіть переказ</div>
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
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const cfg = {
    topup:      { title: 'Поповнити рахунок', recipientLabel: '', placeholder: 'Опис (опційно)' },
    by_card:    { title: 'Переказ на картку',  recipientLabel: 'Номер картки',   placeholder: 'Коментар' },
    by_account: { title: 'Переказ за IBAN',    recipientLabel: 'Номер рахунку',   placeholder: 'Коментар' },
  }[mode];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const amtNum = parseFloat(amount.replace(',', '.'));
    if (!amtNum || amtNum <= 0) { setError('Вкажіть суму'); return; }
    if (mode !== 'topup' && !recipient.trim()) { setError('Вкажіть отримувача'); return; }
    setLoading(true);
    const token = localStorage.getItem('army_bank_token');
    const idempotencyKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const url = mode === 'topup' ? '/api/transactions/topup'
        : mode === 'by_card' ? '/api/transactions/transfer-by-card'
        : '/api/transactions/transfer';
      const body = mode === 'topup'
        ? { amount: amtNum, description: description || 'Поповнення рахунку', idempotency_key: idempotencyKey }
        : mode === 'by_card'
        ? { card_number: recipient.trim(), amount: amtNum, description: description || 'Переказ', idempotency_key: idempotencyKey }
        : { recipient_account_number: recipient.trim(), amount: amtNum, description: description || 'Переказ', idempotency_key: idempotencyKey };
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.message || 'Помилка');
      toast(mode === 'topup' ? `Рахунок поповнено на ₴\u00a0${amtNum.toFixed(2)}` : `Переказ ₴\u00a0${amtNum.toFixed(2)} виконано`);
      refreshDashboard();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Помилка');
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
      <div style={{ width: '100%', maxWidth: 480, background: 'linear-gradient(180deg,#112820 0%,#0b1e16 100%)', border: '1px solid rgba(180,172,155,0.2)', borderRadius: '24px 24px 0 0', padding: '28px 24px 40px', boxShadow: '0 -20px 60px rgba(0,0,0,0.5)' }}>
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
              <input style={inp} value={recipient} onChange={e => setRecipient(e.target.value)} placeholder={mode === 'by_card' ? '4721 •••• •••• ••••' : 'UA29 3223 1300 0002 6007 …'} />
            </div>
          )}
          <div>
            <label style={{ ...T.caption, color: text.muted, display: 'block', marginBottom: 6 }}>Сума (₴)</label>
            <input style={{ ...inp, fontSize: 26, fontWeight: 300, letterSpacing: -0.5 }} type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0,00" />
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

const QUICK_ACTIONS: { label: string; icon: React.ReactNode; action: TabKey | TransferMode }[] = [
  { label: 'Поповнити', action: 'topup', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 19V5M5 12l7-7 7 7" stroke="#1c2e22" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  { label: 'На картку', action: 'by_card', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M12 5l7 7-7 7" stroke="#1c2e22" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  { label: 'За IBAN', action: 'by_account', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 9h18M3 15h18M6 5v14M18 5v14" stroke="#1c2e22" strokeWidth="2" strokeLinecap="round" /></svg> },
  { label: 'Магазин', action: 'market', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13l-1.5 6h12" stroke="#1c2e22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="9" cy="21" r="1" fill="#1c2e22" /><circle cx="19" cy="21" r="1" fill="#1c2e22" /></svg> },
];

function OverviewScreen() {
  const layout = useLayout();
  const topPad = useTopPad();
  const { goTo, toast, user, account, transactions, cards: apiCards, openTransfer } = useApp();
  function handleQuickAction(action: TabKey | TransferMode) {
    if (action === 'topup' || action === 'by_card' || action === 'by_account') openTransfer(action);
    else goTo(action as TabKey);
  }
  const { analytics } = useBankData();
  const displayName = user?.full_name ?? 'Користувач';
  const initials = displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [cardIdx, setCardIdx] = useState(() => readSelectedCardIndex());
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
  const [dragOffsetX, setDragOffsetX] = useState(0);
  const [isCardDragging, setIsCardDragging] = useState(false);

  useEffect(() => {
    if (cardIdx !== safeCardIdx) setCardIdx(safeCardIdx);
  }, [cardIdx, safeCardIdx]);

  useEffect(() => {
    persistSelectedCardIndex(safeCardIdx);
  }, [safeCardIdx]);

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
        <span style={{ ...T.h3, color: text.secondary }}>Мої картки</span>
        <span style={{ ...T.sm, color: text.dim }}>• {cards.length}</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => goTo('cards')} style={{ fontSize: 12, color: gold, background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: 3, fontFamily: 'inherit', fontWeight: 500, cursor: 'pointer' }}>
          Усі <Chevron size={12} color={gold} />
        </button>
      </div>
      {!cards.length ? (
        <div style={{ maxWidth: 380, padding: '16px 18px', borderRadius: 16, border: `1px solid ${bg.border}`, background: bg.card }}>
          <div style={{ fontSize: 14, color: text.secondary, marginBottom: 6 }}>Картки ще не випущено</div>
          <div style={{ fontSize: 12, color: text.muted, marginBottom: 12 }}>Перейдіть у розділ «Картки», щоб випустити першу картку.</div>
          <button
            onClick={() => goTo('cards')}
            style={{ padding: '8px 12px', borderRadius: 10, border: `1px solid ${bg.border}`, background: 'rgba(255,255,255,0.03)', color: text.secondary, cursor: 'pointer' }}
          >
            Відкрити картки
          </button>
        </div>
      ) : (
        <>
          <div
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
                width: `${cards.length * 100}%`,
                transform: `translate3d(calc(${-safeCardIdx * 100}% + ${dragOffsetX}px), 0, 0)`,
                transition: isCardDragging ? 'none' : 'transform 320ms cubic-bezier(0.22, 0.61, 0.36, 1)',
                willChange: 'transform',
              }}
            >
              {cards.map((c, i) => (
                <div key={`${c.number}-${i}`} style={{ width: `${100 / cards.length}%`, flexShrink: 0 }}>
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
      <div style={{ ...T.h3, color: text.secondary, marginBottom: 12 }}>Швидкі дії</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {QUICK_ACTIONS.map(a => <Fragment key={a.label}><QuickAction icon={a.icon} label={a.label} onClick={() => handleQuickAction(a.action)} /></Fragment>)}
      </div>
    </div>
  );

  const byType = (analytics?.by_type || []).filter(r => r.direction === 'out');
  const totalOut = byType.reduce((s, r) => s + Number(r.total), 0);
  const SPEND_LABELS: Record<string, string> = { transfer: 'Перекази', food: 'Їжа', transport: 'Транспорт', utility: 'Комунальні', shopping: 'Покупки', subscription: 'Підписки' };
  const SPEND_COLORS: Record<string, string> = { transfer: '#ddd8cc', food: '#e8a864', transport: '#88a8e8', utility: gold, shopping: '#c97db4', subscription: '#78c8b4' };
  const spendRows = totalOut > 0 ? byType.map(r => ({
    label: SPEND_LABELS[r.tx_type] || r.tx_type,
    pct: Math.round(Number(r.total) / totalOut * 100),
    color: SPEND_COLORS[r.tx_type] || gold,
  })) : [];

  const greeting = timeGreeting();

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
            <button key={i} onClick={() => i === 0 ? window.open('https://munister.com.ua/messenger', '_blank') : toast('Нових сповіщень немає')} style={{ width: 40, height: 40, borderRadius: 12, background: bg.card, border: `1px solid ${bg.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', marginLeft: 10 }}>{icon}</button>
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
              <div style={{ ...T.h3, color: text.secondary, marginBottom: 14 }}>Витрати цього місяця</div>
              {!spendRows.length && (
                <div style={{ fontSize: 12, color: text.muted }}>Недостатньо даних для розподілу витрат.</div>
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
    <div style={{ paddingBottom: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: `${topPad} 18px 8px` }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: `linear-gradient(135deg, ${gold} 0%, ${goldDark} 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1a2820', fontSize: 13, fontWeight: 700, boxShadow: 'inset 0 1px 0 rgba(230,225,210,0.5), 0 2px 6px rgba(0,0,0,0.3)' }}>{initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: text.muted, letterSpacing: 0.5, marginBottom: 1 }}>{greeting}</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName.split(' ')[0]}</div>
        </div>
        {[
          <svg key="chat" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 12a8 8 0 01-11.6 7.1L3 21l1.9-6.4A8 8 0 1121 12z" stroke="#ddd8cc" strokeWidth="1.6" strokeLinejoin="round" /></svg>,
          <svg key="bell" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 004 0" stroke="#ddd8cc" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>,
        ].map((icon, i) => (
          <button key={i} onClick={() => i === 0 ? window.open('https://munister.com.ua/messenger', '_blank') : toast('Нових сповіщень немає')} style={{ width: 36, height: 36, borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: `1px solid rgba(180,172,155,0.12)`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>{icon}</button>
        ))}
      </div>

      <div style={{ padding: '24px 22px 20px' }}>
        <BalanceBlock visible={balanceVisible} onToggle={() => setBalanceVisible(v => !v)} balance={account?.balance ?? 0} accountNumber={account?.account_number ?? '—'} />
      </div>
      <div style={{ padding: '0 22px 4px' }}>{cardSection}</div>
      <div style={{ display: 'flex', gap: 8, padding: '18px 22px 6px' }}>
        {QUICK_ACTIONS.map(a => <Fragment key={a.label}><QuickAction icon={a.icon} label={a.label} onClick={() => handleQuickAction(a.action)} /></Fragment>)}
      </div>
      <div style={{ padding: '22px 22px 0' }}><ActivityFeed transactions={transactions} /></div>
    </div>
  );
}

// ─── Cards screen ─────────────────────────────────────────────
function CardsScreen() {
  const topPad = useTopPad();
  const { toast, cards: apiCards, refreshDashboard, transactions: allTx, account, user } = useApp();
  const { refresh } = useBankData();
  const userNameUp = (user?.full_name || 'ARMY BANK').toUpperCase();
  const FALLBACK_CARDS: (CardData & { id: number; type: string; limit: string; used: string; statusRaw: string; cardTypeRaw: string })[] = [
    { id: 0, design: 'gold', variant: 'gold', number: '0001', name: userNameUp, expiry: '03/29', type: 'Віртуальна', limit: '150 000', used: '48 230', status: 'Активна', statusRaw: 'active', cardTypeRaw: 'virtual' },
    { id: 0, design: 'florence', variant: 'florence', number: '1183', name: userNameUp, expiry: '02/29', type: 'Фізична', limit: '80 000', used: '12 400', status: 'Активна', statusRaw: 'active', cardTypeRaw: 'physical' },
    { id: 0, design: 'venice', variant: 'venice', number: '7147', name: userNameUp, expiry: '08/28', type: 'Фізична', limit: '500 000', used: '215 800', status: 'Активна', statusRaw: 'active', cardTypeRaw: 'physical' },
    { id: 0, design: 'tuscany_villa', variant: 'tuscany_villa', number: '4402', name: userNameUp, expiry: '11/30', type: 'Віртуальна', limit: '50 000', used: '0', status: 'Заморожена', statusRaw: 'blocked', cardTypeRaw: 'virtual' },
  ];
  const [designOverrides, setDesignOverrides] = useState<Record<number, string>>({});
  const cards = apiCards.length > 0
    ? apiCards.map(c => {
      const mapped = apiCardToData(c, userNameUp);
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
  const statusLabel = card?.status || 'Активна';
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
    if (pinValue.length !== 4 || !/^\d{4}$/.test(pinValue)) { toast('PIN має бути 4 цифри'); return; }
    if (pinValue !== pinConfirm) { toast('PIN-коди не збігаються'); return; }
    if (apiCards.length === 0) { toast('Демо-режим: зміна PIN недоступна'); return; }
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
      if (!r.ok || !j.ok) throw new Error(j.message || 'Помилка зміни PIN');
      toast(`✓ PIN картки •• ${card.number} змінено`);
      setPinModal(false); setPinValue(''); setPinConfirm('');
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Помилка зміни PIN'); }
    finally { setPinLoading(false); }
  }

  async function toggleBlock() {
    if (apiCards.length === 0) { toast('Демо-режим: API не підключено'); return; }
    const c = apiCards[safeIdx];
    const token = localStorage.getItem('army_bank_token');
    try {
      const r = await fetch(`/api/cards/${c.id}/block`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.message || 'Помилка');
      toast(c.status === 'active' ? `Картку •• ${card.number} заморожено` : `Картку •• ${card.number} розморожено`);
      refreshDashboard();
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Помилка'); }
  }

  async function closeCard() {
    if (apiCards.length === 0) { toast('Демо-режим: API не підключено'); return; }
    const c = apiCards[safeIdx];
    const token = localStorage.getItem('army_bank_token');
    try {
      const r = await fetch(`/api/cards/${c.id}/close`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.message || 'Помилка');
      toast(`Картку •• ${card.number} закрито`);
      refreshDashboard();
      setSelected(0);
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'Помилка'); }
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
      toast('Сесія завершилась. Увійдіть знову.');
      return;
    }
    setDesignLoading(true);
    try {
      if (designMode === 'current') {
        if (apiCards.length === 0) {
          toast('Немає картки для зміни дизайну');
          return;
        }
        const c = apiCards[safeIdx];
        if (!c) throw new Error('Картку не знайдено.');
        const r = await fetch(`/api/cards/${c.id}/design`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ design: selectedDesign }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.message || 'Не вдалося оновити дизайн');
        setDesignOverrides(prev => ({ ...prev, [c.id]: selectedDesign }));
        toast(`Дизайн картки •• ${card.number} оновлено`);
      } else {
        const r = await fetch('/api/cards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ card_type: 'virtual', design: selectedDesign }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.message || 'Не вдалося випустити картку');
        toast('Нову картку випущено');
      }
      await refresh().catch(() => {});
      await refreshDashboard();
      setDesignModal(false);
      if (designMode === 'issue') setSelected(0);
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Помилка дизайну картки');
    } finally {
      setDesignLoading(false);
    }
  }

  const isFrozen = apiCards.length > 0 ? apiCards[safeIdx]?.status === 'blocked' : card?.statusRaw === 'blocked';

  return (
    <>
    <ContentWrap maxW={760}>
    <div style={{ paddingBottom: 80 }}>
      <div style={{ padding: `${topPad} 22px 16px`, display: 'flex', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 12, color: text.muted, fontWeight: 500, marginBottom: 4 }}>Гаманець</div>
          <div style={{ ...T.h1, color: text.primary }}>Мої картки</div>
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
          {designLoading && designMode === 'issue' ? 'Створення...' : 'Випустити'}
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
            Карток ще немає. Натисніть «Випустити».
          </div>
        )}
      </div>

      {/* Card details */}
      <div style={{ padding: '20px 22px 0' }}>
        <div style={{ background: bg.card, border: `1px solid ${bg.border}`, borderRadius: 22, padding: 20 }}>
          {!card ? (
            <div style={{ color: text.muted }}>Немає активної картки для перегляду.</div>
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
            <div style={{ fontSize: 11, color: text.muted }}>{card.cardTypeRaw === 'physical' ? 'Фізична' : 'Віртуальна'} • до {card.expiry}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 10 }}>
            <div style={{ fontSize: 12, color: text.muted }}>
              Дизайн: <span style={{ color: text.secondary, fontWeight: 600 }}>{currentDesignOption?.title || 'Classic Gold'}</span>
            </div>
            <button
              onClick={() => openDesignModal('current')}
              style={{
                padding: '7px 12px', borderRadius: 10, border: '1px solid rgba(180,172,155,0.24)',
                background: 'rgba(255,255,255,0.04)', color: text.secondary, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >Змінити</button>
          </div>

          {/* Account activity */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'baseline' }}>
              <span style={{ ...T.caption, color: text.muted }}>Активність рахунку за місяць</span>
              <span style={{ fontSize: 12, color: 'rgba(220,215,200,0.6)', fontFeatureSettings: '"tnum"' }}>{monthTransactions.length} оп.</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 22, fontWeight: 600, color: text.primary, fontFeatureSettings: '"tnum"' }}>{formatUah(monthOut)}</span>
              <span style={{ fontSize: 13, color: text.dim, fontFeatureSettings: '"tnum"' }}>витрат</span>
            </div>
            <div style={{ fontSize: 12, color: text.muted }}>
              Баланс рахунку: {formatUah(Number(account?.balance || 0))}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
            {[
              { label: 'Деталі', msg: `Картка •• ${card.number} · до ${card.expiry}`, icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="13" rx="2" stroke={gold} strokeWidth="1.6" /><path d="M3 10h18" stroke={gold} strokeWidth="1.6" /></svg> },
              { label: 'PIN', action: () => setPinModal(true), icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="4" y="11" width="16" height="10" rx="2" stroke={gold} strokeWidth="1.6" /><path d="M8 11V8a4 4 0 018 0v3" stroke={gold} strokeWidth="1.6" /></svg> },
              { label: 'Дизайн', action: () => openDesignModal('current'), icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h16M4 18h16" stroke={gold} strokeWidth="1.8" strokeLinecap="round" /><circle cx="8" cy="6" r="2" fill={gold} /><circle cx="16" cy="12" r="2" fill={gold} /><circle cx="11" cy="18" r="2" fill={gold} /></svg> },
              { label: 'Рахунок', msg: `Рахунок: ${account?.account_number || '—'}`, icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 12a8 8 0 1116 0" stroke={gold} strokeWidth="1.6" strokeLinecap="round" /><path d="M12 12l4-4" stroke={gold} strokeWidth="1.6" strokeLinecap="round" /><circle cx="12" cy="12" r="1.5" fill={gold} /></svg> },
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
              {isFrozen ? 'Розморозити' : 'Заморозити'}
            </button>
            <button onClick={closeCard} style={{
              flex: 1, padding: '12px', background: 'rgba(220,100,110,0.06)',
              border: '1px solid rgba(220,100,110,0.2)', borderRadius: 12,
              color: '#dc646e', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              opacity: busyCardId === card.id || card.statusRaw === 'closed' ? 0.6 : 1,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              Закрити
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
          <div style={{ fontSize: 18, fontWeight: 700, color: text.primary, marginBottom: 4 }}>Змінити PIN</div>
          <div style={{ fontSize: 12, color: text.muted, marginBottom: 20 }}>Картка •• {card.number}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 11, color: text.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5, display: 'block' }}>Новий PIN (4 цифри)</label>
              <input
                type="password" inputMode="numeric" maxLength={4}
                value={pinValue} onChange={e => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="••••"
                style={{ width: '100%', padding: '12px 14px', background: 'rgba(255,255,255,0.05)', border: `1px solid rgba(180,172,155,0.18)`, borderRadius: 12, color: text.primary, fontSize: 20, outline: 'none', fontFamily: fontFamily, letterSpacing: 8, boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: text.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5, display: 'block' }}>Підтвердити PIN</label>
              <input
                type="password" inputMode="numeric" maxLength={4}
                value={pinConfirm} onChange={e => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="••••"
                style={{ width: '100%', padding: '12px 14px', background: 'rgba(255,255,255,0.05)', border: `1px solid ${pinConfirm && pinValue !== pinConfirm ? 'rgba(220,80,80,0.5)' : 'rgba(180,172,155,0.18)'}`, borderRadius: 12, color: text.primary, fontSize: 20, outline: 'none', fontFamily: fontFamily, letterSpacing: 8, boxSizing: 'border-box' }}
              />
              {pinConfirm && pinValue !== pinConfirm && <div style={{ fontSize: 11, color: '#e07070', marginTop: 4 }}>PIN-коди не збігаються</div>}
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
              }}>{pinLoading ? 'Збереження…' : 'Зберегти PIN'}</button>
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
            {designMode === 'current' ? 'Оберіть дизайн картки' : 'Випуск нової картки'}
          </div>
          <div style={{ fontSize: 12, color: text.muted, marginBottom: 16 }}>
            {designMode === 'current'
              ? `Картка •• ${card?.number || '0000'}`
              : 'Оберіть стиль, потім випустіть віртуальну картку'}
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
                  type={card?.type || 'Віртуальна'}
                  style={{ width: '100%' }}
                />
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: text.primary }}>{opt.title}</div>
                  <div style={{ fontSize: 11, color: text.muted }}>{opt.subtitle}</div>
                </div>
              </button>
            ))}
          </div>

          <div style={{ marginTop: 14, fontSize: 12, color: text.muted }}>
            Обрано: <span style={{ color: text.secondary, fontWeight: 700 }}>{activeDesignOption.title}</span>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button
              onClick={() => setDesignModal(false)}
              disabled={designLoading}
              style={{
                flex: 1, padding: '13px 12px', borderRadius: 14, border: '1px solid rgba(180,172,155,0.22)',
                background: 'rgba(255,255,255,0.03)', color: text.secondary, fontSize: 14, fontWeight: 600, cursor: designLoading ? 'default' : 'pointer',
              }}
            >Скасувати</button>
            <button
              onClick={applyCardDesign}
              disabled={designLoading}
              style={{
                flex: 1.2, padding: '13px 12px', borderRadius: 14, border: 'none',
                background: `linear-gradient(135deg, ${goldDark}, ${gold})`,
                color: '#1c2e22', fontSize: 14, fontWeight: 800, cursor: designLoading ? 'default' : 'pointer',
                opacity: designLoading ? 0.7 : 1,
              }}
            >{designLoading ? 'Застосування…' : (designMode === 'current' ? 'Застосувати дизайн' : 'Випустити картку')}</button>
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
  const topPad = useTopPad();
  const { toast, transactions, account } = useApp();
  const [period, setPeriod] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [dlReceipt, setDlReceipt] = useState<number | null>(null);
  const [dlExport, setDlExport] = useState(false);
  const token = localStorage.getItem('army_bank_token');

  const periodLabels = ['Т', 'М', 'Р'];
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
      ? stamp.toLocaleDateString('uk-UA', { month: 'short' })
      : stamp.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
  });

  async function downloadReceipt(txId: number) {
    setDlReceipt(txId);
    try {
      const r = await fetch(`/api/transactions/${txId}/receipt`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { toast('Помилка завантаження чека'); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `receipt-${txId}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch { toast('Помилка завантаження'); } finally { setDlReceipt(null); }
  }

  async function downloadExport() {
    setDlExport(true);
    try {
      const r = await fetch('/api/transactions/export', { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { toast('Помилка експорту'); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'army_bank_transactions.csv'; a.click();
      URL.revokeObjectURL(url);
    } catch { toast('Помилка завантаження'); } finally { setDlExport(false); }
  }

  async function downloadStatement() {
    try {
      const r = await fetch('/api/transactions/statement', { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { toast('Помилка виписки'); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'statement.pdf'; a.click();
      URL.revokeObjectURL(url);
    } catch { toast('Помилка завантаження'); }
  }

  // Build tx groups from real API data (or fallback to static)
  const STATIC_GROUPS: { group: string; items: { txId?: number; title: string; subtitle: string; amount: string; positive?: boolean; cat: TxCat }[] }[] = [
    { group: 'Сьогодні', items: [
      { title: 'Надходження • ФОП', subtitle: '14:32', amount: '+84 200,00', positive: true, cat: 'income' },
      { title: 'Сільпо', subtitle: '12:18 • Картка •• 0001', amount: '-1 247,50', cat: 'food' },
      { title: 'Uklon', subtitle: '09:42 • Apple Pay', amount: '-148,00', cat: 'transport' },
    ]},
    { group: 'Вчора', items: [
      { title: 'Комунальні послуги', subtitle: 'Київенерго', amount: '-3 180,00', cat: 'utility' },
      { title: 'Rozetka', subtitle: 'Покупки онлайн', amount: '-6 420,00', cat: 'shopping' },
    ]},
  ];

  const filtered = (searchQuery.trim()
    ? transactions.filter(tx => tx.description.toLowerCase().includes(searchQuery.toLowerCase()))
    : transactions
  );

  const apiGroups = (() => {
    const map: Record<string, TxItem[]> = {};
    for (const tx of filtered) { const k = tx.created_at.slice(0, 10); if (!map[k]) map[k] = []; map[k].push(tx); }
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a)).map(([dateKey, items]) => ({
      group: fmtDateLabel(dateKey),
      items: items.map(tx => ({
        txId: tx.id,
        title: tx.description,
        subtitle: fmtTime(tx.created_at) + (tx.related_account ? ` • ${tx.related_account}` : ''),
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
    <ContentWrap maxW={720}>
    <div style={{ paddingBottom: 80 }}>
      <div style={{ padding: `${topPad} 22px 14px` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ ...T.h1, color: text.primary }}>Операції</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={downloadExport} disabled={dlExport} title="Завантажити CSV" style={{ width: 36, height: 36, borderRadius: 10, background: bg.card, border: `1px solid ${bg.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: gold, fontSize: 16 }}>{dlExport ? '…' : '📊'}</button>
            <button onClick={downloadStatement} title="Виписка PDF" style={{ width: 36, height: 36, borderRadius: 10, background: bg.card, border: `1px solid ${bg.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: gold, fontSize: 16 }}>📄</button>
          </div>
        </div>
        {/* Search */}
        <div style={{ position: 'relative' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', opacity: 0.5 }}><circle cx="11" cy="11" r="7" stroke="#ddd8cc" strokeWidth="1.8" /><path d="M20 20l-3-3" stroke="#ddd8cc" strokeWidth="1.8" strokeLinecap="round" /></svg>
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Пошук транзакцій…"
            style={{ width: '100%', padding: '10px 14px 10px 36px', background: 'rgba(255,255,255,0.04)', border: `1px solid rgba(180,172,155,0.14)`, borderRadius: 12, color: '#ddd8cc', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
        </div>
      </div>

      {/* Chart */}
      <div style={{ padding: '0 22px 18px' }}>
        <div style={{ padding: 20, ...glassCard() }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <div style={{ ...sectionLabel, padding: 0, marginBottom: 4 }}>Загальні витрати</div>
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

      {/* Transactions */}
      {txGroups.length === 0 && (
        <div style={{ padding: '40px 22px', textAlign: 'center', color: text.muted, fontSize: 14 }}>
          {searchQuery ? `Нічого не знайдено за «${searchQuery}»` : 'Транзакцій ще немає'}
        </div>
      )}
      {txGroups.map((g, gi) => (
        <div key={gi} style={{ padding: '4px 22px 12px' }}>
          <div style={{ ...sectionLabel }}>{g.group}</div>
          <div style={{ background: bg.card, border: `1px solid ${bg.border}`, borderRadius: 18, overflow: 'hidden' }}>
            {g.items.map((t, i) => {
              const s = CAT_STYLES[t.cat];
              return (
                <Fragment key={i}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, background: s.bg,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      border: `1px solid ${s.color}22`,
                    }}>{s.icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ ...T.body, fontWeight: 500, color: text.secondary, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</div>
                      <div style={{ ...T.sm, color: text.muted }}>{t.subtitle}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ ...T.body, fontWeight: 600, color: t.positive ? '#7fb896' : text.secondary, ...T.num }}>{t.amount} ₴</div>
                      {t.txId ? (
                        <button onClick={() => downloadReceipt(t.txId!)} disabled={dlReceipt === t.txId} title="Завантажити чек" style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(180,172,155,0.08)', border: `1px solid rgba(180,172,155,0.15)`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 13 }}>{dlReceipt === t.txId ? '…' : '🧾'}</button>
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
  );
}

// ─── Profile screen ───────────────────────────────────────────
function ProfileRow({ label, value, mono, copyable, last }: { label: string; value: string; mono?: boolean; copyable?: boolean; last?: boolean }) {
  const { toast } = useApp();
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => toast(`Скопійовано: ${value}`)).catch(() => toast('Не вдалось скопіювати'));
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
  const topPad = useTopPad();
  const { logout, user, account, toast } = useApp();
  const [faceid, setFaceid] = useState(false);
  const [faceIdReady, setFaceIdReady] = useState(false); // platform auth available
  const [faceIdBusy, setFaceIdBusy] = useState(false);
  const [push, setPush] = useState(true);
  const [twofa, setTwofa] = useState(false);

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
        if (!optRes.ok || !optJson.ok) throw new Error(optJson.error || 'Помилка');
        const attResp = await startRegistration({ optionsJSON: optJson.data });
        const verRes = await fetch('/api/auth/passkey/register', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(attResp),
        });
        const verJson = await verRes.json();
        if (!verRes.ok || !verJson.ok) throw new Error(verJson.error || 'Помилка реєстрації');
        setFaceid(true);
        toast('Face ID увімкнено ✓');
      } else {
        // Remove passkey
        const res = await fetch('/api/auth/passkey/remove', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Помилка');
        setFaceid(false);
        toast('Face ID вимкнено');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Помилка';
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

  const displayName = user?.full_name ?? 'Користувач';
  const initials = displayName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
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
      if (!res.ok || !json.ok) throw new Error(json.message || 'Помилка');
      toast('Пароль змінено успішно');
      setChangingPwd(false); setOldPwd(''); setNewPwd('');
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Помилка зміни пароля');
    } finally {
      setPwdLoading(false);
    }
  }

  const section = (children: React.ReactNode) => (
    <div style={{ background: bg.card, border: `1px solid ${bg.border}`, borderRadius: 20, overflow: 'hidden', margin: '0 22px 14px' }}>
      {children}
    </div>
  );

  return (
    <ContentWrap maxW={680}>
    <div style={{ paddingBottom: 80 }}>
      {/* Avatar */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: `${topPad} 22px 28px` }}>
        <div style={{
          width: 80, height: 80, borderRadius: '50%',
          background: `linear-gradient(135deg, ${gold} 0%, ${goldDark} 100%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28, fontWeight: 700, color: '#1a2820', letterSpacing: 0.5,
          boxShadow: `0 0 0 3px rgba(0,0,0,0.6), 0 0 0 5px ${gold}55, inset 0 1px 0 rgba(230,225,210,0.5)`,
          marginBottom: 14,
        }}>{initials}</div>
        <div style={{ ...T.h2, color: text.primary, marginBottom: 4 }}>{displayName}</div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', background: 'rgba(127,184,150,0.12)', border: '1px solid rgba(127,184,150,0.25)', borderRadius: 100 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#7fb896' }} />
          <span style={{ fontSize: 11.5, color: '#7fb896', fontWeight: 500 }}>Верифікований</span>
        </div>
      </div>

      {/* Account info */}
      {section(<>
        <ProfileRow label="Ім'я" value={displayName} />
        <ProfileRow label="Телефон" value={phone} mono />
        <ProfileRow label="Email" value={user?.email ?? '—'} copyable />
        <ProfileRow label="Рахунок" value={account?.account_number ?? '—'} mono copyable last />
      </>)}

      {/* Security */}
      <div style={{ padding: '4px 22px 8px' }}>
        <div style={{ ...sectionLabel }}>Безпека</div>
      </div>
      {section(<>
        {faceIdReady ? (
          <ProfileToggle
            label="Face ID"
            sub={faceIdBusy ? 'Обробка…' : 'Вхід та підтвердження переказів'}
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
          <ProfileToggle label="Face ID" sub="Недоступно на цьому пристрої" on={false} onChange={() => {}}
            icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(180,172,155,0.35)" strokeWidth="1.5" strokeLinecap="round"><path d="M2 9V5a2 2 0 012-2h3M2 15v4a2 2 0 002 2h3M22 9V5a2 2 0 00-2-2h-3M22 15v4a2 2 0 01-2 2h-3"/></svg>}
          />
        )}
        <div style={{ height: 1, background: 'rgba(180,172,155,0.08)', margin: '0 18px' }} />
        <ProfileToggle label="Push-сповіщення" on={push} onChange={setPush}
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 004 0" stroke={gold} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        />
        <div style={{ height: 1, background: 'rgba(180,172,155,0.08)', margin: '0 18px' }} />
        <ProfileToggle label="2FA" sub="Підтвердження за SMS" on={twofa} onChange={setTwofa}
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="4" y="11" width="16" height="10" rx="2" stroke={gold} strokeWidth="1.6" /><path d="M8 11V8a4 4 0 018 0v3" stroke={gold} strokeWidth="1.6" /></svg>}
        />
      </>)}

      {/* Change password */}
      <div style={{ padding: '4px 22px 8px' }}>
        <div style={{ ...sectionLabel }}>Пароль</div>
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
            <span style={{ fontSize: 14, color: text.secondary, fontWeight: 500 }}>Змінити пароль</span>
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
                type="password" placeholder="Поточний пароль" value={oldPwd} onChange={e => setOldPwd(e.target.value)} required
                style={{ padding: '11px 14px', background: 'rgba(255,255,255,0.05)', border: `1px solid rgba(180,172,155,0.14)`, borderRadius: 10, color: text.primary, fontSize: 14, outline: 'none', fontFamily: 'inherit' }}
              />
              <input
                type="password" placeholder="Новий пароль" value={newPwd} onChange={e => setNewPwd(e.target.value)} required
                style={{ padding: '11px 14px', background: 'rgba(255,255,255,0.05)', border: `1px solid rgba(180,172,155,0.14)`, borderRadius: 10, color: text.primary, fontSize: 14, outline: 'none', fontFamily: 'inherit' }}
              />
              <button type="submit" disabled={pwdLoading} style={{
                padding: '11px', background: pwdLoading ? 'rgba(100,95,80,0.3)' : `linear-gradient(135deg, ${goldDark}, ${gold})`,
                border: 'none', borderRadius: 10, color: text.primary, fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: pwdLoading ? 'default' : 'pointer',
              }}>{pwdLoading ? '…' : 'Зберегти'}</button>
            </form>
          </>
        )}
      </>)}

      {/* Sign out */}
      <div style={{ padding: '8px 22px' }}>
        <button onClick={logout} style={{
          width: '100%', padding: '14px', borderRadius: 16,
          background: 'rgba(220,100,110,0.06)', border: '1px solid rgba(220,100,110,0.18)',
          color: '#dc646e', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M17 16l4-4-4-4M21 12H9M13 4a9 9 0 100 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Вийти з акаунту
        </button>
      </div>
    </div>
    </ContentWrap>
  );
}

// ─── Bottom tab bar ───────────────────────────────────────────

// ─── Marketplace screen ───────────────────────────────────────
interface Product { id: number; title: string; description?: string; price: number; currency?: string; image_emoji?: string; badge?: string; stock?: number; slug?: string; }
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

function ProductDetailDrawer({ product, onClose, onAddToCart }: { product: Product; onClose: () => void; onAddToCart: (p: Product) => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }} onClick={onClose}>
      <div style={{ background: 'rgba(0,0,0,0.5)', position: 'absolute', inset: 0 }} />
      <div onClick={e => e.stopPropagation()} style={{
        position: 'relative', background: 'linear-gradient(180deg,#112820 0%,#0b1e16 100%)',
        borderRadius: '24px 24px 0 0', padding: '28px 24px 48px',
        boxShadow: '0 -20px 60px rgba(0,0,0,0.6)', maxHeight: '85vh', overflowY: 'auto',
        border: '1px solid rgba(180,172,155,0.15)', borderBottom: 'none',
      }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(180,172,155,0.25)', margin: '0 auto 24px' }} />
        <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
          {product.badge && <BadgePill badge={product.badge} />}
          {product.stock !== undefined && product.stock <= 5 && product.stock > 0 && (
            <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: 'rgba(220,100,60,0.15)', color: '#e07858', letterSpacing: 0.5 }}>ОСТАННІ {product.stock}</span>
          )}
        </div>
        <div style={{ fontSize: 48, textAlign: 'center', marginBottom: 12 }}>{product.image_emoji || '🛍️'}</div>
        <div style={{ ...T.h2, color: text.primary, marginBottom: 8 }}>{product.title}</div>
        {product.description && (
          <div style={{ ...T.bodyLg, color: text.muted, lineHeight: 1.6, marginBottom: 20 }}>{product.description}</div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div style={{ ...T.hero, fontWeight: 800, color: gold, ...T.num }}>₴{fmtInt(product.price)}{fmtDec(product.price)}</div>
          {product.stock !== undefined && (
            <div style={{ fontSize: 12, color: product.stock > 0 ? text.muted : '#e07070' }}>
              {product.stock > 0 ? `Є в наявності: ${product.stock}` : 'Немає в наявності'}
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
          {(product.stock !== undefined && product.stock <= 0) ? 'Немає в наявності' : '🛒 Додати до кошика'}
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
  const total = cart.reduce((s, i) => s + i.product.price * i.qty, 0);
  const [step, setStep] = useState<'cart' | 'shipping'>('cart');
  const [shipName, setShipName] = useState(user?.full_name || '');
  const [shipPhone, setShipPhone] = useState(user?.phone || '');
  const [shipAddr, setShipAddr] = useState('');

  const fieldStyle: React.CSSProperties = {
    width: '100%', padding: '11px 14px', background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(180,172,155,0.18)', borderRadius: 12,
    color: text.primary, fontSize: 14, outline: 'none', fontFamily: fontFamily,
    boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = { fontSize: 11, color: text.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5, display: 'block' };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }} onClick={onClose}>
      <div style={{ background: 'rgba(0,0,0,0.5)', position: 'absolute', inset: 0 }} />
      <div onClick={e => e.stopPropagation()} style={{
        position: 'relative',
        background: 'linear-gradient(180deg,rgba(17,40,32,0.98) 0%,rgba(11,30,22,0.98) 100%)',
        backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
        borderRadius: '24px 24px 0 0', padding: '28px 24px calc(24px + env(safe-area-inset-bottom, 0px))',
        boxShadow: '0 -20px 60px rgba(0,0,0,0.6)', maxHeight: '85vh', overflowY: 'auto',
        border: '1px solid rgba(180,172,155,0.15)', borderBottom: 'none',
      }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(180,172,155,0.25)', margin: '0 auto 20px' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          {step === 'shipping' && (
            <button onClick={() => setStep('cart')} style={{ width: 32, height: 32, borderRadius: 10, background: 'rgba(180,172,155,0.1)', border: '1px solid rgba(180,172,155,0.18)', color: gold, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 4L6 8l4 4" stroke={gold} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          )}
          <div style={{ ...T.h2, color: text.primary, flex: 1 }}>
            {step === 'cart' ? 'Кошик' : 'Доставка'}
          </div>
          {step === 'cart' && <div style={{ ...T.body, color: text.muted }}>{cart.reduce((s,i) => s+i.qty, 0)} товарів</div>}
        </div>

        {step === 'cart' && (
          cart.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: text.muted }}>Кошик порожній</div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                {cart.map(item => (
                  <div key={item.product.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'rgba(255,255,255,0.04)', border: `1px solid ${bg.border}`, borderRadius: 14 }}>
                    <div style={{ fontSize: 28, flexShrink: 0 }}>{item.product.image_emoji || '🛍️'}</div>
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
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16, padding: '0 4px' }}>
                <span style={{ fontSize: 14, color: text.muted }}>Разом:</span>
                <span style={{ ...T.h2, fontWeight: 800, color: gold, ...T.num }}>₴{fmtInt(total)}{fmtDec(total)}</span>
              </div>
              <button onClick={() => setStep('shipping')} style={{
                width: '100%', padding: '15px', borderRadius: 16, border: 'none', fontSize: 16, fontWeight: 700,
                background: `linear-gradient(135deg, ${goldDark}, ${gold})`,
                color: text.primary, cursor: 'pointer', fontFamily: fontFamily,
              }}>Далі → Доставка</button>
            </>
          )
        )}

        {step === 'shipping' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={labelStyle}>Отримувач</label>
              <input value={shipName} onChange={e => setShipName(e.target.value)} placeholder="Прізвище Ім'я По-батькові" style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>Телефон</label>
              <input value={shipPhone} onChange={e => setShipPhone(e.target.value)} placeholder="+380XXXXXXXXX" style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>Адреса доставки</label>
              <input value={shipAddr} onChange={e => setShipAddr(e.target.value)} placeholder="м. Київ, вул. Хрещатик 1, кв. 5" style={fieldStyle} />
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '4px 4px 0' }}>
              <span style={{ fontSize: 13, color: text.muted }}>До оплати:</span>
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
              }}>{checkingOut ? 'Оформлення…' : '✓ Оформити замовлення'}</button>
          </div>
        )}
      </div>
    </div>
  );
}

type MarketTab = 'catalog' | 'orders' | 'invoices';

function MarketplaceScreen() {
  const topPad = useTopPad();
  const { toast, refreshDashboard, user: mktUser } = useApp();
  const [tab, setTab] = useState<MarketTab>('catalog');
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
  useEffect(() => { localStorage.setItem('arm_cart', JSON.stringify(cart)); }, [cart]);

  const token = localStorage.getItem('army_bank_token');

  function addToCart(product: Product) {
    setCart(prev => {
      const existing = prev.find(i => i.product.id === product.id);
      if (existing) return prev.map(i => i.product.id === product.id ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { product, qty: 1 }];
    });
    toast(`✓ ${product.title} — додано до кошика`);
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
    try {
      const r = await fetch('/api/marketplace/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          items: cart.map(i => ({ product_id: i.product.id, qty: i.qty })),
          shipping_name: shipping.name.trim(),
          shipping_phone: shipping.phone.trim(),
          shipping_address: shipping.address.trim(),
          payment_mode: 'pay_now',
          idempotency_key: `cart-${Date.now()}`,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.message || j.error || 'Помилка оформлення');
      toast(`✓ Замовлення оформлено!`);
      setCart([]);
      setShowCart(false);
      refreshDashboard();
      setTimeout(() => setTab('orders'), 800);
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Помилка оформлення');
    } finally {
      setCheckingOut(false);
    }
  }

  const cartCount = cart.reduce((s, i) => s + i.qty, 0);

  useEffect(() => {
    if (tab === 'catalog') {
      setLoading(true);
      fetch('/api/marketplace/catalog', { headers: { Authorization: `Bearer ${token}` } })
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
      if (!r.ok) { toast('Помилка завантаження чека'); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `receipt-${orderId}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch { toast('Помилка завантаження'); } finally { setDlPdf(null); }
  }

  const MARKET_TABS: { k: MarketTab; label: string }[] = [
    { k: 'catalog', label: 'Каталог' },
    { k: 'orders', label: 'Замовлення' },
    { k: 'invoices', label: 'Інвойси' },
  ];

  const statusColors: Record<string, string> = {
    paid: '#7fb896', active: '#7fb896', issued: gold, pending: gold,
    overdue: '#e07070', cancelled: 'rgba(220,215,200,0.4)', expired: 'rgba(220,215,200,0.4)',
  };

  const filteredProducts = search.trim()
    ? products.filter(p => p.title.toLowerCase().includes(search.toLowerCase()) || (p.description || '').toLowerCase().includes(search.toLowerCase()))
    : products;

  return (
    <>
    {preview && <ProductDetailDrawer product={preview} onClose={() => setPreview(null)} onAddToCart={addToCart} />}
    {showCart && <CartDrawer cart={cart} onClose={() => setShowCart(false)} onQtyChange={changeQty} onRemove={removeFromCart} onCheckout={checkoutCart} checkingOut={checkingOut} user={mktUser} />}
    <ContentWrap maxW={800}>
    <div style={{ paddingBottom: 80 }}>
      <div style={{ padding: `${topPad} 22px 12px` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ ...T.h1, color: text.primary }}>Магазин</div>
          <button onClick={() => setShowCart(true)} style={{ position: 'relative', width: 44, height: 44, borderRadius: 14, background: bg.card, border: `1px solid ${bg.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 20 }}>
            🛒
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
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Пошук товарів…" style={{ width: '100%', padding: '10px 14px 10px 36px', background: 'rgba(255,255,255,0.04)', border: `1px solid rgba(180,172,155,0.14)`, borderRadius: 12, color: '#ddd8cc', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
          </div>
        )}
      </div>

      {loading && <div style={{ padding: 60, textAlign: 'center', color: text.muted, fontSize: 14 }}>Завантаження…</div>}

      {/* ── CATALOG ── */}
      {!loading && tab === 'catalog' && (
        <>
          {filteredProducts.length === 0 ? (
            <div style={{ padding: '60px 22px', textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🛍️</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: text.secondary, marginBottom: 6 }}>{search ? 'Нічого не знайдено' : 'Магазин порожній'}</div>
              <div style={{ fontSize: 13, color: text.muted }}>{search ? `Спробуй інший запит` : 'Товари ще не додано.'}</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: 10, padding: '8px 22px' }}>
              {filteredProducts.map(p => (
                <div key={p.id} onClick={() => setPreview(p)} style={{ background: bg.card, border: `1px solid ${bg.border}`, borderRadius: 18, overflow: 'hidden', display: 'flex', flexDirection: 'column', cursor: 'pointer', transition: 'border-color 0.15s' }}>
                  <div style={{ height: 96, background: `linear-gradient(135deg, rgba(180,172,155,0.08), rgba(100,95,80,0.04))`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 42, position: 'relative' }}>
                    {p.image_emoji || '🛍️'}
                    {p.badge && (
                      <div style={{ position: 'absolute', top: 8, right: 8 }}><BadgePill badge={p.badge} /></div>
                    )}
                  </div>
                  <div style={{ padding: '10px 12px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ ...T.sm, fontWeight: 600, color: text.secondary, lineHeight: 1.3 }}>{p.title}</div>
                    <div style={{ marginTop: 'auto', paddingTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <span style={{ ...T.body, fontWeight: 700, color: gold, ...T.num }}>₴{fmtInt(p.price)}</span>
                      <button onClick={e => { e.stopPropagation(); addToCart(p); }} disabled={p.stock !== undefined && p.stock <= 0} style={{
                        width: 28, height: 28, borderRadius: 8, border: `1px solid ${bg.border}`, fontSize: 14, fontWeight: 700,
                        background: (p.stock !== undefined && p.stock <= 0) ? 'rgba(30,45,35,0.4)' : 'rgba(180,172,155,0.15)',
                        color: text.secondary, cursor: (p.stock !== undefined && p.stock <= 0) ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>+</button>
                    </div>
                    {p.stock !== undefined && p.stock > 0 && p.stock <= 5 && (
                      <div style={{ fontSize: 9, color: '#e0a070', fontWeight: 600 }}>Останніх: {p.stock}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── ORDERS ── */}
      {!loading && tab === 'orders' && (
        <div style={{ padding: '8px 22px' }}>
          {orders.length === 0 ? (
            <div style={{ padding: '60px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: text.secondary, marginBottom: 6 }}>Замовлень ще немає</div>
              <div style={{ fontSize: 13, color: text.muted }}>Оформіть перше замовлення в каталозі.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {orders.map(o => (
                <div key={o.id} style={{ background: bg.card, border: `1px solid ${bg.border}`, borderRadius: 16, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: text.secondary }}>Замовлення #{o.id}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 100, background: `${statusColors[o.status] || gold}22`, color: statusColors[o.status] || gold }}>{o.status}</span>
                    </div>
                    <div style={{ fontSize: 12, color: text.muted }}>{o.items_count || 0} поз. · {o.created_at ? new Date(o.created_at).toLocaleDateString('uk-UA') : ''}</div>
                    {o.invoice_number && <div style={{ fontSize: 11, color: text.dim, marginTop: 2 }}>Інвойс: {o.invoice_number}</div>}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ ...T.bodyLg, fontWeight: 700, color: gold, ...T.num }}>₴{fmtInt(o.total_amount)}{fmtDec(o.total_amount)}</div>
                    <button onClick={() => downloadOrderReceipt(o.id)} disabled={dlPdf === `order-${o.id}`} style={{
                      marginTop: 6, padding: '4px 10px', borderRadius: 8, border: `1px solid rgba(180,172,155,0.25)`,
                      background: 'transparent', color: gold, fontSize: 11, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                    }}>{dlPdf === `order-${o.id}` ? '…' : '📄 Чек'}</button>
                  </div>
                </div>
              ))}
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
              <div style={{ fontSize: 15, fontWeight: 600, color: text.secondary, marginBottom: 6 }}>Інвойсів ще немає</div>
              <div style={{ fontSize: 13, color: text.muted }}>Інвойси з'являться після оформлення замовлень.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {invoices.map(inv => (
                <div key={inv.invoice_number} style={{ background: bg.card, border: `1px solid ${bg.border}`, borderRadius: 16, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: text.secondary, fontFamily: 'monospace' }}>{inv.invoice_number}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 100, background: `${statusColors[inv.status] || gold}22`, color: statusColors[inv.status] || gold }}>{inv.status}</span>
                    </div>
                    <div style={{ fontSize: 12, color: text.muted }}>
                      {inv.created_at ? new Date(inv.created_at).toLocaleDateString('uk-UA') : ''}
                      {inv.due_at ? ` · до ${new Date(inv.due_at).toLocaleDateString('uk-UA')}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ ...T.bodyLg, fontWeight: 700, color: gold, ...T.num }}>₴{fmtInt(inv.amount)}{fmtDec(inv.amount)}</div>
                    {inv.status === 'issued' && inv.order_id && (
                      <button onClick={() => downloadOrderReceipt(inv.order_id!)} disabled={dlPdf === `order-${inv.order_id}`} style={{
                        marginTop: 6, padding: '4px 10px', borderRadius: 8, border: `1px solid rgba(180,172,155,0.25)`,
                        background: 'transparent', color: gold, fontSize: 11, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                      }}>{dlPdf === `order-${inv.order_id}` ? '…' : '📄 Чек'}</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
    </ContentWrap>
    </>
  );
}

const TABS: { k: TabKey; label: string; icon: (c: string) => React.ReactNode }[] = [
  { k: 'overview', label: 'Огляд', icon: c => <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7.5" height="7.5" rx="2" stroke={c} strokeWidth="1.8" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" stroke={c} strokeWidth="1.8" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" stroke={c} strokeWidth="1.8" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" stroke={c} strokeWidth="1.8" /></svg> },
  { k: 'operations', label: 'Операції', icon: c => <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M3 12h3l3-8 4 16 3-8h5" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  { k: 'cards', label: 'Картки', icon: c => <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="2.5" y="5" width="19" height="14" rx="2.5" stroke={c} strokeWidth="1.8" /><path d="M2.5 10h19" stroke={c} strokeWidth="1.8" /></svg> },
  { k: 'market', label: 'Магазин', icon: c => <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13l-1.5 6h12" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><circle cx="9" cy="21" r="1" fill={c} /><circle cx="19" cy="21" r="1" fill={c} /></svg> },
  { k: 'profile', label: 'Профіль', icon: c => <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke={c} strokeWidth="1.8" /><path d="M4 21a8 8 0 0116 0" stroke={c} strokeWidth="1.8" strokeLinecap="round" /></svg> },
];

function TabBar({ active, onChange }: { active: TabKey; onChange: (k: TabKey) => void }) {
  const activeIdx = TABS.findIndex(t => t.k === active);
  return (
    <div style={{
      position: 'relative', zIndex: 40, flexShrink: 0,
      paddingBottom: 0,
      background: 'transparent',
      pointerEvents: 'auto',
    }}>
      <div style={{
        padding: '0 14px max(8px, env(safe-area-inset-bottom, 0px))',
        paddingTop: 8,
        pointerEvents: 'auto',
      }}>
      <div style={{
        position: 'relative', padding: 6,
        background: 'rgba(15,32,26,0.75)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        border: `1px solid rgba(180,172,155,0.22)`,
        borderRadius: 28, display: 'flex',
        boxShadow: '0 20px 40px rgba(0,0,0,0.4), inset 0 1px 0 rgba(230,225,210,0.08)',
      }}>
        {/* Sliding indicator */}
        <div style={{
          position: 'absolute', top: 6, bottom: 6,
          left: `calc(${activeIdx * 20}% + 6px)`, width: 'calc(20% - 12px)',
          background: 'linear-gradient(135deg, rgba(180,172,155,0.22) 0%, rgba(100,95,80,0.12) 100%)',
          border: `1px solid rgba(180,172,155,0.35)`, borderRadius: 22,
          transition: 'left 0.32s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: 'inset 0 1px 0 rgba(230,225,210,0.15)',
        }} />
        {TABS.map(t => {
          const isActive = t.k === active;
          const color = isActive ? goldLight : 'rgba(220,215,200,0.5)';
          return (
            <button key={t.k} onClick={() => onChange(t.k)} style={{
              flex: 1, padding: '10px 4px', background: 'transparent', border: 'none', cursor: 'pointer',
              position: 'relative', zIndex: 1,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              color, fontSize: 10, fontWeight: isActive ? 700 : 500,
              letterSpacing: 0.3, fontFamily: 'inherit', transition: 'color 0.2s',
            }}>
              {t.icon(color)}
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>
      </div>
    </div>
  );
}

// ─── Desktop sidebar ──────────────────────────────────────────
function DesktopSidebar({ active, onChange }: { active: TabKey; onChange: (k: TabKey) => void }) {
  const { logout, user, account } = useApp();
  const name = user?.full_name ?? 'Користувач';
  const initials = name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
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
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: `linear-gradient(145deg, ${goldDark} 0%, ${gold} 60%, ${goldLight} 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            boxShadow: `0 4px 14px rgba(180,172,155,0.35), inset 0 1px 0 rgba(255,230,160,0.5)`,
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 2L3 20h3.5l1.8-4h7.4l1.8 4H21L12 2zm-2.6 11L12 7.3 14.6 13H9.4z" fill="#1c2e22" /></svg>
          </div>
          <div>
            <div style={{ ...T.h3, color: text.primary, lineHeight: 1.1 }}>
              ARM<span style={{ fontWeight: 300, opacity: 0.8 }}>Bank</span>
            </div>
            <div style={{ fontSize: 10, color: text.dim, letterSpacing: 0.6, marginTop: 1 }}>Особистий кабінет</div>
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
          }}>{initials}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...T.body, fontWeight: 600, color: text.primary, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#6ec98a', boxShadow: '0 0 6px #6ec98a88' }} />
              <span style={{ fontSize: 10.5, color: '#6ec98a', fontWeight: 500, letterSpacing: 0.2 }}>Верифікований</span>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
        {TABS.map(t => {
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
        <div style={{ ...sectionLabel, padding: 0, marginBottom: 7 }}>Загальний баланс</div>
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
          Вийти з акаунту
        </button>
      </div>
    </div>
  );
}

// ─── Root app ─────────────────────────────────────────────────
const SCREENS = { overview: OverviewScreen, operations: OperationsScreen, cards: CardsScreen, market: MarketplaceScreen, profile: ProfileScreen };

const appBg = 'radial-gradient(ellipse 80% 60% at 20% 0%, #1a3a2c 0%, transparent 60%), radial-gradient(ellipse 70% 50% at 90% 100%, #2a1a0e 0%, transparent 55%), linear-gradient(180deg, #0a1f18 0%, #07150f 100%)';

const appBase: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  height: 'var(--app-vh, 100vh)',
  minHeight: 'var(--app-vh, 100vh)',
  background: appBg,
  color: text.secondary,
  fontFamily,
  WebkitFontSmoothing: 'antialiased',
  MozOsxFontSmoothing: 'grayscale',
  textRendering: 'optimizeLegibility',
};

// ─── Login screen ─────────────────────────────────────────────
function LoginScreen({ onLogin }: { onLogin: () => void }) {
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
      if (!optRes.ok || !optJson.ok) throw new Error(optJson.error || 'Помилка');
      // 2. Trigger Face ID
      const assertion = await startAuthentication({ optionsJSON: optJson.data });
      // 3. Verify
      const verRes = await fetch('/api/auth/passkey/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(assertion),
      });
      const verJson = await verRes.json();
      if (!verRes.ok || !verJson.ok) throw new Error(verJson.error || 'Помилка верифікації');
      localStorage.setItem('army_bank_token', verJson.data.token);
      onLogin();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Помилка Face ID';
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
    if (mode === 'register' && password !== confirmPass) { setError('Паролі не збігаються'); return; }
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
      if (!res.ok || !json.ok) throw new Error(json.error || json.message || (isReg ? 'Помилка реєстрації' : 'Невірні дані'));
      localStorage.setItem('army_bank_token', json.data.token);
      onLogin();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Помилка');
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '13px 16px', background: 'rgba(255,255,255,0.055)',
    border: `1px solid rgba(180,172,155,0.16)`, borderRadius: radius.md,
    color: text.primary, fontSize: 15, outline: 'none', fontFamily, boxSizing: 'border-box',
    transition: 'border-color 0.15s',
    WebkitAppearance: 'none',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', ...T.caption, color: text.muted, marginBottom: 7,
  };
  const fieldStyle = { marginBottom: 14 };

  return (
    <div style={{ ...appBase, overflowY: 'auto' }}>
      {/* Full-screen background radial glow */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 70% 50% at 50% 0%, rgba(30,60,44,0.6) 0%, transparent 70%)',
      }} />
      <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 20px', position: 'relative' }}>
      <div style={{ width: '100%', maxWidth: 380 }}>

        {/* Logo block */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          {/* Icon */}
          <div style={{
            width: 72, height: 72, borderRadius: 22, margin: '0 auto 20px',
            background: 'linear-gradient(160deg, #0f2a1e 0%, #0a1c14 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: `1px solid rgba(180,172,155,0.18)`,
            boxShadow: '0 1px 0 rgba(255,255,255,0.06) inset, 0 16px 40px rgba(0,0,0,0.5)',
          }}>
            <svg width="34" height="34" viewBox="0 0 32 32">
              <path d="M16 4L6 28h4l2.2-5.5h7.6L22 28h4L16 4zm-2.8 14.5L16 9.5l2.8 9z" fill={gold} opacity="0.9" />
            </svg>
          </div>
          {/* Wordmark */}
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5, color: text.primary, fontFamily, lineHeight: 1 }}>
            ARM<span style={{ fontWeight: 300, color: text.muted }}>Bank</span>
          </div>
          <div style={{ ...T.caption, color: text.dim, marginTop: 8, letterSpacing: 2, textTransform: 'uppercase' }}>
            Private Banking
          </div>
        </div>

        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: `1px solid ${bg.border}` }}>
          {(['login', 'register'] as const).map(m => (
            <button key={m} type="button" onClick={() => { setMode(m); setError(''); setConfirmPass(''); }} style={{
              flex: 1, padding: '10px', background: 'transparent', border: 'none',
              borderBottom: mode === m ? `2px solid ${gold}` : '2px solid transparent',
              marginBottom: -1,
              color: mode === m ? text.primary : text.muted,
              fontSize: 13, fontWeight: mode === m ? 600 : 400, fontFamily,
              cursor: 'pointer', transition: 'all 0.18s', letterSpacing: 0.3,
            }}>{m === 'login' ? 'Вхід' : 'Реєстрація'}</button>
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
              border: `1px solid ${bg.border}`,
              background: 'linear-gradient(160deg, rgba(28,42,34,0.9) 0%, rgba(16,28,20,0.95) 100%)',
              color: faceIdLoading ? text.dim : text.primary,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              cursor: faceIdLoading ? 'default' : 'pointer',
              fontFamily, fontSize: 15, fontWeight: 500, letterSpacing: 0.2,
              boxShadow: '0 1px 0 rgba(255,255,255,0.05) inset',
              transition: 'all 0.18s',
            }}
          >
            {faceIdLoading ? (
              <span style={{ opacity: 0.6 }}>Очікування…</span>
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
                <span>Увійти з Face ID</span>
              </>
            )}
          </button>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {mode === 'register' && <>
              <div style={fieldStyle}>
                <label style={labelStyle}>Повне ім'я</label>
                <input style={inputStyle} type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Іван Петренко" required />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Телефон</label>
                <input style={inputStyle} type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+380XXXXXXXXX" required />
              </div>
              <div style={fieldStyle}>
                <label style={labelStyle}>Email</label>
                <input style={inputStyle} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" required />
              </div>
            </>}

            {mode === 'login' && (
              <div style={fieldStyle}>
                <label style={labelStyle}>Телефон або Email</label>
                <input style={inputStyle} type="text" value={identity} onChange={e => setIdentity(e.target.value)} placeholder="Телефон або email" autoComplete="username" required />
              </div>
            )}

            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>Пароль</label>
                {mode === 'login' && (
                  <button type="button" onClick={() => setError('Зверніться до підтримки для відновлення пароля')} style={{ fontSize: 11, color: text.muted, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: 0.2 }}>
                    Забули пароль?
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
                  <label style={{ ...labelStyle, marginBottom: 0 }}>Підтвердити пароль</label>
                </div>
                <div style={{ position: 'relative' }}>
                  <input
                    style={{ ...inputStyle, paddingRight: 44 }}
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPass}
                    onChange={e => setConfirmPass(e.target.value)}
                    placeholder="Повторіть пароль"
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
                : 'linear-gradient(160deg, rgba(48,62,50,0.9) 0%, rgba(28,42,34,0.95) 100%)',
              color: loading ? text.dim : text.primary,
              ...T.bodyLg, fontWeight: 600, cursor: loading ? 'default' : 'pointer',
              fontFamily, letterSpacing: 0.4,
              boxShadow: loading ? 'none' : '0 1px 0 rgba(255,255,255,0.06) inset, 0 8px 20px rgba(0,0,0,0.35)',
              transition: 'all 0.18s',
            }}>{loading ? 'Обробка…' : mode === 'login' ? 'Увійти' : 'Створити акаунт'}</button>
          </div>
        </form>

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: 32, ...T.caption, color: text.dim, letterSpacing: 0.5 }}>
          ARM BANK · PRIVATE BANKING
        </div>
      </div>
      </div>
    </div>
  );
}

// ─── App root ─────────────────────────────────────────────────
export default function App() {
  const [authed, setAuthed] = useState(() => !!getToken());
  const [tab, setTab] = useState<TabKey>('overview');
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
      const message = err instanceof Error ? err.message : 'Не вдалося завантажити дані.';
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

  if (!authed) {
    return <LoginScreen onLogin={() => setAuthed(true)} />;
  }

  if (isDesktop) {
    return (
      <AppCtx.Provider value={appCtx}>
        <BankDataCtx.Provider value={bankCtx}>
          <LayoutCtx.Provider value="desktop">
            <div style={{ ...appBase, display: 'flex' }}>
              <DesktopSidebar active={tab} onChange={setTab} />
              <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
                {dataError && (
                  <div style={{ margin: '12px 16px 0', padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(220,100,110,0.25)', background: 'rgba(220,100,110,0.08)', color: '#ffb6bd', fontSize: 13 }}>
                    {dataError}
                  </div>
                )}
                {loadingData ? (
                  <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', color: text.muted }}>Завантаження даних...</div>
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
    );
  }

  return (
    <AppCtx.Provider value={appCtx}>
      <BankDataCtx.Provider value={bankCtx}>
        <LayoutCtx.Provider value="mobile">
          <div style={{ ...appBase, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', paddingBottom: 12 }}>
              {dataError && (
                <div style={{ margin: '10px 12px 0', padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(220,100,110,0.25)', background: 'rgba(220,100,110,0.08)', color: '#ffb6bd', fontSize: 13 }}>
                  {dataError}
                </div>
              )}
              {loadingData ? (
                <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', color: text.muted }}>Завантаження даних...</div>
              ) : (
                <Screen />
              )}
            </div>
            <TabBar active={tab} onChange={setTab} />
            {toastMsg && <Toast msg={toastMsg} />}
            {transferModal && <TransferModal mode={transferModal} onClose={() => setTransferModal(null)} />}
          </div>
        </LayoutCtx.Provider>
      </BankDataCtx.Provider>
    </AppCtx.Provider>
  );
}

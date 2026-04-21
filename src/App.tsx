import React, { useState, Fragment, useEffect, createContext, useContext } from 'react';

// ─── Design tokens ────────────────────────────────────────────
const gold = '#c9a964';
const goldDark = '#8a6a2f';
const goldLight = '#f4d77a';
const bg = { card: 'rgba(255,255,255,0.04)', border: 'rgba(200,170,100,0.12)' };
const text = { primary: '#f4ebd0', secondary: '#f0e7cc', muted: 'rgba(232,217,168,0.55)', dim: 'rgba(232,217,168,0.45)' };

// ─── Layout context ───────────────────────────────────────────
const LayoutCtx = createContext<'mobile' | 'desktop'>('mobile');
const useLayout = () => useContext(LayoutCtx);

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
type CardVariant = 'gold' | 'emerald' | 'platinum' | 'obsidian';

interface CardData {
  variant: CardVariant;
  number: string;
  name: string;
  expiry: string;
  type?: string;
  status?: string;
  limit?: string;
  used?: string;
}

const CARD_VARIANTS: Record<CardVariant, {
  bg: string; text: string; muted: string; shimmer: string;
}> = {
  gold: {
    bg: 'linear-gradient(135deg, #4a3a1a 0%, #8a6a2f 28%, #d4a84a 50%, #f4d77a 62%, #a07a34 82%, #3a2a10 100%)',
    text: '#1a1208', muted: 'rgba(26,18,8,0.55)',
    shimmer: 'linear-gradient(115deg, transparent 40%, rgba(255,245,210,0.35) 50%, transparent 60%)',
  },
  emerald: {
    bg: 'linear-gradient(135deg, #0a2018 0%, #143028 30%, #1f4238 55%, #2d5e4a 75%, #0a2018 100%)',
    text: '#e8d9a8', muted: 'rgba(232,217,168,0.55)',
    shimmer: 'linear-gradient(115deg, transparent 40%, rgba(200,170,100,0.15) 50%, transparent 60%)',
  },
  platinum: {
    bg: 'linear-gradient(135deg, #3a3f45 0%, #6b7280 30%, #b8bec5 55%, #e5e7eb 65%, #8a9098 85%, #2d3036 100%)',
    text: '#1a1d20', muted: 'rgba(26,29,32,0.55)',
    shimmer: 'linear-gradient(115deg, transparent 40%, rgba(255,255,255,0.4) 50%, transparent 60%)',
  },
  obsidian: {
    bg: 'linear-gradient(135deg, #0a0a0a 0%, #1f1f1f 40%, #2a2a2a 60%, #0a0a0a 100%)',
    text: '#e8d9a8', muted: 'rgba(232,217,168,0.5)',
    shimmer: 'linear-gradient(115deg, transparent 40%, rgba(200,170,100,0.12) 50%, transparent 60%)',
  },
};

function PremiumCard({ variant, number, name, expiry, style = {} }: CardData & { style?: React.CSSProperties }) {
  const v = CARD_VARIANTS[variant] ?? CARD_VARIANTS.gold;
  const patId = `g-${variant}`;
  return (
    <div style={{
      position: 'relative', aspectRatio: '1.586 / 1', borderRadius: 22,
      background: v.bg,
      boxShadow: '0 20px 40px -12px rgba(0,0,0,0.55), 0 6px 16px -8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.18)',
      color: v.text, overflow: 'hidden',
      fontFamily: '"SF Pro Display", -apple-system, system-ui',
      ...style,
    }}>
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity: 0.12, mixBlendMode: 'overlay' }}>
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
            <span style={{ fontSize: 15, fontWeight: 500, letterSpacing: 0.5 }}>
              ARM<span style={{ fontWeight: 300 }}>Bank</span>
            </span>
          </div>
          <span style={{ fontSize: 9, fontWeight: 500, letterSpacing: 2, color: v.muted, textTransform: 'uppercase' }}>Virtual</span>
        </div>
        <div style={{
          fontFamily: '"SF Mono", monospace', fontSize: 20, fontWeight: 600, letterSpacing: 2,
          color: v.text, textShadow: '0 1px 0 rgba(255,255,255,0.25), 0 -1px 0 rgba(0,0,0,0.15)',
          display: 'flex', gap: 14, alignItems: 'center', marginBottom: -8,
        }}>
          <span style={{ color: v.muted }}>••••</span>
          <span style={{ color: v.muted }}>••••</span>
          <span style={{ color: v.muted }}>••••</span>
          <span>{number}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 8, fontWeight: 500, letterSpacing: 1.2, color: v.muted, textTransform: 'uppercase', marginBottom: 3 }}>Cardholder</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: 0.4 }}>{name}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 8, fontWeight: 500, letterSpacing: 1.2, color: v.muted, textTransform: 'uppercase', marginBottom: 3 }}>Valid</div>
              <div style={{ fontSize: 12.5, fontWeight: 600, fontFamily: '"SF Mono", monospace' }}>{expiry}</div>
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
  return layout === 'desktop' ? '28px' : 'env(safe-area-inset-top, 20px)';
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
        {subtitle && <div style={{ fontSize: 11, letterSpacing: 2, color: text.muted, textTransform: 'uppercase', fontWeight: 500, marginBottom: 4 }}>{subtitle}</div>}
        <div style={{ fontSize: 28, fontWeight: 700, color: text.primary, letterSpacing: -0.6 }}>{title}</div>
      </div>
      {children && <div style={{ display: 'flex', gap: 10 }}>{children}</div>}
    </div>
  );
}

// ─── Overview screen ──────────────────────────────────────────
function QuickAction({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
      padding: '14px 6px', background: bg.card, border: `1px solid rgba(200,170,100,0.14)`,
      borderRadius: 18, color: '#e8d9a8', fontFamily: 'inherit', fontSize: 12, fontWeight: 500,
      letterSpacing: 0.1, cursor: 'pointer',
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 12,
        background: `linear-gradient(135deg, ${gold} 0%, ${goldDark} 100%)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `0 4px 10px -4px rgba(201,169,100,0.5), inset 0 1px 0 rgba(255,220,150,0.5)`,
      }}>{icon}</div>
      <span>{label}</span>
    </button>
  );
}

function ActivityRow({ iconBg, iconEl, title, subtitle, amount, positive }: {
  iconBg: string; iconEl: React.ReactNode; title: string; subtitle: string; amount: string; positive?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
      <div style={{
        width: 38, height: 38, borderRadius: 11, background: iconBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        border: `1px solid rgba(200,170,100,0.15)`,
      }}>{iconEl}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: text.secondary, marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 12, color: text.muted }}>{subtitle}</div>
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: positive ? '#7fb896' : text.secondary, fontFeatureSettings: '"tnum"' }}>
        {positive ? '+' : ''}{amount}
      </div>
    </div>
  );
}

const ACTIVITY_ROWS = [
  {
    iconEl: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M6 16l6 6 6-6" stroke="#7fb896" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>,
    iconBg: 'rgba(127,184,150,0.1)', title: 'Надходження • ФОП', subtitle: 'Сьогодні, 14:32', amount: '₴ 84 200,00', positive: true,
  },
  {
    iconEl: <svg width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke={gold} strokeWidth="1.8" /><path d="M8 12h8M12 8v8" stroke={gold} strokeWidth="1.8" strokeLinecap="round" /></svg>,
    iconBg: 'rgba(200,170,100,0.1)', title: 'Сільпо', subtitle: 'Сьогодні, 12:18 • Картка •• 0001', amount: '₴ 1 247,50', positive: false,
  },
  {
    iconEl: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 12h16M4 12l5-5M4 12l5 5" stroke="#e8d9a8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>,
    iconBg: 'rgba(232,217,168,0.08)', title: 'Оплата комунальних', subtitle: 'Вчора, 19:05', amount: '₴ 3 180,00', positive: false,
  },
  {
    iconEl: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 17h14l-2-8H7l-2 8zM7 17v2M17 17v2" stroke="#88a8e8" strokeWidth="1.8" strokeLinecap="round" /></svg>,
    iconBg: 'rgba(136,168,232,0.1)', title: 'Uklon', subtitle: 'Вчора, 09:42 • Apple Pay', amount: '₴ 148,00', positive: false,
  },
];

function BalanceBlock({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 11, letterSpacing: 2, color: text.muted, textTransform: 'uppercase', fontWeight: 500 }}>Загальний баланс</span>
        <button onClick={onToggle} style={{ width: 22, height: 22, borderRadius: '50%', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {visible
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" stroke={text.muted} strokeWidth="1.6" /><circle cx="12" cy="12" r="3" stroke={text.muted} strokeWidth="1.6" /></svg>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.4 5.1A10.9 10.9 0 0112 5c6 0 10 7 10 7a18 18 0 01-3.2 3.9M6.6 6.6A18 18 0 002 12s4 7 10 7a11 11 0 003.4-.5" stroke={text.muted} strokeWidth="1.6" strokeLinecap="round" /></svg>
          }
        </button>
      </div>
      <div style={{ fontFamily: '"SF Pro Display", -apple-system, system-ui', fontSize: 46, fontWeight: 300, letterSpacing: -1.5, color: text.primary, lineHeight: 1, fontFeatureSettings: '"tnum"', display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: 32, fontWeight: 400, color: gold }}>₴</span>
        <span>{visible ? '7 986 232' : '• • • • • • •'}</span>
        <span style={{ fontSize: 24, fontWeight: 400, color: 'rgba(244,235,208,0.5)' }}>,00</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', background: 'rgba(127,184,150,0.12)', border: '1px solid rgba(127,184,150,0.25)', borderRadius: 100, fontSize: 11, color: '#7fb896', fontWeight: 500 }}>
          <svg width="9" height="9" viewBox="0 0 12 12"><path d="M6 2l4 5H2z" fill="#7fb896" /></svg>
          +2.4% цього місяця
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', background: 'rgba(255,255,255,0.04)', border: `1px solid rgba(200,170,100,0.15)`, borderRadius: 100, fontSize: 11, color: 'rgba(232,217,168,0.7)', fontWeight: 500 }}>
          AB-100023
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" /><path d="M5 15V5a2 2 0 012-2h10" stroke="currentColor" strokeWidth="2" /></svg>
        </div>
      </div>
    </div>
  );
}

function ActivityFeed({ title = true }: { title?: boolean }) {
  return (
    <div>
      {title && (
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: text.secondary }}>Остання активність</span>
          <div style={{ flex: 1 }} />
          <button style={{ fontSize: 12, color: gold, background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: 3, fontFamily: 'inherit', fontWeight: 500, cursor: 'pointer' }}>
            Історія <Chevron size={12} color={gold} />
          </button>
        </div>
      )}
      <div style={{ background: bg.card, border: `1px solid ${bg.border}`, borderRadius: 18, overflow: 'hidden' }}>
        {ACTIVITY_ROWS.map((r, i) => (
          <Fragment key={i}>
            <ActivityRow {...r} />
            {i < ACTIVITY_ROWS.length - 1 && <div style={{ height: 1, background: 'rgba(200,170,100,0.08)', margin: '0 16px' }} />}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

const QUICK_ACTIONS: { label: string; icon: React.ReactNode }[] = [
  { label: 'Поповнити', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 19V5M5 12l7-7 7 7" stroke="#1a1208" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  { label: 'На картку', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M12 5l7 7-7 7" stroke="#1a1208" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  { label: 'За IBAN', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 9h18M3 15h18M6 5v14M18 5v14" stroke="#1a1208" strokeWidth="2" strokeLinecap="round" /></svg> },
  { label: 'Маркет', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 7h16l-1.5 11a2 2 0 01-2 1.8h-9a2 2 0 01-2-1.8L4 7zM9 7V5a3 3 0 016 0v2" stroke="#1a1208" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg> },
];

function OverviewScreen() {
  const layout = useLayout();
  const topPad = useTopPad();
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [cardIdx, setCardIdx] = useState(0);
  const cards: CardData[] = [
    { variant: 'gold', number: '0001', name: 'VYACHESLAW MUNISTER', expiry: '03/29' },
    { variant: 'emerald', number: '1183', name: 'VYACHESLAW MUNISTER', expiry: '02/29' },
    { variant: 'platinum', number: '7147', name: 'VYACHESLAW MUNISTER', expiry: '08/28' },
    { variant: 'obsidian', number: '4402', name: 'VYACHESLAW MUNISTER', expiry: '11/30' },
  ];

  const cardSection = (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: text.secondary }}>Мої картки</span>
        <span style={{ fontSize: 11, color: text.dim }}>• {cards.length}</span>
        <div style={{ flex: 1 }} />
        <button style={{ fontSize: 12, color: gold, background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: 3, fontFamily: 'inherit', fontWeight: 500, cursor: 'pointer' }}>
          Усі <Chevron size={12} color={gold} />
        </button>
      </div>
      <div style={{ maxWidth: 380 }}>
        <PremiumCard {...cards[cardIdx]} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-start', gap: 6, marginTop: 14 }}>
        {cards.map((_, i) => (
          <button key={i} onClick={() => setCardIdx(i)} style={{ width: i === cardIdx ? 20 : 6, height: 6, borderRadius: 3, background: i === cardIdx ? gold : 'rgba(200,170,100,0.25)', border: 'none', padding: 0, cursor: 'pointer', transition: 'all 0.25s' }} />
        ))}
      </div>
    </div>
  );

  const quickActionsSection = (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: text.secondary, marginBottom: 12 }}>Швидкі дії</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {QUICK_ACTIONS.map(a => <Fragment key={a.label}><QuickAction icon={a.icon} label={a.label} /></Fragment>)}
      </div>
    </div>
  );

  if (layout === 'desktop') {
    return (
      <div style={{ padding: `${topPad} 32px 48px`, minHeight: '100%' }}>
        {/* Top greeting bar */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 32 }}>
          <div>
            <div style={{ fontSize: 13, color: text.muted, marginBottom: 4 }}>Доброго дня 👋</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: text.primary, letterSpacing: -0.4 }}>Vyacheslaw Munister</div>
          </div>
          <div style={{ flex: 1 }} />
          {[
            <svg key="chat" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 12a8 8 0 01-11.6 7.1L3 21l1.9-6.4A8 8 0 1121 12z" stroke="#e8d9a8" strokeWidth="1.6" strokeLinejoin="round" /></svg>,
            <svg key="bell" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 004 0" stroke="#e8d9a8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>,
          ].map((icon, i) => (
            <button key={i} style={{ width: 40, height: 40, borderRadius: 12, background: bg.card, border: `1px solid ${bg.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', marginLeft: 10 }}>{icon}</button>
          ))}
        </div>

        {/* 2-column grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: 24, alignItems: 'start' }}>
          {/* Left: balance + card + quick actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{ padding: 24, background: bg.card, border: `1px solid ${bg.border}`, borderRadius: 22 }}>
              <BalanceBlock visible={balanceVisible} onToggle={() => setBalanceVisible(v => !v)} />
            </div>
            {cardSection}
            {quickActionsSection}
          </div>
          {/* Right: activity feed */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <ActivityFeed />
            {/* Spending stats mini */}
            <div style={{ padding: 20, background: bg.card, border: `1px solid ${bg.border}`, borderRadius: 22 }}>
              <div style={{ fontSize: 11, letterSpacing: 1.5, color: text.muted, textTransform: 'uppercase', fontWeight: 600, marginBottom: 14 }}>Витрати цього місяця</div>
              {[
                { label: 'Продукти', pct: 38, color: '#e8a864' },
                { label: 'Транспорт', pct: 14, color: '#88a8e8' },
                { label: 'Комунальні', pct: 22, color: gold },
                { label: 'Розваги', pct: 12, color: '#c97db4' },
                { label: 'Інше', pct: 14, color: 'rgba(232,217,168,0.4)' },
              ].map(({ label, pct, color }) => (
                <div key={label} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontSize: 12, color: text.secondary }}>{label}</span>
                    <span style={{ fontSize: 12, color: text.muted, fontFeatureSettings: '"tnum"' }}>{pct}%</span>
                  </div>
                  <div style={{ height: 4, background: 'rgba(200,170,100,0.1)', borderRadius: 4 }}>
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
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: `linear-gradient(135deg, ${gold} 0%, ${goldDark} 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1a2820', fontSize: 13, fontWeight: 700, boxShadow: 'inset 0 1px 0 rgba(255,220,150,0.5), 0 2px 6px rgba(0,0,0,0.3)' }}>VM</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: text.muted, letterSpacing: 0.5, marginBottom: 1 }}>Доброго дня</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Vyacheslaw M.</div>
        </div>
        {[
          <svg key="chat" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 12a8 8 0 01-11.6 7.1L3 21l1.9-6.4A8 8 0 1121 12z" stroke="#e8d9a8" strokeWidth="1.6" strokeLinejoin="round" /></svg>,
          <svg key="bell" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 004 0" stroke="#e8d9a8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>,
        ].map((icon, i) => (
          <button key={i} style={{ width: 36, height: 36, borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: `1px solid rgba(200,170,100,0.12)`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>{icon}</button>
        ))}
      </div>

      <div style={{ padding: '24px 22px 20px' }}>
        <BalanceBlock visible={balanceVisible} onToggle={() => setBalanceVisible(v => !v)} />
      </div>
      <div style={{ padding: '0 22px 4px' }}>{cardSection}</div>
      <div style={{ display: 'flex', gap: 8, padding: '18px 22px 6px' }}>
        {QUICK_ACTIONS.map(a => <Fragment key={a.label}><QuickAction icon={a.icon} label={a.label} /></Fragment>)}
      </div>
      <div style={{ padding: '22px 22px 0' }}><ActivityFeed /></div>
    </div>
  );
}

// ─── Cards screen ─────────────────────────────────────────────
function CardsScreen() {
  const topPad = useTopPad();
  const cards: (CardData & { type: string; status: string; limit: string; used: string })[] = [
    { variant: 'gold', number: '0001', name: 'VYACHESLAW MUNISTER', expiry: '03/29', type: 'Віртуальна', status: 'Активна', limit: '150 000', used: '48 230' },
    { variant: 'emerald', number: '1183', name: 'VYACHESLAW MUNISTER', expiry: '02/29', type: 'Фізична', status: 'Активна', limit: '80 000', used: '12 400' },
    { variant: 'platinum', number: '7147', name: 'VYACHESLAW MUNISTER', expiry: '08/28', type: 'Фізична', status: 'Активна', limit: '500 000', used: '215 800' },
    { variant: 'obsidian', number: '4402', name: 'VYACHESLAW MUNISTER', expiry: '11/30', type: 'Віртуальна', status: 'Заморожена', limit: '50 000', used: '0' },
  ];
  const [selected, setSelected] = useState(0);
  const card = cards[selected];
  const pct = Math.round((parseFloat(card.used.replace(/\s/g, '')) / parseFloat(card.limit.replace(/\s/g, ''))) * 100) || 0;

  return (
    <ContentWrap maxW={760}>
    <div style={{ paddingBottom: 80 }}>
      <div style={{ padding: `${topPad} 22px 16px`, display: 'flex', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 2, color: text.muted, textTransform: 'uppercase', fontWeight: 500, marginBottom: 4 }}>Гаманець</div>
          <div style={{ fontFamily: '"SF Pro Display", -apple-system', fontSize: 32, fontWeight: 600, color: text.primary, letterSpacing: -0.8 }}>Мої картки</div>
        </div>
        <div style={{ flex: 1 }} />
        <button style={{
          padding: '10px 16px', background: `linear-gradient(135deg, ${gold} 0%, ${goldDark} 100%)`,
          color: '#1a1208', border: 'none', borderRadius: 100, fontSize: 13, fontWeight: 600,
          fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
          boxShadow: `0 4px 10px -4px rgba(201,169,100,0.5), inset 0 1px 0 rgba(255,220,150,0.5)`,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="#1a1208" strokeWidth="2.4" strokeLinecap="round" /></svg>
          Випустити
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
              textAlign: 'left', opacity: i === selected ? 1 : 0.55, transition: 'opacity 0.3s',
              filter: i === selected ? 'none' : 'saturate(0.7)',
            }}>
              <PremiumCard {...c} style={{ width: '100%' }} />
            </button>
          </div>
        ))}
      </div>

      {/* Card details */}
      <div style={{ padding: '20px 22px 0' }}>
        <div style={{ background: bg.card, border: `1px solid ${bg.border}`, borderRadius: 22, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <div style={{ fontFamily: '"SF Mono", monospace', fontSize: 16, fontWeight: 600, color: text.primary, letterSpacing: 1 }}>•• {card.number}</div>
            <div style={{
              padding: '3px 8px', borderRadius: 100,
              background: card.status === 'Активна' ? 'rgba(127,184,150,0.15)' : 'rgba(232,217,168,0.1)',
              color: card.status === 'Активна' ? '#7fb896' : 'rgba(232,217,168,0.7)',
              fontSize: 10.5, fontWeight: 600, letterSpacing: 0.3,
            }}>{card.status}</div>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 11, color: text.muted }}>{card.type} • до {card.expiry}</div>
          </div>

          {/* Spending bar */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'baseline' }}>
              <span style={{ fontSize: 11, letterSpacing: 1.2, color: text.muted, textTransform: 'uppercase', fontWeight: 500 }}>Витрачено цього місяця</span>
              <span style={{ fontSize: 12, color: 'rgba(232,217,168,0.6)', fontFeatureSettings: '"tnum"' }}>{pct}%</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 22, fontWeight: 600, color: text.primary, fontFeatureSettings: '"tnum"' }}>₴ {card.used}</span>
              <span style={{ fontSize: 13, color: text.dim, fontFeatureSettings: '"tnum"' }}>/ {card.limit}</span>
            </div>
            <div style={{ height: 6, background: 'rgba(200,170,100,0.12)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{
                width: `${pct}%`, height: '100%',
                background: `linear-gradient(90deg, ${goldDark} 0%, ${gold} 60%, ${goldLight} 100%)`,
                borderRadius: 10,
              }} />
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
            {[
              { label: 'Деталі', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="13" rx="2" stroke={gold} strokeWidth="1.6" /><path d="M3 10h18" stroke={gold} strokeWidth="1.6" /></svg> },
              { label: 'PIN', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="4" y="11" width="16" height="10" rx="2" stroke={gold} strokeWidth="1.6" /><path d="M8 11V8a4 4 0 018 0v3" stroke={gold} strokeWidth="1.6" /></svg> },
              { label: 'Apple Pay', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M17 2a4 4 0 00-3 1.7M7 8a5 5 0 015-5c1.7 0 2.5 1 3 1.7M5 14c0 6 5 8 7 8s7-2 7-8-5-6-7-4c-2-2-7 0-7 4z" stroke={gold} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg> },
              { label: 'Ліміти', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 12a8 8 0 1116 0" stroke={gold} strokeWidth="1.6" strokeLinecap="round" /><path d="M12 12l4-4" stroke={gold} strokeWidth="1.6" strokeLinecap="round" /><circle cx="12" cy="12" r="1.5" fill={gold} /></svg> },
            ].map((a, i) => (
              <button key={i} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                padding: '10px 4px', background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(200,170,100,0.1)', borderRadius: 14,
                color: '#e8d9a8', fontSize: 11, fontFamily: 'inherit', fontWeight: 500, cursor: 'pointer',
              }}>
                {a.icon}{a.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button style={{
              flex: 1, padding: '12px', background: 'rgba(232,168,100,0.08)',
              border: '1px solid rgba(232,168,100,0.2)', borderRadius: 12,
              color: '#e8a864', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="4" y="11" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" /><path d="M8 11V8a4 4 0 018 0v3" stroke="currentColor" strokeWidth="1.8" /></svg>
              Заморозити
            </button>
            <button style={{
              flex: 1, padding: '12px', background: 'rgba(220,100,110,0.06)',
              border: '1px solid rgba(220,100,110,0.2)', borderRadius: 12,
              color: '#dc646e', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              Закрити
            </button>
          </div>
        </div>
      </div>
    </div>
    </ContentWrap>
  );
}

// ─── Operations screen ────────────────────────────────────────
type TxCat = 'income' | 'food' | 'transport' | 'utility' | 'shopping' | 'transfer' | 'subscription';

const CAT_STYLES: Record<TxCat, { bg: string; color: string; icon: React.ReactNode }> = {
  income:       { bg: 'rgba(127,184,150,0.12)', color: '#7fb896', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M6 16l6 6 6-6" stroke="#7fb896" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  food:         { bg: 'rgba(232,168,100,0.12)', color: '#e8a864', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 2v8a3 3 0 006 0V2M9 2v6M18 2c-2 0-3 2-3 5s1 5 3 5v8" stroke="#e8a864" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  transport:    { bg: 'rgba(136,168,232,0.12)', color: '#88a8e8', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 17h14l-2-8H7l-2 8zM7 17v2M17 17v2M9 9V6a3 3 0 016 0v3" stroke="#88a8e8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  utility:      { bg: 'rgba(200,170,100,0.12)', color: gold, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2L4 7v6c0 5 4 8 8 9 4-1 8-4 8-9V7l-8-5zM12 8v4l3 2" stroke={gold} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  shopping:     { bg: 'rgba(201,125,180,0.12)', color: '#c97db4', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 7h16l-1.5 11a2 2 0 01-2 1.8h-9a2 2 0 01-2-1.8L4 7zM9 7V5a3 3 0 016 0v2" stroke="#c97db4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  transfer:     { bg: 'rgba(232,217,168,0.1)', color: '#e8d9a8', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M7 17l-4-4 4-4M3 13h13M17 7l4 4-4 4M21 11H8" stroke="#e8d9a8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  subscription: { bg: 'rgba(120,200,180,0.12)', color: '#78c8b4', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 12a9 9 0 0115-6.7L21 8M21 3v5h-5M21 12a9 9 0 01-15 6.7L3 16M3 21v-5h5" stroke="#78c8b4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> },
};

function OperationsScreen() {
  const topPad = useTopPad();
  const days = ['П', 'В', 'С', 'Ч', 'П', 'С', 'Н'];
  const values = [28, 45, 62, 30, 88, 54, 70];
  const max = Math.max(...values);

  const txGroups: { group: string; items: { title: string; subtitle: string; amount: string; positive?: boolean; cat: TxCat }[] }[] = [
    { group: 'Сьогодні', items: [
      { title: 'Надходження • ФОП', subtitle: '14:32', amount: '+84 200,00', positive: true, cat: 'income' },
      { title: 'Сільпо', subtitle: '12:18 • Картка •• 0001', amount: '-1 247,50', cat: 'food' },
      { title: 'Uklon', subtitle: '09:42 • Apple Pay', amount: '-148,00', cat: 'transport' },
    ]},
    { group: 'Вчора, 19 квітня', items: [
      { title: 'Комунальні послуги', subtitle: 'Київенерго', amount: '-3 180,00', cat: 'utility' },
      { title: 'Rozetka', subtitle: 'Покупки онлайн', amount: '-6 420,00', cat: 'shopping' },
      { title: 'Starbucks', subtitle: 'Apple Pay', amount: '-185,00', cat: 'food' },
    ]},
    { group: '17 квітня', items: [
      { title: 'Переказ на картку', subtitle: '•• 1183', amount: '-10 000,00', cat: 'transfer' },
      { title: 'Spotify', subtitle: 'Підписка', amount: '-199,00', cat: 'subscription' },
    ]},
  ];

  return (
    <ContentWrap maxW={720}>
    <div style={{ paddingBottom: 80 }}>
      <div style={{ padding: `${topPad} 22px 20px` }}>
        <div style={{ fontSize: 11, letterSpacing: 2, color: text.muted, textTransform: 'uppercase', fontWeight: 500, marginBottom: 4 }}>Фінансовий пульс</div>
        <div style={{ fontFamily: '"SF Pro Display", -apple-system', fontSize: 32, fontWeight: 600, color: text.primary, letterSpacing: -0.8 }}>Операції</div>
      </div>

      {/* Chart */}
      <div style={{ padding: '0 22px 18px' }}>
        <div style={{ padding: 20, background: bg.card, border: `1px solid ${bg.border}`, borderRadius: 22 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: 1.2, color: text.muted, textTransform: 'uppercase', fontWeight: 500, marginBottom: 4 }}>Витрати за тиждень</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 26, fontWeight: 600, color: text.primary, fontFeatureSettings: '"tnum"' }}>₴ 42 380</span>
                <span style={{ fontSize: 12, color: '#7fb896' }}>-8.4%</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4, padding: 3, background: 'rgba(26,40,32,0.5)', borderRadius: 100 }}>
              {['Т', 'М', 'Р'].map((p, i) => (
                <button key={p} style={{
                  padding: '4px 11px', fontSize: 11, fontWeight: 500,
                  background: i === 0 ? `linear-gradient(135deg, ${gold}, ${goldDark})` : 'transparent',
                  color: i === 0 ? '#1a1208' : 'rgba(232,217,168,0.6)',
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
                  background: i === 4
                    ? `linear-gradient(180deg, ${goldLight} 0%, ${gold} 50%, ${goldDark} 100%)`
                    : 'linear-gradient(180deg, rgba(200,170,100,0.35) 0%, rgba(138,106,47,0.15) 100%)',
                  borderRadius: 6,
                  boxShadow: i === 4 ? '0 0 20px rgba(201,169,100,0.4)' : 'none',
                }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {days.map((d, i) => (
              <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: i === 4 ? gold : 'rgba(232,217,168,0.4)', fontWeight: i === 4 ? 600 : 400 }}>{d}</div>
            ))}
          </div>
        </div>
      </div>

      {/* Transactions */}
      {txGroups.map((g, gi) => (
        <div key={gi} style={{ padding: '4px 22px 12px' }}>
          <div style={{ fontSize: 11, letterSpacing: 1.5, color: 'rgba(232,217,168,0.5)', textTransform: 'uppercase', fontWeight: 600, padding: '0 6px 8px' }}>{g.group}</div>
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
                      <div style={{ fontSize: 14, fontWeight: 500, color: text.secondary, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</div>
                      <div style={{ fontSize: 11.5, color: text.muted }}>{t.subtitle}</div>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: t.positive ? '#7fb896' : text.secondary, fontFeatureSettings: '"tnum"' }}>{t.amount} ₴</div>
                  </div>
                  {i < g.items.length - 1 && <div style={{ height: 1, background: 'rgba(200,170,100,0.08)', margin: '0 16px 0 64px' }} />}
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
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', gap: 12 }}>
        <span style={{ fontSize: 12, letterSpacing: 1, color: text.muted, textTransform: 'uppercase', fontWeight: 500 }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{
            fontSize: 14, color: text.secondary, fontWeight: 500,
            fontFamily: mono ? '"SF Mono", monospace' : 'inherit',
            fontFeatureSettings: '"tnum"', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{value}</span>
          {copyable && (
            <button style={{
              width: 26, height: 26, borderRadius: 7, background: `rgba(200,170,100,0.1)`,
              border: `1px solid rgba(200,170,100,0.2)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, flexShrink: 0,
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke={gold} strokeWidth="2" /><path d="M5 15V5a2 2 0 012-2h10" stroke={gold} strokeWidth="2" /></svg>
            </button>
          )}
        </div>
      </div>
      {!last && <div style={{ height: 1, background: 'rgba(200,170,100,0.08)', margin: '0 18px' }} />}
    </>
  );
}

function ProfileToggle({ label, sub, on, onChange, icon }: { label: string; sub?: string; on: boolean; onChange: (v: boolean) => void; icon: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px' }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10, background: 'rgba(200,170,100,0.1)',
        border: `1px solid rgba(200,170,100,0.18)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, color: text.secondary, fontWeight: 500, marginBottom: 2 }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: text.muted }}>{sub}</div>}
      </div>
      <button onClick={() => onChange(!on)} style={{
        width: 44, height: 26, borderRadius: 100,
        background: on ? `linear-gradient(135deg, ${goldDark}, ${gold})` : 'rgba(200,170,100,0.15)',
        border: 'none', padding: 0, cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
        boxShadow: on ? 'inset 0 1px 0 rgba(255,220,150,0.4)' : 'none',
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
  const [faceid, setFaceid] = useState(true);
  const [push, setPush] = useState(true);
  const [twofa, setTwofa] = useState(false);

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
          boxShadow: `0 0 0 3px rgba(0,0,0,0.6), 0 0 0 5px ${gold}55, inset 0 1px 0 rgba(255,220,150,0.5)`,
          marginBottom: 14,
        }}>VM</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: text.primary, letterSpacing: -0.3, marginBottom: 4 }}>Vyacheslaw Munister</div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', background: 'rgba(127,184,150,0.12)', border: '1px solid rgba(127,184,150,0.25)', borderRadius: 100 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#7fb896' }} />
          <span style={{ fontSize: 11.5, color: '#7fb896', fontWeight: 500 }}>Верифікований</span>
        </div>
      </div>

      {/* Account info */}
      {section(<>
        <ProfileRow label="Ім'я" value="Vyacheslaw Munister" />
        <ProfileRow label="Телефон" value="+380 96 ••• •• 47" mono />
        <ProfileRow label="IBAN" value="UA 213223130000026007233566001" mono copyable />
        <ProfileRow label="Рахунок" value="AB-100023" mono copyable last />
      </>)}

      {/* Security */}
      <div style={{ padding: '4px 22px 8px' }}>
        <div style={{ fontSize: 11, letterSpacing: 1.5, color: 'rgba(232,217,168,0.45)', textTransform: 'uppercase', fontWeight: 600, padding: '0 6px 8px' }}>Безпека</div>
      </div>
      {section(<>
        <ProfileToggle label="Face ID" sub="Вхід і підтвердження" on={faceid} onChange={setFaceid}
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1.5" stroke={gold} strokeWidth="1.6" /><rect x="14" y="3" width="7" height="7" rx="1.5" stroke={gold} strokeWidth="1.6" /><rect x="3" y="14" width="7" height="7" rx="1.5" stroke={gold} strokeWidth="1.6" /><rect x="14" y="14" width="7" height="7" rx="1.5" stroke={gold} strokeWidth="1.6" /></svg>}
        />
        <div style={{ height: 1, background: 'rgba(200,170,100,0.08)', margin: '0 18px' }} />
        <ProfileToggle label="Push-сповіщення" on={push} onChange={setPush}
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 004 0" stroke={gold} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        />
        <div style={{ height: 1, background: 'rgba(200,170,100,0.08)', margin: '0 18px' }} />
        <ProfileToggle label="2FA" sub="Підтвердження за SMS" on={twofa} onChange={setTwofa}
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="4" y="11" width="16" height="10" rx="2" stroke={gold} strokeWidth="1.6" /><path d="M8 11V8a4 4 0 018 0v3" stroke={gold} strokeWidth="1.6" /></svg>}
        />
      </>)}

      {/* Sign out */}
      <div style={{ padding: '8px 22px' }}>
        <button style={{
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
type TabKey = 'overview' | 'operations' | 'cards' | 'profile';

const TABS: { k: TabKey; label: string; icon: (c: string) => React.ReactNode }[] = [
  { k: 'overview', label: 'Огляд', icon: c => <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7.5" height="7.5" rx="2" stroke={c} strokeWidth="1.8" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" stroke={c} strokeWidth="1.8" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" stroke={c} strokeWidth="1.8" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" stroke={c} strokeWidth="1.8" /></svg> },
  { k: 'operations', label: 'Операції', icon: c => <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3 12h3l3-8 4 16 3-8h5" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  { k: 'cards', label: 'Картки', icon: c => <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="2.5" y="5" width="19" height="14" rx="2.5" stroke={c} strokeWidth="1.8" /><path d="M2.5 10h19" stroke={c} strokeWidth="1.8" /></svg> },
  { k: 'profile', label: 'Профіль', icon: c => <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke={c} strokeWidth="1.8" /><path d="M4 21a8 8 0 0116 0" stroke={c} strokeWidth="1.8" strokeLinecap="round" /></svg> },
];

function TabBar({ active, onChange }: { active: TabKey; onChange: (k: TabKey) => void }) {
  const activeIdx = TABS.findIndex(t => t.k === active);
  return (
    <div style={{ position: 'absolute', bottom: 18, left: 14, right: 14, zIndex: 40 }}>
      <div style={{
        position: 'relative', padding: 6,
        background: 'rgba(15,32,26,0.75)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        border: `1px solid rgba(200,170,100,0.22)`,
        borderRadius: 28, display: 'flex',
        boxShadow: '0 20px 40px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,220,150,0.08)',
      }}>
        {/* Sliding indicator */}
        <div style={{
          position: 'absolute', top: 6, bottom: 6,
          left: `calc(${activeIdx * 25}% + 6px)`, width: 'calc(25% - 12px)',
          background: 'linear-gradient(135deg, rgba(201,169,100,0.22) 0%, rgba(138,106,47,0.12) 100%)',
          border: `1px solid rgba(200,170,100,0.35)`, borderRadius: 22,
          transition: 'left 0.32s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: 'inset 0 1px 0 rgba(255,220,150,0.15)',
        }} />
        {TABS.map(t => {
          const isActive = t.k === active;
          const color = isActive ? goldLight : 'rgba(232,217,168,0.5)';
          return (
            <button key={t.k} onClick={() => onChange(t.k)} style={{
              flex: 1, padding: '10px 4px', background: 'transparent', border: 'none', cursor: 'pointer',
              position: 'relative', zIndex: 1,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              color, fontSize: 10.5, fontWeight: isActive ? 600 : 500,
              letterSpacing: 0.1, fontFamily: 'inherit', transition: 'color 0.2s',
            }}>
              {t.icon(color)}
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Desktop sidebar ──────────────────────────────────────────
function DesktopSidebar({ active, onChange }: { active: TabKey; onChange: (k: TabKey) => void }) {
  return (
    <div style={{
      width: 260, flexShrink: 0,
      display: 'flex', flexDirection: 'column',
      borderRight: '1px solid rgba(200,170,100,0.12)',
      background: 'rgba(8,22,16,0.6)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
    }}>
      {/* Logo */}
      <div style={{ padding: '32px 24px 28px', borderBottom: '1px solid rgba(200,170,100,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 11,
            background: `linear-gradient(135deg, ${gold} 0%, ${goldDark} 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 4px 12px rgba(201,169,100,0.3), inset 0 1px 0 rgba(255,220,150,0.5)`,
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24">
              <path d="M12 2L3 20h3.5l1.8-4h7.4l1.8 4H21L12 2zm-2.6 11L12 7.3 14.6 13H9.4z" fill="#1a1208" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: text.primary, letterSpacing: -0.3 }}>
              ARM<span style={{ fontWeight: 300 }}>Bank</span>
            </div>
            <div style={{ fontSize: 10.5, color: text.muted, letterSpacing: 0.5 }}>Особистий кабінет</div>
          </div>
        </div>
      </div>

      {/* User */}
      <div style={{ padding: '20px 24px 20px', borderBottom: '1px solid rgba(200,170,100,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: `linear-gradient(135deg, ${gold} 0%, ${goldDark} 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700, color: '#1a2820',
            boxShadow: `0 0 0 2px rgba(0,0,0,0.5), 0 0 0 4px ${gold}44`,
          }}>VM</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: text.primary, marginBottom: 2 }}>Vyacheslaw M.</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#7fb896' }} />
              <span style={{ fontSize: 11, color: '#7fb896' }}>Верифікований</span>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {TABS.map(t => {
          const isActive = t.k === active;
          return (
            <button key={t.k} onClick={() => onChange(t.k)} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '11px 14px', borderRadius: 14,
              background: isActive ? 'linear-gradient(135deg, rgba(201,169,100,0.18) 0%, rgba(138,106,47,0.1) 100%)' : 'transparent',
              border: isActive ? `1px solid rgba(200,170,100,0.28)` : '1px solid transparent',
              color: isActive ? goldLight : 'rgba(232,217,168,0.55)',
              fontFamily: 'inherit', fontSize: 14, fontWeight: isActive ? 600 : 500,
              cursor: 'pointer', transition: 'all 0.18s', textAlign: 'left',
              boxShadow: isActive ? 'inset 0 1px 0 rgba(255,220,150,0.1)' : 'none',
            }}>
              {t.icon(isActive ? goldLight : 'rgba(232,217,168,0.5)')}
              {t.label}
            </button>
          );
        })}
      </nav>

      {/* Balance summary */}
      <div style={{ padding: '16px 20px', margin: '0 12px 12px', borderRadius: 16, background: bg.card, border: `1px solid ${bg.border}` }}>
        <div style={{ fontSize: 10, letterSpacing: 1.5, color: text.muted, textTransform: 'uppercase', fontWeight: 500, marginBottom: 8 }}>Загальний баланс</div>
        <div style={{ fontSize: 22, fontWeight: 300, color: text.primary, letterSpacing: -0.8, fontFeatureSettings: '"tnum"' }}>
          <span style={{ fontSize: 14, color: gold, fontWeight: 400 }}>₴ </span>7 986 232
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6 }}>
          <svg width="8" height="8" viewBox="0 0 12 12"><path d="M6 2l4 5H2z" fill="#7fb896" /></svg>
          <span style={{ fontSize: 11, color: '#7fb896', fontWeight: 500 }}>+2.4% цього місяця</span>
        </div>
      </div>

      {/* Logout */}
      <div style={{ padding: '0 12px 24px' }}>
        <button style={{
          width: '100%', padding: '11px', borderRadius: 12,
          background: 'transparent', border: '1px solid rgba(220,100,110,0.18)',
          color: 'rgba(220,100,110,0.7)', fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          transition: 'all 0.18s',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M17 16l4-4-4-4M21 12H9M13 4a9 9 0 100 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Вийти
        </button>
      </div>
    </div>
  );
}

// ─── Root app ─────────────────────────────────────────────────
const SCREENS = { overview: OverviewScreen, operations: OperationsScreen, cards: CardsScreen, profile: ProfileScreen };

const appBg = 'radial-gradient(ellipse 80% 60% at 20% 0%, #1a3a2c 0%, transparent 60%), radial-gradient(ellipse 70% 50% at 90% 100%, #2a1a0e 0%, transparent 55%), linear-gradient(180deg, #0a1f18 0%, #07150f 100%)';

const appBase: React.CSSProperties = {
  position: 'fixed', inset: 0,
  background: appBg,
  color: '#e8d9a8',
  fontFamily: "'Manrope', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
  WebkitFontSmoothing: 'antialiased',
};

// ─── Login screen ─────────────────────────────────────────────
function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPass, setShowPass] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: identity.trim(), password }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.message || 'Невірні дані');
      localStorage.setItem('army_bank_token', json.data.token);
      onLogin();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Помилка входу');
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '14px 16px', background: 'rgba(255,255,255,0.05)',
    border: `1px solid ${bg.border}`, borderRadius: 12, color: text.primary,
    fontSize: 15, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 12, color: text.muted, marginBottom: 6, letterSpacing: '0.04em',
  };

  return (
    <div style={{ ...appBase, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            width: 64, height: 64, borderRadius: 18, margin: '0 auto 16px',
            background: 'linear-gradient(135deg, #4a3a1a, #d4a84a)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, fontWeight: 700, color: '#1a1208', letterSpacing: '-0.02em',
          }}>AB</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: text.primary, letterSpacing: '-0.02em' }}>ARM Bank</div>
          <div style={{ fontSize: 14, color: text.muted, marginTop: 4 }}>Ваші фінанси під контролем</div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{
            background: 'rgba(255,255,255,0.03)', border: `1px solid ${bg.border}`,
            borderRadius: 20, padding: 28,
          }}>
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Телефон або Email</label>
              <input
                style={inputStyle}
                type="text"
                value={identity}
                onChange={e => setIdentity(e.target.value)}
                placeholder="+380..."
                autoComplete="username"
                required
              />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={labelStyle}>Пароль</label>
              <div style={{ position: 'relative' }}>
                <input
                  style={{ ...inputStyle, paddingRight: 44 }}
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  style={{
                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', color: text.muted, padding: 4,
                  }}
                >{showPass ? '🙈' : '👁'}</button>
              </div>
            </div>

            {error && (
              <div style={{
                marginBottom: 16, padding: '10px 14px', background: 'rgba(200,60,60,0.12)',
                border: '1px solid rgba(200,60,60,0.25)', borderRadius: 10,
                color: '#f08080', fontSize: 13,
              }}>{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: '14px', borderRadius: 12, border: 'none',
                background: loading ? 'rgba(180,140,60,0.4)' : 'linear-gradient(135deg, #8a6a2f, #d4a84a)',
                color: '#1a1208', fontSize: 15, fontWeight: 700, cursor: loading ? 'default' : 'pointer',
                fontFamily: 'inherit', letterSpacing: '0.01em',
              }}
            >{loading ? 'Вхід...' : 'Увійти'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── App root ─────────────────────────────────────────────────
export default function App() {
  const [authed, setAuthed] = useState(() => !!localStorage.getItem('army_bank_token'));
  const [tab, setTab] = useState<TabKey>('overview');
  const width = useWindowWidth();
  const isDesktop = width >= 768;
  const Screen = SCREENS[tab];

  if (!authed) {
    return <LoginScreen onLogin={() => setAuthed(true)} />;
  }

  if (isDesktop) {
    return (
      <LayoutCtx.Provider value="desktop">
        <div style={{ ...appBase, display: 'flex' }}>
          <DesktopSidebar active={tab} onChange={setTab} />
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
            <Screen />
          </div>
        </div>
      </LayoutCtx.Provider>
    );
  }

  return (
    <LayoutCtx.Provider value="mobile">
      <div style={{ ...appBase, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', overflowX: 'hidden', paddingBottom: 100 }}>
          <Screen />
        </div>
        <TabBar active={tab} onChange={setTab} />
      </div>
    </LayoutCtx.Provider>
  );
}

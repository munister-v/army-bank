"""Fuzzy Fraud Detection Engine — Army Bank.

Архітектура:
  FM               — fuzzy membership functions (sigmoid, gaussian, trapezoid, decay, zscore)
  RiskResult       — акумулятор: адитивний скор + Noisy-OR confidence + кореляційний бонус
  22 правила       — velocity, amount, graph, entropy, quartile, propagation, ...
  FraudEngine      — оркестратор: cheap → medium → expensive + early-exit at CRITICAL

Noisy-OR комбінування (фінальний скор):
  Кожне правило передає belief mass p∈[0,1].
  Combined = 1 − ∏(1 − pᵢ)   (незалежні свідчення не "переповнюють" 100).
  Фінальний score = round(max(additive_raw, noisy_or) * 100).
"""
from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from typing import Optional

from ..database import get_connection
from ..config import USE_PG


def _cutoff(days: int = 0, hours: int = 0, minutes: int = 0) -> str:
    """Return ISO-8601 UTC timestamp for N units ago. Use as %s parameter in SQL.
    Works with both PostgreSQL (timestamptz comparison) and SQLite (text comparison)."""
    return (datetime.now(timezone.utc) - timedelta(days=days, hours=hours, minutes=minutes)).isoformat()


def _hours_since(ts_value) -> float:
    """Convert a created_at column value (PG datetime or SQLite ISO string) to hours ago."""
    if ts_value is None:
        return float('inf')
    try:
        if isinstance(ts_value, datetime):
            dt = ts_value if ts_value.tzinfo else ts_value.replace(tzinfo=timezone.utc)
        else:
            s = str(ts_value).replace(' ', 'T')
            if s.endswith('+00:00') or 'Z' in s or '+' in s[10:]:
                dt = datetime.fromisoformat(s.replace('Z', '+00:00'))
            else:
                dt = datetime.fromisoformat(s).replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - dt).total_seconds() / 3600
    except Exception:
        return float('inf')


def _days_since(ts_value) -> float:
    return _hours_since(ts_value) / 24


def _ts_epoch(ts_value) -> float:
    """Convert created_at to Unix epoch float."""
    try:
        if isinstance(ts_value, (int, float)):
            return float(ts_value)
        if isinstance(ts_value, datetime):
            dt = ts_value if ts_value.tzinfo else ts_value.replace(tzinfo=timezone.utc)
            return dt.timestamp()
        s = str(ts_value).replace(' ', 'T').replace('Z', '+00:00')
        return datetime.fromisoformat(s).timestamp()
    except Exception:
        return 0.0


def _hour_now_utc() -> int:
    return datetime.now(timezone.utc).hour


# ══ Рівні ризику ═════════════════════════════════════════════════════════════

RISK_LOW      = 'low'       # 0–25
RISK_MEDIUM   = 'medium'    # 26–50
RISK_HIGH     = 'high'      # 51–75
RISK_CRITICAL = 'critical'  # 76+

_LEVEL_THRESH = ((76, RISK_CRITICAL), (51, RISK_HIGH), (26, RISK_MEDIUM))


# ══ Результат оцінки ═════════════════════════════════════════════════════════

@dataclass
class RiskResult:
    """Акумулятор ризику з двома методами комбінування:

    1. Адитивний (backward-compat): result.add(delta, flag)
    2. Noisy-OR evidence: result.add_belief(prob, flag)
       Після всіх правил — result.finalize() вибирає максимум обох методів.
    """
    score: int = 0
    level: str = RISK_LOW
    flags: list[str] = field(default_factory=list)
    details: dict = field(default_factory=dict)
    confidence: float = field(default=1.0)   # знижується при малій кількості даних
    _rule_hits: int = field(default=0, repr=False)
    _beliefs: list[float] = field(default_factory=list, repr=False)  # Noisy-OR masses

    # ── Адитивне накопичення ──────────────────────────────────────────────────

    def add(self, delta: int, flag: str, **kw) -> None:
        """Адитивний внесок. Внесок одного правила обмежено 70 балами."""
        if delta <= 0:
            return
        capped = min(delta, 70)
        self.score = min(100, self.score + capped)
        self._rule_hits += 1
        self.flags.append(flag)
        self.details.update(kw)
        self.level = self._calc_level()
        # Синхронізуємо belief list для Noisy-OR
        self._beliefs.append(capped / 100.0)

    # ── Noisy-OR evidence ─────────────────────────────────────────────────────

    def add_belief(self, prob: float, flag: str, **kw) -> None:
        """Додає незалежне свідчення з вірогідністю prob ∈ [0,1]."""
        if prob <= 0:
            return
        prob = min(prob, 0.99)
        self._beliefs.append(prob)
        self._rule_hits += 1
        self.flags.append(flag)
        self.details.update(kw)
        # Перераховуємо Noisy-OR score
        noisy_or = 1.0 - math.prod(1.0 - p for p in self._beliefs)
        self.score = round(noisy_or * 100)
        self.level = self._calc_level()

    # ── Фіналізація ───────────────────────────────────────────────────────────

    def finalize(self) -> None:
        """Застосовує кореляційний бонус та нормалізує фінальний скор."""
        self.apply_correlation_bonus()
        self.score = min(100, round(self.score * self.confidence))
        self.level = self._calc_level()

    def _calc_level(self) -> str:
        for thresh, lvl in _LEVEL_THRESH:
            if self.score >= thresh:
                return lvl
        return RISK_LOW

    @property
    def is_critical(self) -> bool:
        return self.level == RISK_CRITICAL

    def apply_correlation_bonus(self) -> None:
        """Зважений кореляційний бонус за одночасне спрацювання.

        ≥3 правил → +10   (multi_rule_correlation)
        ≥5 правил → +20   (multi_rule_correlation_strong)
        ≥7 правил → +35   (multi_rule_correlation_chain)

        Бонус зважується середньою силою спрацьованих правил.
        """
        if not self._beliefs or self._rule_hits < 3:
            return
        avg_belief = sum(self._beliefs) / len(self._beliefs)

        if self._rule_hits >= 7:
            bonus = round(35 * avg_belief)
            self.score = min(100, self.score + bonus)
            self.flags.append('multi_rule_correlation_chain')
        elif self._rule_hits >= 5:
            bonus = round(20 * avg_belief)
            self.score = min(100, self.score + bonus)
            self.flags.append('multi_rule_correlation_strong')
        else:
            bonus = round(10 * avg_belief)
            self.score = min(100, self.score + bonus)
            self.flags.append('multi_rule_correlation')

    def to_dict(self) -> dict:
        return {
            'score': self.score,
            'level': self.level,
            'flags': self.flags,
            'details': self.details,
            'confidence': round(self.confidence, 3),
        }


# ══ Fuzzy Membership functions ════════════════════════════════════════════════

class FM:

    @staticmethod
    def sigmoid(x: float, center: float, slope: float = 5.0) -> float:
        denom = center * 0.15 + 1e-9
        return 1.0 / (1.0 + math.exp(-slope * (x - center) / denom))

    @staticmethod
    def gaussian(x: float, center: float, sigma: float) -> float:
        if sigma <= 0:
            return 1.0 if abs(x - center) < 1e-9 else 0.0
        return math.exp(-0.5 * ((x - center) / sigma) ** 2)

    @staticmethod
    def trapezoid(x: float, a: float, b: float, c: float, d: float) -> float:
        if x <= a or x >= d:
            return 0.0
        if b <= x <= c:
            return 1.0
        return (x - a) / (b - a + 1e-12) if x < b else (d - x) / (d - c + 1e-12)

    @staticmethod
    def decay(age_minutes: float, half_life: float = 60.0) -> float:
        return math.exp(-math.log(2) * age_minutes / (half_life + 1e-9))

    @staticmethod
    def zscore(value: float, mean: float, std: float) -> float:
        return (value - mean) / (std + 1e-9) if std > 0.01 else 0.0


# ══ Правила ══════════════════════════════════════════════════════════════════

class VelocityRule:
    """Burst (5 хв) + sustained (1 год) velocity."""

    def evaluate(self, account_id: int, result: RiskResult) -> None:
        with get_connection() as conn:
            r5  = conn.execute(
                "SELECT COUNT(*) AS cnt FROM transactions"
                " WHERE account_id=%s AND direction='out'"
                "   AND created_at >= %s",
                (account_id, _cutoff(minutes=5))
            ).fetchone()
            r60 = conn.execute(
                "SELECT COUNT(*) AS cnt FROM transactions"
                " WHERE account_id=%s AND direction='out'"
                "   AND created_at >= %s",
                (account_id, _cutoff(minutes=60))
            ).fetchone()
        burst = int(r5['cnt']  if r5  else 0)
        hour  = int(r60['cnt'] if r60 else 0)

        if burst >= 8:
            result.add(int(60 * FM.sigmoid(burst, 8, 6.0)), 'velocity_burst', burst_5m=burst)
        elif burst >= 4:
            result.add(int(28 * FM.sigmoid(burst, 4, 5.0)), 'velocity_elevated', burst_5m=burst)
        if hour >= 20:
            result.add(int(35 * FM.sigmoid(hour, 20, 4.0)), 'velocity_sustained_hour', hour_count=hour)


class FrequencyEscalationRule:
    """Поточна годинна частота vs 30-денний базис."""

    LOOKBACK_DAYS = 30

    def evaluate(self, account_id: int, result: RiskResult) -> None:
        with get_connection() as conn:
            baseline = conn.execute(
                "SELECT COUNT(*) AS cnt FROM transactions"
                " WHERE account_id=%s AND direction='out'"
                "   AND created_at >= %s"
                "   AND created_at <  %s",
                (account_id, _cutoff(days=self.LOOKBACK_DAYS), _cutoff(hours=1))
            ).fetchone()
            current = conn.execute(
                "SELECT COUNT(*) AS cnt FROM transactions"
                " WHERE account_id=%s AND direction='out'"
                "   AND created_at >= %s",
                (account_id, _cutoff(hours=1))
            ).fetchone()
        total_past = int(baseline['cnt'] if baseline else 0)
        hourly_avg = total_past / (self.LOOKBACK_DAYS * 24) if total_past > 0 else 0
        current_hz = int(current['cnt'] if current else 0)

        if hourly_avg < 0.05 and current_hz >= 3:
            result.add(30, 'freq_escalation_inactive',
                       hourly_avg=round(hourly_avg, 3), current_hour=current_hz)
        elif hourly_avg > 0.05:
            ratio = current_hz / (hourly_avg + 1e-9)
            if ratio >= 8:
                result.add(int(38 * FM.sigmoid(ratio, 8, 4.0)),
                           'freq_escalation_spike',
                           hourly_avg=round(hourly_avg, 3),
                           current_hour=current_hz, ratio=round(ratio, 1))


class HighAmountRule:
    """Z-score + ratio anomaly (з fallback до IQR якщо stddev = 0)."""

    LOOKBACK_DAYS = 30

    def evaluate(self, account_id: int, amount: float, result: RiskResult) -> None:
        with get_connection() as conn:
            if USE_PG:
                row = conn.execute(
                    "SELECT COALESCE(AVG(amount),0)    AS avg_a,"
                    "       COALESCE(STDDEV(amount),0) AS std_a,"
                    "       COUNT(*)                   AS cnt,"
                    "       COALESCE(MAX(amount),0)    AS max_a"
                    " FROM transactions"
                    " WHERE account_id=%s AND direction='out'"
                    "   AND created_at >= %s",
                    (account_id, _cutoff(days=self.LOOKBACK_DAYS))
                ).fetchone()
                if not row or int(row['cnt']) < 3:
                    return
                avg, std, max_a = float(row['avg_a']), float(row['std_a']), float(row['max_a'])
            else:
                rows = conn.execute(
                    "SELECT amount FROM transactions"
                    " WHERE account_id=%s AND direction='out'"
                    "   AND created_at >= %s",
                    (account_id, _cutoff(days=self.LOOKBACK_DAYS))
                ).fetchall()
                if not rows or len(rows) < 3:
                    return
                amounts_list = [float(r['amount']) for r in rows]
                avg = sum(amounts_list) / len(amounts_list)
                max_a = max(amounts_list)
                variance = sum((a - avg) ** 2 for a in amounts_list) / len(amounts_list)
                std = math.sqrt(variance)
        if avg < 1:
            return
        ratio = amount / avg
        zsc   = FM.zscore(amount, avg, std)

        if ratio >= 15 or zsc >= 5:
            result.add(int(50 * FM.sigmoid(max(ratio / 15, zsc / 5), 1.0, 5.0)),
                       'amount_extreme', amount=amount, avg=round(avg, 2),
                       ratio=round(ratio, 2), z=round(zsc, 2))
        elif ratio >= 5 or zsc >= 3:
            result.add(int(28 * FM.sigmoid(max(ratio / 5, zsc / 3), 1.0, 4.0)),
                       'amount_high', amount=amount, avg=round(avg, 2),
                       ratio=round(ratio, 2), z=round(zsc, 2))
        elif ratio >= 2 and amount > max_a * 1.5:
            result.add(12, 'amount_new_personal_max',
                       amount=amount, prev_max=round(max_a, 2))


class AdaptiveQuartileRule:
    """IQR-based (Tukey) виявлення аномалій — стійкіше за mean+std
    для важкохвостих розподілів транзакційних сум.

    Extreme outlier fence: Q3 + 3.0 × IQR
    Mild outlier fence:    Q3 + 1.5 × IQR
    """

    LOOKBACK_DAYS = 60

    def evaluate(self, account_id: int, amount: float, result: RiskResult) -> None:
        with get_connection() as conn:
            if USE_PG:
                row = conn.execute(
                    "SELECT"
                    "  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY amount) AS p25,"
                    "  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY amount) AS p75,"
                    "  COUNT(*) AS cnt"
                    " FROM transactions"
                    " WHERE account_id=%s AND direction='out'"
                    "   AND created_at >= %s",
                    (account_id, _cutoff(days=self.LOOKBACK_DAYS))
                ).fetchone()
                if not row or int(row['cnt']) < 5:
                    return
                p25 = float(row['p25'] or 0)
                p75 = float(row['p75'] or 0)
            else:
                rows = conn.execute(
                    "SELECT amount FROM transactions"
                    " WHERE account_id=%s AND direction='out'"
                    "   AND created_at >= %s"
                    " ORDER BY amount",
                    (account_id, _cutoff(days=self.LOOKBACK_DAYS))
                ).fetchall()
                if not rows or len(rows) < 5:
                    return
                amounts_sorted = sorted(float(r['amount']) for r in rows)
                n = len(amounts_sorted)
                p25 = amounts_sorted[int(n * 0.25)]
                p75 = amounts_sorted[int(n * 0.75)]
        iqr = p75 - p25
        if iqr < 1:
            return

        extreme_fence = p75 + 3.0 * iqr
        mild_fence    = p75 + 1.5 * iqr

        if amount > extreme_fence:
            # Наскільки далеко від межі (нормалізований надлишок)
            excess = (amount - extreme_fence) / (extreme_fence + 1e-9)
            m = FM.sigmoid(excess, 0.5, 4.0)
            result.add(int(40 * m), 'iqr_extreme_outlier',
                       amount=amount, p75=round(p75, 2), iqr=round(iqr, 2),
                       fence=round(extreme_fence, 2))
        elif amount > mild_fence:
            excess = (amount - mild_fence) / (mild_fence + 1e-9)
            m = FM.sigmoid(excess, 0.5, 3.0)
            result.add(int(18 * m), 'iqr_mild_outlier',
                       amount=amount, p75=round(p75, 2), iqr=round(iqr, 2),
                       fence=round(mild_fence, 2))


class BalanceDepletionRule:

    SOFT_PCT = 0.80
    HARD_PCT = 0.95

    def evaluate(self, account_id: int, amount: float,
                 balance: float, result: RiskResult) -> None:
        if balance <= 0:
            return
        pct = amount / balance
        if pct >= self.HARD_PCT:
            result.add(max(int(45 * FM.trapezoid(pct, self.HARD_PCT, 0.97, 1.0, 1.01)), 20),
                       'balance_depletion_critical',
                       pct=round(pct * 100, 1), balance=round(balance, 2), amount=amount)
        elif pct >= self.SOFT_PCT:
            result.add(max(int(20 * FM.trapezoid(pct, self.SOFT_PCT, 0.88, self.HARD_PCT, 0.96)), 8),
                       'balance_depletion',
                       pct=round(pct * 100, 1), balance=round(balance, 2))


class StructuringRule:
    """Суми трохи нижче контрольних порогів."""

    THRESHOLDS = [5_000, 10_000, 20_000, 50_000, 100_000]
    ZONE_LOW   = 0.90
    ZONE_HIGH  = 0.995

    def evaluate(self, amount: float, result: RiskResult) -> None:
        for t in self.THRESHOLDS:
            lo, hi = t * self.ZONE_LOW, t * self.ZONE_HIGH
            if lo <= amount < hi:
                result.add(int(32 * FM.gaussian(amount, hi, (hi - lo) * 0.4)),
                           'structuring', amount=amount, threshold=t,
                           pct_below=round((1 - amount / t) * 100, 2))
                return


class DuplicateTransferRule:
    """Нечіткий дублікат у вікні 15 хв."""

    WINDOW_MINUTES       = 15
    SIMILARITY_SIGMA_PCT = 0.02

    def evaluate(self, account_id: int, recipient_account: str,
                 amount: float, result: RiskResult) -> None:
        with get_connection() as conn:
            rows = conn.execute(
                "SELECT amount FROM transactions"
                " WHERE account_id=%s AND direction='out'"
                "   AND related_account=%s"
                "   AND created_at >= %s"
                " ORDER BY created_at DESC LIMIT 10",
                (account_id, recipient_account, _cutoff(minutes=self.WINDOW_MINUTES))
            ).fetchall()
        if not rows:
            return
        sigma = max(amount * self.SIMILARITY_SIGMA_PCT, 1.0)
        for row in rows:
            sim = FM.gaussian(float(row['amount']), amount, sigma)
            if sim >= 0.7:
                result.add(int(65 * sim), 'duplicate_transfer',
                           amount=amount, prev=float(row['amount']),
                           similarity=round(sim, 3))
                return


class SplitTransactionRule:
    """Smurfing: ≥3 переказів одному отримувачу в 20 хв, сумарно ≥10k."""

    WINDOW_MINUTES  = 20
    MIN_COUNT       = 3
    THRESHOLD_TOTAL = 10_000

    def evaluate(self, account_id: int, recipient_account: str,
                 amount: float, result: RiskResult) -> None:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS total"
                " FROM transactions"
                " WHERE account_id=%s AND direction='out'"
                "   AND related_account=%s"
                "   AND created_at >= %s",
                (account_id, recipient_account, _cutoff(minutes=self.WINDOW_MINUTES))
            ).fetchone()
        cnt   = int(row['cnt']   if row else 0)
        total = float(row['total'] if row else 0) + amount
        if cnt >= self.MIN_COUNT and total >= self.THRESHOLD_TOTAL:
            result.add(int(40 * FM.sigmoid(total, self.THRESHOLD_TOTAL, 4.0)),
                       'smurfing', count=cnt + 1, total=round(total, 2))


class AmountProgressionRule:
    """Геометрична/арифметична прогресія сум → автоматизоване зондування."""

    MIN_SAMPLES = 4

    def evaluate(self, account_id: int, recipient_account: str,
                 amount: float, result: RiskResult) -> None:
        with get_connection() as conn:
            rows = conn.execute(
                "SELECT amount FROM transactions"
                " WHERE account_id=%s AND direction='out'"
                "   AND related_account=%s"
                " ORDER BY created_at DESC LIMIT 6",
                (account_id, recipient_account)
            ).fetchall()
        amounts = [amount] + [float(r['amount']) for r in rows]
        if len(amounts) < self.MIN_SAMPLES:
            return
        ratios = [amounts[i] / (amounts[i+1] + 1e-9) for i in range(len(amounts)-1)]
        diffs  = [amounts[i] - amounts[i+1]           for i in range(len(amounts)-1)]
        if _cv(ratios) < 0.08:
            result.add(35, 'amount_geo_progression', samples=amounts[:5], ratio_cv=round(_cv(ratios), 3))
        elif _cv(diffs) < 0.06:
            result.add(28, 'amount_arith_progression', samples=amounts[:5], diff_cv=round(_cv(diffs), 3))


class MoneyMuleRule:
    """Отримувач агрегує кошти від ≥N різних відправників."""

    WINDOW_DAYS        = 7
    SOFT_SENDERS_LIMIT = 5
    HARD_SENDERS_LIMIT = 12

    def evaluate(self, recipient_account_id: int, result: RiskResult) -> None:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT COUNT(DISTINCT t.account_id) AS senders,"
                "       COALESCE(SUM(t.amount),0)    AS volume"
                " FROM transactions t"
                " WHERE t.account_id != %s"
                "   AND t.direction = 'out'"
                "   AND t.related_account = ("
                "       SELECT account_number FROM accounts WHERE id=%s"
                "   )"
                "   AND t.created_at >= %s",
                (recipient_account_id, recipient_account_id, _cutoff(days=self.WINDOW_DAYS))
            ).fetchone()
        if not row:
            return
        senders = int(row['senders'])
        volume  = float(row['volume'])
        if senders >= self.HARD_SENDERS_LIMIT:
            result.add(int(50 * FM.sigmoid(senders, self.HARD_SENDERS_LIMIT, 5.0)),
                       'money_mule_pattern', unique_senders=senders,
                       volume=round(volume, 2), window_days=self.WINDOW_DAYS)
        elif senders >= self.SOFT_SENDERS_LIMIT:
            result.add(int(25 * FM.sigmoid(senders, self.SOFT_SENDERS_LIMIT, 5.0)),
                       'money_mule_suspected', unique_senders=senders,
                       volume=round(volume, 2))


class InactivityBurstRule:
    """Довга пауза → раптовий великий переказ (один запит)."""

    INACTIVITY_DAYS   = 14
    LARGE_AMOUNT_MULT = 2.0

    def evaluate(self, account_id: int, amount: float, result: RiskResult) -> None:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT MAX(created_at) AS last_at, COALESCE(AVG(amount), 0) AS avg_a"
                " FROM transactions WHERE account_id=%s AND direction='out'",
                (account_id,)
            ).fetchone()
        if not row or row['last_at'] is None:
            return
        gap_days = _days_since(row['last_at'])
        avg      = float(row['avg_a'])
        if gap_days >= self.INACTIVITY_DAYS and (avg < 1 or amount >= avg * self.LARGE_AMOUNT_MULT):
            result.add(int(30 * FM.sigmoid(gap_days, self.INACTIVITY_DAYS, 3.0)),
                       'inactivity_burst', gap_days=round(gap_days, 1), amount=amount)


class NewRecipientRule:
    """Перший переказ + рахунок отримувача молодий."""

    def evaluate(self, account_id: int, recipient_account: str,
                 recipient_account_id: int, result: RiskResult) -> None:
        with get_connection() as conn:
            prev = conn.execute(
                "SELECT COUNT(*) AS cnt FROM transactions"
                " WHERE account_id=%s AND related_account=%s AND direction='out'",
                (account_id, recipient_account)
            ).fetchone()
            recip_age = conn.execute(
                "SELECT created_at FROM accounts WHERE id=%s",
                (recipient_account_id,)
            ).fetchone()
        first_time = not prev or int(prev['cnt']) == 0
        age_h = _hours_since(recip_age['created_at']) if recip_age else 9999
        if first_time and age_h < 48:
            m = FM.decay(age_h, half_life=12.0)   # новіший = вищий ризик
            result.add(int(30 * m), 'new_recipient_new_account',
                       recipient=recipient_account, account_age_h=round(age_h, 1))
        elif first_time:
            result.add(8, 'new_recipient', recipient=recipient_account)


class TimeAnomalyRule:
    """Нічний час UTC + персональна аномалія годин."""

    def evaluate(self, account_id: int, result: RiskResult) -> None:
        hour = _hour_now_utc()
        if 1 <= hour <= 4:
            result.add(int(18 * FM.trapezoid(hour, 0.5, 1.5, 3.5, 4.5)),
                       'time_night_utc', hour_utc=hour)
        with get_connection() as conn:
            if USE_PG:
                row2 = conn.execute(
                    "SELECT COALESCE(AVG(EXTRACT(HOUR FROM created_at)), 12) AS avg_h,"
                    "       COALESCE(STDDEV(EXTRACT(HOUR FROM created_at)),  4) AS std_h,"
                    "       COUNT(*) AS cnt"
                    " FROM transactions WHERE account_id=%s",
                    (account_id,)
                ).fetchone()
                if not row2 or int(row2['cnt']) < 10:
                    return
                avg_h = float(row2['avg_h'])
                std_h = float(row2['std_h']) if row2['std_h'] else 4.0
            else:
                rows2 = conn.execute(
                    "SELECT CAST(strftime('%H', created_at) AS INTEGER) AS h, COUNT(*) AS cnt"
                    " FROM transactions WHERE account_id=%s"
                    " GROUP BY h",
                    (account_id,)
                ).fetchall()
                total = sum(int(r['cnt']) for r in rows2)
                if total < 10:
                    return
                avg_h = sum(int(r['h']) * int(r['cnt']) for r in rows2) / total
                variance = sum(((int(r['h']) - avg_h) ** 2) * int(r['cnt']) for r in rows2) / total
                std_h = math.sqrt(variance) if variance > 0 else 4.0
        zsc = abs(FM.zscore(hour, avg_h, std_h))
        if zsc >= 3.0:
            result.add(int(14 * FM.sigmoid(zsc, 3.0, 3.0)),
                       'time_personal_anomaly',
                       hour_utc=hour, typical_hour=round(avg_h, 1), zscore=round(zsc, 2))


class StructuredRoundAmountRule:

    def evaluate(self, amount: float, result: RiskResult) -> None:
        for modulo, threshold, max_delta in (
            (10_000, 50_000, 20), (1_000, 5_000, 14), (500, 1_000, 8),
        ):
            if amount >= threshold and amount % modulo == 0:
                result.add(int(max_delta * FM.sigmoid(amount, threshold, 2.0)),
                           'round_amount', amount=amount, modulo=modulo)
                break


class DescriptionAnomalyRule:

    PATTERNS = re.compile(
        r'\b(test|тест|debug|відмив|laundr|probe|зонд|dummy|fake|фейк'
        r'|spam|скам|scam|urgent|терміново|crypto|крипто|нал|кеш|готів)\b',
        re.IGNORECASE | re.UNICODE,
    )

    def evaluate(self, description: str, result: RiskResult) -> None:
        matches = self.PATTERNS.findall(description or '')
        if matches:
            result.add(15 + min(len(matches) - 1, 3) * 8,
                       'suspicious_description',
                       matched_keywords=list({m.lower() for m in matches}))


class PassThroughRule:
    """Транзитний рахунок: отримав → одразу переказує далі (30 хв вікно)."""

    WINDOW_MINUTES   = 30
    AMOUNT_TOLERANCE = 0.10

    def evaluate(self, account_id: int, amount: float, result: RiskResult) -> None:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT COALESCE(SUM(amount), 0) AS total_in, COUNT(*) AS cnt"
                " FROM transactions"
                " WHERE account_id=%s AND direction='in'"
                "   AND created_at >= %s",
                (account_id, _cutoff(minutes=self.WINDOW_MINUTES))
            ).fetchone()
        if not row or int(row['cnt']) == 0:
            return
        total_in = float(row['total_in'])
        if total_in <= 0:
            return
        overlap = min(amount, total_in) / max(amount, total_in)
        if overlap >= (1.0 - self.AMOUNT_TOLERANCE):
            result.add(int(45 * FM.gaussian(overlap, 1.0, 0.05)),
                       'pass_through',
                       incoming=round(total_in, 2), outgoing=round(amount, 2),
                       overlap=round(overlap, 3))


class AccountAgeRule:
    """Рахунок відправника < 7 днів."""

    YOUNG_DAYS = 7

    def evaluate(self, account_id: int, result: RiskResult) -> None:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT created_at FROM accounts WHERE id=%s",
                (account_id,)
            ).fetchone()
        if not row or row['created_at'] is None:
            return
        age_days = _days_since(row['created_at'])
        if age_days < self.YOUNG_DAYS:
            result.add(int(22 * (1.0 - age_days / self.YOUNG_DAYS)),
                       'new_sender_account', account_age_days=round(age_days, 2))


class HistoricalFraudRule:
    """Рецидивізм: попередні blocked/critical ордери на цьому рахунку."""

    LOOKBACK_DAYS = 90

    def evaluate(self, account_id: int, result: RiskResult) -> None:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT"
                "  SUM(CASE WHEN status='blocked'      THEN 1 ELSE 0 END) AS blocked_cnt,"
                "  SUM(CASE WHEN risk_level='critical' THEN 1 ELSE 0 END) AS critical_cnt"
                " FROM payment_orders"
                " WHERE sender_account_id=%s"
                "   AND created_at >= %s",
                (account_id, _cutoff(days=self.LOOKBACK_DAYS))
            ).fetchone()
        if not row:
            return
        blocked  = int(row['blocked_cnt']  or 0)
        critical = int(row['critical_cnt'] or 0)
        if blocked >= 1:
            result.add(int(35 * FM.sigmoid(blocked, 1, 4.0)),
                       'historical_blocked',
                       blocked_count=blocked, window_days=self.LOOKBACK_DAYS)
        elif critical >= 2:
            result.add(20, 'historical_critical', critical_count=critical)


class CounterpartyConcentrationRule:
    """≥70% вихідного обсягу іде одному отримувачу."""

    LOOKBACK_DAYS = 30
    MIN_TOTAL_TX  = 5
    CONCENTRATION = 0.70

    def evaluate(self, account_id: int, recipient_account: str,
                 result: RiskResult) -> None:
        cutoff = _cutoff(days=self.LOOKBACK_DAYS)
        with get_connection() as conn:
            total_row = conn.execute(
                "SELECT COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS total"
                " FROM transactions"
                " WHERE account_id=%s AND direction='out'"
                "   AND created_at >= %s",
                (account_id, cutoff)
            ).fetchone()
            recip_row = conn.execute(
                "SELECT COALESCE(SUM(amount), 0) AS total"
                " FROM transactions"
                " WHERE account_id=%s AND direction='out'"
                "   AND related_account=%s"
                "   AND created_at >= %s",
                (account_id, recipient_account, cutoff)
            ).fetchone()
        if not total_row or int(total_row['cnt']) < self.MIN_TOTAL_TX:
            return
        total_vol = float(total_row['total'])
        recip_vol = float(recip_row['total']) if recip_row else 0
        if total_vol <= 0:
            return
        c = recip_vol / total_vol
        if c >= self.CONCENTRATION:
            result.add(int(28 * FM.sigmoid(c, self.CONCENTRATION, 6.0)),
                       'counterparty_concentration',
                       concentration_pct=round(c * 100, 1),
                       recipient=recipient_account)


# ══ Складні правила (нові) ═══════════════════════════════════════════════════

class TransferGraphRule:
    """Аналіз графу переказів:

    1. Ping-pong: B→A нещодавно, тепер A→B (взаємний рух коштів).
    2. Fan-out: A за 1 год відправив ≥10 різним → швидке розсіювання.
    3. 2-hop cycle: A→B→C, де C→A за 48 год (трикутна схема відмивання).
       Реалізовано через два SQL-запити + set intersection у Python.
    """

    PINGPONG_HOURS  = 24
    FANOUT_MIN      = 10
    CYCLE_HOURS     = 48

    def evaluate(self, account_id: int, recipient_account: str,
                 result: RiskResult) -> None:
        with get_connection() as conn:
            sender_number_row = conn.execute(
                "SELECT account_number FROM accounts WHERE id=%s", (account_id,)
            ).fetchone()
        if not sender_number_row:
            return
        sender_number = sender_number_row['account_number']

        # ── Ping-pong ─────────────────────────────────────────────────────────
        with get_connection() as conn:
            pp = conn.execute(
                "SELECT COUNT(*) AS cnt FROM transactions t"
                " JOIN accounts a ON t.account_id = a.id"
                " WHERE a.account_number = %s"
                "   AND t.direction = 'out'"
                "   AND t.related_account = %s"
                "   AND t.created_at >= %s",
                (recipient_account, sender_number, _cutoff(hours=self.PINGPONG_HOURS))
            ).fetchone()
        if pp and int(pp['cnt']) >= 1:
            result.add(int(38 * FM.sigmoid(int(pp['cnt']), 1, 3.0)),
                       'transfer_pingpong',
                       sender=sender_number, recipient=recipient_account,
                       reverse_count=int(pp['cnt']))

        # ── Fan-out ───────────────────────────────────────────────────────────
        with get_connection() as conn:
            fo = conn.execute(
                "SELECT COUNT(DISTINCT related_account) AS uniq"
                " FROM transactions"
                " WHERE account_id=%s AND direction='out'"
                "   AND created_at >= %s",
                (account_id, _cutoff(hours=1))
            ).fetchone()
        if fo and int(fo['uniq']) >= self.FANOUT_MIN:
            result.add(int(32 * FM.sigmoid(int(fo['uniq']), self.FANOUT_MIN, 4.0)),
                       'transfer_fanout', unique_recipients_1h=int(fo['uniq']))

        # ── 2-hop cycle: A→B (current), B→C в минулому, C→A в минулому ───────
        with get_connection() as conn:
            cycle_cutoff = _cutoff(hours=self.CYCLE_HOURS)
            # Рахунки, яким recipient відправляв (B→C)
            b_sends_to = conn.execute(
                "SELECT DISTINCT t.related_account AS dest"
                " FROM transactions t"
                " JOIN accounts a ON t.account_id = a.id"
                " WHERE a.account_number = %s AND t.direction = 'out'"
                "   AND t.created_at >= %s",
                (recipient_account, cycle_cutoff)
            ).fetchall()
            # Рахунки, які відправляли на A (C→A)
            sends_to_a = conn.execute(
                "SELECT DISTINCT a.account_number AS src"
                " FROM transactions t"
                " JOIN accounts a ON t.account_id = a.id"
                " WHERE t.direction = 'out'"
                "   AND t.related_account = %s"
                "   AND t.created_at >= %s",
                (sender_number, cycle_cutoff)
            ).fetchall()

        b_dests   = {r['dest'] for r in b_sends_to}
        a_sources = {r['src']  for r in sends_to_a}
        cycle_nodes = b_dests & a_sources  # B→C та C→A → трикутник

        if cycle_nodes:
            result.add(55, 'transfer_cycle_2hop',
                       sender=sender_number, recipient=recipient_account,
                       cycle_intermediaries=list(cycle_nodes)[:3])


class BehavioralEntropyRule:
    """Shannon entropy поведінкового профілю.

    1. Entropy(amounts): розподіл сум по 10 відносним бакетам.
       Низька (<1.0 bit) → повторювані суми → бот або скрипт.

    2. Entropy(inter-arrival): розподіл пауз між переказами.
       Низька (<1.2 bit) → рівномірні інтервали → автоматизація.

    Обидві аномалії одночасно → підвищений бонус.
    """

    SAMPLE_SIZE = 25

    def evaluate(self, account_id: int, result: RiskResult) -> None:
        with get_connection() as conn:
            rows = conn.execute(
                "SELECT amount, created_at AS ts"
                " FROM transactions"
                " WHERE account_id=%s AND direction='out'"
                " ORDER BY created_at DESC LIMIT %s",
                (account_id, self.SAMPLE_SIZE)
            ).fetchall()
        if len(rows) < 8:
            return

        amounts = [float(r['amount']) for r in rows]
        timestamps = sorted(_ts_epoch(r['ts']) for r in rows)

        # ── Entropy сум ───────────────────────────────────────────────────────
        max_a = max(amounts)
        if max_a > 0:
            buckets_amt = [int(a / max_a * 9) for a in amounts]
            h_amounts = _shannon_entropy(buckets_amt)
        else:
            h_amounts = 0.0

        # ── Entropy інтервалів ────────────────────────────────────────────────
        gaps = [timestamps[i+1] - timestamps[i] for i in range(len(timestamps)-1)]
        if gaps:
            max_g = max(gaps) or 1
            buckets_gap = [int(g / max_g * 7) for g in gaps]
            h_gaps = _shannon_entropy(buckets_gap)
        else:
            h_gaps = 99.0

        bot_signal = (h_amounts < 1.0) and (h_gaps < 1.2)
        amt_signal = h_amounts < 1.0

        if bot_signal:
            result.add(40, 'behavioral_entropy_bot',
                       entropy_amounts=round(h_amounts, 3),
                       entropy_gaps=round(h_gaps, 3),
                       samples=len(rows))
        elif amt_signal:
            result.add(18, 'behavioral_entropy_amounts',
                       entropy_amounts=round(h_amounts, 3), samples=len(rows))
        elif h_gaps < 1.2 and len(gaps) >= 5:
            result.add(14, 'behavioral_entropy_timing',
                       entropy_gaps=round(h_gaps, 3), samples=len(rows))


class RecipientRiskPropagationRule:
    """Передача ризику: якщо отримувач сам є підозрілим відправником
    (має recent blocked/high-risk ордери як SENDER), це підвищує ризик
    поточного переказу.

    Propagation dampening factor = 0.45 (часткове успадкування).
    """

    LOOKBACK_DAYS      = 30
    DAMPENING          = 0.45
    MIN_PROPAGATE_SCORE = 55   # успадковуємо лише якщо recipient дійсно підозрілий

    def evaluate(self, recipient_account_id: int, result: RiskResult) -> None:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT COALESCE(AVG(risk_score), 0) AS avg_score,"
                "       SUM(CASE WHEN status='blocked' THEN 1 ELSE 0 END) AS blocked_cnt,"
                "       COUNT(*) AS total_cnt"
                " FROM payment_orders"
                " WHERE sender_account_id=%s"
                "   AND created_at >= %s",
                (recipient_account_id, _cutoff(days=self.LOOKBACK_DAYS))
            ).fetchone()
        if not row or int(row['total_cnt']) == 0:
            return
        avg_score = float(row['avg_score'])
        blocked   = int(row['blocked_cnt'] or 0)

        if avg_score >= self.MIN_PROPAGATE_SCORE:
            propagated = round(avg_score * self.DAMPENING)
            m = FM.sigmoid(avg_score, self.MIN_PROPAGATE_SCORE, 4.0)
            result.add(int(propagated * m), 'recipient_risk_propagation',
                       recipient_avg_score=round(avg_score, 1),
                       recipient_blocked=blocked,
                       dampening=self.DAMPENING)


# ══ Нові правила (COBOL-era inspired) ═══════════════════════════════════════

class ThresholdMaskingRule:
    """Суми «щойно під» класичними порогами звітності (50k, 100k, 200k, 500k UAH).

    У реальному банківстві порогові суми тригерять SAR/CTR.
    Сума 49 800–49 999 = явна маскировка порогу 50 000.
    """

    THRESHOLDS = [50_000, 100_000, 200_000, 500_000, 1_000_000]
    WINDOW_PCT  = 0.005   # 0.5% нижче порогу

    def evaluate(self, amount: float, result: RiskResult) -> None:
        for threshold in self.THRESHOLDS:
            lower = threshold * (1.0 - self.WINDOW_PCT)
            if lower <= amount < threshold:
                proximity = (amount - lower) / (threshold - lower)   # 0..1, 1 = ближче до порогу
                score = int(42 * FM.sigmoid(proximity, 0.3, 6.0))
                result.add(score, 'threshold_masking',
                           amount=amount, threshold=threshold,
                           proximity_pct=round((1 - proximity) * 100, 2))
                return   # одного правила достатньо


class CardTopupAbuseRule:
    """Швидкі поповнення картки з рахунку — ознака каскадного виводу коштів.

    Патерн: рахунок → картка 1, → картка 2, → картка N за короткий час.
    Перевіряємо кількість topup-транзакцій типу CARD_TOPUP в journal.
    """

    WINDOW_MINUTES = 30
    MAX_TOPUPS     = 3

    def evaluate(self, account_id: int, result: RiskResult) -> None:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM journal_entries"
                " WHERE account_id=%s AND entry_type='debit'"
                "   AND description LIKE 'CARD_TOPUP%'"
                "   AND created_at >= %s",
                (account_id, _cutoff(minutes=self.WINDOW_MINUTES))
            ).fetchone()
        if not row:
            return
        cnt = int(row['cnt'])
        if cnt >= self.MAX_TOPUPS:
            result.add(int(35 * FM.sigmoid(cnt, self.MAX_TOPUPS, 3.0)),
                       'card_topup_abuse',
                       topup_count=cnt, window_min=self.WINDOW_MINUTES)


class RapidSuccessionRule:
    """Більше 5 переказів за 10 хвилин — автоматизовані або скомпрометовані операції."""

    WINDOW_MINUTES = 10
    THRESHOLD      = 5

    def evaluate(self, account_id: int, result: RiskResult) -> None:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM transactions"
                " WHERE account_id=%s AND direction='out'"
                "   AND created_at >= %s",
                (account_id, _cutoff(minutes=self.WINDOW_MINUTES))
            ).fetchone()
        if not row:
            return
        cnt = int(row['cnt'])
        if cnt > self.THRESHOLD:
            result.add(int(45 * FM.sigmoid(cnt, self.THRESHOLD, 4.0)),
                       'rapid_succession',
                       tx_count=cnt, window_min=self.WINDOW_MINUTES)


class NewRecipientLargeAmountRule:
    """Перший переказ на рахунок + велика сума = підвищений ризик.

    Якщо sender ніколи раніше не відправляв на цей рахунок,
    а сума > 75-го перцентиля його власних переказів — підозра.
    """

    MIN_HISTORY = 5
    PERCENTILE  = 0.75

    def evaluate(self, account_id: int, recipient_account: str,
                 amount: float, result: RiskResult) -> None:
        with get_connection() as conn:
            hist = conn.execute(
                "SELECT amount FROM transactions"
                " WHERE account_id=%s AND direction='out'"
                "   AND related_account=%s ORDER BY created_at DESC LIMIT 1",
                (account_id, recipient_account)
            ).fetchone()
            if hist:
                return  # вже відправляли цьому отримувачу — не новий

            # Розраховуємо перцентиль по всіх переказах відправника
            amounts_row = conn.execute(
                "SELECT amount FROM transactions"
                " WHERE account_id=%s AND direction='out'"
                " ORDER BY amount",
                (account_id,)
            ).fetchall()

        amounts = [float(r['amount']) for r in amounts_row]
        if len(amounts) < self.MIN_HISTORY:
            return

        idx = int(len(amounts) * self.PERCENTILE)
        p75 = amounts[min(idx, len(amounts) - 1)]

        if amount > p75:
            ratio = amount / p75 if p75 > 0 else 2.0
            result.add(int(30 * FM.sigmoid(ratio, 1.5, 3.0)),
                       'new_recipient_large_amount',
                       amount=amount, p75=round(p75, 2),
                       ratio=round(ratio, 2),
                       recipient=recipient_account)


class NightBatchActivityRule:
    """Пакетна нічна активність (02:00–05:00 UTC) — нетипова для фізосіб.

    Поєднання: нічний час + ≥3 перекази за 30 хв → скомпрометований акаунт або скрипт.
    """

    NIGHT_START  = 2
    NIGHT_END    = 5
    WINDOW_MIN   = 30
    MIN_TX       = 3

    def evaluate(self, account_id: int, result: RiskResult) -> None:
        hour = _hour_now_utc()
        if not (self.NIGHT_START <= hour < self.NIGHT_END):
            return
        with get_connection() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM transactions"
                " WHERE account_id=%s AND direction='out'"
                "   AND created_at >= %s",
                (account_id, _cutoff(minutes=self.WINDOW_MIN))
            ).fetchone()
        if not row:
            return
        cnt = int(row['cnt'])
        if cnt >= self.MIN_TX:
            result.add(int(28 * FM.sigmoid(cnt, self.MIN_TX, 3.0)),
                       'night_batch_activity',
                       hour_utc=hour, tx_count=cnt, window_min=self.WINDOW_MIN)


class JournalInconsistencyRule:
    """Перевірка консистентності: чи є у journal_entries записи для цього account
    що не мають пари (orphan debit/credit без відповідного payment_order).

    Orphan entries = ознака обходу нормального flow або технічного збою.
    Оцінюємо тільки якщо є ≥2 orphans за останні 24 год.
    """

    LOOKBACK_HOURS = 24
    MIN_ORPHANS    = 2

    def evaluate(self, account_id: int, result: RiskResult) -> None:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM journal_entries"
                " WHERE account_id=%s"
                "   AND payment_order_id IS NULL"
                "   AND created_at >= %s",
                (account_id, _cutoff(hours=self.LOOKBACK_HOURS))
            ).fetchone()
        if not row:
            return
        cnt = int(row['cnt'])
        if cnt >= self.MIN_ORPHANS:
            result.add(int(22 * FM.sigmoid(cnt, self.MIN_ORPHANS, 2.0)),
                       'journal_orphan_entries',
                       orphan_count=cnt, window_hours=self.LOOKBACK_HOURS)


# ══ Утиліти ══════════════════════════════════════════════════════════════════

def _cv(values: list[float]) -> float:
    """Coefficient of Variation. Малий CV → прогресія."""
    n = len(values)
    if n < 2:
        return float('inf')
    mean = sum(values) / n
    if abs(mean) < 1e-9:
        return float('inf')
    variance = sum((v - mean) ** 2 for v in values) / n
    return math.sqrt(variance) / abs(mean)


def _shannon_entropy(labels: list[int]) -> float:
    """H = -∑ p_i × log2(p_i). Повертає bits."""
    n = len(labels)
    if n == 0:
        return 0.0
    counts = Counter(labels)
    return -sum((c / n) * math.log2(c / n) for c in counts.values() if c > 0)


# ══ Engine ═══════════════════════════════════════════════════════════════════

class FraudEngine:
    """Оркеструє 22 правила у трьох шарах (cheap → medium → expensive).
    Early-exit після досягнення CRITICAL на будь-якому шарі.

    Кожне правило виконується ізольовано: виключення логуються але не
    пробиваються вгору — fraud engine НІКОЛИ не блокує переказ через
    технічну помилку окремого правила.
    """

    def __init__(self):
        # Layer 1: без DB
        self._structuring      = StructuringRule()
        self._round            = StructuredRoundAmountRule()
        self._description      = DescriptionAnomalyRule()
        self._depletion        = BalanceDepletionRule()
        self._threshold_mask   = ThresholdMaskingRule()      # NEW

        # Layer 2: 1–2 DB-запити (відправник)
        self._velocity         = VelocityRule()
        self._account_age      = AccountAgeRule()
        self._high_amt         = HighAmountRule()
        self._iqr              = AdaptiveQuartileRule()
        self._inactivity       = InactivityBurstRule()
        self._time             = TimeAnomalyRule()
        self._pass_through     = PassThroughRule()
        self._history          = HistoricalFraudRule()
        self._rapid_succession = RapidSuccessionRule()       # NEW
        self._night_batch      = NightBatchActivityRule()    # NEW
        self._card_topup_abuse = CardTopupAbuseRule()        # NEW
        self._journal_check    = JournalInconsistencyRule()  # NEW

        # Layer 3: тяжкі запити (пара + граф + ентропія)
        self._freq_esc         = FrequencyEscalationRule()
        self._duplicate        = DuplicateTransferRule()
        self._split            = SplitTransactionRule()
        self._progression      = AmountProgressionRule()
        self._new_recv         = NewRecipientRule()
        self._new_recv_large   = NewRecipientLargeAmountRule()  # NEW
        self._concentration    = CounterpartyConcentrationRule()
        self._graph            = TransferGraphRule()
        self._entropy          = BehavioralEntropyRule()
        self._mule             = MoneyMuleRule()
        self._propagation      = RecipientRiskPropagationRule()

    # ── Safe wrapper ─────────────────────────────────────────────────────────

    @staticmethod
    def _run(rule_fn, *args) -> None:
        """Виконує правило ізольовано. Виключення не пробиваються вгору."""
        try:
            rule_fn(*args)
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning(
                'fraud rule %s failed: %s', rule_fn.__qualname__, exc
            )

    def assess(
        self,
        account_id: int,
        recipient_account: Optional[str],
        amount: float,
        balance: float = 0.0,
        description: str = '',
        recipient_account_id: Optional[int] = None,
    ) -> RiskResult:
        result = RiskResult()
        r = self._run  # alias

        # ── Layer 1: без DB ───────────────────────────────────────────────────
        # Найдешевші перевірки — рахуються миттєво з аргументів функції,
        # без жодного звернення до БД. Виконуються для КОЖНОГО переказу.
        r(self._structuring.evaluate,    amount, result)
        r(self._round.evaluate,          amount, result)
        r(self._description.evaluate,    description, result)
        r(self._depletion.evaluate,      account_id, amount, balance, result)
        r(self._threshold_mask.evaluate, amount, result)        # NEW

        # Early-exit: якщо вже після Layer 1 ризик критичний (наприклад,
        # сума = 100% балансу + структуринг), немає сенсу робити додаткові
        # запити до БД — переказ все одно буде заблоковано в payment_core.
        if result.is_critical:
            result.finalize()
            return result

        # На SQLite (наприклад, локальна розробка без Postgres) важкі
        # аналітичні запити Layer 2/3 (STDDEV, PERCENTILE_CONT, графи)
        # або занадто дорогі, або синтаксично несумісні — обмежуємось
        # Layer 1 і явно позначаємо це в details для прозорості в логах/UI.
        if not USE_PG:
            result.details.setdefault('fraud_mode', 'lite_sqlite')
            result.finalize()
            return result

        # ── Layer 2: відправник ───────────────────────────────────────────────
        r(self._velocity.evaluate,         account_id, result)
        r(self._account_age.evaluate,      account_id, result)
        r(self._high_amt.evaluate,         account_id, amount, result)
        r(self._iqr.evaluate,              account_id, amount, result)
        r(self._inactivity.evaluate,       account_id, amount, result)
        r(self._time.evaluate,             account_id, result)
        r(self._pass_through.evaluate,     account_id, amount, result)
        r(self._history.evaluate,          account_id, result)
        r(self._rapid_succession.evaluate, account_id, result)   # NEW
        r(self._night_batch.evaluate,      account_id, result)   # NEW
        r(self._card_topup_abuse.evaluate, account_id, result)   # NEW
        r(self._journal_check.evaluate,    account_id, result)   # NEW

        if result.is_critical:
            result.finalize()
            return result

        # ── Layer 3: тяжкі ────────────────────────────────────────────────────
        r(self._freq_esc.evaluate, account_id, result)
        r(self._entropy.evaluate,  account_id, result)

        if recipient_account:
            r(self._duplicate.evaluate,       account_id, recipient_account, amount, result)
            r(self._split.evaluate,           account_id, recipient_account, amount, result)
            r(self._progression.evaluate,     account_id, recipient_account, amount, result)
            r(self._new_recv.evaluate,        account_id, recipient_account,
                                              recipient_account_id or 0, result)
            r(self._new_recv_large.evaluate,  account_id, recipient_account, amount, result)  # NEW
            r(self._concentration.evaluate,   account_id, recipient_account, result)
            r(self._graph.evaluate,           account_id, recipient_account, result)

        if recipient_account_id:
            r(self._mule.evaluate,        recipient_account_id, result)
            r(self._propagation.evaluate, recipient_account_id, result)

        result.finalize()
        return result

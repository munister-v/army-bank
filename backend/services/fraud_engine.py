"""Fuzzy Fraud Detection Engine — Army Bank.

Архітектура:
  FuzzyMembership  — набір функцій приналежності (sigmoid, gaussian, trapezoid, decay)
  BaseRule         — базовий клас правила
  RiskResult       — акумулятор балів + кореляційний бонус
  12 правил        — від velocity до mule-detection
  FraudEngine      — оркестратор, нормалізація, кореляції
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Optional

from ..database import get_connection


# ══ Рівні ризику ═════════════════════════════════════════════════════════════

RISK_LOW      = 'low'       # 0–25
RISK_MEDIUM   = 'medium'    # 26–50
RISK_HIGH     = 'high'      # 51–75
RISK_CRITICAL = 'critical'  # 76+

_LEVEL_THRESH = ((76, RISK_CRITICAL), (51, RISK_HIGH), (26, RISK_MEDIUM))


# ══ Результат оцінки ═════════════════════════════════════════════════════════

@dataclass
class RiskResult:
    score: int = 0
    level: str = RISK_LOW
    flags: list[str] = field(default_factory=list)
    details: dict = field(default_factory=dict)
    # скільки різних правил спрацювало (для кореляційного бонусу)
    _rule_hits: int = field(default=0, repr=False)

    def add(self, delta: int, flag: str, **kw) -> None:
        if delta <= 0:
            return
        self.score += delta
        self._rule_hits += 1
        self.flags.append(flag)
        self.details.update(kw)
        self.level = self._calc_level()

    def _calc_level(self) -> str:
        for thresh, lvl in _LEVEL_THRESH:
            if self.score >= thresh:
                return lvl
        return RISK_LOW

    def apply_correlation_bonus(self) -> None:
        """Якщо спрацювало ≥3 різних правил — додатковий штраф (ланцюгова аномалія)."""
        if self._rule_hits >= 5:
            self.score = min(100, self.score + 20)
            self.flags.append('multi_rule_correlation_strong')
        elif self._rule_hits >= 3:
            self.score = min(100, self.score + 10)
            self.flags.append('multi_rule_correlation')
        self.score = min(100, self.score)
        self.level = self._calc_level()

    def to_dict(self) -> dict:
        return {'score': self.score, 'level': self.level,
                'flags': self.flags, 'details': self.details}


# ══ Функції нечіткої приналежності ═══════════════════════════════════════════

class FM:
    """Fuzzy Membership functions."""

    @staticmethod
    def sigmoid(x: float, center: float, slope: float = 5.0) -> float:
        """S-крива: 0→1 при переході через center. slope — крутість."""
        denom = center * 0.15 + 1e-9
        return 1.0 / (1.0 + math.exp(-slope * (x - center) / denom))

    @staticmethod
    def gaussian(x: float, center: float, sigma: float) -> float:
        """Дзвіноподібна: максимум 1.0 в center, спад по обидва боки."""
        if sigma <= 0:
            return 1.0 if abs(x - center) < 1e-9 else 0.0
        return math.exp(-0.5 * ((x - center) / sigma) ** 2)

    @staticmethod
    def trapezoid(x: float, a: float, b: float, c: float, d: float) -> float:
        """Трапеція: 0 до a, ріст a→b, плато b→c, спад c→d, 0 після d."""
        if x <= a or x >= d:
            return 0.0
        if b <= x <= c:
            return 1.0
        if x < b:
            return (x - a) / (b - a + 1e-12)
        return (d - x) / (d - c + 1e-12)

    @staticmethod
    def decay(age_minutes: float, half_life: float = 60.0) -> float:
        """Експоненційний спад: 1.0 при age=0, 0.5 при age=half_life."""
        return math.exp(-math.log(2) * age_minutes / (half_life + 1e-9))

    @staticmethod
    def zscore(value: float, mean: float, std: float) -> float:
        return (value - mean) / (std + 1e-9) if std > 0.01 else 0.0


# ══ Правила ══════════════════════════════════════════════════════════════════

class VelocityRule:
    """Кількість вихідних транзакцій у плинному вікні.
    Два вікна: 5 хв (burst) та 1 год (sustained)."""

    def evaluate(self, account_id: int, result: RiskResult) -> None:
        with get_connection() as conn:
            r5 = conn.execute(
                """SELECT COUNT(*) AS cnt FROM transactions
                   WHERE account_id=%s AND direction='out'
                     AND created_at >= NOW() - INTERVAL '5 minutes'""",
                (account_id,)
            ).fetchone()
            r60 = conn.execute(
                """SELECT COUNT(*) AS cnt FROM transactions
                   WHERE account_id=%s AND direction='out'
                     AND created_at >= NOW() - INTERVAL '60 minutes'""",
                (account_id,)
            ).fetchone()
        burst = int(r5['cnt'] if r5 else 0)
        hour  = int(r60['cnt'] if r60 else 0)

        if burst >= 8:
            delta = int(60 * FM.sigmoid(burst, 8, 6.0))
            result.add(delta, 'velocity_burst', burst_5m=burst)
        elif burst >= 4:
            delta = int(28 * FM.sigmoid(burst, 4, 5.0))
            result.add(delta, 'velocity_elevated', burst_5m=burst)

        if hour >= 20:
            delta = int(35 * FM.sigmoid(hour, 20, 4.0))
            result.add(delta, 'velocity_sustained_hour', hour_count=hour)


class FrequencyEscalationRule:
    """Порівнює поточну годинну частоту з 30-денним базисом.
    Визначає «раптовий сплеск» активності."""

    LOOKBACK_DAYS = 30

    def evaluate(self, account_id: int, result: RiskResult) -> None:
        with get_connection() as conn:
            baseline = conn.execute(
                """SELECT COUNT(*) AS cnt FROM transactions
                   WHERE account_id=%s AND direction='out'
                     AND created_at >= NOW() - (%s || ' days')::INTERVAL
                     AND created_at <  NOW() - INTERVAL '1 hour'""",
                (account_id, str(self.LOOKBACK_DAYS))
            ).fetchone()
            current = conn.execute(
                """SELECT COUNT(*) AS cnt FROM transactions
                   WHERE account_id=%s AND direction='out'
                     AND created_at >= NOW() - INTERVAL '1 hour'""",
                (account_id,)
            ).fetchone()
        total_past = int(baseline['cnt'] if baseline else 0)
        hourly_avg = total_past / (self.LOOKBACK_DAYS * 24) if total_past > 0 else 0
        current_hz = int(current['cnt'] if current else 0)

        if hourly_avg < 0.05 and current_hz >= 3:
            # Зазвичай неактивний, зараз — вибух
            result.add(30, 'freq_escalation_inactive',
                       hourly_avg=round(hourly_avg, 3), current_hour=current_hz)
        elif hourly_avg > 0.05:
            ratio = current_hz / (hourly_avg + 1e-9)
            if ratio >= 8:
                delta = int(38 * FM.sigmoid(ratio, 8, 4.0))
                result.add(delta, 'freq_escalation_spike',
                           hourly_avg=round(hourly_avg, 3),
                           current_hour=current_hz, ratio=round(ratio, 1))


class HighAmountRule:
    """Сума аномально велика відносно персональної статистики.
    Використовує z-score + sigma-membership."""

    LOOKBACK_DAYS = 30

    def evaluate(self, account_id: int, amount: float, result: RiskResult) -> None:
        with get_connection() as conn:
            row = conn.execute(
                """SELECT COALESCE(AVG(amount),0) AS avg_a,
                          COALESCE(STDDEV(amount),0) AS std_a,
                          COUNT(*) AS cnt,
                          COALESCE(MAX(amount),0) AS max_a
                   FROM transactions
                   WHERE account_id=%s AND direction='out'
                     AND created_at >= NOW() - (%s || ' days')::INTERVAL""",
                (account_id, str(self.LOOKBACK_DAYS))
            ).fetchone()
        if not row or int(row['cnt']) < 3:
            return
        avg, std, max_a = float(row['avg_a']), float(row['std_a']), float(row['max_a'])
        if avg < 1:
            return
        ratio  = amount / avg
        zsc    = FM.zscore(amount, avg, std)
        new_max = amount > max_a * 1.5  # в 1.5× перевищує попередній максимум

        if ratio >= 15 or zsc >= 5:
            delta = int(50 * FM.sigmoid(max(ratio / 15, zsc / 5), 1.0, 5.0))
            result.add(delta, 'amount_extreme',
                       amount=amount, avg=round(avg,2), ratio=round(ratio,2), z=round(zsc,2))
        elif ratio >= 5 or zsc >= 3:
            delta = int(28 * FM.sigmoid(max(ratio / 5, zsc / 3), 1.0, 4.0))
            result.add(delta, 'amount_high',
                       amount=amount, avg=round(avg,2), ratio=round(ratio,2), z=round(zsc,2))
        elif new_max and ratio >= 2:
            result.add(12, 'amount_new_personal_max',
                       amount=amount, prev_max=round(max_a,2))


class BalanceDepletionRule:
    """Переказ виснажує рахунок більш ніж на X%.
    Типова ознака «виведення коштів»."""

    SOFT_PCT = 0.80  # 80% балансу
    HARD_PCT = 0.95  # 95% балансу

    def evaluate(self, account_id: int, amount: float,
                 balance: float, result: RiskResult) -> None:
        if balance <= 0:
            return
        pct = amount / balance
        if pct >= self.HARD_PCT:
            delta = int(45 * FM.trapezoid(pct, self.HARD_PCT, 0.97, 1.0, 1.01))
            result.add(max(delta, 20), 'balance_depletion_critical',
                       pct=round(pct * 100, 1), balance=round(balance, 2), amount=amount)
        elif pct >= self.SOFT_PCT:
            delta = int(20 * FM.trapezoid(pct, self.SOFT_PCT, 0.88, self.HARD_PCT, 0.96))
            result.add(max(delta, 8), 'balance_depletion',
                       pct=round(pct * 100, 1), balance=round(balance, 2))


class StructuringRule:
    """Структурування: суми трохи нижче «круглих» порогів.
    Наприклад 9 800, 4 950, 19 700 — уникання порогових контролів."""

    # Порогові значення, нижче яких шукаємо «близькі» суми
    THRESHOLDS = [5_000, 10_000, 20_000, 50_000, 100_000]
    # Зона підозри: від threshold*ZONE_LOW до threshold*ZONE_HIGH
    ZONE_LOW  = 0.90
    ZONE_HIGH = 0.995

    def evaluate(self, amount: float, result: RiskResult) -> None:
        for t in self.THRESHOLDS:
            lo, hi = t * self.ZONE_LOW, t * self.ZONE_HIGH
            if lo <= amount < hi:
                # Gaussian: максимум поблизу hi (найближче до порогу → найпідозріліше)
                membership = FM.gaussian(amount, hi, (hi - lo) * 0.4)
                delta = int(32 * membership)
                result.add(delta, 'structuring',
                           amount=amount, threshold=t,
                           pct_below=round((1 - amount / t) * 100, 2))
                return  # одного спрацювання достатньо


class DuplicateTransferRule:
    """Нечіткий дублікат: та сама пара (відправник, отримувач, ~сума) за вікно.
    Fuzzy similarity по сумі через Gaussian."""

    WINDOW_MINUTES = 15
    SIMILARITY_SIGMA_PCT = 0.02  # 2% від суми = sigma гауссіани

    def evaluate(self, account_id: int, recipient_account: str,
                 amount: float, result: RiskResult) -> None:
        with get_connection() as conn:
            rows = conn.execute(
                """SELECT amount, created_at FROM transactions
                   WHERE account_id=%s AND direction='out'
                     AND related_account=%s
                     AND created_at >= NOW() - (%s || ' minutes')::INTERVAL
                   ORDER BY created_at DESC LIMIT 10""",
                (account_id, recipient_account, str(self.WINDOW_MINUTES))
            ).fetchall()
        if not rows:
            return
        sigma = amount * self.SIMILARITY_SIGMA_PCT
        for row in rows:
            sim = FM.gaussian(float(row['amount']), amount, max(sigma, 1.0))
            if sim >= 0.7:  # сильна схожість
                age_min = 0  # щойно знайдено
                decay   = FM.decay(age_min, half_life=5.0)
                delta   = int(65 * sim * decay)
                result.add(delta, 'duplicate_transfer',
                           amount=amount, prev=float(row['amount']),
                           similarity=round(sim, 3))
                return


class SplitTransactionRule:
    """Smurfing: багато переказів одному отримувачу → загальна сума підозріла."""

    WINDOW_MINUTES  = 20
    MIN_COUNT       = 3
    THRESHOLD_TOTAL = 10_000

    def evaluate(self, account_id: int, recipient_account: str,
                 amount: float, result: RiskResult) -> None:
        with get_connection() as conn:
            row = conn.execute(
                """SELECT COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS total
                   FROM transactions
                   WHERE account_id=%s AND direction='out'
                     AND related_account=%s
                     AND created_at >= NOW() - (%s || ' minutes')::INTERVAL""",
                (account_id, recipient_account, str(self.WINDOW_MINUTES))
            ).fetchone()
        cnt   = int(row['cnt']   if row else 0)
        total = float(row['total'] if row else 0) + amount
        if cnt >= self.MIN_COUNT and total >= self.THRESHOLD_TOTAL:
            m = FM.sigmoid(total, self.THRESHOLD_TOTAL, 4.0)
            result.add(int(40 * m), 'smurfing',
                       count=cnt + 1, total=round(total, 2))


class AmountProgressionRule:
    """Геометрична або арифметична прогресія у сумах до одного отримувача.
    Патерн автоматизованого тестування/зондування."""

    MIN_SAMPLES = 4

    def evaluate(self, account_id: int, recipient_account: str,
                 amount: float, result: RiskResult) -> None:
        with get_connection() as conn:
            rows = conn.execute(
                """SELECT amount FROM transactions
                   WHERE account_id=%s AND direction='out'
                     AND related_account=%s
                   ORDER BY created_at DESC LIMIT 6""",
                (account_id, recipient_account)
            ).fetchall()
        amounts = [float(r['amount']) for r in rows]
        amounts.insert(0, amount)  # поточна спереду
        if len(amounts) < self.MIN_SAMPLES:
            return

        # Геометрична: a[i]/a[i+1] ≈ const
        ratios = [amounts[i] / (amounts[i+1] + 1e-9) for i in range(len(amounts)-1)]
        geo_var = _coefficient_of_variation(ratios)

        # Арифметична: a[i] - a[i+1] ≈ const
        diffs = [amounts[i] - amounts[i+1] for i in range(len(amounts)-1)]
        arith_var = _coefficient_of_variation(diffs)

        if geo_var < 0.08:   # дуже стала геометрична прогресія
            result.add(35, 'amount_geo_progression',
                       samples=amounts[:5], ratio_cv=round(geo_var, 3))
        elif arith_var < 0.06:
            result.add(28, 'amount_arith_progression',
                       samples=amounts[:5], diff_cv=round(arith_var, 3))


class MoneyMuleRule:
    """Рахунок отримувача агрегує кошти від багатьох різних відправників.
    Класичний патерн грошового муля."""

    WINDOW_DAYS        = 7
    SOFT_SENDERS_LIMIT = 5
    HARD_SENDERS_LIMIT = 12

    def evaluate(self, recipient_account_id: int, result: RiskResult) -> None:
        with get_connection() as conn:
            row = conn.execute(
                """SELECT COUNT(DISTINCT t.account_id) AS senders,
                          COALESCE(SUM(t.amount),0) AS volume
                   FROM transactions t
                   WHERE t.account_id != %s
                     AND t.direction = 'out'
                     AND t.related_account = (
                         SELECT account_number FROM accounts WHERE id=%s
                     )
                     AND t.created_at >= NOW() - (%s || ' days')::INTERVAL""",
                (recipient_account_id, recipient_account_id, str(self.WINDOW_DAYS))
            ).fetchone()
        if not row:
            return
        senders = int(row['senders'])
        volume  = float(row['volume'])
        if senders >= self.HARD_SENDERS_LIMIT:
            m = FM.sigmoid(senders, self.HARD_SENDERS_LIMIT, 5.0)
            result.add(int(50 * m), 'money_mule_pattern',
                       unique_senders=senders, volume=round(volume, 2),
                       window_days=self.WINDOW_DAYS)
        elif senders >= self.SOFT_SENDERS_LIMIT:
            m = FM.sigmoid(senders, self.SOFT_SENDERS_LIMIT, 5.0)
            result.add(int(25 * m), 'money_mule_suspected',
                       unique_senders=senders, volume=round(volume, 2))


class InactivityBurstRule:
    """Рахунок довго не використовувався, потім — раптовий великий переказ."""

    INACTIVITY_DAYS   = 14
    LARGE_AMOUNT_MULT = 2.0  # в 2× від середнього

    def evaluate(self, account_id: int, amount: float, result: RiskResult) -> None:
        with get_connection() as conn:
            last = conn.execute(
                """SELECT created_at,
                          (SELECT COALESCE(AVG(amount),0)
                           FROM transactions
                           WHERE account_id=%s AND direction='out') AS avg_a
                   FROM transactions
                   WHERE account_id=%s AND direction='out'
                   ORDER BY created_at DESC LIMIT 1""",
                (account_id, account_id)
            ).fetchone()
        if not last:
            return
        avg = float(last['avg_a'])

        # Розрахувати кількість днів неактивності через SQL
        with get_connection() as conn:
            gap = conn.execute(
                """SELECT EXTRACT(EPOCH FROM (NOW() - MAX(created_at)))/86400 AS gap_days
                   FROM transactions WHERE account_id=%s AND direction='out'""",
                (account_id,)
            ).fetchone()
        if not gap or gap['gap_days'] is None:
            return
        gap_days = float(gap['gap_days'])

        if gap_days >= self.INACTIVITY_DAYS and (avg < 1 or amount >= avg * self.LARGE_AMOUNT_MULT):
            # decay: чим довша пауза — тим підозріліше
            m = FM.sigmoid(gap_days, self.INACTIVITY_DAYS, 3.0)
            result.add(int(30 * m), 'inactivity_burst',
                       gap_days=round(gap_days, 1), amount=amount)


class NewRecipientRule:
    """Перший переказ на цей рахунок + рахунок отримувача молодий."""

    def evaluate(self, account_id: int, recipient_account: str,
                 recipient_account_id: int, result: RiskResult) -> None:
        with get_connection() as conn:
            prev = conn.execute(
                """SELECT COUNT(*) AS cnt FROM transactions
                   WHERE account_id=%s AND related_account=%s AND direction='out'""",
                (account_id, recipient_account)
            ).fetchone()
            recip_age = conn.execute(
                """SELECT EXTRACT(EPOCH FROM (NOW() - created_at))/3600 AS age_h
                   FROM accounts WHERE id=%s""",
                (recipient_account_id,)
            ).fetchone()

        first_time = not prev or int(prev['cnt']) == 0
        age_h = float(recip_age['age_h']) if recip_age and recip_age['age_h'] else 9999

        if first_time and age_h < 48:
            # Перший переказ + новий рахунок отримувача (<48h)
            m = FM.decay(age_h, half_life=24.0)  # 0→1 чим новіший
            result.add(int(30 * (1 - m + 0.5)), 'new_recipient_new_account',
                       recipient=recipient_account, account_age_h=round(age_h, 1))
        elif first_time:
            result.add(8, 'new_recipient', recipient=recipient_account)


class TimeAnomalyRule:
    """Ніч (01:00–04:00 UTC) та персональна аномалія часу (Gaussian)."""

    def evaluate(self, account_id: int, result: RiskResult) -> None:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT EXTRACT(HOUR FROM NOW()) AS h"
            ).fetchone()
        if not row:
            return
        hour = int(float(row['h']))

        # Абсолютна ніч
        if 1 <= hour <= 4:
            night_m = FM.trapezoid(hour, 0.5, 1.5, 3.5, 4.5)
            result.add(int(18 * night_m), 'time_night_utc', hour_utc=hour)

        # Персональна аномалія: чи типова ця година для користувача?
        with get_connection() as conn:
            row2 = conn.execute(
                """SELECT COALESCE(AVG(EXTRACT(HOUR FROM created_at)),12) AS avg_h,
                          COALESCE(STDDEV(EXTRACT(HOUR FROM created_at)),4) AS std_h,
                          COUNT(*) AS cnt
                   FROM transactions WHERE account_id=%s""",
                (account_id,)
            ).fetchone()
        if not row2 or int(row2['cnt']) < 10:
            return
        avg_h = float(row2['avg_h'])
        std_h = float(row2['std_h']) if row2['std_h'] else 4.0
        zsc = abs(FM.zscore(hour, avg_h, std_h))
        if zsc >= 3.0:
            m = FM.sigmoid(zsc, 3.0, 3.0)
            result.add(int(14 * m), 'time_personal_anomaly',
                       hour_utc=hour, typical_hour=round(avg_h, 1), zscore=round(zsc, 2))


class StructuredRoundAmountRule:
    """Об'єднує виявлення круглих сум та структурування.
    Дає вищий сигнал при одночасному повторенні."""

    def evaluate(self, amount: float, result: RiskResult) -> None:
        # Дуже рівна сума
        for modulo, threshold, max_delta in ((10_000, 50_000, 20), (1_000, 5_000, 14), (500, 1_000, 8)):
            if amount >= threshold and amount % modulo == 0:
                m = FM.sigmoid(amount, threshold, 2.0)
                result.add(int(max_delta * m), 'round_amount',
                           amount=amount, modulo=modulo)
                break


class DescriptionAnomalyRule:
    """Підозрілі ключові слова в описі (тест, test, відмивання, debug тощо)."""

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
                       matched_keywords=list(set(m.lower() for m in matches)))


# ══ Утиліти ══════════════════════════════════════════════════════════════════

def _coefficient_of_variation(values: list[float]) -> float:
    """CV = std/mean. Малий CV → однорідна послідовність (прогресія)."""
    n = len(values)
    if n < 2:
        return float('inf')
    mean = sum(values) / n
    if abs(mean) < 1e-9:
        return float('inf')
    variance = sum((v - mean) ** 2 for v in values) / n
    return math.sqrt(variance) / abs(mean)


# ══ Engine ═══════════════════════════════════════════════════════════════════

class FraudEngine:
    """Оркеструє всі правила.
    Порядок виконання — від найшвидших до найдорожчих."""

    def __init__(self):
        self._velocity      = VelocityRule()
        self._freq_esc      = FrequencyEscalationRule()
        self._high_amt      = HighAmountRule()
        self._depletion     = BalanceDepletionRule()
        self._structuring   = StructuringRule()
        self._round         = StructuredRoundAmountRule()
        self._duplicate     = DuplicateTransferRule()
        self._split         = SplitTransactionRule()
        self._progression   = AmountProgressionRule()
        self._mule          = MoneyMuleRule()
        self._inactivity    = InactivityBurstRule()
        self._new_recv      = NewRecipientRule()
        self._time          = TimeAnomalyRule()
        self._description   = DescriptionAnomalyRule()

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

        # ── Правила на відправника ────────────────────────────────────────────
        self._velocity.evaluate(account_id, result)
        self._freq_esc.evaluate(account_id, result)
        self._high_amt.evaluate(account_id, amount, result)
        self._depletion.evaluate(account_id, amount, balance, result)
        self._inactivity.evaluate(account_id, amount, result)
        self._time.evaluate(account_id, result)

        # ── Правила на суму ───────────────────────────────────────────────────
        self._structuring.evaluate(amount, result)
        self._round.evaluate(amount, result)
        self._description.evaluate(description, result)

        # ── Правила на пару відправник–отримувач ─────────────────────────────
        if recipient_account:
            self._duplicate.evaluate(account_id, recipient_account, amount, result)
            self._split.evaluate(account_id, recipient_account, amount, result)
            self._progression.evaluate(account_id, recipient_account, amount, result)
            self._new_recv.evaluate(account_id, recipient_account,
                                    recipient_account_id or 0, result)
        if recipient_account_id:
            self._mule.evaluate(recipient_account_id, result)

        # ── Кореляційний бонус ────────────────────────────────────────────────
        result.apply_correlation_bonus()
        return result

"""Движок виявлення шахрайства на основі нечітких алгоритмів."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional
from ..database import get_connection


RISK_LOW      = 'low'       # 0-25
RISK_MEDIUM   = 'medium'    # 26-50
RISK_HIGH     = 'high'      # 51-75
RISK_CRITICAL = 'critical'  # 76+


@dataclass
class RiskResult:
    score: int = 0
    level: str = RISK_LOW
    flags: list[str] = field(default_factory=list)
    details: dict = field(default_factory=dict)

    def add(self, score_delta: int, flag: str, **detail_kw):
        self.score += score_delta
        self.flags.append(flag)
        self.details.update(detail_kw)
        self.level = self._level()

    def _level(self) -> str:
        if self.score >= 76: return RISK_CRITICAL
        if self.score >= 51: return RISK_HIGH
        if self.score >= 26: return RISK_MEDIUM
        return RISK_LOW

    def to_dict(self) -> dict:
        return {
            'score': self.score,
            'level': self.level,
            'flags': self.flags,
            'details': self.details,
        }


# ── Fuzzy membership helpers ──────────────────────────────────────────────────

def _fuzzy_high(value: float, threshold: float, width: float = 0.3) -> float:
    """Fuzzy membership: 0.0 → 1.0 as value approaches/exceeds threshold.
    Uses sigmoid-like transition centered at threshold with given width."""
    if width <= 0:
        return 1.0 if value >= threshold else 0.0
    x = (value - threshold) / (threshold * width + 1e-9)
    return 1.0 / (1.0 + math.exp(-5 * x))


def _zscore(value: float, mean: float, std: float) -> float:
    if std < 0.01:
        return 0.0
    return (value - mean) / std


# ── Individual rules ──────────────────────────────────────────────────────────

class VelocityRule:
    """Занадто багато транзакцій за короткий час з одного рахунку."""
    WINDOW_SECONDS = 300   # 5 хвилин
    SOFT_LIMIT = 5
    HARD_LIMIT = 10

    def evaluate(self, account_id: int, result: RiskResult) -> None:
        with get_connection() as conn:
            row = conn.execute(
                """SELECT COUNT(*) AS cnt
                   FROM transactions
                   WHERE account_id = %s
                     AND direction = 'out'
                     AND created_at >= NOW() - (%s || ' seconds')::INTERVAL""",
                (account_id, str(self.WINDOW_SECONDS))
            ).fetchone()
        cnt = int(row['cnt']) if row else 0
        if cnt >= self.HARD_LIMIT:
            membership = _fuzzy_high(cnt, self.HARD_LIMIT, 0.2)
            delta = int(55 * membership)
            result.add(delta, 'velocity_critical',
                       velocity_count=cnt, velocity_window_s=self.WINDOW_SECONDS)
        elif cnt >= self.SOFT_LIMIT:
            membership = _fuzzy_high(cnt, self.SOFT_LIMIT, 0.5)
            delta = int(25 * membership)
            result.add(delta, 'velocity_high',
                       velocity_count=cnt, velocity_window_s=self.WINDOW_SECONDS)


class HighAmountRule:
    """Сума значно перевищує середній розмір переказу користувача."""
    LOOKBACK_DAYS = 30
    SOFT_MULTIPLIER = 3.0
    HARD_MULTIPLIER = 10.0

    def evaluate(self, account_id: int, amount: float, result: RiskResult) -> None:
        with get_connection() as conn:
            row = conn.execute(
                """SELECT COALESCE(AVG(amount),0) AS avg_a,
                          COALESCE(STDDEV(amount),0) AS std_a,
                          COUNT(*) AS cnt
                   FROM transactions
                   WHERE account_id = %s AND direction = 'out'
                     AND created_at >= NOW() - (%s || ' days')::INTERVAL""",
                (account_id, str(self.LOOKBACK_DAYS))
            ).fetchone()
        if not row or int(row['cnt']) < 3:
            return   # недостатньо даних
        avg = float(row['avg_a'])
        std = float(row['std_a'])
        if avg < 1:
            return
        ratio = amount / avg
        zscore = _zscore(amount, avg, std) if std > 0 else 0.0
        if ratio >= self.HARD_MULTIPLIER:
            membership = _fuzzy_high(ratio, self.HARD_MULTIPLIER, 0.3)
            delta = int(45 * membership)
            result.add(delta, 'amount_critical',
                       amount=amount, avg_amount=round(avg,2),
                       ratio=round(ratio,2), zscore=round(zscore,2))
        elif ratio >= self.SOFT_MULTIPLIER or zscore >= 3.0:
            membership = _fuzzy_high(ratio, self.SOFT_MULTIPLIER, 0.4)
            delta = int(25 * membership)
            result.add(delta, 'amount_high',
                       amount=amount, avg_amount=round(avg,2),
                       ratio=round(ratio,2), zscore=round(zscore,2))


class DuplicateTransferRule:
    """Точний або нечіткий дублікат переказу (та сама сума + отримувач)."""
    WINDOW_MINUTES = 10
    FUZZY_AMOUNT_TOLERANCE = 0.01   # 1% різниця = "нечіткий дублікат"

    def evaluate(self, account_id: int, recipient_account: str,
                 amount: float, result: RiskResult) -> None:
        with get_connection() as conn:
            rows = conn.execute(
                """SELECT amount FROM transactions
                   WHERE account_id = %s
                     AND direction = 'out'
                     AND related_account = %s
                     AND created_at >= NOW() - (%s || ' minutes')::INTERVAL
                   ORDER BY created_at DESC LIMIT 10""",
                (account_id, recipient_account, str(self.WINDOW_MINUTES))
            ).fetchall()
        if not rows:
            return
        for row in rows:
            prev_amount = float(row['amount'])
            # Нечітке порівняння суми
            if abs(prev_amount - amount) / (max(amount, prev_amount) + 1e-9) <= self.FUZZY_AMOUNT_TOLERANCE:
                result.add(60, 'duplicate_transfer',
                           duplicate_amount=amount,
                           prev_amount=prev_amount,
                           recipient=recipient_account,
                           window_min=self.WINDOW_MINUTES)
                return  # достатньо одного дубліката


class SplitTransactionRule:
    """Кілька малих переказів одному отримувачу за короткий час (smurfing)."""
    WINDOW_MINUTES = 15
    MIN_COUNT = 3
    THRESHOLD_TOTAL = 10_000

    def evaluate(self, account_id: int, recipient_account: str,
                 amount: float, result: RiskResult) -> None:
        with get_connection() as conn:
            row = conn.execute(
                """SELECT COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS total
                   FROM transactions
                   WHERE account_id = %s
                     AND direction = 'out'
                     AND related_account = %s
                     AND created_at >= NOW() - (%s || ' minutes')::INTERVAL""",
                (account_id, recipient_account, str(self.WINDOW_MINUTES))
            ).fetchone()
        if not row:
            return
        cnt = int(row['cnt'])
        total = float(row['total']) + amount
        if cnt >= self.MIN_COUNT and total >= self.THRESHOLD_TOTAL:
            membership = _fuzzy_high(total, self.THRESHOLD_TOTAL, 0.5)
            delta = int(35 * membership)
            result.add(delta, 'split_transaction',
                       split_count=cnt + 1, split_total=round(total,2),
                       threshold=self.THRESHOLD_TOTAL)


class NewRecipientRule:
    """Перший переказ на цей рахунок — помірний ризик."""
    def evaluate(self, account_id: int, recipient_account: str,
                 result: RiskResult) -> None:
        with get_connection() as conn:
            row = conn.execute(
                """SELECT COUNT(*) AS cnt FROM transactions
                   WHERE account_id = %s AND related_account = %s
                     AND direction = 'out'""",
                (account_id, recipient_account)
            ).fetchone()
        if row and int(row['cnt']) == 0:
            result.add(10, 'new_recipient', recipient=recipient_account)


class TimeAnomalyRule:
    """Підозрілий час доби (2:00–5:00 UTC)."""
    SUSPICIOUS_HOUR_START = 2
    SUSPICIOUS_HOUR_END   = 5

    def evaluate(self, result: RiskResult) -> None:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT EXTRACT(HOUR FROM NOW()) AS h"
            ).fetchone()
        if not row:
            return
        hour = int(float(row['h']))
        if self.SUSPICIOUS_HOUR_START <= hour < self.SUSPICIOUS_HOUR_END:
            result.add(15, 'time_anomaly', hour_utc=hour)


class RoundAmountRule:
    """Дуже кругла сума (ознака розщеплення або тест-переказу)."""
    ROUND_THRESHOLD = 5_000
    ROUND_MODULO    = 1_000

    def evaluate(self, amount: float, result: RiskResult) -> None:
        if amount >= self.ROUND_THRESHOLD and amount % self.ROUND_MODULO == 0:
            membership = _fuzzy_high(amount, self.ROUND_THRESHOLD, 1.0)
            delta = int(12 * membership)
            result.add(delta, 'round_amount', amount=amount)


# ── Engine ────────────────────────────────────────────────────────────────────

class FraudEngine:
    """Оркеструє всі правила і повертає загальний RiskResult."""

    def __init__(self):
        self._velocity  = VelocityRule()
        self._high_amt  = HighAmountRule()
        self._duplicate = DuplicateTransferRule()
        self._split     = SplitTransactionRule()
        self._new_recv  = NewRecipientRule()
        self._time      = TimeAnomalyRule()
        self._round     = RoundAmountRule()

    def assess(
        self,
        account_id: int,
        recipient_account: Optional[str],
        amount: float,
    ) -> RiskResult:
        result = RiskResult()
        self._velocity.evaluate(account_id, result)
        self._high_amt.evaluate(account_id, amount, result)
        self._round.evaluate(amount, result)
        self._time.evaluate(result)
        if recipient_account:
            self._duplicate.evaluate(account_id, recipient_account, amount, result)
            self._split.evaluate(account_id, recipient_account, amount, result)
            self._new_recv.evaluate(account_id, recipient_account, result)
        return result

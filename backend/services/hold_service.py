"""Authorization Hold Service — Army Bank COBOL-style pre-authorization.

Lifecycle COBOL-банківського hold:
  AUTHORIZE  → рахунок: available_balance = balance - hold_amount
  CAPTURE    → hold знімається, транзакція проводиться (hold → transaction)
  RELEASE    → hold знімається без транзакції (timeout або відмова)
  EXPIRE     → автоматично при EOD якщо hold старіший за TTL

Таблиця account_holds зберігає всі hold-и.
available_balance рахується динамічно: balance - SUM(active holds).
"""
from __future__ import annotations

import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional

from ..database import get_connection, get_returning_id_suffix, insert_last_id

# Hold TTL за типом
HOLD_TTL: dict[str, int] = {
    'authorization':   24,   # годин — стандартний pre-auth
    'fraud_review':    72,   # годин — на перевірці антифроду
    'large_transfer': 48,    # годин — великий переказ
    'card_payment':   12,    # годин — платіж карткою
    'default':        24,
}


class HoldService:

    def place_hold(
        self,
        account_id: int,
        amount: float,
        reason: str = 'authorization',
        payment_order_id: Optional[int] = None,
        ttl_hours: Optional[int] = None,
    ) -> int:
        """Блокує кошти на рахунку. Повертає hold_id."""
        if amount <= 0:
            raise ValueError('Сума hold має бути > 0.')

        hours = ttl_hours or HOLD_TTL.get(reason, HOLD_TTL['default'])
        expires_at = (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()

        # Перевіряємо available balance
        avail = self.available_balance(account_id)
        if avail < amount:
            raise ValueError(
                f'Недостатньо доступних коштів для hold: '
                f'доступно {avail:.2f}, потрібно {amount:.2f}.'
            )

        suffix = get_returning_id_suffix()
        with get_connection() as conn:
            cur = conn.execute(
                '''INSERT INTO account_holds
                   (account_id, payment_order_id, amount, reason, status, expires_at)
                   VALUES (%s, %s, %s, %s, 'active', %s)
                ''' + suffix,
                (account_id, payment_order_id, amount, reason, expires_at),
            )
        return insert_last_id(cur)

    def release_hold(self, hold_id: int, account_id: Optional[int] = None) -> bool:
        """Знімає hold без проведення транзакції."""
        now = datetime.now(timezone.utc).isoformat()
        with get_connection() as conn:
            clause = 'AND account_id = %s' if account_id else ''
            params = (now, hold_id, account_id) if account_id else (now, hold_id)
            cur = conn.execute(
                f"UPDATE account_holds SET status='released', released_at=%s"
                f" WHERE id=%s AND status='active' {clause}",
                params,
            )
            return cur.rowcount > 0

    def capture_hold(
        self,
        hold_id: int,
        tx_id: int,
        account_id: Optional[int] = None,
    ) -> bool:
        """Конвертує hold у транзакцію (capture)."""
        now = datetime.now(timezone.utc).isoformat()
        with get_connection() as conn:
            clause = 'AND account_id = %s' if account_id else ''
            params = (now, tx_id, hold_id, account_id) if account_id else (now, tx_id, hold_id)
            cur = conn.execute(
                f"UPDATE account_holds SET status='captured', released_at=%s, capture_tx_id=%s"
                f" WHERE id=%s AND status='active' {clause}",
                params,
            )
            return cur.rowcount > 0

    def available_balance(self, account_id: int) -> float:
        """Доступний баланс = balance − активні holds."""
        with get_connection() as conn:
            acc = conn.execute(
                'SELECT balance FROM accounts WHERE id=%s', (account_id,)
            ).fetchone()
            held = conn.execute(
                "SELECT COALESCE(SUM(amount), 0) AS total"
                " FROM account_holds"
                " WHERE account_id=%s AND status='active' AND expires_at > %s",
                (account_id, datetime.now(timezone.utc).isoformat()),
            ).fetchone()
        if not acc:
            return 0.0
        balance = float(acc['balance'])
        held_amt = float(held['total']) if held else 0.0
        return max(0.0, balance - held_amt)

    def list_holds(self, account_id: int, include_inactive: bool = False) -> list[dict]:
        status_clause = '' if include_inactive else "AND status='active'"
        with get_connection() as conn:
            rows = conn.execute(
                f"SELECT * FROM account_holds WHERE account_id=%s {status_clause}"
                f" ORDER BY created_at DESC LIMIT 100",
                (account_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    def expire_stale_holds(self) -> int:
        """EOD job: помічає прострочені holds як expired. Повертає кількість."""
        now = datetime.now(timezone.utc).isoformat()
        with get_connection() as conn:
            cur = conn.execute(
                "UPDATE account_holds SET status='expired'"
                " WHERE status='active' AND expires_at < %s",
                (now,),
            )
        return cur.rowcount

    def hold_summary(self, account_id: int) -> dict:
        """Зведення hold-ів для відображення в API."""
        with get_connection() as conn:
            row = conn.execute(
                "SELECT"
                "  COUNT(*) FILTER (WHERE status='active')   AS active_cnt,"
                "  COALESCE(SUM(amount) FILTER (WHERE status='active'), 0) AS active_sum,"
                "  COUNT(*) FILTER (WHERE status='expired')  AS expired_cnt,"
                "  COUNT(*) FILTER (WHERE status='captured') AS captured_cnt"
                " FROM account_holds WHERE account_id=%s",
                (account_id,),
            ).fetchone()
        if not row:
            return {'active': 0, 'active_sum': 0.0, 'expired': 0, 'captured': 0}
        return {
            'active':      int(row['active_cnt'] or 0),
            'active_sum':  float(row['active_sum'] or 0),
            'expired':     int(row['expired_cnt'] or 0),
            'captured':    int(row['captured_cnt'] or 0),
        }

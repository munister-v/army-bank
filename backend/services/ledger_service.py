"""Double-entry ledger service — Army Bank COBOL-style processing.

Принцип подвійного запису:
  Кожна платіжна операція породжує рівно дві проводки:
    - DEBIT  на рахунку відправника  (active account: debit = outflow)
    - CREDIT на рахунку отримувача   (active account: credit = inflow)

  Σ(debit) = Σ(credit) завжди — перевіряється reconcile().

Термінологія (банківська, не бухгалтерська):
  debit  → списання з рахунку (баланс ↓)
  credit → зарахування на рахунок (баланс ↑)

Batch EOD reconciliation:
  Перевіряє що за поточний операційний день сума debit = сума credit.
  Виявляє orphan-entries (без payment_order_id) та unsettled операції.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Optional

from ..database import get_connection, get_returning_id_suffix, insert_last_id


class LedgerService:

    # ─── Запис проводок ───────────────────────────────────────────────────────

    def record_transfer(
        self,
        sender_account_id: int,
        recipient_account_id: int,
        amount: float,
        description: str,
        payment_order_id: Optional[int] = None,
        tx_out_id: Optional[int] = None,
        tx_in_id: Optional[int] = None,
        sender_balance_after: Optional[float] = None,
        recipient_balance_after: Optional[float] = None,
        currency: str = 'UAH',
    ) -> tuple[int, int]:
        """Записує пару DEBIT/CREDIT. Повертає (debit_entry_id, credit_entry_id)."""
        suffix = get_returning_id_suffix()
        with get_connection() as conn:
            cur_debit = conn.execute(
                """INSERT INTO journal_entries
                   (payment_order_id, tx_id, account_id, entry_type,
                    amount, currency, description, balance_after, settled)
                   VALUES (%s, %s, %s, 'debit', %s, %s, %s, %s, %s)
                """ + suffix,
                (payment_order_id, tx_out_id, sender_account_id,
                 amount, currency,
                 f'DEBIT: {description}',
                 sender_balance_after,
                 True),
            )
            debit_id = insert_last_id(cur_debit)

            cur_credit = conn.execute(
                """INSERT INTO journal_entries
                   (payment_order_id, tx_id, account_id, entry_type,
                    amount, currency, description, balance_after, settled)
                   VALUES (%s, %s, %s, 'credit', %s, %s, %s, %s, %s)
                """ + suffix,
                (payment_order_id, tx_in_id, recipient_account_id,
                 amount, currency,
                 f'CREDIT: {description}',
                 recipient_balance_after,
                 True),
            )
            credit_id = insert_last_id(cur_credit)

        return debit_id, credit_id

    def record_card_topup(
        self,
        account_id: int,
        card_id: int,
        amount: float,
        account_balance_after: float,
        currency: str = 'UAH',
    ) -> int:
        """Внутрішня проводка: рахунок → картка (debit account, memo credit card)."""
        suffix = get_returning_id_suffix()
        with get_connection() as conn:
            cur = conn.execute(
                """INSERT INTO journal_entries
                   (account_id, entry_type, amount, currency,
                    description, balance_after, settled)
                   VALUES (%s, 'debit', %s, %s, %s, %s, %s)
                """ + suffix,
                (account_id, amount, currency,
                 f'CARD_TOPUP→card#{card_id}',
                 account_balance_after, True),
            )
            return insert_last_id(cur)

    # ─── EOD Reconciliation ───────────────────────────────────────────────────

    def reconcile(self, date_str: Optional[str] = None) -> dict:
        """EOD-звірка за дату (за замовчуванням — сьогодні).

        Повертає:
          ok         — True якщо дебет = кредит
          debit_sum  — сума всіх DEBIT за день
          credit_sum — сума всіх CREDIT за день
          delta      — різниця (має бути 0.00)
          orphans    — записи без payment_order_id
          unsettled  — кількість unsettled записів
          entries    — загальна кількість записів за день
        """
        if date_str is None:
            date_str = datetime.now(timezone.utc).strftime('%Y-%m-%d')

        day_start = f'{date_str} 00:00:00'
        day_end   = f'{date_str} 23:59:59'

        with get_connection() as conn:
            row = conn.execute(
                """SELECT
                     COALESCE(SUM(CASE WHEN entry_type='debit'  THEN amount ELSE 0 END), 0) AS debit_sum,
                     COALESCE(SUM(CASE WHEN entry_type='credit' THEN amount ELSE 0 END), 0) AS credit_sum,
                     COUNT(*) AS total_entries,
                     SUM(CASE WHEN payment_order_id IS NULL THEN 1 ELSE 0 END) AS orphan_cnt,
                     SUM(CASE WHEN settled = %s THEN 1 ELSE 0 END) AS unsettled_cnt
                   FROM journal_entries
                   WHERE created_at BETWEEN %s AND %s
                """,
                (False, day_start, day_end),
            ).fetchone()

        if not row:
            return {'ok': True, 'message': 'Записів за дату не знайдено', 'date': date_str}

        debit_sum  = round(float(row['debit_sum']),  2)
        credit_sum = round(float(row['credit_sum']), 2)
        delta      = round(debit_sum - credit_sum,   2)

        return {
            'ok':          delta == 0.0,
            'date':        date_str,
            'debit_sum':   debit_sum,
            'credit_sum':  credit_sum,
            'delta':       delta,
            'entries':     int(row['total_entries']),
            'orphans':     int(row['orphan_cnt'] or 0),
            'unsettled':   int(row['unsettled_cnt'] or 0),
            'balanced':    delta == 0.0,
        }

    def get_account_statement(
        self,
        account_id: int,
        days: int = 30,
    ) -> list[dict]:
        """Журнал проводок рахунку за N днів."""
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        with get_connection() as conn:
            rows = conn.execute(
                """SELECT je.*, po.risk_level, po.risk_score
                   FROM journal_entries je
                   LEFT JOIN payment_orders po ON je.payment_order_id = po.id
                   WHERE je.account_id = %s AND je.created_at >= %s
                   ORDER BY je.created_at DESC
                   LIMIT 500
                """,
                (account_id, cutoff),
            ).fetchall()
        return [dict(r) for r in rows]

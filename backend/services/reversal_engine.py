"""Reversal Engine — COBOL-style transaction reversal (сторнування).

COBOL banking reversal logic:
  1. Знаходимо оригінальний payment_order (має бути completed)
  2. Перевіряємо: вікно сторнування (48 год), статус, наявність коштів у отримувача
  3. Атомарно: credit sender + debit recipient (зворотній напрямок)
  4. Записуємо 2 нові транзакції типу 'reversal'
  5. Записуємо дві зворотні journal_entries (CREDIT → sender, DEBIT → recipient)
  6. Записуємо запис у transaction_reversals
  7. Оновлюємо статус оригінального order → 'reversed'

Часткові сторнування не підтримуються (full reversal only).
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Optional

from ..database import get_connection, get_returning_id_suffix, insert_last_id
from ..repositories.account_repository import AccountRepository
from ..repositories.payment_repository import PaymentRepository
from ..services.ledger_service import LedgerService

REVERSAL_WINDOW_HOURS = 48   # максимальний вік order для сторнування


class ReversalEngine:

    def __init__(self):
        self._accounts  = AccountRepository()
        self._payments  = PaymentRepository()
        self._ledger    = LedgerService()

    def reverse(
        self,
        original_order_id: int,
        initiated_by_user_id: int,
        reason: str = 'customer_request',
    ) -> dict:
        """Виконує повне сторнування платежу.

        Returns:
            {
              'reversal_id': int,
              'original_order_id': int,
              'amount': float,
              'new_sender_balance': float,
              'new_recipient_balance': float,
            }
        """
        # 1. Завантажуємо оригінальний order
        order = self._load_order(original_order_id)
        if not order:
            raise ValueError(f'Платіж #{original_order_id} не знайдено.')
        if order['status'] == 'reversed':
            raise ValueError('Цей платіж вже сторновано.')
        if order['status'] != 'completed':
            raise ValueError(
                f'Можна сторнувати лише completed-платежі (статус: {order["status"]}).'
            )

        # 2. Перевіряємо вікно
        age_hours = self._order_age_hours(order['created_at'])
        if age_hours > REVERSAL_WINDOW_HOURS:
            raise ValueError(
                f'Вікно сторнування ({REVERSAL_WINDOW_HOURS} год) минуло '
                f'(вік: {age_hours:.1f} год).'
            )

        # 3. Перевіряємо чи вже є reversal
        existing = self._find_existing_reversal(original_order_id)
        if existing:
            raise ValueError(f'Сторнування вже існує (reversal #{existing["id"]}).')

        amount           = float(order['amount'])
        sender_acc_id    = order['sender_account_id']
        recipient_acc_id = order['recipient_account_id']

        sender    = self._accounts.get_account_by_user_id(None)   # replaced below
        recipient = None

        with get_connection() as conn:
            s_row = conn.execute('SELECT * FROM accounts WHERE id=%s', (sender_acc_id,)).fetchone()
            r_row = conn.execute('SELECT * FROM accounts WHERE id=%s', (recipient_acc_id,)).fetchone()
        if not s_row or not r_row:
            raise ValueError('Рахунки платежу не знайдено.')

        sender    = dict(s_row)
        recipient = dict(r_row)

        # 4. Перевіряємо баланс отримувача (в нього мають бути кошти для повернення)
        if float(recipient['balance']) < amount:
            raise ValueError(
                f'Недостатньо коштів у отримувача для сторнування: '
                f'{float(recipient["balance"]):.2f} < {amount:.2f}.'
            )

        # 5. Атомарне сторнування
        reversal_tx_out_id, reversal_tx_in_id = self._execute_atomic_reversal(
            original_order=order,
            sender=sender,
            recipient=recipient,
            amount=amount,
            reason=reason,
        )

        # 6. Журнальні записи (зворотні)
        try:
            with get_connection() as conn:
                s_new = conn.execute('SELECT balance FROM accounts WHERE id=%s', (sender_acc_id,)).fetchone()
                r_new = conn.execute('SELECT balance FROM accounts WHERE id=%s', (recipient_acc_id,)).fetchone()
            s_bal = float(s_new['balance']) if s_new else None
            r_bal = float(r_new['balance']) if r_new else None

            # Reversal: CREDIT → sender (відновлення), DEBIT → recipient (списання повернення)
            self._ledger.record_transfer(
                sender_account_id=recipient_acc_id,    # recipient pays back
                recipient_account_id=sender_acc_id,    # sender gets refunded
                amount=amount,
                description=f'REVERSAL of order#{original_order_id}: {reason}',
                tx_out_id=reversal_tx_out_id,
                tx_in_id=reversal_tx_in_id,
                sender_balance_after=r_bal,
                recipient_balance_after=s_bal,
            )
        except Exception:
            pass

        # 7. Запис reversal + оновлення статусу order
        reversal_id = self._save_reversal(
            original_order_id=original_order_id,
            reversal_tx_out_id=reversal_tx_out_id,
            reversal_tx_in_id=reversal_tx_in_id,
            amount=amount,
            reason=reason,
            initiated_by=initiated_by_user_id,
        )
        self._mark_order_reversed(original_order_id)

        with get_connection() as conn:
            s_final = conn.execute('SELECT balance FROM accounts WHERE id=%s', (sender_acc_id,)).fetchone()
            r_final = conn.execute('SELECT balance FROM accounts WHERE id=%s', (recipient_acc_id,)).fetchone()

        return {
            'reversal_id':          reversal_id,
            'original_order_id':    original_order_id,
            'amount':               amount,
            'reason':               reason,
            'new_sender_balance':   float(s_final['balance']) if s_final else None,
            'new_recipient_balance': float(r_final['balance']) if r_final else None,
        }

    # ── Private ───────────────────────────────────────────────────────────────

    def _execute_atomic_reversal(
        self, original_order: dict,
        sender: dict, recipient: dict,
        amount: float, reason: str,
    ) -> tuple[int, int]:
        suffix = get_returning_id_suffix()
        desc_out = f'Сторнування переказу #{original_order["id"]}: {reason}'
        desc_in  = f'Повернення коштів від сторнування #{original_order["id"]}'

        with get_connection() as conn:
            # Debit recipient (повертає кошти)
            cur = conn.execute(
                'UPDATE accounts SET balance = balance - %s'
                ' WHERE id = %s AND balance >= %s',
                (amount, recipient['id'], amount),
            )
            if cur.rowcount == 0:
                raise ValueError('Баланс отримувача змінився — сторнування неможливе.')

            # Credit sender (отримує назад)
            conn.execute(
                'UPDATE accounts SET balance = balance + %s WHERE id = %s',
                (amount, sender['id']),
            )

            # Транзакція списання з отримувача (reversal out)
            cur_out = conn.execute(
                "INSERT INTO transactions"
                " (account_id, tx_type, direction, amount, description,"
                "  related_account, payment_order_id)"
                " VALUES (%s, 'reversal', 'out', %s, %s, %s, %s)" + suffix,
                (recipient['id'], amount, desc_out,
                 sender['account_number'], original_order['id']),
            )
            tx_out_id = insert_last_id(cur_out)

            # Транзакція зарахування відправнику (reversal in)
            cur_in = conn.execute(
                "INSERT INTO transactions"
                " (account_id, tx_type, direction, amount, description,"
                "  related_account, payment_order_id)"
                " VALUES (%s, 'reversal', 'in', %s, %s, %s, %s)" + suffix,
                (sender['id'], amount, desc_in,
                 recipient['account_number'], original_order['id']),
            )
            tx_in_id = insert_last_id(cur_in)

        return tx_out_id, tx_in_id

    def _load_order(self, order_id: int) -> Optional[dict]:
        with get_connection() as conn:
            row = conn.execute(
                'SELECT * FROM payment_orders WHERE id=%s', (order_id,)
            ).fetchone()
        return dict(row) if row else None

    def _find_existing_reversal(self, original_order_id: int) -> Optional[dict]:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT * FROM transaction_reversals"
                " WHERE original_order_id=%s AND status != 'failed'",
                (original_order_id,),
            ).fetchone()
        return dict(row) if row else None

    def _save_reversal(
        self, original_order_id: int,
        reversal_tx_out_id: int, reversal_tx_in_id: int,
        amount: float, reason: str, initiated_by: int,
    ) -> int:
        suffix = get_returning_id_suffix()
        now = datetime.now(timezone.utc).isoformat()
        with get_connection() as conn:
            cur = conn.execute(
                '''INSERT INTO transaction_reversals
                   (original_order_id, reversal_tx_out_id, reversal_tx_in_id,
                    amount, reason, initiated_by, status, completed_at)
                   VALUES (%s, %s, %s, %s, %s, %s, 'completed', %s)
                ''' + suffix,
                (original_order_id, reversal_tx_out_id, reversal_tx_in_id,
                 amount, reason, initiated_by, now),
            )
        return insert_last_id(cur)

    def _mark_order_reversed(self, order_id: int) -> None:
        with get_connection() as conn:
            conn.execute(
                "UPDATE payment_orders SET status='reversed' WHERE id=%s",
                (order_id,),
            )

    @staticmethod
    def _order_age_hours(created_at) -> float:
        try:
            if isinstance(created_at, datetime):
                dt = created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc)
            else:
                s = str(created_at).replace(' ', 'T').replace('Z', '+00:00')
                dt = datetime.fromisoformat(s)
            return (datetime.now(timezone.utc) - dt).total_seconds() / 3600
        except Exception:
            return float('inf')

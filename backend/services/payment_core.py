"""Платіжний движок: state machine + атомарна обробка."""
from __future__ import annotations

import secrets
from typing import Optional

from ..database import get_connection, get_returning_id_suffix, insert_last_id
from ..repositories.account_repository import AccountRepository
from ..repositories.payment_repository import PaymentRepository
from ..repositories.feature_repository import FeatureRepository
from ..services.fraud_engine import FraudEngine, RISK_CRITICAL
from ..services.integrity_service import IntegrityService


class PaymentCore:
    """Централізована точка входу для всіх платіжних операцій."""

    def __init__(self):
        self._accounts    = AccountRepository()
        self._payments    = PaymentRepository()
        self._features    = FeatureRepository()
        self._fraud       = FraudEngine()
        self._integrity   = IntegrityService()

    # ─────────────────────────────────────────────────────────────────────────
    # Public API
    # ─────────────────────────────────────────────────────────────────────────

    def transfer(
        self,
        user_id: int,
        recipient_account_number: str,
        amount: float,
        description: str,
        idempotency_key: Optional[str] = None,
    ) -> dict:
        """Виконує переказ через state machine з перевіркою шахрайства.

        Returns: {'account': ..., 'order_id': ..., 'risk': ...}
        """
        if idempotency_key is None:
            idempotency_key = secrets.token_hex(16)

        # Ідемпотентність: якщо вже є — повертаємо результат
        existing = self._payments.get_by_idempotency_key(idempotency_key)
        if existing and existing['status'] == 'completed':
            account = self._accounts.get_account_by_user_id(user_id)
            return {
                'account': dict(account),
                'order_id': existing['id'],
                'idempotent': True,
                'risk': {'level': existing.get('risk_level', 'low')},
            }

        # ── 1. Валідація ──────────────────────────────────────────────────────
        if amount <= 0 or amount > 99_999_999.99:
            raise ValueError('Недійсна сума переказу.')

        sender = self._accounts.get_account_by_user_id(user_id)
        if not sender:
            raise ValueError('Рахунок відправника не знайдено.')
        recipient = self._accounts.get_account_by_number(recipient_account_number.strip())
        if not recipient:
            raise ValueError('Рахунок отримувача не знайдено.')
        if recipient['id'] == sender['id']:
            raise ValueError('Неможливо переказати кошти на власний рахунок.')
        if float(sender['balance']) < amount:
            raise ValueError('Недостатньо коштів на рахунку.')

        # ── 2. Оцінка ризику ──────────────────────────────────────────────────
        risk = self._fraud.assess(
            sender['id'], recipient_account_number, amount,
            balance=float(sender['balance']),
            description=description,
            recipient_account_id=recipient['id'],
        )

        # ── 3. Створюємо order у статусі pending ─────────────────────────────
        order_id = self._payments.create_order(
            idempotency_key=idempotency_key,
            initiator_user_id=user_id,
            sender_account_id=sender['id'],
            recipient_account_id=recipient['id'],
            amount=amount,
            description=description,
            risk_score=risk.score,
            risk_level=risk.level,
            risk_flags=risk.flags,
        )

        # ── 4. Критичний ризик — блокуємо ────────────────────────────────────
        if risk.level == RISK_CRITICAL:
            self._payments.set_status(order_id, 'blocked',
                                      failure_reason='Заблоковано антифрод-системою.')
            self._save_risk_events(order_id, user_id, risk)
            self._features.add_audit_log(
                user_id, 'payment_blocked',
                f'Переказ {amount:.2f} грн заблоковано (score={risk.score}).'
            )
            raise ValueError(
                f'Переказ заблоковано системою безпеки (ризик: {risk.score}/100). '
                'Зверніться до підтримки.'
            )

        # ── 5. Переказуємо → processing ──────────────────────────────────────
        self._payments.set_status(order_id, 'processing')

        try:
            tx_out_id, tx_in_id = self._execute_atomic_transfer(
                sender=sender, recipient=recipient,
                amount=amount, description=description,
                order_id=order_id,
            )
            self._payments.set_status(order_id, 'completed',
                                      tx_id_out=tx_out_id, tx_id_in=tx_in_id)
        except Exception as exc:
            self._payments.set_status(order_id, 'failed',
                                      failure_reason=str(exc))
            raise

        # ── 6. Post-processing ────────────────────────────────────────────────
        if risk.flags:
            self._save_risk_events(order_id, user_id, risk)

        self._features.add_audit_log(
            user_id, 'transfer',
            f'Переказ {amount:.2f} грн на {recipient_account_number} '
            f'(order={order_id}, risk={risk.level}).'
        )

        # Notify recipient
        try:
            self._features.create_notification(
                recipient['user_id'], 'transfer_received',
                f'Надходження ₴{amount:,.0f}'.replace(',', ' '),
                f'Від {sender["account_number"]}: {description}',
                '💸',
            )
        except Exception:
            pass

        updated_account = self._accounts.get_account_by_user_id(user_id)
        return {
            'account': dict(updated_account),
            'order_id': order_id,
            'tx_id': tx_out_id,
            'idempotent': False,
            'risk': risk.to_dict(),
        }

    # ─────────────────────────────────────────────────────────────────────────
    # Private helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _execute_atomic_transfer(
        self,
        sender: dict, recipient: dict,
        amount: float, description: str,
        order_id: int,
    ) -> tuple[int, int]:
        """Атомарне подвійне списання/зарахування в одній транзакції БД.
        Баланс перевіряється ВСЕРЕДИНІ транзакції щоб унеможливити race condition.
        Повертає (tx_out_id, tx_in_id)."""

        suffix = get_returning_id_suffix()

        with get_connection() as conn:
            # Атомарне списання: арифметика виконується в БД щоб уникнути race condition.
            # WHERE balance >= amount — якщо інший запит вже зняв кошти, rowcount=0 → rollback.
            cur_debit = conn.execute(
                'UPDATE accounts SET balance = balance - %s'
                ' WHERE id = %s AND balance >= %s',
                (amount, sender['id'], amount)
            )
            if cur_debit.rowcount == 0:
                raise ValueError('Недостатньо коштів — баланс змінився, спробуйте ще раз.')

            # Зарахування отримувачу (завжди успішно — баланс не може стати від'ємним)
            conn.execute(
                'UPDATE accounts SET balance = balance + %s WHERE id = %s',
                (amount, recipient['id'])
            )

            # Record outgoing transaction
            cur_out = conn.execute(
                """INSERT INTO transactions
                   (account_id, tx_type, direction, amount, description,
                    related_account, payment_order_id)
                   VALUES (%s,'transfer','out',%s,%s,%s,%s)
                """ + suffix,
                (sender['id'], amount, description,
                 recipient['account_number'], order_id)
            )
            tx_out_id = insert_last_id(cur_out)

            # Record incoming transaction
            cur_in = conn.execute(
                """INSERT INTO transactions
                   (account_id, tx_type, direction, amount, description,
                    related_account, payment_order_id)
                   VALUES (%s,'transfer','in',%s,%s,%s,%s)
                """ + suffix,
                (recipient['id'], amount,
                 f'Надходження: {description}',
                 sender['account_number'], order_id)
            )
            tx_in_id = insert_last_id(cur_in)

        # Record integrity hashes (non-atomic, best-effort)
        try:
            import datetime
            now_str = datetime.datetime.now(datetime.timezone.utc).isoformat()
            self._integrity.record(tx_out_id, sender['id'], amount, 'out', now_str)
            self._integrity.record(tx_in_id, recipient['id'], amount, 'in', now_str)
        except Exception:
            pass

        return tx_out_id, tx_in_id

    def _save_risk_events(self, order_id: int, user_id: int, risk) -> None:
        import json
        for flag in risk.flags:
            severity = risk.level
            details = json.dumps({'flag': flag, **risk.details}, ensure_ascii=False)
            try:
                self._payments.create_risk_event(
                    payment_order_id=order_id,
                    user_id=user_id,
                    event_type=flag,
                    severity=severity,
                    score_delta=risk.score,
                    details=details,
                )
            except Exception:
                pass

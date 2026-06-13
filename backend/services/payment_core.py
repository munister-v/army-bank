"""Платіжний движок: state machine + атомарна обробка.

Цей модуль — центральна точка для будь-яких переказів коштів між рахунками.
Кожен переказ проходить через state machine зі статусами:

    pending -> processing -> completed
                           -> failed
            -> blocked (якщо антифрод визначив критичний ризик)

Ключові гарантії:
  * Ідемпотентність — повторний запит з тим же idempotency_key не призведе
    до повторного списання коштів.
  * Атомарність — списання й зарахування виконуються в одній SQL-транзакції,
    а перевірка достатності балансу відбувається ВСЕРЕДИНІ запиту
    (`WHERE balance >= %s`), що захищає від race condition при паралельних
    запитах на той самий рахунок.
  * Антифрод — кожен переказ оцінюється FraudEngine ще до зміни балансів;
    переказ з критичним рівнем ризику блокується і взагалі не виконується.
  * Подвійний запис (double-entry ledger) і хеші цілісності записуються
    "best-effort" після основної транзакції — їхній збій ніколи не повинен
    відкочувати вже завершений переказ.
"""
from __future__ import annotations

import secrets
from typing import Optional

from ..database import get_connection, get_returning_id_suffix, insert_last_id
from ..repositories.account_repository import AccountRepository
from ..repositories.payment_repository import PaymentRepository
from ..repositories.feature_repository import FeatureRepository
from ..services.fraud_engine import FraudEngine, RISK_CRITICAL
from ..services.integrity_service import IntegrityService
from ..services.ledger_service import LedgerService


class PaymentCore:
    """Централізована точка входу для всіх платіжних операцій."""

    def __init__(self):
        self._accounts    = AccountRepository()   # CRUD по таблиці accounts
        self._payments    = PaymentRepository()   # таблиці payment_orders / risk_events
        self._features    = FeatureRepository()   # audit_logs, notifications тощо
        self._fraud       = FraudEngine()          # fuzzy-логіка оцінки ризику
        self._integrity   = IntegrityService()     # хеші цілісності транзакцій
        self._ledger      = LedgerService()        # подвійний запис (double-entry)

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
        # Якщо ключ ідемпотентності не передано (старий клієнт або одноразовий
        # виклик) — генеруємо випадковий, щоб логіка нижче лишалась єдиною.
        if idempotency_key is None:
            idempotency_key = secrets.token_hex(16)

        # Ідемпотентність: клієнт може повторити запит (наприклад через таймаут
        # мережі), не знаючи чи він пройшов. Якщо order з таким ключем вже
        # завершено успішно — повертаємо той самий результат без повторного
        # списання коштів.
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
        # Верхня межа суми відповідає DECIMAL(10,2) у схемі БД (макс. 8 цифр
        # до коми), що захищає від переповнення / некоректних значень.
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
        # Попередня (не атомарна) перевірка балансу — дає швидку та зрозумілу
        # помилку користувачу одразу. Остаточна, атомарна перевірка все одно
        # виконується пізніше в _execute_atomic_transfer().
        if float(sender['balance']) < amount:
            raise ValueError('Недостатньо коштів на рахунку.')

        # ── 2. Оцінка ризику ──────────────────────────────────────────────────
        # FraudEngine аналізує суму, історію відправника, отримувача,
        # текст опису тощо та повертає RiskResult зі score (0-100),
        # рівнем (low/medium/high/critical) та списком прапорців-причин.
        risk = self._fraud.assess(
            sender['id'], recipient_account_number, amount,
            balance=float(sender['balance']),
            description=description,
            recipient_account_id=recipient['id'],
        )

        # ── 3. Створюємо order у статусі pending ─────────────────────────────
        # Запис створюється ДО будь-якої зміни балансів — це дає аудиторський
        # слід навіть для переказів, які згодом будуть заблоковані або
        # провалені.
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
        # Якщо антифрод визначив критичний рівень ризику, переказ зупиняється
        # ДО будь-якого руху коштів: статус -> 'blocked', баланси не зачіпаються.
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
            # Будь-яка помилка атомарної транзакції (включно з race condition
            # на балансі) переводить order у статус 'failed' і прокидається
            # далі — гроші НЕ списуються, оскільки UPDATE був у транзакції,
            # яка не закомітилась.
            self._payments.set_status(order_id, 'failed',
                                      failure_reason=str(exc))
            raise

        # ── 6. Post-processing ────────────────────────────────────────────────
        # Навіть для успішних переказів зі ненульовими прапорцями ризику
        # (low/medium/high, але не critical) зберігаємо risk_events —
        # це дає антифрод-системі історію для майбутніх оцінок.
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

        # SQLite й PostgreSQL по-різному повертають id вставленого рядка
        # (RETURNING id у Postgres, lastrowid у SQLite) — суфікс і
        # insert_last_id() інкапсулюють цю різницю.
        suffix = get_returning_id_suffix()

        with get_connection() as conn:
            # Атомарне списання: арифметика виконується в БД (balance - %s),
            # а не в Python, щоб виключити проміжок часу між читанням і
            # записом балансу. Умова `WHERE balance >= amount` —
            # це CAS (compare-and-swap): якщо паралельний запит вже встиг
            # списати кошти й балансу не вистачає, rowcount буде 0.
            cur_debit = conn.execute(
                'UPDATE accounts SET balance = balance - %s'
                ' WHERE id = %s AND balance >= %s',
                (amount, sender['id'], amount)
            )
            if cur_debit.rowcount == 0:
                # rowcount == 0 означає, що CAS не спрацював: баланс змінився
                # між попередньою (не атомарною) перевіркою у transfer() і
                # цим UPDATE. Кидаємо помилку — `with get_connection()` зробить
                # rollback, жодних змін у БД не залишиться.
                raise ValueError('Недостатньо коштів — баланс змінився, спробуйте ще раз.')

            # Зарахування отримувачу. Завжди виконується успішно — додавання
            # додатної суми не може зробити баланс від'ємним, тож тут CAS
            # не потрібен.
            conn.execute(
                'UPDATE accounts SET balance = balance + %s WHERE id = %s',
                (amount, recipient['id'])
            )

            # Запис вихідної транзакції (направлення 'out') для відправника.
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

            # Запис вхідної транзакції (направлення 'in') для отримувача,
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

        # Основна атомарна транзакція вище вже закомічена (вихід з `with`).
        # Тепер читаємо оновлені баланси окремим запитом — вони потрібні лише
        # для запису в журнал (ledger), сам переказ уже виконано і незворотний.
        sender_bal_after = None
        recipient_bal_after = None
        try:
            with get_connection() as conn:
                s_row = conn.execute('SELECT balance FROM accounts WHERE id=%s', (sender['id'],)).fetchone()
                r_row = conn.execute('SELECT balance FROM accounts WHERE id=%s', (recipient['id'],)).fetchone()
                sender_bal_after    = float(s_row['balance']) if s_row else None
                recipient_bal_after = float(r_row['balance']) if r_row else None
        except Exception:
            pass

        # Подвійний запис (double-entry journal): фіксує дебет/кредит у
        # бухгалтерському сенсі для подальшого аудиту/звірки. Виконується
        # "best-effort" — переказ вже відбувся, тож збій журналювання
        # не повинен впливати на результат для користувача.
        try:
            self._ledger.record_transfer(
                sender_account_id=sender['id'],
                recipient_account_id=recipient['id'],
                amount=amount,
                description=description,
                payment_order_id=order_id,
                tx_out_id=tx_out_id,
                tx_in_id=tx_in_id,
                sender_balance_after=sender_bal_after,
                recipient_balance_after=recipient_bal_after,
            )
        except Exception:
            pass

        # Хеші цілісності (IntegrityService) — криптографічний "відбиток"
        # кожної транзакції, що дозволяє згодом виявити ручне втручання в БД
        # (підміну суми/рахунку напряму через SQL, минаючи API).
        # Записуються поза основною транзакцією — best-effort.
        try:
            import datetime
            now_str = datetime.datetime.now(datetime.timezone.utc).isoformat()
            self._integrity.record(tx_out_id, sender['id'], amount, 'out', now_str)
            self._integrity.record(tx_in_id, recipient['id'], amount, 'in', now_str)
        except Exception:
            pass

        return tx_out_id, tx_in_id

    def _save_risk_events(self, order_id: int, user_id: int, risk) -> None:
        """Зберігає в таблицю risk_events по одному запису на кожен
        прапорець (flag), виставлений FraudEngine для цього переказу.

        Це окремі рядки, а не один JSON-блок, щоб згодом можна було
        будувати статистику/звіти по типах ризиків (SQL GROUP BY event_type).
        Викликається як для заблокованих (critical), так і для пропущених,
        але позначених прапорцями переказів.
        """
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
                # Збій запису risk_event не повинен впливати на сам переказ —
                # дані вже зафіксовано в payment_orders.risk_flags (JSON).
                pass

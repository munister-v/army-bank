"""Маршрути для ролі оператора — управління виплатами солдатам.

Оператор — привілейована роль між звичайним солдатом і адміном. Може:
  - переглядати список солдатів (тільки роль 'soldier')
  - нараховувати виплати на рахунок солдата

Виплати захищені ідемпотентністю (Idempotency-Key): якщо мережевий запит
надійшов двічі, гроші зараховуються лише один раз.
Rate-limit на виплати: CRITICAL_ADMIN_MUTATION_RATE_LIMIT (невелика кількість
запитів за вікно), щоб не можна було масово нараховувати кошти автоматизовано.
"""
from __future__ import annotations

from flask import Blueprint, jsonify, request, g

from ..config import (
    CRITICAL_ADMIN_MUTATION_RATE_LIMIT,    # ліміт запитів (напр. 10 за вікно)
    CRITICAL_RATE_LIMIT_WINDOW_SECONDS,    # ширина вікна (напр. 60 секунд)
)
from ..repositories.account_repository import AccountRepository  # баланс/транзакції рахунків
from ..repositories.feature_repository import FeatureRepository  # виплати та аудит-логи
from ..repositories.user_repository import UserRepository        # пошук користувача по id
from ..services.idempotency_service import IdempotencyService    # захист від подвійного списання
from ..utils.validators import validate_positive_amount          # перевірка суми > 0
from .helpers import (
    api_error,                # форматує відповідь {ok: false, error: "..."}
    auth_required,            # декоратор: перевіряє Bearer-токен
    role_required,            # декоратор: перевіряє роль (403 якщо не та)
    actor_rate_key,           # будує ключ rate-limit по user_id оператора
    rate_limit,               # декоратор: обмежує кількість запитів
    require_idempotency_key,  # витягує Idempotency-Key з заголовка або body
)

operator_bp = Blueprint('operator', __name__, url_prefix='/api/operator')
user_repo           = UserRepository()       # для пошуку цільового солдата
account_repo        = AccountRepository()    # для читання/оновлення балансу
feature_repo        = FeatureRepository()    # для запису виплат і аудит-логів
idempotency_service = IdempotencyService()   # для reserve/complete/release-processing


# ── Список солдатів ───────────────────────────────────────────────────────────

@operator_bp.get('/users')
@auth_required
@role_required('operator', 'admin')   # і оператор, і адмін можуть бачити список
def list_users():
    """GET /api/operator/users — список користувачів з роллю 'soldier'.

    Оператор бачить тільки солдатів (role_filter='soldier'), не адмінів і не
    інших операторів — щоб зберігати принцип найменших привілеїв.
    """
    try:
        users = user_repo.list_all(role_filter='soldier')   # тільки soldiers, без фільтра пошуку
        return jsonify({'ok': True, 'data': users})
    except Exception as exc:
        return api_error(str(exc))


# ── Нарахування виплати солдату ───────────────────────────────────────────────

@operator_bp.post('/payouts')
@auth_required
@role_required('operator', 'admin')
@rate_limit(
    CRITICAL_ADMIN_MUTATION_RATE_LIMIT,
    CRITICAL_RATE_LIMIT_WINDOW_SECONDS,
    key_func=lambda: actor_rate_key('operator:payouts'),   # ключ: user_id оператора
)
def create_payout_for_user():
    """POST /api/operator/payouts — нарахування виплати на рахунок солдата.

    Body:
      user_id         (int)    — ідентифікатор солдата
      amount          (float)  — сума виплати (грн)
      title           (str)    — призначення (напр. «Бойові виплати за травень»)
      payout_type     (str)    — тип: 'general'|'combat'|'reimbursement' тощо
      idempotency_key (str)    — унікальний ключ операції (опціонально у body)

    Ідемпотентність:
      reserve()      — резервуємо операцію; якщо 'replay' — повертаємо збережений результат
      complete()     — фіксуємо успіх і зберігаємо відповідь для можливого replay
      release_processing() — знімаємо резерв при будь-якій помилці
    """
    idempotency_key = None   # зберігаємо для блоку except
    try:
        data = request.get_json(force=True) or {}

        # ── Ідемпотентний ключ (заголовок або body) ──────────────────────────
        idempotency_key, err = require_idempotency_key(payload=data, allow_body_fallback=True)
        if err:
            return err   # err = flask Response з помилкою (400 або 409)

        # ── Валідація вхідних параметрів ──────────────────────────────────────
        user_id = data.get('user_id')
        if user_id is None:
            return api_error('Потрібно вказати user_id.')
        user_id     = int(user_id)
        title       = (data.get('title')       or 'Виплата').strip()
        payout_type = (data.get('payout_type') or 'general').strip()
        amount      = float(data.get('amount') or 0)
        validate_positive_amount(amount)   # ValueError якщо <= 0 або > MAX_AMOUNT

        # ── Перевіряємо, що солдат і його рахунок існують ────────────────────
        user = user_repo.get_by_id(user_id)
        if not user:
            return api_error('Користувача не знайдено.', 404)
        account = account_repo.get_account_by_user_id(user_id)
        if not account:
            return api_error('Рахунок користувача не знайдено.', 404)

        actor_id = int(g.current_user['id'])   # id оператора (для аудит-логу і ідемпотентності)

        # ── Ідемпотентний резерв (перевіряємо чи не було вже такого запиту) ──
        if idempotency_key:
            reservation = idempotency_service.reserve(
                user_id=actor_id,
                action='operator_payout',
                key=idempotency_key,
                payload={
                    'target_user_id': user_id,
                    'amount': amount,
                    'title': title,
                    'payout_type': payout_type,
                },
            )
            state = reservation.get('state')
            if state == 'conflict':
                # той самий ключ, але інший payload — заборонено (409 Conflict)
                return api_error('Idempotency-Key уже використано з іншим payload.', 409)
            if state == 'replay':
                # точно той самий запит раніше вже виконався — повертаємо закешовану відповідь
                return jsonify(reservation.get('payload') or {'ok': False}), int(reservation.get('response_code') or 200)
            if state == 'processing':
                # операція зараз виконується в іншому потоці — просимо повторити пізніше
                return api_error('Операція вже виконується. Спробуйте пізніше.', 409)

        # ── Безпосереднє нарахування виплати ─────────────────────────────────
        new_balance = round(account['balance'] + amount, 2)       # новий баланс з округленням
        account_repo.update_balance(account['id'], new_balance)   # атомарно оновлюємо баланс
        account_repo.add_transaction(account['id'], 'payout', 'in', amount, title)   # фіксуємо транзакцію
        feature_repo.create_payout(user_id, title, amount, payout_type)              # запис у таблицю виплат
        # Два аудит-логи: один від імені солдата, другий від імені оператора
        feature_repo.add_audit_log(user_id,   'operator_payout', f'Оператор нарахував виплату {amount:.2f} грн.')
        feature_repo.add_audit_log(actor_id,  'operator_payout', f'Нараховано {amount:.2f} грн користувачу id={user_id}.')

        payload = {'ok': True, 'data': {'user_id': user_id, 'amount': amount, 'new_balance': new_balance}}

        # ── Фіксуємо завершення ідемпотентної операції ───────────────────────
        if idempotency_key:
            idempotency_service.complete(
                user_id=actor_id,
                action='operator_payout',
                key=idempotency_key,
                response_payload=payload,   # зберігаємо відповідь для майбутніх replay
                response_code=200,
            )
        return jsonify(payload)

    except ValueError as exc:
        # validate_positive_amount або float() кинули ValueError — знімаємо резерв
        if idempotency_key:
            idempotency_service.release_processing(
                user_id=int(g.current_user['id']),
                action='operator_payout',
                key=idempotency_key,
            )
        return api_error(str(exc))

    except Exception as exc:
        # Будь-який інший виняток (БД, мережа тощо) — також знімаємо резерв
        if idempotency_key:
            idempotency_service.release_processing(
                user_id=int(g.current_user['id']),
                action='operator_payout',
                key=idempotency_key,
            )
        return api_error(str(exc))

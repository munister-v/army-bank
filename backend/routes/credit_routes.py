"""Credit routes — споживчі кредити Army Bank.

Кредит — зарахована на рахунок сума, яку потрібно повернути протягом
term_months місяців. Повернення (repay) може бути частковим або повним.
Обидві операції (create і repay) захищені ідемпотентністю, щоб мережевий
збій не призвів до подвійного зарахування або подвійного списання.

Адмін-ендпоінти дозволяють побачити кредити всіх користувачів з фільтрацією.
"""
from __future__ import annotations

from flask import Blueprint, jsonify, request, g

from ..services.credit_service import CreditService           # видача, погашення, список кредитів
from ..services.idempotency_service import IdempotencyService  # захист від подвійних операцій
from .helpers import api_error, auth_required, require_idempotency_key

credit_bp = Blueprint('credits', __name__, url_prefix='/api')
_svc  = CreditService()            # бізнес-логіка кредитів
_idem = IdempotencyService()       # ідемпотентний шар


# ── Список кредитів користувача ───────────────────────────────────────────────

@credit_bp.get('/credits')
@auth_required
def list_credits():
    """GET /api/credits — усі кредити поточного користувача (активні та погашені)."""
    try:
        return jsonify({'ok': True, 'data': _svc.list_credits(g.current_user['id'])})
    except Exception as exc:
        return api_error(str(exc))


# ── Оформлення нового кредиту ─────────────────────────────────────────────────

@credit_bp.post('/credits')
@auth_required
def create_credit():
    """POST /api/credits — оформити новий кредит.

    Body:
      amount       (float) — сума кредиту (зараховується на рахунок)
      term_months  (int)   — строк погашення у місяцях
      description  (str)   — мета кредиту (необов'язково)
      idempotency_key (str) — ключ ідемпотентності (у body або заголовку)

    Ідемпотентність запобігає подвійному зарахуванню при повторних запитах
    (наприклад, якщо клієнт переслав запит через таймаут мережі).

    Повертає 201 Created з об'єктом кредиту.
    """
    idempotency_key = None
    try:
        data = request.get_json(force=True) or {}

        # Витягуємо ключ з заголовку X-Idempotency-Key або з поля body
        idempotency_key, err = require_idempotency_key(payload=data, allow_body_fallback=True)
        if err:
            return err

        amount      = float(data.get('amount')      or 0)
        term_months = int(data.get('term_months')   or 0)
        description = str(data.get('description')   or '').strip()
        user_id     = int(g.current_user['id'])

        # ── Ідемпотентний резерв ──────────────────────────────────────────────
        if idempotency_key:
            reservation = _idem.reserve(
                user_id=user_id,
                action='credit_create',
                key=idempotency_key,
                payload={
                    'amount':       amount,
                    'term_months':  term_months,
                    'description':  description,
                },
            )
            state = reservation.get('state')
            if state == 'conflict':
                # ключ уже використаний з ІНШИМ payload — захист від підміни параметрів
                return api_error('Idempotency-Key уже використано з іншим payload.', 409)
            if state == 'replay':
                # той самий запит виконувався раніше — повертаємо збережену відповідь
                return jsonify(reservation.get('payload') or {'ok': False}), int(reservation.get('response_code') or 200)
            if state == 'processing':
                # паралельний запит з тим самим ключем ще виконується
                return api_error('Операція вже виконується. Спробуйте пізніше.', 409)

        # ── Видача кредиту ────────────────────────────────────────────────────
        credit  = _svc.create_credit(user_id, amount, term_months, description)
        payload = {'ok': True, 'data': credit}

        # ── Фіксуємо успішне завершення ──────────────────────────────────────
        if idempotency_key:
            _idem.complete(
                user_id=user_id,
                action='credit_create',
                key=idempotency_key,
                response_payload=payload,
                response_code=201,   # збережений код для коректного replay
            )
        return jsonify(payload), 201

    except Exception as exc:
        # При будь-якій помилці знімаємо резерв, щоб не заблокувати ключ назавжди
        if idempotency_key:
            _idem.release_processing(
                user_id=int(g.current_user['id']),
                action='credit_create',
                key=idempotency_key,
            )
        return api_error(str(exc))


# ── Деталі конкретного кредиту ────────────────────────────────────────────────

@credit_bp.get('/credits/<int:credit_id>')
@auth_required
def get_credit(credit_id: int):
    """GET /api/credits/{id} — деталі кредиту, графік платежів, залишок боргу.

    Сервіс перевіряє право власності; чужий кредит -> виняток -> 404.
    """
    try:
        return jsonify({'ok': True, 'data': _svc.get_credit(credit_id, g.current_user['id'])})
    except Exception as exc:
        return api_error(str(exc), 404)


# ── Погашення кредиту ─────────────────────────────────────────────────────────

@credit_bp.post('/credits/<int:credit_id>/repay')
@auth_required
def repay_credit(credit_id: int):
    """POST /api/credits/{id}/repay — часткове або повне погашення кредиту.

    Body (опціонально):
      amount (float) — сума платежу. Якщо не передано — гасимо повністю.
      idempotency_key (str) — ключ ідемпотентності

    Сума списується з балансу рахунку і зараховується в рахунок боргу.
    Ідемпотентність важлива: повторний запит не має двічі списати кошти.
    """
    idempotency_key = None
    try:
        data = request.get_json(force=True) or {}

        idempotency_key, err = require_idempotency_key(payload=data, allow_body_fallback=True)
        if err:
            return err

        amount  = data.get('amount')
        amount  = float(amount) if amount else None   # None = повне погашення
        user_id = int(g.current_user['id'])

        # ── Ідемпотентний резерв для погашення ───────────────────────────────
        if idempotency_key:
            reservation = _idem.reserve(
                user_id=user_id,
                action='credit_repay',
                key=idempotency_key,
                payload={
                    'credit_id': credit_id,
                    'amount':    amount,     # None означає повне погашення
                },
            )
            state = reservation.get('state')
            if state == 'conflict':
                return api_error('Idempotency-Key уже використано з іншим payload.', 409)
            if state == 'replay':
                return jsonify(reservation.get('payload') or {'ok': False}), int(reservation.get('response_code') or 200)
            if state == 'processing':
                return api_error('Операція вже виконується. Спробуйте пізніше.', 409)

        # ── Виконуємо погашення ───────────────────────────────────────────────
        result  = _svc.repay(credit_id, user_id, amount)
        payload = {'ok': True, 'data': result}

        if idempotency_key:
            _idem.complete(
                user_id=user_id,
                action='credit_repay',
                key=idempotency_key,
                response_payload=payload,
                response_code=200,
            )
        return jsonify(payload)

    except Exception as exc:
        if idempotency_key:
            _idem.release_processing(
                user_id=int(g.current_user['id']),
                action='credit_repay',
                key=idempotency_key,
            )
        return api_error(str(exc))


# ── Адмін: список всіх кредитів ───────────────────────────────────────────────

@credit_bp.get('/admin/credits')
@auth_required
def admin_list_credits():
    """GET /api/admin/credits — всі кредити платформи з фільтрацією.

    Query params:
      status (str, optional) — 'active'|'repaid'|'overdue'
      limit  (int, max 500, default 100)

    Доступ: admin, platform_admin, operator.
    Використовується в адмін-панелі для моніторингу прострочених кредитів.
    """
    try:
        if g.current_user.get('role') not in ('admin', 'platform_admin', 'operator'):
            return api_error('Forbidden', 403)
        status = request.args.get('status') or None
        limit  = min(int(request.args.get('limit', 100)), 500)
        return jsonify({'ok': True, 'data': _svc.admin_list_credits(status, limit)})
    except Exception as exc:
        return api_error(str(exc))

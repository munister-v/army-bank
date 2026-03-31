"""Маршрути для ролі оператора."""
from __future__ import annotations

from flask import Blueprint, jsonify, request, g

from ..config import (
    CRITICAL_ADMIN_MUTATION_RATE_LIMIT,
    CRITICAL_RATE_LIMIT_WINDOW_SECONDS,
)
from ..repositories.account_repository import AccountRepository
from ..repositories.feature_repository import FeatureRepository
from ..repositories.user_repository import UserRepository
from ..services.idempotency_service import IdempotencyService
from ..utils.validators import validate_positive_amount
from .helpers import (
    api_error,
    auth_required,
    role_required,
    actor_rate_key,
    rate_limit,
    require_idempotency_key,
)

operator_bp = Blueprint('operator', __name__, url_prefix='/api/operator')
user_repo = UserRepository()
account_repo = AccountRepository()
feature_repo = FeatureRepository()
idempotency_service = IdempotencyService()


@operator_bp.get('/users')
@auth_required
@role_required('operator', 'admin')
def list_users():
    try:
        users = user_repo.list_all(role_filter='soldier')
        return jsonify({'ok': True, 'data': users})
    except Exception as exc:
        return api_error(str(exc))


@operator_bp.post('/payouts')
@auth_required
@role_required('operator', 'admin')
@rate_limit(
    CRITICAL_ADMIN_MUTATION_RATE_LIMIT,
    CRITICAL_RATE_LIMIT_WINDOW_SECONDS,
    key_func=lambda: actor_rate_key('operator:payouts'),
)
def create_payout_for_user():
    """Нарахування виплати користувачу (за user_id)."""
    idempotency_key = None
    try:
        data = request.get_json(force=True) or {}
        idempotency_key, err = require_idempotency_key(payload=data)
        if err:
            return err
        user_id = data.get('user_id')
        if user_id is None:
            return api_error('Потрібно вказати user_id.')
        user_id = int(user_id)
        title = (data.get('title') or 'Виплата').strip()
        payout_type = (data.get('payout_type') or 'general').strip()
        amount = float(data.get('amount') or 0)
        validate_positive_amount(amount)

        user = user_repo.get_by_id(user_id)
        if not user:
            return api_error('Користувача не знайдено.', 404)
        account = account_repo.get_account_by_user_id(user_id)
        if not account:
            return api_error('Рахунок користувача не знайдено.', 404)

        actor_id = int(g.current_user['id'])
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
                return api_error('Idempotency-Key уже використано з іншим payload.', 409)
            if state == 'replay':
                return jsonify(reservation.get('payload') or {'ok': False}), int(reservation.get('response_code') or 200)
            if state == 'processing':
                return api_error('Операція вже виконується. Спробуйте пізніше.', 409)

        new_balance = round(account['balance'] + amount, 2)
        account_repo.update_balance(account['id'], new_balance)
        account_repo.add_transaction(account['id'], 'payout', 'in', amount, title)
        feature_repo.create_payout(user_id, title, amount, payout_type)
        feature_repo.add_audit_log(user_id, 'operator_payout', f'Оператор нарахував виплату {amount:.2f} грн.')
        feature_repo.add_audit_log(g.current_user['id'], 'operator_payout', f'Нараховано {amount:.2f} грн користувачу id={user_id}.')

        payload = {'ok': True, 'data': {'user_id': user_id, 'amount': amount, 'new_balance': new_balance}}
        if idempotency_key:
            idempotency_service.complete(
                user_id=actor_id,
                action='operator_payout',
                key=idempotency_key,
                response_payload=payload,
                response_code=200,
            )
        return jsonify(payload)
    except ValueError as exc:
        if idempotency_key:
            idempotency_service.release_processing(
                user_id=int(g.current_user['id']),
                action='operator_payout',
                key=idempotency_key,
            )
        return api_error(str(exc))
    except Exception as exc:
        if idempotency_key:
            idempotency_service.release_processing(
                user_id=int(g.current_user['id']),
                action='operator_payout',
                key=idempotency_key,
            )
        return api_error(str(exc))

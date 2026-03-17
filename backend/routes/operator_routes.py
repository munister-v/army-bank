"""Маршрути для ролі оператора."""
from __future__ import annotations

from flask import Blueprint, jsonify, request, g

from ..repositories.account_repository import AccountRepository
from ..repositories.feature_repository import FeatureRepository
from ..repositories.user_repository import UserRepository
from ..utils.validators import validate_positive_amount
from .helpers import api_error, auth_required, role_required

operator_bp = Blueprint('operator', __name__, url_prefix='/api/operator')
user_repo = UserRepository()
account_repo = AccountRepository()
feature_repo = FeatureRepository()


@operator_bp.get('/users')
@auth_required
@role_required('operator', 'admin')
def list_users():
    users = user_repo.list_all(role_filter='soldier')
    return jsonify({'ok': True, 'data': users})


@operator_bp.post('/payouts')
@auth_required
@role_required('operator', 'admin')
def create_payout_for_user():
    """Нарахування виплати користувачу (за user_id)."""
    try:
        data = request.get_json(force=True) or {}
        user_id = data.get('user_id')
        if user_id is None:
            return api_error('Потрібно вказати user_id.')
        user_id = int(user_id)
        title = (data.get('title') or 'Бойова виплата').strip()
        payout_type = (data.get('payout_type') or 'combat').strip()
        amount = float(data.get('amount') or 0)
        validate_positive_amount(amount)

        user = user_repo.get_by_id(user_id)
        if not user:
            return api_error('Користувача не знайдено.', 404)
        account = account_repo.get_account_by_user_id(user_id)
        if not account:
            return api_error('Рахунок користувача не знайдено.', 404)

        new_balance = round(account['balance'] + amount, 2)
        account_repo.update_balance(account['id'], new_balance)
        account_repo.add_transaction(account['id'], 'payout', 'in', amount, title)
        feature_repo.create_payout(user_id, title, amount, payout_type)
        feature_repo.add_audit_log(user_id, 'operator_payout', f'Оператор нарахував виплату {amount:.2f} грн.')
        feature_repo.add_audit_log(g.current_user['id'], 'operator_payout', f'Нараховано {amount:.2f} грн користувачу id={user_id}.')

        return jsonify({'ok': True, 'data': {'user_id': user_id, 'amount': amount, 'new_balance': new_balance}})
    except ValueError as exc:
        return api_error(str(exc))
    except Exception as exc:
        return api_error(str(exc))

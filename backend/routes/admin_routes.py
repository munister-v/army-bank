"""Маршрути для ролі адміністратора."""
from __future__ import annotations

from flask import Blueprint, jsonify, request, g

from ..repositories.account_repository import AccountRepository
from ..repositories.feature_repository import FeatureRepository
from ..repositories.user_repository import UserRepository
from .helpers import api_error, auth_required, role_required

admin_bp = Blueprint('admin', __name__, url_prefix='/api/admin')
user_repo = UserRepository()
account_repo = AccountRepository()
feature_repo = FeatureRepository()


@admin_bp.get('/users')
@auth_required
@role_required('admin', 'platform_admin')
def list_users():
    role_filter = request.args.get('role')
    users = user_repo.list_all(role_filter=role_filter)
    return jsonify({'ok': True, 'data': users})


@admin_bp.get('/users/<int:user_id>/account')
@auth_required
@role_required('admin', 'platform_admin')
def get_user_account(user_id: int):
    account = account_repo.get_account_by_user_id(user_id)
    if not account:
        return api_error('Рахунок не знайдено.', 404)
    return jsonify({'ok': True, 'data': account})


@admin_bp.get('/users/<int:user_id>/transactions')
@auth_required
@role_required('admin', 'platform_admin')
def get_user_transactions(user_id: int):
    account = account_repo.get_account_by_user_id(user_id)
    if not account:
        return api_error('Рахунок не знайдено.', 404)
    limit = request.args.get('limit', default=200, type=int)
    # Поки що використовуємо існуючий список транзакцій по account_id
    txs = account_repo.list_transactions(account['id'])
    return jsonify({'ok': True, 'data': txs[: min(limit, 500)]})


@admin_bp.patch('/users/<int:user_id>/role')
@auth_required
@role_required('admin', 'platform_admin')
def update_user_role(user_id: int):
    try:
        data = request.get_json(force=True) or {}
        role = (data.get('role') or '').strip()
        if role not in ('soldier', 'operator', 'admin', 'platform_admin'):
            return api_error('Недійсна роль.')
        user_repo.update_role(user_id, role)
        user = user_repo.get_by_id(user_id)
        return jsonify({'ok': True, 'data': user})
    except Exception as exc:
        return api_error(str(exc))


@admin_bp.get('/audit-logs')
@auth_required
@role_required('admin', 'platform_admin')
def list_audit_logs():
    user_id = request.args.get('user_id', type=int)
    limit = request.args.get('limit', default=200, type=int)
    logs = feature_repo.list_audit_logs(user_id=user_id, limit=min(limit, 500))
    return jsonify({'ok': True, 'data': logs})

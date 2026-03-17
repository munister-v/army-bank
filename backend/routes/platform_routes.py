"""Маршрути для платформенного адміна: огляд системи, генерація демо-даних."""
from __future__ import annotations

from flask import Blueprint, jsonify, request, g

from ..repositories.platform_repository import PlatformRepository
from ..services.platform_service import seed_demo
from .helpers import api_error, auth_required, role_required

platform_bp = Blueprint('platform', __name__, url_prefix='/api/platform')
platform_repo = PlatformRepository()


@platform_bp.get('/overview')
@auth_required
@role_required('platform_admin')
def get_overview():
    """Агрегована статистика по всій платформі."""
    stats = platform_repo.get_overview_stats()
    return jsonify({'ok': True, 'data': stats})


@platform_bp.get('/users')
@auth_required
@role_required('platform_admin')
def list_platform_users():
    """Список усіх користувачів з балансами."""
    limit = min(request.args.get('limit', default=500, type=int), 500)
    offset = request.args.get('offset', default=0, type=int)
    users = platform_repo.list_all_users_with_balance(limit=limit, offset=offset)
    return jsonify({'ok': True, 'data': users})


@platform_bp.get('/transactions')
@auth_required
@role_required('platform_admin')
def list_platform_transactions():
    """Транзакції по всіх рахунках."""
    limit = min(request.args.get('limit', default=200, type=int), 500)
    offset = request.args.get('offset', default=0, type=int)
    tx_type = request.args.get('tx_type')
    rows = platform_repo.list_all_transactions(limit=limit, offset=offset, tx_type=tx_type)
    return jsonify({'ok': True, 'data': rows})


@platform_bp.get('/audit-logs')
@auth_required
@role_required('platform_admin')
def list_platform_audit_logs():
    """Останні аудит-логи по платформі."""
    limit = min(request.args.get('limit', default=100, type=int), 500)
    logs = platform_repo.list_recent_audit_logs(limit=limit)
    return jsonify({'ok': True, 'data': logs})


@platform_bp.post('/seed-demo')
@auth_required
@role_required('platform_admin')
def post_seed_demo():
    """Генерує демо-користувачів, рахунки та транзакції."""
    try:
        data = request.get_json(force=True) or {}
        users_count = min(int(data.get('users_count', 10)), 50)
        transactions_per_user = min(int(data.get('transactions_per_user', 15)), 50)
        result = seed_demo(users_count=users_count, transactions_per_user=transactions_per_user)
        return jsonify({'ok': True, 'data': result})
    except (ValueError, TypeError) as exc:
        return api_error(str(exc))

"""Маршрути для ролі адміністратора."""
from __future__ import annotations

from flask import Blueprint, jsonify, request, g

from ..repositories.account_repository import AccountRepository
from ..repositories.feature_repository import FeatureRepository
from ..repositories.user_repository import UserRepository
from ..database import get_connection
from .helpers import api_error, auth_required, role_required
from .push_routes import send_push

admin_bp = Blueprint('admin', __name__, url_prefix='/api/admin')
user_repo = UserRepository()
account_repo = AccountRepository()
feature_repo = FeatureRepository()

_ALLOWED_ROLES = ('soldier', 'operator', 'admin', 'platform_admin')


@admin_bp.get('/users')
@auth_required
@role_required('admin', 'platform_admin')
def list_users():
    role_filter = request.args.get('role')
    search = (request.args.get('search') or '').strip()
    users = user_repo.list_all(role_filter=role_filter, search=search)
    return jsonify({'ok': True, 'data': users})


@admin_bp.get('/users/<int:user_id>')
@auth_required
@role_required('admin', 'platform_admin')
def get_user(user_id: int):
    user = user_repo.get_by_id(user_id)
    if not user:
        return api_error('Користувача не знайдено.', 404)
    account = account_repo.get_account_by_user_id(user_id)
    return jsonify({'ok': True, 'data': {**user, 'account': account}})


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
    txs = account_repo.list_transactions(account['id'])
    return jsonify({'ok': True, 'data': txs[: min(limit, 500)]})


@admin_bp.patch('/users/<int:user_id>/role')
@auth_required
@role_required('admin', 'platform_admin')
def update_user_role(user_id: int):
    try:
        data = request.get_json(force=True) or {}
        role = (data.get('role') or '').strip()
        if role not in _ALLOWED_ROLES:
            return api_error(f'Недійсна роль. Допустимі: {", ".join(_ALLOWED_ROLES)}')
        user_repo.update_role(user_id, role)
        user = user_repo.get_by_id(user_id)
        feature_repo.add_audit_log(
            g.current_user['id'], 'admin_role_change',
            f'Роль користувача id={user_id} змінено на {role}.'
        )
        return jsonify({'ok': True, 'data': user})
    except Exception as exc:
        return api_error(str(exc))


@admin_bp.get('/stats')
@auth_required
@role_required('admin', 'platform_admin')
def get_stats():
    """Зведена статистика для дешборду адмінки."""
    try:
        with get_connection() as conn:
            total_users   = conn.execute('SELECT COUNT(*) as n FROM users').fetchone()['n']
            total_balance = conn.execute('SELECT COALESCE(SUM(balance),0) as s FROM accounts').fetchone()['s']
            total_tx      = conn.execute('SELECT COUNT(*) as n FROM transactions').fetchone()['n']
            total_payouts = conn.execute("SELECT COALESCE(SUM(amount),0) as s FROM transactions WHERE tx_type='payout' AND direction='in'").fetchone()['s']
            total_donations = conn.execute('SELECT COALESCE(SUM(amount),0) as s FROM donations').fetchone()['s']
            by_role = conn.execute(
                "SELECT role, COUNT(*) as cnt FROM users GROUP BY role"
            ).fetchall()
            recent_tx = conn.execute(
                'SELECT t.*, a.account_number FROM transactions t JOIN accounts a ON a.id=t.account_id ORDER BY t.created_at DESC, t.id DESC LIMIT 10'
            ).fetchall()
        return jsonify({'ok': True, 'data': {
            'total_users':    total_users,
            'total_balance':  round(float(total_balance), 2),
            'total_tx':       total_tx,
            'total_payouts':  round(float(total_payouts), 2),
            'total_donations':round(float(total_donations), 2),
            'by_role':        by_role,
            'recent_tx':      recent_tx,
        }})
    except Exception as exc:
        return api_error(str(exc))


@admin_bp.get('/transactions')
@auth_required
@role_required('admin', 'platform_admin')
def list_all_transactions():
    """Усі транзакції платформи з пагінацією та фільтрами."""
    try:
        limit  = min(request.args.get('limit',  default=100, type=int), 500)
        offset = request.args.get('offset', default=0,   type=int)
        tx_type    = request.args.get('tx_type')
        direction  = request.args.get('direction')
        from_date  = request.args.get('from_date')
        to_date    = request.args.get('to_date')

        with get_connection() as conn:
            sql = '''
                SELECT t.*, a.account_number, u.full_name, u.id as user_id
                FROM transactions t
                JOIN accounts a ON a.id = t.account_id
                JOIN users u ON u.id = a.user_id
                WHERE 1=1
            '''
            params: list = []
            if tx_type:    sql += ' AND t.tx_type = %s';    params.append(tx_type)
            if direction:  sql += ' AND t.direction = %s';  params.append(direction)
            if from_date:  sql += ' AND t.created_at >= %s'; params.append(from_date)
            if to_date:    sql += ' AND t.created_at <= %s'; params.append(to_date + 'T23:59:59')

            count_row = conn.execute(
                f'SELECT COUNT(*) as n FROM ({sql}) sub', tuple(params)
            ).fetchone()
            total = count_row['n'] if count_row else 0

            sql += ' ORDER BY t.created_at DESC, t.id DESC LIMIT %s OFFSET %s'
            params += [limit, offset]
            rows = conn.execute(sql, tuple(params)).fetchall()

        return jsonify({'ok': True, 'data': rows, 'total': total})
    except Exception as exc:
        return api_error(str(exc))


@admin_bp.post('/payouts')
@auth_required
@role_required('admin', 'platform_admin', 'operator')
def create_payout():
    """Адмін/оператор: нарахування виплати користувачу."""
    try:
        data = request.get_json(force=True) or {}
        user_id = int(data.get('user_id') or 0)
        amount  = float(data.get('amount') or 0)
        title   = (data.get('title') or 'Бойова виплата').strip()
        payout_type = (data.get('payout_type') or 'combat').strip()

        if not user_id:
            return api_error('Потрібно вказати user_id.')
        if amount <= 0:
            return api_error('Сума повинна бути більше 0.')

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
        feature_repo.add_audit_log(
            user_id, 'payout_received',
            f'Нараховано {amount:.2f} грн. Тип: {payout_type}.'
        )
        feature_repo.add_audit_log(
            g.current_user['id'], 'admin_payout',
            f'Нараховано {amount:.2f} грн користувачу id={user_id} ({user["full_name"]}).'
        )
        # Push notification to user (non-blocking)
        send_push(
            user_id,
            title='💰 Нарахування на рахунок',
            body=f'{title}: +{amount:,.2f} ₴. Новий баланс: {new_balance:,.2f} ₴',
            url='/dashboard',
        )
        return jsonify({'ok': True, 'data': {
            'user_id': user_id, 'amount': amount, 'new_balance': new_balance
        }})
    except Exception as exc:
        return api_error(str(exc))


@admin_bp.get('/audit-logs')
@auth_required
@role_required('admin', 'platform_admin')
def list_audit_logs():
    user_id = request.args.get('user_id', type=int)
    limit   = request.args.get('limit', default=200, type=int)
    logs = feature_repo.list_audit_logs(user_id=user_id, limit=min(limit, 500))
    return jsonify({'ok': True, 'data': logs})

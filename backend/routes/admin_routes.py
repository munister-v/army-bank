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
        limit      = min(request.args.get('limit',  default=100, type=int), 500)
        offset     = request.args.get('offset',     default=0,   type=int)
        tx_type    = request.args.get('tx_type')
        direction  = request.args.get('direction')
        from_date  = request.args.get('from_date')
        to_date    = request.args.get('to_date')
        user_id    = request.args.get('user_id',    type=int)
        min_amount = request.args.get('min_amount', type=float)
        max_amount = request.args.get('max_amount', type=float)
        search     = (request.args.get('search') or '').strip()
        sort_by    = (request.args.get('sort_by') or 'newest').strip()

        with get_connection() as conn:
            base_sql = '''
                FROM transactions t
                JOIN accounts a ON a.id = t.account_id
                JOIN users u ON u.id = a.user_id
                WHERE 1=1
            '''
            select_sql = '''
                SELECT t.*, a.account_number, u.full_name, u.id as user_id
                FROM transactions t
                JOIN accounts a ON a.id = t.account_id
                JOIN users u ON u.id = a.user_id
                WHERE 1=1
            '''
            params: list = []
            if tx_type:
                base_sql += ' AND t.tx_type = %s'
                select_sql += ' AND t.tx_type = %s'
                params.append(tx_type)
            if direction:
                base_sql += ' AND t.direction = %s'
                select_sql += ' AND t.direction = %s'
                params.append(direction)
            if from_date:
                base_sql += ' AND t.created_at >= %s'
                select_sql += ' AND t.created_at >= %s'
                params.append(from_date)
            if to_date:
                end_of_day = to_date + 'T23:59:59'
                base_sql += ' AND t.created_at <= %s'
                select_sql += ' AND t.created_at <= %s'
                params.append(end_of_day)
            if user_id:
                base_sql += ' AND u.id = %s'
                select_sql += ' AND u.id = %s'
                params.append(user_id)
            if min_amount is not None:
                base_sql += ' AND t.amount >= %s'
                select_sql += ' AND t.amount >= %s'
                params.append(min_amount)
            if max_amount is not None:
                base_sql += ' AND t.amount <= %s'
                select_sql += ' AND t.amount <= %s'
                params.append(max_amount)
            if search:
                base_sql += ' AND (LOWER(t.description) LIKE %s OR a.account_number LIKE %s OR LOWER(u.full_name) LIKE %s)'
                select_sql += ' AND (LOWER(t.description) LIKE %s OR a.account_number LIKE %s OR LOWER(u.full_name) LIKE %s)'
                like = f'%{search.lower()}%'
                params += [like, f'%{search}%', like]

            count_row = conn.execute(
                f'SELECT COUNT(*) as n {base_sql}', tuple(params)
            ).fetchone()
            total = count_row['n'] if count_row else 0

            summary_row = conn.execute(
                f'''
                SELECT
                    COALESCE(SUM(CASE WHEN t.direction='in'  THEN t.amount ELSE 0 END),0) AS total_in,
                    COALESCE(SUM(CASE WHEN t.direction='out' THEN t.amount ELSE 0 END),0) AS total_out,
                    COALESCE(AVG(t.amount),0) AS avg_amount,
                    COALESCE(MIN(t.amount),0) AS min_amount,
                    COALESCE(MAX(t.amount),0) AS max_amount
                {base_sql}
                ''',
                tuple(params)
            ).fetchone()

            order_clause = ' ORDER BY t.created_at DESC, t.id DESC'
            if sort_by == 'oldest':
                order_clause = ' ORDER BY t.created_at ASC, t.id ASC'
            elif sort_by == 'amount_desc':
                order_clause = ' ORDER BY t.amount DESC, t.created_at DESC, t.id DESC'
            elif sort_by == 'amount_asc':
                order_clause = ' ORDER BY t.amount ASC, t.created_at DESC, t.id DESC'

            data_params = list(params) + [limit, offset]
            rows = conn.execute(
                select_sql + order_clause + ' LIMIT %s OFFSET %s',
                tuple(data_params)
            ).fetchall()

        total_in = float(summary_row['total_in']) if summary_row else 0.0
        total_out = float(summary_row['total_out']) if summary_row else 0.0
        avg_amount = float(summary_row['avg_amount']) if summary_row else 0.0
        min_a = float(summary_row['min_amount']) if summary_row else 0.0
        max_a = float(summary_row['max_amount']) if summary_row else 0.0

        return jsonify({'ok': True, 'data': rows, 'total': total, 'summary': {
            'count': int(total),
            'total_in': round(total_in, 2),
            'total_out': round(total_out, 2),
            'net': round(total_in - total_out, 2),
            'avg_amount': round(avg_amount, 2),
            'min_amount': round(min_a, 2),
            'max_amount': round(max_a, 2),
        }})
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
            push_type='payout',
        )
        return jsonify({'ok': True, 'data': {
            'user_id': user_id, 'amount': amount, 'new_balance': new_balance
        }})
    except Exception as exc:
        return api_error(str(exc))


@admin_bp.get('/stats/charts')
@auth_required
@role_required('admin', 'platform_admin')
def get_chart_stats():
    """Дані для графіків: обсяг транзакцій по днях + розподіл за типами."""
    try:
        days = min(request.args.get('days', default=14, type=int), 90)
        with get_connection() as conn:
            # Daily volumes — last N days
            daily = conn.execute(
                """
                SELECT
                    DATE(created_at) as day,
                    COUNT(*) as cnt,
                    COALESCE(SUM(CASE WHEN direction='in'  THEN amount ELSE 0 END),0) as vol_in,
                    COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END),0) as vol_out
                FROM transactions
                WHERE created_at >= DATE('now', %s)
                GROUP BY DATE(created_at)
                ORDER BY day
                """,
                (f'-{days} days',)
            ).fetchall()

            # Type distribution
            by_type = conn.execute(
                """
                SELECT tx_type, COUNT(*) as cnt,
                       COALESCE(SUM(amount),0) as total_amount
                FROM transactions
                GROUP BY tx_type
                ORDER BY cnt DESC
                """
            ).fetchall()

            # Top users by volume
            top_users = conn.execute(
                """
                SELECT u.full_name, u.id, COUNT(*) as tx_cnt,
                       COALESCE(SUM(t.amount),0) as total_vol
                FROM transactions t
                JOIN accounts a ON a.id = t.account_id
                JOIN users u ON u.id = a.user_id
                GROUP BY u.id
                ORDER BY total_vol DESC
                LIMIT 5
                """
            ).fetchall()

        return jsonify({'ok': True, 'data': {
            'daily':     [dict(r) for r in daily],
            'by_type':   [dict(r) for r in by_type],
            'top_users': [dict(r) for r in top_users],
        }})
    except Exception as exc:
        return api_error(str(exc))


@admin_bp.post('/users/<int:user_id>/balance-adjust')
@auth_required
@role_required('admin', 'platform_admin')
def balance_adjust(user_id: int):
    """Адмін: ручне коригування балансу (дебет або кредит)."""
    try:
        data    = request.get_json(force=True) or {}
        amount  = float(data.get('amount') or 0)
        reason  = (data.get('reason') or 'Ручне коригування').strip()
        op_type = (data.get('type') or 'credit').strip()   # 'credit' | 'debit'

        if amount <= 0:
            return api_error('Сума повинна бути більше 0.')
        if op_type not in ('credit', 'debit'):
            return api_error("Тип: 'credit' або 'debit'.")

        account = account_repo.get_account_by_user_id(user_id)
        if not account:
            return api_error('Рахунок не знайдено.', 404)

        current = float(account['balance'])
        if op_type == 'debit' and current < amount:
            return api_error('Недостатньо коштів на рахунку.')

        direction   = 'in' if op_type == 'credit' else 'out'
        new_balance = round(current + amount if op_type == 'credit' else current - amount, 2)
        account_repo.update_balance(account['id'], new_balance)
        account_repo.add_transaction(account['id'], 'payout', direction, amount, reason)

        feature_repo.add_audit_log(
            g.current_user['id'], 'admin_balance_adjust',
            f'{op_type.upper()} {amount:.2f} грн · user_id={user_id} · причина: {reason}.'
        )
        return jsonify({'ok': True, 'data': {'new_balance': new_balance}})
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

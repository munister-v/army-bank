"""Репозиторій для платформенного адміна: агрегати, списки, транзакції по всій системі."""
from __future__ import annotations

from .base import BaseRepository


class PlatformRepository(BaseRepository):
    def get_overview_stats(self) -> dict:
        """Агрегована статистика по всій платформі."""
        with self.connection() as conn:
            users_count = conn.execute('SELECT COUNT(*) as c FROM users', ()).fetchone()
            accounts_count = conn.execute('SELECT COUNT(*) as c FROM accounts', ()).fetchone()
            total_balance = conn.execute('SELECT COALESCE(SUM(balance), 0) as s FROM accounts', ()).fetchone()
            txs_count = conn.execute('SELECT COUNT(*) as c FROM transactions', ()).fetchone()
            donations_count = conn.execute('SELECT COUNT(*) as c FROM donations', ()).fetchone()
            payouts_count = conn.execute('SELECT COUNT(*) as c FROM payouts', ()).fetchone()

            tx_by_type = conn.execute(
                '''SELECT tx_type, direction, COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total
                   FROM transactions GROUP BY tx_type, direction''',
                (),
            ).fetchall()

        return {
            'users_count': users_count['c'] or 0,
            'accounts_count': accounts_count['c'] or 0,
            'total_balance': float(total_balance['s'] or 0),
            'transactions_count': txs_count['c'] or 0,
            'donations_count': donations_count['c'] or 0,
            'payouts_count': payouts_count['c'] or 0,
            'transactions_by_type': [
                {'tx_type': r['tx_type'], 'direction': r['direction'], 'count': r['cnt'], 'total': float(r['total'])}
                for r in tx_by_type
            ],
        }

    def list_all_users_with_balance(self, limit: int = 500, offset: int = 0):
        """Список усіх користувачів з балансом рахунку."""
        with self.connection() as conn:
            return conn.execute(
                '''
                SELECT u.id, u.full_name, u.phone, u.email, u.role, u.military_status, u.created_at,
                       a.id as account_id, a.account_number, a.balance, a.status as account_status
                FROM users u
                LEFT JOIN accounts a ON a.user_id = u.id
                ORDER BY u.id
                LIMIT %s OFFSET %s
                ''',
                (limit, offset),
            ).fetchall()

    def list_all_transactions(self, limit: int = 200, offset: int = 0, tx_type: str | None = None):
        """Транзакції по всіх рахунках."""
        with self.connection() as conn:
            sql = '''
                SELECT t.id, t.account_id, t.tx_type, t.direction, t.amount, t.description, t.related_account, t.created_at,
                       a.user_id, a.account_number
                FROM transactions t
                JOIN accounts a ON a.id = t.account_id
                '''
            params = []
            if tx_type:
                sql += ' WHERE t.tx_type = %s'
                params.append(tx_type)
            sql += ' ORDER BY t.created_at DESC, t.id DESC LIMIT %s OFFSET %s'
            params.extend([limit, offset])
            return conn.execute(sql, tuple(params)).fetchall()

    def list_recent_audit_logs(self, limit: int = 100):
        """Останні аудит-логи по всій платформі."""
        with self.connection() as conn:
            return conn.execute(
                '''
                SELECT al.id, al.user_id, al.action, al.details, al.created_at, u.full_name
                FROM audit_logs al
                LEFT JOIN users u ON u.id = al.user_id
                ORDER BY al.created_at DESC
                LIMIT %s
                ''',
                (limit,),
            ).fetchall()

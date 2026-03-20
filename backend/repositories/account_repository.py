"""Репозиторій рахунків, транзакцій та пов'язаних операцій."""
from __future__ import annotations

import io
import csv

from ..database import get_returning_id_suffix, insert_last_id
from .base import BaseRepository


class AccountRepository(BaseRepository):
    def create_account(self, user_id: int, account_number: str, currency: str = 'UAH') -> int:
        with self.connection() as conn:
            cursor = conn.execute(
                '''
                INSERT INTO accounts(user_id, account_number, currency)
                VALUES(%s, %s, %s)
                ''' + get_returning_id_suffix(),
                (user_id, account_number, currency),
            )
            return insert_last_id(cursor)

    def get_account_by_user_id(self, user_id: int):
        with self.connection() as conn:
            return conn.execute('SELECT * FROM accounts WHERE user_id = %s', (user_id,)).fetchone()

    def get_account_by_number(self, account_number: str):
        with self.connection() as conn:
            return conn.execute('SELECT * FROM accounts WHERE account_number = %s', (account_number,)).fetchone()

    def update_balance(self, account_id: int, new_balance: float) -> None:
        with self.connection() as conn:
            conn.execute('UPDATE accounts SET balance = %s WHERE id = %s', (new_balance, account_id))

    def add_transaction(self, account_id: int, tx_type: str, direction: str, amount: float, description: str, related_account: str | None = None) -> None:
        with self.connection() as conn:
            conn.execute(
                '''
                INSERT INTO transactions(account_id, tx_type, direction, amount, description, related_account)
                VALUES(%s, %s, %s, %s, %s, %s)
                ''',
                (account_id, tx_type, direction, amount, description, related_account),
            )

    def get_transaction(self, transaction_id: int, account_id: int):
        with self.connection() as conn:
            return conn.execute(
                'SELECT * FROM transactions WHERE id = %s AND account_id = %s',
                (transaction_id, account_id),
            ).fetchone()

    def list_transactions(self, account_id: int, from_date: str | None = None, to_date: str | None = None, tx_type: str | None = None, direction: str | None = None, search: str | None = None):
        with self.connection() as conn:
            sql = 'SELECT * FROM transactions WHERE account_id = %s'
            params = [account_id]
            if from_date:
                sql += ' AND created_at >= %s'
                params.append(from_date)
            if to_date:
                sql += ' AND created_at <= %s'
                params.append(to_date + ' 23:59:59')
            if tx_type:
                sql += ' AND tx_type = %s'
                params.append(tx_type)
            if direction:
                sql += ' AND direction = %s'
                params.append(direction)
            if search:
                sql += ' AND LOWER(description) LIKE %s'
                params.append(f'%{search.lower()}%')
            sql += ' ORDER BY created_at DESC, id DESC'
            return conn.execute(sql, tuple(params)).fetchall()

    def get_analytics(self, account_id: int) -> dict:
        with self.connection() as conn:
            # Поточний місяць
            month_row = conn.execute(
                '''
                SELECT
                    COALESCE(SUM(CASE WHEN direction='in'  THEN amount ELSE 0 END), 0) AS total_in,
                    COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END), 0) AS total_out,
                    COUNT(*) AS tx_count
                FROM transactions
                WHERE account_id = %s
                  AND created_at >= date_trunc('month', CURRENT_DATE)
                ''',
                (account_id,),
            ).fetchone()

            # Попередній місяць
            prev_month_row = conn.execute(
                '''
                SELECT
                    COALESCE(SUM(CASE WHEN direction='in'  THEN amount ELSE 0 END), 0) AS total_in,
                    COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END), 0) AS total_out,
                    COUNT(*) AS tx_count
                FROM transactions
                WHERE account_id = %s
                  AND created_at >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
                  AND created_at <  date_trunc('month', CURRENT_DATE)
                ''',
                (account_id,),
            ).fetchone()

            # По типу транзакцій (поточний місяць)
            by_type = conn.execute(
                '''
                SELECT tx_type, direction, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
                FROM transactions
                WHERE account_id = %s
                  AND created_at >= date_trunc('month', CURRENT_DATE)
                GROUP BY tx_type, direction
                ORDER BY total DESC
                ''',
                (account_id,),
            ).fetchall()

            # Останні 6 місяців (для графіка)
            monthly = conn.execute(
                '''
                SELECT
                    TO_CHAR(date_trunc('month', created_at), 'YYYY-MM') AS month,
                    COALESCE(SUM(CASE WHEN direction='in'  THEN amount ELSE 0 END), 0) AS total_in,
                    COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END), 0) AS total_out
                FROM transactions
                WHERE account_id = %s
                  AND created_at >= date_trunc('month', CURRENT_DATE - INTERVAL '5 months')
                GROUP BY date_trunc('month', created_at)
                ORDER BY date_trunc('month', created_at) ASC
                ''',
                (account_id,),
            ).fetchall()

            return {
                'current_month': dict(month_row) if month_row else {'total_in': 0, 'total_out': 0, 'tx_count': 0},
                'prev_month': dict(prev_month_row) if prev_month_row else {'total_in': 0, 'total_out': 0, 'tx_count': 0},
                'by_type': [dict(r) for r in by_type],
                'monthly': [dict(r) for r in monthly],
            }

    def export_transactions_csv(self, account_id: int, from_date: str | None = None, to_date: str | None = None) -> str:
        transactions = self.list_transactions(account_id, from_date=from_date, to_date=to_date)
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['ID', 'Тип', 'Напрям', 'Сума (₴)', 'Опис', "Пов'язаний рахунок", 'Дата'])
        type_labels = {
            'topup': 'Поповнення', 'transfer': 'Переказ', 'payout': 'Виплата',
            'donation': 'Донат', 'savings': 'Накопичення',
        }
        for tx in transactions:
            writer.writerow([
                tx['id'],
                type_labels.get(tx['tx_type'], tx['tx_type']),
                'Прихід' if tx['direction'] == 'in' else 'Відхід',
                tx['amount'],
                tx['description'],
                tx.get('related_account') or '',
                tx['created_at'],
            ])
        return output.getvalue()

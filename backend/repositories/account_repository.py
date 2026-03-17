"""Репозиторій рахунків, транзакцій та пов'язаних операцій."""
from __future__ import annotations

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

    def list_transactions(self, account_id: int, from_date: str | None = None, to_date: str | None = None, tx_type: str | None = None, direction: str | None = None):
        with self.connection() as conn:
            sql = 'SELECT * FROM transactions WHERE account_id = %s'
            params = [account_id]
            if from_date:
                sql += ' AND created_at >= %s'
                params.append(from_date)
            if to_date:
                sql += ' AND created_at <= %s'
                params.append(to_date)
            if tx_type:
                sql += ' AND tx_type = %s'
                params.append(tx_type)
            if direction:
                sql += ' AND direction = %s'
                params.append(direction)
            sql += ' ORDER BY created_at DESC, id DESC'
            return conn.execute(sql, tuple(params)).fetchall()

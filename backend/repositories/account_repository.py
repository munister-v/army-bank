"""Репозиторій рахунків, транзакцій та пов'язаних операцій."""
from __future__ import annotations

from .base import BaseRepository


class AccountRepository(BaseRepository):
    def create_account(self, user_id: int, account_number: str, currency: str = 'UAH') -> int:
        with self.connection() as conn:
            cursor = conn.execute(
                '''
                INSERT INTO accounts(user_id, account_number, currency)
                VALUES(?, ?, ?)
                ''',
                (user_id, account_number, currency),
            )
            return cursor.lastrowid

    def get_account_by_user_id(self, user_id: int):
        with self.connection() as conn:
            return conn.execute('SELECT * FROM accounts WHERE user_id = ?', (user_id,)).fetchone()

    def get_account_by_number(self, account_number: str):
        with self.connection() as conn:
            return conn.execute('SELECT * FROM accounts WHERE account_number = ?', (account_number,)).fetchone()

    def update_balance(self, account_id: int, new_balance: float) -> None:
        with self.connection() as conn:
            conn.execute('UPDATE accounts SET balance = ? WHERE id = ?', (new_balance, account_id))

    def add_transaction(self, account_id: int, tx_type: str, direction: str, amount: float, description: str, related_account: str | None = None) -> None:
        with self.connection() as conn:
            conn.execute(
                '''
                INSERT INTO transactions(account_id, tx_type, direction, amount, description, related_account)
                VALUES(?, ?, ?, ?, ?, ?)
                ''',
                (account_id, tx_type, direction, amount, description, related_account),
            )

    def list_transactions(self, account_id: int):
        with self.connection() as conn:
            return conn.execute(
                'SELECT * FROM transactions WHERE account_id = ? ORDER BY datetime(created_at) DESC, id DESC',
                (account_id,),
            ).fetchall()

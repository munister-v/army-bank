"""Репозиторій додаткових сутностей: накопичення, донати, контакти, виплати, аудит."""
from __future__ import annotations

from .base import BaseRepository


class FeatureRepository(BaseRepository):
    def add_family_contact(self, user_id: int, contact_name: str, relation_type: str, phone: str, account_number: str | None):
        with self.connection() as conn:
            cursor = conn.execute(
                '''
                INSERT INTO family_contacts(user_id, contact_name, relation_type, phone, account_number)
                VALUES(?, ?, ?, ?, ?)
                ''',
                (user_id, contact_name, relation_type, phone, account_number),
            )
            return cursor.lastrowid

    def list_family_contacts(self, user_id: int):
        with self.connection() as conn:
            return conn.execute(
                'SELECT * FROM family_contacts WHERE user_id = ? ORDER BY id DESC', (user_id,)
            ).fetchall()

    def create_savings_goal(self, user_id: int, title: str, target_amount: float, deadline: str | None):
        with self.connection() as conn:
            cursor = conn.execute(
                '''
                INSERT INTO savings_goals(user_id, title, target_amount, deadline)
                VALUES(?, ?, ?, ?)
                ''',
                (user_id, title, target_amount, deadline),
            )
            return cursor.lastrowid

    def list_savings_goals(self, user_id: int):
        with self.connection() as conn:
            return conn.execute(
                'SELECT * FROM savings_goals WHERE user_id = ? ORDER BY id DESC', (user_id,)
            ).fetchall()

    def get_savings_goal(self, goal_id: int, user_id: int):
        with self.connection() as conn:
            return conn.execute(
                'SELECT * FROM savings_goals WHERE id = ? AND user_id = ?', (goal_id, user_id)
            ).fetchone()

    def update_goal_amount(self, goal_id: int, amount: float):
        with self.connection() as conn:
            conn.execute('UPDATE savings_goals SET current_amount = ? WHERE id = ?', (amount, goal_id))

    def create_donation(self, user_id: int, fund_name: str, amount: float, comment: str | None):
        with self.connection() as conn:
            cursor = conn.execute(
                'INSERT INTO donations(user_id, fund_name, amount, comment) VALUES(?, ?, ?, ?)',
                (user_id, fund_name, amount, comment),
            )
            return cursor.lastrowid

    def list_donations(self, user_id: int):
        with self.connection() as conn:
            return conn.execute('SELECT * FROM donations WHERE user_id = ? ORDER BY id DESC', (user_id,)).fetchall()

    def create_payout(self, user_id: int, title: str, amount: float, payout_type: str):
        with self.connection() as conn:
            cursor = conn.execute(
                'INSERT INTO payouts(user_id, title, amount, payout_type) VALUES(?, ?, ?, ?)',
                (user_id, title, amount, payout_type),
            )
            return cursor.lastrowid

    def list_payouts(self, user_id: int):
        with self.connection() as conn:
            return conn.execute('SELECT * FROM payouts WHERE user_id = ? ORDER BY id DESC', (user_id,)).fetchall()

    def add_audit_log(self, user_id: int | None, action: str, details: str | None = None):
        with self.connection() as conn:
            conn.execute(
                'INSERT INTO audit_logs(user_id, action, details) VALUES(?, ?, ?)',
                (user_id, action, details),
            )

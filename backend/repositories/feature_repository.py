"""Репозиторій додаткових сутностей: накопичення, донати, контакти, виплати, аудит, шаблони платежів."""
from __future__ import annotations

from ..database import get_returning_id_suffix, insert_last_id
from .base import BaseRepository


class FeatureRepository(BaseRepository):
    def add_family_contact(self, user_id: int, contact_name: str, relation_type: str, phone: str, account_number: str | None):
        with self.connection() as conn:
            cursor = conn.execute(
                '''
                INSERT INTO family_contacts(user_id, contact_name, relation_type, phone, account_number)
                VALUES(%s, %s, %s, %s, %s)
                ''' + get_returning_id_suffix(),
                (user_id, contact_name, relation_type, phone, account_number),
            )
            return insert_last_id(cursor)

    def list_family_contacts(self, user_id: int):
        with self.connection() as conn:
            return conn.execute(
                'SELECT * FROM family_contacts WHERE user_id = %s ORDER BY id DESC', (user_id,)
            ).fetchall()

    def create_savings_goal(self, user_id: int, title: str, target_amount: float, deadline: str | None):
        with self.connection() as conn:
            cursor = conn.execute(
                '''
                INSERT INTO savings_goals(user_id, title, target_amount, deadline)
                VALUES(%s, %s, %s, %s)
                ''' + get_returning_id_suffix(),
                (user_id, title, target_amount, deadline),
            )
            return insert_last_id(cursor)

    def list_savings_goals(self, user_id: int):
        with self.connection() as conn:
            return conn.execute(
                'SELECT * FROM savings_goals WHERE user_id = %s ORDER BY id DESC', (user_id,)
            ).fetchall()

    def get_savings_goal(self, goal_id: int, user_id: int):
        with self.connection() as conn:
            return conn.execute(
                'SELECT * FROM savings_goals WHERE id = %s AND user_id = %s', (goal_id, user_id)
            ).fetchone()

    def update_goal_amount(self, goal_id: int, amount: float):
        with self.connection() as conn:
            conn.execute('UPDATE savings_goals SET current_amount = %s WHERE id = %s', (amount, goal_id))

    def create_donation(self, user_id: int, fund_name: str, amount: float, comment: str | None):
        with self.connection() as conn:
            cursor = conn.execute(
                'INSERT INTO donations(user_id, fund_name, amount, comment) VALUES(%s, %s, %s, %s)' + get_returning_id_suffix(),
                (user_id, fund_name, amount, comment),
            )
            return insert_last_id(cursor)

    def list_donations(self, user_id: int):
        with self.connection() as conn:
            return conn.execute('SELECT * FROM donations WHERE user_id = %s ORDER BY id DESC', (user_id,)).fetchall()

    def create_payout(self, user_id: int, title: str, amount: float, payout_type: str):
        with self.connection() as conn:
            cursor = conn.execute(
                'INSERT INTO payouts(user_id, title, amount, payout_type) VALUES(%s, %s, %s, %s)' + get_returning_id_suffix(),
                (user_id, title, amount, payout_type),
            )
            return insert_last_id(cursor)

    def list_payouts(self, user_id: int):
        with self.connection() as conn:
            return conn.execute('SELECT * FROM payouts WHERE user_id = %s ORDER BY id DESC', (user_id,)).fetchall()

    def add_audit_log(self, user_id: int | None, action: str, details: str | None = None):
        with self.connection() as conn:
            conn.execute(
                'INSERT INTO audit_logs(user_id, action, details) VALUES(%s, %s, %s)',
                (user_id, action, details),
            )

    def list_payment_templates(self, user_id: int):
        with self.connection() as conn:
            return conn.execute(
                'SELECT * FROM payment_templates WHERE user_id = %s OR is_system = TRUE ORDER BY name',
                (user_id,),
            ).fetchall()

    def create_payment_template(self, user_id: int | None, name: str, recipient_account: str, amount: float | None, description: str, is_system: bool = False):
        with self.connection() as conn:
            cursor = conn.execute(
                '''
                INSERT INTO payment_templates(user_id, name, recipient_account, amount, description, is_system)
                VALUES(%s, %s, %s, %s, %s, %s)
                ''' + get_returning_id_suffix(),
                (user_id, name, recipient_account, amount or 0, description, is_system),
            )
            return insert_last_id(cursor)

    def get_payment_template(self, template_id: int, user_id: int | None = None):
        with self.connection() as conn:
            if user_id is not None:
                return conn.execute(
                    'SELECT * FROM payment_templates WHERE id = %s AND (user_id = %s OR is_system = 1)',
                    (template_id, user_id),
                ).fetchone()
            return conn.execute('SELECT * FROM payment_templates WHERE id = %s', (template_id,)).fetchone()

    def list_audit_logs(self, user_id: int | None = None, limit: int = 200):
        with self.connection() as conn:
            if user_id is not None:
                return conn.execute(
                    'SELECT * FROM audit_logs WHERE user_id = %s ORDER BY created_at DESC LIMIT %s',
                    (user_id, limit),
                ).fetchall()
            return conn.execute(
                'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT %s',
                (limit,),
            ).fetchall()

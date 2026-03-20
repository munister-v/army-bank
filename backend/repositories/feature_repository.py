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

    def delete_family_contact(self, contact_id: int, user_id: int) -> bool:
        with self.connection() as conn:
            result = conn.execute(
                'DELETE FROM family_contacts WHERE id = %s AND user_id = %s',
                (contact_id, user_id),
            )
            return (result.rowcount or 0) > 0

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

    def delete_savings_goal(self, goal_id: int, user_id: int) -> bool:
        with self.connection() as conn:
            result = conn.execute(
                'DELETE FROM savings_goals WHERE id = %s AND user_id = %s',
                (goal_id, user_id),
            )
            return (result.rowcount or 0) > 0

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
                    'SELECT * FROM payment_templates WHERE id = %s AND (user_id = %s OR is_system = TRUE)',
                    (template_id, user_id),
                ).fetchone()
            return conn.execute('SELECT * FROM payment_templates WHERE id = %s', (template_id,)).fetchone()

    def delete_payment_template(self, template_id: int, user_id: int) -> bool:
        with self.connection() as conn:
            result = conn.execute(
                'DELETE FROM payment_templates WHERE id = %s AND user_id = %s AND is_system = FALSE',
                (template_id, user_id),
            )
            return (result.rowcount or 0) > 0

    def list_budget_limits(self, user_id):
        with self.connection() as conn:
            return conn.execute(
                'SELECT * FROM budget_limits WHERE user_id = %s ORDER BY tx_type',
                (user_id,)
            ).fetchall()

    def set_budget_limit(self, user_id, tx_type, monthly_limit):
        with self.connection() as conn:
            conn.execute('''
                INSERT INTO budget_limits(user_id, tx_type, monthly_limit)
                VALUES(%s, %s, %s)
                ON CONFLICT (user_id, tx_type)
                DO UPDATE SET monthly_limit = EXCLUDED.monthly_limit
            ''', (user_id, tx_type, monthly_limit))

    def delete_budget_limit(self, user_id, tx_type):
        with self.connection() as conn:
            conn.execute(
                'DELETE FROM budget_limits WHERE user_id = %s AND tx_type = %s',
                (user_id, tx_type)
            )

    def get_monthly_spending(self, account_id):
        """Returns dict of {tx_type: total_spent} for current month outgoing transactions."""
        with self.connection() as conn:
            rows = conn.execute('''
                SELECT tx_type, COALESCE(SUM(amount), 0) AS spent
                FROM transactions
                WHERE account_id = %s
                  AND direction = 'out'
                  AND created_at >= date_trunc('month', CURRENT_DATE)
                GROUP BY tx_type
            ''', (account_id,)).fetchall()
            return {r['tx_type']: float(r['spent']) for r in rows}

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

    # ── Recurring Transactions ──────────────────────────────
    def list_recurring(self, user_id: int):
        with self.connection() as conn:
            return conn.execute(
                'SELECT * FROM recurring_transactions WHERE user_id = %s ORDER BY next_run_date',
                (user_id,)
            ).fetchall()

    def create_recurring(self, user_id: int, title: str, amount: float, tx_type: str,
                         recipient_account, description: str, frequency: str, next_run_date: str):
        with self.connection() as conn:
            cursor = conn.execute(
                '''
                INSERT INTO recurring_transactions(user_id, title, amount, tx_type, recipient_account, description, frequency, next_run_date)
                VALUES(%s, %s, %s, %s, %s, %s, %s, %s)
                ''' + get_returning_id_suffix(),
                (user_id, title, amount, tx_type, recipient_account, description, frequency, next_run_date),
            )
            return insert_last_id(cursor)

    def delete_recurring(self, recurring_id: int, user_id: int) -> bool:
        with self.connection() as conn:
            result = conn.execute(
                'DELETE FROM recurring_transactions WHERE id = %s AND user_id = %s',
                (recurring_id, user_id)
            )
            return (result.rowcount or 0) > 0

    def toggle_recurring(self, recurring_id: int, user_id: int, is_active: bool) -> bool:
        with self.connection() as conn:
            result = conn.execute(
                'UPDATE recurring_transactions SET is_active = %s WHERE id = %s AND user_id = %s',
                (is_active, recurring_id, user_id)
            )
            return (result.rowcount or 0) > 0

    # ── Debts ──────────────────────────────────────────────
    def list_debts(self, user_id: int):
        with self.connection() as conn:
            return conn.execute(
                'SELECT * FROM debts WHERE user_id = %s ORDER BY is_settled, created_at DESC',
                (user_id,)
            ).fetchall()

    def create_debt(self, user_id: int, contact_name: str, amount: float, direction: str, description):
        with self.connection() as conn:
            cursor = conn.execute(
                '''
                INSERT INTO debts(user_id, contact_name, amount, direction, description)
                VALUES(%s, %s, %s, %s, %s)
                ''' + get_returning_id_suffix(),
                (user_id, contact_name, amount, direction, description),
            )
            return insert_last_id(cursor)

    def settle_debt(self, debt_id: int, user_id: int) -> bool:
        with self.connection() as conn:
            from ..database import USE_PG
            if USE_PG:
                sql = "UPDATE debts SET is_settled = TRUE, settled_at = NOW() WHERE id = %s AND user_id = %s AND is_settled = FALSE"
            else:
                sql = "UPDATE debts SET is_settled = 1, settled_at = datetime('now') WHERE id = %s AND user_id = %s AND is_settled = 0"
            result = conn.execute(sql, (debt_id, user_id))
            return (result.rowcount or 0) > 0

    def delete_debt(self, debt_id: int, user_id: int) -> bool:
        with self.connection() as conn:
            result = conn.execute(
                'DELETE FROM debts WHERE id = %s AND user_id = %s',
                (debt_id, user_id)
            )
            return (result.rowcount or 0) > 0

    # ── PIN ────────────────────────────────────────────────
    def set_pin_hash(self, user_id: int, pin_hash: str):
        with self.connection() as conn:
            conn.execute('UPDATE users SET pin_hash = %s WHERE id = %s', (pin_hash, user_id))

    def get_pin_hash(self, user_id: int):
        with self.connection() as conn:
            row = conn.execute('SELECT pin_hash FROM users WHERE id = %s', (user_id,)).fetchone()
            return row['pin_hash'] if row else None

    def clear_pin(self, user_id: int):
        with self.connection() as conn:
            conn.execute('UPDATE users SET pin_hash = NULL WHERE id = %s', (user_id,))

    # ── Tags ───────────────────────────────────────────────
    def update_transaction_tags(self, transaction_id: int, account_id: int, tags: str) -> bool:
        with self.connection() as conn:
            result = conn.execute(
                'UPDATE transactions SET tags = %s WHERE id = %s AND account_id = %s',
                (tags, transaction_id, account_id)
            )
            return (result.rowcount or 0) > 0

    def get_all_tags(self, account_id: int) -> list:
        with self.connection() as conn:
            rows = conn.execute(
                "SELECT tags FROM transactions WHERE account_id = %s AND tags IS NOT NULL AND tags != ''",
                (account_id,)
            ).fetchall()
            tag_set = set()
            for r in rows:
                for t in (r['tags'] or '').split(','):
                    t = t.strip()
                    if t:
                        tag_set.add(t)
            return sorted(tag_set)

    # ── Spending Velocity ──────────────────────────────────
    def get_spending_velocity(self, account_id: int) -> dict:
        from ..database import USE_PG
        with self.connection() as conn:
            if USE_PG:
                row = conn.execute('''
                    SELECT COALESCE(SUM(amount), 0) AS total_out_30d
                    FROM transactions
                    WHERE account_id = %s
                      AND direction = 'out'
                      AND created_at >= CURRENT_DATE - INTERVAL '30 days'
                ''', (account_id,)).fetchone()
            else:
                row = conn.execute('''
                    SELECT COALESCE(SUM(amount), 0) AS total_out_30d
                    FROM transactions
                    WHERE account_id = %s
                      AND direction = 'out'
                      AND created_at >= date('now', '-30 days')
                ''', (account_id,)).fetchone()
            acc = conn.execute('SELECT balance FROM accounts WHERE id = %s', (account_id,)).fetchone()
            balance = float(acc['balance']) if acc else 0
            total_out = float(row['total_out_30d'] or 0)
            avg_daily = round(total_out / 30, 2)
            days_left = round(balance / avg_daily) if avg_daily > 0 else None
            return {
                'avg_daily_spend': avg_daily,
                'total_out_30d': total_out,
                'balance': balance,
                'days_until_zero': days_left,
            }

    # ── Top recipients ─────────────────────────────────────
    def get_top_recipients(self, account_id: int, limit: int = 5) -> list:
        with self.connection() as conn:
            return conn.execute('''
                SELECT related_account,
                       SUM(amount) AS total_sent,
                       COUNT(*) AS tx_count
                FROM transactions
                WHERE account_id = %s
                  AND direction = 'out'
                  AND related_account IS NOT NULL
                  AND related_account != ''
                GROUP BY related_account
                ORDER BY total_sent DESC
                LIMIT %s
            ''', (account_id, limit)).fetchall()

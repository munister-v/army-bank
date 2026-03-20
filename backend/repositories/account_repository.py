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

    def get_balance_history(self, account_id: int, days: int = 14) -> list:
        from datetime import date, timedelta
        with self.connection() as conn:
            rows = conn.execute(
                '''
                SELECT DATE(created_at) AS day,
                  COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE 0 END),0) AS total_in,
                  COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END),0) AS total_out
                FROM transactions WHERE account_id=%s
                  AND created_at >= CURRENT_DATE - (%s || ' days')::INTERVAL
                GROUP BY DATE(created_at) ORDER BY day ASC
                ''',
                (account_id, str(days)),
            ).fetchall()

            account = conn.execute('SELECT balance FROM accounts WHERE id = %s', (account_id,)).fetchone()
            current_balance = float(account['balance']) if account else 0.0

            period_in = sum(float(r['total_in']) for r in rows)
            period_out = sum(float(r['total_out']) for r in rows)
            start_balance = current_balance - period_in + period_out

            daily_map = {}
            for r in rows:
                day_key = str(r['day'])[:10]
                daily_map[day_key] = {'total_in': float(r['total_in']), 'total_out': float(r['total_out'])}

            result = []
            running = start_balance
            today = date.today()
            start_date = today - timedelta(days=days - 1)
            for i in range(days):
                d = start_date + timedelta(days=i)
                day_str = d.isoformat()
                if day_str in daily_map:
                    running += daily_map[day_str]['total_in'] - daily_map[day_str]['total_out']
                result.append({'day': day_str, 'balance': round(running, 2)})
            return result

    def get_spending_insights(self, account_id: int) -> dict:
        with self.connection() as conn:
            # Largest single expense this month
            biggest = conn.execute('''
                SELECT description, amount, tx_type FROM transactions
                WHERE account_id = %s AND direction = 'out'
                  AND created_at >= date_trunc('month', CURRENT_DATE)
                ORDER BY amount DESC LIMIT 1
            ''', (account_id,)).fetchone()

            # Most active day of week
            active_day = conn.execute('''
                SELECT EXTRACT(DOW FROM created_at) AS dow, COUNT(*) AS cnt
                FROM transactions WHERE account_id = %s
                  AND created_at >= CURRENT_DATE - INTERVAL '30 days'
                GROUP BY dow ORDER BY cnt DESC LIMIT 1
            ''', (account_id,)).fetchone()

            # Average transaction amount
            avg_tx = conn.execute('''
                SELECT COALESCE(AVG(amount), 0) AS avg_amount, COUNT(*) AS total
                FROM transactions WHERE account_id = %s
                  AND created_at >= date_trunc('month', CURRENT_DATE)
            ''', (account_id,)).fetchone()

            # Savings rate this month (in vs out)
            rates = conn.execute('''
                SELECT
                    COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE 0 END), 0) AS total_in,
                    COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END), 0) AS total_out
                FROM transactions WHERE account_id = %s
                  AND created_at >= date_trunc('month', CURRENT_DATE)
            ''', (account_id,)).fetchone()

            days_uk = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

            insights = []
            if biggest:
                insights.append({'icon': '💸', 'text': f"Найбільша витрата цього місяця: {biggest['description']} ({float(biggest['amount']):.2f} ₴)"})
            if active_day:
                dow = int(active_day['dow'])
                insights.append({'icon': '📅', 'text': f"Найактивніший день: {days_uk[dow]} ({int(active_day['cnt'])} операцій за 30 днів)"})
            if avg_tx and avg_tx['total'] > 0:
                insights.append({'icon': '📊', 'text': f"Середня операція цього місяця: {float(avg_tx['avg_amount']):.2f} ₴ (всього {int(avg_tx['total'])} операцій)"})
            if rates:
                tin, tout = float(rates['total_in']), float(rates['total_out'])
                if tin > 0:
                    savings_rate = round((tin - tout) / tin * 100, 1)
                    emoji = '🟢' if savings_rate > 20 else ('🟡' if savings_rate > 0 else '🔴')
                    insights.append({'icon': emoji, 'text': f"Норма заощадження: {savings_rate}% (прихід {tin:.0f} ₴, витрати {tout:.0f} ₴)"})

            return {'insights': insights}

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

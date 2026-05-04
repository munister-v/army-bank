"""Deposit Service — строкові банківські депозити.

Логіка:
  - Клієнт відкриває депозит: вибирає суму (min 500 UAH), строк (1/3/6/12 міс), авто-пролонгація
  - Кошти списуються з рахунку одразу
  - Нарахування відсотків: пропорційно днів
  - При закритті (достроково або по строку): повертаємо тіло + відсотки
  - Ставки (% річних): 1м→8%, 3м→10%, 6м→12%, 12м→14%
"""
from __future__ import annotations

import calendar
from datetime import datetime, timezone, date, timedelta
from typing import Optional

from ..database import get_connection, get_returning_id_suffix, insert_last_id


RATES = {1: 8.0, 3: 10.0, 6: 12.0, 12: 14.0}
MIN_AMOUNT = 500.0


class DepositService:

    def create_deposit(
        self,
        user_id: int,
        amount: float,
        term_months: int,
        auto_renew: bool = False,
        description: str = '',
    ) -> dict:
        self._ensure_schema()
        if amount < MIN_AMOUNT:
            raise ValueError(f'Мінімальна сума депозиту — ₴{MIN_AMOUNT:,.0f}.')
        if term_months not in RATES:
            raise ValueError(f'Доступні строки: {list(RATES.keys())} місяців.')

        interest_rate = RATES[term_months]
        today = date.today()
        maturity_date = self._add_months(today, term_months)
        term_days = (maturity_date - today).days
        interest_earned = round(amount * interest_rate / 100 * term_days / 365, 2)

        # Списуємо з рахунку
        with get_connection() as conn:
            acc = conn.execute(
                'SELECT id, balance FROM accounts WHERE user_id=%s', (user_id,)
            ).fetchone()
        if not acc:
            try:
                with get_connection() as conn:
                    acc = conn.execute(
                        'SELECT id, balance FROM accounts WHERE user_id=?', (user_id,)
                    ).fetchone()
            except Exception:
                pass
        if not acc:
            raise ValueError('Рахунок не знайдено.')
        if float(acc['balance']) < amount:
            raise ValueError('Недостатньо коштів.')

        for ph in ('%s', '?'):
            try:
                with get_connection() as conn:
                    cur = conn.execute(
                        f'UPDATE accounts SET balance = balance - {ph} WHERE id = {ph} AND balance >= {ph}',
                        (amount, acc['id'], amount),
                    )
                    if cur.rowcount == 0:
                        raise ValueError('Недостатньо коштів (конкурентна операція).')
                break
            except ValueError:
                raise
            except Exception:
                continue

        suffix = get_returning_id_suffix()
        for ph in ('%s', '?'):
            try:
                with get_connection() as conn:
                    cur = conn.execute(
                        f"INSERT INTO deposits"
                        f" (user_id, account_id, amount, interest_rate, term_months,"
                        f"  term_days, maturity_date, interest_earned, auto_renew, status, description)"
                        f" VALUES ({ph},{ph},{ph},{ph},{ph},{ph},{ph},{ph},{ph},'active',{ph})" + suffix,
                        (user_id, acc['id'], amount, interest_rate, term_months,
                         term_days, maturity_date.isoformat(), interest_earned,
                         bool(auto_renew), description or f'Депозит {term_months}м.'),
                    )
                    dep_id = insert_last_id(cur)
                return self.get_deposit(dep_id, user_id)
            except Exception:
                continue
        raise ValueError('Не вдалося створити депозит.')

    def list_deposits(self, user_id: int) -> list[dict]:
        self._ensure_schema()
        for ph in ('%s', '?'):
            try:
                with get_connection() as conn:
                    rows = conn.execute(
                        f'SELECT * FROM deposits WHERE user_id={ph} ORDER BY created_at DESC',
                        (user_id,),
                    ).fetchall()
                return [self._enrich(dict(r)) for r in rows]
            except Exception:
                continue
        return []

    def get_deposit(self, deposit_id: int, user_id: int) -> dict:
        self._ensure_schema()
        for ph in ('%s', '?'):
            try:
                with get_connection() as conn:
                    row = conn.execute(
                        f'SELECT * FROM deposits WHERE id={ph} AND user_id={ph}',
                        (deposit_id, user_id),
                    ).fetchone()
                if not row:
                    raise ValueError('Депозит не знайдено.')
                return self._enrich(dict(row))
            except ValueError:
                raise
            except Exception:
                continue
        raise ValueError('Депозит не знайдено.')

    def close_deposit(self, deposit_id: int, user_id: int, early: bool = False) -> dict:
        self._ensure_schema()
        dep = self.get_deposit(deposit_id, user_id)
        if dep['status'] not in ('active', 'matured'):
            raise ValueError(f'Депозит не можна закрити (статус: {dep["status"]}).')

        today = date.today()
        mat = date.fromisoformat(dep['maturity_date'])
        is_early = today < mat or early

        if is_early:
            # Дострокове закриття: відсотки не нараховуємо
            payout = round(float(dep['amount']), 2)
            interest = 0.0
        else:
            payout = round(float(dep['amount']) + float(dep['interest_earned']), 2)
            interest = float(dep['interest_earned'])

        # Повертаємо кошти на рахунок
        for ph in ('%s', '?'):
            try:
                with get_connection() as conn:
                    conn.execute(
                        f'UPDATE accounts SET balance = balance + {ph} WHERE id = {ph}',
                        (payout, dep['account_id']),
                    )
                break
            except Exception:
                continue

        now = datetime.now(timezone.utc).isoformat()
        new_status = 'withdrawn_early' if is_early else 'closed'
        for ph in ('%s', '?'):
            try:
                with get_connection() as conn:
                    conn.execute(
                        f"UPDATE deposits SET status={ph}, closed_at={ph}, interest_paid={ph}"
                        f" WHERE id={ph}",
                        (new_status, now, interest, deposit_id),
                    )
                break
            except Exception:
                continue

        return {
            'deposit_id': deposit_id,
            'status': new_status,
            'payout': payout,
            'interest_paid': interest,
            'early': is_early,
        }

    # ── Admin ─────────────────��──────────────────────────────────────────────

    def admin_list_deposits(self, status: Optional[str] = None, limit: int = 50) -> list[dict]:
        self._ensure_schema()
        for ph in ('%s', '?'):
            try:
                with get_connection() as conn:
                    if status:
                        rows = conn.execute(
                            f'SELECT d.*, u.full_name, u.phone FROM deposits d'
                            f' JOIN users u ON u.id = d.user_id'
                            f' WHERE d.status={ph} ORDER BY d.created_at DESC LIMIT {ph}',
                            (status, limit),
                        ).fetchall()
                    else:
                        rows = conn.execute(
                            f'SELECT d.*, u.full_name, u.phone FROM deposits d'
                            f' JOIN users u ON u.id = d.user_id'
                            f' ORDER BY d.created_at DESC LIMIT {ph}',
                            (limit,),
                        ).fetchall()
                return [self._enrich(dict(r)) for r in rows]
            except Exception:
                continue
        return []

    def admin_mature_deposits(self) -> dict:
        """EOD: знаходить депозити що досягли строку і позначає як matured."""
        self._ensure_schema()
        today = date.today().isoformat()
        matured = 0
        for ph in ('%s', '?'):
            try:
                with get_connection() as conn:
                    rows = conn.execute(
                        f"SELECT * FROM deposits WHERE status='active' AND maturity_date <= {ph}",
                        (today,),
                    ).fetchall()
                for r in rows:
                    dep = dict(r)
                    try:
                        self.close_deposit(dep['id'], dep['user_id'], early=False)
                        matured += 1
                    except Exception:
                        pass
                return {'matured': matured}
            except Exception:
                continue
        return {'matured': 0}

    # ── Helpers ───────────────────────────────────────────────────────��───────

    @staticmethod
    def _enrich(d: dict) -> dict:
        today = date.today()
        try:
            mat = date.fromisoformat(str(d.get('maturity_date', '')))
            days_left = (mat - today).days
            d['days_left'] = max(0, days_left)
            d['matured'] = days_left <= 0
            # Progress 0..1
            term_days = int(d.get('term_days') or 30)
            elapsed = term_days - max(0, days_left)
            d['progress'] = round(min(1.0, max(0.0, elapsed / term_days)), 4) if term_days > 0 else 1.0
        except Exception:
            d['days_left'] = 0
            d['matured'] = False
            d['progress'] = 0.0
        # Accrued interest so far (approx)
        try:
            if d.get('status') == 'active':
                term_days = int(d.get('term_days') or 30)
                elapsed = int(term_days * d.get('progress', 0))
                rate = float(d.get('interest_rate') or 0)
                amt = float(d.get('amount') or 0)
                d['interest_accrued'] = round(amt * rate / 100 * elapsed / 365, 2)
            else:
                d['interest_accrued'] = float(d.get('interest_paid') or 0)
        except Exception:
            d['interest_accrued'] = 0.0
        return d

    @staticmethod
    def _add_months(d: date, months: int) -> date:
        month = d.month - 1 + months
        year = d.year + month // 12
        month = month % 12 + 1
        day = min(d.day, calendar.monthrange(year, month)[1])
        return date(year, month, day)

    def _ensure_schema(self):
        for sql in [
            """CREATE TABLE IF NOT EXISTS deposits (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                account_id INTEGER NOT NULL,
                amount NUMERIC(14,2) NOT NULL,
                interest_rate NUMERIC(5,2) NOT NULL,
                term_months INTEGER NOT NULL,
                term_days INTEGER NOT NULL,
                maturity_date DATE NOT NULL,
                interest_earned NUMERIC(14,2) NOT NULL DEFAULT 0,
                interest_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
                interest_accrued NUMERIC(14,2) NOT NULL DEFAULT 0,
                auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
                status VARCHAR(30) NOT NULL DEFAULT 'active',
                description TEXT NOT NULL DEFAULT '',
                closed_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )""",
            """CREATE TABLE IF NOT EXISTS deposits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                account_id INTEGER NOT NULL,
                amount REAL NOT NULL,
                interest_rate REAL NOT NULL,
                term_months INTEGER NOT NULL,
                term_days INTEGER NOT NULL,
                maturity_date TEXT NOT NULL,
                interest_earned REAL NOT NULL DEFAULT 0,
                interest_paid REAL NOT NULL DEFAULT 0,
                interest_accrued REAL NOT NULL DEFAULT 0,
                auto_renew INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'active',
                description TEXT NOT NULL DEFAULT '',
                closed_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )""",
        ]:
            try:
                with get_connection() as conn:
                    conn.execute(sql)
                return
            except Exception:
                continue

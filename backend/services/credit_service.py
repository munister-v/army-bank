"""Credit Service — споживчі кредити Army Bank.

Логіка:
  - Клієнт оформлює кредит: сума (1000–500000 UAH), строк (3/6/12/24/36 міс)
  - Зараховуємо суму на рахунок одразу
  - Щомісячний платіж — ануїтет: principal * r * (1+r)^n / ((1+r)^n - 1)
  - Balance remaining зберігає повну суму до сплати за графіком, а не лише тіло кредиту
  - Ставки (% річних): 3м→18%, 6м→20%, 12м→22%, 24м→24%, 36м→26%
"""
from __future__ import annotations

from datetime import date, timezone, datetime
from typing import Optional

from ..database import get_connection, get_returning_id_suffix, insert_last_id


RATES: dict[int, float] = {3: 18.0, 6: 20.0, 12: 22.0, 24: 24.0, 36: 26.0}
MIN_AMOUNT = 1_000.0
MAX_AMOUNT = 500_000.0


def _pmt(principal: float, annual_rate_pct: float, months: int) -> float:
    """Ануїтетний щомісячний платіж."""
    r = annual_rate_pct / 100 / 12
    if r == 0:
        return round(principal / months, 2)
    factor = (1 + r) ** months
    return round(principal * r * factor / (factor - 1), 2)


def _scheduled_total(monthly_payment: float, months: int) -> float:
    return round(monthly_payment * months, 2)


def _add_months(d: date, n: int) -> date:
    month = d.month - 1 + n
    year = d.year + month // 12
    month = month % 12 + 1
    import calendar
    day = min(d.day, calendar.monthrange(year, month)[1])
    return d.replace(year=year, month=month, day=day)


class CreditService:

    # ── Schema ────────────────────────────────────────────────────────────────

    def _ensure_schema(self):
        for sql in [
            # PostgreSQL
            """CREATE TABLE IF NOT EXISTS credits (
                id                SERIAL PRIMARY KEY,
                user_id           INTEGER NOT NULL,
                account_id        INTEGER NOT NULL,
                principal         NUMERIC(14,2) NOT NULL,
                interest_rate     NUMERIC(5,2)  NOT NULL,
                term_months       INTEGER NOT NULL,
                monthly_payment   NUMERIC(14,2) NOT NULL,
                total_paid        NUMERIC(14,2) NOT NULL DEFAULT 0,
                balance_remaining NUMERIC(14,2) NOT NULL,
                next_payment_date DATE NOT NULL,
                status            VARCHAR(30)   NOT NULL DEFAULT 'active',
                description       TEXT          NOT NULL DEFAULT '',
                created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
            )""",
            # SQLite
            """CREATE TABLE IF NOT EXISTS credits (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id           INTEGER NOT NULL,
                account_id        INTEGER NOT NULL,
                principal         REAL    NOT NULL,
                interest_rate     REAL    NOT NULL,
                term_months       INTEGER NOT NULL,
                monthly_payment   REAL    NOT NULL,
                total_paid        REAL    NOT NULL DEFAULT 0,
                balance_remaining REAL    NOT NULL,
                next_payment_date TEXT    NOT NULL,
                status            TEXT    NOT NULL DEFAULT 'active',
                description       TEXT    NOT NULL DEFAULT '',
                created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
            )""",
        ]:
            try:
                with get_connection() as conn:
                    conn.execute(sql)
                return
            except Exception:
                continue

    # ── Create ────────────────────────────────────────────────────────────────

    def create_credit(
        self,
        user_id: int,
        amount: float,
        term_months: int,
        description: str = '',
    ) -> dict:
        self._ensure_schema()
        if amount < MIN_AMOUNT or amount > MAX_AMOUNT:
            raise ValueError(f'Сума кредиту: від ₴{MIN_AMOUNT:,.0f} до ₴{MAX_AMOUNT:,.0f}.')
        if term_months not in RATES:
            raise ValueError(f'Доступні строки: {list(RATES.keys())} місяців.')

        rate = RATES[term_months]
        monthly = _pmt(amount, rate, term_months)
        total_due = _scheduled_total(monthly, term_months)
        today = date.today()
        next_payment = _add_months(today, 1)
        now_iso = datetime.now(timezone.utc).isoformat()

        acc = self._get_account(user_id)
        if not acc:
            raise ValueError('Рахунок не знайдено.')

        suffix = get_returning_id_suffix()
        credit_title = description or f'Кредит {term_months} міс.'

        try:
            with get_connection() as conn:
                conn.execute(
                    'UPDATE accounts SET balance = balance + %s WHERE id = %s',
                    (amount, acc['id']),
                )
                cur = conn.execute(
                    "INSERT INTO credits"
                    " (user_id, account_id, principal, interest_rate, term_months,"
                    "  monthly_payment, total_paid, balance_remaining,"
                    "  next_payment_date, status, description, created_at)"
                    " VALUES (%s,%s,%s,%s,%s,%s,0,%s,%s,'active',%s,%s)" + suffix,
                    (
                        user_id,
                        acc['id'],
                        amount,
                        rate,
                        term_months,
                        monthly,
                        total_due,
                        next_payment.isoformat(),
                        credit_title,
                        now_iso,
                    ),
                )
                credit_id = insert_last_id(cur)
                conn.execute(
                    """INSERT INTO transactions(account_id, tx_type, direction, amount, description, related_account)
                       VALUES(%s, %s, %s, %s, %s, %s)""",
                    (
                        acc['id'],
                        'credit',
                        'in',
                        amount,
                        f'Видача кредиту: {credit_title}',
                        f'CREDIT-{credit_id}',
                    ),
                )
            return self._get_credit(credit_id, user_id)
        except Exception as exc:
            raise ValueError(f'Не вдалося оформити кредит: {exc}') from exc

    # ── List ─────────────────────────────────────────────────────────────────

    def list_credits(self, user_id: int) -> list[dict]:
        self._ensure_schema()
        for ph in ('%s', '?'):
            try:
                with get_connection() as conn:
                    rows = conn.execute(
                        f'SELECT * FROM credits WHERE user_id={ph} ORDER BY created_at DESC',
                        (user_id,),
                    ).fetchall()
                return [self._enrich(dict(r)) for r in rows]
            except Exception:
                continue
        return []

    # ── Get ──────────────────────────────────────────────────────────────────

    def _get_credit(self, credit_id: int, user_id: int) -> dict:
        for ph in ('%s', '?'):
            try:
                with get_connection() as conn:
                    row = conn.execute(
                        f'SELECT * FROM credits WHERE id={ph} AND user_id={ph}',
                        (credit_id, user_id),
                    ).fetchone()
                if not row:
                    raise ValueError('Кредит не знайдено.')
                return self._enrich(dict(row))
            except ValueError:
                raise
            except Exception:
                continue
        raise ValueError('Кредит не знайдено.')

    def get_credit(self, credit_id: int, user_id: int) -> dict:
        self._ensure_schema()
        return self._get_credit(credit_id, user_id)

    # ── Repay ────────────────────────────────────────────────────────────────

    def repay(self, credit_id: int, user_id: int, amount: Optional[float] = None) -> dict:
        self._ensure_schema()
        credit = self._get_credit(credit_id, user_id)
        if credit['status'] != 'active':
            raise ValueError('Кредит вже закрито.')

        pay = amount if amount and amount > 0 else credit['monthly_payment']
        pay = min(pay, credit['balance_remaining'])

        acc = self._get_account(user_id)
        if not acc:
            raise ValueError('Рахунок не знайдено.')
        if float(acc['balance']) < pay:
            raise ValueError('Недостатньо коштів для погашення.')

        new_balance = round(credit['balance_remaining'] - pay, 2)
        new_total = round(credit['total_paid'] + pay, 2)
        new_status = 'closed' if new_balance <= 0 else 'active'
        today = date.today()
        try:
            current_next = date.fromisoformat(str(credit.get('next_payment_date') or ''))
        except Exception:
            current_next = today
        schedule_anchor = current_next if current_next >= today else today
        next_payment = _add_months(schedule_anchor, 1).isoformat()
        repayment_desc = f'Погашення кредиту #{credit_id}'

        with get_connection() as conn:
            cur = conn.execute(
                'UPDATE accounts SET balance = balance - %s WHERE id = %s AND balance >= %s',
                (pay, acc['id'], pay),
            )
            if cur.rowcount == 0:
                raise ValueError('Недостатньо коштів (конкурентна операція).')

            conn.execute(
                'UPDATE credits SET balance_remaining=%s, total_paid=%s,'
                ' status=%s, next_payment_date=%s WHERE id=%s',
                (new_balance, new_total, new_status, next_payment, credit_id),
            )
            conn.execute(
                """INSERT INTO transactions(account_id, tx_type, direction, amount, description, related_account)
                   VALUES(%s, %s, %s, %s, %s, %s)""",
                (
                    acc['id'],
                    'credit_payment',
                    'out',
                    pay,
                    repayment_desc,
                    f'CREDIT-{credit_id}',
                ),
            )

        return self._get_credit(credit_id, user_id)

    # ── Admin ────────────────────────────────────────────────────────────────

    def admin_list_credits(self, status: Optional[str] = None, limit: int = 100) -> list[dict]:
        self._ensure_schema()
        for ph in ('%s', '?'):
            try:
                with get_connection() as conn:
                    if status:
                        rows = conn.execute(
                            f'SELECT * FROM credits WHERE status={ph} ORDER BY created_at DESC LIMIT {ph}',
                            (status, limit),
                        ).fetchall()
                    else:
                        rows = conn.execute(
                            f'SELECT * FROM credits ORDER BY created_at DESC LIMIT {ph}',
                            (limit,),
                        ).fetchall()
                return [self._enrich(dict(r)) for r in rows]
            except Exception:
                continue
        return []

    # ── Helpers ──────────────────────────────────────────────────────────────

    def _get_account(self, user_id: int):
        for ph in ('%s', '?'):
            try:
                with get_connection() as conn:
                    row = conn.execute(
                        f'SELECT id, balance FROM accounts WHERE user_id={ph}',
                        (user_id,),
                    ).fetchone()
                if row:
                    return dict(row)
            except Exception:
                continue
        return None

    def _enrich(self, c: dict) -> dict:
        try:
            next_date = date.fromisoformat(str(c.get('next_payment_date', '')))
            c['days_to_payment'] = (next_date - date.today()).days
        except Exception:
            c['days_to_payment'] = None

        principal = float(c.get('principal') or 0)
        monthly_payment = float(c.get('monthly_payment') or 0)
        term_months = int(c.get('term_months') or 0)
        scheduled_total = _scheduled_total(monthly_payment, term_months) if monthly_payment and term_months else principal
        balance = float(c.get('balance_remaining') or 0)
        total_paid = float(c.get('total_paid') or 0)
        c['scheduled_total'] = scheduled_total
        c['progress'] = round(min(100.0, (total_paid / scheduled_total) * 100), 1) if scheduled_total > 0 else 100.0
        return c

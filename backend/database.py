"""Модуль роботи з БД: PostgreSQL або SQLite."""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from .config import (
    DATABASE_PATH, DATABASE_URL, SCHEMA_PATH, SCHEMA_PG_PATH, USE_PG,
    ADMIN_EMAIL, ADMIN_PHONE, ADMIN_NAME, ADMIN_PASSWORD,
)

if USE_PG:
    import psycopg2
    from psycopg2.extras import RealDictCursor


def dict_factory(cursor: sqlite3.Cursor, row: tuple) -> dict:
    """Повертає рядок SQLite у вигляді словника."""
    return {col[0]: row[idx] for idx, col in enumerate(cursor.description)}


@contextmanager
def get_connection_sqlite() -> Iterator[sqlite3.Connection]:
    """Підключення до SQLite."""
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = dict_factory
    conn.execute('PRAGMA foreign_keys = ON;')
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@contextmanager
def get_connection_pg() -> Iterator:
    """Підключення до PostgreSQL."""
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


class _SqliteConnWrapper:
    """Обгортка: execute приймає SQL з %s і підставляє ? для SQLite."""
    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql: str, params=()):
        sql = sql.replace('%s', '?')
        return self._conn.execute(sql, params)


class _PgConnWrapper:
    """Обгортка: execute через cursor для однакового API."""
    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql: str, params=()):
        cur = self._conn.cursor()
        cur.execute(sql, params)
        return cur


@contextmanager
def get_connection() -> Iterator:
    """Єдиний контекст підключення: у репозиторіях використовуйте %s у SQL."""
    if USE_PG:
        with get_connection_pg() as conn:
            yield _PgConnWrapper(conn)
    else:
        with get_connection_sqlite() as conn:
            yield _SqliteConnWrapper(conn)


RECURRING_TX_DDL = """
CREATE TABLE IF NOT EXISTS recurring_transactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    tx_type VARCHAR(30) NOT NULL DEFAULT 'transfer',
    recipient_account VARCHAR(50),
    description TEXT NOT NULL DEFAULT '',
    frequency VARCHAR(20) NOT NULL DEFAULT 'monthly',
    next_run_date DATE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

RECURRING_TX_DDL_SQLITE = """
CREATE TABLE IF NOT EXISTS recurring_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    amount REAL NOT NULL CHECK (amount > 0),
    tx_type TEXT NOT NULL DEFAULT 'transfer',
    recipient_account TEXT,
    description TEXT NOT NULL DEFAULT '',
    frequency TEXT NOT NULL DEFAULT 'monthly',
    next_run_date TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

DEBTS_DDL = """
CREATE TABLE IF NOT EXISTS debts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_name VARCHAR(150) NOT NULL,
    amount NUMERIC(14,2) NOT NULL,
    direction VARCHAR(20) NOT NULL DEFAULT 'owed_to_me',
    description TEXT,
    is_settled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settled_at TIMESTAMPTZ
);
"""

DEBTS_DDL_SQLITE = """
CREATE TABLE IF NOT EXISTS debts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_name TEXT NOT NULL,
    amount REAL NOT NULL,
    direction TEXT NOT NULL DEFAULT 'owed_to_me',
    description TEXT,
    is_settled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    settled_at TEXT
);
"""

NOTIFICATIONS_DDL = """
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL DEFAULT 'info',
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    icon VARCHAR(10) NOT NULL DEFAULT '🔔',
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

NOTIFICATIONS_DDL_SQLITE = """
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'info',
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT '🔔',
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

BUDGET_LIMITS_DDL = """
CREATE TABLE IF NOT EXISTS budget_limits (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tx_type VARCHAR(30) NOT NULL,
    monthly_limit NUMERIC(14,2) NOT NULL CHECK (monthly_limit > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, tx_type)
);
"""

BUDGET_LIMITS_DDL_SQLITE = """
CREATE TABLE IF NOT EXISTS budget_limits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tx_type TEXT NOT NULL,
    monthly_limit REAL NOT NULL CHECK (monthly_limit > 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, tx_type)
);
"""


def init_db() -> None:
    """Ініціалізує схему БД."""
    if USE_PG:
        schema_sql = Path(SCHEMA_PG_PATH).read_text(encoding='utf-8')
        with get_connection_pg() as conn:
            with conn.cursor() as cur:
                cur.execute(schema_sql)
                cur.execute(NOTIFICATIONS_DDL)
                cur.execute(BUDGET_LIMITS_DDL)
                cur.execute(RECURRING_TX_DDL)
                cur.execute(DEBTS_DDL)
                try:
                    cur.execute('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS note TEXT;')
                except Exception:
                    pass
                try:
                    cur.execute('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tags TEXT;')
                except Exception:
                    pass
                try:
                    cur.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash TEXT;')
                except Exception:
                    pass
    else:
        schema_sql = Path(SCHEMA_PATH).read_text(encoding='utf-8')
        with get_connection_sqlite() as conn:
            conn.executescript(schema_sql)
            conn.executescript(NOTIFICATIONS_DDL_SQLITE)
            conn.executescript(BUDGET_LIMITS_DDL_SQLITE)
            conn.executescript(RECURRING_TX_DDL_SQLITE)
            conn.executescript(DEBTS_DDL_SQLITE)
            try:
                conn.execute('ALTER TABLE transactions ADD COLUMN note TEXT;')
            except Exception:
                pass
            try:
                conn.execute('ALTER TABLE transactions ADD COLUMN tags TEXT;')
            except Exception:
                pass
            try:
                conn.execute('ALTER TABLE users ADD COLUMN pin_hash TEXT;')
            except Exception:
                pass


def init_admin() -> None:
    """Якщо задано ADMIN_EMAIL + ADMIN_PASSWORD і ще немає platform_admin — сідає seed-адмін."""
    if not ADMIN_EMAIL or not ADMIN_PASSWORD:
        return
    try:
        import bcrypt as _bcrypt

        def _hash(pw: str) -> str:
            return _bcrypt.hashpw(pw.encode(), _bcrypt.gensalt()).decode()
    except ImportError:
        import hashlib as _hashlib

        def _hash(pw: str) -> str:
            return _hashlib.sha256(pw.encode()).hexdigest()

    with get_connection() as conn:
        admin_cnt = conn.execute(
            "SELECT COUNT(*) as n FROM users WHERE role IN ('admin','platform_admin')"
        ).fetchone()
        if admin_cnt and admin_cnt['n'] > 0:
            return  # already seeded

        # Check if user exists, update role; otherwise create
        existing = conn.execute(
            'SELECT id FROM users WHERE email = %s OR phone = %s',
            (ADMIN_EMAIL, ADMIN_PHONE)
        ).fetchone()

        if existing:
            conn.execute(
                "UPDATE users SET role = 'platform_admin' WHERE id = %s",
                (existing['id'],)
            )
        else:
            pw_hash = _hash(ADMIN_PASSWORD)
            suffix = get_returning_id_suffix()
            cur = conn.execute(
                'INSERT INTO users (full_name, phone, email, password_hash, role) '
                "VALUES (%s, %s, %s, %s, 'platform_admin')" + suffix,
                (ADMIN_NAME, ADMIN_PHONE, ADMIN_EMAIL, pw_hash)
            )
            uid = insert_last_id(cur)
            acc_num = f'AB-{100000 + uid}'
            conn.execute(
                'INSERT INTO accounts (user_id, account_number) VALUES (%s, %s)',
                (uid, acc_num)
            )


def get_returning_id_suffix() -> str:
    """Для INSERT у PostgreSQL додайте ' RETURNING id' до запиту."""
    return ' RETURNING id' if USE_PG else ''


def insert_last_id(cursor) -> int:
    """Повертає id після INSERT: RETURNING id для PG, lastrowid для SQLite."""
    if USE_PG:
        row = cursor.fetchone()
        return row['id'] if row else None
    return cursor.lastrowid

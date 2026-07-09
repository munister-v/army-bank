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
    import psycopg2.pool
    from psycopg2.extras import RealDictCursor

# ── PostgreSQL connection pool (shared across all requests) ──────────────────
# Reuses connections instead of opening a new one per request (~50-200ms saved)
_pg_pool: 'psycopg2.pool.ThreadedConnectionPool | None' = None


def _get_pg_pool():
    global _pg_pool
    if _pg_pool is None or _pg_pool.closed:
        _pg_pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=1,
            maxconn=5,          # Render free PG allows ~10; keep headroom
            dsn=DATABASE_URL,
            cursor_factory=RealDictCursor,
            connect_timeout=5,  # don't block app boot forever when PG is cold/unreachable
        )
    return _pg_pool


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
    """Отримує з'єднання з пулу, повертає після використання."""
    pool = _get_pg_pool()
    conn = pool.getconn()
    had_error = False

    # Pool can return stale SSL connections after idle periods on Render.
    # Validate once on checkout and replace dead connections immediately.
    try:
        cur = conn.cursor()
        cur.execute('SELECT 1')
        cur.fetchone()
        cur.close()
    except Exception:
        try:
            pool.putconn(conn, close=True)
        except Exception:
            pass
        conn = pool.getconn()

    try:
        yield conn
        conn.commit()
    except Exception:
        had_error = True
        try:
            if not getattr(conn, 'closed', 1):
                conn.rollback()
        except Exception:
            # Ignore rollback failure on broken/closed connections.
            pass
        raise
    finally:
        try:
            is_closed = bool(getattr(conn, 'closed', 1))
            if had_error or is_closed:
                pool.putconn(conn, close=True)
            else:
                pool.putconn(conn)
        except Exception:
            pass


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

CARDS_DDL = """
CREATE TABLE IF NOT EXISTS cards (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    card_number TEXT NOT NULL UNIQUE,
    card_type TEXT NOT NULL DEFAULT 'virtual',
    design VARCHAR(20) NOT NULL DEFAULT 'gold',
    status TEXT NOT NULL DEFAULT 'active',
    holder_name TEXT,
    cvv VARCHAR(3) NOT NULL DEFAULT '000',
    issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATE NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cards_account_id ON cards(account_id);
CREATE INDEX IF NOT EXISTS idx_cards_card_number ON cards(card_number);
"""

CARDS_DDL_SQLITE = """
CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    card_number TEXT NOT NULL UNIQUE,
    card_type TEXT NOT NULL DEFAULT 'virtual',
    design TEXT NOT NULL DEFAULT 'gold',
    status TEXT NOT NULL DEFAULT 'active',
    holder_name TEXT,
    cvv TEXT NOT NULL DEFAULT '000',
    issued_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cards_account_id ON cards(account_id);
CREATE INDEX IF NOT EXISTS idx_cards_card_number ON cards(card_number);
"""

PAYMENT_CORE_DDL = """
CREATE TABLE IF NOT EXISTS payment_orders (
    id SERIAL PRIMARY KEY,
    idempotency_key VARCHAR(64) NOT NULL UNIQUE,
    initiator_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sender_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    recipient_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    amount NUMERIC(14,2) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    risk_score INTEGER NOT NULL DEFAULT 0,
    risk_level VARCHAR(20) NOT NULL DEFAULT 'low',
    risk_flags TEXT NOT NULL DEFAULT '[]',
    review_state VARCHAR(20) NOT NULL DEFAULT 'none',
    assigned_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ,
    decision_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    decision_note TEXT,
    decided_at TIMESTAMPTZ,
    escalation_level INTEGER NOT NULL DEFAULT 0,
    approval_state VARCHAR(20) NOT NULL DEFAULT 'none',
    approval_requested_action VARCHAR(20),
    approval_requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    approval_requested_at TIMESTAMPTZ,
    approval_decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    approval_decided_at TIMESTAMPTZ,
    approval_note TEXT,
    tx_id_out INTEGER,
    tx_id_in INTEGER,
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);
CREATE INDEX IF NOT EXISTS idx_payment_orders_risk_level ON payment_orders(risk_level);
CREATE INDEX IF NOT EXISTS idx_payment_orders_user ON payment_orders(initiator_user_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_assigned_admin ON payment_orders(assigned_admin_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_review_state ON payment_orders(review_state);
CREATE INDEX IF NOT EXISTS idx_payment_orders_approval_state ON payment_orders(approval_state);

CREATE TABLE IF NOT EXISTS risk_events (
    id SERIAL PRIMARY KEY,
    payment_order_id INTEGER REFERENCES payment_orders(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    event_type VARCHAR(60) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'low',
    score_delta INTEGER NOT NULL DEFAULT 0,
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_risk_events_severity ON risk_events(severity);
CREATE INDEX IF NOT EXISTS idx_risk_events_resolved ON risk_events(resolved_at);

CREATE TABLE IF NOT EXISTS payment_order_events (
    id SERIAL PRIMARY KEY,
    payment_order_id INTEGER NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    event_type VARCHAR(40) NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_order_events_order ON payment_order_events(payment_order_id);
CREATE INDEX IF NOT EXISTS idx_payment_order_events_type ON payment_order_events(event_type);

CREATE TABLE IF NOT EXISTS integrity_hashes (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    prev_hash VARCHAR(64) NOT NULL,
    tx_hash VARCHAR(64) NOT NULL,
    chain_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_integrity_hashes_account ON integrity_hashes(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_integrity_hashes_tx ON integrity_hashes(transaction_id);
"""

PAYMENT_CORE_DDL_SQLITE = """
CREATE TABLE IF NOT EXISTS payment_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    idempotency_key TEXT NOT NULL UNIQUE,
    initiator_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sender_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    recipient_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    amount REAL NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    risk_score INTEGER NOT NULL DEFAULT 0,
    risk_level TEXT NOT NULL DEFAULT 'low',
    risk_flags TEXT NOT NULL DEFAULT '[]',
    review_state TEXT NOT NULL DEFAULT 'none',
    assigned_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TEXT,
    decision_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    decision_note TEXT,
    decided_at TEXT,
    escalation_level INTEGER NOT NULL DEFAULT 0,
    approval_state TEXT NOT NULL DEFAULT 'none',
    approval_requested_action TEXT,
    approval_requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    approval_requested_at TEXT,
    approval_decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    approval_decided_at TEXT,
    approval_note TEXT,
    tx_id_out INTEGER,
    tx_id_in INTEGER,
    failure_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS risk_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_order_id INTEGER REFERENCES payment_orders(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'low',
    score_delta INTEGER NOT NULL DEFAULT 0,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT,
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS payment_order_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_order_id INTEGER NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS integrity_hashes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    prev_hash TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    chain_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

IDEMPOTENCY_DDL = """
CREATE TABLE IF NOT EXISTS api_idempotency (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action VARCHAR(80) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'processing',
    response_code INTEGER,
    response_payload TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, action, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_api_idempotency_created ON api_idempotency(created_at);
"""

IDEMPOTENCY_DDL_SQLITE = """
CREATE TABLE IF NOT EXISTS api_idempotency (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'processing',
    response_code INTEGER,
    response_payload TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, action, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_api_idempotency_created ON api_idempotency(created_at);
"""


MESSENGER_DDL = """
CREATE TABLE IF NOT EXISTS conversations (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_message_at TIMESTAMPTZ,
    last_message_text VARCHAR(200)
);
CREATE TABLE IF NOT EXISTS conversation_participants (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_read_at TIMESTAMPTZ,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE(conversation_id, user_id)
);
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_participants_user ON conversation_participants(user_id);
"""

MESSENGER_DDL_SQLITE = """
CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_message_at TEXT,
    last_message_text TEXT
);
CREATE TABLE IF NOT EXISTS conversation_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_read_at TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0,
    UNIQUE(conversation_id, user_id)
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conv_participants_user ON conversation_participants(user_id);
"""

MESSENGER_GROUPS_DDL = """
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_group BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS group_name VARCHAR(100);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS msg_type VARCHAR(20) NOT NULL DEFAULT 'text';
CREATE TABLE IF NOT EXISTS calls (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    caller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    sdp_offer TEXT,
    sdp_answer TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS call_ice (
    id SERIAL PRIMARY KEY,
    call_id INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    candidate TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_calls_conv ON calls(conversation_id);
CREATE INDEX IF NOT EXISTS idx_call_ice_call ON call_ice(call_id, created_at);
CREATE TABLE IF NOT EXISTS call_members (
    id SERIAL PRIMARY KEY,
    call_id INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state VARCHAR(20) NOT NULL DEFAULT 'invited',
    joined_at TIMESTAMPTZ,
    left_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(call_id, user_id)
);
CREATE TABLE IF NOT EXISTS call_signals (
    id SERIAL PRIMARY KEY,
    call_id INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    signal_type VARCHAR(20) NOT NULL,
    payload TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_call_members_call ON call_members(call_id);
CREATE INDEX IF NOT EXISTS idx_call_members_user ON call_members(user_id);
CREATE INDEX IF NOT EXISTS idx_call_signals_call ON call_signals(call_id, id);
CREATE INDEX IF NOT EXISTS idx_call_signals_target ON call_signals(call_id, to_user_id, id);
"""

MESSENGER_GROUPS_DDL_SQLITE = """
CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    caller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    sdp_offer TEXT,
    sdp_answer TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    ended_at TEXT
);
CREATE TABLE IF NOT EXISTS call_ice (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    candidate TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_calls_conv ON calls(conversation_id);
CREATE INDEX IF NOT EXISTS idx_call_ice_call ON call_ice(call_id);
CREATE TABLE IF NOT EXISTS call_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state TEXT NOT NULL DEFAULT 'invited',
    joined_at TEXT,
    left_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(call_id, user_id)
);
CREATE TABLE IF NOT EXISTS call_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    signal_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_call_members_call ON call_members(call_id);
CREATE INDEX IF NOT EXISTS idx_call_members_user ON call_members(user_id);
CREATE INDEX IF NOT EXISTS idx_call_signals_call ON call_signals(call_id, id);
CREATE INDEX IF NOT EXISTS idx_call_signals_target ON call_signals(call_id, to_user_id, id);
"""

DOC_TEMPLATES_DDL = """
CREATE TABLE IF NOT EXISTS document_templates (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    category VARCHAR(50) NOT NULL DEFAULT 'general',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

DOC_TEMPLATES_DDL_SQLITE = """
CREATE TABLE IF NOT EXISTS document_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'general',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

USER_DOCS_DDL = """
CREATE TABLE IF NOT EXISTS user_documents (
    id SERIAL PRIMARY KEY,
    template_id INTEGER NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sent_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_user_docs_user ON user_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_user_docs_template ON user_documents(template_id);
"""

USER_DOCS_DDL_SQLITE = """
CREATE TABLE IF NOT EXISTS user_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sent_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sent_at TEXT NOT NULL DEFAULT (datetime('now')),
    notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_user_docs_user ON user_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_user_docs_template ON user_documents(template_id);
"""


def init_db() -> None:
    """Ініціалізує схему БД."""
    if USE_PG:
        schema_sql = Path(SCHEMA_PG_PATH).read_text(encoding='utf-8')
        with get_connection_pg() as conn:
            def _pg_exec(sql: str, *, optional: bool = False, label: str = '') -> None:
                try:
                    with conn.cursor() as cur:
                        cur.execute(sql)
                    conn.commit()
                except Exception as exc:
                    conn.rollback()
                    if not optional:
                        raise
                    if label:
                        print(f'[Army Bank] init_db optional migration skipped ({label}): {exc}')

            _pg_exec(schema_sql, label='schema_pg.sql')
            _pg_exec(NOTIFICATIONS_DDL, optional=True, label='notifications')
            _pg_exec(BUDGET_LIMITS_DDL, optional=True, label='budget_limits')
            _pg_exec(RECURRING_TX_DDL, optional=True, label='recurring_transactions')
            _pg_exec(DEBTS_DDL, optional=True, label='debts')
            _pg_exec(CARDS_DDL, optional=True, label='cards')
            _pg_exec(PAYMENT_CORE_DDL, optional=True, label='payment_core')

            _pg_exec(
                'ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_order_id INTEGER REFERENCES payment_orders(id);',
                optional=True,
                label='transactions.payment_order_id',
            )
            _pg_exec(
                'ALTER TABLE transactions ADD COLUMN IF NOT EXISTS note TEXT;',
                optional=True,
                label='transactions.note',
            )
            _pg_exec(
                'ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tags TEXT;',
                optional=True,
                label='transactions.tags',
            )
            _pg_exec(
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash TEXT;',
                optional=True,
                label='users.pin_hash',
            )
            _pg_exec(
                'ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT NULL;',
                optional=True,
                label='users.last_seen_at',
            )
            _pg_exec(
                "ALTER TABLE cards ADD COLUMN IF NOT EXISTS design VARCHAR(20) NOT NULL DEFAULT 'gold';",
                optional=True,
                label='cards.design',
            )
            _pg_exec(
                "ALTER TABLE cards ADD COLUMN IF NOT EXISTS cvv VARCHAR(3) NOT NULL DEFAULT '000';",
                optional=True,
                label='cards.cvv',
            )
            _pg_exec(
                "ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS review_state VARCHAR(20) NOT NULL DEFAULT 'none';",
                optional=True,
                label='payment_orders.review_state',
            )
            _pg_exec(
                "ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS assigned_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL;",
                optional=True,
                label='payment_orders.assigned_admin_id',
            )
            _pg_exec(
                "ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;",
                optional=True,
                label='payment_orders.assigned_at',
            )
            _pg_exec(
                "ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS decision_by INTEGER REFERENCES users(id) ON DELETE SET NULL;",
                optional=True,
                label='payment_orders.decision_by',
            )
            _pg_exec(
                "ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS decision_note TEXT;",
                optional=True,
                label='payment_orders.decision_note',
            )
            _pg_exec(
                "ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;",
                optional=True,
                label='payment_orders.decided_at',
            )
            _pg_exec(
                "ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS escalation_level INTEGER NOT NULL DEFAULT 0;",
                optional=True,
                label='payment_orders.escalation_level',
            )
            _pg_exec(
                "ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS approval_state VARCHAR(20) NOT NULL DEFAULT 'none';",
                optional=True,
                label='payment_orders.approval_state',
            )
            _pg_exec(
                "ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS approval_requested_action VARCHAR(20);",
                optional=True,
                label='payment_orders.approval_requested_action',
            )
            _pg_exec(
                "ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS approval_requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL;",
                optional=True,
                label='payment_orders.approval_requested_by',
            )
            _pg_exec(
                "ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS approval_requested_at TIMESTAMPTZ;",
                optional=True,
                label='payment_orders.approval_requested_at',
            )
            _pg_exec(
                "ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS approval_decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL;",
                optional=True,
                label='payment_orders.approval_decided_by',
            )
            _pg_exec(
                "ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS approval_decided_at TIMESTAMPTZ;",
                optional=True,
                label='payment_orders.approval_decided_at',
            )
            _pg_exec(
                "ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS approval_note TEXT;",
                optional=True,
                label='payment_orders.approval_note',
            )
            _pg_exec(
                "CREATE INDEX IF NOT EXISTS idx_payment_orders_approval_state ON payment_orders(approval_state);",
                optional=True,
                label='idx_payment_orders_approval_state',
            )
            _pg_exec(
                """CREATE TABLE IF NOT EXISTS payment_order_events (
                    id SERIAL PRIMARY KEY,
                    payment_order_id INTEGER NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
                    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    event_type VARCHAR(40) NOT NULL,
                    details TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );""",
                optional=True,
                label='payment_order_events.table',
            )
            _pg_exec(
                'CREATE INDEX IF NOT EXISTS idx_payment_order_events_order ON payment_order_events(payment_order_id);',
                optional=True,
                label='payment_order_events.idx_order',
            )
            _pg_exec(
                'CREATE INDEX IF NOT EXISTS idx_payment_order_events_type ON payment_order_events(event_type);',
                optional=True,
                label='payment_order_events.idx_type',
            )
            _pg_exec(IDEMPOTENCY_DDL, optional=True, label='api_idempotency')
            _pg_exec(DOC_TEMPLATES_DDL, optional=True, label='document_templates')
            _pg_exec(USER_DOCS_DDL, optional=True, label='user_documents')
            _pg_exec(MESSENGER_DDL, optional=True, label='messenger')
            # messenger_groups_calls — each statement individually (psycopg2 execute() is single-statement)
            _pg_exec("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_group BOOLEAN NOT NULL DEFAULT FALSE;",
                     optional=True, label='conversations.is_group')
            _pg_exec("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS group_name VARCHAR(100);",
                     optional=True, label='conversations.group_name')
            _pg_exec("ALTER TABLE messages ADD COLUMN IF NOT EXISTS msg_type VARCHAR(20) NOT NULL DEFAULT 'text';",
                     optional=True, label='messages.msg_type')
            # lead_id: no FK constraint — leads table is owned/created by leads_routes.py's
            # own self-contained _ensure_schema(), which may run after this migration.
            _pg_exec("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS lead_id INTEGER;",
                     optional=True, label='conversations.lead_id')
            _pg_exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_lead ON conversations(lead_id) WHERE lead_id IS NOT NULL;",
                     optional=True, label='conversations.idx_lead')
            _pg_exec("""CREATE TABLE IF NOT EXISTS calls (
                id SERIAL PRIMARY KEY,
                conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                caller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                sdp_offer TEXT, sdp_answer TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                started_at TIMESTAMPTZ, ended_at TIMESTAMPTZ
            );""", optional=True, label='calls')
            _pg_exec("""CREATE TABLE IF NOT EXISTS call_ice (
                id SERIAL PRIMARY KEY,
                call_id INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                candidate TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );""", optional=True, label='call_ice')
            _pg_exec("CREATE INDEX IF NOT EXISTS idx_calls_conv ON calls(conversation_id);",
                     optional=True, label='idx_calls_conv')
            _pg_exec("CREATE INDEX IF NOT EXISTS idx_call_ice_call ON call_ice(call_id, created_at);",
                     optional=True, label='idx_call_ice_call')
            _pg_exec("""CREATE TABLE IF NOT EXISTS call_members (
                id SERIAL PRIMARY KEY,
                call_id INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                state VARCHAR(20) NOT NULL DEFAULT 'invited',
                joined_at TIMESTAMPTZ,
                left_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(call_id, user_id)
            );""", optional=True, label='call_members')
            _pg_exec("""CREATE TABLE IF NOT EXISTS call_signals (
                id SERIAL PRIMARY KEY,
                call_id INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
                from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                to_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                signal_type VARCHAR(20) NOT NULL,
                payload TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );""", optional=True, label='call_signals')
            _pg_exec("CREATE INDEX IF NOT EXISTS idx_call_members_call ON call_members(call_id);",
                     optional=True, label='idx_call_members_call')
            _pg_exec("CREATE INDEX IF NOT EXISTS idx_call_members_user ON call_members(user_id);",
                     optional=True, label='idx_call_members_user')
            _pg_exec("CREATE INDEX IF NOT EXISTS idx_call_signals_call ON call_signals(call_id, id);",
                     optional=True, label='idx_call_signals_call')
            _pg_exec("CREATE INDEX IF NOT EXISTS idx_call_signals_target ON call_signals(call_id, to_user_id, id);",
                     optional=True, label='idx_call_signals_target')
            _pg_exec(
                """CREATE TABLE IF NOT EXISTS compliance_profiles (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                    kyc_status VARCHAR(20) NOT NULL DEFAULT 'pending',
                    aml_flag INTEGER NOT NULL DEFAULT 0,
                    risk_level VARCHAR(20) NOT NULL DEFAULT 'low',
                    notes TEXT,
                    updated_at TIMESTAMPTZ,
                    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
                );""",
                optional=True, label='compliance_profiles'
            )
            _pg_exec(
                'CREATE INDEX IF NOT EXISTS idx_compliance_user ON compliance_profiles(user_id);',
                optional=True, label='idx_compliance_user'
            )
            _pg_exec('ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;',
                     optional=True, label='participants.is_admin')
            _pg_exec('''CREATE TABLE IF NOT EXISTS passkeys (
                id            SERIAL PRIMARY KEY,
                user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                credential_id TEXT NOT NULL UNIQUE,
                public_key    TEXT NOT NULL,
                sign_count    INTEGER NOT NULL DEFAULT 0,
                created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )''', optional=True, label='passkeys')
            _pg_exec('ALTER TABLE cards ADD COLUMN IF NOT EXISTS balance NUMERIC(14,2) NOT NULL DEFAULT 0;',
                     optional=True, label='cards.balance')
            _pg_exec('ALTER TABLE cards ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE;',
                     optional=True, label='cards.is_primary')
            # Mark oldest card per account as primary
            _pg_exec('''
                UPDATE cards SET is_primary = TRUE
                WHERE id IN (SELECT MIN(id) FROM cards GROUP BY account_id)
                  AND is_primary = FALSE;
            ''', optional=True, label='cards.set_primary')
            # Double-entry ledger
            _pg_exec('''
                CREATE TABLE IF NOT EXISTS journal_entries (
                    id              SERIAL PRIMARY KEY,
                    payment_order_id INTEGER REFERENCES payment_orders(id) ON DELETE SET NULL,
                    tx_id           INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
                    account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                    entry_type      VARCHAR(6) NOT NULL CHECK (entry_type IN ('debit','credit')),
                    amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
                    currency        VARCHAR(3) NOT NULL DEFAULT 'UAH',
                    description     TEXT NOT NULL DEFAULT '',
                    balance_after   NUMERIC(14,2),
                    settled         BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_journal_account ON journal_entries(account_id);
                CREATE INDEX IF NOT EXISTS idx_journal_order   ON journal_entries(payment_order_id);
                CREATE INDEX IF NOT EXISTS idx_journal_settled ON journal_entries(settled);
            ''', optional=True, label='journal_entries')
            # Fraud velocity cache
            _pg_exec('''
                CREATE TABLE IF NOT EXISTS fraud_velocity_cache (
                    account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                    bucket      VARCHAR(20) NOT NULL,
                    hit_count   INTEGER NOT NULL DEFAULT 1,
                    last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (account_id, bucket)
                );
            ''', optional=True, label='fraud_velocity_cache')
            # ── Authorization holds (pre-auth) ────────────────────────────────
            _pg_exec('''
                CREATE TABLE IF NOT EXISTS account_holds (
                    id              SERIAL PRIMARY KEY,
                    account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                    payment_order_id INTEGER REFERENCES payment_orders(id) ON DELETE SET NULL,
                    amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
                    currency        VARCHAR(3) NOT NULL DEFAULT 'UAH',
                    reason          VARCHAR(100) NOT NULL DEFAULT 'authorization',
                    status          VARCHAR(20) NOT NULL DEFAULT 'active'
                                    CHECK (status IN ('active','released','expired','captured')),
                    expires_at      TIMESTAMPTZ NOT NULL,
                    released_at     TIMESTAMPTZ,
                    capture_tx_id   INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
                    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_holds_account  ON account_holds(account_id);
                CREATE INDEX IF NOT EXISTS idx_holds_status   ON account_holds(status);
                CREATE INDEX IF NOT EXISTS idx_holds_expires  ON account_holds(expires_at);
            ''', optional=True, label='account_holds')
            # ── Settlement batches ────────────────────────────────────────────
            _pg_exec('''
                CREATE TABLE IF NOT EXISTS settlement_batches (
                    id              SERIAL PRIMARY KEY,
                    batch_ref       VARCHAR(40) NOT NULL UNIQUE,
                    batch_type      VARCHAR(30) NOT NULL DEFAULT 'eod',
                    status          VARCHAR(20) NOT NULL DEFAULT 'open'
                                    CHECK (status IN ('open','processing','settled','failed')),
                    total_items     INTEGER NOT NULL DEFAULT 0,
                    settled_items   INTEGER NOT NULL DEFAULT 0,
                    total_amount    NUMERIC(14,2) NOT NULL DEFAULT 0,
                    net_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
                    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    settled_at      TIMESTAMPTZ,
                    notes           TEXT
                );
                CREATE TABLE IF NOT EXISTS settlement_items (
                    id              SERIAL PRIMARY KEY,
                    batch_id        INTEGER NOT NULL REFERENCES settlement_batches(id) ON DELETE CASCADE,
                    payment_order_id INTEGER REFERENCES payment_orders(id),
                    sender_account_id   INTEGER REFERENCES accounts(id),
                    recipient_account_id INTEGER REFERENCES accounts(id),
                    amount          NUMERIC(14,2) NOT NULL,
                    net_amount      NUMERIC(14,2),
                    item_type       VARCHAR(20) NOT NULL DEFAULT 'transfer',
                    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending','netted','settled','failed')),
                    settled_at      TIMESTAMPTZ,
                    netting_group   VARCHAR(40)
                );
                CREATE INDEX IF NOT EXISTS idx_settlement_items_batch  ON settlement_items(batch_id);
                CREATE INDEX IF NOT EXISTS idx_settlement_items_status ON settlement_items(status);
            ''', optional=True, label='settlement_batches')
            # ── Reversals ─────────────────────────────────────────────────────
            _pg_exec('''
                CREATE TABLE IF NOT EXISTS transaction_reversals (
                    id                  SERIAL PRIMARY KEY,
                    original_order_id   INTEGER NOT NULL REFERENCES payment_orders(id),
                    reversal_order_id   INTEGER REFERENCES payment_orders(id),
                    reversal_tx_out_id  INTEGER REFERENCES transactions(id),
                    reversal_tx_in_id   INTEGER REFERENCES transactions(id),
                    amount              NUMERIC(14,2) NOT NULL,
                    reason              VARCHAR(200) NOT NULL DEFAULT '',
                    initiated_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                                        CHECK (status IN ('pending','completed','failed')),
                    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    completed_at        TIMESTAMPTZ
                );
            ''', optional=True, label='transaction_reversals')
    else:
        schema_sql = Path(SCHEMA_PATH).read_text(encoding='utf-8')
        with get_connection_sqlite() as conn:
            conn.executescript(schema_sql)
            conn.executescript(NOTIFICATIONS_DDL_SQLITE)
            conn.executescript(BUDGET_LIMITS_DDL_SQLITE)
            conn.executescript(RECURRING_TX_DDL_SQLITE)
            conn.executescript(DEBTS_DDL_SQLITE)
            conn.executescript(CARDS_DDL_SQLITE)
            conn.executescript(PAYMENT_CORE_DDL_SQLITE)
            conn.executescript(IDEMPOTENCY_DDL_SQLITE)
            conn.executescript(DOC_TEMPLATES_DDL_SQLITE)
            conn.executescript(USER_DOCS_DDL_SQLITE)
            conn.executescript(MESSENGER_DDL_SQLITE)
            conn.executescript(MESSENGER_GROUPS_DDL_SQLITE)
            # Alter messenger tables (idempotent tries)
            try:
                conn.execute("ALTER TABLE conversations ADD COLUMN is_group INTEGER NOT NULL DEFAULT 0;")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE conversations ADD COLUMN group_name TEXT;")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE messages ADD COLUMN msg_type TEXT NOT NULL DEFAULT 'text';")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE conversations ADD COLUMN lead_id INTEGER;")
            except Exception:
                pass
            try:
                conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_lead ON conversations(lead_id) WHERE lead_id IS NOT NULL;")
            except Exception:
                pass
            try:
                conn.execute('ALTER TABLE transactions ADD COLUMN payment_order_id INTEGER;')
            except Exception:
                pass
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
            try:
                conn.execute('ALTER TABLE users ADD COLUMN last_seen_at TEXT DEFAULT NULL;')
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE conversation_participants ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE cards ADD COLUMN design TEXT NOT NULL DEFAULT 'gold';")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE cards ADD COLUMN cvv TEXT NOT NULL DEFAULT '000';")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE payment_orders ADD COLUMN review_state TEXT NOT NULL DEFAULT 'none';")
            except Exception:
                pass
            try:
                conn.execute('ALTER TABLE payment_orders ADD COLUMN assigned_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL;')
            except Exception:
                pass
            try:
                conn.execute('ALTER TABLE payment_orders ADD COLUMN assigned_at TEXT;')
            except Exception:
                pass
            try:
                conn.execute('ALTER TABLE payment_orders ADD COLUMN decision_by INTEGER REFERENCES users(id) ON DELETE SET NULL;')
            except Exception:
                pass
            try:
                conn.execute('ALTER TABLE payment_orders ADD COLUMN decision_note TEXT;')
            except Exception:
                pass
            try:
                conn.execute('ALTER TABLE payment_orders ADD COLUMN decided_at TEXT;')
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE payment_orders ADD COLUMN escalation_level INTEGER NOT NULL DEFAULT 0;")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE payment_orders ADD COLUMN approval_state TEXT NOT NULL DEFAULT 'none';")
            except Exception:
                pass
            try:
                conn.execute('ALTER TABLE payment_orders ADD COLUMN approval_requested_action TEXT;')
            except Exception:
                pass
            try:
                conn.execute('ALTER TABLE payment_orders ADD COLUMN approval_requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL;')
            except Exception:
                pass
            try:
                conn.execute('ALTER TABLE payment_orders ADD COLUMN approval_requested_at TEXT;')
            except Exception:
                pass
            try:
                conn.execute('ALTER TABLE payment_orders ADD COLUMN approval_decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL;')
            except Exception:
                pass
            try:
                conn.execute('ALTER TABLE payment_orders ADD COLUMN approval_decided_at TEXT;')
            except Exception:
                pass
            try:
                conn.execute('ALTER TABLE payment_orders ADD COLUMN approval_note TEXT;')
            except Exception:
                pass
            try:
                conn.execute('CREATE INDEX IF NOT EXISTS idx_payment_orders_approval_state ON payment_orders(approval_state);')
            except Exception:
                pass
            try:
                conn.execute(
                    """CREATE TABLE IF NOT EXISTS payment_order_events (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        payment_order_id INTEGER NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
                        actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                        event_type TEXT NOT NULL,
                        details TEXT NOT NULL DEFAULT '',
                        created_at TEXT NOT NULL DEFAULT (datetime('now'))
                    );"""
                )
                conn.execute('CREATE INDEX IF NOT EXISTS idx_payment_order_events_order ON payment_order_events(payment_order_id);')
                conn.execute('CREATE INDEX IF NOT EXISTS idx_payment_order_events_type ON payment_order_events(event_type);')
            except Exception:
                pass
            try:
                conn.execute(
                    """CREATE TABLE IF NOT EXISTS compliance_profiles (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL UNIQUE,
                        kyc_status TEXT NOT NULL DEFAULT 'pending',
                        aml_flag INTEGER NOT NULL DEFAULT 0,
                        risk_level TEXT NOT NULL DEFAULT 'low',
                        notes TEXT,
                        updated_at TEXT,
                        updated_by INTEGER,
                        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                    );"""
                )
                conn.execute('CREATE INDEX IF NOT EXISTS idx_compliance_user ON compliance_profiles(user_id);')
            except Exception:
                pass
            try:
                conn.execute('''CREATE TABLE IF NOT EXISTS passkeys (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    credential_id TEXT NOT NULL UNIQUE,
                    public_key    TEXT NOT NULL,
                    sign_count    INTEGER NOT NULL DEFAULT 0,
                    created_at    TEXT DEFAULT CURRENT_TIMESTAMP
                )''')
            except Exception:
                pass
            try:
                conn.execute('ALTER TABLE cards ADD COLUMN balance REAL NOT NULL DEFAULT 0;')
            except Exception:
                pass
            try:
                conn.execute('ALTER TABLE cards ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0;')
            except Exception:
                pass
            try:
                conn.execute('''
                    UPDATE cards SET is_primary = 1
                    WHERE id IN (SELECT MIN(id) FROM cards GROUP BY account_id)
                      AND is_primary = 0;
                ''')
            except Exception:
                pass
            try:
                conn.execute('''CREATE TABLE IF NOT EXISTS journal_entries (
                    id               INTEGER PRIMARY KEY AUTOINCREMENT,
                    payment_order_id INTEGER REFERENCES payment_orders(id) ON DELETE SET NULL,
                    tx_id            INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
                    account_id       INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                    entry_type       TEXT NOT NULL CHECK (entry_type IN ('debit','credit')),
                    amount           REAL NOT NULL CHECK (amount > 0),
                    currency         TEXT NOT NULL DEFAULT 'UAH',
                    description      TEXT NOT NULL DEFAULT '',
                    balance_after    REAL,
                    settled          INTEGER NOT NULL DEFAULT 0,
                    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
                );''')
                conn.execute('CREATE INDEX IF NOT EXISTS idx_journal_account ON journal_entries(account_id);')
            except Exception:
                pass
            try:
                conn.execute('''CREATE TABLE IF NOT EXISTS fraud_velocity_cache (
                    account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                    bucket      TEXT NOT NULL,
                    hit_count   INTEGER NOT NULL DEFAULT 1,
                    last_seen   TEXT NOT NULL DEFAULT (datetime('now')),
                    PRIMARY KEY (account_id, bucket)
                );''')
            except Exception:
                pass
            try:
                conn.execute('''CREATE TABLE IF NOT EXISTS account_holds (
                    id               INTEGER PRIMARY KEY AUTOINCREMENT,
                    account_id       INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                    payment_order_id INTEGER REFERENCES payment_orders(id) ON DELETE SET NULL,
                    amount           REAL NOT NULL CHECK (amount > 0),
                    currency         TEXT NOT NULL DEFAULT 'UAH',
                    reason           TEXT NOT NULL DEFAULT 'authorization',
                    status           TEXT NOT NULL DEFAULT 'active',
                    expires_at       TEXT NOT NULL,
                    released_at      TEXT,
                    capture_tx_id    INTEGER,
                    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
                );''')
            except Exception:
                pass
            try:
                conn.execute('''CREATE TABLE IF NOT EXISTS settlement_batches (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    batch_ref    TEXT NOT NULL UNIQUE,
                    batch_type   TEXT NOT NULL DEFAULT 'eod',
                    status       TEXT NOT NULL DEFAULT 'open',
                    total_items  INTEGER NOT NULL DEFAULT 0,
                    settled_items INTEGER NOT NULL DEFAULT 0,
                    total_amount REAL NOT NULL DEFAULT 0,
                    net_amount   REAL NOT NULL DEFAULT 0,
                    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
                    settled_at   TEXT,
                    notes        TEXT
                );''')
                conn.execute('''CREATE TABLE IF NOT EXISTS settlement_items (
                    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
                    batch_id             INTEGER NOT NULL REFERENCES settlement_batches(id),
                    payment_order_id     INTEGER,
                    sender_account_id    INTEGER,
                    recipient_account_id INTEGER,
                    amount               REAL NOT NULL,
                    net_amount           REAL,
                    item_type            TEXT NOT NULL DEFAULT 'transfer',
                    status               TEXT NOT NULL DEFAULT 'pending',
                    settled_at           TEXT,
                    netting_group        TEXT
                );''')
            except Exception:
                pass
            try:
                conn.execute('''CREATE TABLE IF NOT EXISTS transaction_reversals (
                    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                    original_order_id   INTEGER NOT NULL,
                    reversal_order_id   INTEGER,
                    reversal_tx_out_id  INTEGER,
                    reversal_tx_in_id   INTEGER,
                    amount              REAL NOT NULL,
                    reason              TEXT NOT NULL DEFAULT '',
                    initiated_by        INTEGER,
                    status              TEXT NOT NULL DEFAULT 'pending',
                    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
                    completed_at        TEXT
                );''')
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

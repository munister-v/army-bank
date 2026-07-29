"""Репозиторій користувачів та сесій.

Шар доступу до даних (DAL): тільки SQL до таблиць users і sessions, жодної
бізнес-логіки. Параметри завжди передаються через плейсхолдери %s (а не через
f-рядки) — це захист від SQL-ін'єкцій. Сервіси викликають ці методи, а не пишуть SQL.
"""
from __future__ import annotations

import hashlib
import threading

from ..database import get_connection, get_returning_id_suffix, insert_last_id, USE_PG
from .base import BaseRepository


_SESSION_SCHEMA_READY = False
_SESSION_SCHEMA_LOCK = threading.Lock()


def _token_hash(token: str) -> str:
    return 'sha256:' + hashlib.sha256(str(token or '').encode('utf-8')).hexdigest()


def _token_candidates(token: str) -> tuple[str, str]:
    """Support legacy plaintext rows while all new sessions are hash-only."""
    raw = str(token or '')
    return raw, _token_hash(raw)


def _ensure_session_schema() -> None:
    global _SESSION_SCHEMA_READY
    if _SESSION_SCHEMA_READY:
        return
    with _SESSION_SCHEMA_LOCK:
        if _SESSION_SCHEMA_READY:
            return
        with get_connection() as conn:
            columns = {
                'user_agent': "VARCHAR(500) NOT NULL DEFAULT ''",
                'ip_address': "VARCHAR(80) NOT NULL DEFAULT ''",
                'last_seen_at': 'TIMESTAMP',
                'auth_method': "VARCHAR(30) NOT NULL DEFAULT 'password'",
                'remembered': 'BOOLEAN NOT NULL DEFAULT FALSE' if USE_PG else 'INTEGER NOT NULL DEFAULT 0',
            }
            if USE_PG:
                for name, definition in columns.items():
                    conn.execute(f'ALTER TABLE sessions ADD COLUMN IF NOT EXISTS {name} {definition}')
            else:
                existing = {row['name'] for row in conn.execute('PRAGMA table_info(sessions)').fetchall()}
                for name, definition in columns.items():
                    if name not in existing:
                        conn.execute(f'ALTER TABLE sessions ADD COLUMN {name} {definition}')
        _SESSION_SCHEMA_READY = True


class UserRepository(BaseRepository):
    def create_user(self, full_name: str, phone: str, email: str, password_hash: str, role: str = 'soldier') -> int:
        """Створює користувача. Зберігається ХЕШ пароля (не сам пароль). Повертає id нового рядка."""
        with self.connection() as conn:
            cursor = conn.execute(
                '''
                INSERT INTO users(full_name, phone, email, password_hash, role)
                VALUES(%s, %s, %s, %s, %s)
                ''' + get_returning_id_suffix(),   # PG додає "RETURNING id"; SQLite — нічого (id беремо інакше)
                (full_name, phone, email, password_hash, role),
            )
            return insert_last_id(cursor)          # уніфіковане отримання id для PG та SQLite

    def get_by_phone_or_email(self, identity: str):
        """Пошук користувача за телефоном АБО email (логін за будь-яким із них)."""
        with self.connection() as conn:
            return conn.execute(
                # LOWER(email) — email порівнюємо регістронезалежно; телефон — точно
                'SELECT * FROM users WHERE phone = %s OR LOWER(email) = LOWER(%s)',
                (identity, identity),
            ).fetchone()

    def get_by_id(self, user_id: int):
        with self.connection() as conn:
            return conn.execute('SELECT * FROM users WHERE id = %s', (user_id,)).fetchone()

    def create_session(
        self,
        user_id: int,
        token: str,
        expires_at: str,
        *,
        user_agent: str = '',
        ip_address: str = '',
        auth_method: str = 'password',
        remembered: bool = False,
    ) -> None:
        """Store only a SHA-256 token fingerprint, plus device/session context."""
        _ensure_session_schema()
        with self.connection() as conn:
            conn.execute(
                'INSERT INTO sessions(user_id, token, expires_at, user_agent, ip_address, '
                'last_seen_at, auth_method, remembered) '
                'VALUES(%s, %s, %s, %s, %s, CURRENT_TIMESTAMP, %s, %s)',
                (
                    user_id,
                    _token_hash(token),
                    expires_at,
                    str(user_agent or '')[:500],
                    str(ip_address or '')[:80],
                    str(auth_method or 'password')[:30],
                    bool(remembered),
                ),
            )

    def get_user_by_token(self, token: str):
        """Повертає користувача за токеном сесії (JOIN sessions+users) разом із expires_at.
        Саме цей запит виконує декоратор auth_required на КОЖЕН захищений запит."""
        _ensure_session_schema()
        raw_token, hashed_token = _token_candidates(token)
        with self.connection() as conn:
            return conn.execute(
                '''
                SELECT u.*, s.expires_at
                FROM sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.token = %s OR s.token = %s
                ''',
                (raw_token, hashed_token),
            ).fetchone()

    def delete_session(self, token: str) -> None:
        """Видаляє сесію за токеном — це і є вихід (logout)."""
        raw_token, hashed_token = _token_candidates(token)
        with self.connection() as conn:
            conn.execute('DELETE FROM sessions WHERE token = %s OR token = %s', (raw_token, hashed_token))

    def update_session_expiry(self, token: str, expires_at: str) -> bool:
        """Продовжує сесію (нова дата протермінування). True, якщо такий токен існував."""
        raw_token, hashed_token = _token_candidates(token)
        with self.connection() as conn:
            result = conn.execute(
                'UPDATE sessions SET expires_at = %s, last_seen_at = CURRENT_TIMESTAMP '
                'WHERE token = %s OR token = %s',
                (expires_at, raw_token, hashed_token),
            )
            return (result.rowcount or 0) > 0      # rowcount=0 -> токена немає (вже видалений/підроблений)

    def delete_expired_sessions(self, user_id: int) -> None:
        """Видаляє прострочені сесії конкретного користувача."""
        with self.connection() as conn:
            conn.execute(
                "DELETE FROM sessions WHERE user_id = %s AND expires_at < %s",
                (user_id, __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat()),
            )

    def list_sessions(self, user_id: int):
        _ensure_session_schema()
        with self.connection() as conn:
            return conn.execute(
                'SELECT id, token, expires_at, created_at, last_seen_at, user_agent, ip_address, '
                'auth_method, remembered FROM sessions WHERE user_id = %s ORDER BY created_at DESC',
                (user_id,)
            ).fetchall()

    def touch_session(self, token: str) -> None:
        _ensure_session_schema()
        raw_token, hashed_token = _token_candidates(token)
        with self.connection() as conn:
            conn.execute(
                'UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token = %s OR token = %s',
                (raw_token, hashed_token),
            )

    def delete_other_sessions(self, user_id: int, current_token: str) -> int:
        raw_token, hashed_token = _token_candidates(current_token)
        with self.connection() as conn:
            result = conn.execute(
                'DELETE FROM sessions WHERE user_id = %s AND token != %s AND token != %s',
                (user_id, raw_token, hashed_token),
            )
            return int(result.rowcount or 0)

    def delete_session_by_id(self, session_id: int, user_id: int) -> bool:
        with self.connection() as conn:
            result = conn.execute(
                'DELETE FROM sessions WHERE id = %s AND user_id = %s',
                (session_id, user_id)
            )
            return (result.rowcount or 0) > 0

    def list_all(self, role_filter: str | None = None, search: str | None = None):
        """Список користувачів для адмінки з KYC/AML-статусом і опційними фільтрами."""
        with self.connection() as conn:
            # LEFT JOIN на compliance_profiles + COALESCE: якщо профілю ще немає,
            # показуємо дефолти ('pending' / 0), а не NULL.
            sql = (
                'SELECT u.id, u.full_name, u.phone, u.email, u.role, u.military_status, u.created_at,'
                " COALESCE(cp.kyc_status, 'pending') AS kyc_status,"
                ' COALESCE(cp.aml_flag, 0) AS aml_flag'
                ' FROM users u'
                ' LEFT JOIN compliance_profiles cp ON cp.user_id = u.id'
                ' WHERE 1=1'                    # «1=1» — щоб далі зручно дописувати AND-умови
            )
            params: list = []
            if role_filter:                     # фільтр за роллю (soldier/admin/operator…)
                sql += ' AND u.role = %s'
                params.append(role_filter)
            if search:                          # пошук по імені/телефону/email
                op = 'ILIKE' if USE_PG else 'LIKE'   # PG має регістронезалежний ILIKE; SQLite — LIKE
                sql += f' AND (u.full_name {op} %s OR u.phone {op} %s OR u.email {op} %s)'
                like = f'%{search}%'            # підстановка %…% всередині параметра, а не в SQL-текст
                params.extend([like, like, like])
            sql += ' ORDER BY u.id'
            return conn.execute(sql, tuple(params)).fetchall()

    def update_role(self, user_id: int, role: str) -> None:
        with self.connection() as conn:
            conn.execute('UPDATE users SET role = %s WHERE id = %s', (role, user_id))

    def update_password(self, user_id: int, password_hash: str) -> None:
        with self.connection() as conn:
            conn.execute('UPDATE users SET password_hash = %s WHERE id = %s', (password_hash, user_id))

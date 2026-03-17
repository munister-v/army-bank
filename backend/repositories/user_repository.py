"""Репозиторій користувачів та сесій."""
from __future__ import annotations

from ..database import get_returning_id_suffix, insert_last_id
from .base import BaseRepository


class UserRepository(BaseRepository):
    def create_user(self, full_name: str, phone: str, email: str, password_hash: str, role: str = 'soldier') -> int:
        with self.connection() as conn:
            cursor = conn.execute(
                '''
                INSERT INTO users(full_name, phone, email, password_hash, role)
                VALUES(%s, %s, %s, %s, %s)
                ''' + get_returning_id_suffix(),
                (full_name, phone, email, password_hash, role),
            )
            return insert_last_id(cursor)

    def get_by_phone_or_email(self, identity: str):
        with self.connection() as conn:
            return conn.execute(
                'SELECT * FROM users WHERE phone = %s OR email = %s',
                (identity, identity),
            ).fetchone()

    def get_by_id(self, user_id: int):
        with self.connection() as conn:
            return conn.execute('SELECT * FROM users WHERE id = %s', (user_id,)).fetchone()

    def create_session(self, user_id: int, token: str, expires_at: str) -> None:
        with self.connection() as conn:
            conn.execute(
                'INSERT INTO sessions(user_id, token, expires_at) VALUES(%s, %s, %s)',
                (user_id, token, expires_at),
            )

    def get_user_by_token(self, token: str):
        with self.connection() as conn:
            return conn.execute(
                '''
                SELECT u.*, s.expires_at
                FROM sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.token = %s
                ''',
                (token,),
            ).fetchone()

    def delete_session(self, token: str) -> None:
        with self.connection() as conn:
            conn.execute('DELETE FROM sessions WHERE token = %s', (token,))

    def delete_expired_sessions(self, user_id: int) -> None:
        """Видаляє прострочені сесії конкретного користувача."""
        with self.connection() as conn:
            conn.execute(
                "DELETE FROM sessions WHERE user_id = %s AND expires_at < %s",
                (user_id, __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat()),
            )

    def list_all(self, role_filter: str | None = None):
        with self.connection() as conn:
            if role_filter:
                return conn.execute(
                    'SELECT id, full_name, phone, email, role, military_status, created_at FROM users WHERE role = %s ORDER BY id',
                    (role_filter,),
                ).fetchall()
            return conn.execute(
                'SELECT id, full_name, phone, email, role, military_status, created_at FROM users ORDER BY id',
                (),
            ).fetchall()

    def update_role(self, user_id: int, role: str) -> None:
        with self.connection() as conn:
            conn.execute('UPDATE users SET role = %s WHERE id = %s', (role, user_id))

"""Репозиторій користувачів та сесій."""
from __future__ import annotations

from .base import BaseRepository


class UserRepository(BaseRepository):
    def create_user(self, full_name: str, phone: str, email: str, password_hash: str, role: str = 'soldier') -> int:
        with self.connection() as conn:
            cursor = conn.execute(
                '''
                INSERT INTO users(full_name, phone, email, password_hash, role)
                VALUES(?, ?, ?, ?, ?)
                ''',
                (full_name, phone, email, password_hash, role),
            )
            return cursor.lastrowid

    def get_by_phone_or_email(self, identity: str):
        with self.connection() as conn:
            return conn.execute(
                'SELECT * FROM users WHERE phone = ? OR email = ?',
                (identity, identity),
            ).fetchone()

    def get_by_id(self, user_id: int):
        with self.connection() as conn:
            return conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()

    def create_session(self, user_id: int, token: str, expires_at: str) -> None:
        with self.connection() as conn:
            conn.execute(
                'INSERT INTO sessions(user_id, token, expires_at) VALUES(?, ?, ?)',
                (user_id, token, expires_at),
            )

    def get_user_by_token(self, token: str):
        with self.connection() as conn:
            return conn.execute(
                '''
                SELECT u.*, s.expires_at
                FROM sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.token = ?
                ''',
                (token,),
            ).fetchone()

    def delete_session(self, token: str) -> None:
        with self.connection() as conn:
            conn.execute('DELETE FROM sessions WHERE token = ?', (token,))

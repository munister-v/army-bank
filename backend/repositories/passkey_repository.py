"""Репозиторій WebAuthn passkey-записів."""
from __future__ import annotations

from ..database import get_returning_id_suffix, insert_last_id
from .base import BaseRepository


class PasskeyRepository(BaseRepository):

    def create_table(self) -> None:
        with self.connection() as conn:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS passkeys (
                    id          SERIAL PRIMARY KEY,
                    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    credential_id   TEXT NOT NULL UNIQUE,
                    public_key      TEXT NOT NULL,
                    sign_count      INTEGER NOT NULL DEFAULT 0,
                    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''') if False else None  # handled in migrations

    # ── CRUD ─────────────────────────────────────────────────────────────────

    def save(self, user_id: int, credential_id: str, public_key: str, sign_count: int) -> int:
        with self.connection() as conn:
            cursor = conn.execute(
                '''
                INSERT INTO passkeys (user_id, credential_id, public_key, sign_count)
                VALUES (%s, %s, %s, %s)
                ''' + get_returning_id_suffix(),
                (user_id, credential_id, public_key, sign_count),
            )
            return insert_last_id(cursor)

    def get_by_credential_id(self, credential_id: str):
        with self.connection() as conn:
            return conn.execute(
                'SELECT * FROM passkeys WHERE credential_id = %s',
                (credential_id,),
            ).fetchone()

    def list_by_user(self, user_id: int):
        with self.connection() as conn:
            return conn.execute(
                'SELECT * FROM passkeys WHERE user_id = %s ORDER BY created_at',
                (user_id,),
            ).fetchall()

    def update_sign_count(self, credential_id: str, sign_count: int) -> None:
        with self.connection() as conn:
            conn.execute(
                'UPDATE passkeys SET sign_count = %s WHERE credential_id = %s',
                (sign_count, credential_id),
            )

    def delete_by_user(self, user_id: int) -> None:
        with self.connection() as conn:
            conn.execute('DELETE FROM passkeys WHERE user_id = %s', (user_id,))

    def has_passkey(self, user_id: int) -> bool:
        with self.connection() as conn:
            row = conn.execute(
                'SELECT id FROM passkeys WHERE user_id = %s LIMIT 1', (user_id,)
            ).fetchone()
            return row is not None

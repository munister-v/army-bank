"""EMV® 3-D Secure (3DS) Challenge Service.

Реалізує аналог Visa Secure / Mastercard Identity Check:

  1. create_challenge(user_id, amount, recipient)
     → Генерує 6-цифровий OTP, зберігає в БД, повертає challenge_id + demo_otp
       (у prod: надсилає SMS, не повертає otp_code клієнту)

  2. verify_challenge(user_id, challenge_id, otp_code)
     → Перевіряє OTP, генерує session_token (JWT-like, expires 5 хв)

  3. consume_session(user_id, session_token, amount, recipient)
     → Перевіряє session_token і позначає як used (one-time use)
       Повертає True або підіймає ValueError
"""
from __future__ import annotations

import random
import secrets
import string
from datetime import datetime, timezone, timedelta
from typing import Optional

from ..database import get_connection, get_returning_id_suffix, insert_last_id


_OTP_TTL_SECONDS = 180   # 3 хвилини
_SESSION_TTL_SECONDS = 300  # 5 хвилин на завершення оплати


class ThreeDSService:

    # ── Public API ────────────────────────────────────────────────────────────

    def create_challenge(
        self,
        user_id: int,
        amount: float,
        recipient: str,
        masked_phone: Optional[str] = None,
    ) -> dict:
        """Створює новий 3DS challenge.

        Returns:
            {
              challenge_id: str (UUID-like),
              demo_otp: str     (тільки для демо! у prod не повертати),
              masked_phone: str,
              expires_in: int   (секунди),
            }
        """
        self._ensure_schema()

        challenge_id = secrets.token_hex(16)
        otp_code = ''.join(random.choices(string.digits, k=6))
        expires_at = (datetime.now(timezone.utc) + timedelta(seconds=_OTP_TTL_SECONDS)).isoformat()

        # Відмічаємо старі pending challenge цього юзера як expired
        try:
            with get_connection() as conn:
                conn.execute(
                    "UPDATE payment_challenges SET status='expired'"
                    " WHERE user_id=%s AND status='pending'",
                    (user_id,),
                )
        except Exception:
            try:
                with get_connection() as conn:
                    conn.execute(
                        "UPDATE payment_challenges SET status='expired'"
                        " WHERE user_id=? AND status='pending'",
                        (user_id,),
                    )
            except Exception:
                pass

        suffix = get_returning_id_suffix()
        with get_connection() as conn:
            conn.execute(
                "INSERT INTO payment_challenges"
                " (challenge_id, user_id, otp_code, amount, recipient, status, expires_at)"
                " VALUES (%s, %s, %s, %s, %s, 'pending', %s)" + suffix,
                (challenge_id, user_id, otp_code, amount, recipient, expires_at),
            )

        if not masked_phone:
            masked_phone = self._get_masked_phone(user_id)

        return {
            'challenge_id': challenge_id,
            'demo_otp': otp_code,   # ← тільки для демо-режиму
            'masked_phone': masked_phone,
            'expires_in': _OTP_TTL_SECONDS,
        }

    def verify_challenge(
        self,
        user_id: int,
        challenge_id: str,
        otp_code: str,
    ) -> dict:
        """Перевіряє OTP і повертає одноразовий session_token.

        Returns: { session_token: str, valid_for: int }
        Raises: ValueError якщо OTP невірний/прострочений
        """
        self._ensure_schema()

        row = self._get_challenge(challenge_id, user_id)

        if not row:
            raise ValueError('Challenge не знайдено.')
        if row['status'] != 'pending':
            raise ValueError(f'Challenge вже використано або прострочено ({row["status"]}).')

        # Перевірка часу
        try:
            exp = datetime.fromisoformat(str(row['expires_at']).replace('Z', '+00:00'))
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) > exp:
                self._set_status(challenge_id, 'expired')
                raise ValueError('OTP-код прострочено. Запросіть новий.')
        except ValueError:
            raise
        except Exception:
            pass

        if str(row['otp_code']).strip() != str(otp_code).strip():
            raise ValueError('Невірний OTP-код.')

        # Генеруємо session_token
        session_token = secrets.token_hex(32)
        session_expires = (datetime.now(timezone.utc) + timedelta(seconds=_SESSION_TTL_SECONDS)).isoformat()

        self._update_challenge(
            challenge_id,
            status='verified',
            session_token=session_token,
            session_expires_at=session_expires,
        )

        return {
            'session_token': session_token,
            'valid_for': _SESSION_TTL_SECONDS,
        }

    def consume_session(
        self,
        user_id: int,
        session_token: str,
    ) -> bool:
        """Перевіряє session_token і позначає як used (one-time use).

        Returns True або підіймає ValueError.
        """
        self._ensure_schema()

        row = self._get_by_session(session_token, user_id)

        if not row:
            raise ValueError('Сесія 3DS не знайдена. Пройдіть підтвердження ще раз.')
        if row['status'] == 'used':
            raise ValueError('Сесія 3DS вже використана.')
        if row['status'] != 'verified':
            raise ValueError(f'Сесія 3DS не підтверджена ({row["status"]}).')

        # Перевірка часу
        try:
            se = str(row.get('session_expires_at') or '').replace('Z', '+00:00')
            if se:
                exp = datetime.fromisoformat(se)
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) > exp:
                    self._set_status_by_session(session_token, 'expired')
                    raise ValueError('Сесія 3DS прострочена. Пройдіть підтвердження ще раз.')
        except ValueError:
            raise
        except Exception:
            pass

        self._set_status_by_session(session_token, 'used')
        return True

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _get_challenge(self, challenge_id: str, user_id: int):
        for ph in ('%s', '?'):
            try:
                with get_connection() as conn:
                    row = conn.execute(
                        f"SELECT * FROM payment_challenges WHERE challenge_id={ph} AND user_id={ph}",
                        (challenge_id, user_id),
                    ).fetchone()
                return dict(row) if row else None
            except Exception:
                continue
        return None

    def _get_by_session(self, session_token: str, user_id: int):
        for ph in ('%s', '?'):
            try:
                with get_connection() as conn:
                    row = conn.execute(
                        f"SELECT * FROM payment_challenges WHERE session_token={ph} AND user_id={ph}",
                        (session_token, user_id),
                    ).fetchone()
                return dict(row) if row else None
            except Exception:
                continue
        return None

    def _set_status(self, challenge_id: str, status: str):
        for ph in ('%s', '?'):
            try:
                with get_connection() as conn:
                    conn.execute(
                        f"UPDATE payment_challenges SET status={ph} WHERE challenge_id={ph}",
                        (status, challenge_id),
                    )
                return
            except Exception:
                continue

    def _set_status_by_session(self, session_token: str, status: str):
        for ph in ('%s', '?'):
            try:
                with get_connection() as conn:
                    conn.execute(
                        f"UPDATE payment_challenges SET status={ph} WHERE session_token={ph}",
                        (status, session_token),
                    )
                return
            except Exception:
                continue

    def _update_challenge(self, challenge_id: str, status: str,
                          session_token: str, session_expires_at: str):
        for ph in ('%s', '?'):
            try:
                with get_connection() as conn:
                    conn.execute(
                        f"UPDATE payment_challenges"
                        f" SET status={ph}, session_token={ph}, session_expires_at={ph}"
                        f" WHERE challenge_id={ph}",
                        (status, session_token, session_expires_at, challenge_id),
                    )
                return
            except Exception:
                continue

    def _get_masked_phone(self, user_id: int) -> str:
        for ph in ('%s', '?'):
            try:
                with get_connection() as conn:
                    row = conn.execute(
                        f"SELECT phone FROM users WHERE id={ph}", (user_id,)
                    ).fetchone()
                if row and row['phone']:
                    p = str(row['phone'])
                    if len(p) >= 7:
                        return p[:3] + '***' + p[-4:]
                    return '***'
            except Exception:
                continue
        return '+380***'

    def _ensure_schema(self):
        """Створює таблицю payment_challenges якщо не існує (lazy migration)."""
        for sql in [
            # PostgreSQL
            """CREATE TABLE IF NOT EXISTS payment_challenges (
                id SERIAL PRIMARY KEY,
                challenge_id VARCHAR(64) UNIQUE NOT NULL,
                user_id INTEGER NOT NULL,
                otp_code VARCHAR(6) NOT NULL,
                session_token VARCHAR(64),
                session_expires_at TIMESTAMPTZ,
                amount NUMERIC(14,2),
                recipient TEXT,
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )""",
            # SQLite
            """CREATE TABLE IF NOT EXISTS payment_challenges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                challenge_id TEXT UNIQUE NOT NULL,
                user_id INTEGER NOT NULL,
                otp_code TEXT NOT NULL,
                session_token TEXT,
                session_expires_at TEXT,
                amount REAL,
                recipient TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )""",
        ]:
            try:
                with get_connection() as conn:
                    conn.execute(sql)
                return
            except Exception:
                continue

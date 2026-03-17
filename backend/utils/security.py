"""Допоміжні функції безпеки: хешування паролів (bcrypt), токени, час сесій."""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

try:
    import bcrypt
    _USE_BCRYPT = True
except ImportError:
    import hashlib
    import hmac as _hmac
    _USE_BCRYPT = False

from ..config import SECRET_KEY, TOKEN_TTL_HOURS

# ── Скільки годин до закінчення сесії починаємо її продовжувати ──────────────
_REFRESH_THRESHOLD_HOURS = 24 * 7   # якщо залишилось < 7 днів — оновити


def hash_password(password: str) -> str:
    """Хешує пароль через bcrypt (або SHA-256 fallback якщо бібліотека недоступна)."""
    if _USE_BCRYPT:
        return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()
    # Fallback: HMAC-SHA256 зі SECRET_KEY (стара поведінка — зворотна сумісність)
    salted = f"{SECRET_KEY}:{password}".encode('utf-8')
    return hashlib.sha256(salted).hexdigest()


def verify_password(password: str, password_hash: str) -> bool:
    """Перевіряє пароль.

    Підтримує обидва формати:
    - bcrypt-хеш (починається з $2b$ або $2a$)
    - старий SHA-256 (40+ hex символів)
    """
    if password_hash.startswith(('$2b$', '$2a$', '$2y$')):
        # bcrypt
        if not _USE_BCRYPT:
            return False
        try:
            return bcrypt.checkpw(password.encode(), password_hash.encode())
        except Exception:
            return False
    # Fallback: SHA-256 (старі акаунти)
    salted = f"{SECRET_KEY}:{password}".encode('utf-8')
    import hashlib, hmac as _hmac_mod
    expected = hashlib.sha256(salted).hexdigest()
    return _hmac_mod.compare_digest(expected, password_hash)


def generate_token() -> str:
    """Генерує безпечний токен сесії (43 символи URL-safe)."""
    return secrets.token_urlsafe(32)


def token_expiration_iso() -> str:
    """ISO-рядок часу закінчення сесії (TOKEN_TTL_HOURS від зараз)."""
    expires_at = datetime.now(timezone.utc) + timedelta(hours=TOKEN_TTL_HOURS)
    return expires_at.isoformat()


def should_refresh_session(expires_at_iso: str) -> bool:
    """True якщо до закінчення сесії залишилось менше REFRESH_THRESHOLD_HOURS."""
    try:
        expires_at = datetime.fromisoformat(expires_at_iso)
        remaining = expires_at - datetime.now(timezone.utc)
        return remaining.total_seconds() < _REFRESH_THRESHOLD_HOURS * 3600
    except Exception:
        return False

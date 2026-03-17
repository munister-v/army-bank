"""Допоміжні функції безпеки: хешування, токени, перевірка доступу."""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from ..config import SECRET_KEY, TOKEN_TTL_HOURS


def hash_password(password: str) -> str:
    """Хешує пароль користувача з секретним ключем застосунку."""
    salted = f"{SECRET_KEY}:{password}".encode('utf-8')
    return hashlib.sha256(salted).hexdigest()


def verify_password(password: str, password_hash: str) -> bool:
    """Порівнює вхідний пароль із збереженим хешем."""
    return hmac.compare_digest(hash_password(password), password_hash)


def generate_token() -> str:
    """Генерує випадковий токен сесії."""
    return secrets.token_urlsafe(32)


def token_expiration_iso() -> str:
    """Повертає строк дії токена у форматі ISO."""
    expires_at = datetime.now(timezone.utc) + timedelta(hours=TOKEN_TTL_HOURS)
    return expires_at.isoformat()

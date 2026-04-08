"""Шифрування повідомлень месенджера (at-rest)."""
from __future__ import annotations

import base64
import hashlib
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from ..config import MESSENGER_ENCRYPTION_KEYS, SECRET_KEY

_ENC_PREFIX = 'enc:v1:'
_DELETED_TEXT = 'Повідомлення видалено'


def _normalize_keys(raw: str) -> list[str]:
    return [k.strip() for k in (raw or '').split(',') if k.strip()]


def _derive_key_from_secret(secret: str) -> str:
    digest = hashlib.sha256((secret or 'army-bank').encode('utf-8')).digest()
    return base64.urlsafe_b64encode(digest).decode('ascii')


@lru_cache(maxsize=1)
def _cipher() -> MultiFernet:
    keys = _normalize_keys(MESSENGER_ENCRYPTION_KEYS)
    if not keys:
        keys = [_derive_key_from_secret(SECRET_KEY)]
    fernets = [Fernet(k.encode('ascii')) for k in keys]
    return MultiFernet(fernets)


def encrypt_message(plain_text: str) -> str:
    text = str(plain_text or '')
    token = _cipher().encrypt(text.encode('utf-8')).decode('ascii')
    return _ENC_PREFIX + token


def decrypt_message(payload: str, *, fallback: str = '') -> str:
    raw = str(payload or '')
    if not raw:
        return fallback
    if not raw.startswith(_ENC_PREFIX):
        # Legacy plaintext compatibility
        return raw
    token = raw[len(_ENC_PREFIX):]
    try:
        return _cipher().decrypt(token.encode('ascii')).decode('utf-8')
    except (InvalidToken, ValueError):
        return fallback


def safe_preview() -> str:
    return 'Нове повідомлення'


def deleted_message_text() -> str:
    return _DELETED_TEXT

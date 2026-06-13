"""Допоміжні функції безпеки: хешування паролів (bcrypt), токени, час сесій.

Цей модуль ізолює всю криптографію навколо паролів та сесійних токенів,
щоб решта коду (services/routes) ніколи напряму не працювала з bcrypt,
hashlib чи генерацією випадкових рядків.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

try:
    # bcrypt — основний, рекомендований алгоритм хешування паролів:
    # включає сіль і налаштовану "вартість" (rounds), що робить brute-force
    # атаки повільними навіть при витоку бази хешів.
    import bcrypt
    _USE_BCRYPT = True
except ImportError:
    # Якщо bcrypt не встановлено (наприклад, мінімальне середовище без
    # компілятора для C-розширень) — деградуємо до HMAC-SHA256 на SECRET_KEY.
    # Це СЛАБШИЙ варіант (немає окремої солі для кожного пароля та "вартості"),
    # але зберігається для зворотної сумісності зі старими акаунтами.
    import hashlib
    import hmac as _hmac
    _USE_BCRYPT = False

from ..config import SECRET_KEY, TOKEN_TTL_HOURS

# ── Скільки годин до закінчення сесії починаємо її продовжувати ──────────────
_REFRESH_THRESHOLD_HOURS = 24 * 7   # якщо залишилось < 7 днів — оновити


def hash_password(password: str) -> str:
    """Хешує пароль через bcrypt (або SHA-256 fallback якщо бібліотека недоступна).

    bcrypt.gensalt(rounds=12) — 2^12 ітерацій, баланс між безпекою
    (~250мс на сучасному CPU) і UX (логін не "висне").
    """
    if _USE_BCRYPT:
        return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()
    # Fallback: HMAC-SHA256 зі SECRET_KEY (стара поведінка — зворотна сумісність).
    # SECRET_KEY тут виконує роль "глобальної солі" — без bcrypt-бібліотеки
    # повноцінну per-user сіль ми не зберігаємо.
    salted = f"{SECRET_KEY}:{password}".encode('utf-8')
    return hashlib.sha256(salted).hexdigest()


def verify_password(password: str, password_hash: str) -> bool:
    """Перевіряє пароль проти збереженого хешу.

    Підтримує обидва формати одночасно (для плавної міграції користувачів):
    - bcrypt-хеш (починається з $2a$/$2b$/$2y$ — різні версії алгоритму bcrypt)
    - старий SHA-256 (hex-рядок без префіксу $)

    Формат хешу визначається за префіксом самого збереженого значення,
    тож стара і нова схема можуть існувати в БД одночасно.
    """
    if password_hash.startswith(('$2b$', '$2a$', '$2y$')):
        # bcrypt: сіль зашита у самому хеші, bcrypt.checkpw() витягує її
        # автоматично і повторно хешує введений пароль для порівняння.
        if not _USE_BCRYPT:
            return False
        try:
            return bcrypt.checkpw(password.encode(), password_hash.encode())
        except Exception:
            return False
    # Fallback: SHA-256 (старі акаунти, створені до впровадження bcrypt).
    # compare_digest() — порівняння за постійний час, захищає від
    # timing-атак (зловмисник не може дізнатись довжину збігу по часу відповіді).
    salted = f"{SECRET_KEY}:{password}".encode('utf-8')
    import hashlib, hmac as _hmac_mod
    expected = hashlib.sha256(salted).hexdigest()
    return _hmac_mod.compare_digest(expected, password_hash)


def generate_token() -> str:
    """Генерує безпечний токен сесії (43 символи URL-safe).

    secrets.token_urlsafe(32) використовує криптографічно стійкий
    генератор випадкових чисел ОС (os.urandom) — на відміну від модуля
    `random`, який непридатний для токенів безпеки.
    """
    return secrets.token_urlsafe(32)


def token_expiration_iso() -> str:
    """ISO-рядок часу закінчення сесії (TOKEN_TTL_HOURS від зараз).

    Використовується при створенні сесії (логін/реєстрація) — записується
    в стовпець sessions.expires_at.
    """
    expires_at = datetime.now(timezone.utc) + timedelta(hours=TOKEN_TTL_HOURS)
    return expires_at.isoformat()


def should_refresh_session(expires_at_raw) -> bool:
    """True якщо до закінчення сесії залишилось менше _REFRESH_THRESHOLD_HOURS.

    Приймає як ISO-рядок (SQLite зберігає TEXT), так і datetime об'єкт
    (PostgreSQL повертає TIMESTAMPTZ як datetime) — це дозволяє коду
    helpers.auth_required() працювати однаково з обома БД.

    Якщо True — auth_required() видасть клієнту новий токен через
    заголовок X-Refresh-Token, продовжуючи сесію "ковзним" способом
    (sliding expiration) без примусового повторного логіну.
    """
    try:
        if isinstance(expires_at_raw, datetime):
            expires_at = expires_at_raw
        else:
            expires_at = datetime.fromisoformat(str(expires_at_raw))
        if expires_at.tzinfo is None:
            # SQLite не зберігає часову зону — припускаємо UTC (як і скрізь
            # в проєкті: datetime.now(timezone.utc)).
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        remaining = expires_at - datetime.now(timezone.utc)
        return remaining.total_seconds() < _REFRESH_THRESHOLD_HOURS * 3600
    except Exception:
        # Якщо формат дати неочікуваний — безпечніше НЕ продовжувати сесію
        # (користувач просто перелогіниться раніше), ніж кидати помилку.
        return False

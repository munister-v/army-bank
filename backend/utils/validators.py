"""Прості валідатори для перевірки вхідних даних API.

Перша лінія захисту на вході: відсікають некоректні дані ДО бізнес-логіки та БД.
Усі помилки кидаються як ValueError з зрозумілим текстом, який маршрут перетворює
на HTTP 400. Обмеження довжини (MAX_FIELD_LEN) — захист від «роздутих» полів.
"""
from __future__ import annotations

import re

# ── Регулярні вирази форматів ───────────────────────────────────────────────
PHONE_RE = re.compile(r'^\+?[0-9()\-\s]{8,20}$')   # необов'язковий «+», цифри/дужки/дефіси/пробіли, 8–20 символів
EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')  # щось@щось.щось без пробілів — груба, але достатня перевірка

# ── Бізнес-ліміти ───────────────────────────────────────────────────────────
MIN_PASSWORD_LEN = 6           # мінімальна довжина пароля
MAX_AMOUNT = 99_999_999.99     # стеля суми операції (захист від переповнення/помилок)
MAX_FIELD_LEN = 500            # межа довжини текстового поля (анти-DoS на величезні рядки)


def require_fields(data: dict, fields: list[str]) -> None:
    """Перевіряє наявність обов'язкових полів у JSON-запиті."""
    # Порожнє значення (None, '', 0) теж вважається відсутнім — навмисно, бо
    # for банківських полів «порожньо» зазвичай так само погано, як «немає».
    missing = [field for field in fields if not data.get(field)]
    if missing:
        raise ValueError(f"Не заповнено обов'язкові поля: {', '.join(missing)}")


def validate_phone(phone: str) -> None:
    """Перевіряє телефон: непорожній, у межах довжини і відповідає PHONE_RE."""
    if not phone or len(phone.strip()) > MAX_FIELD_LEN:   # порожній або занадто довгий
        raise ValueError('Некоректний номер телефону.')
    if not PHONE_RE.match(phone.strip()):                 # не відповідає формату
        raise ValueError('Некоректний номер телефону.')


def validate_email(email: str) -> None:
    """Перевіряє email: непорожній, у межах довжини і відповідає EMAIL_RE."""
    if not email or len(email.strip()) > MAX_FIELD_LEN:
        raise ValueError('Некоректна адреса електронної пошти.')
    if not EMAIL_RE.match(email.strip()):
        raise ValueError('Некоректна адреса електронної пошти.')


def validate_password(password: str) -> None:
    """Мінімальна довжина пароля."""
    if not password or len(password) < MIN_PASSWORD_LEN:   # коротший за поріг -> відмова
        raise ValueError(f'Пароль має містити щонайменше {MIN_PASSWORD_LEN} символів.')


def validate_positive_amount(amount: float, max_amount: float = MAX_AMOUNT) -> None:
    """Сума операції має бути в діапазоні (0; max_amount]."""
    if amount <= 0:                                       # нуль і від'ємні суми заборонені
        raise ValueError('Сума повинна бути більшою за нуль.')
    if amount > max_amount:                               # понад стелю -> відмова
        raise ValueError(f'Сума не повинна перевищувати {max_amount:,.0f}.')

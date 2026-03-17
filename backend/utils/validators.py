"""Прості валідатори для перевірки вхідних даних API."""
from __future__ import annotations

import re

PHONE_RE = re.compile(r'^\+?[0-9()\-\s]{8,20}$')
EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')

MIN_PASSWORD_LEN = 6
MAX_AMOUNT = 99_999_999.99
MAX_FIELD_LEN = 500


def require_fields(data: dict, fields: list[str]) -> None:
    """Перевіряє наявність обов'язкових полів у JSON-запиті."""
    missing = [field for field in fields if not data.get(field)]
    if missing:
        raise ValueError(f"Не заповнено обов'язкові поля: {', '.join(missing)}")


def validate_phone(phone: str) -> None:
    if not phone or len(phone.strip()) > MAX_FIELD_LEN:
        raise ValueError('Некоректний номер телефону.')
    if not PHONE_RE.match(phone.strip()):
        raise ValueError('Некоректний номер телефону.')


def validate_email(email: str) -> None:
    if not email or len(email.strip()) > MAX_FIELD_LEN:
        raise ValueError('Некоректна адреса електронної пошти.')
    if not EMAIL_RE.match(email.strip()):
        raise ValueError('Некоректна адреса електронної пошти.')


def validate_password(password: str) -> None:
    """Мінімальна довжина пароля."""
    if not password or len(password) < MIN_PASSWORD_LEN:
        raise ValueError(f'Пароль має містити щонайменше {MIN_PASSWORD_LEN} символів.')


def validate_positive_amount(amount: float, max_amount: float = MAX_AMOUNT) -> None:
    if amount <= 0:
        raise ValueError('Сума повинна бути більшою за нуль.')
    if amount > max_amount:
        raise ValueError(f'Сума не повинна перевищувати {max_amount:,.0f}.')

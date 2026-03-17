"""Прості валідатори для перевірки вхідних даних API."""
from __future__ import annotations

import re

PHONE_RE = re.compile(r'^\+?[0-9()\-\s]{8,20}$')
EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


def require_fields(data: dict, fields: list[str]) -> None:
    """Перевіряє наявність обов'язкових полів у JSON-запиті."""
    missing = [field for field in fields if not data.get(field)]
    if missing:
        raise ValueError(f"Не заповнено обов'язкові поля: {', '.join(missing)}")


def validate_phone(phone: str) -> None:
    if not PHONE_RE.match(phone):
        raise ValueError('Некоректний номер телефону.')


def validate_email(email: str) -> None:
    if not EMAIL_RE.match(email):
        raise ValueError('Некоректна адреса електронної пошти.')


def validate_positive_amount(amount: float) -> None:
    if amount <= 0:
        raise ValueError('Сума повинна бути більшою за нуль.')

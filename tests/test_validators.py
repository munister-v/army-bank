"""Тести валідаторів."""
from __future__ import annotations

import pytest
from backend.utils.validators import (
    require_fields,
    validate_email,
    validate_phone,
    validate_positive_amount,
)


def test_require_fields_ok():
    require_fields({'a': 1, 'b': 2}, ['a', 'b'])


def test_require_fields_missing():
    with pytest.raises(ValueError, match='обов\'язкові поля'):
        require_fields({'a': 1}, ['a', 'b'])


def test_validate_phone_ok():
    validate_phone('+380991234567')
    validate_phone('0991234567')


def test_validate_phone_invalid():
    with pytest.raises(ValueError, match='телефону'):
        validate_phone('abc')
    with pytest.raises(ValueError, match='телефону'):
        validate_phone('123')


def test_validate_email_ok():
    validate_email('user@example.com')


def test_validate_email_invalid():
    with pytest.raises(ValueError, match='пошти'):
        validate_email('not-an-email')


def test_validate_positive_amount_ok():
    validate_positive_amount(0.01)
    validate_positive_amount(100)


def test_validate_positive_amount_invalid():
    with pytest.raises(ValueError, match='більшою за нуль'):
        validate_positive_amount(0)
    with pytest.raises(ValueError, match='більшою за нуль'):
        validate_positive_amount(-1)

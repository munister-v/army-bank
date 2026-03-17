"""Базові допоміжні функції для репозиторіїв."""
from __future__ import annotations

from ..database import get_connection


class BaseRepository:
    """Базовий клас-обгортка для доступу до БД."""

    @staticmethod
    def connection():
        return get_connection()

"""Базові допоміжні функції для репозиторіїв.

Усі репозиторії (user_repository, account_repository, …) наслідують цей клас,
щоб мати ЄДИНУ точку отримання з'єднання з БД. Якщо колись зміниться спосіб
підключення (пул, інша СУБД, транзакції) — правка буде лише тут, а не в кожному репо.
"""
from __future__ import annotations

from ..database import get_connection


class BaseRepository:
    """Базовий клас-обгортка для доступу до БД."""

    @staticmethod
    def connection():
        # Делегуємо у database.get_connection() — контекст-менеджер, що сам
        # відкриває й коректно закриває/комітить з'єднання (with conn: ...).
        return get_connection()

"""Модуль роботи з SQLite-базою даних."""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from .config import DATABASE_PATH, SCHEMA_PATH


def dict_factory(cursor: sqlite3.Cursor, row: tuple) -> dict:
    """Повертає рядок БД у вигляді словника."""
    return {col[0]: row[idx] for idx, col in enumerate(cursor.description)}


@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
    """Створює підключення до SQLite із підтримкою словників."""
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = dict_factory
    conn.execute('PRAGMA foreign_keys = ON;')
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    """Ініціалізує схему БД з SQL-файлу."""
    schema_sql = Path(SCHEMA_PATH).read_text(encoding='utf-8')
    with get_connection() as conn:
        conn.executescript(schema_sql)

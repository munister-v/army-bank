"""Репозиторій карток Army Bank."""
from __future__ import annotations

from ..database import get_returning_id_suffix, insert_last_id
from .base import BaseRepository


class CardRepository(BaseRepository):
    def issue_card(self, account_id: int, card_number: str, holder_name: str,
                   expires_at: str, card_type: str = 'virtual') -> int:
        with self.connection() as conn:
            cursor = conn.execute(
                '''
                INSERT INTO cards(account_id, card_number, card_type, holder_name, expires_at)
                VALUES(%s, %s, %s, %s, %s)
                ''' + get_returning_id_suffix(),
                (account_id, card_number, card_type, holder_name, expires_at),
            )
            return insert_last_id(cursor)

    def list_cards(self, account_id: int) -> list[dict]:
        with self.connection() as conn:
            rows = conn.execute(
                'SELECT * FROM cards WHERE account_id = %s ORDER BY issued_at DESC',
                (account_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    def get_card(self, card_id: int, account_id: int):
        with self.connection() as conn:
            row = conn.execute(
                'SELECT * FROM cards WHERE id = %s AND account_id = %s',
                (card_id, account_id),
            ).fetchone()
            return dict(row) if row else None

    def get_card_by_number(self, card_number: str):
        with self.connection() as conn:
            row = conn.execute(
                'SELECT c.*, a.account_number, a.balance, a.user_id '
                'FROM cards c JOIN accounts a ON a.id = c.account_id '
                'WHERE c.card_number = %s',
                (card_number,),
            ).fetchone()
            return dict(row) if row else None

    def set_status(self, card_id: int, account_id: int, status: str) -> None:
        with self.connection() as conn:
            conn.execute(
                'UPDATE cards SET status = %s WHERE id = %s AND account_id = %s',
                (status, card_id, account_id),
            )

    def count_active(self, account_id: int) -> int:
        with self.connection() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS n FROM cards WHERE account_id = %s AND status != 'closed'",
                (account_id,),
            ).fetchone()
            return int(row['n']) if row else 0

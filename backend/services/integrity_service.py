"""Цілісність транзакцій через хеш-ланцюг (мікро-блокчейн)."""
from __future__ import annotations

import hashlib
import json
from ..database import get_connection


def _hash_tx(tx_id: int, account_id: int, amount: float,
             direction: str, created_at: str, prev_hash: str) -> str:
    payload = json.dumps({
        'tx_id': tx_id, 'account_id': account_id,
        'amount': str(round(amount, 10)),
        'direction': direction, 'created_at': str(created_at),
        'prev_hash': prev_hash,
    }, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode()).hexdigest()


class IntegrityService:
    """Записує та перевіряє хеш-ланцюг транзакцій."""

    def record(self, tx_id: int, account_id: int,
               amount: float, direction: str, created_at: str) -> str:
        """Обчислює і зберігає хеш нової транзакції. Повертає хеш."""
        with get_connection() as conn:
            row = conn.execute(
                """SELECT chain_hash FROM integrity_hashes
                   WHERE account_id = %s
                   ORDER BY id DESC LIMIT 1""",
                (account_id,)
            ).fetchone()
            prev_hash = row['chain_hash'] if row else '0' * 64
            tx_hash = _hash_tx(tx_id, account_id, amount, direction, created_at, prev_hash)
            conn.execute(
                """INSERT INTO integrity_hashes
                   (account_id, transaction_id, prev_hash, tx_hash, chain_hash)
                   VALUES (%s, %s, %s, %s, %s)""",
                (account_id, tx_id, prev_hash, tx_hash, tx_hash)
            )
        return tx_hash

    def verify_account(self, account_id: int) -> dict:
        """Перевіряє всю ланцюжок хешів рахунку.
        Повертає {ok, total, broken_at, errors}."""
        with get_connection() as conn:
            hashes = conn.execute(
                """SELECT ih.*, t.amount, t.direction, t.created_at
                   FROM integrity_hashes ih
                   JOIN transactions t ON t.id = ih.transaction_id
                   WHERE ih.account_id = %s
                   ORDER BY ih.id ASC""",
                (account_id,)
            ).fetchall()
        if not hashes:
            return {'ok': True, 'total': 0, 'errors': []}

        errors = []
        prev_hash = '0' * 64
        for ih in hashes:
            expected = _hash_tx(
                ih['transaction_id'], account_id,
                float(ih['amount']), ih['direction'],
                str(ih['created_at']), prev_hash
            )
            if expected != ih['tx_hash']:
                errors.append({
                    'hash_record_id': ih['id'],
                    'transaction_id': ih['transaction_id'],
                    'expected': expected,
                    'stored': ih['tx_hash'],
                })
            prev_hash = ih['chain_hash']

        return {
            'ok': len(errors) == 0,
            'total': len(hashes),
            'broken_at': errors[0]['transaction_id'] if errors else None,
            'errors': errors,
        }

    def verify_all_accounts(self) -> dict:
        """Перевіряє всі рахунки. Повертає зведений звіт."""
        with get_connection() as conn:
            account_ids = [
                r['account_id'] for r in
                conn.execute(
                    "SELECT DISTINCT account_id FROM integrity_hashes"
                ).fetchall()
            ]
        results = {}
        for aid in account_ids:
            results[aid] = self.verify_account(aid)
        total = len(results)
        broken = sum(1 for r in results.values() if not r['ok'])
        return {
            'total_accounts': total,
            'broken_accounts': broken,
            'all_ok': broken == 0,
            'per_account': results,
        }

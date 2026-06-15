"""Цілісність транзакцій через хеш-ланцюг (мікро-блокчейн).

Кожна транзакція рахунку отримує хеш, який включає хеш ПОПЕРЕДНЬОЇ транзакції
(prev_hash). Виходить ланцюг: щоб непомітно підмінити одну транзакцію в історії,
довелося б перерахувати хеші ВСІХ наступних. Це робить будь-яку правку
балансу/історії в обхід застосунку миттєво виявною під час перевірки ланцюга.
"""
from __future__ import annotations

import hashlib
import json
from ..database import get_connection


def _hash_tx(tx_id: int, account_id: int, amount: float,
             direction: str, created_at: str, prev_hash: str) -> str:
    """Рахує SHA-256 однієї ланки ланцюга: дані транзакції + хеш попередньої."""
    # Канонічний JSON (sort_keys) -> детермінований хеш: ті самі дані завжди
    # дають той самий результат, тож перевірку можна повторити будь-коли.
    payload = json.dumps({
        'tx_id': tx_id, 'account_id': account_id,
        'amount': str(round(amount, 10)),                # фіксована точність — щоб float не «плавав»
        'direction': direction, 'created_at': str(created_at),
        'prev_hash': prev_hash,                          # ← зв'язок із попередньою ланкою (ефект ланцюга)
    }, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode()).hexdigest()


class IntegrityService:
    """Записує та перевіряє хеш-ланцюг транзакцій."""

    def record(self, tx_id: int, account_id: int,
               amount: float, direction: str, created_at: str) -> str:
        """Обчислює і зберігає хеш нової транзакції. Повертає хеш."""
        with get_connection() as conn:
            # Беремо хеш останньої ланки рахунку — він стане prev_hash для нової.
            row = conn.execute(
                """SELECT chain_hash FROM integrity_hashes
                   WHERE account_id = %s
                   ORDER BY id DESC LIMIT 1""",
                (account_id,)
            ).fetchone()
            prev_hash = row['chain_hash'] if row else '0' * 64   # перша транзакція -> «нульовий» корінь ланцюга
            tx_hash = _hash_tx(tx_id, account_id, amount, direction, created_at, prev_hash)  # нова ланка
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
            return {'ok': True, 'total': 0, 'errors': []}     # немає транзакцій -> нема що ламати

        errors = []
        prev_hash = '0' * 64                                  # стартуємо з того ж кореня, що й при record()
        for ih in hashes:
            # Перераховуємо хеш заново з фактичних даних транзакції в БД...
            expected = _hash_tx(
                ih['transaction_id'], account_id,
                float(ih['amount']), ih['direction'],
                str(ih['created_at']), prev_hash
            )
            # ...і звіряємо зі збереженим. Розбіжність = дані змінили в обхід застосунку.
            if expected != ih['tx_hash']:
                errors.append({
                    'hash_record_id': ih['id'],
                    'transaction_id': ih['transaction_id'],
                    'expected': expected,                     # яким хеш МАВ бути
                    'stored': ih['tx_hash'],                  # який реально лежить у БД
                })
            prev_hash = ih['chain_hash']                      # переходимо до наступної ланки ланцюга

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

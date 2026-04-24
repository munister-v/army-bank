"""Settlement Service — COBOL-style batch settlement pipeline.

COBOL-банківський pipeline:
  1. OPEN batch    — відкриваємо новий settlement batch (EOD або on-demand)
  2. COLLECT       — збираємо completed payment_orders за вікно в batch
  3. NET           — нетинг взаємних платежів (NettingEngine)
  4. SETTLE        — проводимо нетовані транзакції, оновлюємо journal
  5. RECONCILE     — перевіряємо дебет = кредит (LedgerService)
  6. CLOSE batch   — ставимо статус 'settled', зберігаємо підсумок

Batch types:
  'eod'      — End-of-Day (запускається о 23:55 UTC автоматично)
  'intraday' — Внутрішньоденний кліринг (кожні 4 год)
  'adhoc'    — Позачерговий (за запитом адміна)
"""
from __future__ import annotations

import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional

from ..database import get_connection, get_returning_id_suffix, insert_last_id
from ..services.netting_engine import NettingEngine
from ..services.ledger_service import LedgerService


class SettlementService:

    def __init__(self):
        self._netting = NettingEngine()
        self._ledger  = LedgerService()

    # ─── Public pipeline ──────────────────────────────────────────────────────

    def run_eod_settlement(self, date_str: Optional[str] = None) -> dict:
        """Повний EOD-цикл: open → collect → net → settle → reconcile → close."""
        batch_id = self.open_batch(batch_type='eod', notes=f'EOD {date_str or "today"}')
        collect  = self.collect_into_batch(batch_id, date_str=date_str)
        netting  = self.net_batch(batch_id)
        settle   = self.settle_batch(batch_id)
        recon    = self._ledger.reconcile(date_str)
        self.close_batch(batch_id, settled_count=settle['settled'])

        return {
            'batch_id':        batch_id,
            'collect':         collect,
            'netting':         netting,
            'settle':          settle,
            'reconcile':       recon,
            'balanced':        recon.get('balanced', False),
        }

    def open_batch(self, batch_type: str = 'eod', notes: str = '') -> int:
        """Відкриває новий settlement batch. Повертає batch_id."""
        ref = f'BATCH-{batch_type.upper()}-{datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")}-{secrets.token_hex(4).upper()}'
        suffix = get_returning_id_suffix()
        with get_connection() as conn:
            cur = conn.execute(
                "INSERT INTO settlement_batches (batch_ref, batch_type, status, notes)"
                " VALUES (%s, %s, 'open', %s)" + suffix,
                (ref, batch_type, notes),
            )
        return insert_last_id(cur)

    def collect_into_batch(
        self,
        batch_id: int,
        date_str: Optional[str] = None,
        window_hours: int = 24,
    ) -> dict:
        """Збирає completed payment_orders у settlement_items.

        Якщо date_str задано — збирає за той день.
        Інакше — за останні window_hours годин.
        """
        if date_str:
            from_ts = f'{date_str} 00:00:00'
            to_ts   = f'{date_str} 23:59:59'
        else:
            now = datetime.now(timezone.utc)
            from_ts = (now - timedelta(hours=window_hours)).isoformat()
            to_ts   = now.isoformat()

        with get_connection() as conn:
            orders = conn.execute(
                "SELECT id, sender_account_id, recipient_account_id, amount"
                " FROM payment_orders"
                " WHERE status='completed'"
                "   AND created_at BETWEEN %s AND %s"
                "   AND id NOT IN ("
                "     SELECT payment_order_id FROM settlement_items"
                "     WHERE payment_order_id IS NOT NULL"
                "   )",
                (from_ts, to_ts),
            ).fetchall()

        if not orders:
            return {'collected': 0, 'total_amount': 0.0}

        total = 0.0
        suffix = get_returning_id_suffix()
        for o in orders:
            amount = float(o['amount'])
            total += amount
            with get_connection() as conn:
                conn.execute(
                    "INSERT INTO settlement_items"
                    " (batch_id, payment_order_id, sender_account_id,"
                    "  recipient_account_id, amount, item_type, status)"
                    " VALUES (%s, %s, %s, %s, %s, 'transfer', 'pending')",
                    (batch_id, o['id'], o['sender_account_id'],
                     o['recipient_account_id'], amount),
                )

        with get_connection() as conn:
            conn.execute(
                "UPDATE settlement_batches"
                " SET total_items=%s, total_amount=%s WHERE id=%s",
                (len(orders), round(total, 2), batch_id),
            )

        return {'collected': len(orders), 'total_amount': round(total, 2)}

    def net_batch(self, batch_id: int) -> dict:
        """Запускає NettingEngine для батчу."""
        return self._netting.net_batch(batch_id)

    def settle_batch(self, batch_id: int) -> dict:
        """Проводить всі pending-items у batch як settled."""
        now = datetime.now(timezone.utc).isoformat()
        with get_connection() as conn:
            cur = conn.execute(
                "UPDATE settlement_items SET status='settled', settled_at=%s"
                " WHERE batch_id=%s AND status='pending'",
                (now, batch_id),
            )
            settled = cur.rowcount

        return {'settled': settled, 'settled_at': now}

    def close_batch(self, batch_id: int, settled_count: int = 0) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with get_connection() as conn:
            conn.execute(
                "UPDATE settlement_batches"
                " SET status='settled', settled_items=%s, settled_at=%s"
                " WHERE id=%s",
                (settled_count, now, batch_id),
            )

    def get_batch(self, batch_id: int) -> Optional[dict]:
        with get_connection() as conn:
            row = conn.execute(
                'SELECT * FROM settlement_batches WHERE id=%s', (batch_id,)
            ).fetchone()
        return dict(row) if row else None

    def list_batches(self, limit: int = 20) -> list[dict]:
        with get_connection() as conn:
            rows = conn.execute(
                'SELECT * FROM settlement_batches ORDER BY created_at DESC LIMIT %s',
                (limit,),
            ).fetchall()
        return [dict(r) for r in rows]

    def batch_items(self, batch_id: int) -> list[dict]:
        with get_connection() as conn:
            rows = conn.execute(
                'SELECT * FROM settlement_items WHERE batch_id=%s ORDER BY id',
                (batch_id,),
            ).fetchall()
        return [dict(r) for r in rows]

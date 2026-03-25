"""Idempotency storage for monetary API operations."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

from ..config import USE_PG
from ..database import get_connection


class IdempotencyService:
    def _payload_hash(self, payload: dict | list | str | None) -> str:
        canonical = json.dumps(payload or {}, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
        return hashlib.sha256(canonical.encode('utf-8')).hexdigest()

    def reserve(self, user_id: int, action: str, key: str, payload: dict | None = None) -> dict:
        req_hash = self._payload_hash(payload)
        now_iso = datetime.now(timezone.utc).isoformat()

        with get_connection() as conn:
            if USE_PG:
                cur = conn.execute(
                    """INSERT INTO api_idempotency
                       (user_id, action, idempotency_key, request_hash, status, created_at, updated_at)
                       VALUES (%s,%s,%s,%s,'processing',%s,%s)
                       ON CONFLICT (user_id, action, idempotency_key) DO NOTHING
                       RETURNING id""",
                    (user_id, action, key, req_hash, now_iso, now_iso)
                )
                created = bool(cur.fetchone())
            else:
                cur = conn.execute(
                    """INSERT OR IGNORE INTO api_idempotency
                       (user_id, action, idempotency_key, request_hash, status, created_at, updated_at)
                       VALUES (%s,%s,%s,%s,'processing',%s,%s)""",
                    (user_id, action, key, req_hash, now_iso, now_iso)
                )
                created = (cur.rowcount or 0) > 0

            if created:
                return {'state': 'new', 'key': key}

            row = conn.execute(
                """SELECT request_hash, status, response_code, response_payload
                   FROM api_idempotency
                   WHERE user_id = %s AND action = %s AND idempotency_key = %s""",
                (user_id, action, key)
            ).fetchone()

        if not row:
            return {'state': 'processing', 'key': key}

        stored_hash = str(row.get('request_hash') or '').strip()
        if stored_hash and stored_hash != req_hash:
            return {'state': 'conflict', 'key': key}

        status = str(row.get('status') or '').lower()
        if status == 'completed' and row.get('response_payload'):
            try:
                payload_obj = json.loads(row['response_payload'])
            except Exception:
                payload_obj = {'ok': False, 'error': 'Помилка читання idempotency cache.'}
            return {
                'state': 'replay',
                'key': key,
                'response_code': int(row.get('response_code') or 200),
                'payload': payload_obj,
            }

        return {'state': 'processing', 'key': key}

    def complete(self, user_id: int, action: str, key: str, response_payload: dict, response_code: int = 200) -> None:
        now_iso = datetime.now(timezone.utc).isoformat()
        payload_text = json.dumps(response_payload, ensure_ascii=False)
        with get_connection() as conn:
            conn.execute(
                """UPDATE api_idempotency
                   SET status = 'completed',
                       response_code = %s,
                       response_payload = %s,
                       updated_at = %s
                   WHERE user_id = %s AND action = %s AND idempotency_key = %s""",
                (int(response_code), payload_text, now_iso, user_id, action, key)
            )

    def release_processing(self, user_id: int, action: str, key: str) -> None:
        with get_connection() as conn:
            conn.execute(
                """DELETE FROM api_idempotency
                   WHERE user_id = %s AND action = %s AND idempotency_key = %s
                     AND status = 'processing'""",
                (user_id, action, key)
            )

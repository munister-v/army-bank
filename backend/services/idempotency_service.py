"""Сховище ідемпотентності для грошових API-операцій.

Ідемпотентність гарантує, що повторний запит з тим самим ключем (через ретрай
мережі, подвійний клік чи «завислу» форму) НЕ виконає операцію двічі. Кожна
спроба фіксується в таблиці api_idempotency у статусі processing -> completed,
а готова відповідь кешується і віддається повторно замість нового списання.

Життєвий цикл: reserve() (резервує ключ) -> [виконання операції] ->
complete() (зберігає результат) або release_processing() (відпускає при збої).
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

from ..config import USE_PG          # прапорець: працюємо на PostgreSQL чи на SQLite
from ..database import get_connection


class IdempotencyService:
    def _payload_hash(self, payload: dict | list | str | None) -> str:
        # Канонічний JSON (відсортовані ключі, без пробілів) -> однаковий хеш
        # для логічно ідентичних тіл запиту незалежно від порядку полів.
        canonical = json.dumps(payload or {}, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
        return hashlib.sha256(canonical.encode('utf-8')).hexdigest()  # SHA-256 «відбиток» запиту

    def reserve(self, user_id: int, action: str, key: str, payload: dict | None = None) -> dict:
        """Резервує ключ ідемпотентності. Повертає стан: new / processing / replay / conflict."""
        req_hash = self._payload_hash(payload)               # фіксуємо «відбиток» поточного запиту
        now_iso = datetime.now(timezone.utc).isoformat()

        with get_connection() as conn:
            # ── Атомарна спроба «зайняти» ключ ──────────────────────────────
            # Вставка з ON CONFLICT DO NOTHING (PG) / INSERT OR IGNORE (SQLite):
            # лише ПЕРШИЙ паралельний запит реально вставить рядок і піде далі,
            # решта отримають created=False і прочитають уже наявний результат.
            if USE_PG:
                cur = conn.execute(
                    """INSERT INTO api_idempotency
                       (user_id, action, idempotency_key, request_hash, status, created_at, updated_at)
                       VALUES (%s,%s,%s,%s,'processing',%s,%s)
                       ON CONFLICT (user_id, action, idempotency_key) DO NOTHING
                       RETURNING id""",
                    (user_id, action, key, req_hash, now_iso, now_iso)
                )
                created = bool(cur.fetchone())               # RETURNING повернув рядок -> ми його створили
            else:
                cur = conn.execute(
                    """INSERT OR IGNORE INTO api_idempotency
                       (user_id, action, idempotency_key, request_hash, status, created_at, updated_at)
                       VALUES (%s,%s,%s,%s,'processing',%s,%s)""",
                    (user_id, action, key, req_hash, now_iso, now_iso)
                )
                created = (cur.rowcount or 0) > 0            # rowcount>0 -> вставка відбулась

            if created:
                return {'state': 'new', 'key': key}          # ключ наш — викликаючий може виконувати операцію

            # Ключ уже існує — читаємо попередній запис, щоб вирішити що робити.
            row = conn.execute(
                """SELECT request_hash, status, response_code, response_payload
                   FROM api_idempotency
                   WHERE user_id = %s AND action = %s AND idempotency_key = %s""",
                (user_id, action, key)
            ).fetchone()

        if not row:
            return {'state': 'processing', 'key': key}        # рідкісна гонка: рядок зник між запитами

        # ── Захист від колізії ключа ───────────────────────────────────────
        # Той самий ключ, але ІНШЕ тіло запиту = помилка клієнта (переюзав ключ).
        stored_hash = str(row.get('request_hash') or '').strip()
        if stored_hash and stored_hash != req_hash:
            return {'state': 'conflict', 'key': key}

        # ── Повтор завершеної операції (replay) ────────────────────────────
        # Операція вже виконана — віддаємо КЕШОВАНУ відповідь, не роблячи її знову.
        status = str(row.get('status') or '').lower()
        if status == 'completed' and row.get('response_payload'):
            try:
                payload_obj = json.loads(row['response_payload'])  # розпаковуємо збережену відповідь
            except Exception:
                payload_obj = {'ok': False, 'error': 'Помилка читання idempotency cache.'}
            return {
                'state': 'replay',
                'key': key,
                'response_code': int(row.get('response_code') or 200),
                'payload': payload_obj,
            }

        # Запис є, але ще в роботі (інший запит виконує) -> просимо клієнта зачекати.
        return {'state': 'processing', 'key': key}

    def complete(self, user_id: int, action: str, key: str, response_payload: dict, response_code: int = 200) -> None:
        """Фіксує успішний результат: статус -> completed і кешує відповідь для майбутніх повторів."""
        now_iso = datetime.now(timezone.utc).isoformat()
        payload_text = json.dumps(response_payload, ensure_ascii=False)  # серіалізуємо відповідь у JSON-текст
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
        """Відпускає ключ при збої операції — видаляє лише незавершені (processing) записи,
        щоб клієнт міг повторити спробу з тим самим ключем (completed-записи не чіпаємо)."""
        with get_connection() as conn:
            conn.execute(
                """DELETE FROM api_idempotency
                   WHERE user_id = %s AND action = %s AND idempotency_key = %s
                     AND status = 'processing'""",
                (user_id, action, key)
            )

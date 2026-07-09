#!/usr/bin/env python3
"""Одноразовий бекфіл: створює реальну `conversations`-розмову для кожного
ліда (де ще немає) і переносить наявні `lead_activity` записи в `messages`
цієї розмови (з поміткою [author] і оригінальним часом), щоб історія була
видна прямо в чаті. Idempotent — лідів з уже привʼязаною розмовою пропускає.

Usage:
    python3 scripts/backfill_lead_conversations.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def main() -> None:
    from backend.app import create_app
    from backend.routes.leads_routes import _ensure_schema, _get_or_create_lead_conversation
    from backend.database import get_connection
    from backend.services.messenger_crypto import encrypt_message

    app = create_app()
    with app.app_context():
        _ensure_schema()
        with get_connection() as conn:
            admin_rows = conn.execute(
                "SELECT id FROM users WHERE role IN ('admin', 'platform_admin') ORDER BY id ASC"
            ).fetchall()
            admin_ids = [int(r['id']) for r in (admin_rows or [])]
            if not admin_ids:
                print('Немає жодного admin/platform_admin користувача — нема кому призначити '
                      'історичні повідомлення. Спершу підвищіть роль хоча б одного акаунта.')
                return
            runner_id = admin_ids[0]

            leads = conn.execute('SELECT id FROM leads ORDER BY id ASC').fetchall()
            migrated = 0
            skipped = 0
            for lead in (leads or []):
                lead_id = int(lead['id'])
                existing_conv = conn.execute(
                    'SELECT id FROM conversations WHERE lead_id = %s', (lead_id,)
                ).fetchone()
                if existing_conv:
                    skipped += 1
                    continue

                conv_id = _get_or_create_lead_conversation(conn, lead_id, runner_id)
                for uid in admin_ids:
                    already = conn.execute(
                        'SELECT id FROM conversation_participants WHERE conversation_id = %s AND user_id = %s',
                        (conv_id, uid),
                    ).fetchone()
                    if not already:
                        conn.execute(
                            'INSERT INTO conversation_participants (conversation_id, user_id) VALUES (%s, %s)',
                            (conv_id, uid),
                        )

                activity_rows = conn.execute(
                    'SELECT author, kind, text, created_at FROM lead_activity WHERE lead_id = %s ORDER BY id ASC',
                    (lead_id,),
                ).fetchall()
                last_preview = None
                last_created = None
                for a in (activity_rows or []):
                    text = str(a['text'] or '').strip()
                    if not text:
                        continue
                    author = str(a['author'] or 'CRM').strip() or 'CRM'
                    msg_text = f'[{author}] {text}'
                    conn.execute(
                        'INSERT INTO messages (conversation_id, sender_id, text, msg_type, created_at) '
                        'VALUES (%s, %s, %s, %s, %s)',
                        (conv_id, runner_id, encrypt_message(msg_text), 'text', a['created_at']),
                    )
                    last_preview = msg_text[:180]
                    last_created = a['created_at']

                if last_preview is not None:
                    conn.execute(
                        'UPDATE conversations SET last_message_at = %s, last_message_text = %s WHERE id = %s',
                        (last_created, last_preview, conv_id),
                    )
                migrated += 1

        print(f'Мігровано {migrated} лідів у реальні розмови, пропущено {skipped} (вже мали розмову).')


if __name__ == '__main__':
    main()

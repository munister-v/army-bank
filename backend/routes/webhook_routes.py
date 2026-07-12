"""Публічний вебхук для вхідних подій Meta (WhatsApp Cloud API / Instagram
Messaging). Кожен менеджер сам реєструє цей URL + verify-token у своєму Meta
App/Business кабінеті (див. ARM CRM → «Інтеграції» → «Webhook»); ARM CRM сам
приймає та розкладає вхідні повідомлення по відповідних лідах.

Без @auth_required — Meta не має Bearer-токена ARM CRM. Захист — verify-token
на GET-хендшейку (Meta вимагає його один раз при підписці) та те, що ми лише
читаємо/створюємо ліди, нічого руйнівного тут немає.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import date
from typing import Any

from flask import Blueprint, Response, jsonify, request

from ..database import get_connection
from ..services.messenger_crypto import decrypt_message, encrypt_message
from ..services.meta_api import MetaApiError, fetch_attachment_url, fetch_whatsapp_media
from ..utils.security import hash_password
from .helpers import api_error
from .integrations_routes import find_integration, get_app_secret, mark_message_seen, webhook_verify_token
from .leads_routes import _ensure_schema as _ensure_leads_schema
from .leads_routes import _get_or_create_lead_conversation, _log_activity, _next_lead_id
from .push_routes import send_push

webhook_bp = Blueprint('webhooks', __name__, url_prefix='/api/webhooks')

_CONTACT_ROLE = 'channel_contact'
_CONTACT_PHONE = '+380990000002'
_CONTACT_EMAIL = 'channel.contact@army-bank.bot'
_CONTACT_NAME = 'Клієнт (месенджер)'
_CONTACT_PASSWORD = 'army-bank-channel-contact-system-only'


def _now_sql() -> str:
    from ..config import USE_PG
    return 'NOW()' if USE_PG else 'CURRENT_TIMESTAMP'


def _get_or_create_contact_user(conn) -> int:
    """Один спільний синтетичний користувач-«клієнт» для всіх вхідних
    WhatsApp/Instagram повідомлень — той самий трюк, що й Army Bank Assistant
    у messenger_routes.py: інший users.id => рендериться як «them»-бульбашка."""
    existing = conn.execute(
        'SELECT id FROM users WHERE role = %s OR phone = %s OR LOWER(email) = LOWER(%s) LIMIT 1',
        (_CONTACT_ROLE, _CONTACT_PHONE, _CONTACT_EMAIL),
    ).fetchone()
    if existing:
        return int(existing['id'])

    from ..config import USE_PG
    pwd_hash = hash_password(_CONTACT_PASSWORD)
    if USE_PG:
        row = conn.execute(
            """
            INSERT INTO users(full_name, phone, email, password_hash, role)
            VALUES(%s, %s, %s, %s, %s)
            RETURNING id
            """,
            (_CONTACT_NAME, _CONTACT_PHONE, _CONTACT_EMAIL, pwd_hash, _CONTACT_ROLE),
        ).fetchone()
        return int(row['id'])
    conn.execute(
        'INSERT INTO users(full_name, phone, email, password_hash, role) VALUES(%s, %s, %s, %s, %s)',
        (_CONTACT_NAME, _CONTACT_PHONE, _CONTACT_EMAIL, pwd_hash, _CONTACT_ROLE),
    )
    return int(conn.execute('SELECT last_insert_rowid() AS id').fetchone()['id'])


def _signature_ok(app_secret: str, raw_body: bytes, signature_header: str) -> bool:
    """Перевіряє X-Hub-Signature-256 (HMAC-SHA256 тіла запиту на App Secret) —
    так Meta підписує кожну вебхук-доставку. Без цього будь-хто, хто вгадає
    чийсь phone_number_id/ig_user_id, міг би підробити «вхідне повідомлення»
    і воно б стало реальним лідом. Якщо app_secret для інтеграції не заданий
    (менеджер не вказав його при підключенні) — пропускаємо перевірку."""
    if not app_secret:
        return True
    if not signature_header.startswith('sha256='):
        return False
    expected = hmac.new(app_secret.encode('utf-8'), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header[len('sha256='):])


def _first_admin_id(conn) -> int | None:
    row = conn.execute(
        "SELECT id FROM users WHERE role IN ('admin', 'platform_admin', 'manager') ORDER BY id ASC LIMIT 1"
    ).fetchone()
    return int(row['id']) if row else None


def _find_or_create_lead(conn, *, manager: str, channel_field: str, contact_value: str,
                          contact_name: str, primary_channel: str) -> int:
    row = conn.execute(
        f'SELECT id FROM leads WHERE {channel_field} = %s AND owner = %s LIMIT 1',
        (contact_value, manager),
    ).fetchone()
    if row:
        return int(row['id'])

    lead_id = _next_lead_id(conn)
    business_name = contact_name.strip() or contact_value
    from ..config import USE_PG
    cols = [
        'lead_id', 'business_name', 'owner', 'pipeline', 'stage', 'priority',
        'outreach_status', 'reply_status', 'primary_channel', channel_field,
        'source_bucket', 'messenger_note',
    ]
    values = [
        lead_id, business_name, manager, 'Inbound', 'New', 'Medium',
        'Message sent', 'Replied', primary_channel, contact_value,
        f'inbound_{channel_field}', f'Вхідне звернення через {primary_channel}',
    ]
    placeholders = ', '.join(['%s'] * len(cols))
    if USE_PG:
        cur = conn.execute(
            f"INSERT INTO leads ({', '.join(cols)}) VALUES ({placeholders}) RETURNING id",
            values,
        )
        return int(cur.fetchone()['id'])
    conn.execute(f"INSERT INTO leads ({', '.join(cols)}) VALUES ({placeholders})", values)
    return int(conn.execute('SELECT last_insert_rowid() AS id').fetchone()['id'])


def _ingest_inbound_message(conn, *, manager: str, channel_field: str, contact_value: str,
                             contact_name: str, primary_channel: str, msg_type: str,
                             stored_text: str, preview: str, channel_label: str) -> None:
    """Спільна частина для текстових і медіа-повідомлень: знайти/створити ліда,
    його розмову, синтетичного «клієнта»-відправника, вставити повідомлення."""
    admin_id = _first_admin_id(conn)
    if not admin_id:
        return
    lead_id = _find_or_create_lead(
        conn, manager=manager, channel_field=channel_field, contact_value=contact_value,
        contact_name=contact_name, primary_channel=primary_channel,
    )
    conv_id = _get_or_create_lead_conversation(conn, lead_id, admin_id)
    contact_user_id = _get_or_create_contact_user(conn)

    conn.execute(
        'INSERT INTO messages (conversation_id, sender_id, text, msg_type) VALUES (%s, %s, %s, %s)',
        (conv_id, contact_user_id, stored_text, msg_type),
    )
    conn.execute(
        f'UPDATE conversations SET last_message_at = {_now_sql()}, last_message_text = %s WHERE id = %s',
        (preview[:180], conv_id),
    )
    lead_row = conn.execute('SELECT business_name FROM leads WHERE id = %s', (lead_id,)).fetchone()
    business_name = (lead_row or {}).get('business_name') or contact_name or contact_value
    conn.execute(
        f"UPDATE leads SET outreach_status = 'Replied', reply_status = 'Replied', "
        f'last_touch_date = %s, updated_at = {_now_sql()} WHERE id = %s',
        (date.today().isoformat(), lead_id),
    )
    _log_activity(conn, lead_id, f'Клієнт ({channel_label})', 'note', preview)

    # Досі жоден вхідний webhook (WhatsApp/Instagram) не будив менеджера — лід
    # тихо оновлювався в БД, і про відповідь клієнта дізнавались лише
    # відкривши CRM вручну. Пушимо тим самим шляхом, що й звичайні
    # повідомлення месенджера (send_message() у messenger_routes.py).
    push_body = '🖼️ Фото' if msg_type == 'image' else preview[:140]
    participant_rows = conn.execute(
        'SELECT user_id FROM conversation_participants WHERE conversation_id = %s AND user_id != %s',
        (conv_id, contact_user_id),
    ).fetchall()
    for row in participant_rows:
        try:
            send_push(
                int(row['user_id']),
                f'{channel_label} · {business_name}',
                push_body,
                f'/messenger?conv={conv_id}',
                'message_text',
                {'conversation_id': int(conv_id), 'sender_name': business_name, 'msg_type': msg_type},
            )
        except Exception:
            pass  # push — best-effort, ніколи не має ламати обробку вебхука


def _ingest_inbound_text(conn, *, manager: str, channel_field: str, contact_value: str,
                          contact_name: str, primary_channel: str, text: str, channel_label: str) -> None:
    _ingest_inbound_message(
        conn, manager=manager, channel_field=channel_field, contact_value=contact_value,
        contact_name=contact_name, primary_channel=primary_channel, msg_type='text',
        stored_text=encrypt_message(text), preview=text, channel_label=channel_label,
    )


def _ingest_inbound_image(conn, *, manager: str, channel_field: str, contact_value: str,
                           contact_name: str, primary_channel: str, image_bytes: bytes,
                           mime_type: str, channel_label: str) -> None:
    payload = json.dumps({
        'v': 1,
        'items': [{'mime': mime_type, 'data': base64.b64encode(image_bytes).decode('ascii')}],
    }, ensure_ascii=False, separators=(',', ':'))
    _ingest_inbound_message(
        conn, manager=manager, channel_field=channel_field, contact_value=contact_value,
        contact_name=contact_name, primary_channel=primary_channel, msg_type='image',
        stored_text=encrypt_message(payload), preview='🖼️ Фото', channel_label=channel_label,
    )


def _process_whatsapp_change(conn, value: dict[str, Any], raw_body: bytes, signature_header: str) -> None:
    messages = value.get('messages') or []
    if not messages:
        return
    phone_number_id = str((value.get('metadata') or {}).get('phone_number_id') or '')
    if not phone_number_id:
        return
    integration = find_integration(conn, 'whatsapp', phone_number_id)
    if not integration:
        return
    if not _signature_ok(get_app_secret(integration), raw_body, signature_header):
        return
    contacts = value.get('contacts') or []
    contact_name = ''
    if contacts and isinstance(contacts[0], dict):
        contact_name = str((contacts[0].get('profile') or {}).get('name') or '')

    for msg in messages:
        if not isinstance(msg, dict) or msg.get('type') not in ('text', 'image'):
            continue
        if not mark_message_seen(conn, str(msg.get('id') or '')):
            continue
        wa_id = str(msg.get('from') or '').strip()
        if not wa_id:
            continue

        if msg.get('type') == 'image':
            media_id = str((msg.get('image') or {}).get('id') or '')
            if not media_id:
                continue
            token = decrypt_message(integration['access_token'], fallback='')
            try:
                image_bytes, mime_type = fetch_whatsapp_media(media_id, token)
            except MetaApiError:
                # Медіа не вдалося завантажити (протух токен, файл видалено
                # тощо) — краще пропустити цю подію, ніж завалити весь вебхук.
                continue
            _ingest_inbound_image(
                conn, manager=integration['manager'], channel_field='whatsapp_viber',
                contact_value=wa_id, contact_name=contact_name, primary_channel='WhatsApp',
                image_bytes=image_bytes, mime_type=mime_type, channel_label='WhatsApp',
            )
            continue

        text = str((msg.get('text') or {}).get('body') or '').strip()
        if not text:
            continue
        _ingest_inbound_text(
            conn, manager=integration['manager'], channel_field='whatsapp_viber',
            contact_value=wa_id, contact_name=contact_name, primary_channel='WhatsApp',
            text=text, channel_label='WhatsApp',
        )


def _process_instagram_entry(conn, entry: dict[str, Any], raw_body: bytes, signature_header: str) -> None:
    ig_account_id = str(entry.get('id') or '')
    if not ig_account_id:
        return
    integration = find_integration(conn, 'instagram', ig_account_id)
    if not integration:
        return
    if not _signature_ok(get_app_secret(integration), raw_body, signature_header):
        return
    for event in (entry.get('messaging') or []):
        if not isinstance(event, dict):
            continue
        message = event.get('message') or {}
        if not isinstance(message, dict) or message.get('is_echo'):
            continue
        if not mark_message_seen(conn, str(message.get('mid') or '')):
            continue
        sender_id = str((event.get('sender') or {}).get('id') or '').strip()
        if not sender_id:
            continue

        attachments = message.get('attachments') or []
        image_attachment = next(
            (a for a in attachments if isinstance(a, dict) and a.get('type') == 'image'), None,
        )
        if image_attachment:
            url = str((image_attachment.get('payload') or {}).get('url') or '')
            if not url:
                continue
            try:
                image_bytes, mime_type = fetch_attachment_url(url)
            except MetaApiError:
                continue
            _ingest_inbound_image(
                conn, manager=integration['manager'], channel_field='instagram',
                contact_value=sender_id, contact_name='', primary_channel='Instagram',
                image_bytes=image_bytes, mime_type=mime_type, channel_label='Instagram',
            )
            continue

        text = str(message.get('text') or '').strip()
        if not text:
            continue
        _ingest_inbound_text(
            conn, manager=integration['manager'], channel_field='instagram',
            contact_value=sender_id, contact_name='', primary_channel='Instagram',
            text=text, channel_label='Instagram',
        )


@webhook_bp.get('/meta')
def verify_meta_webhook():
    mode = request.args.get('hub.mode')
    token = request.args.get('hub.verify_token')
    challenge = request.args.get('hub.challenge', '')
    if mode == 'subscribe' and token == webhook_verify_token():
        return Response(challenge, status=200, mimetype='text/plain')
    return api_error('Verify token mismatch.', 403)


@webhook_bp.post('/meta')
def receive_meta_webhook():
    # Ensure the leads schema exists BEFORE opening our own connection below —
    # _ensure_leads_schema() opens its own `with get_connection()` internally,
    # and SQLite doesn't like a second write connection while the first is
    # still mid-transaction (raises "database is locked").
    _ensure_leads_schema()

    raw_body = request.get_data()
    signature_header = request.headers.get('X-Hub-Signature-256', '')
    payload = request.get_json(silent=True) or {}
    object_type = payload.get('object')
    entries = payload.get('entry') or []

    with get_connection() as conn:
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            try:
                if object_type == 'whatsapp_business_account':
                    for change in (entry.get('changes') or []):
                        if isinstance(change, dict):
                            _process_whatsapp_change(conn, change.get('value') or {}, raw_body, signature_header)
                elif object_type == 'instagram':
                    _process_instagram_entry(conn, entry, raw_body, signature_header)
            except Exception:
                # Best-effort: одна зіпсована подія не повинна валити решту
                # вебхука (Meta ретраїть non-200 відповіді — тут завжди 200).
                continue

    # Meta вимагає швидку відповідь 200, інакше повторюватиме доставку.
    return jsonify({'ok': True})

"""ARM CRM — самообслуговування менеджерів: підключення власного WhatsApp
Business Cloud API / Instagram Messaging до конкретного менеджера ('Manager 1'
= Миша, 'Manager 2' = Едуард — ті самі коди, що й у leads.owner).

Менеджер сам вводить свої Phone Number ID / IG User ID + Access Token з
власного Meta Business кабінету; ARM CRM зберігає їх (токен — зашифрований
тим самим at-rest шифруванням, що й повідомлення месенджера) і сам приймає
(webhook) та надсилає (Graph API) повідомлення від його імені.

Окремий, самодостатній блюпрінт: власна `_ensure_schema()`, як у
leads_routes.py/marketplace_routes.py, без змін до database.py/schema.sql.
"""
from __future__ import annotations

import hashlib
from typing import Any

from flask import Blueprint, jsonify, request

from ..config import SECRET_KEY
from ..database import get_connection, get_returning_id_suffix
from ..services.messenger_crypto import decrypt_message, encrypt_message
from ..services.meta_api import MetaApiError, verify_instagram_account, verify_whatsapp_number
from .helpers import api_error, auth_required, role_required

integrations_bp = Blueprint('integrations', __name__, url_prefix='/api/integrations')

_ADMIN_ROLES = ('admin', 'platform_admin')

MANAGERS: dict[str, str] = {'Manager 1': 'Менеджер Миша', 'Manager 2': 'Менеджер Едуард'}
CHANNELS = ('whatsapp', 'instagram')


def _now_sql() -> str:
    from ..config import USE_PG
    return 'NOW()' if USE_PG else 'CURRENT_TIMESTAMP'


def _ensure_schema() -> None:
    from ..config import USE_PG
    pk_sql = 'SERIAL PRIMARY KEY' if USE_PG else 'INTEGER PRIMARY KEY'
    now_sql = _now_sql()
    with get_connection() as conn:
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS manager_integrations (
                id {pk_sql},
                manager VARCHAR(20) NOT NULL,
                channel VARCHAR(20) NOT NULL,
                external_id VARCHAR(120) NOT NULL,
                access_token TEXT NOT NULL,
                display_label VARCHAR(200) NOT NULL DEFAULT '',
                status VARCHAR(20) NOT NULL DEFAULT 'connected',
                connected_at TIMESTAMP NOT NULL DEFAULT {now_sql},
                updated_at TIMESTAMP NOT NULL DEFAULT {now_sql},
                UNIQUE(manager, channel)
            )
            """
        )
        conn.execute(
            'CREATE INDEX IF NOT EXISTS idx_manager_integrations_lookup '
            'ON manager_integrations(channel, external_id)'
        )


def webhook_verify_token() -> str:
    """Детермінований, стабільний verify-token для Meta webhook handshake —
    похідний від SECRET_KEY, без окремого сховища/міграції."""
    return hashlib.sha256(f'{SECRET_KEY}:meta-webhook-verify'.encode('utf-8')).hexdigest()[:24]


def find_integration(conn, channel: str, external_id: str) -> dict[str, Any] | None:
    """Використовується вебхуком: за phone_number_id / ig_user_id з вхідної
    події визначає, якому менеджеру належить цей канал."""
    row = conn.execute(
        'SELECT * FROM manager_integrations WHERE channel = %s AND external_id = %s AND status = %s',
        (channel, external_id, 'connected'),
    ).fetchone()
    return dict(row) if row else None


def get_integration(conn, manager: str, channel: str) -> dict[str, Any] | None:
    row = conn.execute(
        'SELECT * FROM manager_integrations WHERE manager = %s AND channel = %s AND status = %s',
        (manager, channel, 'connected'),
    ).fetchone()
    return dict(row) if row else None


def _mask_token(token: str) -> str:
    plain = decrypt_message(token, fallback='')
    if not plain or len(plain) < 8:
        return '••••••••'
    return f'{plain[:4]}••••{plain[-4:]}'


def _row_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        'manager': row['manager'],
        'manager_label': MANAGERS.get(row['manager'], row['manager']),
        'channel': row['channel'],
        'external_id': row['external_id'],
        'display_label': row['display_label'],
        'status': row['status'],
        'token_preview': _mask_token(row['access_token']),
        'connected_at': str(row.get('connected_at') or ''),
    }


@integrations_bp.get('')
@integrations_bp.get('/')
@auth_required
@role_required(*_ADMIN_ROLES)
def list_integrations():
    _ensure_schema()
    with get_connection() as conn:
        rows = conn.execute('SELECT * FROM manager_integrations').fetchall()
    by_key = {(r['manager'], r['channel']): _row_payload(dict(r)) for r in (rows or [])}

    items = []
    for manager, manager_label in MANAGERS.items():
        for channel in CHANNELS:
            existing = by_key.get((manager, channel))
            if existing:
                items.append(existing)
            else:
                items.append({
                    'manager': manager,
                    'manager_label': manager_label,
                    'channel': channel,
                    'external_id': '',
                    'display_label': '',
                    'status': 'disconnected',
                    'token_preview': '',
                    'connected_at': '',
                })
    return jsonify({'ok': True, 'data': items})


@integrations_bp.get('/webhook-info')
@auth_required
@role_required(*_ADMIN_ROLES)
def webhook_info():
    # request.url_root reflects the internal gunicorn scheme/host, not the
    # public one, since ProxyFix isn't installed — same fix as passkey_routes._origin().
    fwd_proto = request.headers.get('X-Forwarded-Proto', request.scheme)
    host = request.headers.get('X-Forwarded-Host') or request.host
    base = f'{fwd_proto}://{host}'
    return jsonify({'ok': True, 'data': {
        'webhook_url': f'{base}{request.script_root}/api/webhooks/meta',
        'verify_token': webhook_verify_token(),
    }})


@integrations_bp.post('/whatsapp')
@auth_required
@role_required(*_ADMIN_ROLES)
def connect_whatsapp():
    _ensure_schema()
    body = request.get_json(silent=True) or {}
    manager = str(body.get('manager') or '').strip()
    phone_number_id = str(body.get('phone_number_id') or '').strip()
    access_token = str(body.get('access_token') or '').strip()

    if manager not in MANAGERS:
        return api_error('Невідомий менеджер.', 400)
    if not phone_number_id or not access_token:
        return api_error('Потрібні Phone Number ID та Access Token.', 400)

    try:
        info = verify_whatsapp_number(phone_number_id, access_token)
    except MetaApiError as exc:
        return api_error(f'Не вдалося підключити WhatsApp: {exc.message}', 400)

    display_label = info.get('verified_name') or info.get('display_phone_number') or phone_number_id
    _upsert(manager, 'whatsapp', phone_number_id, access_token, display_label)
    with get_connection() as conn:
        row = get_integration(conn, manager, 'whatsapp')
    return jsonify({'ok': True, 'data': _row_payload(row)})


@integrations_bp.post('/instagram')
@auth_required
@role_required(*_ADMIN_ROLES)
def connect_instagram():
    _ensure_schema()
    body = request.get_json(silent=True) or {}
    manager = str(body.get('manager') or '').strip()
    ig_user_id = str(body.get('ig_user_id') or '').strip()
    access_token = str(body.get('access_token') or '').strip()

    if manager not in MANAGERS:
        return api_error('Невідомий менеджер.', 400)
    if not ig_user_id or not access_token:
        return api_error('Потрібні Instagram User ID та Access Token.', 400)

    try:
        info = verify_instagram_account(ig_user_id, access_token)
    except MetaApiError as exc:
        return api_error(f'Не вдалося підключити Instagram: {exc.message}', 400)

    display_label = (f"@{info['username']}" if info.get('username') else '') or info.get('name') or ig_user_id
    _upsert(manager, 'instagram', ig_user_id, access_token, display_label)
    with get_connection() as conn:
        row = get_integration(conn, manager, 'instagram')
    return jsonify({'ok': True, 'data': _row_payload(row)})


def _upsert(manager: str, channel: str, external_id: str, access_token: str, display_label: str) -> None:
    encrypted = encrypt_message(access_token)
    with get_connection() as conn:
        existing = conn.execute(
            'SELECT id FROM manager_integrations WHERE manager = %s AND channel = %s',
            (manager, channel),
        ).fetchone()
        if existing:
            conn.execute(
                f"""
                UPDATE manager_integrations
                SET external_id = %s, access_token = %s, display_label = %s,
                    status = 'connected', updated_at = {_now_sql()}
                WHERE id = %s
                """,
                (external_id, encrypted, display_label, existing['id']),
            )
        else:
            conn.execute(
                'INSERT INTO manager_integrations '
                '(manager, channel, external_id, access_token, display_label, status) '
                "VALUES (%s, %s, %s, %s, %s, 'connected')"
                + get_returning_id_suffix(),
                (manager, channel, external_id, encrypted, display_label),
            )


@integrations_bp.delete('/<manager>/<channel>')
@auth_required
@role_required(*_ADMIN_ROLES)
def disconnect(manager: str, channel: str):
    _ensure_schema()
    if manager not in MANAGERS or channel not in CHANNELS:
        return api_error('Невідомий менеджер/канал.', 400)
    with get_connection() as conn:
        conn.execute(
            'DELETE FROM manager_integrations WHERE manager = %s AND channel = %s',
            (manager, channel),
        )
    return jsonify({'ok': True, 'data': {'manager': manager, 'channel': channel, 'status': 'disconnected'}})

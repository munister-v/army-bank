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

from flask import Blueprint, g, jsonify, request

from ..config import SECRET_KEY
from ..database import get_connection, get_returning_id_suffix
from ..services.messenger_crypto import decrypt_message, encrypt_message
from ..services.meta_api import MetaApiError, verify_instagram_account, verify_whatsapp_number
from .helpers import api_error, auth_required, role_required

integrations_bp = Blueprint('integrations', __name__, url_prefix='/api/integrations')

# Ролі з доступом до CRM (Інтеграції). 'manager' — CRM-менеджер без
# банківської адмінки (див. leads_routes._ADMIN_ROLES).
_ADMIN_ROLES = ('admin', 'platform_admin', 'manager')


def _forced_manager() -> str | None:
    """crm_owner поточного менеджера, або None для admin/platform_admin.

    Доступи (WhatsApp/Instagram-токени) належать конкретній людині — сторінка
    інтеграцій прямо це обіцяє. Без цієї перевірки будь-який менеджер бачив і
    міг відключити чужий канал."""
    user = getattr(g, 'current_user', None) or {}
    if user.get('role') != 'manager':
        return None
    return (user.get('crm_owner') or '').strip() or '\x00__unassigned__'


def _get_managers():
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT crm_owner, full_name FROM users "
            "WHERE crm_owner IS NOT NULL AND TRIM(crm_owner) <> ''"
        ).fetchall()
        return {r['crm_owner']: r['full_name'] for r in rows}

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
        # app_secret (Meta App Secret) — потрібен для перевірки підпису вхідних
        # вебхуків (X-Hub-Signature-256). Опційний: без нього вебхук продовжує
        # приймати повідомлення для цього підключення, але без криптографічної
        # гарантії, що вони справді від Meta, а не від когось, хто вгадав
        # phone_number_id/ig_user_id.
        # SQLite's ALTER TABLE ADD COLUMN has no IF NOT EXISTS clause (unlike
        # Postgres) — guard manually via PRAGMA table_info.
        if USE_PG:
            conn.execute('ALTER TABLE manager_integrations ADD COLUMN IF NOT EXISTS app_secret TEXT')
        else:
            existing_cols = {r['name'] for r in conn.execute('PRAGMA table_info(manager_integrations)').fetchall()}
            if 'app_secret' not in existing_cols:
                conn.execute('ALTER TABLE manager_integrations ADD COLUMN app_secret TEXT')

        # Дедуп вхідних подій вебхука: Meta повторно доставляє подію, якщо ми
        # не встигли відповісти 200 вчасно — без цього повторна доставка
        # створювала б дублікат повідомлення в чаті ліда.
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS webhook_seen_messages (
                message_id VARCHAR(120) PRIMARY KEY,
                created_at TIMESTAMP NOT NULL DEFAULT {now_sql}
            )
            """
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
        'manager_label': _get_managers().get(row['manager'], row['manager']),
        'channel': row['channel'],
        'external_id': row['external_id'],
        'display_label': row['display_label'],
        'status': row['status'],
        'token_preview': _mask_token(row['access_token']),
        'connected_at': str(row.get('connected_at') or ''),
        'signature_verified': bool(row.get('app_secret')),
    }


def get_app_secret(row: dict[str, Any]) -> str:
    return decrypt_message(row.get('app_secret') or '', fallback='')


def mark_message_seen(conn, message_id: str) -> bool:
    """Перевіряє й позначає подію оброблено. True — вперше (обробляти), False —
    вже бачили (Meta ретраїть недоставлені 200 — просто ігноруємо повторно).

    Check-then-insert замість INSERT + ловити UniqueViolation: у Postgres
    невіловлений constraint-error псує решту транзакції вебхука."""
    if not message_id:
        return True
    existing = conn.execute(
        'SELECT 1 FROM webhook_seen_messages WHERE message_id = %s', (message_id,)
    ).fetchone()
    if existing:
        return False
    conn.execute('INSERT INTO webhook_seen_messages (message_id) VALUES (%s)', (message_id,))
    return True


@integrations_bp.get('')
@integrations_bp.get('/')
@auth_required
@role_required(*_ADMIN_ROLES)
def list_integrations():
    _ensure_schema()
    with get_connection() as conn:
        rows = conn.execute('SELECT * FROM manager_integrations').fetchall()
    by_key = {(r['manager'], r['channel']): _row_payload(dict(r)) for r in (rows or [])}

    mine = _forced_manager()
    items = []
    for manager, manager_label in _get_managers().items():
        if mine is not None and manager != mine:
            continue
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
    mine = _forced_manager()
    if mine is not None:
        manager = mine          # менеджер підключає лише свій канал
    phone_number_id = str(body.get('phone_number_id') or '').strip()
    access_token = str(body.get('access_token') or '').strip()
    app_secret = str(body.get('app_secret') or '').strip()

    if manager not in _get_managers():
        return api_error('Невідомий менеджер.', 400)
    if not phone_number_id or not access_token:
        return api_error('Потрібні Phone Number ID та Access Token.', 400)

    try:
        info = verify_whatsapp_number(phone_number_id, access_token)
    except MetaApiError as exc:
        return api_error(f'Не вдалося підключити WhatsApp: {exc.message}', 400)

    display_label = info.get('verified_name') or info.get('display_phone_number') or phone_number_id
    _upsert(manager, 'whatsapp', phone_number_id, access_token, display_label, app_secret)
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
    mine = _forced_manager()
    if mine is not None:
        manager = mine          # менеджер підключає лише свій канал
    ig_user_id = str(body.get('ig_user_id') or '').strip()
    access_token = str(body.get('access_token') or '').strip()
    app_secret = str(body.get('app_secret') or '').strip()

    if manager not in _get_managers():
        return api_error('Невідомий менеджер.', 400)
    if not ig_user_id or not access_token:
        return api_error('Потрібні Instagram User ID та Access Token.', 400)

    try:
        info = verify_instagram_account(ig_user_id, access_token)
    except MetaApiError as exc:
        return api_error(f'Не вдалося підключити Instagram: {exc.message}', 400)

    display_label = (f"@{info['username']}" if info.get('username') else '') or info.get('name') or ig_user_id
    _upsert(manager, 'instagram', ig_user_id, access_token, display_label, app_secret)
    with get_connection() as conn:
        row = get_integration(conn, manager, 'instagram')
    return jsonify({'ok': True, 'data': _row_payload(row)})


def _upsert(manager: str, channel: str, external_id: str, access_token: str, display_label: str,
            app_secret: str = '') -> None:
    encrypted = encrypt_message(access_token)
    encrypted_secret = encrypt_message(app_secret) if app_secret else None
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
                    app_secret = %s, status = 'connected', updated_at = {_now_sql()}
                WHERE id = %s
                """,
                (external_id, encrypted, display_label, encrypted_secret, existing['id']),
            )
        else:
            conn.execute(
                'INSERT INTO manager_integrations '
                '(manager, channel, external_id, access_token, display_label, app_secret, status) '
                "VALUES (%s, %s, %s, %s, %s, %s, 'connected')"
                + get_returning_id_suffix(),
                (manager, channel, external_id, encrypted, display_label, encrypted_secret),
            )


@integrations_bp.post('/<manager>/<channel>/check')
@auth_required
@role_required(*_ADMIN_ROLES)
def check_connection(manager: str, channel: str):
    """Повторно перевіряє вже збережений токен реальним запитом до Meta —
    для випадку, коли токен протух (тимчасові токени живуть 24 год)."""
    _ensure_schema()
    if manager not in _get_managers() or channel not in CHANNELS:
        return api_error('Невідомий менеджер/канал.', 400)
    mine = _forced_manager()
    if mine is not None and manager != mine:
        return api_error('Це підключення належить іншому менеджеру.', 403)
    with get_connection() as conn:
        row = conn.execute(
            'SELECT * FROM manager_integrations WHERE manager = %s AND channel = %s',
            (manager, channel),
        ).fetchone()
    if not row:
        return api_error('Підключення не знайдено.', 404)
    row = dict(row)
    token = decrypt_message(row['access_token'], fallback='')

    try:
        if channel == 'whatsapp':
            info = verify_whatsapp_number(row['external_id'], token)
            display_label = info.get('verified_name') or info.get('display_phone_number') or row['external_id']
        else:
            info = verify_instagram_account(row['external_id'], token)
            display_label = (f"@{info['username']}" if info.get('username') else '') or info.get('name') or row['external_id']
    except MetaApiError as exc:
        with get_connection() as conn:
            conn.execute(
                f"UPDATE manager_integrations SET status = 'error', updated_at = {_now_sql()} "
                'WHERE manager = %s AND channel = %s',
                (manager, channel),
            )
        return api_error(f'Перевірка не пройшла: {exc.message}', 400)

    with get_connection() as conn:
        conn.execute(
            f"UPDATE manager_integrations SET display_label = %s, status = 'connected', updated_at = {_now_sql()} "
            'WHERE manager = %s AND channel = %s',
            (display_label, manager, channel),
        )
        updated = get_integration(conn, manager, channel)
    return jsonify({'ok': True, 'data': _row_payload(updated)})


@integrations_bp.delete('/<manager>/<channel>')
@auth_required
@role_required(*_ADMIN_ROLES)
def disconnect(manager: str, channel: str):
    _ensure_schema()
    if manager not in _get_managers() or channel not in CHANNELS:
        return api_error('Невідомий менеджер/канал.', 400)
    mine = _forced_manager()
    if mine is not None and manager != mine:
        return api_error('Це підключення належить іншому менеджеру.', 403)
    with get_connection() as conn:
        conn.execute(
            'DELETE FROM manager_integrations WHERE manager = %s AND channel = %s',
            (manager, channel),
        )
    return jsonify({'ok': True, 'data': {'manager': manager, 'channel': channel, 'status': 'disconnected'}})

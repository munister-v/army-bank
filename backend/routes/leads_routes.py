"""ARM CRM — маршрути для роботи з лідами (sales/outreach pipeline).

Окремий, самодостатній блюпрінт: власна `_ensure_schema()`, як у
marketplace_routes.py, без змін до database.py/schema.sql.
"""
from __future__ import annotations

import csv
import io
import math
from datetime import date
from typing import Any

from flask import Blueprint, Response, g, jsonify, request

from ..database import get_connection, get_returning_id_suffix, insert_last_id
from ..services.messenger_crypto import encrypt_message
from .helpers import api_error, auth_required, role_required

leads_bp = Blueprint('leads', __name__, url_prefix='/api/leads')

_ADMIN_ROLES = ('admin', 'platform_admin')

# Поля, які менеджер/адмін реально редагує з UI (решта — імпортовані дані).
_EDITABLE_FIELDS = (
    'owner', 'pipeline', 'stage', 'outreach_status', 'priority',
    'next_followup_date', 'last_touch_date', 'reply_status',
    'crm_record_id', 'sync_status', 'notes', 'manager_private_notes',
)

_COLUMNS = (
    'id', 'lead_id', 'source_bucket', 'source_row_id', 'business_name', 'category',
    'country', 'city_area', 'opening_window', 'opening_date', 'status_source',
    'website_signal', 'website_url', 'primary_channel', 'phone', 'whatsapp_viber',
    'email', 'instagram', 'facebook_other_social', 'messenger_note', 'source_url',
    'priority', 'lead_score', 'contact_quality', 'owner', 'pipeline', 'stage',
    'outreach_status', 'last_touch_date', 'next_followup_date', 'followup_count',
    'reply_status', 'need_type', 'suggested_first_offer', 'why_help_fits',
    'first_message_en', 'notes', 'crm_record_id', 'sync_status', 'duplicate_key',
    'data_quality_check', 'last_file_update', 'manager_private_notes',
    'created_at', 'updated_at',
)


def insertable_cols_for_import() -> list[str]:
    """Колонки для INSERT/UPDATE при імпорті (усе, крім id/created_at/updated_at)."""
    return [c for c in _COLUMNS if c not in ('id', 'created_at', 'updated_at')]


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
            CREATE TABLE IF NOT EXISTS leads (
                id {pk_sql},
                lead_id VARCHAR(20) UNIQUE NOT NULL,
                source_bucket VARCHAR(80) NOT NULL DEFAULT '',
                source_row_id VARCHAR(20) NOT NULL DEFAULT '',
                business_name VARCHAR(200) NOT NULL,
                category VARCHAR(120) NOT NULL DEFAULT '',
                country VARCHAR(80) NOT NULL DEFAULT '',
                city_area VARCHAR(120) NOT NULL DEFAULT '',
                opening_window VARCHAR(40) NOT NULL DEFAULT '',
                opening_date VARCHAR(40),
                status_source VARCHAR(60) NOT NULL DEFAULT '',
                website_signal VARCHAR(60) NOT NULL DEFAULT '',
                website_url TEXT,
                primary_channel VARCHAR(60) NOT NULL DEFAULT '',
                phone VARCHAR(60),
                whatsapp_viber VARCHAR(60),
                email TEXT,
                instagram VARCHAR(120),
                facebook_other_social TEXT,
                messenger_note VARCHAR(120) NOT NULL DEFAULT '',
                source_url TEXT,
                priority VARCHAR(20) NOT NULL DEFAULT 'Medium',
                lead_score INTEGER NOT NULL DEFAULT 0,
                contact_quality VARCHAR(20) NOT NULL DEFAULT '',
                owner VARCHAR(80) NOT NULL DEFAULT '',
                pipeline VARCHAR(80) NOT NULL DEFAULT 'Opening leads',
                stage VARCHAR(40) NOT NULL DEFAULT 'New',
                outreach_status VARCHAR(60) NOT NULL DEFAULT 'Not contacted',
                last_touch_date VARCHAR(40),
                next_followup_date VARCHAR(40),
                followup_count INTEGER NOT NULL DEFAULT 0,
                reply_status VARCHAR(60) NOT NULL DEFAULT 'No reply yet',
                need_type VARCHAR(120) NOT NULL DEFAULT '',
                suggested_first_offer TEXT,
                why_help_fits TEXT,
                first_message_en TEXT,
                notes TEXT,
                crm_record_id VARCHAR(80),
                sync_status VARCHAR(40) NOT NULL DEFAULT 'Ready',
                duplicate_key TEXT UNIQUE,
                data_quality_check VARCHAR(40) NOT NULL DEFAULT '',
                last_file_update VARCHAR(40),
                manager_private_notes TEXT,
                created_at TIMESTAMP NOT NULL DEFAULT {now_sql},
                updated_at TIMESTAMP NOT NULL DEFAULT {now_sql}
            )
            """
        )
        conn.execute('CREATE INDEX IF NOT EXISTS idx_leads_owner ON leads(owner)')
        conn.execute('CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage)')
        conn.execute('CREATE INDEX IF NOT EXISTS idx_leads_pipeline ON leads(pipeline)')
        conn.execute('CREATE INDEX IF NOT EXISTS idx_leads_priority ON leads(priority)')

        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS lead_activity (
                id {pk_sql},
                lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
                author VARCHAR(80) NOT NULL DEFAULT '',
                kind VARCHAR(20) NOT NULL DEFAULT 'note',
                text TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMP NOT NULL DEFAULT {now_sql}
            )
            """
        )
        conn.execute('CREATE INDEX IF NOT EXISTS idx_lead_activity_lead ON lead_activity(lead_id, created_at)')


def _require_admin():
    """403 якщо не адмін; повертає поточного користувача інакше."""
    user = getattr(g, 'current_user', None)
    if not user or user.get('role') not in _ADMIN_ROLES:
        return None
    return user


def _row_to_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {col: row.get(col) for col in _COLUMNS}


def _build_leads_filter() -> tuple[str, list]:
    """Читає owner/stage/pipeline/priority/search з query-параметрів запиту
    та повертає (WHERE ..., params) — спільне для list/export."""
    owner = (request.args.get('owner') or '').strip()
    stage = (request.args.get('stage') or '').strip()
    pipeline = (request.args.get('pipeline') or '').strip()
    priority = (request.args.get('priority') or '').strip()
    search = (request.args.get('search') or '').strip()
    due_today = request.args.get('due_today') in ('1', 'true', 'yes')

    where = []
    params: list = []
    if owner:
        where.append('owner = %s')
        params.append(owner)
    if stage:
        where.append('stage = %s')
        params.append(stage)
    if pipeline:
        where.append('pipeline = %s')
        params.append(pipeline)
    if priority:
        where.append('priority = %s')
        params.append(priority)
    if due_today:
        where.append("next_followup_date IS NOT NULL AND next_followup_date != '' AND next_followup_date <= %s")
        params.append(date.today().isoformat())
    if search:
        where.append(
            '(business_name ILIKE %s OR category ILIKE %s OR city_area ILIKE %s OR country ILIKE %s)'
            if _use_pg() else
            '(business_name LIKE %s OR category LIKE %s OR city_area LIKE %s OR country LIKE %s)'
        )
        like = f'%{search}%'
        params.extend([like, like, like, like])
    where_sql = ('WHERE ' + ' AND '.join(where)) if where else ''
    return where_sql, params


@leads_bp.get('')
@leads_bp.get('/')
@auth_required
@role_required(*_ADMIN_ROLES)
def list_leads():
    _ensure_schema()
    page = max(1, int(request.args.get('page') or 1))
    per_page = min(200, max(1, int(request.args.get('per_page') or 50)))
    offset = (page - 1) * per_page
    where_sql, params = _build_leads_filter()

    with get_connection() as conn:
        total = (conn.execute(
            f'SELECT COUNT(*) AS n FROM leads {where_sql}', params
        ).fetchone() or {}).get('n') or 0
        rows = conn.execute(
            f"""
            SELECT * FROM leads {where_sql}
            ORDER BY lead_score DESC, id ASC
            LIMIT %s OFFSET %s
            """,
            params + [per_page, offset],
        ).fetchall()

    # NB: the messenger frontend's api() helper unwraps the top-level 'data'
    # field only, so pagination must be nested inside 'data' to survive that.
    return jsonify({
        'ok': True,
        'data': {
            'items': [_row_to_payload(dict(r)) for r in (rows or [])],
            'page': page, 'per_page': per_page, 'total': int(total),
            'pages': max(1, math.ceil(int(total) / per_page)),
        },
    })


def _use_pg() -> bool:
    from ..config import USE_PG
    return USE_PG


@leads_bp.get('/stats')
@auth_required
@role_required(*_ADMIN_ROLES)
def leads_stats():
    _ensure_schema()
    with get_connection() as conn:
        total = (conn.execute('SELECT COUNT(*) AS n FROM leads').fetchone() or {}).get('n') or 0
        by_owner = conn.execute(
            'SELECT owner, COUNT(*) AS n FROM leads GROUP BY owner ORDER BY owner'
        ).fetchall()
        by_stage = conn.execute(
            'SELECT stage, COUNT(*) AS n FROM leads GROUP BY stage ORDER BY n DESC'
        ).fetchall()
        by_priority = conn.execute(
            'SELECT priority, COUNT(*) AS n FROM leads GROUP BY priority ORDER BY n DESC'
        ).fetchall()
        by_channel = conn.execute(
            'SELECT primary_channel, COUNT(*) AS n FROM leads GROUP BY primary_channel ORDER BY n DESC'
        ).fetchall()
        not_contacted = (conn.execute(
            "SELECT COUNT(*) AS n FROM leads WHERE outreach_status = 'Not contacted'"
        ).fetchone() or {}).get('n') or 0
        due_today = (conn.execute(
            "SELECT COUNT(*) AS n FROM leads WHERE next_followup_date IS NOT NULL "
            "AND next_followup_date != '' AND next_followup_date <= %s",
            (date.today().isoformat(),),
        ).fetchone() or {}).get('n') or 0

    return jsonify({'ok': True, 'data': {
        'total': int(total),
        'not_contacted': int(not_contacted),
        'due_today': int(due_today),
        'by_owner': [{'owner': r['owner'], 'count': int(r['n'])} for r in (by_owner or [])],
        'by_stage': [{'stage': r['stage'], 'count': int(r['n'])} for r in (by_stage or [])],
        'by_priority': [{'priority': r['priority'], 'count': int(r['n'])} for r in (by_priority or [])],
        'by_channel': [{'channel': r['primary_channel'], 'count': int(r['n'])} for r in (by_channel or [])],
    }})


@leads_bp.get('/<int:lead_id>')
@auth_required
@role_required(*_ADMIN_ROLES)
def get_lead(lead_id: int):
    _ensure_schema()
    with get_connection() as conn:
        row = conn.execute('SELECT * FROM leads WHERE id = %s', (lead_id,)).fetchone()
    if not row:
        return api_error('Лід не знайдено.', 404)
    return jsonify({'ok': True, 'data': _row_to_payload(dict(row))})


_SYSTEM_TRACKED_FIELDS = {
    'stage': 'Стадія',
    'owner': 'Власник',
    'priority': 'Пріоритет',
    'outreach_status': 'Статус контакту',
}


def _log_activity(conn, lead_id: int, author: str, kind: str, text: str) -> None:
    conn.execute(
        'INSERT INTO lead_activity (lead_id, author, kind, text) VALUES (%s, %s, %s, %s)',
        (lead_id, author, kind, text),
    )


def _get_or_create_lead_conversation(conn, lead_id: int, actor_user_id: int) -> int:
    """Знаходить або створює `conversations`-рядок, привʼязаний до ліда, і
    гарантує, що actor_user_id є учасником (auto-join, ідемпотентно)."""
    from ..config import USE_PG
    row = conn.execute('SELECT id FROM conversations WHERE lead_id = %s', (lead_id,)).fetchone()
    if row:
        conv_id = int(row['id'])
    else:
        lead = conn.execute('SELECT business_name FROM leads WHERE id = %s', (lead_id,)).fetchone()
        group_name = str((lead or {}).get('business_name') or 'Лід')
        _true = True if USE_PG else 1
        cur = conn.execute(
            'INSERT INTO conversations (lead_id, is_group, group_name) VALUES (%s, %s, %s)'
            + get_returning_id_suffix(),
            (lead_id, _true, group_name),
        )
        conv_id = int(insert_last_id(cur))

    already = conn.execute(
        'SELECT id FROM conversation_participants WHERE conversation_id = %s AND user_id = %s',
        (conv_id, actor_user_id),
    ).fetchone()
    if not already:
        conn.execute(
            'INSERT INTO conversation_participants (conversation_id, user_id) VALUES (%s, %s)',
            (conv_id, actor_user_id),
        )
    return conv_id


@leads_bp.patch('/<int:lead_id>')
@auth_required
@role_required(*_ADMIN_ROLES)
def update_lead(lead_id: int):
    _ensure_schema()
    body = request.get_json(silent=True) or {}
    updates = {k: v for k, v in body.items() if k in _EDITABLE_FIELDS}
    if not updates:
        return api_error('Немає полів для оновлення.', 400)

    author = str(g.current_user.get('full_name') or 'Адмін')
    set_sql = ', '.join(f'{k} = %s' for k in updates)
    params = list(updates.values())
    with get_connection() as conn:
        existing = conn.execute('SELECT * FROM leads WHERE id = %s', (lead_id,)).fetchone()
        if not existing:
            return api_error('Лід не знайдено.', 404)
        existing = dict(existing)
        conn.execute(
            f'UPDATE leads SET {set_sql}, updated_at = {_now_sql()} WHERE id = %s',
            params + [lead_id],
        )
        changed_lines = []
        for field, label in _SYSTEM_TRACKED_FIELDS.items():
            if field in updates and str(updates[field] or '') != str(existing.get(field) or ''):
                old_val = existing.get(field) or '—'
                new_val = updates[field] or '—'
                line = f'{label}: {old_val} → {new_val}'
                _log_activity(conn, lead_id, author, 'system', line)
                changed_lines.append(line)
        if changed_lines:
            conv_id = _get_or_create_lead_conversation(conn, lead_id, g.current_user['id'])
            msg_text = '\n'.join(changed_lines)
            conn.execute(
                'INSERT INTO messages (conversation_id, sender_id, text, msg_type) VALUES (%s, %s, %s, %s)',
                (conv_id, g.current_user['id'], encrypt_message(msg_text), 'text'),
            )
            conn.execute(
                f'UPDATE conversations SET last_message_at = {_now_sql()}, last_message_text = %s WHERE id = %s',
                (msg_text[:180], conv_id),
            )
        row = conn.execute('SELECT * FROM leads WHERE id = %s', (lead_id,)).fetchone()
    return jsonify({'ok': True, 'data': _row_to_payload(dict(row))})


@leads_bp.get('/<int:lead_id>/conversation')
@auth_required
@role_required(*_ADMIN_ROLES)
def get_lead_conversation(lead_id: int):
    """Повертає id реальної розмови месенджера, привʼязаної до ліда
    (створює за потреби) і приєднує поточного адміна до неї."""
    _ensure_schema()
    with get_connection() as conn:
        lead = conn.execute('SELECT id FROM leads WHERE id = %s', (lead_id,)).fetchone()
        if not lead:
            return api_error('Лід не знайдено.', 404)
        conv_id = _get_or_create_lead_conversation(conn, lead_id, g.current_user['id'])
    return jsonify({'ok': True, 'data': {'conversation_id': conv_id}})


@leads_bp.get('/<int:lead_id>/activity')
@auth_required
@role_required(*_ADMIN_ROLES)
def list_lead_activity(lead_id: int):
    _ensure_schema()
    with get_connection() as conn:
        lead = conn.execute('SELECT id FROM leads WHERE id = %s', (lead_id,)).fetchone()
        if not lead:
            return api_error('Лід не знайдено.', 404)
        rows = conn.execute(
            'SELECT * FROM lead_activity WHERE lead_id = %s ORDER BY id ASC',
            (lead_id,),
        ).fetchall()
    return jsonify({'ok': True, 'data': [
        {'id': r['id'], 'author': r['author'], 'kind': r['kind'], 'text': r['text'], 'created_at': r['created_at']}
        for r in (rows or [])
    ]})


@leads_bp.post('/<int:lead_id>/activity')
@auth_required
@role_required(*_ADMIN_ROLES)
def add_lead_activity(lead_id: int):
    _ensure_schema()
    body = request.get_json(silent=True) or {}
    text = str(body.get('text') or '').strip()
    if not text:
        return api_error("Текст обов'язковий.", 400)
    author = str(g.current_user.get('full_name') or 'Адмін')
    with get_connection() as conn:
        lead = conn.execute('SELECT id FROM leads WHERE id = %s', (lead_id,)).fetchone()
        if not lead:
            return api_error('Лід не знайдено.', 404)
        _log_activity(conn, lead_id, author, 'note', text)
        conn.execute(
            f'UPDATE leads SET last_touch_date = %s, updated_at = {_now_sql()} WHERE id = %s',
            (date.today().isoformat(), lead_id),
        )
        rows = conn.execute(
            'SELECT * FROM lead_activity WHERE lead_id = %s ORDER BY id ASC',
            (lead_id,),
        ).fetchall()
    return jsonify({'ok': True, 'data': [
        {'id': r['id'], 'author': r['author'], 'kind': r['kind'], 'text': r['text'], 'created_at': r['created_at']}
        for r in (rows or [])
    ]})


@leads_bp.post('/import')
@auth_required
@role_required(*_ADMIN_ROLES)
def import_leads():
    """Bulk upsert за duplicate_key/lead_id. Використовується скриптом імпорту
    та може повторно викликатись без дублювання записів (idempotent)."""
    _ensure_schema()
    body = request.get_json(silent=True) or {}
    items = body.get('leads') or []
    if not isinstance(items, list) or not items:
        return api_error('Порожній список leads.', 400)

    insertable_cols = insertable_cols_for_import()
    created = 0
    updated = 0
    with get_connection() as conn:
        for item in items:
            lead_id = item.get('lead_id')
            if not lead_id:
                continue
            existing = conn.execute(
                'SELECT id FROM leads WHERE lead_id = %s', (lead_id,)
            ).fetchone()
            values = [item.get(c) for c in insertable_cols]
            if existing:
                set_sql = ', '.join(f'{c} = %s' for c in insertable_cols)
                conn.execute(
                    f'UPDATE leads SET {set_sql}, updated_at = {_now_sql()} WHERE lead_id = %s',
                    values + [lead_id],
                )
                updated += 1
            else:
                cols_sql = ', '.join(insertable_cols)
                placeholders = ', '.join(['%s'] * len(insertable_cols))
                conn.execute(
                    f'INSERT INTO leads ({cols_sql}) VALUES ({placeholders})'
                    + get_returning_id_suffix(),
                    values,
                )
                created += 1

    return jsonify({'ok': True, 'data': {'created': created, 'updated': updated}})


def _next_lead_id(conn) -> str:
    """Наступний CRM-XXXX з урахуванням найбільшого існуючого номера."""
    rows = conn.execute("SELECT lead_id FROM leads WHERE lead_id LIKE 'CRM-%'").fetchall()
    max_n = 0
    for r in (rows or []):
        raw = str(r['lead_id'] or '')
        suffix = raw.split('-', 1)[-1]
        if suffix.isdigit():
            max_n = max(max_n, int(suffix))
    return f'CRM-{max_n + 1:04d}'


_CREATE_REQUIRED = ('business_name',)
_CREATE_FIELDS = (
    'business_name', 'category', 'country', 'city_area', 'owner', 'pipeline',
    'stage', 'priority', 'outreach_status', 'phone', 'whatsapp_viber', 'email',
    'instagram', 'website_url', 'source_url', 'need_type', 'notes',
)


@leads_bp.post('')
@leads_bp.post('/')
@auth_required
@role_required(*_ADMIN_ROLES)
def create_lead():
    """Ручне створення ліда з UI (на відміну від /import — масового)."""
    _ensure_schema()
    body = request.get_json(silent=True) or {}
    for field in _CREATE_REQUIRED:
        if not str(body.get(field) or '').strip():
            return api_error(f"Поле '{field}' обов'язкове.", 400)

    data = {k: body.get(k) for k in _CREATE_FIELDS if body.get(k) not in (None, '')}
    data.setdefault('pipeline', 'Opening leads')
    data.setdefault('stage', 'New')
    data.setdefault('priority', 'Medium')
    data.setdefault('outreach_status', 'Not contacted')

    with get_connection() as conn:
        lead_id = _next_lead_id(conn)
        data['lead_id'] = lead_id
        cols = list(data.keys())
        cols_sql = ', '.join(cols)
        placeholders = ', '.join(['%s'] * len(cols))
        cur = conn.execute(
            f'INSERT INTO leads ({cols_sql}) VALUES ({placeholders})' + get_returning_id_suffix(),
            [data[c] for c in cols],
        )
        new_id = insert_last_id(cur)
        author = str(g.current_user.get('full_name') or 'Адмін')
        _log_activity(conn, new_id, author, 'system', 'Лід створено вручну')
        row = conn.execute('SELECT * FROM leads WHERE id = %s', (new_id,)).fetchone()

    return jsonify({'ok': True, 'data': _row_to_payload(dict(row))})


@leads_bp.get('/export')
@auth_required
@role_required(*_ADMIN_ROLES)
def export_leads():
    """CSV-експорт з тими самими owner/stage/pipeline/priority/search
    фільтрами, що й список — без пагінації (усі співпадіння)."""
    _ensure_schema()
    where_sql, params = _build_leads_filter()
    with get_connection() as conn:
        rows = conn.execute(
            f'SELECT * FROM leads {where_sql} ORDER BY lead_score DESC, id ASC',
            params,
        ).fetchall()

    export_cols = [c for c in _COLUMNS if c not in ('id',)]
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(export_cols)
    for r in (rows or []):
        row = dict(r)
        writer.writerow([row.get(c) if row.get(c) is not None else '' for c in export_cols])

    return Response(
        buf.getvalue(),
        mimetype='text/csv',
        headers={'Content-Disposition': 'attachment; filename="leads_export.csv"'},
    )

"""ARM CRM — маршрути для роботи з лідами (sales/outreach pipeline).

Окремий, самодостатній блюпрінт: власна `_ensure_schema()`, як у
marketplace_routes.py, без змін до database.py/schema.sql.
"""
from __future__ import annotations

import math
from typing import Any

from flask import Blueprint, g, jsonify, request

from ..database import get_connection, get_returning_id_suffix, insert_last_id
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


def _require_admin():
    """403 якщо не адмін; повертає поточного користувача інакше."""
    user = getattr(g, 'current_user', None)
    if not user or user.get('role') not in _ADMIN_ROLES:
        return None
    return user


def _row_to_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {col: row.get(col) for col in _COLUMNS}


@leads_bp.get('')
@leads_bp.get('/')
@auth_required
@role_required(*_ADMIN_ROLES)
def list_leads():
    _ensure_schema()
    owner = (request.args.get('owner') or '').strip()
    stage = (request.args.get('stage') or '').strip()
    pipeline = (request.args.get('pipeline') or '').strip()
    priority = (request.args.get('priority') or '').strip()
    search = (request.args.get('search') or '').strip()
    page = max(1, int(request.args.get('page') or 1))
    per_page = min(200, max(1, int(request.args.get('per_page') or 50)))
    offset = (page - 1) * per_page

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
    if search:
        where.append(
            '(business_name ILIKE %s OR category ILIKE %s OR city_area ILIKE %s OR country ILIKE %s)'
            if _use_pg() else
            '(business_name LIKE %s OR category LIKE %s OR city_area LIKE %s OR country LIKE %s)'
        )
        like = f'%{search}%'
        params.extend([like, like, like, like])
    where_sql = ('WHERE ' + ' AND '.join(where)) if where else ''

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

    return jsonify({'ok': True, 'data': {
        'total': int(total),
        'not_contacted': int(not_contacted),
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


@leads_bp.patch('/<int:lead_id>')
@auth_required
@role_required(*_ADMIN_ROLES)
def update_lead(lead_id: int):
    _ensure_schema()
    body = request.get_json(silent=True) or {}
    updates = {k: v for k, v in body.items() if k in _EDITABLE_FIELDS}
    if not updates:
        return api_error('Немає полів для оновлення.', 400)

    set_sql = ', '.join(f'{k} = %s' for k in updates)
    params = list(updates.values())
    with get_connection() as conn:
        existing = conn.execute('SELECT id FROM leads WHERE id = %s', (lead_id,)).fetchone()
        if not existing:
            return api_error('Лід не знайдено.', 404)
        conn.execute(
            f'UPDATE leads SET {set_sql}, updated_at = {_now_sql()} WHERE id = %s',
            params + [lead_id],
        )
        row = conn.execute('SELECT * FROM leads WHERE id = %s', (lead_id,)).fetchone()
    return jsonify({'ok': True, 'data': _row_to_payload(dict(row))})


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

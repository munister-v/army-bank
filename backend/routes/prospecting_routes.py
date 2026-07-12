"""ARM CRM — конструктор пошуку потенційних клієнтів (prospecting).

Менеджер шукає бізнеси по світу за категорією/локацією/квaліфікаторами
(джерело — OpenStreetMap, див. prospecting_service.py), переглядає кандидатів
із сигналами «чому гарячий / що пропонувати», і додає обраних у свою роботу
(масове створення лідів з дедупом проти вже наявних).
"""
from __future__ import annotations

import re

from flask import Blueprint, g, jsonify, request

from ..database import get_connection, get_returning_id_suffix, insert_last_id
from ..services import prospecting_service
from ..services.prospecting_categories import CATEGORIES, QUALIFIERS
from ..services.prospecting_service import ProspectingError
from .helpers import api_error, auth_required, role_required
from .leads_routes import _ensure_schema as _ensure_leads_schema
from .leads_routes import _log_activity, _next_lead_id

prospecting_bp = Blueprint('prospecting', __name__, url_prefix='/api/prospecting')

_ADMIN_ROLES = ('admin', 'platform_admin')
_MANAGERS = ('Manager 1', 'Manager 2')


@prospecting_bp.get('/categories')
@auth_required
@role_required(*_ADMIN_ROLES)
def list_categories():
    """Словник категорій + квaліфікаторів для конструктора в UI."""
    return jsonify({'ok': True, 'data': {
        'categories': [{'key': k, 'label': v['label']} for k, v in CATEGORIES.items()],
        'qualifiers': [{'key': k, 'label': v['label'], 'offer': v['offer']} for k, v in QUALIFIERS.items()],
    }})


@prospecting_bp.post('/search')
@auth_required
@role_required(*_ADMIN_ROLES)
def search():
    body = request.get_json(silent=True) or {}
    category_key = str(body.get('category_key') or '').strip()
    country = str(body.get('country') or '').strip()
    city = str(body.get('city') or '').strip()
    qualifiers = body.get('qualifiers') or []
    limit = body.get('limit') or 30
    recent_months = body.get('recent_months') or 0

    if not category_key:
        return api_error('Оберіть категорію.', 400)
    if not country:
        return api_error('Вкажіть країну.', 400)
    if not isinstance(qualifiers, list):
        qualifiers = []

    try:
        result = prospecting_service.search_businesses(
            category_key, country, city, [str(q) for q in qualifiers],
            int(limit), int(recent_months),
        )
    except ProspectingError as exc:
        return api_error(exc.message, 502)

    return jsonify({'ok': True, 'data': result})


def _normalize_phone(phone: str) -> str:
    return re.sub(r'[^\d]', '', phone or '')


def _domain(url: str) -> str:
    if not url:
        return ''
    m = re.search(r'https?://(?:www\.)?([^/]+)', url.strip(), re.IGNORECASE)
    return (m.group(1).lower() if m else url.strip().lower())


def _find_duplicate(conn, *, phone: str, website: str, name: str, city: str) -> bool:
    """Чи вже є в базі лід, схожий на цього кандидата? Дедуп у порядку
    надійності сигналу: телефон → домен сайту → назва+місто."""
    norm_phone = _normalize_phone(phone)
    if norm_phone and len(norm_phone) >= 7:
        rows = conn.execute("SELECT phone, whatsapp_viber FROM leads WHERE phone != '' OR whatsapp_viber != ''").fetchall()
        for r in (rows or []):
            r = dict(r)
            if _normalize_phone(r.get('phone')) == norm_phone or _normalize_phone(r.get('whatsapp_viber')) == norm_phone:
                return True

    dom = _domain(website)
    if dom:
        rows = conn.execute("SELECT website_url FROM leads WHERE website_url != ''").fetchall()
        for r in (rows or []):
            if _domain(dict(r).get('website_url')) == dom:
                return True

    name_l = (name or '').strip().lower()
    city_l = (city or '').strip().lower()
    if name_l:
        row = conn.execute(
            'SELECT id FROM leads WHERE LOWER(business_name) = %s AND LOWER(COALESCE(city_area, %s)) = %s LIMIT 1',
            (name_l, '', city_l),
        ).fetchone()
        if row:
            return True
    return False


@prospecting_bp.post('/import')
@auth_required
@role_required(*_ADMIN_ROLES)
def import_candidates():
    """Масово додає обраних кандидатів у роботу як лідів, пропускаючи дублікати."""
    _ensure_leads_schema()
    body = request.get_json(silent=True) or {}
    candidates = body.get('candidates') or []
    owner = str(body.get('owner') or '').strip()

    if owner not in _MANAGERS:
        return api_error('Оберіть менеджера-власника.', 400)
    if not isinstance(candidates, list) or not candidates:
        return api_error('Немає кандидатів для додавання.', 400)

    author = str(g.current_user.get('full_name') or 'Адмін')
    created = 0
    skipped = 0
    created_ids = []

    with get_connection() as conn:
        for cand in candidates[:100]:
            if not isinstance(cand, dict):
                continue
            name = str(cand.get('business_name') or '').strip()
            if not name:
                skipped += 1
                continue
            phone = str(cand.get('phone') or '').strip()
            website = str(cand.get('website_url') or '').strip()
            city = str(cand.get('city_area') or '').strip()

            if _find_duplicate(conn, phone=phone, website=website, name=name, city=city):
                skipped += 1
                continue

            data = {
                'lead_id': _next_lead_id(conn),
                'business_name': name,
                'category': str(cand.get('category') or ''),
                'country': str(cand.get('country') or ''),
                'city_area': city,
                'phone': phone,
                'website_url': website,
                'email': str(cand.get('email') or ''),
                'instagram': str(cand.get('instagram') or ''),
                'source_url': str(cand.get('source_url') or ''),
                'suggested_first_offer': str(cand.get('suggested_first_offer') or ''),
                'source_bucket': 'prospecting_osm',
                'messenger_note': 'Знайдено через пошук клієнтів (OSM)',
                'owner': owner,
                'pipeline': 'Prospecting',
                'stage': 'New',
                'priority': 'Medium',
                'outreach_status': 'Not contacted',
            }
            cols = list(data.keys())
            placeholders = ', '.join(['%s'] * len(cols))
            cur = conn.execute(
                f"INSERT INTO leads ({', '.join(cols)}) VALUES ({placeholders})" + get_returning_id_suffix(),
                [data[c] for c in cols],
            )
            new_id = int(insert_last_id(cur))
            _log_activity(conn, new_id, author, 'system', f'Додано через пошук клієнтів (OSM), власник: {owner}')
            created_ids.append(new_id)
            created += 1

    return jsonify({'ok': True, 'data': {'created': created, 'skipped': skipped, 'created_ids': created_ids}})

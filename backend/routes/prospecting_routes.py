"""ARM CRM — конструктор пошуку потенційних клієнтів (prospecting).

Менеджер шукає бізнеси по світу за категорією/локацією/квaліфікаторами
(джерело — OpenStreetMap, див. prospecting_service.py), переглядає кандидатів
із сигналами «чому гарячий / що пропонувати», і додає обраних у свою роботу
(масове створення лідів з дедупом проти вже наявних).
"""
from __future__ import annotations

import json
import re

from flask import Blueprint, g, jsonify, request

from ..database import get_connection, get_returning_id_suffix, insert_last_id
from ..services import google_search_service, prospecting_service
from ..services.google_search_service import GoogleSearchError
from ..services.prospecting_categories import CATEGORIES, QUALIFIERS
from ..services.prospecting_service import ProspectingError
from .helpers import api_error, auth_required, role_required
from .leads_routes import _ensure_schema as _ensure_leads_schema
from .leads_routes import _log_activity, _next_lead_id

prospecting_bp = Blueprint('prospecting', __name__, url_prefix='/api/prospecting')

_ADMIN_ROLES = ('admin', 'platform_admin')
_MANAGERS = ('Manager 1', 'Manager 2')


def _ensure_prospecting_schema() -> None:
    """Окрема, самодостатня таблиця збережених пошуків — той самий патерн
    self-contained _ensure_schema(), що й у leads_routes.py, без змін до
    database.py. `params` — JSON-блоб усього payload'у форми пошуку (щоб
    один клік «Завантажити» відновлював джерело + всі фільтри як є)."""
    from ..config import USE_PG
    pk_sql = 'SERIAL PRIMARY KEY' if USE_PG else 'INTEGER PRIMARY KEY'
    now_sql = 'NOW()' if USE_PG else 'CURRENT_TIMESTAMP'
    with get_connection() as conn:
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS prospecting_saved_searches (
                id {pk_sql},
                name VARCHAR(120) NOT NULL,
                source VARCHAR(20) NOT NULL DEFAULT 'osm',
                params TEXT NOT NULL DEFAULT '{{}}',
                created_by VARCHAR(80) NOT NULL DEFAULT '',
                created_at TIMESTAMP NOT NULL DEFAULT {now_sql}
            )
            """
        )
        conn.execute('CREATE INDEX IF NOT EXISTS idx_prosp_saved_created ON prospecting_saved_searches(created_at)')


@prospecting_bp.get('/categories')
@auth_required
@role_required(*_ADMIN_ROLES)
def list_categories():
    """Словник категорій + квaліфікаторів для конструктора в UI."""
    return jsonify({'ok': True, 'data': {
        'categories': [{'key': k, 'label': v['label']} for k, v in CATEGORIES.items()],
        'qualifiers': [{'key': k, 'label': v['label'], 'offer': v['offer']} for k, v in QUALIFIERS.items()],
        'google_configured': google_search_service.is_configured(),
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


@prospecting_bp.post('/search-google')
@auth_required
@role_required(*_ADMIN_ROLES)
def search_google():
    """Другий канал пошуку — Google Custom Search. На відміну від /search
    (OSM, структурований реєстр бізнесів), тут повертаються веб-сторінки за
    запитом: корисно там, де покриття OSM слабке, або щоб перевірити, чи
    бізнес взагалі присутній онлайн поза власним сайтом."""
    body = request.get_json(silent=True) or {}
    category_key = str(body.get('category_key') or '').strip()
    category_label = CATEGORIES.get(category_key, {}).get('label', '') or str(body.get('query') or '').strip()
    country = str(body.get('country') or '').strip()
    city = str(body.get('city') or '').strip()

    custom_query = str(body.get('custom_query') or '').strip()
    if not custom_query and not category_label:
        return api_error('Оберіть категорію, або вкажіть власний запит.', 400)
    if not custom_query and not country and not city:
        return api_error('Вкажіть країну або місто.', 400)

    query_text = custom_query or ' '.join(p for p in (category_label, city, country) if p)

    try:
        result = google_search_service.search_businesses(
            query_text=query_text,
            category_label=category_label,
            category_key=category_key,
            country=country,
            city=city,
            lang=str(body.get('lang') or '').strip(),
            gl=str(body.get('gl') or '').strip(),
            date_restrict=str(body.get('date_restrict') or '').strip(),
            exact_terms=str(body.get('exact_terms') or '').strip(),
            exclude_terms=str(body.get('exclude_terms') or '').strip(),
            exclude_platforms=bool(body.get('exclude_platforms', True)),
            limit=int(body.get('limit') or 20),
        )
    except GoogleSearchError as exc:
        return api_error(exc.message, 502 if google_search_service.is_configured() else 503)

    return jsonify({'ok': True, 'data': result})


@prospecting_bp.get('/saved-searches')
@auth_required
@role_required(*_ADMIN_ROLES)
def list_saved_searches():
    """Збережені пошуки — спільні для всіх адмінів/менеджерів (як і ліди),
    щоб не дублювати ту саму комбінацію фільтрів для кожного окремо."""
    _ensure_prospecting_schema()
    with get_connection() as conn:
        rows = conn.execute(
            'SELECT id, name, source, params, created_by, created_at '
            'FROM prospecting_saved_searches ORDER BY created_at DESC'
        ).fetchall()
    data = []
    for r in (rows or []):
        r = dict(r)
        try:
            r['params'] = json.loads(r.get('params') or '{}')
        except (TypeError, ValueError):
            r['params'] = {}
        data.append(r)
    return jsonify({'ok': True, 'data': data})


@prospecting_bp.post('/saved-searches')
@auth_required
@role_required(*_ADMIN_ROLES)
def create_saved_search():
    _ensure_prospecting_schema()
    body = request.get_json(silent=True) or {}
    name = str(body.get('name') or '').strip()
    source = str(body.get('source') or 'osm').strip()
    params = body.get('params')

    if not name:
        return api_error('Вкажіть назву збереженого пошуку.', 400)
    if source not in ('osm', 'google'):
        return api_error('Невідоме джерело.', 400)
    if not isinstance(params, dict):
        return api_error('Некоректні параметри пошуку.', 400)

    author = str(g.current_user.get('full_name') or 'Адмін')
    with get_connection() as conn:
        cur = conn.execute(
            'INSERT INTO prospecting_saved_searches (name, source, params, created_by) '
            'VALUES (%s, %s, %s, %s)' + get_returning_id_suffix(),
            (name, source, json.dumps(params), author),
        )
        new_id = int(insert_last_id(cur))
    return jsonify({'ok': True, 'data': {'id': new_id}})


@prospecting_bp.delete('/saved-searches/<int:search_id>')
@auth_required
@role_required(*_ADMIN_ROLES)
def delete_saved_search(search_id: int):
    _ensure_prospecting_schema()
    with get_connection() as conn:
        conn.execute('DELETE FROM prospecting_saved_searches WHERE id = %s', (search_id,))
    return jsonify({'ok': True})


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

            is_google = str(cand.get('source') or '').strip() == 'google'
            source_label = 'Google' if is_google else 'OSM'

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
                'source_bucket': 'prospecting_google' if is_google else 'prospecting_osm',
                'messenger_note': f'Знайдено через пошук клієнтів ({source_label})',
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
            _log_activity(conn, new_id, author, 'system', f'Додано через пошук клієнтів ({source_label}), власник: {owner}')
            created_ids.append(new_id)
            created += 1

    return jsonify({'ok': True, 'data': {'created': created, 'skipped': skipped, 'created_ids': created_ids}})

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

# Ролі з доступом до CRM (Пошук клієнтів). 'manager' — CRM-менеджер без
# банківської адмінки (див. leads_routes._ADMIN_ROLES).
_ADMIN_ROLES = ('admin', 'platform_admin', 'manager')
_MANAGERS = ('Manager 1', 'Manager 2')


def _ensure_prospecting_schema() -> None:
    """Окрема, самодостатня таблиця збережених пошуків — той самий патерн
    self-contained _ensure_schema(), що й у leads_routes.py, без змін до
    database.py. `params` — JSON-блоb усього payload'у форми пошуку (щоб
    один клік «Завантажити» відновлював джерело + всі фільтри як є).

    schedule/last_run_at/seen_keys — опційний авто-перезапуск (off/daily/
    weekly): опортуністична перевірка на кожному опитуванні месенджера
    (maybe_run_scheduled_searches, той самий патерн, що й
    messenger_routes._maybe_post_scheduler_digest), а не окремий cron-процес."""
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

        # SQLite's ALTER TABLE ADD COLUMN has no IF NOT EXISTS — guard manually
        # via PRAGMA table_info (same pattern as integrations_routes.py).
        if USE_PG:
            conn.execute("ALTER TABLE prospecting_saved_searches ADD COLUMN IF NOT EXISTS schedule VARCHAR(20) NOT NULL DEFAULT 'off'")
            conn.execute('ALTER TABLE prospecting_saved_searches ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMP')
            conn.execute("ALTER TABLE prospecting_saved_searches ADD COLUMN IF NOT EXISTS seen_keys TEXT NOT NULL DEFAULT '[]'")
        else:
            existing_cols = {r['name'] for r in conn.execute('PRAGMA table_info(prospecting_saved_searches)').fetchall()}
            if 'schedule' not in existing_cols:
                conn.execute("ALTER TABLE prospecting_saved_searches ADD COLUMN schedule VARCHAR(20) NOT NULL DEFAULT 'off'")
            if 'last_run_at' not in existing_cols:
                conn.execute('ALTER TABLE prospecting_saved_searches ADD COLUMN last_run_at TIMESTAMP')
            if 'seen_keys' not in existing_cols:
                conn.execute("ALTER TABLE prospecting_saved_searches ADD COLUMN seen_keys TEXT NOT NULL DEFAULT '[]'")


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


def _perform_osm_search(body: dict) -> dict:
    """Спільна логіка для POST /search і опортуністичного запуску запланованих
    збережених пошуків (maybe_run_scheduled_searches) — щоб не дублювати
    парсинг параметрів і exclude_existing-фільтр в двох місцях."""
    category_keys = body.get('category_keys')
    if isinstance(category_keys, list) and category_keys:
        category_keys = [str(k).strip() for k in category_keys if str(k).strip()]
    else:
        single = str(body.get('category_key') or '').strip()
        category_keys = [single] if single else []
    country = str(body.get('country') or '').strip()
    city = str(body.get('city') or '').strip()
    qualifiers = body.get('qualifiers') or []
    limit = body.get('limit') or 30
    recent_months = body.get('recent_months') or 0
    if not isinstance(qualifiers, list):
        qualifiers = []

    if not category_keys:
        raise ValueError('Оберіть категорію.')
    if not country:
        raise ValueError('Вкажіть країну.')

    result = prospecting_service.search_businesses(
        category_keys, country, city, [str(q) for q in qualifiers],
        int(limit), int(recent_months),
    )
    if bool(body.get('exclude_existing')):
        result['candidates'], result['excluded_existing'] = _filter_existing_candidates(result['candidates'])
    return result


@prospecting_bp.post('/search')
@auth_required
@role_required(*_ADMIN_ROLES)
def search():
    body = request.get_json(silent=True) or {}
    try:
        result = _perform_osm_search(body)
    except ValueError as exc:
        return api_error(str(exc), 400)
    except ProspectingError as exc:
        return api_error(exc.message, 502)
    return jsonify({'ok': True, 'data': result})


def _perform_google_search(body: dict) -> dict:
    """Спільна логіка для POST /search-google і запланованих пошуків
    (див. _perform_osm_search)."""
    category_keys = body.get('category_keys')
    if isinstance(category_keys, list) and category_keys:
        category_keys = [str(k).strip() for k in category_keys if str(k).strip()]
    else:
        single = str(body.get('category_key') or '').strip()
        category_keys = [single] if single else []
    category_labels = [CATEGORIES[k]['label'] for k in category_keys if k in CATEGORIES]
    if len(category_labels) > 1:
        category_label = '(' + ' OR '.join(category_labels) + ')'
    else:
        category_label = (category_labels[0] if category_labels else '') or str(body.get('query') or '').strip()
    category_key = category_keys[0] if category_keys else ''
    country = str(body.get('country') or '').strip()
    city = str(body.get('city') or '').strip()

    custom_query = str(body.get('custom_query') or '').strip()
    if not custom_query and not category_label:
        raise ValueError('Оберіть категорію, або вкажіть власний запит.')
    if not custom_query and not country and not city:
        raise ValueError('Вкажіть країну або місто.')

    query_text = custom_query or ' '.join(p for p in (category_label, city, country) if p)

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
    if bool(body.get('exclude_existing')):
        result['candidates'], result['excluded_existing'] = _filter_existing_candidates(result['candidates'])
    return result


@prospecting_bp.post('/search-google')
@auth_required
@role_required(*_ADMIN_ROLES)
def search_google():
    """Другий канал пошуку — Google Custom Search. На відміну від /search
    (OSM, структурований реєстр бізнесів), тут повертаються веб-сторінки за
    запитом: корисно там, де покриття OSM слабке, або щоб перевірити, чи
    бізнес взагалі присутній онлайн поза власним сайтом."""
    body = request.get_json(silent=True) or {}
    try:
        result = _perform_google_search(body)
    except ValueError as exc:
        return api_error(str(exc), 400)
    except GoogleSearchError as exc:
        return api_error(exc.message, 502 if google_search_service.is_configured() else 503)
    return jsonify({'ok': True, 'data': result})


def _perform_both_search(body: dict) -> dict:
    """Об'єднаний режим: OSM + Google за один виклик, дедуп між джерелами (той
    самий сигнал, що й /import: телефон → домен сайту → назва+місто), єдиний
    відсортований за score список. Спільна логіка для /search-both і
    запланованих пошуків (maybe_run_scheduled_searches)."""
    osm_result: dict | None = None
    google_result: dict | None = None
    osm_error = google_error = None

    try:
        osm_result = _perform_osm_search(body)
    except ValueError as exc:
        osm_error = str(exc)
    except ProspectingError as exc:
        osm_error = exc.message

    if google_search_service.is_configured():
        try:
            google_result = _perform_google_search(body)
        except ValueError:
            pass  # Google не обов'язковий у "обидва" — просто бракує його полів (custom_query тощо)
        except GoogleSearchError as exc:
            google_error = exc.message

    if osm_result is None and google_result is None:
        raise ValueError(osm_error or google_error or 'Не вдалося виконати пошук.')

    merged: list[dict] = []
    seen_keys: set[str] = set()
    for src_result in (osm_result, google_result):
        if not src_result:
            continue
        for c in src_result.get('candidates') or []:
            c.setdefault('source', 'osm')
            key = (
                _normalize_phone(c.get('phone') or '')
                or _domain(c.get('website_url') or '')
                or f"{(c.get('business_name') or '').strip().lower()}|{(c.get('city_area') or '').strip().lower()}"
            )
            if key and key in seen_keys:
                continue
            if key:
                seen_keys.add(key)
            merged.append(c)
    merged.sort(key=lambda c: -c.get('score', 0))

    if bool(body.get('exclude_existing')):
        merged, excluded = _filter_existing_candidates(merged)
    else:
        excluded = 0

    return {
        'area': (osm_result or google_result or {}).get('area', ''),
        'candidates': merged,
        'total_found': (osm_result or {}).get('total_found', 0) + (google_result or {}).get('total_found', 0),
        'excluded_existing': excluded,
        'osm_error': osm_error,
        'google_error': google_error,
    }


@prospecting_bp.post('/search-both')
@auth_required
@role_required(*_ADMIN_ROLES)
def search_both():
    body = request.get_json(silent=True) or {}
    try:
        result = _perform_both_search(body)
    except ValueError as exc:
        return api_error(str(exc), 502)
    return jsonify({'ok': True, 'data': result})


@prospecting_bp.post('/enrich')
@auth_required
@role_required(*_ADMIN_ROLES)
def enrich():
    """Точковий Google-пошук контактів для ОДНОГО кандидата (типово — з OSM,
    де немає телефону/email) — не плутати з основним /search-google."""
    body = request.get_json(silent=True) or {}
    business_name = str(body.get('business_name') or '').strip()
    if not business_name:
        return api_error('Вкажіть назву бізнесу.', 400)
    try:
        data = google_search_service.enrich_business(
            business_name=business_name,
            city=str(body.get('city') or '').strip(),
            country=str(body.get('country') or '').strip(),
        )
    except GoogleSearchError as exc:
        return api_error(exc.message, 502 if google_search_service.is_configured() else 503)
    return jsonify({'ok': True, 'data': data})


@prospecting_bp.get('/saved-searches')
@auth_required
@role_required(*_ADMIN_ROLES)
def list_saved_searches():
    """Збережені пошуки — спільні для всіх адмінів/менеджерів (як і ліди),
    щоб не дублювати ту саму комбінацію фільтрів для кожного окремо."""
    _ensure_prospecting_schema()
    with get_connection() as conn:
        rows = conn.execute(
            'SELECT id, name, source, params, created_by, created_at, schedule, last_run_at '
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
    if source not in ('osm', 'google', 'both'):
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


@prospecting_bp.patch('/saved-searches/<int:search_id>')
@auth_required
@role_required(*_ADMIN_ROLES)
def update_saved_search(search_id: int):
    """Наразі єдине редаговане поле — schedule (off/daily/weekly), тумблер
    авто-перезапуску прямо на чіпі збереженого пошуку у фронтенді."""
    _ensure_prospecting_schema()
    body = request.get_json(silent=True) or {}
    schedule = str(body.get('schedule') or '').strip()
    if schedule not in ('off', 'daily', 'weekly'):
        return api_error('Некоректний розклад.', 400)
    with get_connection() as conn:
        conn.execute(
            'UPDATE prospecting_saved_searches SET schedule = %s WHERE id = %s',
            (schedule, search_id),
        )
    return jsonify({'ok': True})


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


def _filter_existing_candidates(candidates: list[dict]) -> tuple[list[dict], int]:
    """Прибирає з видачі кандидатів, які вже є лідами в CRM (той самий
    дедуп-сигнал, що й при імпорті) — щоб не гортати список, який однаково
    відсіється на кроці «Додати обраних у роботу». Повертає (лишились, скільки прибрано)."""
    _ensure_leads_schema()
    with get_connection() as conn:
        kept = [
            c for c in candidates
            if not _find_duplicate(
                conn,
                phone=str(c.get('phone') or ''),
                website=str(c.get('website_url') or ''),
                name=str(c.get('business_name') or ''),
                city=str(c.get('city_area') or ''),
            )
        ]
    return kept, len(candidates) - len(kept)


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


# ════════════════════════════════════════════
# Заплановані збережені пошуки: опортуністичний авто-перезапуск (off/daily/
# weekly), той самий патерн, що й messenger_routes._maybe_post_scheduler_digest
# — перевіряється на кожному опитуванні месенджера фронтендом (~20-30с), а не
# окремим cron-процесом. Про НОВИХ (раніше не бачених) кандидатів сповіщаємо
# у "Планувальник" + push усім admin/platform_admin/manager.
# ════════════════════════════════════════════

def _candidate_dedup_key(cand: dict) -> str:
    """Стабільний ключ кандидата для порівняння «бачили раніше / новий» між
    запусками того самого запланованого пошуку — той самий пріоритет сигналів,
    що й _find_duplicate: телефон → домен сайту/джерела → назва+місто."""
    phone = _normalize_phone(cand.get('phone') or '')
    if phone and len(phone) >= 7:
        return f'phone:{phone}'
    dom = _domain(cand.get('website_url') or cand.get('source_url') or '')
    if dom:
        return f'domain:{dom}'
    name = (cand.get('business_name') or '').strip().lower()
    city = (cand.get('city_area') or '').strip().lower()
    return f'name:{name}|{city}'


def _due_for_schedule(schedule: str, last_run_at) -> bool:
    if schedule not in ('daily', 'weekly'):
        return False
    if not last_run_at:
        return True
    from datetime import datetime, timedelta
    raw = str(last_run_at)[:19].replace(' ', 'T')
    try:
        last = datetime.fromisoformat(raw)
    except ValueError:
        return True
    days = 1 if schedule == 'daily' else 7
    return datetime.utcnow() - last >= timedelta(days=days)


def _mark_search_ran(search_id: int, seen_keys: set[str]) -> None:
    from ..config import USE_PG
    now_sql = 'NOW()' if USE_PG else "datetime('now')"
    with get_connection() as conn:
        conn.execute(
            f'UPDATE prospecting_saved_searches SET last_run_at = {now_sql}, seen_keys = %s WHERE id = %s',
            (json.dumps(sorted(seen_keys)), search_id),
        )


def _notify_new_candidates(search_name: str, new_candidates: list[dict]) -> None:
    """Постить у 'Планувальник' КОЖНОГО admin/platform_admin/manager + best-
    effort web push. Локальний імпорт messenger_routes/push_routes — уникаємо
    циклічного імпорту на рівні модуля (messenger_routes теж підключає
    інші блюпрінти)."""
    from .messenger_routes import _ensure_self_conversation, _SCHEDULER_NAME
    from .messenger_routes import _now_sql as _msgr_now_sql
    from .push_routes import send_push

    names_preview = ', '.join(
        (c.get('business_name') or '').strip() for c in new_candidates[:5] if c.get('business_name')
    )
    extra = len(new_candidates) - 5
    more = f' та ще {extra}' if extra > 0 else ''
    text = f'🔔 Збережений пошук «{search_name}»: {len(new_candidates)} нових кандидатів — {names_preview}{more}.'

    with get_connection() as conn:
        user_rows = conn.execute(
            "SELECT id FROM users WHERE role IN ('admin', 'platform_admin', 'manager')"
        ).fetchall()
        user_ids = [dict(r)['id'] for r in (user_rows or [])]
        for uid in user_ids:
            conv_id = _ensure_self_conversation(uid, _SCHEDULER_NAME)
            conn.execute(
                'INSERT INTO messages (conversation_id, sender_id, text, msg_type) VALUES (%s, %s, %s, %s)',
                (conv_id, uid, text, 'text'),
            )
            conn.execute(
                f'UPDATE conversations SET last_message_at = {_msgr_now_sql()}, last_message_text = %s WHERE id = %s',
                (text[:180], conv_id),
            )

    for uid in user_ids:
        send_push(
            uid, title='Новий пошук клієнтів', body=text[:150], url='/messenger',
            push_type='prospecting_search', meta={'search_name': search_name},
        )


def _run_one_scheduled_search(row: dict) -> None:
    params = {}
    try:
        params = json.loads(row.get('params') or '{}')
    except (TypeError, ValueError):
        pass
    source = row.get('source') or 'osm'

    try:
        if source == 'google':
            result = _perform_google_search(params)
        elif source == 'both':
            result = _perform_both_search(params)
        else:
            result = _perform_osm_search(params)
    except (ValueError, ProspectingError, GoogleSearchError):
        # Тимчасова недоступність джерела (Overpass/квота) не має "з'їдати"
        # seen_keys — лишаємо як було, спробуємо знову на наступному циклі.
        return

    candidates = result.get('candidates') or []
    seen = set(json.loads(row.get('seen_keys') or '[]'))
    is_first_run = not seen
    all_keys = set(seen)
    new_ones = []
    for c in candidates:
        key = _candidate_dedup_key(c)
        all_keys.add(key)
        if key not in seen:
            new_ones.append(c)

    _mark_search_ran(row['id'], all_keys)

    # Перший запуск ніколи не "нове" — інакше кожен щойно збережений пошук
    # одразу засипав би менеджерів дайджестом усього, що знайшлось.
    if new_ones and not is_first_run:
        _notify_new_candidates(row.get('name') or 'Збережений пошук', new_ones)


_scheduled_search_checked_on: dict[str, str] = {}


def maybe_run_scheduled_searches() -> None:
    """Викликається опортуністично з опитування месенджера (той самий патерн,
    що й messenger_routes._maybe_post_scheduler_digest) — не окремий
    cron-процес. Раз на день на весь застосунок (gunicorn -w1, тому простий
    process-local dict безпечний як кеш)."""
    from datetime import date
    today_iso = date.today().isoformat()
    if _scheduled_search_checked_on.get('checked') == today_iso:
        return
    _scheduled_search_checked_on['checked'] = today_iso

    _ensure_prospecting_schema()
    with get_connection() as conn:
        rows = [dict(r) for r in (conn.execute(
            "SELECT * FROM prospecting_saved_searches WHERE schedule != 'off'"
        ).fetchall() or [])]

    for row in rows:
        if _due_for_schedule(row.get('schedule') or 'off', row.get('last_run_at')):
            _run_one_scheduled_search(row)

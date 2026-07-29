"""ARM CRM — конструктор пошуку потенційних клієнтів (prospecting).

Менеджер шукає бізнеси по світу за категорією/локацією/квaліфікаторами
(джерело — OpenStreetMap, див. prospecting_service.py), переглядає кандидатів
із сигналами «чому гарячий / що пропонувати», і додає обраних у свою роботу
(масове створення лідів з дедупом проти вже наявних).
"""
from __future__ import annotations

import json
import re
import threading
import time
from datetime import date
from pathlib import Path


def _get_active_managers(conn) -> list[str]:
    rows = conn.execute("SELECT crm_owner FROM users WHERE role = 'manager' AND crm_owner IS NOT NULL").fetchall()
    return [r['crm_owner'] for r in rows]

from flask import Blueprint, g, jsonify, request

from ..database import get_connection, get_returning_id_suffix, insert_last_id
from ..services import google_search_service, prospecting_service, website_enrichment_service
from ..services.google_search_service import GoogleSearchError
from ..services.lead_exclusions import exclusion_reason, is_allowed_lead
from ..services.messenger_crypto import decrypt_message, encrypt_message
from ..services.prospecting_categories import (
    CATEGORIES, QUALIFIERS, category_search_term, category_search_variants,
)
from ..services.prospecting_service import ProspectingError
from .helpers import api_error, auth_required, role_required
from .leads_routes import _ensure_schema as _ensure_leads_schema
from .leads_routes import _log_activity, _next_lead_id

prospecting_bp = Blueprint('prospecting', __name__, url_prefix='/api/prospecting')

# Ролі з доступом до CRM (Пошук клієнтів). 'manager' — CRM-менеджер без
# банківської адмінки (див. leads_routes._ADMIN_ROLES).
_ADMIN_ROLES = ('admin', 'platform_admin', 'manager')

_ACTIVE_JOB_IDS: set[int] = set()
_ACTIVE_JOB_LOCK = threading.Lock()
_OPENINGS_DATA_PATH = Path(__file__).resolve().parent.parent / 'data' / 'openings_2026.json'


def _openings_registry() -> dict:
    """Read the curated/static registry shipped with the app.

    Keeping source URLs and verification state in the dataset makes the UI
    auditable: a manager can always see why a record is present before adding
    it to CRM.
    """
    try:
        return json.loads(_OPENINGS_DATA_PATH.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {'count': 0, 'records': [], 'methodology': {}}


@prospecting_bp.get('/openings')
@auth_required
@role_required(*_ADMIN_ROLES)
def list_openings():
    registry = _openings_registry()
    registry_records = [r for r in (registry.get('records') or []) if is_allowed_lead(r)]
    records = list(registry_records)
    query = str(request.args.get('q') or '').strip().lower()
    month = str(request.args.get('month') or '').strip()
    country = str(request.args.get('country') or '').strip()
    category = str(request.args.get('category') or '').strip()
    city_tier = str(request.args.get('city_tier') or '').strip()
    verification = str(request.args.get('verification') or '').strip()
    if query:
        records = [r for r in records if query in ' '.join(str(r.get(k) or '') for k in ('business_name', 'city', 'country', 'description', 'category_label')).lower()]
    if month:
        records = [r for r in records if str(r.get('opening_month') or '') == month]
    if country:
        records = [r for r in records if str(r.get('country_code') or '') == country]
    if category:
        records = [r for r in records if str(r.get('category') or '') == category]
    if city_tier:
        tiers = {'small_market': {'town', 'small_city', 'regional_city'}}.get(city_tier, {city_tier})
        records = [r for r in records if str(r.get('city_tier') or '') in tiers]
    if verification:
        records = [r for r in records if str(r.get('verification_status') or '') == verification]

    page = max(1, int(request.args.get('page') or 1))
    per_page = max(12, min(int(request.args.get('per_page') or 24), 60))
    total = len(records)
    start = (page - 1) * per_page
    countries = sorted({(r.get('country_code'), r.get('country')) for r in registry_records})
    categories = sorted({(r.get('category'), r.get('category_label')) for r in registry_records})
    return jsonify({'ok': True, 'data': {
        'records': records[start:start + per_page], 'total': total, 'page': page,
        'per_page': per_page, 'registry_count': len(registry_records),
        'countries': [{'code': code, 'label': label} for code, label in countries if code],
        'categories': [{'key': key, 'label': label} for key, label in categories if key],
        'methodology': registry.get('methodology') or {},
    }})


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

        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS prospecting_search_runs (
                id {pk_sql},
                source VARCHAR(20) NOT NULL DEFAULT 'osm',
                params TEXT NOT NULL DEFAULT '{{}}',
                status VARCHAR(20) NOT NULL DEFAULT 'success',
                result_count INTEGER NOT NULL DEFAULT 0,
                duration_ms INTEGER NOT NULL DEFAULT 0,
                error_text TEXT NOT NULL DEFAULT '',
                created_by VARCHAR(80) NOT NULL DEFAULT '',
                created_at TIMESTAMP NOT NULL DEFAULT {now_sql}
            )
            """
        )
        conn.execute('CREATE INDEX IF NOT EXISTS idx_prosp_runs_created ON prospecting_search_runs(created_at)')

        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS prospecting_search_jobs (
                id {pk_sql},
                source VARCHAR(20) NOT NULL DEFAULT 'osm',
                params TEXT NOT NULL DEFAULT '{{}}',
                status VARCHAR(20) NOT NULL DEFAULT 'queued',
                total_locations INTEGER NOT NULL DEFAULT 0,
                completed_locations INTEGER NOT NULL DEFAULT 0,
                result_data TEXT NOT NULL DEFAULT '{{}}',
                error_data TEXT NOT NULL DEFAULT '[]',
                cancel_requested INTEGER NOT NULL DEFAULT 0,
                current_location VARCHAR(180) NOT NULL DEFAULT '',
                current_attempt INTEGER NOT NULL DEFAULT 0,
                parent_job_id INTEGER NOT NULL DEFAULT 0,
                created_by VARCHAR(80) NOT NULL DEFAULT '',
                created_by_user_id INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP NOT NULL DEFAULT {now_sql},
                updated_at TIMESTAMP NOT NULL DEFAULT {now_sql}
            )
            """
        )
        conn.execute('CREATE INDEX IF NOT EXISTS idx_prosp_jobs_created ON prospecting_search_jobs(created_at)')

        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS prospecting_candidate_catalog (
                candidate_key VARCHAR(300) PRIMARY KEY,
                business_name VARCHAR(240) NOT NULL DEFAULT '',
                category_key VARCHAR(80) NOT NULL DEFAULT '',
                country VARCHAR(120) NOT NULL DEFAULT '',
                city_area VARCHAR(240) NOT NULL DEFAULT '',
                phone VARCHAR(80) NOT NULL DEFAULT '',
                email VARCHAR(180) NOT NULL DEFAULT '',
                website_url TEXT NOT NULL DEFAULT '',
                instagram VARCHAR(180) NOT NULL DEFAULT '',
                source VARCHAR(30) NOT NULL DEFAULT '',
                payload TEXT NOT NULL DEFAULT '{{}}',
                seen_count INTEGER NOT NULL DEFAULT 1,
                first_seen_at TIMESTAMP NOT NULL DEFAULT {now_sql},
                last_seen_at TIMESTAMP NOT NULL DEFAULT {now_sql}
            )
            """
        )
        conn.execute('CREATE INDEX IF NOT EXISTS idx_prosp_catalog_category ON prospecting_candidate_catalog(category_key)')
        conn.execute('CREATE INDEX IF NOT EXISTS idx_prosp_catalog_country ON prospecting_candidate_catalog(country)')
        conn.execute('CREATE INDEX IF NOT EXISTS idx_prosp_catalog_last_seen ON prospecting_candidate_catalog(last_seen_at)')

        # SQLite's ALTER TABLE ADD COLUMN has no IF NOT EXISTS — guard manually
        # via PRAGMA table_info (same pattern as integrations_routes.py).
        if USE_PG:
            conn.execute("ALTER TABLE prospecting_saved_searches ADD COLUMN IF NOT EXISTS schedule VARCHAR(20) NOT NULL DEFAULT 'off'")
            conn.execute('ALTER TABLE prospecting_saved_searches ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMP')
            conn.execute("ALTER TABLE prospecting_saved_searches ADD COLUMN IF NOT EXISTS seen_keys TEXT NOT NULL DEFAULT '[]'")
            conn.execute('ALTER TABLE prospecting_search_jobs ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER NOT NULL DEFAULT 0')
            conn.execute("ALTER TABLE prospecting_search_jobs ADD COLUMN IF NOT EXISTS current_location VARCHAR(180) NOT NULL DEFAULT ''")
            conn.execute('ALTER TABLE prospecting_search_jobs ADD COLUMN IF NOT EXISTS current_attempt INTEGER NOT NULL DEFAULT 0')
            conn.execute('ALTER TABLE prospecting_search_jobs ADD COLUMN IF NOT EXISTS parent_job_id INTEGER NOT NULL DEFAULT 0')
        else:
            existing_cols = {r['name'] for r in conn.execute('PRAGMA table_info(prospecting_saved_searches)').fetchall()}
            if 'schedule' not in existing_cols:
                conn.execute("ALTER TABLE prospecting_saved_searches ADD COLUMN schedule VARCHAR(20) NOT NULL DEFAULT 'off'")
            if 'last_run_at' not in existing_cols:
                conn.execute('ALTER TABLE prospecting_saved_searches ADD COLUMN last_run_at TIMESTAMP')
            if 'seen_keys' not in existing_cols:
                conn.execute("ALTER TABLE prospecting_saved_searches ADD COLUMN seen_keys TEXT NOT NULL DEFAULT '[]'")
            job_cols = {r['name'] for r in conn.execute('PRAGMA table_info(prospecting_search_jobs)').fetchall()}
            if 'created_by_user_id' not in job_cols:
                conn.execute('ALTER TABLE prospecting_search_jobs ADD COLUMN created_by_user_id INTEGER NOT NULL DEFAULT 0')
            if 'current_location' not in job_cols:
                conn.execute("ALTER TABLE prospecting_search_jobs ADD COLUMN current_location VARCHAR(180) NOT NULL DEFAULT ''")
            if 'current_attempt' not in job_cols:
                conn.execute('ALTER TABLE prospecting_search_jobs ADD COLUMN current_attempt INTEGER NOT NULL DEFAULT 0')
            if 'parent_job_id' not in job_cols:
                conn.execute('ALTER TABLE prospecting_search_jobs ADD COLUMN parent_job_id INTEGER NOT NULL DEFAULT 0')

        # Власні Google Custom Search ключі — по одному запису на користувача
        # (кожен менеджер/адмін налаштовує СВІЙ ключ у 🔌 Інтеграції). Токен
        # зашифрований тим самим at-rest шифруванням, що й у integrations.
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS prospecting_api_keys (
                user_id INTEGER PRIMARY KEY,
                api_key TEXT NOT NULL DEFAULT '',
                cx VARCHAR(120) NOT NULL DEFAULT '',
                verified_at TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT {now_sql}
            )
            """
        )


def _user_google_creds(user_id: int) -> tuple[str, str]:
    """Власні (розшифровані) ключі користувача, або ('','') якщо не задані."""
    if not user_id:
        return '', ''
    _ensure_prospecting_schema()
    with get_connection() as conn:
        row = conn.execute(
            'SELECT api_key, cx FROM prospecting_api_keys WHERE user_id = %s', (user_id,)
        ).fetchone()
    if not row:
        return '', ''
    row = dict(row)
    return decrypt_message(row.get('api_key') or '', fallback=''), (row.get('cx') or '')


def _resolve_google_creds(user_id: int) -> tuple[str, str]:
    """Ключі для реального пошуку: власні користувача → інакше глобальний .env."""
    from ..config import GOOGLE_CSE_API_KEY, GOOGLE_CSE_CX
    key, cx = _user_google_creds(user_id)
    return (key or GOOGLE_CSE_API_KEY or ''), (cx or GOOGLE_CSE_CX or '')


def _record_search_run(source: str, params: dict, *, result: dict | None = None,
                       error: str = '', started_at: float = 0) -> None:
    """Persist operational search history without ever blocking the search response."""
    try:
        _ensure_prospecting_schema()
        if result is not None:
            try:
                result['catalog_stats'] = _archive_discovered_candidates(result.get('candidates') or [])
            except Exception:
                result['catalog_stats'] = {'new': 0, 'updated': 0, 'error': True}
        duration_ms = max(0, int((time.monotonic() - started_at) * 1000)) if started_at else 0
        status = 'partial' if result and result.get('partial') else ('error' if error else 'success')
        count = len((result or {}).get('candidates') or [])
        author = str((g.current_user or {}).get('name') or (g.current_user or {}).get('email') or '')
        with get_connection() as conn:
            conn.execute(
                'INSERT INTO prospecting_search_runs '
                '(source, params, status, result_count, duration_ms, error_text, created_by) '
                'VALUES (%s, %s, %s, %s, %s, %s, %s)',
                (source, json.dumps(params, ensure_ascii=False), status, count, duration_ms, error[:1000], author),
            )
    except Exception:
        pass


def _archive_discovered_candidates(candidates: list[dict]) -> dict:
    """Grow a first-party discovery catalog from every successful search."""
    if not candidates:
        return {'new': 0, 'updated': 0}
    from ..config import USE_PG
    now_sql = 'NOW()' if USE_PG else 'CURRENT_TIMESTAMP'
    created = updated = 0
    with get_connection() as conn:
        for candidate in candidates:
            key = _candidate_dedup_key(candidate)[:300]
            if not key or key == 'name:|':
                continue
            existing = conn.execute(
                'SELECT candidate_key FROM prospecting_candidate_catalog WHERE candidate_key = %s', (key,)
            ).fetchone()
            values = (
                str(candidate.get('business_name') or '')[:240],
                str(candidate.get('category_key') or '')[:80],
                str(candidate.get('country') or '')[:120],
                str(candidate.get('city_area') or '')[:240],
                str(candidate.get('phone') or '')[:80],
                str(candidate.get('email') or '')[:180],
                str(candidate.get('website_url') or ''),
                str(candidate.get('instagram') or '')[:180],
                str(candidate.get('source') or 'osm')[:30],
                json.dumps(candidate, ensure_ascii=False),
            )
            if existing:
                conn.execute(
                    f'UPDATE prospecting_candidate_catalog SET business_name = %s, category_key = %s, '
                    f'country = %s, city_area = %s, phone = %s, email = %s, website_url = %s, '
                    f'instagram = %s, source = %s, payload = %s, seen_count = seen_count + 1, '
                    f'last_seen_at = {now_sql} WHERE candidate_key = %s',
                    values + (key,),
                )
                updated += 1
            else:
                conn.execute(
                    'INSERT INTO prospecting_candidate_catalog '
                    '(business_name, category_key, country, city_area, phone, email, website_url, '
                    'instagram, source, payload, candidate_key) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)',
                    values + (key,),
                )
                created += 1
    return {'new': created, 'updated': updated}


@prospecting_bp.get('/search-runs')
@auth_required
@role_required(*_ADMIN_ROLES)
def list_search_runs():
    _ensure_prospecting_schema()
    limit = max(1, min(int(request.args.get('limit') or 12), 50))
    with get_connection() as conn:
        rows = conn.execute(
            'SELECT id, source, params, status, result_count, duration_ms, error_text, created_by, created_at '
            'FROM prospecting_search_runs ORDER BY created_at DESC LIMIT %s',
            (limit,),
        ).fetchall()
    result = []
    for row in rows:
        item = dict(row)
        try:
            item['params'] = json.loads(item.get('params') or '{}')
        except (TypeError, ValueError):
            item['params'] = {}
        result.append(item)
    return jsonify({'ok': True, 'data': result})


def _job_row(job_id: int) -> dict | None:
    with get_connection() as conn:
        row = conn.execute('SELECT * FROM prospecting_search_jobs WHERE id = %s', (job_id,)).fetchone()
    if not row:
        return None
    item = dict(row)
    for key, fallback in (('params', {}), ('result_data', {}), ('error_data', [])):
        try:
            item[key] = json.loads(item.get(key) or json.dumps(fallback))
        except (TypeError, ValueError):
            item[key] = fallback
    item['progress'] = round(100 * int(item.get('completed_locations') or 0) / max(1, int(item.get('total_locations') or 1)))
    return item


def _update_job(
    job_id: int,
    *,
    status: str,
    completed: int,
    result: dict,
    errors: list[dict],
    current_location: str = '',
    current_attempt: int = 0,
) -> None:
    with get_connection() as conn:
        conn.execute(
            'UPDATE prospecting_search_jobs SET status = %s, completed_locations = %s, '
            'result_data = %s, error_data = %s, current_location = %s, current_attempt = %s, '
            'updated_at = CURRENT_TIMESTAMP WHERE id = %s',
            (
                status,
                completed,
                json.dumps(result, ensure_ascii=False),
                json.dumps(errors, ensure_ascii=False),
                current_location,
                current_attempt,
                job_id,
            ),
        )


def _run_search_job(job_id: int, source: str, params: dict, creds: tuple[str, str]) -> None:
    with _ACTIVE_JOB_LOCK:
        if job_id in _ACTIVE_JOB_IDS:
            return
        _ACTIVE_JOB_IDS.add(job_id)
    try:
        _run_search_job_inner(job_id, source, params, creds)
    finally:
        with _ACTIVE_JOB_LOCK:
            _ACTIVE_JOB_IDS.discard(job_id)


def _run_search_job_inner(job_id: int, source: str, params: dict, creds: tuple[str, str]) -> None:
    locations = _prospecting_locations(params)
    existing_job = _job_row(job_id) or {}
    seed_result = existing_job.get('result_data') or {}
    accumulated: list[dict] = [seed_result] if seed_result.get('candidates') else []
    errors: list[dict] = []
    started_at = time.monotonic()
    initial_result = _merge_location_results(accumulated, []) if accumulated else {}
    _update_job(job_id, status='running', completed=0, result=initial_result, errors=[])
    for index, location in enumerate(locations):
        current = _job_row(job_id)
        if not current or int(current.get('cancel_requested') or 0):
            merged = _merge_location_results(accumulated, errors) if accumulated else {'candidates': [], 'total_found': 0, 'location_errors': errors}
            _update_job(job_id, status='cancelled', completed=index, result=merged, errors=errors)
            return
        single = dict(params)
        single['locations'] = [location]
        single['country'] = location['country']
        single['city'] = location['city']
        result = None
        last_error = None
        for attempt in (1, 2):
            partial = _merge_location_results(accumulated, errors) if accumulated else {
                'candidates': [], 'total_found': 0, 'location_errors': errors,
            }
            _update_job(
                job_id,
                status='running',
                completed=index,
                result=partial,
                errors=errors,
                current_location=location['label'],
                current_attempt=attempt,
            )
            try:
                if source == 'google':
                    result = _perform_google_search(single, creds)
                elif source == 'both':
                    result = _perform_both_search(single, creds)
                else:
                    result = _perform_osm_search(single)
                break
            except ValueError as exc:
                last_error = exc
                break
            except (ProspectingError, GoogleSearchError) as exc:
                last_error = exc
                if attempt == 1:
                    time.sleep(1.0)
        if result is not None:
            accumulated.append(result)
        elif last_error is not None:
            errors.append({
                'country': location['country'], 'city': location['city'], 'location': location['label'],
                'message': getattr(last_error, 'message', str(last_error)), 'attempts': attempt,
            })
        merged = _merge_location_results(accumulated, errors) if accumulated else {'candidates': [], 'total_found': 0, 'location_errors': errors, 'partial': True}
        _update_job(job_id, status='running', completed=index + 1, result=merged, errors=errors)

    final = _merge_location_results(accumulated, errors) if accumulated else {'candidates': [], 'total_found': 0, 'location_errors': errors, 'partial': True}
    final_status = 'partial' if errors and accumulated else ('error' if errors else 'completed')
    _update_job(job_id, status=final_status, completed=len(locations), result=final, errors=errors)
    _record_search_run_for_worker(source, params, final, errors, started_at)


def _record_search_run_for_worker(source: str, params: dict, result: dict, errors: list[dict], started_at: float) -> None:
    """Thread-safe counterpart of _record_search_run; does not access Flask g."""
    try:
        try:
            result['catalog_stats'] = _archive_discovered_candidates(result.get('candidates') or [])
        except Exception:
            result['catalog_stats'] = {'new': 0, 'updated': 0, 'error': True}
        duration_ms = max(0, int((time.monotonic() - started_at) * 1000))
        status = 'partial' if errors and result.get('candidates') else ('error' if errors else 'success')
        error_text = '; '.join(f"{e.get('location')}: {e.get('message')}" for e in errors)[:1000]
        with get_connection() as conn:
            conn.execute(
                'INSERT INTO prospecting_search_runs '
                '(source, params, status, result_count, duration_ms, error_text, created_by) '
                'VALUES (%s, %s, %s, %s, %s, %s, %s)',
                (source, json.dumps(params, ensure_ascii=False), status, len(result.get('candidates') or []), duration_ms, error_text, 'Background job'),
            )
    except Exception:
        pass


@prospecting_bp.post('/search-jobs')
@auth_required
@role_required(*_ADMIN_ROLES)
def create_search_job():
    _ensure_prospecting_schema()
    body = request.get_json(silent=True) or {}
    source = str(body.get('source') or 'osm').strip()
    params = body.get('params') or {}
    if source not in ('osm', 'google', 'both') or not isinstance(params, dict):
        return api_error('Некоректні параметри фонового пошуку.', 400)
    locations = _prospecting_locations(params)
    if len(locations) < 2:
        return api_error('Фоновий пошук потребує щонайменше 2 локції.', 400)
    author = str(g.current_user.get('full_name') or g.current_user.get('email') or 'Адмін')
    user_id = int(g.current_user.get('id') or 0)
    creds = _resolve_google_creds(user_id) if source in ('google', 'both') else ('', '')
    with get_connection() as conn:
        cur = conn.execute(
            'INSERT INTO prospecting_search_jobs '
            '(source, params, status, total_locations, created_by, created_by_user_id) '
            'VALUES (%s, %s, %s, %s, %s, %s)' + get_returning_id_suffix(),
            (source, json.dumps(params, ensure_ascii=False), 'queued', len(locations), author, user_id),
        )
        job_id = int(insert_last_id(cur))
    threading.Thread(target=_run_search_job, args=(job_id, source, params, creds), daemon=True, name=f'prospecting-job-{job_id}').start()
    return jsonify({'ok': True, 'data': _job_row(job_id)}), 202


def _current_user_job(job_id: int) -> dict | None:
    job = _job_row(job_id)
    if not job:
        return None
    owner_id = int(job.get('created_by_user_id') or 0)
    current_id = int(g.current_user.get('id') or 0)
    return job if owner_id == current_id else None


@prospecting_bp.get('/search-jobs')
@auth_required
@role_required(*_ADMIN_ROLES)
def list_search_jobs():
    """Return this manager's recent jobs and resume threads lost on process restart."""
    _ensure_prospecting_schema()
    user_id = int(g.current_user.get('id') or 0)
    limit = max(1, min(20, int(request.args.get('limit') or 8)))
    with get_connection() as conn:
        rows = conn.execute(
            'SELECT id FROM prospecting_search_jobs WHERE created_by_user_id = %s '
            'ORDER BY created_at DESC LIMIT %s',
            (user_id, limit),
        ).fetchall()
    jobs = [_job_row(int(row['id'])) for row in rows]
    creds = _resolve_google_creds(user_id)
    for job in jobs:
        if not job or job.get('status') not in ('queued', 'running'):
            continue
        job_id = int(job['id'])
        with _ACTIVE_JOB_LOCK:
            is_active = job_id in _ACTIVE_JOB_IDS
        if not is_active:
            with get_connection() as conn:
                conn.execute(
                    'UPDATE prospecting_search_jobs SET status = %s, cancel_requested = 0, updated_at = CURRENT_TIMESTAMP WHERE id = %s',
                    ('queued', job_id),
                )
            source = str(job.get('source') or 'osm')
            job_creds = creds if source in ('google', 'both') else ('', '')
            threading.Thread(
                target=_run_search_job,
                args=(job_id, source, job.get('params') or {}, job_creds),
                daemon=True,
                name=f'prospecting-job-recover-{job_id}',
            ).start()
            job = _job_row(job_id)
    return jsonify({'ok': True, 'data': [job for job in jobs if job]})


@prospecting_bp.get('/search-jobs/<int:job_id>')
@auth_required
@role_required(*_ADMIN_ROLES)
def get_search_job(job_id: int):
    _ensure_prospecting_schema()
    job = _current_user_job(job_id)
    return jsonify({'ok': True, 'data': job}) if job else api_error('Завдання не знайдено.', 404)


@prospecting_bp.post('/search-jobs/<int:job_id>/cancel')
@auth_required
@role_required(*_ADMIN_ROLES)
def cancel_search_job(job_id: int):
    _ensure_prospecting_schema()
    if not _current_user_job(job_id):
        return api_error('Завдання не знайдено.', 404)
    with get_connection() as conn:
        conn.execute('UPDATE prospecting_search_jobs SET cancel_requested = 1, updated_at = CURRENT_TIMESTAMP WHERE id = %s', (job_id,))
    return jsonify({'ok': True, 'data': _job_row(job_id)})


@prospecting_bp.post('/search-jobs/<int:job_id>/retry-errors')
@auth_required
@role_required(*_ADMIN_ROLES)
def retry_search_job_errors(job_id: int):
    previous = _current_user_job(job_id)
    if not previous:
        return api_error('Завдання не знайдено.', 404)
    locations = [{'country': e.get('country'), 'city': e.get('city')} for e in previous.get('error_data') or [] if e.get('country')]
    if not locations:
        return api_error('Немає невдалих локацій для повтору.', 400)
    body = {'source': previous.get('source') or 'osm', 'params': {**(previous.get('params') or {}), 'locations': locations}}
    request_body = request.get_json(silent=True) or {}
    body['params'].update(request_body.get('params') or {})
    source = body['source']
    params = body['params']
    author = str(g.current_user.get('full_name') or g.current_user.get('email') or 'Адмін')
    creds = _resolve_google_creds(int(g.current_user.get('id') or 0)) if source in ('google', 'both') else ('', '')
    with get_connection() as conn:
        cur = conn.execute(
            'INSERT INTO prospecting_search_jobs '
            '(source, params, status, total_locations, result_data, parent_job_id, created_by, created_by_user_id) '
            'VALUES (%s, %s, %s, %s, %s, %s, %s, %s)' + get_returning_id_suffix(),
            (
                source,
                json.dumps(params, ensure_ascii=False),
                'queued',
                len(locations),
                json.dumps(previous.get('result_data') or {}, ensure_ascii=False),
                job_id,
                author,
                int(g.current_user.get('id') or 0),
            ),
        )
        new_id = int(insert_last_id(cur))
    threading.Thread(target=_run_search_job, args=(new_id, source, params, creds), daemon=True, name=f'prospecting-job-{new_id}').start()
    return jsonify({'ok': True, 'data': _job_row(new_id)}), 202


@prospecting_bp.get('/categories')
@auth_required
@role_required(*_ADMIN_ROLES)
def list_categories():
    """Словник категорій + квaліфікаторів для конструктора в UI."""
    key, cx = _resolve_google_creds(int(g.current_user.get('id') or 0))
    return jsonify({'ok': True, 'data': {
        'categories': [{'key': k, 'label': v['label']} for k, v in CATEGORIES.items()],
        'qualifiers': [{'key': k, 'label': v['label'], 'offer': v['offer']} for k, v in QUALIFIERS.items()],
        'languages': [
            {'code': 'uk', 'label': 'Українська'}, {'code': 'en', 'label': 'English'},
            {'code': 'de', 'label': 'Deutsch'}, {'code': 'pl', 'label': 'Polski'},
            {'code': 'fr', 'label': 'Français'}, {'code': 'es', 'label': 'Español'},
            {'code': 'it', 'label': 'Italiano'}, {'code': 'ru', 'label': 'Русский'},
        ],
        'google_configured': google_search_service.is_configured(key, cx),
    }})


# ── Власний Google Custom Search ключ (self-serve, per-user) ────────────────

def _google_key_status(user_id: int) -> dict:
    from ..config import GOOGLE_CSE_API_KEY, GOOGLE_CSE_CX
    key, cx = _user_google_creds(user_id)
    has_global = bool(GOOGLE_CSE_API_KEY and GOOGLE_CSE_CX)
    verified_at = ''
    if key or cx:
        _ensure_prospecting_schema()
        with get_connection() as conn:
            row = conn.execute(
                'SELECT verified_at FROM prospecting_api_keys WHERE user_id = %s', (user_id,)
            ).fetchone()
        verified_at = str(dict(row).get('verified_at') or '') if row else ''
    preview = ''
    if key:
        preview = f'{key[:6]}••••{key[-4:]}' if len(key) >= 12 else '••••••'
    return {
        'has_own_key': bool(key and cx),
        'key_preview': preview,
        'cx': cx,
        'verified_at': verified_at,
        'has_global_fallback': has_global,
        'active': bool((key and cx) or has_global),
    }


@prospecting_bp.get('/google-key')
@auth_required
@role_required(*_ADMIN_ROLES)
def get_google_key():
    return jsonify({'ok': True, 'data': _google_key_status(int(g.current_user.get('id') or 0))})


@prospecting_bp.post('/google-key')
@auth_required
@role_required(*_ADMIN_ROLES)
def set_google_key():
    """Зберігає власний ключ користувача ПІСЛЯ реальної перевірки тестовим
    запитом — щоб не зберегти явно неробочу пару."""
    _ensure_prospecting_schema()
    body = request.get_json(silent=True) or {}
    api_key = str(body.get('api_key') or '').strip()
    cx = str(body.get('cx') or '').strip()
    if not api_key or not cx:
        return api_error('Вкажіть і API key, і Search Engine ID (cx).', 400)
    try:
        google_search_service.verify_credentials(api_key, cx)
    except GoogleSearchError as exc:
        return api_error(exc.message, 400)

    user_id = int(g.current_user.get('id') or 0)
    from ..config import USE_PG
    now_sql = 'NOW()' if USE_PG else "datetime('now')"
    enc = encrypt_message(api_key)
    with get_connection() as conn:
        existing = conn.execute(
            'SELECT user_id FROM prospecting_api_keys WHERE user_id = %s', (user_id,)
        ).fetchone()
        if existing:
            conn.execute(
                f'UPDATE prospecting_api_keys SET api_key = %s, cx = %s, verified_at = {now_sql}, updated_at = {now_sql} WHERE user_id = %s',
                (enc, cx, user_id),
            )
        else:
            conn.execute(
                f'INSERT INTO prospecting_api_keys (user_id, api_key, cx, verified_at) VALUES (%s, %s, %s, {now_sql})',
                (user_id, enc, cx),
            )
    return jsonify({'ok': True, 'data': _google_key_status(user_id)})


@prospecting_bp.delete('/google-key')
@auth_required
@role_required(*_ADMIN_ROLES)
def delete_google_key():
    _ensure_prospecting_schema()
    user_id = int(g.current_user.get('id') or 0)
    with get_connection() as conn:
        conn.execute('DELETE FROM prospecting_api_keys WHERE user_id = %s', (user_id,))
    return jsonify({'ok': True, 'data': _google_key_status(user_id)})


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
    locations = _prospecting_locations(body)
    qualifiers = body.get('qualifiers') or []
    limit = body.get('limit') or 30
    recent_months = body.get('recent_months') or 0
    advanced_filters = body.get('advanced_filters') or {}
    if not isinstance(advanced_filters, dict):
        advanced_filters = {}
    if recent_months and not advanced_filters.get('recent_months'):
        advanced_filters['recent_months'] = int(recent_months)
    if not isinstance(qualifiers, list):
        qualifiers = []

    if not category_keys:
        raise ValueError('Оберіть категорію.')
    if not locations:
        raise ValueError('Вкажіть країну.')
    if any(exclusion_reason(location) for location in locations):
        raise ValueError('Пошук у РФ вимкнено політикою CRM.')

    results = []
    location_errors = []
    per_location_limit = max(5, min(int(limit), 30 if len(locations) > 1 else int(limit)))
    for location in locations:
        try:
            current = prospecting_service.search_businesses(
                category_keys, location['country'], location['city'], [str(q) for q in qualifiers],
                per_location_limit, int(recent_months), advanced_filters,
            )
            for candidate in current.get('candidates') or []:
                candidate.setdefault('country', location['country'])
                candidate.setdefault('search_location', location['label'])
            results.append(current)
        except ProspectingError as exc:
            location_errors.append({'location': location['label'], 'message': exc.message})
    if not results:
        detail = location_errors[0]['message'] if location_errors else 'Нічого не знайдено.'
        raise ProspectingError(detail)
    result = _merge_location_results(results, location_errors)
    before_policy = len(result.get('candidates') or [])
    result['candidates'] = [c for c in (result.get('candidates') or []) if is_allowed_lead(c)]
    result['excluded_policy'] = before_policy - len(result['candidates'])
    if bool(body.get('exclude_existing')):
        result['candidates'], result['excluded_existing'] = _filter_existing_candidates(result['candidates'])
    return result


def _prospecting_locations(body: dict) -> list[dict]:
    """Normalize a single location or a batch of up to eight market locations."""
    raw = body.get('locations')
    locations = []
    if isinstance(raw, list):
        for item in raw[:8]:
            if not isinstance(item, dict):
                continue
            country = str(item.get('country') or '').strip()
            city = str(item.get('city') or '').strip()
            if country:
                locations.append({'country': country, 'city': city, 'label': ', '.join(p for p in (city, country) if p)})
    if not locations:
        country = str(body.get('country') or '').strip()
        city = str(body.get('city') or '').strip()
        if country:
            locations.append({'country': country, 'city': city, 'label': ', '.join(p for p in (city, country) if p)})
    return locations


def _candidate_identity_aliases(candidate: dict) -> list[str]:
    """Independent identity signals used to link cross-source candidates."""
    phone = _normalize_phone(candidate.get('phone') or '')
    domain = _domain(candidate.get('website_url') or '')
    instagram = str(candidate.get('instagram') or '').strip().lower().lstrip('@')
    name = re.sub(r'[^\w]+', '', str(candidate.get('business_name') or '').lower(), flags=re.UNICODE)
    city = re.sub(r'[^\w]+', '', str(candidate.get('city_area') or '').lower(), flags=re.UNICODE)
    return [value for value in (
        f'phone:{phone}' if phone else '',
        f'domain:{domain}' if domain else '',
        f'instagram:{instagram}' if instagram else '',
        f'name:{name}|{city}' if name else '',
    ) if value]


def _merge_location_results(results: list[dict], errors: list[dict] | None = None) -> dict:
    merged = []
    identity_map: dict[str, dict] = {}
    total_found = 0
    areas = []
    excluded_existing = 0
    filter_before = 0
    filter_after = 0
    filter_unknown = 0
    filter_active = 0
    market_contexts = []
    query_plan = []
    passes_completed = 0
    for result in results:
        total_found += int(result.get('total_found') or 0)
        excluded_existing += int(result.get('excluded_existing') or 0)
        summary = result.get('filter_summary') or {}
        filter_before += int(summary.get('before') or 0)
        filter_after += int(summary.get('after') or 0)
        filter_unknown += int(summary.get('unknown') or 0)
        filter_active = max(filter_active, int(summary.get('active') or 0))
        if result.get('market_context'):
            market_contexts.append(result['market_context'])
        query_plan.extend(result.get('query_plan') or [])
        passes_completed += int(result.get('passes_completed') or 0)
        if result.get('area'):
            areas.append(str(result['area']))
        for candidate in result.get('candidates') or []:
            candidate_aliases = _candidate_identity_aliases(candidate)
            existing = next((identity_map[value] for value in candidate_aliases if value in identity_map), None)
            if existing is not None:
                for field in ('phone', 'email', 'website_url', 'instagram', 'facebook', 'thumbnail'):
                    if not existing.get(field) and candidate.get(field):
                        existing[field] = candidate[field]
                for value in candidate_aliases:
                    identity_map[value] = existing
                continue
            merged.append(candidate)
            for value in candidate_aliases:
                identity_map[value] = candidate
    merged.sort(key=lambda c: -int(c.get('score') or 0))
    return {
        'area': ' · '.join(areas[:4]) + (f' +{len(areas) - 4}' if len(areas) > 4 else ''),
        'areas': areas,
        'candidates': merged,
        'total_found': total_found,
        'excluded_existing': excluded_existing,
        'location_errors': errors or [],
        'partial': bool(errors),
        'market_contexts': market_contexts,
        'query_plan': query_plan,
        'passes_completed': passes_completed,
        'filter_summary': {
            'active': filter_active, 'before': filter_before,
            'after': filter_after, 'unknown': filter_unknown,
        },
    }


@prospecting_bp.post('/search')
@auth_required
@role_required(*_ADMIN_ROLES)
def search():
    body = request.get_json(silent=True) or {}
    started_at = time.monotonic()
    try:
        result = _perform_osm_search(body)
    except ValueError as exc:
        _record_search_run('osm', body, error=str(exc), started_at=started_at)
        return api_error(str(exc), 400)
    except ProspectingError as exc:
        _record_search_run('osm', body, error=exc.message, started_at=started_at)
        return api_error(exc.message, 502)
    _record_search_run('osm', body, result=result, started_at=started_at)
    return jsonify({'ok': True, 'data': result})


def _google_discovery_plan(body: dict, category_keys: list[str], location: dict,
                           advanced: dict) -> list[dict]:
    """Build a compact set of materially different discovery hypotheses.

    Google CSE is quota-based, so "deep" means four purposeful passes, not
    dozens of near-identical keyword permutations. Every pass is labelled and
    later shown as evidence on the candidate card.
    """
    lang = str(body.get('lang') or '').strip()
    custom_query = str(body.get('custom_query') or '').strip()
    depth = str(body.get('discovery_depth') or 'standard').strip().lower()
    max_passes = {'economy': 1, 'standard': 2, 'deep': 4}.get(depth, 2)
    place = ' '.join(p for p in (location.get('city'), location.get('country')) if p).strip()
    local_terms: list[str] = []
    english_terms: list[str] = []
    labels: list[str] = []
    for key in category_keys:
        variants = category_search_variants(key, lang)
        if variants:
            local_terms.append(variants[0])
            english_terms.append(next((v for v in variants[1:] if v != variants[0]), variants[0]))
        if CATEGORIES.get(key):
            labels.append(CATEGORIES[key]['label'])

    def group(values: list[str]) -> str:
        unique = list(dict.fromkeys(v for v in values if v))
        if not unique:
            return ''
        return unique[0] if len(unique) == 1 else '(' + ' OR '.join(f'"{v}"' for v in unique) + ')'

    category_phrase = group(local_terms or labels) or custom_query
    base = custom_query or ' '.join(p for p in (category_phrase, place) if p)
    plan = [{'kind': 'market', 'label': 'Мова ринку', 'query': base}]
    if max_passes >= 2:
        english = ' '.join(p for p in (group(english_terms or local_terms or labels), place, '(official OR contact OR booking)') if p)
        if english.lower() != base.lower():
            plan.append({'kind': 'direct', 'label': 'Офіційні сторінки й контакти', 'query': english})

    opening_status = str(advanced.get('opening_status') or 'any')
    recent_months = int(advanced.get('recent_months') or 0)
    opening_year = int(advanced.get('opening_year') or 0)
    opening_month = int(advanced.get('opening_month') or 0)
    freshness_requested = bool(opening_status != 'any' or recent_months or opening_year or opening_month)
    if max_passes >= 3 or freshness_requested:
        if opening_status == 'planned':
            freshness = '("opening soon" OR "coming soon" OR "grand opening")'
        elif opening_status == 'recent' or recent_months:
            freshness = '("newly opened" OR "now open" OR "grand opening")'
        else:
            freshness = '("new opening" OR "now open" OR "coming soon")'
        temporal = str(opening_year or date.today().year)
        if opening_month:
            months = ('', 'January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December')
            temporal = f'"{months[opening_month]}" {temporal}'
        fresh_item = {
            'kind': 'fresh', 'label': 'Нові та майбутні відкриття',
            'query': ' '.join(p for p in (category_phrase, place, freshness, temporal) if p),
        }
        plan.insert(1 if freshness_requested else len(plan), fresh_item)
    social_requested = bool(set(str(v) for v in (advanced.get('digital_modes') or [])) & {
        'instagram_present', 'instagram_no_site', 'social_only',
    })
    if max_passes >= 4 or social_requested:
        social_item = {
            'kind': 'social', 'label': 'Instagram-профілі',
            'query': ' '.join(p for p in ('site:instagram.com', category_phrase, place) if p),
            'allow_platforms': True,
        }
        plan.insert(1 if social_requested else len(plan), social_item)

    deduped = []
    seen = set()
    for item in plan:
        normalized = re.sub(r'\s+', ' ', item['query'].lower()).strip()
        if normalized and normalized not in seen:
            seen.add(normalized)
            deduped.append(item)
    return deduped[:max_passes]


def _merge_google_passes(pass_results: list[tuple[dict, dict]], final_limit: int) -> dict:
    """Fuse candidates found by several hypotheses and retain provenance."""
    merged: dict[str, dict] = {}
    aliases: dict[str, str] = {}
    total_found = 0
    queries = []
    for plan_item, result in pass_results:
        total_found += int(result.get('total_found') or 0)
        queries.append({'kind': plan_item['kind'], 'label': plan_item['label'], 'query': result.get('query_used') or plan_item['query']})
        for candidate in result.get('candidates') or []:
            phone_key = _normalize_phone(candidate.get('phone') or '')
            domain_key = _domain(candidate.get('website_url') or '')
            instagram_key = str(candidate.get('instagram') or '').lower().lstrip('@')
            name_key = re.sub(r'[^\w]+', '', str(candidate.get('business_name') or '').lower(), flags=re.UNICODE)
            city_key = re.sub(r'[^\w]+', '', str(candidate.get('city_area') or '').lower(), flags=re.UNICODE)
            candidate_aliases = [
                f'phone:{phone_key}' if phone_key else '',
                f'domain:{domain_key}' if domain_key else '',
                f'instagram:{instagram_key}' if instagram_key else '',
                f'name:{name_key}|{city_key}' if name_key else '',
            ]
            candidate_aliases = [value for value in candidate_aliases if value]
            if not candidate_aliases:
                continue
            key = next((aliases[value] for value in candidate_aliases if value in aliases), candidate_aliases[0])
            evidence = {'kind': plan_item['kind'], 'label': plan_item['label']}
            if key not in merged:
                candidate['discovery_evidence'] = [evidence]
                candidate['discovery_matches'] = 1
                merged[key] = candidate
                for value in candidate_aliases:
                    aliases[value] = key
                continue
            current = merged[key]
            for value in candidate_aliases:
                aliases[value] = key
            if not any(item.get('kind') == evidence['kind'] for item in current['discovery_evidence']):
                current['discovery_evidence'].append(evidence)
            for field in ('phone', 'email', 'website_url', 'instagram', 'thumbnail', 'snippet'):
                if not current.get(field) and candidate.get(field):
                    current[field] = candidate[field]
            current['discovery_matches'] = len(current['discovery_evidence'])
            current['score'] = max(int(current.get('score') or 0), int(candidate.get('score') or 0))

    candidates = list(merged.values())
    for candidate in candidates:
        matches = int(candidate.get('discovery_matches') or 1)
        has_direct_contact = bool(candidate.get('phone') or candidate.get('email'))
        candidate['score'] = int(candidate.get('score') or 0) + min(3, matches - 1) + int(has_direct_contact)
        candidate['discovery_confidence'] = 'high' if matches >= 3 else ('good' if matches >= 2 else 'single')
        reasons = list(candidate.get('match_reasons') or [])
        if matches >= 2:
            reasons.append(f'Знайдено {matches} різними пошуковими проходами')
        if has_direct_contact:
            reasons.append('Є прямий контакт у відкритому джерелі')
        candidate['match_reasons'] = list(dict.fromkeys(reasons))
    candidates.sort(key=lambda c: (-int(c.get('score') or 0), -int(c.get('discovery_matches') or 0)))
    return {
        'candidates': candidates[:max(1, final_limit)],
        'total_found': total_found,
        'query_plan': queries,
        'passes_completed': len(pass_results),
    }


def _perform_google_search(body: dict, creds: tuple[str, str] = ('', '')) -> dict:
    """Спільна логіка для POST /search-google і запланованих пошуків
    (див. _perform_osm_search). `creds` — (api_key, cx) поточного користувача;
    порожні → глобальний .env-fallback у самому сервісі."""
    category_keys = body.get('category_keys')
    if isinstance(category_keys, list) and category_keys:
        category_keys = [str(k).strip() for k in category_keys if str(k).strip()]
    else:
        single = str(body.get('category_key') or '').strip()
        category_keys = [single] if single else []
    lang = str(body.get('lang') or '').strip()
    category_labels = [category_search_term(k, lang) for k in category_keys if k in CATEGORIES]
    if len(category_labels) > 1:
        category_label = '(' + ' OR '.join(category_labels) + ')'
    else:
        category_label = (category_labels[0] if category_labels else '') or str(body.get('query') or '').strip()
    category_key = category_keys[0] if category_keys else ''
    locations = _prospecting_locations(body)
    country = locations[0]['country'] if locations else ''
    city = locations[0]['city'] if locations else ''

    custom_query = str(body.get('custom_query') or '').strip()
    if not custom_query and not category_label:
        raise ValueError('Оберіть категорію, або вкажіть власний запит.')
    if not custom_query and not country and not city:
        raise ValueError('Вкажіть країну або місто.')

    api_key, cx = creds

    search_locations = locations or [{'country': country, 'city': city, 'label': ', '.join(p for p in (city, country) if p)}]
    if any(exclusion_reason(location) for location in search_locations):
        raise ValueError('Пошук у РФ вимкнено політикою CRM.')
    results = []
    location_errors = []
    depth = str(body.get('discovery_depth') or 'standard')
    depth_cap = {'economy': 10, 'standard': 20, 'deep': 40}.get(depth, 20)
    batch_cap = min(depth_cap, 20) if len(search_locations) > 1 else depth_cap
    per_location_limit = max(5, min(int(body.get('limit') or 20), batch_cap))
    advanced = body.get('advanced_filters') if isinstance(body.get('advanced_filters'), dict) else {}
    digital_modes = set(str(v) for v in (advanced.get('digital_modes') or []))
    zone_terms = {
        'resort': 'resort', 'coastal': 'coastal OR marina', 'mountain': 'mountain',
        'ski': 'ski', 'spa': 'spa OR thermal', 'historic': 'historic OR old town',
    }
    web_modifiers = []
    for zone in advanced.get('zone_types') or []:
        if zone_terms.get(str(zone)):
            web_modifiers.append(zone_terms[str(zone)])
    instagram_search = bool(digital_modes & {'instagram_present', 'instagram_no_site', 'social_only'})
    for location in search_locations:
        plan = _google_discovery_plan(body, category_keys, location, advanced)
        pass_results: list[tuple[dict, dict]] = []
        pass_errors = []
        for plan_item in plan:
            query_text = plan_item['query']
            if web_modifiers:
                query_text = f'{query_text} {" ".join(web_modifiers)}'.strip()
            try:
                current = google_search_service.search_businesses(
                    query_text=query_text,
                    category_label=category_label,
                    category_key=category_key,
                    country=location['country'],
                    city=location['city'],
                    lang=lang,
                    gl=str(body.get('gl') or '').strip(),
                    date_restrict=str(body.get('date_restrict') or '').strip(),
                    exact_terms=str(body.get('exact_terms') or '').strip(),
                    exclude_terms=str(body.get('exclude_terms') or '').strip(),
                    exclude_platforms=False if (instagram_search or plan_item.get('allow_platforms')) else bool(body.get('exclude_platforms', True)),
                    # One CSE page per hypothesis. Depth controls breadth;
                    # pagination would multiply quota without adding diversity.
                    limit=10,
                    api_key=api_key, cx=cx,
                )
                for candidate in current.get('candidates') or []:
                    candidate.setdefault('country', location['country'])
                    candidate.setdefault('search_location', location['label'])
                pass_results.append((plan_item, current))
            except GoogleSearchError as exc:
                pass_errors.append(exc.message)
        if pass_results:
            current = _merge_google_passes(pass_results, per_location_limit)
            current['area'] = location['label']
            current['discovery_depth'] = str(body.get('discovery_depth') or 'standard')
            current['pass_errors'] = pass_errors
            results.append(current)
        else:
            location_errors.append({
                'location': location['label'],
                'message': pass_errors[0] if pass_errors else 'Веб-пошук не повернув результатів.',
            })
    if not results:
        raise GoogleSearchError(location_errors[0]['message'] if location_errors else 'Веб-пошук не повернув результатів.')
    result = _merge_location_results(results, location_errors)
    before_policy = len(result.get('candidates') or [])
    result['candidates'] = [c for c in (result.get('candidates') or []) if is_allowed_lead(c)]
    result['excluded_policy'] = before_policy - len(result['candidates'])
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
    started_at = time.monotonic()
    creds = _resolve_google_creds(int(g.current_user.get('id') or 0))
    try:
        result = _perform_google_search(body, creds)
    except ValueError as exc:
        _record_search_run('google', body, error=str(exc), started_at=started_at)
        return api_error(str(exc), 400)
    except GoogleSearchError as exc:
        _record_search_run('google', body, error=exc.message, started_at=started_at)
        configured = google_search_service.is_configured(*creds)
        return api_error(exc.message, 502 if configured else 503)
    _record_search_run('google', body, result=result, started_at=started_at)
    return jsonify({'ok': True, 'data': result})


def _perform_both_search(body: dict, creds: tuple[str, str] = ('', '')) -> dict:
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

    if google_search_service.is_configured(*creds):
        try:
            google_result = _perform_google_search(body, creds)
        except ValueError:
            pass  # Google не обов'язковий у "обидва" — просто бракує його полів (custom_query тощо)
        except GoogleSearchError as exc:
            google_error = exc.message

    if osm_result is None and google_result is None:
        raise ValueError(osm_error or google_error or 'Не вдалося виконати пошук.')

    merged: list[dict] = []
    identity_map: dict[str, dict] = {}
    for src_result in (osm_result, google_result):
        if not src_result:
            continue
        for c in src_result.get('candidates') or []:
            c.setdefault('source', 'osm')
            candidate_aliases = _candidate_identity_aliases(c)
            existing = next((identity_map[value] for value in candidate_aliases if value in identity_map), None)
            if existing is not None:
                for field in ('phone', 'email', 'website_url', 'instagram', 'facebook', 'thumbnail'):
                    if not existing.get(field) and c.get(field):
                        existing[field] = c[field]
                evidence = list(existing.get('source_evidence') or [existing.get('source') or 'osm'])
                evidence.append(c.get('source') or 'osm')
                existing['source_evidence'] = list(dict.fromkeys(evidence))
                for value in candidate_aliases:
                    identity_map[value] = existing
                continue
            merged.append(c)
            for value in candidate_aliases:
                identity_map[value] = c
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
        'location_errors': (osm_result or {}).get('location_errors', []) + (google_result or {}).get('location_errors', []),
        'partial': bool((osm_result or {}).get('partial') or (google_result or {}).get('partial') or osm_error or google_error),
    }


@prospecting_bp.post('/search-both')
@auth_required
@role_required(*_ADMIN_ROLES)
def search_both():
    body = request.get_json(silent=True) or {}
    started_at = time.monotonic()
    creds = _resolve_google_creds(int(g.current_user.get('id') or 0))
    try:
        result = _perform_both_search(body, creds)
    except ValueError as exc:
        _record_search_run('both', body, error=str(exc), started_at=started_at)
        return api_error(str(exc), 502)
    _record_search_run('both', body, result=result, started_at=started_at)
    return jsonify({'ok': True, 'data': result})


@prospecting_bp.post('/enrich')
@auth_required
@role_required(*_ADMIN_ROLES)
def enrich():
    """Find a website when needed, then verify public contact pages directly."""
    body = request.get_json(silent=True) or {}
    business_name = str(body.get('business_name') or '').strip()
    if not business_name:
        return api_error('Вкажіть назву бізнесу.', 400)
    website_url = str(body.get('website_url') or '').strip()
    key, cx = _resolve_google_creds(int(g.current_user.get('id') or 0))
    data: dict = {}
    google_error = ''
    if not website_url or not google_search_service.is_configured(key, cx):
        if google_search_service.is_configured(key, cx):
            try:
                data = google_search_service.enrich_business(
                    business_name=business_name,
                    city=str(body.get('city') or '').strip(),
                    country=str(body.get('country') or '').strip(),
                    api_key=key, cx=cx,
                )
                website_url = website_url or data.get('website_url') or ''
            except GoogleSearchError as exc:
                google_error = exc.message
        elif not website_url:
            return api_error('Для цього кандидата немає сайту, а Google-пошук ще не налаштований.', 503)
    if website_url:
        try:
            scraped = website_enrichment_service.enrich_website(
                website_url, force_refresh=bool(body.get('force_refresh')),
            )
        except website_enrichment_service.WebsiteEnrichmentError as exc:
            if not data:
                return api_error(str(exc), 502)
            scraped = {'errors': [str(exc)], 'pages_checked': 0, 'sources': [], 'evidence': []}
        for field in ('phone', 'email', 'instagram', 'facebook', 'linkedin', 'whatsapp', 'description', 'address'):
            if scraped.get(field):
                data[field] = scraped[field]
        data['website_url'] = scraped.get('website_url') or website_url
        data['pages_checked'] = scraped.get('pages_checked', 0)
        data['blocked_by_robots'] = bool(scraped.get('blocked_by_robots'))
        data['sources'] = scraped.get('sources') or []
        data['evidence'] = scraped.get('evidence') or []
        data['crawl_errors'] = scraped.get('errors') or []
        data['cache_hit'] = bool(scraped.get('cache_hit'))
        data['structured_data_found'] = bool(scraped.get('structured_data_found'))
        data['cache_layer'] = scraped.get('cache_layer') or ''
        data['cache_age_seconds'] = int(scraped.get('cache_age_seconds') or 0)
        data['contact_quality_score'] = int(scraped.get('contact_quality_score') or 0)
        data['opening_hours'] = scraped.get('opening_hours') or []
        data['schema_types'] = scraped.get('schema_types') or []
        data['site_languages'] = scraped.get('site_languages') or []
        data['detected_business_name'] = scraped.get('detected_business_name') or ''
    if google_error:
        data['google_error'] = google_error
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


def _duplicate_reason(conn, *, phone: str, website: str, name: str, city: str) -> str:
    """Human-readable preflight reason for UI. Kept separate from
    _find_duplicate so existing import behavior stays untouched."""
    norm_phone = _normalize_phone(phone)
    if norm_phone and len(norm_phone) >= 7:
        rows = conn.execute("SELECT phone, whatsapp_viber FROM leads WHERE phone != '' OR whatsapp_viber != ''").fetchall()
        for r in (rows or []):
            r = dict(r)
            if _normalize_phone(r.get('phone')) == norm_phone or _normalize_phone(r.get('whatsapp_viber')) == norm_phone:
                return 'duplicate_phone'

    dom = _domain(website)
    if dom:
        rows = conn.execute("SELECT website_url FROM leads WHERE website_url != ''").fetchall()
        for r in (rows or []):
            if _domain(dict(r).get('website_url')) == dom:
                return 'duplicate_domain'

    name_l = (name or '').strip().lower()
    city_l = (city or '').strip().lower()
    if name_l:
        row = conn.execute(
            'SELECT id FROM leads WHERE LOWER(business_name) = %s AND LOWER(COALESCE(city_area, %s)) = %s LIMIT 1',
            (name_l, '', city_l),
        ).fetchone()
        if row:
            return 'duplicate_name_city'
    return ''


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


@prospecting_bp.post('/import-preview')
@auth_required
@role_required(*_ADMIN_ROLES)
def import_candidates_preview():
    """Dry-run before import: shows exactly what will be created/skipped.

    This gives managers confidence before bulk adding search results and makes
    the dedupe rules visible instead of feeling like records randomly vanish.
    """
    _ensure_leads_schema()
    body = request.get_json(silent=True) or {}
    candidates = body.get('candidates') or []
    if not isinstance(candidates, list) or not candidates:
        return api_error('Немає кандидатів для перевірки.', 400)

    rows = []
    summary = {'new': 0, 'duplicate': 0, 'invalid': 0, 'total': 0}
    with get_connection() as conn:
        for idx, cand in enumerate(candidates[:100]):
            if not isinstance(cand, dict):
                summary['invalid'] += 1
                rows.append({'idx': idx, 'status': 'invalid', 'reason': 'Некоректний рядок'})
                continue
            name = str(cand.get('business_name') or '').strip()
            phone = str(cand.get('phone') or '').strip()
            website = str(cand.get('website_url') or '').strip()
            city = str(cand.get('city_area') or '').strip()
            if not name:
                summary['invalid'] += 1
                rows.append({
                    'idx': idx, 'status': 'invalid', 'reason': 'Немає назви бізнесу',
                    'business_name': '', 'city_area': city, 'website_url': website, 'phone': phone,
                })
                continue
            policy_reason = exclusion_reason(cand)
            if policy_reason:
                summary['invalid'] += 1
                rows.append({
                    'idx': idx, 'status': 'invalid', 'reason': policy_reason,
                    'business_name': name, 'city_area': city, 'website_url': website, 'phone': phone,
                })
                continue
            dupe = _duplicate_reason(conn, phone=phone, website=website, name=name, city=city)
            if dupe:
                summary['duplicate'] += 1
                rows.append({
                    'idx': idx, 'status': 'duplicate', 'reason': dupe,
                    'business_name': name, 'city_area': city, 'website_url': website, 'phone': phone,
                    'source': str(cand.get('source') or 'osm'),
                })
            else:
                summary['new'] += 1
                rows.append({
                    'idx': idx, 'status': 'new', 'reason': '',
                    'business_name': name, 'city_area': city, 'website_url': website, 'phone': phone,
                    'source': str(cand.get('source') or 'osm'),
                })
    summary['total'] = len(rows)
    return jsonify({'ok': True, 'data': {'summary': summary, 'rows': rows}})


@prospecting_bp.post('/import')
@auth_required
@role_required(*_ADMIN_ROLES)
def import_candidates():
    """Масово додає обраних кандидатів у роботу як лідів, пропускаючи дублікати."""
    _ensure_leads_schema()
    body = request.get_json(silent=True) or {}
    candidates = body.get('candidates') or []
    owner = str(body.get('owner') or '').strip()

    # менеджер забирає знайдених клієнтів лише собі, не колезі
    _user = getattr(g, 'current_user', None) or {}
    if _user.get('role') == 'manager':
        owner = (_user.get('crm_owner') or '').strip()

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
            if not name or exclusion_reason(cand):
                skipped += 1
                continue
            phone = str(cand.get('phone') or '').strip()
            website = str(cand.get('website_url') or '').strip()
            city = str(cand.get('city_area') or '').strip()

            if _find_duplicate(conn, phone=phone, website=website, name=name, city=city):
                skipped += 1
                continue

            source_kind = str(cand.get('source') or '').strip()
            is_google = source_kind == 'google'
            is_opening = source_kind == 'opening_registry'
            source_label = 'Реєстр відкриттів' if is_opening else ('Google' if is_google else 'OSM')

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
                'source_bucket': 'opening_registry' if is_opening else ('prospecting_google' if is_google else 'prospecting_osm'),
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
    # A platform host is not a business identity: otherwise every Instagram
    # profile collapses into one "instagram.com" candidate.
    dom = _domain(cand.get('website_url') or '')
    if dom:
        return f'domain:{dom}'
    instagram = str(cand.get('instagram') or '').strip().lower().lstrip('@')
    if instagram:
        return f'instagram:{instagram}'
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

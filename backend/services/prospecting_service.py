"""Конструктор пошуку потенційних клієнтів для менеджерів ARM CRM.

Джерело — OpenStreetMap (безкоштовно, без ключа, офіційні API, НЕ скрапінг):
  * Nominatim — геокодинг «Країна, Місто» → OSM-area для пошуку в межах.
  * Overpass — власне пошук бізнесів за тегами категорії в цій area.

Важливо про якість даних: OSM — community-дані. Покриття добре в Європі,
слабше в інших регіонах; телефон/сайт присутні не завжди. Тому «немає сайту»
тощо — це weak-сигнали (відсутність тега в OSM ≠ відсутність у реальності),
і в UI вони подаються як «схоже, немає», а не як факт.
"""
from __future__ import annotations

import re
import threading
import time
from datetime import date

import requests

from .prospecting_categories import CATEGORIES, qualifier_signals, suggested_offer_for

NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
# Overpass — публічний ресурс, дзеркала регулярно перевантажені (504/429).
# Пробуємо кілька офіційних дзеркал по черзі, щоб пошук не падав через
# тимчасову недоступність одного з них.
OVERPASS_MIRRORS = (
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
)
# Overpass/Nominatim usage policy: чемний User-Agent, що ідентифікує застосунок.
_USER_AGENT = 'ARM-CRM-prospecting/1.0 (https://bank.munister.com.ua)'
_GEOCODE_TIMEOUT = 15
_OVERPASS_TIMEOUT = 55  # Overpass буває повільним; тримаємо під gunicorn 60s
_MAX_LIMIT = 60

# Кеш однакових запитів (Overpass — публічний ресурс на всіх користувачів
# світу; кешування знижує навантаження й пришвидшує повторні пошуки).
_CACHE_TTL = 3600
_cache_lock = threading.Lock()
_geocode_cache: dict[str, tuple[float, dict | None]] = {}
_search_cache: dict[str, tuple[float, list]] = {}


class ProspectingError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def _headers() -> dict:
    return {'User-Agent': _USER_AGENT}


def geocode_area(country: str, city: str = '') -> dict | None:
    """Повертає {'osm_type', 'osm_id', 'area_id', 'display_name'} для області
    пошуку, або None якщо не знайдено. area_id — те, що очікує Overpass:
    3600000000 + osm_id для relation, 2400000000 + osm_id для way."""
    query = ', '.join(p for p in (city.strip(), country.strip()) if p)
    if not query:
        raise ProspectingError('Вкажіть країну (і, за бажанням, місто).')

    cache_key = query.lower()
    now = time.time()
    with _cache_lock:
        cached = _geocode_cache.get(cache_key)
        if cached and (now - cached[0]) < _CACHE_TTL:
            return cached[1]

    try:
        resp = requests.get(
            NOMINATIM_URL,
            params={'q': query, 'format': 'json', 'limit': 1},
            headers=_headers(), timeout=_GEOCODE_TIMEOUT,
        )
    except requests.RequestException as exc:
        raise ProspectingError(f'Не вдалося звʼязатися з геокодером: {exc}') from exc
    if resp.status_code >= 400:
        raise ProspectingError(f'Геокодер повернув HTTP {resp.status_code}.')

    results = resp.json()
    area = None
    if results:
        r = results[0]
        osm_type = r.get('osm_type')
        osm_id = int(r.get('osm_id') or 0)
        # Overpass area id: relations offset by 3.6e9, ways by 2.4e9. Nodes
        # cannot be areas, so a node result yields no searchable area.
        if osm_type == 'relation':
            area_id = 3600000000 + osm_id
        elif osm_type == 'way':
            area_id = 2400000000 + osm_id
        else:
            area_id = 0
        if area_id:
            area = {
                'osm_type': osm_type, 'osm_id': osm_id, 'area_id': area_id,
                'display_name': r.get('display_name') or query,
            }

    with _cache_lock:
        _geocode_cache[cache_key] = (now, area)
    return area


def _build_overpass_query(area_id: int, category_key: str, limit: int) -> str:
    cat = CATEGORIES.get(category_key)
    if not cat:
        raise ProspectingError('Невідома категорія.')
    # Кожен OSM-фільтр категорії шукаємо і як node, і як way (багато бізнесів
    # у OSM — це будівлі-way, а не точки-node).
    parts = []
    for f in cat['filters']:
        parts.append(f'  node[{f}](area.searchArea);')
        parts.append(f'  way[{f}](area.searchArea);')
    union = '\n'.join(parts)
    return (
        f'[out:json][timeout:{_OVERPASS_TIMEOUT - 5}];\n'
        f'area({area_id})->.searchArea;\n'
        f'(\n{union}\n);\n'
        f'out center {limit};'
    )


def _run_overpass(query: str) -> list:
    """Виконує Overpass-запит, пробуючи дзеркала по черзі при 429/504/timeout.
    Кидає ProspectingError лише якщо ЖОДНЕ дзеркало не відповіло."""
    last_error = ''
    for url in OVERPASS_MIRRORS:
        try:
            resp = requests.post(url, data={'data': query}, headers=_headers(), timeout=_OVERPASS_TIMEOUT)
        except requests.RequestException as exc:
            last_error = str(exc)
            continue
        # 429 (rate limit) і 504 (gateway timeout) — типові тимчасові стани
        # перевантаженого дзеркала; пробуємо наступне.
        if resp.status_code in (429, 502, 503, 504):
            last_error = f'HTTP {resp.status_code}'
            continue
        if resp.status_code >= 400:
            last_error = f'HTTP {resp.status_code}'
            continue
        try:
            return resp.json().get('elements', [])
        except ValueError:
            last_error = 'некоректна відповідь'
            continue
    raise ProspectingError(
        f'Усі дзеркала Overpass зараз недоступні (остання помилка: {last_error}). Спробуйте за хвилину.'
    )


def _first(value: str | None) -> str:
    """Багато OSM-полів (phone тощо) містять кілька значень через ';' — беремо перше."""
    if not value:
        return ''
    return value.split(';')[0].strip()


def _opened_info(tags: dict) -> dict | None:
    """Витягує дату відкриття з OSM-тегів (start_date/opening_date), якщо є.
    Ці теги в OSM заповнені РІДКО і лише подекуди — тому це бонус-сигнал «коли
    відомо», а не гарантований фільтр. Формати OSM: 'YYYY', 'YYYY-MM',
    'YYYY-MM-DD'. Повертає {'date', 'months_ago'} або None."""
    raw = _first(tags.get('start_date') or tags.get('opening_date'))
    if not raw:
        return None
    m = re.match(r'^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$', raw)
    if not m:
        return None
    year = int(m.group(1))
    month = int(m.group(2) or 1)
    if not (1900 <= year <= date.today().year and 1 <= month <= 12):
        return None
    today = date.today()
    months_ago = (today.year - year) * 12 + (today.month - month)
    return {'date': raw, 'months_ago': max(0, months_ago)}


def _parse_element(el: dict, category_key: str) -> dict | None:
    tags = el.get('tags') or {}
    name = (tags.get('name') or '').strip()
    if not name:
        return None  # без назви лід марний для outreach

    phone = _first(tags.get('phone') or tags.get('contact:phone'))
    website = _first(tags.get('website') or tags.get('contact:website') or tags.get('url'))
    email = _first(tags.get('email') or tags.get('contact:email'))
    instagram = _first(tags.get('contact:instagram'))

    addr_parts = [tags.get('addr:street'), tags.get('addr:housenumber')]
    street = ' '.join(p for p in addr_parts if p).strip()
    city_area = (tags.get('addr:city') or '').strip()

    signals = qualifier_signals(tags)
    osm_type = el.get('type')
    osm_id = el.get('id')

    return {
        'business_name': name,
        'category': CATEGORIES[category_key]['label'],
        'category_key': category_key,
        'city_area': ' · '.join(p for p in (city_area, street) if p),
        'phone': phone,
        'website_url': website,
        'email': email,
        'instagram': instagram,
        'source_url': f'https://www.openstreetmap.org/{osm_type}/{osm_id}' if osm_type and osm_id else '',
        'osm_ref': f'{osm_type}/{osm_id}' if osm_type and osm_id else '',
        'signals': signals,
        'opened': _opened_info(tags),
        'suggested_first_offer': suggested_offer_for(signals),
    }


def _passes_qualifiers(candidate: dict, required: list[str]) -> bool:
    """Кандидат проходить, якщо ВСІ обрані менеджером квaліфікатори спрацювали."""
    if not required:
        return True
    return all(candidate['signals'].get(q) for q in required)


def search_businesses(category_key: str, country: str, city: str = '',
                      qualifiers: list[str] | None = None, limit: int = 30,
                      recent_months: int = 0) -> dict:
    """Основна точка входу: геокодить область, шукає бізнеси, парсить і фільтрує.

    recent_months > 0 — залишити ЛИШЕ бізнеси з відомою датою відкриття не
    старшою за N місяців (OSM start_date/opening_date; заповнено рідко, тому
    цей фільтр суттєво звужує вибірку — про це чесно попереджаємо в UI).

    Повертає {'area', 'candidates', 'total_found', 'recent_filter_applied'}.
    """
    if category_key not in CATEGORIES:
        raise ProspectingError('Невідома категорія.')
    limit = max(1, min(_MAX_LIMIT, int(limit or 30)))
    qualifiers = [q for q in (qualifiers or []) if q]
    recent_months = max(0, int(recent_months or 0))

    area = geocode_area(country, city)
    if not area:
        raise ProspectingError('Не вдалося знайти таку країну/місто. Спробуйте уточнити.')

    # Кеш пошуку: area + категорія + ліміт (квaліфікатори фільтруємо вже після,
    # щоб не робити окремий Overpass-запит під кожну комбінацію чекбоксів).
    cache_key = f'{area["area_id"]}:{category_key}:{limit}'
    now = time.time()
    with _cache_lock:
        cached = _search_cache.get(cache_key)
        raw = cached[1] if cached and (now - cached[0]) < _CACHE_TTL else None

    if raw is None:
        overpass_query = _build_overpass_query(area['area_id'], category_key, limit)
        elements = _run_overpass(overpass_query)
        raw = []
        for el in elements:
            parsed = _parse_element(el, category_key)
            if parsed:
                raw.append(parsed)
        with _cache_lock:
            _search_cache[cache_key] = (now, raw)

    candidates = [c for c in raw if _passes_qualifiers(c, qualifiers)]

    if recent_months:
        candidates = [
            c for c in candidates
            if c.get('opened') and c['opened']['months_ago'] <= recent_months
        ]

    # Сортування: спершу бізнеси з відомою датою відкриття (найновіші зверху),
    # потім решта — так «щойно відкриті» видно одразу, коли дані є.
    def _sort_key(c):
        opened = c.get('opened')
        return (0, opened['months_ago']) if opened else (1, 0)
    candidates.sort(key=_sort_key)

    return {
        'area': area['display_name'],
        'candidates': candidates,
        'total_found': len(raw),
        'recent_filter_applied': bool(recent_months),
    }

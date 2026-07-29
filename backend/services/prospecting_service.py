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
_market_context_cache: dict[int, tuple[float, dict]] = {}


class ProspectingError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def _headers() -> dict:
    return {'User-Agent': _USER_AGENT}


def _parse_population(value) -> int | None:
    if value is None:
        return None
    digits = re.sub(r'[^0-9]', '', str(value))
    return int(digits) if digits else None


def _city_size(population: int | None) -> str:
    if population is None:
        return 'unknown'
    if population < 50_000:
        return 'small'
    if population < 250_000:
        return 'medium'
    if population < 1_000_000:
        return 'large'
    return 'metro'


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
            params={
                'q': query, 'format': 'json', 'limit': 5,
                'addressdetails': 1, 'extratags': 1, 'namedetails': 1,
            },
            headers=_headers(), timeout=_GEOCODE_TIMEOUT,
        )
    except requests.RequestException as exc:
        raise ProspectingError(f'Не вдалося звʼязатися з геокодером: {exc}') from exc
    if resp.status_code >= 400:
        raise ProspectingError(f'Геокодер повернув HTTP {resp.status_code}.')

    results = resp.json()
    area = None
    if results:
        r = next((item for item in results if item.get('osm_type') in ('relation', 'way')), results[0])
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
        extra = r.get('extratags') or {}
        population = _parse_population(extra.get('population'))
        if population is None:
            population = next((
                parsed for item in results
                if (parsed := _parse_population((item.get('extratags') or {}).get('population'))) is not None
            ), None)
        place_type = next((
            str(item.get('type')) for item in results
            if str(item.get('type')) in ('hamlet', 'village', 'town', 'city')
        ), str(r.get('type') or r.get('category') or ''))
        inferred_size = {'hamlet': 'small', 'village': 'small', 'town': 'medium'}.get(place_type, 'unknown')
        area = {
            'osm_type': osm_type, 'osm_id': osm_id, 'area_id': area_id,
            'display_name': r.get('display_name') or query,
            'population': population,
            'city_size': _city_size(population) if population is not None else inferred_size,
            'settlement_type': place_type,
            'importance': float(r.get('importance') or 0),
            'wikidata': extra.get('wikidata') or '',
            'latitude': float(r.get('lat') or 0),
            'longitude': float(r.get('lon') or 0),
            'radius_m': 15000 if city.strip() else 50000,
        }

    with _cache_lock:
        _geocode_cache[cache_key] = (now, area)
    return area


def _build_overpass_query(area: dict, category_keys: list[str], limit: int) -> str:
    """Об'єднує OSM-фільтри ВСІХ обраних категорій в один запит (менеджер може
    шукати, напр., салони краси + спортзали одночасно — один Overpass-виклик
    замість кількох). Кожен фільтр шукаємо і як node, і як way (багато
    бізнесів у OSM — це будівлі-way, а не точки-node)."""
    area_id = int(area.get('area_id') or 0)
    if area_id:
        prelude = f'area({area_id})->.searchArea;\n'
        scope = '(area.searchArea)'
    elif area.get('latitude') and area.get('longitude'):
        prelude = ''
        scope = f'(around:{int(area.get("radius_m") or 15000)},{area["latitude"]},{area["longitude"]})'
    else:
        raise ProspectingError('Для цієї локації немає придатної області або координат.')
    parts = []
    for key in category_keys:
        cat = CATEGORIES.get(key)
        if not cat:
            continue
        for f in cat['filters']:
            parts.append(f'  node[{f}]{scope};')
            parts.append(f'  way[{f}]{scope};')
    if not parts:
        raise ProspectingError('Невідома категорія.')
    union = '\n'.join(parts)
    return (
        f'[out:json][timeout:{_OVERPASS_TIMEOUT - 5}];\n'
        f'{prelude}'
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


def _market_context(area: dict, need_zones: bool = False) -> dict:
    """Describe the selected market. Zone labels are evidence-based OSM
    heuristics, not claims about an official resort designation."""
    context = {
        'population': area.get('population'),
        'city_size': area.get('city_size') or 'unknown',
        'settlement_type': area.get('settlement_type') or '',
        'zone_types': [],
        'zone_evidence': {},
        'zone_confidence': 'unknown',
    }
    if not need_zones:
        return context
    area_id = int(area.get('area_id') or 0)
    context_key = area_id or hash((round(float(area.get('latitude') or 0), 3), round(float(area.get('longitude') or 0), 3)))
    now = time.time()
    with _cache_lock:
        cached = _market_context_cache.get(context_key)
        if cached and (now - cached[0]) < 21600:
            return {**context, **cached[1]}
    if area_id:
        prelude, scope = f'area({area_id})->.a;', '(area.a)'
    else:
        prelude = ''
        scope = f'(around:{int(area.get("radius_m") or 15000)},{area["latitude"]},{area["longitude"]})'
    query = (
        f'[out:json][timeout:25];{prelude}('
        f'nwr["tourism"~"resort|hotel|attraction"]{scope};'
        f'nwr["natural"~"beach|peak"]{scope};'
        f'nwr["leisure"="marina"]{scope};'
        f'nwr["piste:type"]{scope};nwr["aerialway"]{scope};'
        f'nwr["amenity"~"spa|public_bath"]{scope};'
        f'nwr["historic"]{scope};);out tags 120;'
    )
    evidence = {'resort': 0, 'hotel': 0, 'attraction': 0, 'coastal': 0,
                'mountain': 0, 'ski': 0, 'spa': 0, 'historic': 0}
    try:
        for el in _run_overpass(query):
            tags = el.get('tags') or {}
            tourism = tags.get('tourism')
            if tourism in evidence:
                evidence[tourism] += 1
            if tags.get('natural') == 'beach' or tags.get('leisure') == 'marina':
                evidence['coastal'] += 1
            if tags.get('natural') == 'peak':
                evidence['mountain'] += 1
            if tags.get('piste:type') or tags.get('aerialway'):
                evidence['ski'] += 1
            if tags.get('amenity') in ('spa', 'public_bath'):
                evidence['spa'] += 1
            if tags.get('historic'):
                evidence['historic'] += 1
    except ProspectingError:
        return context
    zones = []
    if evidence['resort'] or (evidence['hotel'] >= 5 and evidence['attraction'] >= 2):
        zones.append('resort')
    for key in ('coastal', 'mountain', 'ski', 'spa', 'historic'):
        if evidence[key]:
            zones.append(key)
    classified = {
        'zone_types': zones,
        'zone_evidence': evidence,
        'zone_confidence': 'strong' if any(evidence[k] >= 3 for k in evidence) else ('limited' if zones else 'unknown'),
    }
    with _cache_lock:
        _market_context_cache[context_key] = (now, classified)
    return {**context, **classified}


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
    day = int(m.group(3) or 1)
    if not (1900 <= year <= date.today().year + 2 and 1 <= month <= 12 and 1 <= day <= 31):
        return None
    today = date.today()
    delta_months = (today.year - year) * 12 + (today.month - month)
    return {
        'date': raw, 'year': year, 'month': month,
        'precision': 'day' if m.group(3) else ('month' if m.group(2) else 'year'),
        'status': 'planned' if delta_months < 0 else 'opened',
        'months_ago': max(0, delta_months),
        'months_from_now': max(0, -delta_months),
    }


def _match_category(tags: dict, category_keys: list[str]) -> tuple[str, str]:
    """При мультикатегорійному пошуку визначає, ЯКА саме з обраних категорій
    спрацювала для цього елемента (по тегу, що реально збігся), щоб картка
    показувала точну категорію, а не просто перелік усіх обраних."""
    for key in category_keys:
        cat = CATEGORIES.get(key)
        if not cat:
            continue
        for f in cat['filters']:
            tag_key, _, tag_val = f.partition('=')
            if tags.get(tag_key) == tag_val:
                return key, cat['label']
    key = category_keys[0] if category_keys else ''
    return key, CATEGORIES.get(key, {}).get('label', '')


def _parse_element(el: dict, category_keys: list[str]) -> dict | None:
    tags = el.get('tags') or {}
    name = (tags.get('name') or '').strip()
    if not name:
        return None  # без назви лід марний для outreach

    phone = _first(tags.get('phone') or tags.get('contact:phone'))
    website = _first(tags.get('website') or tags.get('contact:website') or tags.get('url'))
    email = _first(tags.get('email') or tags.get('contact:email'))
    instagram = _first(tags.get('contact:instagram'))
    facebook = _first(tags.get('contact:facebook') or tags.get('facebook'))

    addr_parts = [tags.get('addr:street'), tags.get('addr:housenumber')]
    street = ' '.join(p for p in addr_parts if p).strip()
    city_area = (tags.get('addr:city') or '').strip()

    signals = qualifier_signals(tags)
    osm_type = el.get('type')
    osm_id = el.get('id')
    category_key, category_label = _match_category(tags, category_keys)
    opened = _opened_info(tags)
    center = el.get('center') or {}
    latitude = el.get('lat') if el.get('lat') is not None else center.get('lat')
    longitude = el.get('lon') if el.get('lon') is not None else center.get('lon')

    return {
        'business_name': name,
        'category': category_label,
        'category_key': category_key,
        'city_area': ' · '.join(p for p in (city_area, street) if p),
        'phone': phone,
        'website_url': website,
        'email': email,
        'instagram': instagram,
        'facebook': facebook,
        'source_url': f'https://www.openstreetmap.org/{osm_type}/{osm_id}' if osm_type and osm_id else '',
        'osm_ref': f'{osm_type}/{osm_id}' if osm_type and osm_id else '',
        'latitude': latitude,
        'longitude': longitude,
        'signals': signals,
        'opened': opened,
        'digital_profile': {
            'instagram_present': bool(instagram),
            'instagram_no_site': bool(instagram and not website),
            'social_only': bool((instagram or facebook) and not website),
            'no_social': not bool(instagram or facebook),
            'contact_ready': bool(phone or email),
        },
        'suggested_first_offer': suggested_offer_for(signals),
        'score': _lead_score(signals, opened),
    }


def _lead_score(signals: dict, opened: dict | None) -> int:
    """Орієнтовна «гарячість» ліда для агенції: більше відсутніх каналів
    присутності = більше причин достукатись. Свіжо відкритий бізнес — бонус
    (ще не встиг обрости підрядниками)."""
    score = 3 * bool(signals.get('no_website')) + bool(signals.get('no_instagram')) + bool(signals.get('no_facebook'))
    if opened and opened.get('months_ago', 999) <= 6:
        score += 2
    return score


def _passes_qualifiers(candidate: dict, required: list[str]) -> bool:
    """Кандидат проходить, якщо ВСІ обрані менеджером квaліфікатори спрацювали."""
    if not required:
        return True
    return all(candidate['signals'].get(q) for q in required)


def _advanced_filter_candidates(candidates: list[dict], context: dict, filters: dict) -> tuple[list[dict], dict]:
    filters = filters if isinstance(filters, dict) else {}
    city_sizes = [str(v) for v in (filters.get('city_sizes') or []) if v]
    zone_types = [str(v) for v in (filters.get('zone_types') or []) if v]
    digital_modes = [str(v) for v in (filters.get('digital_modes') or []) if v]
    opening_status = str(filters.get('opening_status') or 'any')
    opening_month = int(filters.get('opening_month') or 0)
    opening_year = int(filters.get('opening_year') or 0)
    recent_months = max(0, int(filters.get('recent_months') or 0))
    mode = 'any' if filters.get('filter_mode') == 'any' else 'all'
    unknown_policy = 'include' if filters.get('unknown_policy') == 'include' else 'exclude'
    active_count = sum((bool(city_sizes), bool(zone_types), bool(digital_modes),
                        opening_status != 'any', bool(opening_month), bool(opening_year), bool(recent_months)))
    if not active_count:
        for candidate in candidates:
            candidate['market_context'] = context
        return candidates, {'active': 0, 'before': len(candidates), 'after': len(candidates), 'unknown': 0}

    kept, unknown_total = [], 0
    for candidate in candidates:
        candidate['market_context'] = context
        checks: list[tuple[bool | None, str]] = []
        if city_sizes:
            size = context.get('city_size') or 'unknown'
            checks.append((None if size == 'unknown' else size in city_sizes, f'Масштаб міста: {size}'))
        if zone_types:
            zones = context.get('zone_types') or []
            known = context.get('zone_confidence') != 'unknown'
            checks.append((bool(set(zones) & set(zone_types)) if known else None,
                           f'Профіль місцевості: {", ".join(zones)}' if zones else 'Профіль місцевості не підтверджено'))
        opened = candidate.get('opened')
        if opening_status != 'any':
            if opening_status == 'known':
                checks.append((bool(opened), 'Дата відкриття відома'))
            elif opening_status == 'planned':
                checks.append((bool(opened and opened.get('status') == 'planned'), 'Заплановане відкриття'))
            elif opening_status == 'recent':
                checks.append((bool(opened and opened.get('status') == 'opened' and opened.get('months_ago', 999) <= (recent_months or 12)), 'Нещодавно відкрито'))
        if opening_month:
            checks.append((None if not opened else opened.get('month') == opening_month, f'Місяць відкриття: {opening_month:02d}'))
        if opening_year:
            checks.append((None if not opened else opened.get('year') == opening_year, f'Рік відкриття: {opening_year}'))
        if recent_months and opening_status not in ('recent', 'planned'):
            checks.append((None if not opened else bool(opened.get('status') == 'opened' and opened.get('months_ago', 999) <= recent_months), f'Відкрито за останні {recent_months} міс.'))
        profile = candidate.get('digital_profile') or {}
        for digital in digital_modes:
            if digital == 'no_website':
                checks.append((not bool(candidate.get('website_url')), 'Без власного сайту'))
            else:
                checks.append((bool(profile.get(digital)), {
                    'instagram_present': 'Instagram вказано в джерелі',
                    'instagram_no_site': 'Instagram є, власного сайту немає',
                    'social_only': 'Лише соціальні канали без сайту',
                    'no_social': 'Соціальні канали не вказані',
                    'contact_ready': 'Є прямий контакт',
                }.get(digital, digital)))
        unknowns = sum(value is None for value, _ in checks)
        unknown_total += unknowns
        values = [(unknown_policy == 'include') if value is None else value for value, _ in checks]
        matched = any(values) if mode == 'any' else all(values)
        if matched:
            candidate['match_reasons'] = [label for (value, label) in checks if value is True]
            candidate['filter_unknowns'] = [label for (value, label) in checks if value is None]
            kept.append(candidate)
    return kept, {
        'active': active_count, 'before': len(candidates), 'after': len(kept),
        'unknown': unknown_total, 'mode': mode, 'unknown_policy': unknown_policy,
    }


def search_businesses(category_key: str | list[str], country: str, city: str = '',
                      qualifiers: list[str] | None = None, limit: int = 30,
                      recent_months: int = 0, advanced_filters: dict | None = None) -> dict:
    """Основна точка входу: геокодить область, шукає бізнеси, парсить і фільтрує.

    `category_key` приймає одну категорію (рядок) або кілька одразу (список —
    менеджер може шукати, напр., "салони краси" + "спортзали" за один пошук;
    кожна картка позначається ТІЄЮ категорією, яка реально збіглась).

    recent_months > 0 — залишити ЛИШЕ бізнеси з відомою датою відкриття не
    старшою за N місяців (OSM start_date/opening_date; заповнено рідко, тому
    цей фільтр суттєво звужує вибірку — про це чесно попереджаємо в UI).

    Повертає {'area', 'candidates', 'total_found', 'recent_filter_applied'}.
    """
    category_keys = [category_key] if isinstance(category_key, str) else list(category_key or [])
    category_keys = [k for k in category_keys if k in CATEGORIES]
    if not category_keys:
        raise ProspectingError('Оберіть хоча б одну категорію.')
    limit = max(1, min(_MAX_LIMIT, int(limit or 30)))
    qualifiers = [q for q in (qualifiers or []) if q]
    recent_months = max(0, int(recent_months or 0))
    advanced_filters = dict(advanced_filters or {})
    advanced_filters.setdefault('recent_months', recent_months)

    area = geocode_area(country, city)
    if not area:
        raise ProspectingError('Не вдалося знайти таку країну/місто. Спробуйте уточнити.')
    market_context = _market_context(area, bool(advanced_filters.get('zone_types')))

    # Кеш пошуку: area + категорії (відсортовані, щоб порядок вибору не
    # впливав на ключ) + ліміт. Квaліфікатори фільтруємо вже після, щоб не
    # робити окремий Overpass-запит під кожну комбінацію чекбоксів.
    scope_key = area.get('area_id') or f'{area.get("latitude")}:{area.get("longitude")}:{area.get("radius_m")}'
    cache_key = f'{scope_key}:{"+".join(sorted(category_keys))}:{limit}'
    now = time.time()
    with _cache_lock:
        cached = _search_cache.get(cache_key)
        raw = cached[1] if cached and (now - cached[0]) < _CACHE_TTL else None

    if raw is None:
        overpass_query = _build_overpass_query(area, category_keys, limit)
        elements = _run_overpass(overpass_query)
        raw = []
        for el in elements:
            parsed = _parse_element(el, category_keys)
            if parsed:
                raw.append(parsed)
        with _cache_lock:
            _search_cache[cache_key] = (now, raw)

    candidates = [c for c in raw if _passes_qualifiers(c, qualifiers)]

    candidates, filter_summary = _advanced_filter_candidates(candidates, market_context, advanced_filters)

    # Сортування за замовчуванням: найгарячіші (score) спершу, тай-брейк —
    # свіжовідкриті. Менеджер може перемкнути на «за алфавітом»/«найновіші»
    # на фронтенді (sortProspCandidates) — це лише початковий порядок.
    def _sort_key(c):
        opened = c.get('opened')
        recency = opened['months_ago'] if opened else 9999
        return (-c.get('score', 0), recency)
    candidates.sort(key=_sort_key)

    return {
        'area': area['display_name'],
        'candidates': candidates,
        'total_found': len(raw),
        'recent_filter_applied': bool(advanced_filters.get('recent_months')),
        'market_context': market_context,
        'filter_summary': filter_summary,
    }

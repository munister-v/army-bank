"""Conservative public-website enrichment for CRM prospecting.

The crawler reads a business homepage and a few obvious contact pages. It is
not a general-purpose spider: requests, redirects, response size and page
count are deliberately bounded, and private/network-local targets are denied.
"""
from __future__ import annotations

import ipaddress
import copy
import json
import os
import re
import socket
import sqlite3
import threading
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import requests

_USER_AGENT = 'ARM-CRM-contact-check/1.0 (+https://bank.munister.com.ua)'
_TIMEOUT = 8
_MAX_BYTES = 1_000_000
_MAX_REDIRECTS = 3
_MAX_CONTACT_PAGES = 5
_CONTACT_HINTS = (
    'contact', 'kontakt', 'impressum', 'about', 'about-us', 'ueber-uns',
    'uber-uns', 'o-nas', 'contatti', 'contacto', 'contacts', 'contactez',
    'kontaktai', 'kontakty', 'kontakt oss', 'yhteystiedot', 'contato',
    'iletişim', 'iletisim', 'kapcsolat', 'despre-noi', 'nous-contacter',
    'legal', 'mentions-legales', 'team', 'location', 'standort', 'find-us',
)
_EMAIL_RE = re.compile(r'(?<![\w.+-])([\w.+-]+@[\w-]+(?:\.[\w-]+)+)', re.I)
_PHONE_RE = re.compile(r'(?<!\d)(\+?\d[\d\s()./-]{7,}\d)(?!\d)')
_OBFUSCATED_EMAIL_RE = re.compile(
    r'([\w.+-]+)\s*(?:\[|\()?\s*(?:at|ät)\s*(?:\]|\))?\s*([\w-]+(?:\s*(?:\[|\()?\s*(?:dot|punkt)\s*(?:\]|\))?\s*[\w-]+)+)',
    re.I,
)
_CACHE_TTL = 24 * 60 * 60
_CACHE: dict[str, tuple[float, dict]] = {}
_CACHE_LOCK = threading.Lock()
_CACHE_DB = Path(os.environ.get('WEBSITE_ENRICHMENT_CACHE_PATH') or Path(__file__).resolve().parents[1] / 'data' / 'website_enrichment_cache.db')
_PERSISTENT_CACHE_READY = False
_DOMAIN_LAST_REQUEST: dict[str, float] = {}
_DOMAIN_THROTTLE_LOCK = threading.Lock()
_DOMAIN_MIN_INTERVAL = 0.45
_TRANSIENT_STATUSES = {429, 500, 502, 503, 504}
_BUSINESS_SCHEMA_TYPES = {
    'LocalBusiness', 'Organization', 'Hotel', 'Restaurant', 'Store',
    'ProfessionalService', 'HealthAndBeautyBusiness', 'SportsActivityLocation',
    'FoodEstablishment', 'LodgingBusiness', 'TravelAgency', 'RealEstateAgent',
}


class WebsiteEnrichmentError(Exception):
    pass


class _PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[tuple[str, str]] = []
        self.text: list[str] = []
        self.description = ''
        self.json_ld: list[str] = []
        self.languages: set[str] = set()
        self._json_ld = False
        self._skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {k.lower(): (v or '') for k, v in attrs}
        if tag == 'html' and attrs_dict.get('lang'):
            self.languages.add(attrs_dict['lang'].split('-', 1)[0].lower())
        if tag == 'link' and attrs_dict.get('hreflang'):
            language = attrs_dict['hreflang'].split('-', 1)[0].lower()
            if language and language != 'x':
                self.languages.add(language)
        if tag == 'script' and 'ld+json' in attrs_dict.get('type', '').lower():
            self._json_ld = True
        elif tag in ('script', 'style', 'svg', 'noscript'):
            self._skip += 1
        if tag == 'a' and attrs_dict.get('href'):
            self.links.append((attrs_dict['href'], attrs_dict.get('aria-label') or attrs_dict.get('title') or ''))
        if tag == 'meta':
            key = (attrs_dict.get('name') or attrs_dict.get('property') or '').lower()
            if key in ('description', 'og:description') and not self.description:
                self.description = attrs_dict.get('content', '').strip()

    def handle_endtag(self, tag: str) -> None:
        if tag == 'script' and self._json_ld:
            self._json_ld = False
        elif tag in ('script', 'style', 'svg', 'noscript') and self._skip:
            self._skip -= 1

    def handle_data(self, data: str) -> None:
        if self._json_ld:
            self.json_ld.append(data)
        elif not self._skip:
            clean = re.sub(r'\s+', ' ', data).strip()
            if clean:
                self.text.append(clean)


def _persistent_cache_connection() -> sqlite3.Connection:
    global _PERSISTENT_CACHE_READY
    _CACHE_DB.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(_CACHE_DB, timeout=3)
    connection.row_factory = sqlite3.Row
    if not _PERSISTENT_CACHE_READY:
        connection.execute('PRAGMA journal_mode=WAL')
        connection.execute(
            'CREATE TABLE IF NOT EXISTS website_enrichment_cache ('
            'cache_key TEXT PRIMARY KEY, website_url TEXT NOT NULL, payload TEXT NOT NULL, saved_at REAL NOT NULL)'
        )
        connection.execute('CREATE INDEX IF NOT EXISTS idx_website_enrichment_saved_at ON website_enrichment_cache(saved_at)')
        connection.commit()
        _PERSISTENT_CACHE_READY = True
    return connection


def _cache_get(cache_key: str, now: float) -> dict | None:
    with _CACHE_LOCK:
        cached = _CACHE.get(cache_key)
        if cached and now - cached[0] < _CACHE_TTL:
            result = copy.deepcopy(cached[1])
            result['cache_hit'] = True
            result['cache_layer'] = 'memory'
            result['cache_age_seconds'] = max(0, int(now - cached[0]))
            return result
        try:
            connection = _persistent_cache_connection()
            try:
                row = connection.execute(
                    'SELECT payload, saved_at FROM website_enrichment_cache WHERE cache_key = ?', (cache_key,)
                ).fetchone()
            finally:
                connection.close()
            if row and now - float(row['saved_at']) < _CACHE_TTL:
                result = json.loads(row['payload'])
                _CACHE[cache_key] = (float(row['saved_at']), copy.deepcopy(result))
                result['cache_hit'] = True
                result['cache_layer'] = 'persistent'
                result['cache_age_seconds'] = max(0, int(now - float(row['saved_at'])))
                return result
        except (OSError, sqlite3.Error, ValueError, TypeError, json.JSONDecodeError):
            return None
    return None


def _cache_set(cache_key: str, root: str, result: dict, now: float) -> None:
    with _CACHE_LOCK:
        _CACHE[cache_key] = (now, copy.deepcopy(result))
        if len(_CACHE) > 500:
            expired = [key for key, (saved_at, _) in _CACHE.items() if now - saved_at >= _CACHE_TTL]
            for key in expired or list(_CACHE)[:100]:
                _CACHE.pop(key, None)
        try:
            connection = _persistent_cache_connection()
            try:
                connection.execute(
                    'INSERT INTO website_enrichment_cache(cache_key, website_url, payload, saved_at) VALUES (?, ?, ?, ?) '
                    'ON CONFLICT(cache_key) DO UPDATE SET website_url=excluded.website_url, payload=excluded.payload, saved_at=excluded.saved_at',
                    (cache_key, root, json.dumps(result, ensure_ascii=False), now),
                )
                connection.execute('DELETE FROM website_enrichment_cache WHERE saved_at < ?', (now - _CACHE_TTL,))
                connection.commit()
            finally:
                connection.close()
        except (OSError, sqlite3.Error, TypeError, ValueError):
            pass


def _throttle_domain(url: str) -> None:
    host = (urlparse(url).hostname or '').lower()
    if not host:
        return
    while True:
        with _DOMAIN_THROTTLE_LOCK:
            now = time.monotonic()
            wait = _DOMAIN_MIN_INTERVAL - (now - _DOMAIN_LAST_REQUEST.get(host, 0.0))
            if wait <= 0:
                _DOMAIN_LAST_REQUEST[host] = now
                return
        time.sleep(min(wait, _DOMAIN_MIN_INTERVAL))


def _normalise_url(url: str) -> str:
    value = (url or '').strip()
    if value and not re.match(r'^https?://', value, re.I):
        value = 'https://' + value
    parsed = urlparse(value)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname:
        raise WebsiteEnrichmentError('Некоректна адреса сайту.')
    return parsed._replace(fragment='').geturl()


def _validate_public_target(url: str) -> None:
    parsed = urlparse(url)
    host = parsed.hostname or ''
    try:
        addresses = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == 'https' else 80), type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise WebsiteEnrichmentError('Домен сайту не знайдено.') from exc
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if any((ip.is_private, ip.is_loopback, ip.is_link_local, ip.is_multicast, ip.is_reserved, ip.is_unspecified)):
            raise WebsiteEnrichmentError('Службові та локальні адреси не перевіряються.')


def _safe_get(session: requests.Session, url: str, *, require_html: bool = True) -> tuple[str, str]:
    current = _normalise_url(url)
    for _ in range(_MAX_REDIRECTS + 1):
        _validate_public_target(current)
        response = None
        for attempt in range(3):
            _throttle_domain(current)
            try:
                response = session.get(
                    current,
                    headers={
                        'User-Agent': _USER_AGENT,
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.8',
                        'Accept-Language': 'en,de,fr,es,it,pl,uk;q=0.7,*;q=0.4',
                    },
                    timeout=_TIMEOUT,
                    allow_redirects=False,
                    stream=True,
                )
            except requests.RequestException as exc:
                if attempt == 2:
                    raise WebsiteEnrichmentError(f'Сайт не відповів: {exc}') from exc
                time.sleep(0.35 * (attempt + 1))
                continue
            if response.status_code not in _TRANSIENT_STATUSES or attempt == 2:
                break
            retry_after = response.headers.get('Retry-After', '')
            response.close()
            try:
                delay = min(2.0, max(0.35, float(retry_after)))
            except (TypeError, ValueError):
                delay = 0.45 * (attempt + 1)
            time.sleep(delay)
        if response is None:
            raise WebsiteEnrichmentError('Сайт не відповів.')
        if response.status_code in (301, 302, 303, 307, 308):
            location = response.headers.get('Location')
            response.close()
            if not location:
                raise WebsiteEnrichmentError('Сайт повернув редирект без адреси.')
            current = urljoin(current, location)
            continue
        if response.status_code >= 400:
            response.close()
            raise WebsiteEnrichmentError(f'Сайт повернув HTTP {response.status_code}.')
        content_type = (response.headers.get('Content-Type') or '').lower()
        if require_html and 'html' not in content_type:
            response.close()
            raise WebsiteEnrichmentError('Сторінка не є HTML-документом.')
        chunks = []
        size = 0
        for chunk in response.iter_content(32_768):
            size += len(chunk)
            if size > _MAX_BYTES:
                response.close()
                raise WebsiteEnrichmentError('Сторінка завелика для швидкої перевірки.')
            chunks.append(chunk)
        encoding = response.encoding or 'utf-8'
        response.close()
        return current, b''.join(chunks).decode(encoding, errors='replace')
    raise WebsiteEnrichmentError('Забагато перенаправлень сайту.')


def _load_robots(session: requests.Session, page_url: str) -> RobotFileParser | None:
    parsed = urlparse(page_url)
    robots_url = f'{parsed.scheme}://{parsed.netloc}/robots.txt'
    try:
        final_url, body = _safe_get(session, robots_url, require_html=False)
    except WebsiteEnrichmentError:
        return None
    parser = RobotFileParser()
    parser.set_url(final_url)
    parser.parse(body.splitlines())
    return parser


def _robots_allows(session: requests.Session, page_url: str) -> bool:
    parser = _load_robots(session, page_url)
    return parser is None or parser.can_fetch(_USER_AGENT, page_url)


def _clean_phone(value: str) -> str:
    value = re.sub(r'\s+', ' ', value).strip(' .,:;-')
    digits = re.sub(r'\D', '', value)
    return value if 9 <= len(digits) <= 15 else ''


def _same_site(url: str, root_url: str) -> bool:
    left = (urlparse(url).hostname or '').lower().removeprefix('www.')
    right = (urlparse(root_url).hostname or '').lower().removeprefix('www.')
    return left == right


def _contact_priority(url: str, label: str = '') -> int:
    value = f'{urlparse(url).path} {label}'.lower()
    if any(token in value for token in ('contact', 'kontakt', 'contatti', 'contacto', 'contato', 'iletişim', 'iletisim')):
        return 100
    if any(token in value for token in ('impressum', 'legal', 'mentions-legales')):
        return 90
    if any(token in value for token in ('location', 'standort', 'find-us', 'team')):
        return 75
    if any(token in value for token in ('about', 'ueber-uns', 'uber-uns', 'o-nas', 'despre-noi')):
        return 60
    return 20


def _deobfuscated_emails(text: str) -> set[str]:
    values: set[str] = set()
    for match in _OBFUSCATED_EMAIL_RE.finditer(text):
        domain = re.sub(r'\s*(?:\[|\()?\s*(?:dot|punkt)\s*(?:\]|\))?\s*', '.', match.group(2), flags=re.I)
        email = f'{match.group(1)}@{domain}'.lower()
        if _EMAIL_RE.fullmatch(email):
            values.add(email)
    return values


def _schema_address(value) -> str:
    if isinstance(value, str):
        return re.sub(r'\s+', ' ', value).strip()
    if not isinstance(value, dict):
        return ''
    parts = [
        value.get('streetAddress'), value.get('postalCode'), value.get('addressLocality'),
        value.get('addressRegion'), value.get('addressCountry'),
    ]
    return ', '.join(re.sub(r'\s+', ' ', str(part)).strip() for part in parts if part)


def _schema_records(chunks: list[str]) -> list[dict]:
    records: list[dict] = []

    def walk(value) -> None:
        if isinstance(value, list):
            for item in value:
                walk(item)
            return
        if not isinstance(value, dict):
            return
        schema_type = value.get('@type', '')
        types = schema_type if isinstance(schema_type, list) else [schema_type]
        if any(str(item) in _BUSINESS_SCHEMA_TYPES for item in types):
            records.append(value)
        for key in ('@graph', 'mainEntity', 'itemListElement'):
            if key in value:
                walk(value[key])

    for chunk in chunks:
        try:
            walk(json.loads(chunk.strip()))
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
    return records


def _page_data(url: str, html: str) -> dict:
    parser = _PageParser()
    parser.feed(html)
    text = ' '.join(parser.text)
    emails = {m.group(1).lower() for m in _EMAIL_RE.finditer(text)}
    obfuscated_emails = _deobfuscated_emails(text)
    emails.update(obfuscated_emails)
    phones = {_clean_phone(m.group(1)) for m in _PHONE_RE.finditer(text)}
    socials: dict[str, str] = {}
    structured: list[dict] = []
    confidence: dict[tuple[str, str], float] = {}
    for value in emails:
        confidence[('email', value)] = 0.65 if value in obfuscated_emails else 0.75
    for value in phones:
        if value:
            confidence[('phone', value)] = 0.75
    internal: list[tuple[str, str]] = []
    address = ''
    opening_hours: list[str] = []
    detected_name = ''
    schema_types: set[str] = set()
    for href, label in parser.links:
        absolute = urljoin(url, href).split('#', 1)[0]
        low = absolute.lower()
        if href.lower().startswith('mailto:'):
            email = href[7:].split('?', 1)[0].strip().lower()
            if _EMAIL_RE.fullmatch(email):
                emails.add(email)
                confidence[('email', email)] = 0.9
        elif href.lower().startswith('tel:'):
            phone = _clean_phone(href[4:].split('?', 1)[0])
            if phone:
                phones.add(phone)
                confidence[('phone', phone)] = 0.9
        elif 'instagram.com/' in low:
            socials.setdefault('instagram', absolute)
            confidence[('instagram', absolute)] = 0.85
        elif 'facebook.com/' in low:
            socials.setdefault('facebook', absolute)
            confidence[('facebook', absolute)] = 0.85
        elif 'linkedin.com/' in low:
            socials.setdefault('linkedin', absolute)
            confidence[('linkedin', absolute)] = 0.85
        elif 'wa.me/' in low or 'whatsapp.com/' in low:
            socials.setdefault('whatsapp', absolute)
            confidence[('whatsapp', absolute)] = 0.9
        elif _same_site(absolute, url) and any(hint in (low + ' ' + label.lower()) for hint in _CONTACT_HINTS):
            internal.append((absolute, label))
    for record in _schema_records(parser.json_ld):
        schema_type = record.get('@type') or ''
        for value in schema_type if isinstance(schema_type, list) else [schema_type]:
            if value:
                schema_types.add(str(value))
        detected_name = detected_name or re.sub(r'\s+', ' ', str(record.get('name') or '')).strip()
        address = address or _schema_address(record.get('address'))
        hours = record.get('openingHours') or []
        if isinstance(hours, str):
            hours = [hours]
        opening_hours.extend(str(item).strip() for item in hours if item)
        phone = _clean_phone(str(record.get('telephone') or ''))
        email = str(record.get('email') or '').replace('mailto:', '').strip().lower()
        if phone:
            phones.add(phone)
            structured.append({'field': 'phone', 'value': phone})
            confidence[('phone', phone)] = 0.95
        if _EMAIL_RE.fullmatch(email):
            emails.add(email)
            structured.append({'field': 'email', 'value': email})
            confidence[('email', email)] = 0.95
        if not parser.description and record.get('description'):
            parser.description = re.sub(r'\s+', ' ', str(record['description'])).strip()
        same_as = record.get('sameAs') or []
        if isinstance(same_as, str):
            same_as = [same_as]
        for social_url in same_as:
            low = str(social_url).lower()
            field = 'instagram' if 'instagram.com/' in low else 'facebook' if 'facebook.com/' in low else 'linkedin' if 'linkedin.com/' in low else 'whatsapp' if ('wa.me/' in low or 'whatsapp.com/' in low) else ''
            if field:
                socials.setdefault(field, str(social_url))
                structured.append({'field': field, 'value': str(social_url)})
                confidence[(field, str(social_url))] = 0.95
    ordered_internal = [item[0] for item in sorted(internal, key=lambda item: _contact_priority(*item), reverse=True)]
    return {
        'emails': sorted(emails),
        'phones': sorted(p for p in phones if p),
        'socials': socials,
        'internal': list(dict.fromkeys(ordered_internal)),
        'description': parser.description[:500],
        'structured': structured,
        'confidence': confidence,
        'address': address,
        'opening_hours': list(dict.fromkeys(opening_hours))[:12],
        'detected_name': detected_name,
        'schema_types': sorted(schema_types),
        'languages': sorted(parser.languages),
    }


def _quality_score(*, emails: list[str], phones: list[str], socials: dict[str, str], address: str,
                   description: str, pages_checked: int, structured: bool, errors: list[str]) -> int:
    score = 0
    score += 24 if emails else 0
    score += 24 if phones else 0
    score += min(20, len(socials) * 5)
    score += 8 if address else 0
    score += 7 if description else 0
    score += min(7, pages_checked * 2)
    score += 10 if structured else 0
    score -= min(10, len(errors) * 3)
    return max(0, min(100, score))


def enrich_website(website_url: str, *, force_refresh: bool = False) -> dict:
    root = _normalise_url(website_url)
    cache_key = root.rstrip('/').lower()
    now = time.time()
    if not force_refresh:
        cached = _cache_get(cache_key, now)
        if cached:
            return cached
    session = requests.Session()
    robots = _load_robots(session, root)
    if robots is not None and not robots.can_fetch(_USER_AGENT, root):
        return {'website_url': root, 'pages_checked': 0, 'blocked_by_robots': True, 'sources': [], 'evidence': []}

    queue = [root]
    checked: list[str] = []
    emails: list[str] = []
    phones: list[str] = []
    socials: dict[str, str] = {}
    description = ''
    evidence: list[dict] = []
    errors: list[str] = []
    structured_data_found = False
    address = ''
    opening_hours: list[str] = []
    detected_name = ''
    schema_types: set[str] = set()
    languages: set[str] = set()

    while queue and len(checked) < 1 + _MAX_CONTACT_PAGES:
        target = queue.pop(0)
        if target in checked:
            continue
        try:
            final_url, html = _safe_get(session, target)
        except WebsiteEnrichmentError as exc:
            errors.append(str(exc))
            continue
        if final_url in checked or not _same_site(final_url, root):
            continue
        if final_url != root and robots is not None and not robots.can_fetch(_USER_AGENT, final_url):
            continue
        checked.append(final_url)
        data = _page_data(final_url, html)
        structured_values = {(item['field'], item['value']) for item in data['structured']}
        structured_data_found = structured_data_found or bool(structured_values)
        description = description or data['description']
        address = address or data['address']
        detected_name = detected_name or data['detected_name']
        opening_hours.extend(data['opening_hours'])
        schema_types.update(data['schema_types'])
        languages.update(data['languages'])
        for value in data['emails']:
            if value not in emails:
                emails.append(value)
                confidence = data['confidence'].get(('email', value), 0.75)
                evidence.append({'field': 'email', 'value': value, 'url': final_url, 'source_type': 'schema_org' if confidence >= 0.95 else 'direct_link' if confidence >= 0.9 else 'obfuscated_text' if confidence < 0.7 else 'html', 'confidence': confidence})
        for value in data['phones']:
            if value not in phones:
                phones.append(value)
                confidence = data['confidence'].get(('phone', value), 0.75)
                evidence.append({'field': 'phone', 'value': value, 'url': final_url, 'source_type': 'schema_org' if confidence >= 0.95 else 'direct_link' if confidence >= 0.9 else 'html', 'confidence': confidence})
        for field, value in data['socials'].items():
            if field not in socials:
                socials[field] = value
                confidence = data['confidence'].get((field, value), 0.85)
                evidence.append({'field': field, 'value': value, 'url': final_url, 'source_type': 'schema_org' if confidence >= 0.95 else 'direct_link', 'confidence': confidence})
        for candidate in data['internal']:
            if candidate not in checked and candidate not in queue and len(queue) < _MAX_CONTACT_PAGES * 2:
                queue.append(candidate)

    result = {
        'website_url': checked[0] if checked else root,
        'phone': phones[0] if phones else '',
        'email': emails[0] if emails else '',
        'instagram': socials.get('instagram', ''),
        'facebook': socials.get('facebook', ''),
        'linkedin': socials.get('linkedin', ''),
        'whatsapp': socials.get('whatsapp', ''),
        'description': description,
        'address': address,
        'opening_hours': list(dict.fromkeys(opening_hours))[:12],
        'detected_business_name': detected_name,
        'schema_types': sorted(schema_types),
        'site_languages': sorted(languages),
        'pages_checked': len(checked),
        'blocked_by_robots': False,
        'sources': checked,
        'evidence': evidence,
        'errors': errors[:3],
        'structured_data_found': structured_data_found,
        'cache_hit': False,
        'cache_layer': 'network',
        'cache_age_seconds': 0,
    }
    result['contact_quality_score'] = _quality_score(
        emails=emails, phones=phones, socials=socials, address=address,
        description=description, pages_checked=len(checked), structured=structured_data_found, errors=errors,
    )
    if checked:
        _cache_set(cache_key, root, result, now)
    return result

"""Google Programmable Search (Custom Search JSON API) — другий канал пошуку
потенційних клієнтів у Prospecting, поруч з OpenStreetMap.

https://developers.google.com/custom-search/v1/overview

На відміну від Overpass (структурований реєстр бізнесів з тегами), Custom
Search повертає звичайну видачу веб-сторінок за запитом — тому це не готові
"картки бізнесу", а сторінки, серед яких треба відрізнити "власний сайт" від
"профіль на чужій платформі" (Facebook/Instagram/довідник). Це й робить
_classify_domain: євристика на основі списку відомих не-власних доменів, а
не факт — тому в UI сигнали подаються так само обережно, як і OSM-сигнали.
"""
from __future__ import annotations

import re

import requests

from .. import config

SEARCH_URL = 'https://www.googleapis.com/customsearch/v1'
_TIMEOUT = 15
_RESULTS_PER_PAGE = 10
_MAX_PAGES = 3  # до 30 результатів = до 3 запитів до квоти (100/день на free tier)

# Домени, де сторінка НЕ є власним сайтом бізнесу — соцмережі, каталоги,
# агрегатори, карти. Використовується як -site: у запиті (щоб не засмічувати
# видачу) і як маркер "тільки профіль на платформі" на знайдених картках.
KNOWN_PLATFORM_DOMAINS = (
    'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com',
    'tiktok.com', 'youtube.com', 'pinterest.com', 'yelp.com', 'tripadvisor.com',
    'tripadvisor.co.uk', 'foursquare.com', 'booking.com', 'opentable.com',
    'g.page', 'goo.gl', 'maps.google.com', 'linktr.ee', 'olx.pl', 'olx.ua',
    'allegro.pl', 'wikipedia.org', '2gis.ru', '2gis.ua', 'glassdoor.com',
    'indeed.com', 'houzz.com', 'thumbtack.com', 'yellowpages.com',
)


class GoogleSearchError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def is_configured() -> bool:
    return bool(config.GOOGLE_CSE_API_KEY and config.GOOGLE_CSE_CX)


def _domain(url: str) -> str:
    m = re.search(r'https?://(?:www\.)?([^/]+)', (url or '').strip(), re.IGNORECASE)
    return (m.group(1).lower() if m else '')


def _is_platform_domain(domain: str) -> bool:
    return any(domain == d or domain.endswith('.' + d) for d in KNOWN_PLATFORM_DOMAINS)


def _clean_business_name(title: str, domain: str) -> str:
    """Титул сторінки часто містить хвіст на кшталт ' - Home' / ' | Facebook'
    — беремо перший сегмент до типового роздільника. Якщо після цього
    порожньо, підставляємо домен як останній варіант."""
    for sep in (' - ', ' – ', ' — ', ' | '):
        if sep in title:
            title = title.split(sep)[0]
            break
    title = title.strip()
    return title or domain or 'Без назви'


def _extract_instagram_handle(url: str, domain: str) -> str:
    if 'instagram.com' not in domain:
        return ''
    m = re.search(r'instagram\.com/([^/?#]+)', url)
    return f'@{m.group(1)}' if m else ''


def _build_query(query_text: str, exact_terms: str, exclude_terms: str, exclude_platforms: bool) -> str:
    parts = [query_text.strip()]
    if exact_terms.strip():
        parts.append(f'"{exact_terms.strip()}"')
    for word in exclude_terms.split():
        word = word.strip('-').strip()
        if word:
            parts.append(f'-{word}')
    if exclude_platforms:
        # Найпоширеніші платформи — прибираємо з видачі, щоб на першому
        # екрані було більше шансів побачити власні сайти (або їх відсутність).
        for d in KNOWN_PLATFORM_DOMAINS[:6]:
            parts.append(f'-site:{d}')
    return ' '.join(p for p in parts if p)


def search_businesses(*, query_text: str, category_label: str = '', category_key: str = '',
                       country: str = '', city: str = '', lang: str = '', gl: str = '',
                       date_restrict: str = '', exact_terms: str = '', exclude_terms: str = '',
                       exclude_platforms: bool = True, limit: int = 20) -> dict:
    if not is_configured():
        raise GoogleSearchError(
            'Google-пошук ще не налаштований на сервері (немає GOOGLE_CSE_API_KEY / GOOGLE_CSE_CX у .env).'
        )
    if not query_text.strip():
        raise GoogleSearchError('Вкажіть категорію або пошуковий запит.')

    limit = max(1, min(_RESULTS_PER_PAGE * _MAX_PAGES, int(limit or 20)))
    q = _build_query(query_text, exact_terms, exclude_terms, exclude_platforms)

    params = {
        'key': config.GOOGLE_CSE_API_KEY,
        'cx': config.GOOGLE_CSE_CX,
        'q': q,
        'num': _RESULTS_PER_PAGE,
    }
    if lang:
        params['lr'] = f'lang_{lang}'
    if gl:
        params['gl'] = gl
    if date_restrict:
        params['dateRestrict'] = date_restrict

    items: list[dict] = []
    total_results = 0
    pages = max(1, (limit + _RESULTS_PER_PAGE - 1) // _RESULTS_PER_PAGE)
    for page in range(pages):
        page_params = dict(params, start=1 + page * _RESULTS_PER_PAGE)
        try:
            resp = requests.get(SEARCH_URL, params=page_params, timeout=_TIMEOUT)
        except requests.RequestException as exc:
            raise GoogleSearchError(f'Не вдалося звʼязатися з Google Custom Search: {exc}') from exc
        if resp.status_code == 429:
            raise GoogleSearchError('Вичерпано денну квоту Google Custom Search. Спробуйте пізніше.')
        if resp.status_code >= 400:
            try:
                detail = resp.json().get('error', {}).get('message', '')
            except ValueError:
                detail = ''
            raise GoogleSearchError(f'Google Custom Search повернув HTTP {resp.status_code}. {detail}'.strip())
        payload = resp.json()
        if page == 0:
            total_results = int((payload.get('searchInformation') or {}).get('totalResults') or 0)
        page_items = payload.get('items') or []
        items.extend(page_items)
        if len(page_items) < _RESULTS_PER_PAGE:
            break  # видача закінчилась раніше ліміту

    candidates = []
    for it in items[:limit]:
        link = it.get('link') or ''
        domain = _domain(link)
        is_platform = _is_platform_domain(domain)
        thumb = ''
        pagemap = it.get('pagemap') or {}
        cse_thumb = pagemap.get('cse_thumbnail') or pagemap.get('cse_image')
        if cse_thumb and isinstance(cse_thumb, list):
            thumb = (cse_thumb[0] or {}).get('src', '')

        candidates.append({
            'business_name': _clean_business_name(it.get('title') or '', domain),
            'category': category_label,
            'category_key': category_key,
            'city_area': city,
            'country': country,
            'phone': '',
            'website_url': '' if is_platform else link,
            'email': '',
            'instagram': _extract_instagram_handle(link, domain),
            'source_url': link,
            'source': 'google',
            'domain': domain,
            'snippet': it.get('snippet') or '',
            'thumbnail': thumb,
            'signals': {'platform_only': is_platform},
            'opened': None,
            'suggested_first_offer': 'Розробка сайту / лендінгу' if is_platform else '',
        })

    return {
        'area': ', '.join(p for p in (city, country) if p),
        'candidates': candidates,
        'total_found': total_results,
        'query_used': q,
    }

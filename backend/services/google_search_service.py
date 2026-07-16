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

# Заголовки на кшталт "10 Best Hair Salons in Krakow" / «ТОП-10 перукарень» —
# це сторінка-огляд БАГАТЬОХ бізнесів, а не картка одного. Якщо не відфільтрувати,
# такий заголовок помилково стає "назвою бізнесу". Розпізнаємо і позначаємо
# окремо (is_listicle), замість видавати за єдину компанію.
_LISTICLE_RE = re.compile(
    r'(\b(top|топ|тор)[\s\-]*\d+\b)'
    r'|(\b\d+\s*(best|найкращ\w*|лучш\w*|top)\b)'
    r'|(\bнайкращ\w*\s+\d+\b)'
    r'|(\bлучш\w*\s+\d+\b)'
    r'|(\branking\b)',
    re.IGNORECASE,
)

# Досить широкий, але не надто жадібний патерн телефону: +код і/або дужки/
# розділювачі, 9-15 цифр разом. Знаходимо в snippet (Google часто показує
# телефон прямо у видачі для бізнес-сторінок) — це РЕАЛЬНО корисний сигнал,
# а не просто оздоблення картки.
_PHONE_RE = re.compile(
    r'(?<!\d)(\+?\d{1,3}[\s.\-]?)?\(?\d{2,4}\)?[\s.\-]?\d{2,4}[\s.\-]?\d{2,4}(?:[\s.\-]?\d{2,4})?(?!\d)'
)
_EMAIL_RE = re.compile(r'[\w.\-+]+@[\w\-]+\.[a-zA-Z]{2,}')


def _looks_like_listicle(title: str) -> bool:
    return bool(_LISTICLE_RE.search(title or ''))


def _extract_phone(text: str) -> str:
    for m in _PHONE_RE.finditer(text or ''):
        candidate = m.group(0)
        digits = re.sub(r'\D', '', candidate)
        # Відсікаємо явно не-телефонні збіги: роки, короткі числа, ціни без коду.
        if 9 <= len(digits) <= 15:
            return candidate.strip()
    return ''


def _extract_email(text: str) -> str:
    m = _EMAIL_RE.search(text or '')
    return m.group(0) if m else ''


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
    — беремо СЕГМЕНТ, що найбільше схожий на назву бізнесу (не найкоротший
    навмання, а перший "змістовний" — сайти-каталоги часто ставлять власний
    бренд ПЕРШИМ: 'Yelp — Best Hairdresser in Krakow', тому відкидаємо
    сегмент, що збігається з доменом чи відомим брендом-платформою)."""
    raw = title.strip()
    segments = re.split(r'\s[-–—|·»]\s', raw)
    segments = [s.strip() for s in segments if s.strip()]
    if not segments:
        return domain or 'Без назви'

    domain_root = domain.split('.')[0].lower() if domain else ''
    platform_brands = {d.split('.')[0] for d in KNOWN_PLATFORM_DOMAINS}

    def is_junk(seg: str) -> bool:
        low = seg.lower().strip()
        if not low:
            return True
        if domain_root and (low == domain_root or domain_root in low.replace(' ', '')):
            return True
        return low in platform_brands or low in ('home', 'homepage', 'головна', 'офіційний сайт', 'official site')

    for seg in segments:
        if not is_junk(seg):
            return seg
    return segments[0]


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
    seen_keys: set[str] = set()
    for it in items[:limit]:
        link = it.get('link') or ''
        domain = _domain(link)
        is_platform = _is_platform_domain(domain)
        title = it.get('title') or ''
        snippet = it.get('snippet') or ''
        is_listicle = _looks_like_listicle(title)

        # Дедуп у межах самої видачі: та сама сторінка інколи трапляється
        # двічі (напр. з www. і без) — беремо тільки перше входження.
        dedup_key = domain + '|' + re.sub(r'\s+', ' ', title.lower()).strip()
        if dedup_key in seen_keys:
            continue
        seen_keys.add(dedup_key)

        thumb = ''
        pagemap = it.get('pagemap') or {}
        cse_thumb = pagemap.get('cse_thumbnail') or pagemap.get('cse_image')
        if cse_thumb and isinstance(cse_thumb, list):
            thumb = (cse_thumb[0] or {}).get('src', '')

        phone = _extract_phone(snippet)
        email = _extract_email(snippet) or _extract_email(title)

        if is_listicle:
            offer = ''
        elif is_platform:
            offer = 'Розробка сайту / лендінгу'
        else:
            offer = ''

        candidates.append({
            'business_name': _clean_business_name(title, domain),
            'category': category_label,
            'category_key': category_key,
            'city_area': city,
            'country': country,
            'phone': phone,
            'website_url': '' if is_platform else link,
            'email': email,
            'instagram': _extract_instagram_handle(link, domain),
            'source_url': link,
            'source': 'google',
            'domain': domain,
            'snippet': snippet,
            'thumbnail': thumb,
            'signals': {'platform_only': is_platform, 'is_listicle': is_listicle},
            'opened': None,
            'suggested_first_offer': offer,
            'score': _lead_score(is_platform, is_listicle, bool(phone)),
        })

    # Найгарячіші спершу (listicle-сторінки завжди в кінці — вони не бізнес-картки).
    candidates.sort(key=lambda c: -c['score'])

    return {
        'area': ', '.join(p for p in (city, country) if p),
        'candidates': candidates,
        'total_found': total_results,
        'query_used': q,
    }


def _lead_score(is_platform: bool, is_listicle: bool, has_phone: bool) -> int:
    if is_listicle:
        return -10
    score = (3 if is_platform else 0) + (1 if has_phone else 0)
    return score


def enrich_business(*, business_name: str, city: str = '', country: str = '') -> dict:
    """Точковий пошук контактів для ОДНОГО вже відомого бізнесу (напр. кандидат
    з OSM без телефону/email) — вужчий запит (точна назва в лапках) замість
    категорії, менше результатів, платформи НЕ виключаємо (Facebook-сторінка
    теж часто містить телефон у сніпеті)."""
    business_name = business_name.strip()
    if not business_name:
        raise GoogleSearchError('Вкажіть назву бізнесу.')
    query_text = f'"{business_name}"'
    result = search_businesses(
        query_text=query_text, city=city, country=country,
        exclude_platforms=False, limit=5,
    )
    phone = email = website = ''
    for c in result['candidates']:
        phone = phone or c.get('phone') or ''
        email = email or c.get('email') or ''
        website = website or c.get('website_url') or ''
    return {'phone': phone, 'email': email, 'website_url': website, 'checked': len(result['candidates'])}

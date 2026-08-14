"""Діагностика лідів: знайти домен, перевірити його і сказати, ЩО саме зламано.

Навіщо це поверх наявного prospecting_service. Той збирає бізнеси з OSM і
позначає «схоже, немає сайту» за відсутністю тега — це слабкий сигнал, і в базі
з нього вийшло 1183 картки, з яких сайт відомий у 138, а WhatsApp у 12. Тобто
менеджеру нема з чим іти до людини.

Тут інша задача: не знайти бізнес, а знайти ПРИВІД написати. Привід — це
технічний факт, який можна показати: домен не резолвиться, сертифікат протух,
сторінка віддає 502, на домені паркувальна заглушка, магазину немає там, де
категорія торгує. Кожен факт зберігається з доказом (код відповіді, дата
сертифіката, шматок сторінки), бо саме доказ і йде у перше повідомлення.

Межі, які тут НЕ переходяться:
  * Instagram і Facebook не парсяться. У базі 957 інстаграм-хендлів, і спокуса
    велика, але сторінка профілю віддається лише за логін-стіною, а обхід її —
    порушення умов Meta. Беремо тільки те, що бізнес сам виклав у відкритий веб.
  * WhatsApp не перевіряється через сам WhatsApp. Наявність чату визначається
    лише за посиланням wa.me / api.whatsapp.com, яке бізнес сам поставив.
  * robots.txt, Retry-After і тротлінг по домену — як у
    website_enrichment_service, звідки взяті мережеві примітиви.
"""
from __future__ import annotations

import re
import socket
import ssl
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests

USER_AGENT = 'ARM-CRM-site-check/1.0 (+https://bank.munister.com.ua)'
TIMEOUT = 8
MAX_BYTES = 600_000
MAX_REDIRECTS = 4
CHECKER_VERSION = 1

# ── Діагнози, від найпродаваніших до найслабших ─────────────────────────────
# Порядок важливий: лід отримує ОДИН головний діагноз, і це має бути той, про
# який найлегше написати людині.
DIAGNOSES = (
    'dead_dns',      # домен не резолвиться
    'unreachable',   # резолвиться, але не відповідає
    'tls_expired',   # сертифікат протух
    'http_5xx',      # сервер віддає помилку
    'parked',        # заглушка реєстратора / дефолтна сторінка
    'placeholder',   # «coming soon», порожня сторінка
    'domain_unknown',# домену не знайшли — це НЕ «сайту немає»
    'blocked',       # нас не пустили (403/429) — про сайт нічого не відомо
    'broken_shop',   # магазин є, але не працює
    'no_shop',       # торгова категорія без магазину
    'social_only',   # тільки соцмережі
    'ok',            # нічого продати не можемо
)

_PARKED_MARKERS = (
    'domain is for sale', 'buy this domain', 'this domain is parked',
    'domain parking', 'sedoparking', 'afternic', 'dan.com', 'hugedomains',
    'this webpage is parked', 'домен продается', 'домен продається',
    'ця сторінка припаркована', 'parkingcrew', 'bodis.com',
)
_DEFAULT_PAGE_MARKERS = (
    'welcome to nginx', 'apache2 ubuntu default page', 'apache http server test page',
    'it works!', 'index of /', 'iis windows server', 'default web site page',
    'plesk', 'cpanel', 'this is the default index page',
)
_PLACEHOLDER_MARKERS = (
    'coming soon', 'under construction', 'site is under maintenance',
    'сайт в разработке', 'сайт у розробці', 'скоро відкриття', 'website coming soon',
    'launching soon', 'wir sind bald', 'en construction',
)
# Відбитки магазинних платформ у HTML.
_SHOP_MARKERS = (
    'shopify', 'woocommerce', 'wp-content/plugins/woocommerce', 'wix-stores',
    'squarespace-commerce', 'prestashop', 'opencart', 'magento', 'bigcommerce',
    'horoshop', 'prom.ua', 'bitrix', 'ecwid', 'tilda-cart', 'snipcart',
    'add-to-cart', 'add_to_cart', 'schema.org/product', '"@type":"product"',
    'itemtype="http://schema.org/product"', '/cart', '/checkout', 'кошик', 'корзина',
)
_WHATSAPP_MARKERS = ('wa.me/', 'api.whatsapp.com/send', 'web.whatsapp.com/send', 'whatsapp://send')

# Категорії, де відсутність магазину — це привід продати магазин. Для
# стоматології чи автомийки магазин не потрібен, і мовчати про це чесніше.
SELLING_CATEGORIES = {
    'shop', 'retail', 'clothes', 'furniture', 'florist', 'bakery', 'jewelry',
    'sports', 'electronics', 'books', 'toys', 'cosmetics', 'pet', 'bike',
    'магазин', 'одяг', 'меблі', 'квіти', 'пекарня',
}

_domain_last_hit: dict[str, float] = {}


class ProbeError(Exception):
    pass


def _throttle(host: str, gap: float = 1.0) -> None:
    """Не більше одного запиту на секунду в один домен."""
    now = time.monotonic()
    previous = _domain_last_hit.get(host)
    if previous is not None and now - previous < gap:
        time.sleep(gap - (now - previous))
    _domain_last_hit[host] = time.monotonic()


def _is_public_host(host: str) -> bool:
    """Службові й локальні адреси не перевіряються — захист від SSRF."""
    import ipaddress
    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if any((ip.is_private, ip.is_loopback, ip.is_link_local,
                ip.is_multicast, ip.is_reserved, ip.is_unspecified)):
            return False
    return True


def resolves(host: str) -> bool:
    try:
        socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
        return True
    except socket.gaierror:
        return False


def tls_expiry(host: str) -> datetime | None:
    """Дата закінчення сертифіката або None, якщо TLS не піднявся."""
    context = ssl.create_default_context()
    # Нас цікавить САМА дата, тож перевірку імені й ланцюжка вимикаємо:
    # інакше протухлий сертифікат кине виняток і ми не побачимо, коли він помер.
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    try:
        with socket.create_connection((host, 443), timeout=TIMEOUT) as raw:
            with context.wrap_socket(raw, server_hostname=host) as tls:
                der = tls.getpeercert(binary_form=True)
    except (OSError, ssl.SSLError):
        return None
    if not der:
        return None
    try:
        from cryptography import x509
        return x509.load_der_x509_certificate(der).not_valid_after_utc
    except Exception:
        return None


def domain_of(value: str) -> str:
    """Домен з URL або з email."""
    value = (value or '').strip()
    if not value:
        return ''
    if '@' in value and '://' not in value:
        return value.rsplit('@', 1)[-1].strip().lower().strip('.')
    if '://' not in value:
        value = 'https://' + value
    host = (urlparse(value).hostname or '').lower()
    return host[4:] if host.startswith('www.') else host


def fetch(url: str) -> dict:
    """Один запит із ручним проходом редиректів, БЕЗ винятку на 4xx/5xx.

    website_enrichment_service._safe_get кидає помилку на 5xx — для збагачення
    це правильно, а тут 5xx і є той факт, заради якого все робиться.
    """
    parsed = urlparse(url if '://' in url else 'https://' + url)
    host = parsed.hostname or ''
    if not host or not _is_public_host(host):
        raise ProbeError('non-public host')
    session = requests.Session()
    current = parsed.geturl()
    for _ in range(MAX_REDIRECTS + 1):
        _throttle(urlparse(current).hostname or host)
        response = session.get(
            current,
            headers={'User-Agent': USER_AGENT, 'Accept': 'text/html,*/*;q=0.5',
                     'Accept-Language': 'en,de,pl,uk;q=0.7,*;q=0.4'},
            timeout=TIMEOUT, allow_redirects=False, stream=True,
        )
        if response.status_code in (301, 302, 303, 307, 308) and response.headers.get('Location'):
            location = response.headers['Location']
            response.close()
            current = requests.compat.urljoin(current, location)
            continue
        body = b''
        for chunk in response.iter_content(32_768):
            body += chunk
            if len(body) > MAX_BYTES:
                break
        text = body.decode(response.encoding or 'utf-8', errors='replace')
        response.close()
        return {'url': current, 'status': response.status_code, 'html': text,
                'headers': dict(response.headers)}
    raise ProbeError('too many redirects')


def _text_only(html: str) -> str:
    without_tags = re.sub(r'<(script|style)[\s\S]*?</\1>', ' ', html, flags=re.I)
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', without_tags)).strip()


def probe(domain: str) -> dict:
    """Технічна перевірка домену. Повертає факти, а не оцінки."""
    result = {'domain': domain, 'checked_at': datetime.now(timezone.utc).isoformat(),
              'checker_version': CHECKER_VERSION, 'signals': [], 'diagnosis': '', 'evidence': ''}

    if not resolves(domain):
        result['diagnosis'] = 'dead_dns'
        result['evidence'] = 'DNS не повертає адреси для домену'
        result['signals'].append(('dead_dns', domain, result['evidence']))
        return result

    expiry = tls_expiry(domain)
    if expiry is not None and expiry < datetime.now(timezone.utc):
        result['signals'].append(('tls_expired', expiry.date().isoformat(),
                                  f'Сертифікат протух {expiry.date().isoformat()}'))

    try:
        page = fetch(domain)
    except (ProbeError, requests.RequestException) as exc:
        result['diagnosis'] = 'tls_expired' if any(s[0] == 'tls_expired' for s in result['signals']) else 'unreachable'
        result['evidence'] = f'Сайт не відповів: {type(exc).__name__}'
        result['signals'].append(('unreachable', '', result['evidence']))
        return result

    status = page['status']
    html_low = page['html'].lower()
    text = _text_only(page['html'])
    result['status'] = status
    result['final_url'] = page['url']
    result['text_length'] = len(text)

    if any(marker in html_low for marker in _WHATSAPP_MARKERS):
        match = re.search(r'wa\.me/(\+?\d{6,15})', html_low) or re.search(r'phone=(\+?\d{6,15})', html_low)
        result['signals'].append(('whatsapp', match.group(1) if match else '', 'Кнопка WhatsApp на сайті'))

    if status >= 500:
        result['diagnosis'] = 'http_5xx'
        result['evidence'] = f'Сайт віддає HTTP {status}'
        result['signals'].append(('http_5xx', str(status), result['evidence']))
        return result
    # 401/403/429 — це майже завжди WAF або Cloudflare, який не пустив НАС, а
    # не зламаний сайт. Два ліди в першому ж прогоні отримали «сайт не працює»
    # саме через 403, і з таким листом менеджер пішов би до людини, у якої все
    # гаразд. Тому окремий діагноз з нульовою вагою: перевірити руками.
    if status in (401, 403, 429):
        result['diagnosis'] = 'blocked'
        result['evidence'] = f'Сайт віддав HTTP {status} — схоже, захист від ботів, не поломка'
        result['signals'].append(('blocked', str(status), result['evidence']))
        return result
    if status >= 400:
        result['diagnosis'] = 'unreachable'
        result['evidence'] = f'Головна сторінка віддає HTTP {status}'
        result['signals'].append(('http_4xx', str(status), result['evidence']))
        return result

    parked_hit = next((m for m in _PARKED_MARKERS if m in html_low), '')
    # «plesk», «cpanel», «index of /» трапляються і в футері живого сайту, тож
    # дефолтною сторінкою вважаємо лише коротку сторінку або таку, де маркер
    # стоїть у <title>. Інакше під заглушку потрапляє робочий сайт на Plesk.
    title = (re.search(r'<title[^>]*>(.*?)</title>', html_low, re.S) or [None, ''])[1]
    default_hit = next((m for m in _DEFAULT_PAGE_MARKERS
                        if m in html_low and (m in title or len(text) < 600)), '')
    if parked_hit or default_hit:
        hit = parked_hit or default_hit
        result['diagnosis'] = 'parked'
        result['evidence'] = f'На домені заглушка: «{hit}»'
        result['signals'].append(('parked', hit, result['evidence']))
        return result

    placeholder_hit = next((m for m in _PLACEHOLDER_MARKERS if m in html_low), '')
    if placeholder_hit or len(text) < 220:
        result['diagnosis'] = 'placeholder'
        result['evidence'] = (f'Сторінка-заглушка: «{placeholder_hit}»' if placeholder_hit
                              else f'На головній майже немає тексту ({len(text)} символів)')
        result['signals'].append(('placeholder', placeholder_hit, result['evidence']))
        return result

    has_shop = any(marker in html_low for marker in _SHOP_MARKERS)
    result['signals'].append(('shop_detected' if has_shop else 'no_shop_markers', '',
                              'Знайдено ознаки магазину' if has_shop else 'Ознак магазину на сайті немає'))
    if has_shop:
        cart = _probe_cart(page['url'])
        if cart:
            result['diagnosis'] = 'broken_shop'
            result['evidence'] = cart
            result['signals'].append(('broken_shop', '', cart))
            return result

    if not any(x in html_low for x in ('viewport', 'max-width')):
        result['signals'].append(('not_mobile', '', 'Немає viewport — сайт не адаптований під телефон'))

    result['diagnosis'] = 'ok'
    result['evidence'] = f'Сайт відповідає, HTTP {status}'
    return result


def _probe_cart(base_url: str) -> str:
    """Магазин є — чи працює кошик. Порожній рядок = проблем не видно."""
    for path in ('/cart', '/koszyk', '/kosik', '/warenkorb'):
        try:
            page = fetch(requests.compat.urljoin(base_url, path))
        except (ProbeError, requests.RequestException):
            continue
        if page['status'] >= 500:
            return f'Сторінка кошика {path} віддає HTTP {page["status"]}'
    return ''


def resolve_domain(lead: dict) -> tuple[str, str]:
    """Домен ліда і звідки він узявся. Порожньо — якщо домену немає.

    Порядок джерел — від найнадійнішого до найслабшого. Здогадок за назвою
    бізнесу тут НЕМАЄ навмисно: збіг «назва.com» надто часто веде на чужий сайт,
    а помилковий діагноз у листі гірший за відсутність ліда.
    """
    site = domain_of(lead.get('website_url') or '')
    if site:
        return site, 'website_url'
    email_domain = domain_of(lead.get('email') or '')
    if email_domain and email_domain not in _FREE_MAIL:
        return email_domain, 'email'
    return '', ''


_FREE_MAIL = {
    'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
    'live.com', 'icloud.com', 'me.com', 'aol.com', 'gmx.de', 'gmx.net',
    'web.de', 'wp.pl', 'o2.pl', 'interia.pl', 'onet.pl', 'ukr.net', 'i.ua',
    'meta.ua', 'mail.ru', 'yandex.ru', 'proton.me', 'protonmail.com', 't-online.de',
}


def score(lead: dict, probe_result: dict | None, has_whatsapp: bool) -> tuple[int, list[str]]:
    """Бал і рядки-пояснення. Формула навмисно проста й пояснювана вголос."""
    points = 0
    why: list[str] = []

    if has_whatsapp:
        points += 30
        why.append('+30 є WhatsApp — повідомлення дійде до власника')
    elif (lead.get('phone') or '').strip():
        points += 10
        why.append('+10 є телефон, але WhatsApp не підтверджено')

    diagnosis = (probe_result or {}).get('diagnosis', '') or 'domain_unknown'
    weights = {
        'dead_dns': (40, 'домен не резолвиться'),
        'unreachable': (35, 'сайт не відповідає'),
        'http_5xx': (35, 'сайт віддає помилку сервера'),
        'tls_expired': (25, 'сертифікат протух'),
        'parked': (25, 'на домені заглушка реєстратора'),
        'placeholder': (20, 'сторінка-заглушка замість сайту'),
        # Не плутати з «сайту немає»: ми лише не знайшли домен серед відомих
        # контактів. Підтверджена відсутність сайту потребує пошукового API
        # (GOOGLE_CSE_* у .env не задані), тож вага навмисно мала — інакше
        # менеджер напише «у вас немає сайту» тому, у кого він є.
        'domain_unknown': (5, 'домен не знайдено серед контактів'),
        'broken_shop': (30, 'магазин не працює'),
        'no_shop': (20, 'торгує без магазину'),
        'social_only': (15, 'тільки соцмережі'),
        'blocked': (0, 'сайт закритий захистом від ботів — перевірити руками'),
    }
    if diagnosis in weights:
        weight, reason = weights[diagnosis]
        points += weight
        why.append(f'+{weight} {reason}')

    signals = {s[0] for s in (probe_result or {}).get('signals', [])}
    if 'not_mobile' in signals:
        points += 5
        why.append('+5 сайт не адаптований під телефон')
    if (lead.get('instagram') or '').strip():
        points += 5
        why.append('+5 є Instagram — видно, що бізнес живий')

    return min(points, 100), why

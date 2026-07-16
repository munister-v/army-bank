"""Тести чистих функцій парсингу Google Custom Search (без мережевих
викликів): відсіювання listicle-сторінок від карток одного бізнесу,
вилучення телефону/email зі сніпету, очищення назви бізнесу з заголовка."""
from __future__ import annotations

from backend.services import google_search_service as gs


# ── _looks_like_listicle ────────────────────────────────────────────────────

def test_listicle_detected_with_leading_rank_number():
    assert gs._looks_like_listicle('10 Best Hair Salons in Krakow - TripAdvisor')


def test_listicle_detected_with_top_n_pattern():
    assert gs._looks_like_listicle('Top 10 Perukarni Krakow 2026')


def test_listicle_detected_cyrillic():
    assert gs._looks_like_listicle('Найкращі перукарні Кракова: ТОП-10')


def test_single_business_not_flagged_as_listicle():
    assert not gs._looks_like_listicle('Cleo Beauty Studio - Home')
    assert not gs._looks_like_listicle('Salon Fryzjerski Anna – Krakow')


def test_own_rating_mention_not_flagged_as_listicle():
    assert not gs._looks_like_listicle('Salon X — Rating 4.9 stars')


# ── _extract_phone ───────────────────────────────────────────────────────────

def test_extract_phone_international_format():
    assert gs._extract_phone('Zadzwoń: +48 739 607 201 lub odwiedź nas.') == '+48 739 607 201'


def test_extract_phone_local_format():
    assert gs._extract_phone('Tel. 0501112233, email: kontakt@example.com') == '0501112233'


def test_extract_phone_returns_empty_when_absent():
    assert gs._extract_phone('Open since 2019. Rating 4.8 (230 reviews).') == ''


def test_extract_phone_ignores_short_numbers():
    assert gs._extract_phone('Оцінка 4.8 з 5, знижка 20%.') == ''


# ── _extract_email ───────────────────────────────────────────────────────────

def test_extract_email_found():
    assert gs._extract_email('Contact us at info@cleobeauty.pl for bookings.') == 'info@cleobeauty.pl'


def test_extract_email_absent():
    assert gs._extract_email('No contact details here.') == ''


# ── _clean_business_name ─────────────────────────────────────────────────────

def test_clean_business_name_strips_home_suffix():
    assert gs._clean_business_name('Cleo Beauty Studio - Home', 'cleobeauty.pl') == 'Cleo Beauty Studio'


def test_clean_business_name_strips_platform_suffix():
    assert gs._clean_business_name('Grind Barbershop | Facebook', 'facebook.com') == 'Grind Barbershop'


def test_clean_business_name_skips_leading_platform_brand():
    # Каталоги часто ставлять СВІЙ бренд першим сегментом — беремо наступний.
    assert gs._clean_business_name('Yelp — Best Hairdresser in Krakow', 'yelp.com') == 'Best Hairdresser in Krakow'


def test_clean_business_name_falls_back_to_domain_when_empty():
    assert gs._clean_business_name('', 'example.com') == 'example.com'


# ── _is_platform_domain ──────────────────────────────────────────────────────

def test_platform_domain_matches_exact_and_subdomain():
    assert gs._is_platform_domain('facebook.com')
    assert gs._is_platform_domain('m.facebook.com')
    assert not gs._is_platform_domain('cleobeauty.pl')


# ── search_businesses candidate shaping (via monkeypatched requests) ────────

def test_search_businesses_flags_listicle_and_dedups(monkeypatch):
    monkeypatch.setattr(gs.config, 'GOOGLE_CSE_API_KEY', 'fake-key')
    monkeypatch.setattr(gs.config, 'GOOGLE_CSE_CX', 'fake-cx')

    class _FakeResp:
        status_code = 200

        def json(self):
            return {
                'searchInformation': {'totalResults': '3'},
                'items': [
                    {
                        'title': 'Cleo Beauty Studio - Home', 'link': 'https://cleobeauty.pl/',
                        'snippet': 'Zadzwoń: +48 739 607 201.',
                    },
                    {
                        'title': '10 Best Hair Salons in Krakow - TripAdvisor',
                        'link': 'https://tripadvisor.com/list123', 'snippet': 'A roundup of the best salons.',
                    },
                    # duplicate of the first result (same domain+title) — must be deduped
                    {
                        'title': 'Cleo Beauty Studio - Home', 'link': 'https://cleobeauty.pl/',
                        'snippet': 'Zadzwoń: +48 739 607 201.',
                    },
                ],
            }

    monkeypatch.setattr(gs.requests, 'get', lambda *a, **kw: _FakeResp())

    result = gs.search_businesses(query_text='Салони краси Kraków Poland', category_label='Салони краси', limit=10)
    assert len(result['candidates']) == 2  # дублікат прибрано

    cleo, listicle = result['candidates']
    assert cleo['business_name'] == 'Cleo Beauty Studio'
    assert cleo['phone'] == '+48 739 607 201'
    assert cleo['signals']['is_listicle'] is False

    assert listicle['signals']['is_listicle'] is True
    assert listicle['suggested_first_offer'] == ''


def test_search_businesses_requires_configuration(monkeypatch):
    monkeypatch.setattr(gs.config, 'GOOGLE_CSE_API_KEY', '')
    monkeypatch.setattr(gs.config, 'GOOGLE_CSE_CX', '')
    try:
        gs.search_businesses(query_text='test')
        assert False, 'expected GoogleSearchError'
    except gs.GoogleSearchError as exc:
        assert 'не налаштован' in exc.message.lower()


def test_search_businesses_uses_per_user_key_over_global(monkeypatch):
    # Глобального ключа немає, але передано власний — має піти в запит.
    monkeypatch.setattr(gs.config, 'GOOGLE_CSE_API_KEY', '')
    monkeypatch.setattr(gs.config, 'GOOGLE_CSE_CX', '')
    captured = {}

    class _FakeResp:
        status_code = 200

        def json(self):
            return {'searchInformation': {'totalResults': '0'}, 'items': []}

    def fake_get(url, params=None, timeout=None):
        captured['params'] = params
        return _FakeResp()

    monkeypatch.setattr(gs.requests, 'get', fake_get)
    gs.search_businesses(query_text='cafe', api_key='USER-KEY', cx='USER-CX')
    assert captured['params']['key'] == 'USER-KEY'
    assert captured['params']['cx'] == 'USER-CX'


def test_verify_credentials_rejects_empty():
    try:
        gs.verify_credentials('', '')
        assert False, 'expected error'
    except gs.GoogleSearchError as exc:
        assert 'cx' in exc.message.lower()


def test_verify_credentials_success(monkeypatch):
    class _FakeResp:
        status_code = 200

        def json(self):
            return {'searchInformation': {'totalResults': '42'}}

    monkeypatch.setattr(gs.requests, 'get', lambda *a, **k: _FakeResp())
    assert gs.verify_credentials('k', 'cx')['total_results'] == 42


def test_verify_credentials_maps_403(monkeypatch):
    class _FakeResp:
        status_code = 403

        def json(self):
            return {'error': {'message': 'API not enabled'}}

    monkeypatch.setattr(gs.requests, 'get', lambda *a, **k: _FakeResp())
    try:
        gs.verify_credentials('k', 'cx')
        assert False, 'expected error'
    except gs.GoogleSearchError as exc:
        assert '403' in exc.message

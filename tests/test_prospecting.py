"""Тести конструктора пошуку клієнтів (/api/prospecting). OSM-виклики
(geocode_area/search_businesses) підмінюються monkeypatch'ем — реальний
пошук по Overpass вже перевірено вручну (реальні бізнеси з Кракова,
кваліфікатори no_website/no_instagram спрацювали коректно)."""
from __future__ import annotations

import random

import pytest

from backend.repositories.user_repository import UserRepository
import backend.routes.prospecting_routes as prospecting_routes


def _rand_uid():
    return ''.join(str(random.randint(0, 9)) for _ in range(7))


def _register(client, uid=None):
    uid = uid or _rand_uid()
    r = client.post('/api/auth/register', json={
        'full_name': f'Тест {uid}', 'phone': f'+38093{uid}',
        'email': f'user-{uid}@test.ua', 'password': 'qwerty',
    })
    data = r.get_json()
    assert data.get('ok'), data.get('error', 'register failed')
    return data['data']['user']['id'], data['data']['token']


@pytest.fixture
def admin_headers(client):
    uid = _rand_uid()
    user_id, token = _register(client, uid)
    UserRepository().update_role(user_id, 'admin')
    return {'Authorization': f'Bearer {token}'}


@pytest.fixture
def soldier_headers(client):
    uid = _rand_uid()
    user_id, token = _register(client, uid)
    UserRepository().update_role(user_id, 'soldier')
    return {'Authorization': f'Bearer {token}'}


def _fake_candidate(name='Test Bakery', phone='', website='', instagram=''):
    return {
        'business_name': name, 'category': 'Пекарні та кондитерські', 'category_key': 'bakery',
        'city_area': 'Krakow', 'phone': phone, 'website_url': website, 'email': '',
        'instagram': instagram, 'source_url': 'https://www.openstreetmap.org/node/1',
        'osm_ref': 'node/1', 'signals': {'no_website': not website, 'no_instagram': not instagram, 'no_facebook': True},
        'opened': None, 'suggested_first_offer': 'Розробка сайту / лендінгу' if not website else '',
    }


# ── /categories ──────────────────────────────────────────────────────────────

def test_categories_requires_admin(client, soldier_headers):
    r = client.get('/api/prospecting/categories', headers=soldier_headers)
    assert r.status_code == 403


def test_categories_returns_curated_list(client, admin_headers):
    r = client.get('/api/prospecting/categories', headers=admin_headers)
    assert r.status_code == 200
    data = r.get_json()['data']
    assert len(data['categories']) >= 20
    assert any(c['key'] == 'bakery' for c in data['categories'])
    assert len(data['qualifiers']) == 3
    assert {'no_website', 'no_instagram', 'no_facebook'} == {q['key'] for q in data['qualifiers']}


# ── /search ──────────────────────────────────────────────────────────────────

def test_search_requires_category_and_country(client, admin_headers):
    r = client.post('/api/prospecting/search', headers=admin_headers, json={'country': 'Poland'})
    assert r.status_code == 400
    r = client.post('/api/prospecting/search', headers=admin_headers, json={'category_key': 'bakery'})
    assert r.status_code == 400


def test_search_success(client, admin_headers, monkeypatch):
    fake_result = {
        'area': 'Kraków, Polska',
        'candidates': [_fake_candidate('Wawel Bakery'), _fake_candidate('Karmello', website='https://karmello.pl')],
        'total_found': 2, 'recent_filter_applied': False,
    }
    monkeypatch.setattr(prospecting_routes.prospecting_service, 'search_businesses', lambda *a, **kw: fake_result)
    r = client.post('/api/prospecting/search', headers=admin_headers, json={
        'category_key': 'bakery', 'country': 'Poland', 'city': 'Krakow', 'qualifiers': ['no_website'],
    })
    assert r.status_code == 200
    data = r.get_json()['data']
    assert data['area'] == 'Kraków, Polska'
    assert len(data['candidates']) == 2


def test_search_accepts_multiple_category_keys(client, admin_headers, monkeypatch):
    captured = {}

    def fake_search(category_keys, *a, **kw):
        captured['category_keys'] = category_keys
        return {'area': 'Kraków, Polska', 'candidates': [], 'total_found': 0, 'recent_filter_applied': False}
    monkeypatch.setattr(prospecting_routes.prospecting_service, 'search_businesses', fake_search)
    r = client.post('/api/prospecting/search', headers=admin_headers, json={
        'category_keys': ['bakery', 'gym'], 'country': 'Poland',
    })
    assert r.status_code == 200
    assert captured['category_keys'] == ['bakery', 'gym']


def test_search_exclude_existing_filters_out_known_leads(client, admin_headers, monkeypatch):
    # "Excl Filter Original" уже в CRM (той самий сайт-домен) — має бути
    # прибрана, "Brand New Excl Co" — новий кандидат, лишається. Ім'я/домен
    # унікальні для цього тесту, щоб не конфліктувати з дедуп-станом інших
    # тестів у файлі (спільна тестова БД у межах прогону — _find_duplicate
    # також зіставляє за назва+місто, не лише за доменом).
    client.post('/api/prospecting/import', headers=admin_headers, json={
        'candidates': [_fake_candidate('Excl Filter Original', website='https://excl-filter-test.example.com')],
        'owner': 'Manager 1',
    })
    fake_result = {
        'area': 'Kraków, Polska',
        'candidates': [
            _fake_candidate('Excl Filter Original', website='https://www.excl-filter-test.example.com/'),
            _fake_candidate('Brand New Excl Co', website='https://brandnew-excl-test.example.com'),
        ],
        'total_found': 2, 'recent_filter_applied': False,
    }
    monkeypatch.setattr(prospecting_routes.prospecting_service, 'search_businesses', lambda *a, **kw: fake_result)
    r = client.post('/api/prospecting/search', headers=admin_headers, json={
        'category_key': 'bakery', 'country': 'Poland', 'exclude_existing': True,
    })
    assert r.status_code == 200
    data = r.get_json()['data']
    assert data['excluded_existing'] == 1
    assert [c['business_name'] for c in data['candidates']] == ['Brand New Excl Co']


def test_search_propagates_prospecting_error_as_502(client, admin_headers, monkeypatch):
    from backend.services.prospecting_service import ProspectingError

    def fail(*a, **kw):
        raise ProspectingError('усі дзеркала Overpass недоступні')
    monkeypatch.setattr(prospecting_routes.prospecting_service, 'search_businesses', fail)
    r = client.post('/api/prospecting/search', headers=admin_headers, json={
        'category_key': 'bakery', 'country': 'Poland',
    })
    assert r.status_code == 502
    assert 'Overpass' in r.get_json()['error']


# ── /import ──────────────────────────────────────────────────────────────────

def test_import_requires_valid_owner(client, admin_headers):
    r = client.post('/api/prospecting/import', headers=admin_headers, json={
        'candidates': [_fake_candidate()], 'owner': 'Nobody',
    })
    assert r.status_code == 400


def test_import_requires_candidates(client, admin_headers):
    r = client.post('/api/prospecting/import', headers=admin_headers, json={
        'candidates': [], 'owner': 'Manager 1',
    })
    assert r.status_code == 400


def test_import_creates_leads(client, admin_headers):
    candidates = [_fake_candidate('Fresh Bakery A'), _fake_candidate('Fresh Bakery B', website='https://b.example.com')]
    r = client.post('/api/prospecting/import', headers=admin_headers, json={
        'candidates': candidates, 'owner': 'Manager 1',
    })
    assert r.status_code == 200
    data = r.get_json()['data']
    assert data['created'] == 2
    assert data['skipped'] == 0

    leads = client.get('/api/leads?per_page=200', headers=admin_headers).get_json()['data']['items']
    names = {l['business_name'] for l in leads}
    assert 'Fresh Bakery A' in names and 'Fresh Bakery B' in names
    lead_b = next(l for l in leads if l['business_name'] == 'Fresh Bakery B')
    assert lead_b['owner'] == 'Manager 1'
    assert lead_b['pipeline'] == 'Prospecting'
    assert lead_b['website_url'] == 'https://b.example.com'


def test_import_skips_duplicate_by_website_domain(client, admin_headers):
    r = client.post('/api/prospecting/import', headers=admin_headers, json={
        'candidates': [_fake_candidate('Dup Original', website='https://samedomain.example.com')],
        'owner': 'Manager 1',
    })
    assert r.get_json()['data']['created'] == 1

    r2 = client.post('/api/prospecting/import', headers=admin_headers, json={
        'candidates': [_fake_candidate('Dup Renamed', website='https://www.samedomain.example.com/')],
        'owner': 'Manager 2',
    })
    data2 = r2.get_json()['data']
    assert data2['created'] == 0
    assert data2['skipped'] == 1


def test_import_skips_duplicate_by_phone(client, admin_headers):
    r = client.post('/api/prospecting/import', headers=admin_headers, json={
        'candidates': [_fake_candidate('Phone Dup A', phone='+48 123 456 789')],
        'owner': 'Manager 1',
    })
    assert r.get_json()['data']['created'] == 1

    r2 = client.post('/api/prospecting/import', headers=admin_headers, json={
        'candidates': [_fake_candidate('Phone Dup B', phone='48123456789')],
        'owner': 'Manager 1',
    })
    assert r2.get_json()['data']['skipped'] == 1


def test_import_caps_at_100_candidates_silently_ignoring_rest(client, admin_headers):
    candidates = [_fake_candidate(f'Bulk {i}') for i in range(105)]
    r = client.post('/api/prospecting/import', headers=admin_headers, json={
        'candidates': candidates, 'owner': 'Manager 2',
    })
    assert r.status_code == 200
    assert r.get_json()['data']['created'] == 100

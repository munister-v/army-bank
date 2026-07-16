"""Тести опортуністичного авто-перезапуску збережених пошуків
(prospecting_routes.maybe_run_scheduled_searches та її складові) — той самий
патерн, що й messenger_routes._maybe_post_scheduler_digest, лише для
Prospecting. Мережеві виклики (Overpass/Google) підмінюються monkeypatch'ем."""
from __future__ import annotations

import json
import random
from datetime import datetime, timedelta

import pytest

import backend.routes.prospecting_routes as pr
from backend.repositories.user_repository import UserRepository


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


def _fake_candidate(name='Biz', phone='', website=''):
    return {
        'business_name': name, 'category': 'Пекарні', 'city_area': 'Krakow', 'phone': phone,
        'website_url': website, 'source_url': website, 'signals': {}, 'opened': None,
        'suggested_first_offer': '', 'score': 1,
    }


# ── _candidate_dedup_key ─────────────────────────────────────────────────────

def test_dedup_key_prefers_phone_over_domain():
    key = pr._candidate_dedup_key({'phone': '+48 123 456 789', 'website_url': 'https://a.example.com'})
    assert key == 'phone:48123456789'


def test_dedup_key_falls_back_to_domain():
    key = pr._candidate_dedup_key({'phone': '', 'website_url': 'https://a.example.com/page'})
    assert key == 'domain:a.example.com'


def test_dedup_key_falls_back_to_name_and_city():
    key = pr._candidate_dedup_key({'business_name': 'Cleo Beauty', 'city_area': 'Krakow'})
    assert key == 'name:cleo beauty|krakow'


# ── _due_for_schedule ────────────────────────────────────────────────────────

def test_due_for_schedule_off_never_due():
    assert not pr._due_for_schedule('off', None)


def test_due_for_schedule_no_last_run_is_due():
    assert pr._due_for_schedule('daily', None)


def test_due_for_schedule_within_window_not_due():
    recent = (datetime.utcnow() - timedelta(hours=2)).isoformat()
    assert not pr._due_for_schedule('daily', recent)


def test_due_for_schedule_past_window_is_due():
    old = (datetime.utcnow() - timedelta(days=2)).isoformat()
    assert pr._due_for_schedule('daily', old)
    assert not pr._due_for_schedule('weekly', old)  # 2 дні < 7 днів


# ── _run_one_scheduled_search: перший запуск не сповіщає, другий — сповіщає ──

def test_first_run_never_notifies(monkeypatch):
    notified = []
    monkeypatch.setattr(pr, '_perform_osm_search', lambda params: {
        'candidates': [_fake_candidate('New Biz', website='https://new.example.com')],
    })
    monkeypatch.setattr(pr, '_notify_new_candidates', lambda name, cands: notified.append((name, cands)))
    marked = {}
    monkeypatch.setattr(pr, '_mark_search_ran', lambda sid, keys: marked.update(id=sid, keys=keys))

    row = {'id': 1, 'name': 'Test Search', 'source': 'osm', 'params': '{}', 'seen_keys': '[]'}
    pr._run_one_scheduled_search(row)

    assert notified == []  # перший запуск — нема з чим порівнювати "нове"
    assert marked['id'] == 1
    assert 'domain:new.example.com' in marked['keys']


def test_second_run_notifies_only_genuinely_new(monkeypatch):
    notified = []
    monkeypatch.setattr(pr, '_perform_osm_search', lambda params: {
        'candidates': [
            _fake_candidate('Already Seen', website='https://seen.example.com'),
            _fake_candidate('Brand New', website='https://brandnew.example.com'),
        ],
    })
    monkeypatch.setattr(pr, '_notify_new_candidates', lambda name, cands: notified.append((name, cands)))
    monkeypatch.setattr(pr, '_mark_search_ran', lambda sid, keys: None)

    row = {
        'id': 2, 'name': 'Test Search', 'source': 'osm', 'params': '{}',
        'seen_keys': json.dumps(['domain:seen.example.com']),
    }
    pr._run_one_scheduled_search(row)

    assert len(notified) == 1
    name, cands = notified[0]
    assert name == 'Test Search'
    assert [c['business_name'] for c in cands] == ['Brand New']


def test_run_swallows_search_errors_without_crashing(monkeypatch):
    from backend.services.prospecting_service import ProspectingError

    def fail(params):
        raise ProspectingError('Overpass недоступний')
    monkeypatch.setattr(pr, '_perform_osm_search', fail)
    marked = []
    monkeypatch.setattr(pr, '_mark_search_ran', lambda sid, keys: marked.append(sid))

    row = {'id': 3, 'name': 'X', 'source': 'osm', 'params': '{}', 'seen_keys': '[]'}
    pr._run_one_scheduled_search(row)  # не має кидати виняток
    assert marked == []  # помилка джерела — не позначаємо як "запущено", спробуємо знову пізніше


# ── Інтеграція: хук у /api/messenger/conversations не ламає опитування ──────

def test_messenger_polling_survives_scheduled_search_hook(client, admin_headers, monkeypatch):
    """Навіть якщо в БД є due-пошук, чий запуск падає з винятком, ендпоінт
    /api/messenger/conversations (опитується фронтендом кожні ~20-30с) все
    одно повертає 200 — фонова робота ніколи не має класти сам поллінг."""
    client.post('/api/prospecting/saved-searches', headers=admin_headers, json={
        'name': 'Boom Search', 'source': 'osm', 'params': {'category_key': 'bakery', 'country': 'Poland'},
    })
    with __import__('backend.database', fromlist=['get_connection']).get_connection() as conn:
        conn.execute("UPDATE prospecting_saved_searches SET schedule = 'daily' WHERE name = 'Boom Search'")

    def boom(*a, **kw):
        raise RuntimeError('unexpected failure deep in scheduled search')
    monkeypatch.setattr(pr, '_run_one_scheduled_search', boom)
    pr._scheduled_search_checked_on.clear()  # форсуємо перевірку саме зараз

    r = client.get('/api/messenger/conversations', headers=admin_headers)
    assert r.status_code == 200

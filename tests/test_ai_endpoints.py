"""Тести /api/leads/<id>/ai-draft та /api/leads/<id>/ai-reply-suggestions.

openrouter_service.generate() підмінюється monkeypatch'ем — реальний виклик
OpenRouter (fallback-ланцюжок безкоштовних моделей, реальні cold-outreach
драфти й reply-suggestions мовою клієнта) вже перевірено вручну через живий
ключ; тут перевіряється лише наша власна маршрутизація/валідація/парсинг.
"""
from __future__ import annotations

import random

import pytest

from backend.repositories.user_repository import UserRepository
from backend.services.openrouter_service import OpenRouterError
import backend.routes.leads_routes as leads_routes


def _rand_uid():
    return ''.join(str(random.randint(0, 9)) for _ in range(7))


def _register(client, uid=None):
    uid = uid or _rand_uid()
    r = client.post('/api/auth/register', json={
        'full_name': f'Тест {uid}',
        'phone': f'+38093{uid}',
        'email': f'user-{uid}@test.ua',
        'password': 'qwerty',
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


def _make_lead(client, admin_headers, **overrides):
    payload = {'business_name': 'Test Biz', 'owner': 'Manager 1'}
    payload.update(overrides)
    r = client.post('/api/leads', headers=admin_headers, json=payload)
    assert r.status_code == 200, r.get_json()
    return r.get_json()['data']


# ── /ai-draft ────────────────────────────────────────────────────────────────

def test_ai_draft_requires_admin(client, soldier_headers):
    r = client.post('/api/leads/1/ai-draft', headers=soldier_headers)
    assert r.status_code == 403


def test_ai_draft_not_configured_returns_503(client, admin_headers, monkeypatch):
    lead = _make_lead(client, admin_headers)
    monkeypatch.setattr(leads_routes.openrouter_service, 'is_configured', lambda: False)
    r = client.post(f"/api/leads/{lead['id']}/ai-draft", headers=admin_headers)
    assert r.status_code == 503


def test_ai_draft_lead_not_found(client, admin_headers, monkeypatch):
    monkeypatch.setattr(leads_routes.openrouter_service, 'is_configured', lambda: True)
    r = client.post('/api/leads/999999/ai-draft', headers=admin_headers)
    assert r.status_code == 404


def test_ai_draft_success(client, admin_headers, monkeypatch):
    lead = _make_lead(client, admin_headers, category='Bakery', country='Poland')
    monkeypatch.setattr(leads_routes.openrouter_service, 'is_configured', lambda: True)
    monkeypatch.setattr(
        leads_routes.openrouter_service, 'generate',
        lambda messages, **kw: (
            "###EN1\nHi there, love your bakery!\n###EN2\nHello, quick question about your site.\n"
            "###LOCAL:Polish\nCzesc, super piekarnia!",
            'some/free-model:free',
        ),
    )
    r = client.post(f"/api/leads/{lead['id']}/ai-draft", headers=admin_headers)
    assert r.status_code == 200
    data = r.get_json()['data']
    assert data['variants_en'] == ['Hi there, love your bakery!', 'Hello, quick question about your site.']
    assert data['local'] == {'lang': 'Polish', 'text': 'Czesc, super piekarnia!'}
    assert data['model_used'] == 'some/free-model:free'


def test_ai_draft_openrouter_failure_returns_502(client, admin_headers, monkeypatch):
    lead = _make_lead(client, admin_headers)
    monkeypatch.setattr(leads_routes.openrouter_service, 'is_configured', lambda: True)

    def fail(messages, **kw):
        raise OpenRouterError('all free models exhausted')
    monkeypatch.setattr(leads_routes.openrouter_service, 'generate', fail)

    r = client.post(f"/api/leads/{lead['id']}/ai-draft", headers=admin_headers)
    assert r.status_code == 502
    assert 'all free models exhausted' in r.get_json()['error']


def test_ai_draft_unparseable_response_returns_502(client, admin_headers, monkeypatch):
    """Модель відповіла (немає OpenRouterError), але зовсім без тегів і
    порожнім текстом — parse_draft_response() поверне ні EN, ні LOCAL."""
    lead = _make_lead(client, admin_headers)
    monkeypatch.setattr(leads_routes.openrouter_service, 'is_configured', lambda: True)
    monkeypatch.setattr(leads_routes.openrouter_service, 'generate', lambda messages, **kw: ('   ', 'x/model:free'))
    r = client.post(f"/api/leads/{lead['id']}/ai-draft", headers=admin_headers)
    assert r.status_code == 502


# ── /ai-reply-suggestions ────────────────────────────────────────────────────

def test_ai_reply_requires_admin(client, soldier_headers):
    r = client.post('/api/leads/1/ai-reply-suggestions', headers=soldier_headers)
    assert r.status_code == 403


def test_ai_reply_no_history_returns_400(client, admin_headers, monkeypatch):
    lead = _make_lead(client, admin_headers)
    monkeypatch.setattr(leads_routes.openrouter_service, 'is_configured', lambda: True)
    r = client.post(f"/api/leads/{lead['id']}/ai-reply-suggestions", headers=admin_headers)
    assert r.status_code == 400


def _seed_customer_message(client, admin_headers, lead_id: int, text: str) -> int:
    """Insert a real inbound-looking message into the lead's conversation,
    the same way the WhatsApp/Instagram webhook does for a genuine customer
    reply (a different sender_id than the acting admin)."""
    conv = client.get(f'/api/leads/{lead_id}/conversation', headers=admin_headers).get_json()['data']
    conv_id = conv['conversation_id']
    from backend.database import get_connection
    from backend.services.messenger_crypto import encrypt_message
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO users(full_name, phone, email, password_hash, role) "
            "SELECT 'Test Customer', '+48500999888', 'cust-test@example.com', 'x', 'channel_contact' "
            "WHERE NOT EXISTS (SELECT 1 FROM users WHERE phone = '+48500999888')"
        )
        cust = conn.execute("SELECT id FROM users WHERE phone = '+48500999888'").fetchone()
        conn.execute(
            'INSERT INTO messages (conversation_id, sender_id, text, msg_type) VALUES (%s, %s, %s, %s)',
            (conv_id, cust['id'], encrypt_message(text), 'text'),
        )
    return conv_id


def test_ai_reply_success(client, admin_headers, monkeypatch):
    lead = _make_lead(client, admin_headers, business_name='Krakow Bakery')
    _seed_customer_message(client, admin_headers, lead['id'], 'Ile kosztuje strona internetowa?')

    monkeypatch.setattr(leads_routes.openrouter_service, 'is_configured', lambda: True)
    monkeypatch.setattr(
        leads_routes.openrouter_service, 'generate',
        lambda messages, **kw: (
            "###REPLY1:Polish\nDzien dobry, cena zalezy od zakresu.\n"
            "###GLOSS1\nHello, the price depends on scope.",
            'some/free-model:free',
        ),
    )
    r = client.post(f"/api/leads/{lead['id']}/ai-reply-suggestions", headers=admin_headers, json={'count': 1})
    assert r.status_code == 200
    data = r.get_json()['data']
    assert len(data['variants']) == 1
    assert data['variants'][0]['lang'] == 'Polish'
    assert 'zalezy od zakresu' in data['variants'][0]['text']
    assert data['model_used'] == 'some/free-model:free'


def test_ai_reply_openrouter_failure_returns_502(client, admin_headers, monkeypatch):
    lead = _make_lead(client, admin_headers)
    _seed_customer_message(client, admin_headers, lead['id'], 'Hello, any info?')
    monkeypatch.setattr(leads_routes.openrouter_service, 'is_configured', lambda: True)

    def fail(messages, **kw):
        raise OpenRouterError('rate limited everywhere')
    monkeypatch.setattr(leads_routes.openrouter_service, 'generate', fail)

    r = client.post(f"/api/leads/{lead['id']}/ai-reply-suggestions", headers=admin_headers)
    assert r.status_code == 502
    assert 'rate limited everywhere' in r.get_json()['error']


def test_ai_reply_count_param_is_clamped(client, admin_headers, monkeypatch):
    lead = _make_lead(client, admin_headers)
    _seed_customer_message(client, admin_headers, lead['id'], 'Hi!')
    monkeypatch.setattr(leads_routes.openrouter_service, 'is_configured', lambda: True)

    captured = {}
    def fake_generate(messages, **kw):
        captured['prompt'] = messages[1]['content']
        return ("###REPLY1:English\nHi there!\n###GLOSS1\nHi there!", 'x/model:free')
    monkeypatch.setattr(leads_routes.openrouter_service, 'generate', fake_generate)

    r = client.post(f"/api/leads/{lead['id']}/ai-reply-suggestions", headers=admin_headers, json={'count': 99})
    assert r.status_code == 200
    # count clamped to max 3 — the prompt should ask for 3 variants, not 99.
    assert 'Suggest 3 different reply variants' in captured['prompt']

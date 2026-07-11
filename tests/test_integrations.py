"""Тести ARM CRM — самообслуговування менеджерів (/api/integrations).

Meta Graph API-виклики (verify_whatsapp_number / verify_instagram_account)
підмінюються monkeypatch'ем — реальну мережеву перевірку вже зроблено вручну
(див. коміти 0339c3c/6db50ae), тут перевіряється тільки наша власна логіка:
маршрутизація, валідація, шифрування токена, стан підключення.
"""
from __future__ import annotations

import random

import pytest

from backend.repositories.user_repository import UserRepository
from backend.services.meta_api import MetaApiError
import backend.routes.integrations_routes as integrations_routes


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
    # The very first user ever registered in a fresh DB auto-becomes admin
    # (see auth flow bootstrap) — force back to a non-admin role so this
    # fixture is deterministic whether the file runs alone or with the suite.
    UserRepository().update_role(user_id, 'soldier')
    return {'Authorization': f'Bearer {token}'}


# ── GET /api/integrations ─────────────────────────────────────────────────────

def test_list_requires_admin(client, soldier_headers):
    r = client.get('/api/integrations', headers=soldier_headers)
    assert r.status_code == 403


def test_list_starts_all_disconnected(client, admin_headers):
    r = client.get('/api/integrations', headers=admin_headers)
    assert r.status_code == 200
    items = r.get_json()['data']
    assert len(items) == 4  # 2 managers x 2 channels
    assert all(item['status'] == 'disconnected' for item in items)
    managers = {item['manager'] for item in items}
    assert managers == {'Manager 1', 'Manager 2'}
    channels = {item['channel'] for item in items}
    assert channels == {'whatsapp', 'instagram'}


# ── POST /api/integrations/whatsapp ──────────────────────────────────────────

def test_connect_whatsapp_missing_fields(client, admin_headers):
    r = client.post('/api/integrations/whatsapp', headers=admin_headers, json={'manager': 'Manager 1'})
    assert r.status_code == 400


def test_connect_whatsapp_unknown_manager(client, admin_headers, monkeypatch):
    r = client.post('/api/integrations/whatsapp', headers=admin_headers, json={
        'manager': 'Manager 99', 'phone_number_id': '123', 'access_token': 'tok',
    })
    assert r.status_code == 400


def test_connect_whatsapp_meta_rejects_token(client, admin_headers, monkeypatch):
    def fake_verify(phone_number_id, access_token):
        raise MetaApiError('Invalid OAuth access token')
    monkeypatch.setattr(integrations_routes, 'verify_whatsapp_number', fake_verify)

    r = client.post('/api/integrations/whatsapp', headers=admin_headers, json={
        'manager': 'Manager 1', 'phone_number_id': '999888777', 'access_token': 'bad-token',
    })
    assert r.status_code == 400
    assert 'Invalid OAuth' in r.get_json()['error']

    # A rejected verification must not be persisted as a connected integration.
    listing = client.get('/api/integrations', headers=admin_headers).get_json()['data']
    row = next(i for i in listing if i['manager'] == 'Manager 1' and i['channel'] == 'whatsapp')
    assert row['status'] == 'disconnected'


def test_connect_whatsapp_success_then_disconnect(client, admin_headers, monkeypatch):
    def fake_verify(phone_number_id, access_token):
        return {'display_phone_number': '+380671112233', 'verified_name': 'Miša Shop'}
    monkeypatch.setattr(integrations_routes, 'verify_whatsapp_number', fake_verify)

    r = client.post('/api/integrations/whatsapp', headers=admin_headers, json={
        'manager': 'Manager 1', 'phone_number_id': '999888777', 'access_token': 'real-looking-token',
    })
    assert r.status_code == 200
    data = r.get_json()['data']
    assert data['status'] == 'connected'
    assert data['display_label'] == 'Miša Shop'
    assert data['signature_verified'] is False  # no app_secret supplied
    # Token must never be returned in full — only a masked preview.
    assert 'real-looking-token' not in str(data)
    assert data['token_preview'].startswith('real')

    listing = client.get('/api/integrations', headers=admin_headers).get_json()['data']
    row = next(i for i in listing if i['manager'] == 'Manager 1' and i['channel'] == 'whatsapp')
    assert row['status'] == 'connected'

    r = client.delete('/api/integrations/Manager 1/whatsapp', headers=admin_headers)
    assert r.status_code == 200

    listing = client.get('/api/integrations', headers=admin_headers).get_json()['data']
    row = next(i for i in listing if i['manager'] == 'Manager 1' and i['channel'] == 'whatsapp')
    assert row['status'] == 'disconnected'


def test_connect_whatsapp_with_app_secret_marks_signature_verified(client, admin_headers, monkeypatch):
    monkeypatch.setattr(integrations_routes, 'verify_whatsapp_number',
                         lambda pid, tok: {'display_phone_number': '+1', 'verified_name': 'X'})
    r = client.post('/api/integrations/whatsapp', headers=admin_headers, json={
        'manager': 'Manager 2', 'phone_number_id': '111', 'access_token': 'tok',
        'app_secret': 'shh-its-a-secret',
    })
    assert r.status_code == 200
    assert r.get_json()['data']['signature_verified'] is True


# ── POST /api/integrations/instagram ─────────────────────────────────────────

def test_connect_instagram_success(client, admin_headers, monkeypatch):
    monkeypatch.setattr(integrations_routes, 'verify_instagram_account',
                         lambda uid, tok: {'username': 'miša.shop', 'name': 'Miša Shop'})
    r = client.post('/api/integrations/instagram', headers=admin_headers, json={
        'manager': 'Manager 1', 'ig_user_id': '178414000', 'access_token': 'ig-token',
    })
    assert r.status_code == 200
    data = r.get_json()['data']
    assert data['status'] == 'connected'
    assert data['display_label'] == '@miša.shop'


# ── POST /api/integrations/<manager>/<channel>/check ────────────────────────

def test_check_reverifies_and_can_flip_to_error(client, admin_headers, monkeypatch):
    monkeypatch.setattr(integrations_routes, 'verify_whatsapp_number',
                         lambda pid, tok: {'display_phone_number': '+1', 'verified_name': 'Ok Now'})
    client.post('/api/integrations/whatsapp', headers=admin_headers, json={
        'manager': 'Manager 1', 'phone_number_id': '999888777', 'access_token': 'tok',
    })

    # Re-check succeeds while the token is still good.
    r = client.post('/api/integrations/Manager 1/whatsapp/check', headers=admin_headers)
    assert r.status_code == 200
    assert r.get_json()['data']['status'] == 'connected'

    # Token "expires" — re-check should surface the error and flip status.
    def fake_verify_expired(pid, tok):
        raise MetaApiError('Error validating access token: Session has expired')
    monkeypatch.setattr(integrations_routes, 'verify_whatsapp_number', fake_verify_expired)

    r = client.post('/api/integrations/Manager 1/whatsapp/check', headers=admin_headers)
    assert r.status_code == 400

    listing = client.get('/api/integrations', headers=admin_headers).get_json()['data']
    row = next(i for i in listing if i['manager'] == 'Manager 1' and i['channel'] == 'whatsapp')
    assert row['status'] == 'error'


def test_check_unknown_connection_404(client, admin_headers):
    r = client.post('/api/integrations/Manager 2/instagram/check', headers=admin_headers)
    assert r.status_code == 404


# ── GET /api/integrations/webhook-info ──────────────────────────────────────

def test_webhook_info_is_stable_and_matches_public_handshake(client, admin_headers):
    r = client.get('/api/integrations/webhook-info', headers=admin_headers)
    assert r.status_code == 200
    data = r.get_json()['data']
    assert data['webhook_url'].endswith('/api/webhooks/meta')
    token = data['verify_token']
    assert len(token) == 24

    # Same value used by the actual public GET handshake endpoint.
    r2 = client.get(
        f'/api/webhooks/meta?hub.mode=subscribe&hub.verify_token={token}&hub.challenge=ping123'
    )
    assert r2.status_code == 200
    assert r2.get_data(as_text=True) == 'ping123'

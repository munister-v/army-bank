"""Тести Web Push маршрутів Army Bank."""
from __future__ import annotations

import random
import pytest


def _rand_uid():
    return ''.join(str(random.randint(0, 9)) for _ in range(7))


def _register(client, uid=None):
    uid = uid or _rand_uid()
    r = client.post('/api/auth/register', json={
        'full_name': f'Push User {uid}',
        'phone': f'+38096{uid}',
        'email': f'push-{uid}@test.ua',
        'password': 'qwerty',
    })
    data = r.get_json()
    assert data.get('ok'), data.get('error', 'register failed')
    return data['data']['user']['id'], data['data']['token']


@pytest.fixture
def user_headers(client):
    _, token = _register(client)
    return {'Authorization': f'Bearer {token}'}


# ── GET /api/push/vapid-public-key ────────────────────────────────────────────

def test_vapid_public_key_no_auth(client):
    """Публічний ключ доступний без авторизації."""
    r = client.get('/api/push/vapid-public-key')
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    assert isinstance(data['data'], str)
    assert len(data['data']) > 10


# ── POST /api/push/subscribe ─────────────────────────────────────────────────

def test_push_subscribe_requires_auth(client):
    r = client.post('/api/push/subscribe', json={
        'endpoint': 'https://push.example.com/sub/1',
        'p256dh': 'dGVzdC1wMjU2ZGg=',
        'auth': 'dGVzdC1hdXRo',
    })
    assert r.status_code == 401


def test_push_subscribe_ok(client, user_headers):
    r = client.post('/api/push/subscribe', json={
        'endpoint': f'https://push.example.com/sub/{_rand_uid()}',
        'p256dh': 'dGVzdC1wMjU2ZGg=',
        'auth': 'dGVzdC1hdXRo',
    }, headers=user_headers)
    assert r.status_code == 200
    assert r.get_json()['ok'] is True


def test_push_subscribe_missing_endpoint(client, user_headers):
    r = client.post('/api/push/subscribe', json={
        'p256dh': 'dGVzdC1wMjU2ZGg=',
        'auth': 'dGVzdC1hdXRo',
    }, headers=user_headers)
    assert r.status_code == 400


def test_push_subscribe_missing_p256dh(client, user_headers):
    r = client.post('/api/push/subscribe', json={
        'endpoint': f'https://push.example.com/sub/{_rand_uid()}',
        'auth': 'dGVzdC1hdXRo',
    }, headers=user_headers)
    assert r.status_code == 400


def test_push_subscribe_missing_auth(client, user_headers):
    r = client.post('/api/push/subscribe', json={
        'endpoint': f'https://push.example.com/sub/{_rand_uid()}',
        'p256dh': 'dGVzdC1wMjU2ZGg=',
    }, headers=user_headers)
    assert r.status_code == 400


def test_push_subscribe_upsert_same_endpoint(client, user_headers):
    """Повторна підписка з тим самим endpoint не дає помилки."""
    endpoint = f'https://push.example.com/sub/{_rand_uid()}'
    payload = {'endpoint': endpoint, 'p256dh': 'dGVzdA==', 'auth': 'dGVzdA=='}
    r1 = client.post('/api/push/subscribe', json=payload, headers=user_headers)
    assert r1.status_code == 200
    r2 = client.post('/api/push/subscribe', json=payload, headers=user_headers)
    assert r2.status_code == 200


# ── DELETE /api/push/unsubscribe ─────────────────────────────────────────────

def test_push_unsubscribe_requires_auth(client):
    r = client.delete('/api/push/unsubscribe', json={
        'endpoint': 'https://push.example.com/sub/1',
    })
    assert r.status_code == 401


def test_push_unsubscribe_ok(client, user_headers):
    endpoint = f'https://push.example.com/sub/{_rand_uid()}'
    # Subscribe first
    client.post('/api/push/subscribe', json={
        'endpoint': endpoint, 'p256dh': 'dGVzdA==', 'auth': 'dGVzdA==',
    }, headers=user_headers)
    # Then unsubscribe
    r = client.delete('/api/push/unsubscribe', json={'endpoint': endpoint},
                      headers=user_headers)
    assert r.status_code == 200
    assert r.get_json()['ok'] is True


def test_push_unsubscribe_nonexistent_ok(client, user_headers):
    """Відписка від неіснуючого endpoint повертає ok."""
    r = client.delete('/api/push/unsubscribe',
                      json={'endpoint': 'https://push.example.com/nonexistent'},
                      headers=user_headers)
    assert r.status_code == 200
    assert r.get_json()['ok'] is True


def test_push_unsubscribe_no_endpoint_ok(client, user_headers):
    """Порожній запит відписки не викликає помилки."""
    r = client.delete('/api/push/unsubscribe', json={}, headers=user_headers)
    assert r.status_code == 200
    assert r.get_json()['ok'] is True

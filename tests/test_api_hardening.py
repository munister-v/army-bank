"""Тести API hardening: idempotency, request-id, rate-limit."""
from __future__ import annotations

import random


def _rand_uid() -> str:
    return ''.join(str(random.randint(0, 9)) for _ in range(7))


def _register(client):
    uid = _rand_uid()
    r = client.post('/api/auth/register', json={
        'full_name': f'Hardening User {uid}',
        'phone': f'+38095{uid}',
        'email': f'hard-{uid}@test.ua',
        'password': 'qwerty',
    })
    data = r.get_json()
    assert data.get('ok'), data.get('error', 'register failed')
    return data['data']['token']


def test_request_id_echoed(client):
    custom_req_id = 'req-hardening-123'
    r = client.get('/health', headers={'X-Request-Id': custom_req_id})
    assert r.status_code == 200
    assert r.headers.get('X-Request-Id') == custom_req_id


def test_request_id_generated_when_missing(client):
    r = client.get('/health')
    assert r.status_code == 200
    request_id = (r.headers.get('X-Request-Id') or '').strip()
    assert request_id


def test_topup_requires_idempotency_when_enabled_in_tests(client, app):
    app.config['ENFORCE_IDEMPOTENCY_IN_TESTS'] = True
    token = _register(client)
    headers = {'Authorization': f'Bearer {token}'}
    r = client.post('/api/transactions/topup', json={'amount': 100}, headers=headers)
    assert r.status_code == 400
    payload = r.get_json()
    assert payload.get('ok') is False
    assert 'Idempotency-Key' in (payload.get('error') or '')


def test_topup_idempotency_replay_does_not_double_credit(client, app):
    app.config['ENFORCE_IDEMPOTENCY_IN_TESTS'] = True
    token = _register(client)
    headers = {
        'Authorization': f'Bearer {token}',
        'Idempotency-Key': 'test-topup-replay-001',
    }

    first = client.post('/api/transactions/topup', json={'amount': 250}, headers=headers)
    second = client.post('/api/transactions/topup', json={'amount': 250}, headers=headers)
    assert first.status_code == 200
    assert second.status_code == 200

    balance_resp = client.get('/api/accounts/main', headers={'Authorization': f'Bearer {token}'})
    assert balance_resp.status_code == 200
    balance = float(balance_resp.get_json()['data']['balance'])
    assert balance == 250.0


def test_topup_idempotency_conflict_for_different_payload(client, app):
    app.config['ENFORCE_IDEMPOTENCY_IN_TESTS'] = True
    token = _register(client)
    headers = {
        'Authorization': f'Bearer {token}',
        'Idempotency-Key': 'test-topup-conflict-001',
    }

    first = client.post('/api/transactions/topup', json={'amount': 100}, headers=headers)
    assert first.status_code == 200

    second = client.post('/api/transactions/topup', json={'amount': 999}, headers=headers)
    assert second.status_code == 409
    payload = second.get_json()
    assert payload.get('ok') is False


def test_login_rate_limit_can_be_enabled_in_testing(client, app):
    app.config['ENABLE_RATE_LIMIT_IN_TESTS'] = True

    identity = f'unknown-{_rand_uid()}@test.ua'
    statuses = []
    for _ in range(13):
        resp = client.post('/api/auth/login', json={
            'identity': identity,
            'password': 'wrong-password',
        })
        statuses.append(resp.status_code)

    assert statuses[-1] == 429

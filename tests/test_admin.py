"""Тести адмінських маршрутів Army Bank."""
from __future__ import annotations

import random
import pytest
from backend.repositories.user_repository import UserRepository


# ── Helpers ──────────────────────────────────────────────────────────────────

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


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def admin_headers(client):
    uid = _rand_uid()
    user_id, token = _register(client, uid)
    UserRepository().update_role(user_id, 'admin')
    return {'Authorization': f'Bearer {token}'}


@pytest.fixture
def soldier(client):
    uid = _rand_uid()
    user_id, token = _register(client, uid)
    return user_id, token


# ── /api/admin/stats ──────────────────────────────────────────────────────────

def test_admin_stats_ok(client, admin_headers):
    r = client.get('/api/admin/stats', headers=admin_headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    d = data['data']
    assert 'total_users' in d
    assert 'total_balance' in d
    assert 'total_tx' in d
    assert 'total_payouts' in d
    assert 'total_donations' in d
    assert 'by_role' in d
    assert 'recent_tx' in d


def test_admin_stats_requires_auth(client):
    r = client.get('/api/admin/stats')
    assert r.status_code == 401


def test_admin_stats_requires_admin_role(client):
    _, token = _register(client)
    r = client.get('/api/admin/stats', headers={'Authorization': f'Bearer {token}'})
    assert r.status_code == 403


# ── /api/admin/users ──────────────────────────────────────────────────────────

def test_admin_list_users_ok(client, admin_headers):
    r = client.get('/api/admin/users', headers=admin_headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    assert isinstance(data['data'], list)


def test_admin_list_users_search(client, admin_headers, soldier):
    """Search uses ILIKE — only supported on PostgreSQL, skipped on SQLite."""
    import os
    import pytest
    if not os.getenv('DATABASE_URL'):
        pytest.skip('ILIKE search requires PostgreSQL')
    user_id, _ = soldier
    user = UserRepository().get_by_id(user_id)
    name_part = user['full_name'][:5]
    r = client.get(f'/api/admin/users?search={name_part}', headers=admin_headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    assert isinstance(data['data'], list)


def test_admin_list_users_role_filter(client, admin_headers):
    r = client.get('/api/admin/users?role=soldier', headers=admin_headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    for u in data['data']:
        assert u['role'] == 'soldier'


def test_admin_get_user_ok(client, admin_headers, soldier):
    user_id, _ = soldier
    r = client.get(f'/api/admin/users/{user_id}', headers=admin_headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    assert data['data']['id'] == user_id
    assert 'account' in data['data']


def test_admin_get_user_not_found(client, admin_headers):
    r = client.get('/api/admin/users/999999', headers=admin_headers)
    assert r.status_code == 404


def test_admin_get_user_account_ok(client, admin_headers, soldier):
    user_id, _ = soldier
    r = client.get(f'/api/admin/users/{user_id}/account', headers=admin_headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    assert 'balance' in data['data']
    assert 'account_number' in data['data']


# ── /api/admin/users/<id>/role ────────────────────────────────────────────────

def test_admin_update_user_role_ok(client, admin_headers, soldier):
    user_id, _ = soldier
    r = client.patch(f'/api/admin/users/{user_id}/role',
                     json={'role': 'operator'},
                     headers=admin_headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    assert data['data']['role'] == 'operator'


def test_admin_update_user_role_invalid(client, admin_headers, soldier):
    user_id, _ = soldier
    r = client.patch(f'/api/admin/users/{user_id}/role',
                     json={'role': 'superuser'},
                     headers=admin_headers)
    assert r.status_code == 400


def test_admin_update_user_role_back_to_soldier(client, admin_headers, soldier):
    user_id, _ = soldier
    client.patch(f'/api/admin/users/{user_id}/role',
                 json={'role': 'operator'}, headers=admin_headers)
    r = client.patch(f'/api/admin/users/{user_id}/role',
                     json={'role': 'soldier'}, headers=admin_headers)
    assert r.status_code == 200
    assert r.get_json()['data']['role'] == 'soldier'


# ── /api/admin/payouts ────────────────────────────────────────────────────────

def test_admin_create_payout_ok(client, admin_headers, soldier):
    user_id, token = soldier
    r = client.post('/api/admin/payouts', json={
        'user_id': user_id,
        'amount': 5000,
        'title': 'Тестова виплата',
        'payout_type': 'combat',
    }, headers=admin_headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    assert data['data']['amount'] == 5000.0
    assert data['data']['user_id'] == user_id
    assert data['data']['new_balance'] == 5000.0


def test_admin_create_payout_updates_balance(client, admin_headers, soldier):
    user_id, token = soldier
    # First payout
    client.post('/api/admin/payouts', json={
        'user_id': user_id, 'amount': 1000, 'title': 'Перша', 'payout_type': 'combat',
    }, headers=admin_headers)
    # Second payout
    r = client.post('/api/admin/payouts', json={
        'user_id': user_id, 'amount': 500, 'title': 'Друга', 'payout_type': 'medical',
    }, headers=admin_headers)
    assert r.status_code == 200
    assert r.get_json()['data']['new_balance'] == 1500.0


def test_admin_create_payout_missing_user_id(client, admin_headers):
    r = client.post('/api/admin/payouts', json={
        'amount': 100, 'title': 'Тест', 'payout_type': 'combat',
    }, headers=admin_headers)
    assert r.status_code == 400


def test_admin_create_payout_zero_amount(client, admin_headers, soldier):
    user_id, _ = soldier
    r = client.post('/api/admin/payouts', json={
        'user_id': user_id, 'amount': 0, 'title': 'Тест', 'payout_type': 'combat',
    }, headers=admin_headers)
    assert r.status_code == 400


def test_admin_create_payout_negative_amount(client, admin_headers, soldier):
    user_id, _ = soldier
    r = client.post('/api/admin/payouts', json={
        'user_id': user_id, 'amount': -100, 'title': 'Тест', 'payout_type': 'combat',
    }, headers=admin_headers)
    assert r.status_code == 400


def test_admin_create_payout_unknown_user(client, admin_headers):
    r = client.post('/api/admin/payouts', json={
        'user_id': 999999, 'amount': 100, 'title': 'Тест', 'payout_type': 'combat',
    }, headers=admin_headers)
    assert r.status_code == 404


# ── /api/admin/transactions ───────────────────────────────────────────────────

def test_admin_list_transactions_ok(client, admin_headers):
    r = client.get('/api/admin/transactions', headers=admin_headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    assert isinstance(data['data'], list)
    assert 'total' in data


def test_admin_list_transactions_pagination(client, admin_headers):
    r = client.get('/api/admin/transactions?limit=5&offset=0', headers=admin_headers)
    assert r.status_code == 200
    data = r.get_json()
    assert len(data['data']) <= 5


def test_admin_list_transactions_filter_type(client, admin_headers, soldier):
    user_id, _ = soldier
    # Seed a payout transaction
    client.post('/api/admin/payouts', json={
        'user_id': user_id, 'amount': 200, 'title': 'Фільтр', 'payout_type': 'combat',
    }, headers=admin_headers)
    r = client.get('/api/admin/transactions?tx_type=payout', headers=admin_headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    for tx in data['data']:
        assert tx['tx_type'] == 'payout'


def test_admin_user_transactions_ok(client, admin_headers, soldier):
    user_id, _ = soldier
    client.post('/api/admin/payouts', json={
        'user_id': user_id, 'amount': 300, 'title': 'Транзакція', 'payout_type': 'combat',
    }, headers=admin_headers)
    r = client.get(f'/api/admin/users/{user_id}/transactions', headers=admin_headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    assert isinstance(data['data'], list)
    assert len(data['data']) >= 1


# ── /api/admin/audit-logs ────────────────────────────────────────────────────

def test_admin_audit_logs_ok(client, admin_headers):
    r = client.get('/api/admin/audit-logs', headers=admin_headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    assert isinstance(data['data'], list)


def test_admin_audit_logs_after_payout(client, admin_headers, soldier):
    user_id, _ = soldier
    client.post('/api/admin/payouts', json={
        'user_id': user_id, 'amount': 100, 'title': 'Лог', 'payout_type': 'combat',
    }, headers=admin_headers)
    r = client.get('/api/admin/audit-logs', headers=admin_headers)
    assert r.status_code == 200
    logs = r.get_json()['data']
    assert len(logs) >= 1


def test_admin_audit_logs_user_filter(client, admin_headers, soldier):
    user_id, _ = soldier
    client.post('/api/admin/payouts', json={
        'user_id': user_id, 'amount': 100, 'title': 'Лог', 'payout_type': 'combat',
    }, headers=admin_headers)
    r = client.get(f'/api/admin/audit-logs?user_id={user_id}', headers=admin_headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    for log in data['data']:
        assert log['user_id'] == user_id

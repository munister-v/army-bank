"""Тести API платформенного адміна."""
from __future__ import annotations

import random

import pytest

from backend.repositories.user_repository import UserRepository


@pytest.fixture
def platform_admin_headers(client):
    """Реєструє користувача, встановлює role=platform_admin, повертає Authorization."""
    uid = ''.join(str(random.randint(0, 9)) for _ in range(7))
    r = client.post('/api/auth/register', json={
        'full_name': 'Платформа Адмін',
        'phone': f'+38094{uid}',
        'email': f'platform-{uid}@test.ua',
        'password': 'qwerty',
    }, headers={'Content-Type': 'application/json'})
    data = r.get_json()
    assert data.get('ok'), data.get('error', 'register failed')
    user_id = data['data']['user']['id']
    UserRepository().update_role(user_id, 'platform_admin')
    token = data['data']['token']
    return {'Authorization': f'Bearer {token}'}


def test_platform_overview_requires_platform_admin(client):
    """GET /api/platform/overview без platform_admin повертає 403."""
    # Звичайний soldier
    r = client.post('/api/auth/register', json={
        'full_name': 'Солдат',
        'phone': '+380951112233',
        'email': 'soldier@test.ua',
        'password': 'qwerty',
    }, headers={'Content-Type': 'application/json'})
    token = r.get_json()['data']['token']
    r2 = client.get('/api/platform/overview', headers={'Authorization': f'Bearer {token}'})
    assert r2.status_code == 403


def test_platform_overview_ok(client, platform_admin_headers):
    """GET /api/platform/overview повертає статистику."""
    r = client.get('/api/platform/overview', headers=platform_admin_headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    stats = data['data']
    assert 'users_count' in stats
    assert 'accounts_count' in stats
    assert 'total_balance' in stats
    assert 'transactions_count' in stats


def test_platform_users_ok(client, platform_admin_headers):
    """GET /api/platform/users повертає список користувачів."""
    r = client.get('/api/platform/users', headers=platform_admin_headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    assert isinstance(data['data'], list)


def test_platform_transactions_ok(client, platform_admin_headers):
    """GET /api/platform/transactions повертає транзакції."""
    r = client.get('/api/platform/transactions?limit=10', headers=platform_admin_headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    assert isinstance(data['data'], list)


def test_platform_audit_logs_ok(client, platform_admin_headers):
    """GET /api/platform/audit-logs повертає логи."""
    r = client.get('/api/platform/audit-logs?limit=10', headers=platform_admin_headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    assert isinstance(data['data'], list)


def test_platform_seed_demo_ok(client, platform_admin_headers):
    """POST /api/platform/seed-demo створює демо-дані."""
    r = client.post('/api/platform/seed-demo', json={
        'users_count': 2,
        'transactions_per_user': 3,
    }, headers={**platform_admin_headers, 'Content-Type': 'application/json'})
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    result = data['data']
    assert 'created' in result
    assert 'transactions' in result
    assert 'users' in result
    assert result['created'] >= 2
    assert result['transactions'] >= 1  # залежить від random (topup/payout/transfer/donation/savings)

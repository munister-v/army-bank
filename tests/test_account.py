"""Тести рахунків та транзакцій."""
from __future__ import annotations

import pytest


@pytest.fixture
def auth_headers(client, request):
    """Реєструє користувача і повертає заголовок Authorization (унікальний email/phone на тест)."""
    import random
    uid = ''.join(str(random.randint(0, 9)) for _ in range(7))
    r = client.post('/api/auth/register', json={
        'full_name': 'Користувач Рахунку',
        'phone': f'+38093{uid}',
        'email': f'account-{uid}@test.ua',
        'password': 'qwerty',
    }, headers={'Content-Type': 'application/json'})
    data = r.get_json()
    assert data.get('ok'), data.get('error', 'register failed')
    token = data['data']['token']
    return {'Authorization': f'Bearer {token}'}


def test_main_account_after_register(client, auth_headers):
    """Після реєстрації є основний рахунок."""
    r = client.get('/api/accounts/main', headers=auth_headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    assert data['data']['balance'] == 0
    assert data['data']['account_number'].startswith('AB-')


def test_topup(client, auth_headers):
    """Поповнення збільшує баланс."""
    r = client.post('/api/transactions/topup', json={
        'amount': 1000.50,
        'description': 'Тест поповнення',
    }, headers=auth_headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['data']['balance'] == 1000.50

    r2 = client.get('/api/transactions/history', headers=auth_headers)
    assert r2.status_code == 200
    history = r2.get_json()['data']
    assert len(history) >= 1
    assert history[0]['tx_type'] == 'topup'
    assert float(history[0]['amount']) == 1000.50


def test_transfer_insufficient_funds(client, auth_headers):
    """Переказ без коштів повертає помилку."""
    # Другий користувач, щоб рахунок AB-100002 існував
    client.post('/api/auth/register', json={
        'full_name': 'Отримувач',
        'phone': '+380941112233',
        'email': 'recipient@test.ua',
        'password': 'qwerty',
    }, headers={'Content-Type': 'application/json'})
    r = client.post('/api/transactions/transfer', json={
        'recipient_account_number': 'AB-100002',
        'amount': 500,
        'description': 'Тест',
    }, headers=auth_headers)
    data = r.get_json()
    assert data.get('ok') is False
    assert 'error' in data

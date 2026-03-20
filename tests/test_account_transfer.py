"""Тести переказів між рахунками Army Bank."""
from __future__ import annotations

import random
import pytest
from backend.repositories.user_repository import UserRepository


def _rand_uid():
    return ''.join(str(random.randint(0, 9)) for _ in range(7))


def _register(client, uid=None):
    uid = uid or _rand_uid()
    r = client.post('/api/auth/register', json={
        'full_name': f'Transfer User {uid}',
        'phone': f'+38098{uid}',
        'email': f'tx-{uid}@test.ua',
        'password': 'qwerty',
    })
    data = r.get_json()
    assert data.get('ok'), data.get('error', 'register failed')
    return data['data']['user']['id'], data['data']['token']


def _get_account(client, token):
    r = client.get('/api/accounts/main', headers={'Authorization': f'Bearer {token}'})
    assert r.status_code == 200
    return r.get_json()['data']


def _make_admin_headers(client):
    uid = _rand_uid()
    user_id, token = _register(client, uid)
    UserRepository().update_role(user_id, 'admin')
    return {'Authorization': f'Bearer {token}'}


# ── GET /api/accounts/main ────────────────────────────────────────────────────

def test_main_account_requires_auth(client):
    r = client.get('/api/accounts/main')
    assert r.status_code == 401


def test_main_account_ok(client):
    _, token = _register(client)
    r = client.get('/api/accounts/main', headers={'Authorization': f'Bearer {token}'})
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    acc = data['data']
    assert 'balance' in acc
    assert 'account_number' in acc
    assert float(acc['balance']) == 0.0


# ── POST /api/transactions/topup ──────────────────────────────────────────────

def test_topup_ok(client):
    _, token = _register(client)
    r = client.post('/api/transactions/topup', json={
        'amount': 1000, 'description': 'Поповнення',
    }, headers={'Authorization': f'Bearer {token}'})
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    assert float(data['data']['balance']) == 1000.0


def test_topup_requires_auth(client):
    r = client.post('/api/transactions/topup', json={'amount': 100})
    assert r.status_code == 401


def test_topup_zero_amount(client):
    _, token = _register(client)
    r = client.post('/api/transactions/topup', json={'amount': 0},
                    headers={'Authorization': f'Bearer {token}'})
    assert r.status_code in (400, 422)


def test_topup_negative_amount(client):
    _, token = _register(client)
    r = client.post('/api/transactions/topup', json={'amount': -500},
                    headers={'Authorization': f'Bearer {token}'})
    assert r.status_code in (400, 422)


def test_topup_increases_balance(client):
    _, token = _register(client)
    h = {'Authorization': f'Bearer {token}'}
    client.post('/api/transactions/topup', json={'amount': 2000}, headers=h)
    client.post('/api/transactions/topup', json={'amount': 500},  headers=h)
    acc = _get_account(client, token)
    assert float(acc['balance']) == 2500.0


# ── POST /api/transactions/transfer ──────────────────────────────────────────

def test_transfer_ok(client):
    uid1, tok1 = _register(client)
    uid2, tok2 = _register(client)
    h1 = {'Authorization': f'Bearer {tok1}'}

    # Fund sender
    client.post('/api/transactions/topup', json={'amount': 3000}, headers=h1)
    acc2 = _get_account(client, tok2)
    recipient_acc = acc2['account_number']

    r = client.post('/api/transactions/transfer', json={
        'recipient_account_number': recipient_acc,
        'amount': 1000,
        'description': 'Тест переказу',
    }, headers=h1)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True


def test_transfer_updates_both_balances(client):
    uid1, tok1 = _register(client)
    uid2, tok2 = _register(client)
    h1 = {'Authorization': f'Bearer {tok1}'}

    client.post('/api/transactions/topup', json={'amount': 5000}, headers=h1)
    acc2 = _get_account(client, tok2)
    recipient_acc = acc2['account_number']

    client.post('/api/transactions/transfer', json={
        'recipient_account_number': recipient_acc,
        'amount': 1500,
    }, headers=h1)

    acc1_after = _get_account(client, tok1)
    acc2_after = _get_account(client, tok2)
    assert float(acc1_after['balance']) == 3500.0
    assert float(acc2_after['balance']) == 1500.0


def test_transfer_insufficient_funds(client):
    uid1, tok1 = _register(client)
    uid2, tok2 = _register(client)
    h1 = {'Authorization': f'Bearer {tok1}'}

    acc2 = _get_account(client, tok2)
    r = client.post('/api/transactions/transfer', json={
        'recipient_account_number': acc2['account_number'],
        'amount': 9999,
    }, headers=h1)
    assert r.status_code in (400, 422)


def test_transfer_zero_amount(client):
    uid1, tok1 = _register(client)
    uid2, tok2 = _register(client)
    h1 = {'Authorization': f'Bearer {tok1}'}
    client.post('/api/transactions/topup', json={'amount': 1000}, headers=h1)
    acc2 = _get_account(client, tok2)
    r = client.post('/api/transactions/transfer', json={
        'recipient_account_number': acc2['account_number'],
        'amount': 0,
    }, headers=h1)
    assert r.status_code in (400, 422)


def test_transfer_to_self(client):
    uid1, tok1 = _register(client)
    h1 = {'Authorization': f'Bearer {tok1}'}
    client.post('/api/transactions/topup', json={'amount': 1000}, headers=h1)
    acc1 = _get_account(client, tok1)
    r = client.post('/api/transactions/transfer', json={
        'recipient_account_number': acc1['account_number'],
        'amount': 500,
    }, headers=h1)
    # Self-transfer should be rejected or succeed — depends on business logic
    # Just ensure it doesn't 500
    assert r.status_code in (200, 400, 422)


def test_transfer_unknown_recipient(client):
    uid1, tok1 = _register(client)
    h1 = {'Authorization': f'Bearer {tok1}'}
    client.post('/api/transactions/topup', json={'amount': 1000}, headers=h1)
    r = client.post('/api/transactions/transfer', json={
        'recipient_account_number': 'AB-000000',
        'amount': 100,
    }, headers=h1)
    assert r.status_code in (400, 404, 422)


def test_transfer_requires_auth(client):
    r = client.post('/api/transactions/transfer', json={
        'recipient_account_number': 'AB-100001',
        'amount': 100,
    })
    assert r.status_code == 401


# ── GET /api/transactions/history ────────────────────────────────────────────

def test_transaction_history_empty(client):
    _, token = _register(client)
    r = client.get('/api/transactions/history',
                   headers={'Authorization': f'Bearer {token}'})
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    assert isinstance(data['data'], list)


def test_transaction_history_requires_auth(client):
    r = client.get('/api/transactions/history')
    assert r.status_code == 401


def test_transaction_history_shows_topup(client):
    _, token = _register(client)
    h = {'Authorization': f'Bearer {token}'}
    client.post('/api/transactions/topup', json={'amount': 777, 'description': 'Тест'}, headers=h)
    r = client.get('/api/transactions/history', headers=h)
    assert r.status_code == 200
    txs = r.get_json()['data']
    assert len(txs) >= 1
    topups = [t for t in txs if t.get('tx_type') == 'topup']
    assert len(topups) >= 1


def test_transaction_history_shows_transfer(client):
    uid1, tok1 = _register(client)
    uid2, tok2 = _register(client)
    h1 = {'Authorization': f'Bearer {tok1}'}
    client.post('/api/transactions/topup', json={'amount': 2000}, headers=h1)
    acc2 = _get_account(client, tok2)
    client.post('/api/transactions/transfer', json={
        'recipient_account_number': acc2['account_number'],
        'amount': 300,
    }, headers=h1)
    r = client.get('/api/transactions/history', headers=h1)
    txs = r.get_json()['data']
    transfers = [t for t in txs if t.get('tx_type') == 'transfer']
    assert len(transfers) >= 1


def test_transaction_history_filter_by_type(client):
    _, token = _register(client)
    h = {'Authorization': f'Bearer {token}'}
    client.post('/api/transactions/topup', json={'amount': 100}, headers=h)
    r = client.get('/api/transactions/history?tx_type=topup', headers=h)
    assert r.status_code == 200
    txs = r.get_json()['data']
    for tx in txs:
        assert tx['tx_type'] == 'topup'


def test_transaction_history_filter_by_direction(client):
    _, token = _register(client)
    h = {'Authorization': f'Bearer {token}'}
    client.post('/api/transactions/topup', json={'amount': 100}, headers=h)
    r = client.get('/api/transactions/history?direction=in', headers=h)
    assert r.status_code == 200
    txs = r.get_json()['data']
    for tx in txs:
        assert tx['direction'] == 'in'

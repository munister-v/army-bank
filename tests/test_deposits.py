"""Тести строкових депозитів."""
from __future__ import annotations

import random


def _rand_uid() -> str:
    return ''.join(str(random.randint(0, 9)) for _ in range(7))


def _register(client):
    uid = _rand_uid()
    r = client.post('/api/auth/register', json={
        'full_name': f'Deposit User {uid}',
        'phone': f'+38099{uid}',
        'email': f'deposit-{uid}@test.ua',
        'password': 'qwerty',
    })
    data = r.get_json()
    assert data.get('ok'), data.get('error', 'register failed')
    return data['data']['token']


def _auth(token: str) -> dict:
    return {'Authorization': f'Bearer {token}'}


def test_deposit_can_be_closed_early_without_date_type_error(client):
    token = _register(client)

    topup = client.post('/api/transactions/topup', json={'amount': 20000}, headers=_auth(token))
    assert topup.status_code == 200

    create = client.post('/api/deposits', json={
        'amount': 10000,
        'term_months': 6,
        'auto_renew': False,
    }, headers=_auth(token))
    assert create.status_code == 201
    deposit = create.get_json()['data']
    assert isinstance(deposit.get('maturity_date'), str)

    close = client.post(f"/api/deposits/{deposit['id']}/close", json={
        'early': True,
    }, headers=_auth(token))
    assert close.status_code == 200
    payload = close.get_json()['data']
    assert payload['status'] == 'withdrawn_early'
    assert float(payload['payout']) == 10000.0

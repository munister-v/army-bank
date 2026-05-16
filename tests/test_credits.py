"""Тести кредитного модуля."""
from __future__ import annotations

import random


def _rand_uid() -> str:
    return ''.join(str(random.randint(0, 9)) for _ in range(7))


def _register(client):
    uid = _rand_uid()
    r = client.post('/api/auth/register', json={
        'full_name': f'Credit User {uid}',
        'phone': f'+38097{uid}',
        'email': f'credit-{uid}@test.ua',
        'password': 'qwerty',
    })
    data = r.get_json()
    assert data.get('ok'), data.get('error', 'register failed')
    return data['data']['token']


def _auth(token: str, idem: str | None = None) -> dict:
    headers = {'Authorization': f'Bearer {token}'}
    if idem:
        headers['Idempotency-Key'] = idem
    return headers


def test_credit_create_credits_account_and_creates_transaction(client):
    token = _register(client)

    r = client.post('/api/credits', json={
        'amount': 10000,
        'term_months': 12,
        'description': 'Тестовий кредит',
    }, headers=_auth(token, 'credit-create-001'))
    assert r.status_code == 201
    payload = r.get_json()['data']
    assert float(payload['principal']) == 10000.0
    assert float(payload['balance_remaining']) > float(payload['principal'])
    assert float(payload['scheduled_total']) == round(float(payload['monthly_payment']) * 12, 2)

    acc = client.get('/api/accounts/main', headers=_auth(token))
    assert acc.status_code == 200
    assert float(acc.get_json()['data']['balance']) == 10000.0

    history = client.get('/api/transactions/history', headers=_auth(token))
    assert history.status_code == 200
    rows = history.get_json()['data']
    assert any(tx.get('tx_type') == 'credit' and tx.get('direction') == 'in' for tx in rows)


def test_credit_repay_reduces_balance_and_writes_transaction_history(client):
    token = _register(client)
    create = client.post('/api/credits', json={
        'amount': 12000,
        'term_months': 12,
        'description': 'Кредит на спорядження',
    }, headers=_auth(token, 'credit-create-002'))
    assert create.status_code == 201
    credit = create.get_json()['data']
    credit_id = int(credit['id'])
    before_due = float(credit['balance_remaining'])
    monthly_payment = float(credit['monthly_payment'])

    repay = client.post(f'/api/credits/{credit_id}/repay', json={}, headers=_auth(token, 'credit-repay-001'))
    assert repay.status_code == 200
    after = repay.get_json()['data']
    assert round(float(after['balance_remaining']), 2) == round(before_due - monthly_payment, 2)
    assert round(float(after['total_paid']), 2) == round(monthly_payment, 2)

    acc = client.get('/api/accounts/main', headers=_auth(token))
    assert acc.status_code == 200
    assert round(float(acc.get_json()['data']['balance']), 2) == round(12000.0 - monthly_payment, 2)

    history = client.get('/api/transactions/history', headers=_auth(token))
    rows = history.get_json()['data']
    assert any(tx.get('tx_type') == 'credit_payment' and tx.get('direction') == 'out' for tx in rows)


def test_credit_repay_idempotency_replay_does_not_double_charge(client, app):
    app.config['ENFORCE_IDEMPOTENCY_IN_TESTS'] = True
    token = _register(client)

    create = client.post('/api/credits', json={
        'amount': 15000,
        'term_months': 6,
        'description': 'Ідемпотентний кредит',
    }, headers=_auth(token, 'credit-create-003'))
    assert create.status_code == 201
    credit = create.get_json()['data']
    credit_id = int(credit['id'])
    monthly_payment = float(credit['monthly_payment'])

    first = client.post(f'/api/credits/{credit_id}/repay', json={}, headers=_auth(token, 'credit-repay-replay-001'))
    second = client.post(f'/api/credits/{credit_id}/repay', json={}, headers=_auth(token, 'credit-repay-replay-001'))
    assert first.status_code == 200
    assert second.status_code == 200

    acc = client.get('/api/accounts/main', headers=_auth(token))
    assert acc.status_code == 200
    assert round(float(acc.get_json()['data']['balance']), 2) == round(15000.0 - monthly_payment, 2)

    history = client.get('/api/transactions/history', headers=_auth(token))
    repayments = [
        tx for tx in history.get_json()['data']
        if tx.get('tx_type') == 'credit_payment' and tx.get('direction') == 'out'
    ]
    assert len(repayments) == 1

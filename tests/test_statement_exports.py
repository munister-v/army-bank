"""Тести PDF/statement export API."""
from __future__ import annotations

import random


def _rand_uid() -> str:
    return ''.join(str(random.randint(0, 9)) for _ in range(7))


def _register(client):
    uid = _rand_uid()
    r = client.post('/api/auth/register', json={
        'full_name': f'Statement User {uid}',
        'phone': f'+38067{uid}',
        'email': f'statement-{uid}@test.ua',
        'password': 'qwerty',
    })
    data = r.get_json()
    assert data.get('ok'), data.get('error', 'register failed')
    return data['data']['token']


def test_statement_pdf_has_improved_filename(client):
    token = _register(client)
    headers = {'Authorization': f'Bearer {token}'}

    client.post('/api/transactions/topup', json={'amount': 1250.0}, headers=headers)
    r = client.get('/api/transactions/statement?report_type=detailed', headers=headers)

    assert r.status_code == 200
    assert 'application/pdf' in (r.headers.get('Content-Type') or '').lower()
    disposition = (r.headers.get('Content-Disposition') or '').lower()
    assert 'armybank_statement' in disposition
    assert 'detailed' in disposition


def test_receipt_pdf_has_readable_filename(client):
    token = _register(client)
    headers = {'Authorization': f'Bearer {token}'}

    client.post('/api/transactions/topup', json={'amount': 333.0, 'description': 'Topup for receipt'}, headers=headers)
    hist = client.get('/api/transactions/history', headers=headers).get_json()['data']
    tx_id = int(hist[0]['id'])

    r = client.get(f'/api/transactions/{tx_id}/receipt', headers=headers)
    assert r.status_code == 200
    assert 'application/pdf' in (r.headers.get('Content-Type') or '').lower()
    disposition = (r.headers.get('Content-Disposition') or '').lower()
    assert f'armybank_receipt_tx{tx_id}' in disposition


def test_statement_order_flow(client):
    token = _register(client)
    headers = {'Authorization': f'Bearer {token}'}

    order_resp = client.post('/api/transactions/statement/order', json={
        'report_type': 'tax',
        'from_date': '2026-01-01',
        'to_date': '2026-03-01',
    }, headers=headers)
    assert order_resp.status_code == 200
    payload = order_resp.get_json()['data']
    assert payload['status'] == 'ready'
    assert payload['report_type'] == 'tax'
    assert payload['order_id']
    assert 'download_query' in payload
    assert 'filename' in payload

    list_resp = client.get('/api/transactions/statement/orders?limit=10', headers=headers)
    assert list_resp.status_code == 200
    rows = list_resp.get_json()['data']
    assert any((row.get('order_id') == payload['order_id']) for row in rows)


def test_statement_order_invalid_report_type(client):
    token = _register(client)
    headers = {'Authorization': f'Bearer {token}'}

    r = client.post('/api/transactions/statement/order', json={
        'report_type': 'broken',
    }, headers=headers)
    assert r.status_code == 400
    data = r.get_json()
    assert data.get('ok') is False

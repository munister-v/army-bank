"""Тести маркетплейсу: каталог, checkout, інвойси."""
from __future__ import annotations

import random

from backend.repositories.user_repository import UserRepository


def _uid() -> str:
    return ''.join(str(random.randint(0, 9)) for _ in range(7))


def _register(client, uid: str):
    r = client.post('/api/auth/register', json={
        'full_name': f'Market User {uid}',
        'phone': f'+38095{uid}',
        'email': f'market-{uid}@test.ua',
        'password': 'qwerty',
    })
    data = r.get_json()
    assert r.status_code == 200
    assert data.get('ok') is True
    return int(data['data']['user']['id']), data['data']['token']


def _fund(client, admin_headers, user_id: int, amount: float):
    r = client.post('/api/admin/payouts', json={
        'user_id': int(user_id),
        'amount': float(amount),
        'title': 'Marketplace funding',
        'payout_type': 'combat',
    }, headers=admin_headers)
    assert r.status_code == 200
    assert r.get_json().get('ok') is True


def test_marketplace_catalog_has_many_items(client):
    r = client.get('/api/marketplace/catalog')
    assert r.status_code == 200
    data = r.get_json()['data']
    items = data['items']
    assert isinstance(items, list)
    assert len(items) >= 90


def test_marketplace_invoice_flow(client):
    uid_user = _uid()
    uid_admin = _uid()
    user_id, user_token = _register(client, uid_user)
    admin_id, admin_token = _register(client, uid_admin)
    UserRepository().update_role(admin_id, 'admin')

    user_h = {'Authorization': f'Bearer {user_token}'}
    admin_h = {'Authorization': f'Bearer {admin_token}'}

    catalog = client.get('/api/marketplace/catalog').get_json()['data']['items']
    item = catalog[0]
    qty = 1

    create = client.post('/api/marketplace/checkout', headers=user_h, json={
        'items': [{'product_id': int(item['id']), 'qty': qty}],
        'shipping_name': 'Іван Тестовий',
        'shipping_phone': '+380501112233',
        'shipping_address': 'м. Київ, вул. Тестова, 1',
        'note': 'Оплата інвойсом',
        'payment_mode': 'invoice',
    })
    assert create.status_code == 200
    payload = create.get_json()['data']
    assert payload['status'] == 'awaiting_payment'
    assert payload['invoice_status'] == 'issued'
    invoice_number = payload['invoice_number']
    assert invoice_number.startswith('INV-')

    pay_fail = client.post(f'/api/marketplace/invoice/{invoice_number}/pay', headers=user_h)
    assert pay_fail.status_code == 409

    _fund(client, admin_h, user_id, float(item['price']) + 5000)

    pay_ok = client.post(f'/api/marketplace/invoice/{invoice_number}/pay', headers=user_h)
    assert pay_ok.status_code == 200
    paid_data = pay_ok.get_json()['data']
    assert paid_data['status'] == 'paid'

    orders = client.get('/api/marketplace/orders', headers=user_h).get_json()['data']['orders']
    assert orders
    first = orders[0]
    assert first['invoice_number'] == invoice_number
    assert first['status'] == 'paid'


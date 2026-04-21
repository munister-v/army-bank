"""Тести API карток."""
from __future__ import annotations

import random

import pytest


@pytest.fixture
def card_auth_headers(client):
    uid = ''.join(str(random.randint(0, 9)) for _ in range(7))
    r = client.post('/api/auth/register', json={
        'full_name': 'Користувач Картки',
        'phone': f'+38095{uid}',
        'email': f'cards-{uid}@test.ua',
        'password': 'qwerty',
    }, headers={'Content-Type': 'application/json'})
    data = r.get_json()
    assert data.get('ok'), data.get('error', 'register failed')
    token = data['data']['token']
    return {'Authorization': f'Bearer {token}'}


def _issue_card(client, headers, design='gold'):
    r = client.post('/api/cards', json={'card_type': 'virtual', 'design': design}, headers=headers)
    assert r.status_code in (200, 201)
    payload = r.get_json()
    assert payload['ok'] is True
    return payload['data']


def test_update_card_design_success(client, card_auth_headers):
    card = _issue_card(client, card_auth_headers, design='gold')
    card_id = card['id']

    update = client.patch(f'/api/cards/{card_id}/design', json={'design': 'rose'}, headers=card_auth_headers)
    assert update.status_code == 200
    data = update.get_json()
    assert data['ok'] is True
    assert data['data']['design'] == 'rose'
    assert data['data']['id'] == card_id

    listed = client.get('/api/cards', headers=card_auth_headers).get_json()['data']
    target = next(c for c in listed if c['id'] == card_id)
    assert target['design'] == 'rose'


def test_update_card_design_rejects_invalid_design(client, card_auth_headers):
    card = _issue_card(client, card_auth_headers, design='gold')
    card_id = card['id']

    update = client.patch(f'/api/cards/{card_id}/design', json={'design': 'ultra-neon'}, headers=card_auth_headers)
    assert update.status_code == 400
    data = update.get_json()
    assert data['ok'] is False
    assert 'Непідтримуваний дизайн' in data['error']


def test_update_card_design_rejects_closed_card(client, card_auth_headers):
    card = _issue_card(client, card_auth_headers, design='gold')
    card_id = card['id']

    close = client.patch(f'/api/cards/{card_id}/close', headers=card_auth_headers)
    assert close.status_code == 200
    assert close.get_json()['ok'] is True

    update = client.patch(f'/api/cards/{card_id}/design', json={'design': 'navy'}, headers=card_auth_headers)
    assert update.status_code == 400
    data = update.get_json()
    assert data['ok'] is False
    assert 'Закрита картка' in data['error']


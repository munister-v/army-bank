"""Публічний приймач заявок з сайту агенції: POST /api/leads/intake.

Маршрут відкритий, тож перевіряємо не лише щасливий шлях, а й те, що
він відхиляє порожні й безконтактні заявки, ковтає ботів на honeypot
і не робить двох карток з одного натискання.
"""
from __future__ import annotations


def _payload(**over):
    body = {
        'name': 'Dana Reyes',
        'company': 'Northlight Studio',
        'email': 'dana@northlight.example',
        'phone': '',
        'service': 'Web platform',
        'budget': '$5,000+',
        'message': 'We need a new storefront before the season starts.',
        'page': 'https://agency.munister.com.ua/',
        'lang': 'en',
    }
    body.update(over)
    return body


def _lead_rows(app):
    with app.app_context():
        from backend.database import get_connection
        with get_connection() as conn:
            return [dict(r) for r in conn.execute(
                "SELECT * FROM leads WHERE source_bucket = 'agency-site' ORDER BY id"
            ).fetchall()]


def test_intake_creates_lead(client, app):
    res = client.post('/api/leads/intake', json=_payload())
    assert res.status_code == 200, res.get_data(as_text=True)
    assert res.get_json()['ok'] is True

    rows = _lead_rows(app)
    assert len(rows) == 1
    lead = rows[0]
    assert lead['business_name'] == 'Northlight Studio'
    assert lead['email'] == 'dana@northlight.example'
    assert lead['pipeline'] == 'Inbound'
    assert lead['stage'] == 'New'
    assert lead['priority'] == 'Hot'
    assert 'storefront' in lead['notes']
    assert '$5,000+' in lead['notes']


def test_intake_needs_a_way_back(client):
    res = client.post('/api/leads/intake', json=_payload(email='', phone=''))
    assert res.status_code == 400
    assert res.get_json()['error'] == 'missing_contact'


def test_intake_rejects_a_broken_address(client):
    res = client.post('/api/leads/intake', json=_payload(email='dana@@example'))
    assert res.status_code == 400


def test_intake_requires_name_and_message(client):
    assert client.post('/api/leads/intake', json=_payload(name='')).status_code == 400
    assert client.post('/api/leads/intake', json=_payload(message='')).status_code == 400


def test_honeypot_is_accepted_and_dropped(client, app):
    before = len(_lead_rows(app))
    res = client.post('/api/leads/intake', json=_payload(website='http://spam.example'))
    assert res.status_code == 200
    assert len(_lead_rows(app)) == before


def test_double_submit_makes_one_card(client, app):
    body = _payload(company='Twice Ltd', message='Sent twice by a double click.')
    assert client.post('/api/leads/intake', json=body).status_code == 200
    second = client.post('/api/leads/intake', json=body)
    assert second.status_code == 200
    assert second.get_json()['data']['duplicate'] is True
    assert len([r for r in _lead_rows(app) if r['business_name'] == 'Twice Ltd']) == 1


def test_long_message_is_capped(client, app):
    client.post('/api/leads/intake', json=_payload(company='Longwind', message='x' * 9000))
    lead = [r for r in _lead_rows(app) if r['business_name'] == 'Longwind'][0]
    assert len(lead['notes']) <= 4200

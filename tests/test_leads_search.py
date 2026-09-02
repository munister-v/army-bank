"""Пошук лідів за телефоном/WhatsApp/email.

Раніше `search=` шукав лише по business_name/category/city_area/country —
вставлений номер клієнта нічого не знаходив, навіть якщо лід з таким
телефоном був у базі. Тепер пошук додатково порівнює цифри номера
(формат введення значення не має), а email шукається як текст."""
from __future__ import annotations

import random

from backend.repositories.user_repository import UserRepository


def _manager_client(client):
    # Тести в цьому файлі діляться однією sqlite-базою в межах прогону
    # (шлях виставляється раз при імпорті conftest), тож лишений від
    # попереднього тесту менеджер з тим самим телефоном/email зламає
    # реєстрацію — кожному тесту потрібен свій унікальний обліковий запис.
    uid = ''.join(str(random.randint(0, 9)) for _ in range(9))
    r = client.post('/api/auth/register', json={
        'full_name': 'CRM Manager', 'phone': f'+3809{uid}',
        'email': f'manager-{uid}@test.ua', 'password': 'qwerty',
    })
    data = r.get_json()['data']
    UserRepository().update_role(data['user']['id'], 'manager')
    return {'Authorization': f"Bearer {data['token']}"}


def _lead_rows(client, headers, **query):
    res = client.get('/api/leads', headers=headers, query_string=query)
    assert res.status_code == 200, res.get_data(as_text=True)
    return res.get_json()['data']['items']


def _submit_lead(client, **over):
    body = {
        'name': 'Dana Reyes', 'company': 'Northlight Studio',
        'email': '', 'phone': '', 'service': 'Web platform',
        'budget': '', 'message': 'Need a new site.',
        'page': 'https://agency.munister.com.ua/', 'lang': 'en',
    }
    body.update(over)
    res = client.post('/api/leads/intake', json=body)
    assert res.status_code == 200, res.get_data(as_text=True)


def test_search_finds_lead_by_exact_phone(client, app):
    _submit_lead(client, company='Sunrise Studio', phone='+1 (407) 777-9905', email='dana@sunrise.example')
    h = _manager_client(client)

    rows = _lead_rows(client, h, search='+1 (407) 777-9905')
    assert any(r['business_name'] == 'Sunrise Studio' for r in rows)


def test_search_finds_lead_by_phone_regardless_of_formatting(client, app):
    """Той самий номер, введений без пробілів/дужок/дефісів — має знайтись."""
    _submit_lead(client, company='Sunrise Studio', phone='+1 (407) 777-9905', email='dana@sunrise.example')
    h = _manager_client(client)

    rows = _lead_rows(client, h, search='4077779905')
    assert any(r['business_name'] == 'Sunrise Studio' for r in rows), \
        'номер без форматування має знайти лід, навіть якщо в базі він записаний з дужками/дефісами'


def test_search_by_phone_does_not_match_unrelated_leads(client, app):
    _submit_lead(client, company='Sunrise Studio', phone='+1 (407) 777-9905', email='dana@sunrise.example')
    _submit_lead(client, company='Harbor Goods', phone='+1 (626) 795-8553', email='sam@harbor.example')
    h = _manager_client(client)

    rows = _lead_rows(client, h, search='6267958553')
    names = {r['business_name'] for r in rows}
    assert names == {'Harbor Goods'}


def test_search_still_matches_business_name_and_email(client, app):
    _submit_lead(client, company='Northlight Studio', email='dana@northlight.example')
    h = _manager_client(client)

    assert any(r['business_name'] == 'Northlight Studio' for r in _lead_rows(client, h, search='Northlight'))
    assert any(r['business_name'] == 'Northlight Studio'
               for r in _lead_rows(client, h, search='dana@northlight.example'))

"""Тести feature маршрутів Army Bank (сімейні контакти, накопичення, донати, шаблони)."""
from __future__ import annotations

import random
import pytest
from backend.repositories.user_repository import UserRepository


def _rand_uid():
    return ''.join(str(random.randint(0, 9)) for _ in range(7))


def _register(client, uid=None):
    uid = uid or _rand_uid()
    r = client.post('/api/auth/register', json={
        'full_name': f'Feature User {uid}',
        'phone': f'+38097{uid}',
        'email': f'feat-{uid}@test.ua',
        'password': 'qwerty',
    })
    data = r.get_json()
    assert data.get('ok'), data.get('error', 'register failed')
    return data['data']['user']['id'], data['data']['token']


@pytest.fixture
def user_headers(client):
    uid = _rand_uid()
    user_id, token = _register(client, uid)
    return user_id, {'Authorization': f'Bearer {token}'}


@pytest.fixture
def admin_headers(client):
    uid = _rand_uid()
    user_id, token = _register(client, uid)
    UserRepository().update_role(user_id, 'admin')
    return user_id, {'Authorization': f'Bearer {token}'}


# ── Family Contacts ───────────────────────────────────────────────────────────
# Service fields: contact_name, relation_type, phone, account_number

def test_list_contacts_empty(client, user_headers):
    _, headers = user_headers
    r = client.get('/api/family-contacts', headers=headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    assert isinstance(data['data'], list)


def test_list_contacts_requires_auth(client):
    r = client.get('/api/family-contacts')
    assert r.status_code == 401


def test_add_contact_ok(client, user_headers):
    _, headers = user_headers
    r = client.post('/api/family-contacts', json={
        'contact_name': 'Марія Коваленко',
        'relation_type': 'Дружина',
        'phone': '+380501234567',
    }, headers=headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    # Returns updated list of contacts
    contacts = data['data']
    assert isinstance(contacts, list)
    assert len(contacts) >= 1
    assert any(c['contact_name'] == 'Марія Коваленко' for c in contacts)


def test_add_contact_requires_auth(client):
    r = client.post('/api/family-contacts', json={
        'contact_name': 'Тест', 'relation_type': 'Брат',
    })
    assert r.status_code == 401


def test_add_contact_missing_name(client, user_headers):
    _, headers = user_headers
    r = client.post('/api/family-contacts', json={'relation_type': 'Брат'}, headers=headers)
    assert r.status_code == 400


def test_add_contact_missing_relation(client, user_headers):
    _, headers = user_headers
    r = client.post('/api/family-contacts', json={'contact_name': 'Тест'}, headers=headers)
    assert r.status_code == 400


def test_list_contacts_shows_added(client, user_headers):
    _, headers = user_headers
    client.post('/api/family-contacts', json={
        'contact_name': 'Іван Петренко', 'relation_type': 'Батько', 'phone': '+380991234567',
    }, headers=headers)
    r = client.get('/api/family-contacts', headers=headers)
    assert r.status_code == 200
    contacts = r.get_json()['data']
    assert len(contacts) >= 1
    names = [c['contact_name'] for c in contacts]
    assert 'Іван Петренко' in names


def test_contacts_isolated_per_user(client):
    """Контакти одного користувача не видно іншому."""
    uid1 = _rand_uid()
    uid2 = _rand_uid()
    _, token1 = _register(client, uid1)
    _, token2 = _register(client, uid2)
    h1 = {'Authorization': f'Bearer {token1}'}
    h2 = {'Authorization': f'Bearer {token2}'}

    client.post('/api/family-contacts', json={
        'contact_name': 'Тільки Перший', 'relation_type': 'Сестра',
    }, headers=h1)
    r = client.get('/api/family-contacts', headers=h2)
    contacts = r.get_json()['data']
    assert all(c.get('contact_name') != 'Тільки Перший' for c in contacts)


# ── Savings Goals ─────────────────────────────────────────────────────────────
# Service fields: title, target_amount, deadline
# Returns: list of goals (not single goal)

def test_list_goals_empty(client, user_headers):
    _, headers = user_headers
    r = client.get('/api/savings-goals', headers=headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    assert isinstance(data['data'], list)


def test_list_goals_requires_auth(client):
    r = client.get('/api/savings-goals')
    assert r.status_code == 401


def test_create_goal_ok(client, user_headers):
    _, headers = user_headers
    r = client.post('/api/savings-goals', json={
        'title': 'На ноутбук',
        'target_amount': 30000,
    }, headers=headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    # Returns list of all goals
    goals = data['data']
    assert isinstance(goals, list)
    assert len(goals) >= 1
    goal = next((g for g in goals if g['title'] == 'На ноутбук'), None)
    assert goal is not None
    assert float(goal['target_amount']) == 30000.0


def test_create_goal_requires_auth(client):
    r = client.post('/api/savings-goals', json={'title': 'Тест', 'target_amount': 100})
    assert r.status_code == 401


def test_create_goal_missing_title(client, user_headers):
    _, headers = user_headers
    r = client.post('/api/savings-goals', json={'target_amount': 1000}, headers=headers)
    assert r.status_code == 400


def test_list_goals_shows_created(client, user_headers):
    _, headers = user_headers
    client.post('/api/savings-goals', json={'title': 'Авто', 'target_amount': 500000}, headers=headers)
    r = client.get('/api/savings-goals', headers=headers)
    goals = r.get_json()['data']
    assert any(g['title'] == 'Авто' for g in goals)


def test_contribute_goal_ok(client, user_headers, admin_headers):
    user_id, user_h = user_headers
    _, admin_h = admin_headers
    # Fund the user first
    client.post('/api/admin/payouts', json={
        'user_id': user_id, 'amount': 10000, 'title': 'Фонд', 'payout_type': 'combat',
    }, headers=admin_h)
    # Create goal and get its id from the list
    r_goal = client.post('/api/savings-goals', json={
        'title': 'На ремонт', 'target_amount': 5000,
    }, headers=user_h)
    goals = r_goal.get_json()['data']
    goal_id = next(g['id'] for g in goals if g['title'] == 'На ремонт')
    # Contribute
    r = client.post(f'/api/savings-goals/{goal_id}/contribute',
                    json={'amount': 1000}, headers=user_h)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    # Check updated goal amount
    goals_after = data['data']
    goal = next(g for g in goals_after if g['id'] == goal_id)
    assert float(goal['current_amount']) == 1000.0


def test_contribute_goal_insufficient_funds(client, user_headers):
    _, headers = user_headers
    r_goal = client.post('/api/savings-goals', json={
        'title': 'Велика мета', 'target_amount': 1000000,
    }, headers=headers)
    goals = r_goal.get_json()['data']
    goal_id = goals[-1]['id']
    r = client.post(f'/api/savings-goals/{goal_id}/contribute',
                    json={'amount': 999999}, headers=headers)
    # User has 0 balance — should fail
    assert r.status_code in (400, 422)


# ── Donations ─────────────────────────────────────────────────────────────────
# Service fields: fund_name, comment, amount
# Returns: list of donations

def test_list_donations_empty(client, user_headers):
    _, headers = user_headers
    r = client.get('/api/donations', headers=headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    assert isinstance(data['data'], list)


def test_list_donations_requires_auth(client):
    r = client.get('/api/donations')
    assert r.status_code == 401


def test_create_donation_ok(client, user_headers, admin_headers):
    user_id, user_h = user_headers
    _, admin_h = admin_headers
    # Fund
    client.post('/api/admin/payouts', json={
        'user_id': user_id, 'amount': 5000, 'title': 'Фонд', 'payout_type': 'combat',
    }, headers=admin_h)
    r = client.post('/api/donations', json={
        'fund_name': 'Фонд Повернись Живим',
        'amount': 500,
        'comment': 'Допомога ЗСУ',
    }, headers=user_h)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    donations = data['data']
    assert isinstance(donations, list)
    assert len(donations) >= 1
    assert float(donations[-1]['amount']) == 500.0


def test_create_donation_requires_auth(client):
    r = client.post('/api/donations', json={'fund_name': 'Тест', 'amount': 100})
    assert r.status_code == 401


def test_create_donation_insufficient_funds(client, user_headers):
    _, headers = user_headers
    r = client.post('/api/donations', json={
        'fund_name': 'Тест', 'amount': 999999,
    }, headers=headers)
    assert r.status_code in (400, 422)


def test_create_donation_missing_fund_name(client, user_headers):
    _, headers = user_headers
    r = client.post('/api/donations', json={'amount': 100}, headers=headers)
    assert r.status_code == 400


def test_list_donations_shows_created(client, user_headers, admin_headers):
    user_id, user_h = user_headers
    _, admin_h = admin_headers
    client.post('/api/admin/payouts', json={
        'user_id': user_id, 'amount': 2000, 'title': 'Фонд', 'payout_type': 'combat',
    }, headers=admin_h)
    client.post('/api/donations', json={'fund_name': 'Армія SOS', 'amount': 200}, headers=user_h)
    r = client.get('/api/donations', headers=user_h)
    donations = r.get_json()['data']
    assert len(donations) >= 1


# ── Payment Templates ─────────────────────────────────────────────────────────
# Service fields: name, recipient_account, amount, description
# Returns: list of templates

def test_list_templates_empty(client, user_headers):
    _, headers = user_headers
    r = client.get('/api/payment-templates', headers=headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    assert isinstance(data['data'], list)


def test_list_templates_requires_auth(client):
    r = client.get('/api/payment-templates')
    assert r.status_code == 401


def test_create_template_ok(client, user_headers):
    _, headers = user_headers
    r = client.post('/api/payment-templates', json={
        'name': 'Комуналка',
        'recipient_account': 'AB-100042',
        'amount': 1200,
        'description': 'Щомісячна оплата',
    }, headers=headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    templates = data['data']
    assert isinstance(templates, list)
    assert len(templates) >= 1
    tmpl = next((t for t in templates if t['name'] == 'Комуналка'), None)
    assert tmpl is not None
    assert float(tmpl['amount']) == 1200.0


def test_create_template_requires_auth(client):
    r = client.post('/api/payment-templates', json={'name': 'Тест', 'recipient_account': 'AB-1', 'amount': 100})
    assert r.status_code == 401


def test_create_template_missing_name(client, user_headers):
    _, headers = user_headers
    r = client.post('/api/payment-templates', json={
        'recipient_account': 'AB-100042', 'amount': 100,
    }, headers=headers)
    assert r.status_code == 400


def test_create_template_missing_recipient(client, user_headers):
    _, headers = user_headers
    r = client.post('/api/payment-templates', json={'name': 'Тест', 'amount': 100}, headers=headers)
    assert r.status_code == 400


def test_get_template_ok(client, user_headers):
    _, headers = user_headers
    r_create = client.post('/api/payment-templates', json={
        'name': 'Інтернет', 'recipient_account': 'AB-100050', 'amount': 300,
    }, headers=headers)
    templates = r_create.get_json()['data']
    tmpl_id = next(t['id'] for t in templates if t['name'] == 'Інтернет')
    r = client.get(f'/api/payment-templates/{tmpl_id}', headers=headers)
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    assert data['data']['id'] == tmpl_id


def test_get_template_not_found(client, user_headers):
    _, headers = user_headers
    r = client.get('/api/payment-templates/999999', headers=headers)
    assert r.status_code == 404


def test_templates_isolated_per_user(client):
    """Шаблони одного користувача не видно іншому."""
    uid1 = _rand_uid()
    uid2 = _rand_uid()
    _, token1 = _register(client, uid1)
    _, token2 = _register(client, uid2)
    h1 = {'Authorization': f'Bearer {token1}'}
    h2 = {'Authorization': f'Bearer {token2}'}

    r = client.post('/api/payment-templates', json={
        'name': 'Секретний шаблон', 'recipient_account': 'AB-999', 'amount': 100,
    }, headers=h1)
    templates = r.get_json()['data']
    tmpl_id = next(t['id'] for t in templates if t['name'] == 'Секретний шаблон')

    # User 2 cannot access user 1's template
    r2 = client.get(f'/api/payment-templates/{tmpl_id}', headers=h2)
    assert r2.status_code == 404


def test_list_templates_shows_created(client, user_headers):
    _, headers = user_headers
    client.post('/api/payment-templates', json={
        'name': 'Газ', 'recipient_account': 'AB-100001', 'amount': 500,
    }, headers=headers)
    r = client.get('/api/payment-templates', headers=headers)
    templates = r.get_json()['data']
    assert any(t['name'] == 'Газ' for t in templates)

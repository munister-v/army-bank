"""Регресійні тести розмежування доступу (виявлено аудитом): публічна
реєстрація НЕ повинна робити користувача банківським адміном, а роль
'manager' дає доступ до CRM, але НЕ до банківської адмінки /api/admin/*."""
from __future__ import annotations

import random

import pytest

from backend.repositories.user_repository import UserRepository


def _rand_uid():
    return ''.join(str(random.randint(0, 9)) for _ in range(7))


def _register(client, uid=None):
    uid = uid or _rand_uid()
    r = client.post('/api/auth/register', json={
        'full_name': f'Тест {uid}', 'phone': f'+38093{uid}',
        'email': f'user-{uid}@test.ua', 'password': 'qwerty',
    })
    data = r.get_json()
    assert data.get('ok'), data.get('error', 'register failed')
    return data['data']['user']['id'], data['data']['token']


def test_public_registration_creates_plain_soldier_not_admin(client):
    """Головний фікс аудиту: реєстрант — звичайний клієнт банку, а не адмін.
    Раніше create_user() дефолтив role='admin' → будь-хто ставав адміном."""
    uid, token = _register(client)
    me = client.get('/api/auth/me', headers={'Authorization': f'Bearer {token}'}).get_json()
    assert me['data']['role'] == 'soldier'


def test_soldier_cannot_reach_banking_admin(client):
    _, token = _register(client)
    h = {'Authorization': f'Bearer {token}'}
    # Найнебезпечніші ручки: список усіх користувачів, чужі транзакції, зміна ролей.
    assert client.get('/api/admin/users', headers=h).status_code == 403
    assert client.get('/api/admin/stats', headers=h).status_code == 403
    assert client.patch('/api/admin/users/1/role', headers=h, json={'role': 'admin'}).status_code == 403


def test_soldier_cannot_reach_crm(client):
    _, token = _register(client)
    h = {'Authorization': f'Bearer {token}'}
    assert client.get('/api/leads', headers=h).status_code == 403
    assert client.get('/api/prospecting/categories', headers=h).status_code == 403
    assert client.get('/api/integrations', headers=h).status_code == 403


def test_manager_gets_crm_but_not_banking_admin(client):
    """'manager' — CRM-роль: бачить ліди/пошук/інтеграції, але банківська
    адмінка (/api/admin/*) лишається закритою."""
    user_id, token = _register(client)
    UserRepository().update_role(user_id, 'manager')
    h = {'Authorization': f'Bearer {token}'}

    # CRM — доступно
    assert client.get('/api/leads', headers=h).status_code == 200
    assert client.get('/api/prospecting/categories', headers=h).status_code == 200
    assert client.get('/api/integrations', headers=h).status_code == 200

    # Банківська адмінка — заборонено
    assert client.get('/api/admin/users', headers=h).status_code == 403
    assert client.patch('/api/admin/users/1/role', headers=h, json={'role': 'admin'}).status_code == 403


def test_admin_can_promote_user_to_manager(client):
    """Легітимний шлях видачі CRM-доступу: адмін підвищує до 'manager'."""
    admin_uid, admin_token = _register(client)
    UserRepository().update_role(admin_uid, 'admin')
    target_uid, _ = _register(client)

    r = client.patch(
        f'/api/admin/users/{target_uid}/role',
        headers={'Authorization': f'Bearer {admin_token}'},
        json={'role': 'manager'},
    )
    assert r.status_code == 200
    assert r.get_json()['data']['role'] == 'manager'

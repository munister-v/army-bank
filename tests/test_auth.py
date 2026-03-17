"""Тести автентифікації та реєстрації."""
from __future__ import annotations

import pytest


def test_register_and_login(client):
    """Реєстрація створює користувача та повертає токен."""
    r = client.post('/api/auth/register', json={
        'full_name': 'Тест Користувач',
        'phone': '+380991234567',
        'email': 'test@example.com',
        'password': 'secret123',
    }, headers={'Content-Type': 'application/json'})
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    assert 'data' in data
    assert 'token' in data['data']
    assert data['data']['user']['email'] == 'test@example.com'
    assert data['data']['user']['role'] == 'soldier'


def test_login_invalid_credentials(client):
    """Невірні облікові дані повертають помилку."""
    r = client.post('/api/auth/login', json={
        'identity': 'nobody@example.com',
        'password': 'wrong',
    }, headers={'Content-Type': 'application/json'})
    data = r.get_json()
    assert data.get('ok') is False
    assert data.get('error')


def test_me_requires_auth(client):
    """GET /api/auth/me без токена повертає 401."""
    r = client.get('/api/auth/me')
    assert r.status_code == 401
    data = r.get_json()
    assert data.get('ok') is False
    assert data.get('error')


def test_me_with_token(client):
    """Після реєстрації /me повертає профіль."""
    reg = client.post('/api/auth/register', json={
        'full_name': 'Іван Петренко',
        'phone': '+380971112233',
        'email': 'ivan@test.ua',
        'password': 'pass123',
    }, headers={'Content-Type': 'application/json'})
    token = reg.get_json()['data']['token']
    r = client.get('/api/auth/me', headers={'Authorization': f'Bearer {token}'})
    assert r.status_code == 200
    data = r.get_json()
    assert data['ok'] is True
    assert data['data']['full_name'] == 'Іван Петренко'
    assert data['data']['role'] == 'soldier'

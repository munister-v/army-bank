"""Тести автентифікації та реєстрації."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.database import get_connection


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


def test_register_short_password(client):
    """Реєстрація з паролем коротшим за 6 символів повертає помилку."""
    r = client.post('/api/auth/register', json={
        'full_name': 'Тест',
        'phone': '+380991234567',
        'email': 'short@example.com',
        'password': '12345',
    }, headers={'Content-Type': 'application/json'})
    assert r.status_code == 400
    data = r.get_json()
    assert data.get('ok') is False
    assert '6 символів' in data.get('error', '')


def test_login_invalid_credentials(client):
    """Невірні облікові дані повертають помилку."""
    r = client.post('/api/auth/login', json={
        'identity': 'nobody@example.com',
        'password': 'wrong',
    }, headers={'Content-Type': 'application/json'})
    data = r.get_json()
    assert data.get('ok') is False
    assert data.get('error')


def test_login_email_case_insensitive(client):
    """Вхід по email має працювати незалежно від регістру."""
    client.post('/api/auth/register', json={
        'full_name': 'Case User',
        'phone': '+380991111111',
        'email': 'Case@Test.UA',
        'password': 'secret123',
    }, headers={'Content-Type': 'application/json'})

    r = client.post('/api/auth/login', json={
        'identity': 'CASE@test.ua',
        'password': 'secret123',
    }, headers={'Content-Type': 'application/json'})

    assert r.status_code == 200
    data = r.get_json()
    assert data.get('ok') is True
    assert data['data']['user']['email'] == 'case@test.ua'


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


def test_refresh_does_not_invalidate_current_token(client):
    """Після soft-refresh той самий токен лишається валідним."""
    reg = client.post('/api/auth/register', json={
        'full_name': 'Refresh User',
        'phone': '+380971234321',
        'email': 'refresh@test.ua',
        'password': 'pass123',
    }, headers={'Content-Type': 'application/json'})
    token = reg.get_json()['data']['token']

    # Форсуємо майже прострочену сесію, щоб спрацював refresh_session.
    near_expiry = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    with get_connection() as conn:
        conn.execute('UPDATE sessions SET expires_at = %s WHERE token = %s', (near_expiry, token))

    h = {'Authorization': f'Bearer {token}'}
    r1 = client.get('/api/auth/me', headers=h)
    r2 = client.get('/api/auth/me', headers=h)

    assert r1.status_code == 200
    assert r2.status_code == 200


def test_security_headers_and_cors(client):
    r = client.get('/health', headers={'Origin': 'https://munister.com.ua'})
    assert r.status_code == 200
    assert r.headers.get('X-Content-Type-Options') == 'nosniff'
    assert r.headers.get('X-Frame-Options') == 'DENY'
    assert r.headers.get('Referrer-Policy') == 'strict-origin-when-cross-origin'
    assert r.headers.get('Access-Control-Allow-Origin') == 'https://munister.com.ua'
    assert 'Origin' in (r.headers.get('Vary') or '')

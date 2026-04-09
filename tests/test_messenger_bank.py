"""Тести банківської інтеграції в месенджері."""
from __future__ import annotations

from backend.database import get_connection


def _register(client, uid: str = '7001') -> tuple[int, str, str]:
    phone = f'+38099{int(uid) % 10_000_000:07d}'
    email = f'messenger-bank-{uid}@test.ua'
    r = client.post('/api/auth/register', json={
        'full_name': f'Messenger Bank {uid}',
        'phone': phone,
        'email': email,
        'password': 'secret123',
    }, headers={'Content-Type': 'application/json'})
    assert r.status_code == 200
    data = r.get_json()['data']
    return int(data['user']['id']), data['token'], phone


def test_login_auto_links_bank_account_when_missing(client):
    user_id, _token, phone = _register(client, '7002')

    with get_connection() as conn:
        conn.execute('DELETE FROM accounts WHERE user_id = %s', (user_id,))

    login = client.post('/api/auth/login', json={
        'identity': phone,
        'password': 'secret123',
    }, headers={'Content-Type': 'application/json'})
    assert login.status_code == 200
    data = login.get_json()['data']
    assert data['user']['bank_account_linked'] is True
    assert data['user']['bank_account_number'].startswith('AB-')
    assert data['bank_notice']

    with get_connection() as conn:
        account = conn.execute('SELECT account_number FROM accounts WHERE user_id = %s', (user_id,)).fetchone()
    assert account is not None


def test_messenger_bank_endpoints_and_statement_order(client):
    _user_id, token, _phone = _register(client, '7003')
    h = {'Authorization': f'Bearer {token}'}

    status = client.get('/api/messenger/bank/status', headers=h)
    assert status.status_code == 200
    status_data = status.get_json()['data']
    assert status_data['linked'] is True
    assert status_data['account_number'].startswith('AB-')

    summary = client.get('/api/messenger/bank/summary', headers=h)
    assert summary.status_code == 200
    summary_data = summary.get_json()['data']
    assert summary_data['account']['account_number'].startswith('AB-')
    assert 'Рахунок:' in summary_data['share_text']

    pdf_order = client.post('/api/messenger/bank/statement/order', headers=h, json={
        'format': 'pdf',
        'report_type': 'detailed',
        'from_date': '2026-01-01',
        'to_date': '2026-01-31',
    })
    assert pdf_order.status_code == 200
    pdf_data = pdf_order.get_json()['data']
    assert pdf_data['format'] == 'pdf'
    assert '/api/transactions/statement?' in pdf_data['download_path']

    csv_order = client.post('/api/messenger/bank/statement/order', headers=h, json={
        'format': 'csv',
        'from_date': '2026-01-01',
        'to_date': '2026-01-31',
    })
    assert csv_order.status_code == 200
    csv_data = csv_order.get_json()['data']
    assert csv_data['format'] == 'csv'
    assert '/api/transactions/export?' in csv_data['download_path']


def test_messenger_conversations_auto_link_bank_for_old_session(client):
    user_id, token, _phone = _register(client, '7004')
    h = {'Authorization': f'Bearer {token}'}

    with get_connection() as conn:
        conn.execute('DELETE FROM accounts WHERE user_id = %s', (user_id,))

    convs = client.get('/api/messenger/conversations', headers=h)
    assert convs.status_code == 200
    assert convs.get_json()['ok'] is True

    with get_connection() as conn:
        account = conn.execute('SELECT id FROM accounts WHERE user_id = %s', (user_id,)).fetchone()
    assert account is not None

"""Тести стабільності call signaling у месенджері."""
from __future__ import annotations

from backend.database import get_connection


def _register(client, uid: str) -> tuple[int, str]:
    phone = f'+38067{int(uid) % 10_000_000:07d}'
    email = f'calls-{uid}@test.ua'
    r = client.post('/api/auth/register', json={
        'full_name': f'Call User {uid}',
        'phone': phone,
        'email': email,
        'password': 'secret123',
    }, headers={'Content-Type': 'application/json'})
    assert r.status_code == 200
    data = r.get_json()['data']
    return int(data['user']['id']), data['token']


def _auth(token: str) -> dict:
    return {'Authorization': f'Bearer {token}'}


def _open_conv(client, token: str, partner_id: int) -> int:
    r = client.post('/api/messenger/conversations', headers=_auth(token), json={'user_id': partner_id})
    assert r.status_code == 200
    return int(r.get_json()['data']['id'])


def _offer() -> str:
    return (
        'v=0\r\n'
        'o=- 1 1 IN IP4 127.0.0.1\r\n'
        's=-\r\n'
        't=0 0\r\n'
        'm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'
        'c=IN IP4 0.0.0.0\r\n'
        'a=rtpmap:111 opus/48000/2\r\n'
    )


def _answer() -> str:
    return (
        'v=0\r\n'
        'o=- 2 2 IN IP4 127.0.0.1\r\n'
        's=-\r\n'
        't=0 0\r\n'
        'm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'
        'c=IN IP4 0.0.0.0\r\n'
        'a=rtpmap:111 opus/48000/2\r\n'
    )


def test_retry_pending_call_from_same_caller_is_allowed(client):
    uid_a, token_a = _register(client, '9101')
    uid_b, token_b = _register(client, '9102')
    assert uid_a != uid_b
    conv_id = _open_conv(client, token_a, uid_b)
    _open_conv(client, token_b, uid_a)

    first = client.post('/api/messenger/calls', headers=_auth(token_a), json={
        'conversation_id': conv_id,
        'sdp_offer': _offer(),
    })
    assert first.status_code == 200
    first_id = int(first.get_json()['data']['call_id'])

    second = client.post('/api/messenger/calls', headers=_auth(token_a), json={
        'conversation_id': conv_id,
        'sdp_offer': _offer(),
    })
    assert second.status_code == 200
    second_id = int(second.get_json()['data']['call_id'])
    assert second_id != first_id

    with get_connection() as conn:
        old_row = conn.execute('SELECT status FROM calls WHERE id = %s', (first_id,)).fetchone()
        new_row = conn.execute('SELECT status FROM calls WHERE id = %s', (second_id,)).fetchone()
    assert old_row and old_row['status'] == 'missed'
    assert new_row and new_row['status'] == 'pending'


def test_pending_call_from_other_user_returns_pending_conflict_label(client):
    uid_a, token_a = _register(client, '9103')
    uid_b, token_b = _register(client, '9104')
    conv_id = _open_conv(client, token_a, uid_b)
    _open_conv(client, token_b, uid_a)

    first = client.post('/api/messenger/calls', headers=_auth(token_a), json={
        'conversation_id': conv_id,
        'sdp_offer': _offer(),
    })
    assert first.status_code == 200

    second = client.post('/api/messenger/calls', headers=_auth(token_b), json={
        'conversation_id': conv_id,
        'sdp_offer': _offer(),
    })
    assert second.status_code == 409
    payload = second.get_json() or {}
    msg = str(payload.get('error') or payload.get('message') or '')
    assert 'очікування відповіді' in msg


def test_offer_restart_and_active_answer_update_are_supported(client):
    uid_a, token_a = _register(client, '9105')
    uid_b, token_b = _register(client, '9106')
    conv_id = _open_conv(client, token_a, uid_b)
    _open_conv(client, token_b, uid_a)

    start = client.post('/api/messenger/calls', headers=_auth(token_a), json={
        'conversation_id': conv_id,
        'sdp_offer': _offer(),
    })
    assert start.status_code == 200
    call_id = int(start.get_json()['data']['call_id'])

    first_answer = client.put(f'/api/messenger/calls/{call_id}/answer', headers=_auth(token_b), json={
        'sdp_answer': _answer(),
    })
    assert first_answer.status_code == 200

    restart_offer = client.put(f'/api/messenger/calls/{call_id}/offer', headers=_auth(token_a), json={
        'sdp_offer': _offer().replace('o=- 1 1', 'o=- 3 3'),
    })
    assert restart_offer.status_code == 200

    restart_answer = client.put(f'/api/messenger/calls/{call_id}/answer', headers=_auth(token_b), json={
        'sdp_answer': _answer().replace('o=- 2 2', 'o=- 4 4'),
    })
    assert restart_answer.status_code == 200

    with get_connection() as conn:
        row = conn.execute('SELECT status, sdp_offer, sdp_answer FROM calls WHERE id = %s', (call_id,)).fetchone()
    assert row and row['status'] == 'active'
    assert 'o=- 3 3' in str(row.get('sdp_offer') or '')
    assert 'o=- 4 4' in str(row.get('sdp_answer') or '')


def test_only_caller_can_update_offer(client):
    uid_a, token_a = _register(client, '9107')
    uid_b, token_b = _register(client, '9108')
    conv_id = _open_conv(client, token_a, uid_b)
    _open_conv(client, token_b, uid_a)

    start = client.post('/api/messenger/calls', headers=_auth(token_a), json={
        'conversation_id': conv_id,
        'sdp_offer': _offer(),
    })
    assert start.status_code == 200
    call_id = int(start.get_json()['data']['call_id'])

    forbidden = client.put(f'/api/messenger/calls/{call_id}/offer', headers=_auth(token_b), json={
        'sdp_offer': _offer().replace('o=- 1 1', 'o=- 9 9'),
    })
    assert forbidden.status_code == 403

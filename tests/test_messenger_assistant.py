"""Тести дефолтного чату Army Bank Assistant."""
from __future__ import annotations

import pytest

from backend.routes.messenger_routes import _ASSISTANT_FEATURE_ENABLED

# Асистент навмисно вимкнено прапорцем _ASSISTANT_FEATURE_ENABLED; ці тести
# описують УВІМКНЕНУ поведінку, тож пропускаємо їх, поки фіча off (інакше
# вони червоніють без причини й ховають реальні регресії в шумі).
pytestmark = pytest.mark.skipif(
    not _ASSISTANT_FEATURE_ENABLED,
    reason='Army Bank Assistant вимкнено (_ASSISTANT_FEATURE_ENABLED = False)',
)


def _register(client, uid: str = '8101') -> tuple[int, str]:
    phone = f'+38098{int(uid) % 10_000_000:07d}'
    email = f'assistant-{uid}@test.ua'
    r = client.post('/api/auth/register', json={
        'full_name': f'Assistant User {uid}',
        'phone': phone,
        'email': email,
        'password': 'secret123',
    }, headers={'Content-Type': 'application/json'})
    assert r.status_code == 200
    data = r.get_json()['data']
    return int(data['user']['id']), data['token']


def _auth(token: str) -> dict:
    return {'Authorization': f'Bearer {token}'}


def test_default_assistant_conversation_exists(client):
    _uid, token = _register(client, '8102')
    r = client.get('/api/messenger/conversations', headers=_auth(token))
    assert r.status_code == 200
    data = r.get_json()['data']
    assistant_convs = [c for c in data if (c.get('partner') or {}).get('role') == 'assistant_bot']
    assert assistant_convs, 'Expected default assistant conversation in list'

    conv = assistant_convs[0]
    assert conv['partner']['full_name'] == 'Army Bank Assistant'
    assert conv.get('last_message_text')


def test_assistant_replies_to_banking_question(client):
    _uid, token = _register(client, '8103')
    h = _auth(token)
    convs = client.get('/api/messenger/conversations', headers=h).get_json()['data']
    assistant_conv = next(c for c in convs if (c.get('partner') or {}).get('role') == 'assistant_bot')
    conv_id = int(assistant_conv['id'])

    send = client.post(f'/api/messenger/conversations/{conv_id}/messages', headers=h, json={
        'text': 'Покажи, будь ласка, баланс рахунку',
    })
    assert send.status_code == 200
    sent_msg = send.get_json()['data']
    assert sent_msg['sender_id'] != (assistant_conv['partner'] or {}).get('id')

    poll = client.get(f'/api/messenger/conversations/{conv_id}/poll?after_id={sent_msg["id"]}', headers=h)
    assert poll.status_code == 200
    replies = poll.get_json()['data']
    assert replies, 'Expected assistant reply message'
    last_reply = replies[-1]
    assert last_reply['sender_name'] == 'Army Bank Assistant'
    assert ('Баланс' in last_reply['text']) or ('рахунок' in last_reply['text'].lower())


def test_assistant_capabilities_and_menu_command(client):
    _uid, token = _register(client, '8104')
    h = _auth(token)

    caps = client.get('/api/messenger/assistant/capabilities', headers=h)
    assert caps.status_code == 200
    caps_data = caps.get_json()['data']
    assert caps_data['assistant']['verified'] is True
    assert len(caps_data['actions']) >= 10
    assert any(a.get('command') == '/аналітика' for a in caps_data['actions'])

    convs = client.get('/api/messenger/conversations', headers=h).get_json()['data']
    assistant_conv = next(c for c in convs if (c.get('partner') or {}).get('role') == 'assistant_bot')
    conv_id = int(assistant_conv['id'])

    send = client.post(f'/api/messenger/conversations/{conv_id}/messages', headers=h, json={
        'text': '/меню',
    })
    assert send.status_code == 200
    sent_msg = send.get_json()['data']

    poll = client.get(f'/api/messenger/conversations/{conv_id}/poll?after_id={sent_msg["id"]}', headers=h)
    assert poll.status_code == 200
    replies = poll.get_json()['data']
    assert replies, 'Expected assistant menu response'
    reply_text = replies[-1]['text']
    assert '/баланс' in reply_text
    assert '/аналітика' in reply_text

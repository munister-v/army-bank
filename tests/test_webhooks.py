"""Тести публічного вебхука Meta (/api/webhooks/meta) — найризикованіша частина
інтеграцій, бо він взагалі без @auth_required (Meta не має Bearer-токена ARM
CRM). Перевіряємо саме те, що захищає його від підробки: підпис
X-Hub-Signature-256 та дедуп по message id.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import random

import pytest

from backend.repositories.user_repository import UserRepository
import backend.routes.integrations_routes as integrations_routes


def _rand_uid():
    return ''.join(str(random.randint(0, 9)) for _ in range(7))


def _register(client, uid=None):
    uid = uid or _rand_uid()
    r = client.post('/api/auth/register', json={
        'full_name': f'Тест {uid}',
        'phone': f'+38093{uid}',
        'email': f'user-{uid}@test.ua',
        'password': 'qwerty',
    })
    data = r.get_json()
    assert data.get('ok'), data.get('error', 'register failed')
    return data['data']['user']['id'], data['data']['token']


@pytest.fixture
def admin_headers(client):
    uid = _rand_uid()
    user_id, token = _register(client, uid)
    UserRepository().update_role(user_id, 'admin')
    return {'Authorization': f'Bearer {token}'}


def _connect_whatsapp(client, admin_headers, monkeypatch, *, phone_number_id, manager='Manager 1', app_secret=''):
    monkeypatch.setattr(
        integrations_routes, 'verify_whatsapp_number',
        lambda pid, tok: {'display_phone_number': '+1', 'verified_name': 'Test Shop'},
    )
    body = {'manager': manager, 'phone_number_id': phone_number_id, 'access_token': 'tok-123'}
    if app_secret:
        body['app_secret'] = app_secret
    r = client.post('/api/integrations/whatsapp', headers=admin_headers, json=body)
    assert r.status_code == 200, r.get_json()


def _wa_payload(phone_number_id: str, wa_id: str, msg_id: str, text: str, name: str = 'Клієнт Тест') -> dict:
    return {
        'object': 'whatsapp_business_account',
        'entry': [{
            'id': 'WABA_ID',
            'changes': [{
                'value': {
                    'messaging_product': 'whatsapp',
                    'metadata': {'display_phone_number': '+1', 'phone_number_id': phone_number_id},
                    'contacts': [{'profile': {'name': name}, 'wa_id': wa_id}],
                    'messages': [{'from': wa_id, 'id': msg_id, 'timestamp': '1', 'type': 'text', 'text': {'body': text}}],
                },
                'field': 'messages',
            }],
        }],
    }


def _signed(body: dict, secret: str) -> tuple[bytes, str]:
    raw = json.dumps(body).encode('utf-8')
    sig = 'sha256=' + hmac.new(secret.encode('utf-8'), raw, hashlib.sha256).hexdigest()
    return raw, sig


def _lead_exists(client, admin_headers, *, whatsapp_viber):
    r = client.get('/api/leads?per_page=200', headers=admin_headers)
    items = r.get_json()['data']['items']
    return next((i for i in items if i['whatsapp_viber'] == whatsapp_viber), None)


# ── GET handshake ────────────────────────────────────────────────────────────

def test_handshake_rejects_wrong_token(client):
    r = client.get('/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=x')
    assert r.status_code == 403


def test_handshake_accepts_correct_token(client):
    token = integrations_routes.webhook_verify_token()
    r = client.get(f'/api/webhooks/meta?hub.mode=subscribe&hub.verify_token={token}&hub.challenge=hello42')
    assert r.status_code == 200
    assert r.get_data(as_text=True) == 'hello42'


# ── POST — no app_secret configured (signature check optional) ─────────────

def test_inbound_creates_lead_when_no_app_secret_configured(client, admin_headers, monkeypatch):
    _connect_whatsapp(client, admin_headers, monkeypatch, phone_number_id='7000001')
    payload = _wa_payload('7000001', '380990001111', 'wamid.A1', 'Цікавить тариф')

    r = client.post('/api/webhooks/meta', json=payload)
    assert r.status_code == 200

    lead = _lead_exists(client, admin_headers, whatsapp_viber='380990001111')
    assert lead is not None
    assert lead['owner'] == 'Manager 1'
    assert lead['primary_channel'] == 'WhatsApp'
    assert lead['outreach_status'] == 'Replied'


# ── POST — app_secret configured: signature is enforced ─────────────────────

def test_inbound_rejected_without_signature_when_app_secret_configured(client, admin_headers, monkeypatch):
    _connect_whatsapp(client, admin_headers, monkeypatch, phone_number_id='7000002',
                       manager='Manager 2', app_secret='top-secret')
    payload = _wa_payload('7000002', '380990002222', 'wamid.B1', 'Привіт')

    r = client.post('/api/webhooks/meta', json=payload)  # no X-Hub-Signature-256 header
    assert r.status_code == 200  # Meta still gets a 200 (avoid retry storms)...
    assert _lead_exists(client, admin_headers, whatsapp_viber='380990002222') is None  # ...but nothing is ingested


def test_inbound_rejected_with_wrong_signature(client, admin_headers, monkeypatch):
    _connect_whatsapp(client, admin_headers, monkeypatch, phone_number_id='7000003',
                       manager='Manager 2', app_secret='top-secret')
    payload = _wa_payload('7000003', '380990003333', 'wamid.C1', 'Привіт')
    raw, _ = _signed(payload, 'top-secret')
    wrong_sig = 'sha256=' + ('0' * 64)

    r = client.post('/api/webhooks/meta', data=raw, content_type='application/json',
                     headers={'X-Hub-Signature-256': wrong_sig})
    assert r.status_code == 200
    assert _lead_exists(client, admin_headers, whatsapp_viber='380990003333') is None


def test_inbound_accepted_with_correct_signature(client, admin_headers, monkeypatch):
    _connect_whatsapp(client, admin_headers, monkeypatch, phone_number_id='7000004',
                       manager='Manager 2', app_secret='top-secret')
    payload = _wa_payload('7000004', '380990004444', 'wamid.D1', 'Скільки коштує?')
    raw, sig = _signed(payload, 'top-secret')

    r = client.post('/api/webhooks/meta', data=raw, content_type='application/json',
                     headers={'X-Hub-Signature-256': sig})
    assert r.status_code == 200
    lead = _lead_exists(client, admin_headers, whatsapp_viber='380990004444')
    assert lead is not None
    assert lead['owner'] == 'Manager 2'


# ── Dedup ────────────────────────────────────────────────────────────────────

def test_duplicate_delivery_is_not_reprocessed(client, admin_headers, monkeypatch):
    _connect_whatsapp(client, admin_headers, monkeypatch, phone_number_id='7000005')
    payload = _wa_payload('7000005', '380990005555', 'wamid.E1', 'Перший раз')

    r1 = client.post('/api/webhooks/meta', json=payload)
    assert r1.status_code == 200
    lead = _lead_exists(client, admin_headers, whatsapp_viber='380990005555')
    assert lead is not None

    # Meta retries the exact same delivery (e.g. we were slow to ack).
    r2 = client.post('/api/webhooks/meta', json=payload)
    assert r2.status_code == 200

    thread = client.get(f"/api/leads/{lead['id']}/conversation", headers=admin_headers).get_json()['data']
    conv_id = thread['conversation_id']
    messages = client.get(f'/api/messenger/conversations/{conv_id}/messages', headers=admin_headers).get_json()['data']
    inbound_texts = [m['text'] for m in messages if 'Перший раз' in (m.get('text') or '')]
    assert len(inbound_texts) == 1


# ── Unknown phone_number_id is ignored, not an error ─────────────────────────

def test_inbound_for_unknown_phone_number_id_is_ignored(client):
    payload = _wa_payload('9999999999', '380990009999', 'wamid.Z1', 'Хто це?')
    r = client.post('/api/webhooks/meta', json=payload)
    assert r.status_code == 200

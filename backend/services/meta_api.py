"""Тонкий клієнт до Meta Graph API для WhatsApp Cloud API та Instagram Messaging.

Кожен менеджер підключає СВІЙ WhatsApp Business (Phone Number ID + Access Token)
або Instagram Business (IG User ID + Access Token) через ARM CRM → «Інтеграції».
Ці функції виконують реальні виклики до graph.facebook.com — і на підключенні
(верифікація токена), і на відправці/прийомі повідомлень.
"""
from __future__ import annotations

import requests

GRAPH_API_VERSION = 'v20.0'
GRAPH_BASE = f'https://graph.facebook.com/{GRAPH_API_VERSION}'
_TIMEOUT = 12


class MetaApiError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.message = message
        self.status = status


def _graph_get(path: str, access_token: str, params: dict | None = None) -> dict:
    query = dict(params or {})
    query['access_token'] = access_token
    try:
        resp = requests.get(f'{GRAPH_BASE}/{path}', params=query, timeout=_TIMEOUT)
    except requests.RequestException as exc:
        raise MetaApiError(f"Не вдалося звʼязатися з Meta Graph API: {exc}") from exc
    return _unwrap(resp)


def _graph_post(path: str, access_token: str, payload: dict) -> dict:
    try:
        resp = requests.post(
            f'{GRAPH_BASE}/{path}',
            params={'access_token': access_token},
            json=payload,
            timeout=_TIMEOUT,
        )
    except requests.RequestException as exc:
        raise MetaApiError(f"Не вдалося звʼязатися з Meta Graph API: {exc}") from exc
    return _unwrap(resp)


def _unwrap(resp: requests.Response) -> dict:
    try:
        data = resp.json()
    except ValueError:
        data = {}
    if resp.status_code >= 400 or (isinstance(data, dict) and data.get('error')):
        err = (data or {}).get('error') or {}
        message = err.get('message') or f'Meta API помилка (HTTP {resp.status_code}).'
        raise MetaApiError(message, status=resp.status_code)
    return data


def verify_whatsapp_number(phone_number_id: str, access_token: str) -> dict:
    """Перевіряє Phone Number ID + токен реальним запитом до Graph API.

    Повертає {'display_phone_number', 'verified_name'} — саме те, що показуємо
    менеджеру в картці підключення як підтвердження, що дані робочі.
    """
    data = _graph_get(
        phone_number_id.strip(),
        access_token.strip(),
        params={'fields': 'display_phone_number,verified_name'},
    )
    return {
        'display_phone_number': data.get('display_phone_number') or '',
        'verified_name': data.get('verified_name') or '',
    }


def verify_instagram_account(ig_user_id: str, access_token: str) -> dict:
    """Перевіряє Instagram Business Account ID + токен реальним запитом."""
    data = _graph_get(
        ig_user_id.strip(),
        access_token.strip(),
        params={'fields': 'username,name'},
    )
    return {
        'username': data.get('username') or '',
        'name': data.get('name') or '',
    }


def send_whatsapp_text(phone_number_id: str, access_token: str, to: str, text: str) -> dict:
    """Надсилає текстове повідомлення через WhatsApp Cloud API."""
    payload = {
        'messaging_product': 'whatsapp',
        'to': to,
        'type': 'text',
        'text': {'body': text},
    }
    return _graph_post(f'{phone_number_id.strip()}/messages', access_token.strip(), payload)


def send_instagram_text(ig_user_id: str, access_token: str, recipient_id: str, text: str) -> dict:
    """Надсилає текстове повідомлення через Instagram Messaging API."""
    payload = {
        'recipient': {'id': recipient_id},
        'message': {'text': text},
    }
    return _graph_post(f'{ig_user_id.strip()}/messages', access_token.strip(), payload)

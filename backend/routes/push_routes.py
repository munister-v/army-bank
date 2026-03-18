"""Web Push notification routes."""
from __future__ import annotations

import base64
import json
import os

from flask import Blueprint, jsonify, request, g

from ..database import get_connection
from .helpers import api_error, auth_required

push_bp = Blueprint('push', __name__, url_prefix='/api/push')

# ── VAPID config ──────────────────────────────────────────────────────────────
# Store the private key as base64-encoded PEM in VAPID_PRIVATE_KEY env var
_VAPID_KEY_B64 = os.getenv('VAPID_PRIVATE_KEY', '')
_VAPID_PUBLIC  = os.getenv('VAPID_PUBLIC_KEY', 'BBkDBdD-nffWa34kkN60vFPKbsiUhz4htDfdAQUp7eVrlLIiaAveTB_qd5xGxGaUrTOXsSk50GmdYnmOARV9wJs')
_VAPID_CONTACT = os.getenv('VAPID_CONTACT', 'mailto:admin@army-bank.ua')


def _get_private_pem() -> str:
    if not _VAPID_KEY_B64:
        return ''
    try:
        return base64.b64decode(_VAPID_KEY_B64).decode()
    except Exception:
        return _VAPID_KEY_B64  # already plain PEM


def send_push(user_id: int, title: str, body: str, url: str = '/dashboard') -> None:
    """Send Web Push to all active subscriptions of a user. Never raises."""
    pem = _get_private_pem()
    if not pem:
        return
    try:
        from pywebpush import webpush, WebPushException
        with get_connection() as conn:
            subs = conn.execute(
                'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = %s',
                (user_id,)
            ).fetchall()
        for sub in subs:
            try:
                webpush(
                    subscription_info={
                        'endpoint': sub['endpoint'],
                        'keys': {'p256dh': sub['p256dh'], 'auth': sub['auth']},
                    },
                    data=json.dumps({'title': title, 'body': body, 'url': url}),
                    vapid_private_key=pem,
                    vapid_claims={'sub': _VAPID_CONTACT},
                    content_encoding='aes128gcm',
                )
            except WebPushException as exc:
                # Subscription gone — clean up
                if exc.response is not None and exc.response.status_code in (404, 410):
                    with get_connection() as conn:
                        conn.execute(
                            'DELETE FROM push_subscriptions WHERE endpoint = %s',
                            (sub['endpoint'],)
                        )
            except Exception:
                pass
    except Exception:
        pass  # never break the main flow


# ── Routes ────────────────────────────────────────────────────────────────────

@push_bp.get('/vapid-public-key')
def vapid_public_key():
    return jsonify({'ok': True, 'data': _VAPID_PUBLIC})


@push_bp.post('/subscribe')
@auth_required
def subscribe():
    data = request.get_json(force=True, silent=True) or {}
    endpoint = (data.get('endpoint') or '').strip()
    p256dh   = (data.get('p256dh')   or '').strip()
    auth     = (data.get('auth')     or '').strip()
    if not endpoint or not p256dh or not auth:
        return api_error('Неповні дані підписки.')
    try:
        uid = g.current_user['id']
        with get_connection() as conn:
            # Delete stale entry with same endpoint (could belong to other user)
            conn.execute('DELETE FROM push_subscriptions WHERE endpoint = %s', (endpoint,))
            conn.execute(
                'INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (%s, %s, %s, %s)',
                (uid, endpoint, p256dh, auth)
            )
        return jsonify({'ok': True})
    except Exception as exc:
        return api_error(str(exc))


@push_bp.delete('/unsubscribe')
@auth_required
def unsubscribe():
    data = request.get_json(force=True, silent=True) or {}
    endpoint = (data.get('endpoint') or '').strip()
    if endpoint:
        with get_connection() as conn:
            conn.execute(
                'DELETE FROM push_subscriptions WHERE endpoint = %s AND user_id = %s',
                (endpoint, g.current_user['id'])
            )
    return jsonify({'ok': True})

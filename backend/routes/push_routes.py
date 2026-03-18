"""Web Push notification routes."""
from __future__ import annotations

import base64
import json
import logging
import os

from flask import Blueprint, jsonify, request, g

from ..database import get_connection
from .helpers import api_error, auth_required

push_bp = Blueprint('push', __name__, url_prefix='/api/push')
logger = logging.getLogger(__name__)

_VAPID_CONTACT = os.getenv('VAPID_CONTACT', 'mailto:admin@army-bank.ua')


def _get_private_pem() -> str:
    """Read VAPID private key at call time (not at module load)."""
    raw = os.getenv('VAPID_PRIVATE_KEY', '')
    if not raw:
        return ''
    try:
        decoded = base64.b64decode(raw).decode()
        return decoded
    except Exception:
        return raw  # already plain PEM


def _get_public_key() -> str:
    return os.getenv(
        'VAPID_PUBLIC_KEY',
        'BBkDBdD-nffWa34kkN60vFPKbsiUhz4htDfdAQUp7eVrlLIiaAveTB_qd5xGxGaUrTOXsSk50GmdYnmOARV9wJs',
    )


def send_push(user_id: int, title: str, body: str, url: str = '/dashboard') -> None:
    """Send Web Push to all active subscriptions of a user. Never raises."""
    pem = _get_private_pem()
    if not pem:
        logger.warning('send_push: VAPID_PRIVATE_KEY not set, skipping push for user_id=%s', user_id)
        return
    try:
        from pywebpush import webpush, WebPushException
        with get_connection() as conn:
            subs = conn.execute(
                'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = %s',
                (user_id,)
            ).fetchall()
        if not subs:
            logger.info('send_push: no subscriptions for user_id=%s', user_id)
            return
        payload = json.dumps({'title': title, 'body': body, 'url': url})
        for sub in subs:
            try:
                webpush(
                    subscription_info={
                        'endpoint': sub['endpoint'],
                        'keys': {'p256dh': sub['p256dh'], 'auth': sub['auth']},
                    },
                    data=payload,
                    vapid_private_key=pem,
                    vapid_claims={'sub': _VAPID_CONTACT},
                    content_encoding='aes128gcm',
                    headers={'Content-Type': 'application/json'},
                )
                logger.info('send_push: delivered to user_id=%s endpoint=%.60s', user_id, sub['endpoint'])
            except WebPushException as exc:
                status = exc.response.status_code if exc.response is not None else None
                logger.warning('send_push: WebPushException user_id=%s status=%s err=%s', user_id, status, exc)
                if status in (404, 410):
                    with get_connection() as conn:
                        conn.execute(
                            'DELETE FROM push_subscriptions WHERE endpoint = %s',
                            (sub['endpoint'],)
                        )
            except Exception as exc:
                logger.exception('send_push: unexpected error user_id=%s: %s', user_id, exc)
    except Exception as exc:
        logger.exception('send_push: top-level error: %s', exc)


# ── Routes ────────────────────────────────────────────────────────────────────

@push_bp.get('/vapid-public-key')
def vapid_public_key():
    return jsonify({'ok': True, 'data': _get_public_key()})


@push_bp.get('/status')
@auth_required
def push_status():
    """Повертає стан push-підписок поточного користувача + чи налаштований VAPID."""
    uid = g.current_user['id']
    with get_connection() as conn:
        subs = conn.execute(
            'SELECT id, endpoint, created_at FROM push_subscriptions WHERE user_id = %s',
            (uid,)
        ).fetchall()
    return jsonify({'ok': True, 'data': {
        'vapid_configured': bool(_get_private_pem()),
        'subscriptions_count': len(subs),
        'subscriptions': [
            {'id': s['id'], 'endpoint': s['endpoint'][:60] + '...', 'created_at': s['created_at']}
            for s in subs
        ],
    }})


@push_bp.post('/test')
@auth_required
def test_push():
    """Надіслати тестовий пуш поточному користувачу (для діагностики)."""
    uid = g.current_user['id']
    pem = _get_private_pem()
    if not pem:
        return api_error('VAPID_PRIVATE_KEY не налаштований на сервері.')
    with get_connection() as conn:
        subs = conn.execute(
            'SELECT endpoint FROM push_subscriptions WHERE user_id = %s', (uid,)
        ).fetchall()
    if not subs:
        return api_error('Немає активних push-підписок. Спочатку підпишіться на сповіщення.')
    send_push(uid, '🔔 Тест', 'Push-сповіщення працює!', '/dashboard')
    return jsonify({'ok': True, 'data': {'sent_to': len(subs)}})


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
            conn.execute('DELETE FROM push_subscriptions WHERE endpoint = %s', (endpoint,))
            conn.execute(
                'INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (%s, %s, %s, %s)',
                (uid, endpoint, p256dh, auth)
            )
        logger.info('push subscribe: user_id=%s endpoint=%.60s', uid, endpoint)
        return jsonify({'ok': True})
    except Exception as exc:
        logger.exception('push subscribe error: %s', exc)
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

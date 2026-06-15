"""Web Push notification routes — VAPID-підписки та відправка сповіщень.

Web Push (RFC 8030) дозволяє відправляти сповіщення в браузер або PWA навіть
коли застосунок закритий. Схема:
  1. Клієнт запитує публічний VAPID-ключ → GET /api/push/vapid-public-key
  2. Браузер підписується (navigator.serviceWorker → PushManager.subscribe) →
     отримує { endpoint, p256dh, auth } → POST /api/push/subscribe
  3. Сервер зберігає підписку в push_subscriptions і може відправляти push через
     функцію send_push() (яка викликається з інших маршрутів при подіях).
  4. Браузер відписується → DELETE /api/push/unsubscribe

VAPID (Voluntary Application Server Identification) — стандарт автентифікації
сервера-відправника. Приватний ключ (VAPID_PRIVATE_KEY) зберігається в env,
публічний передається клієнту для підписки.
"""
from __future__ import annotations

import base64
import json
import logging
import os

from flask import Blueprint, jsonify, request, g

from ..database import get_connection    # з'єднання з БД для читання/запису підписок
from .helpers import api_error, auth_required, rate_limit

push_bp = Blueprint('push', __name__, url_prefix='/api/push')
logger = logging.getLogger(__name__)   # логер модуля (виводить у gunicorn/stderr)

# email контакту для VAPID claims (вимога специфікації — сервіс-провайдер може зв'язатись)
_VAPID_CONTACT = os.getenv('VAPID_CONTACT', 'mailto:admin@army-bank.ua')


# ── VAPID key helpers ─────────────────────────────────────────────────────────

def _get_private_pem() -> str:
    """Читає VAPID приватний ключ з env при кожному виклику (не при завантаженні модуля).

    Ключ може бути або Base64-encoded PEM, або вже чистим PEM-рядком.
    Читаємо при виклику (not at module load) щоб env міг оновлюватися динамічно
    без перезапуску Flask процесу (ротація ключів).
    Повертає '' якщо ключ не налаштований — send_push() обробляє цей випадок.
    """
    raw = os.getenv('VAPID_PRIVATE_KEY', '')
    if not raw:
        return ''
    try:
        decoded = base64.b64decode(raw).decode()  # спробуємо декодувати з Base64
        return decoded
    except Exception:
        return raw   # вже PEM-рядок (починається з "-----BEGIN EC PRIVATE KEY-----")


def _get_public_key() -> str:
    """Публічний VAPID ключ у форматі base64url (Application Server Key).

    Передається клієнту для PushManager.subscribe({ applicationServerKey }).
    Має збігатися з парою до приватного ключа. Дефолт — тестовий ключ для dev.
    """
    return os.getenv(
        'VAPID_PUBLIC_KEY',
        'BBkDBdD-nffWa34kkN60vFPKbsiUhz4htDfdAQUp7eVrlLIiaAveTB_qd5xGxGaUrTOXsSk50GmdYnmOARV9wJs',
    )


# ── Основна функція відправки ─────────────────────────────────────────────────

def send_push(
    user_id: int,
    title: str,
    body: str,
    url: str = '/dashboard',
    push_type: str = 'default',
    meta: dict | None = None,
) -> None:
    """Відправляє Web Push на всі активні підписки користувача. Ніколи не кидає виняток.

    Функція є fire-and-forget: помилки логуються, але не перериваюсь основний флоу.
    Підписки з кодом 404/410 (застарілі — браузер відписався) автоматично видаляються.

    Аргументи:
      user_id   — ідентифікатор користувача (для пошуку підписок)
      title     — заголовок push-сповіщення
      body      — текст сповіщення
      url       — URL для навігації при кліку (обробляється SW)
      push_type — тип для SW: 'transaction', 'kyc_verified', 'push_test' тощо
      meta      — додаткові поля для payload (передаються як є)
    """
    pem = _get_private_pem()
    if not pem:
        # VAPID не налаштований — тихо пропускаємо (нормально на dev без env)
        logger.warning('send_push: VAPID_PRIVATE_KEY not set, skipping push for user_id=%s', user_id)
        return
    try:
        from pywebpush import webpush, WebPushException   # lazy import: важка залежність

        # ── Завантажуємо всі активні підписки користувача ────────────────────
        with get_connection() as conn:
            subs = conn.execute(
                'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = %s',
                (user_id,)
            ).fetchall()

        if not subs:
            logger.info('send_push: no subscriptions for user_id=%s', user_id)
            return   # нікому відправляти

        # ── Формуємо payload у форматі, який Service Worker очікує ──────────
        payload_obj = {'title': title, 'body': body, 'url': url, 'type': push_type}
        if isinstance(meta, dict):
            for key, value in meta.items():
                payload_obj[str(key)] = value    # мержимо meta (напр. kyc_status, amount)
        payload = json.dumps(payload_obj, ensure_ascii=False)

        # ── Відправляємо на кожну підписку окремо ────────────────────────────
        for sub in subs:
            try:
                webpush(
                    subscription_info={
                        'endpoint': sub['endpoint'],
                        'keys': {'p256dh': sub['p256dh'], 'auth': sub['auth']},
                    },
                    data=payload,
                    vapid_private_key=pem,
                    vapid_claims={'sub': _VAPID_CONTACT},  # обов'язкова вимога VAPID
                    content_encoding='aes128gcm',          # сучасне шифрування payload
                    headers={'Content-Type': 'application/json'},
                )
                logger.info('send_push: delivered to user_id=%s endpoint=%.60s', user_id, sub['endpoint'])

            except WebPushException as exc:
                status = exc.response.status_code if exc.response is not None else None
                logger.warning('send_push: WebPushException user_id=%s status=%s err=%s', user_id, status, exc)
                if status in (404, 410):
                    # 404/410 = підписка застаріла або браузер відписався
                    # Видаляємо, щоб не витрачати ресурси на мертві endpoint
                    with get_connection() as conn:
                        conn.execute(
                            'DELETE FROM push_subscriptions WHERE endpoint = %s',
                            (sub['endpoint'],)
                        )
            except Exception as exc:
                # Мережевий збій, timeout тощо — логуємо і продовжуємо з наступною підпискою
                logger.exception('send_push: unexpected error user_id=%s: %s', user_id, exc)

    except Exception as exc:
        logger.exception('send_push: top-level error: %s', exc)


# ── API маршрути ──────────────────────────────────────────────────────────────

@push_bp.get('/vapid-public-key')
@rate_limit(30, 60)   # 30 запитів за 60 секунд — без авторизації (потрібен перед логіном)
def vapid_public_key():
    """GET /api/push/vapid-public-key — повернути публічний VAPID ключ.

    Публічний ключ потрібен клієнту до авторизації (для налаштування Service Worker).
    Тому ендпоінт відкритий, але захищений rate_limit від scraping.
    """
    try:
        return jsonify({'ok': True, 'data': _get_public_key()})
    except Exception as exc:
        return api_error(str(exc))


@push_bp.get('/status')
@auth_required
def push_status():
    """GET /api/push/status — стан push-підписок поточного користувача.

    Повертає: чи налаштований VAPID, кількість підписок, список з маскованими endpoint.
    Корисно для UI «Налаштування сповіщень» (увімкнено/вимкнено).
    Endpoint маскується до 60 символів — повний URL не потрібен UI, і не розкриваємо
    ідентифікатор пристрою зайве.
    """
    try:
        uid = g.current_user['id']
        with get_connection() as conn:
            subs = conn.execute(
                'SELECT id, endpoint, created_at FROM push_subscriptions WHERE user_id = %s',
                (uid,)
            ).fetchall()
        return jsonify({'ok': True, 'data': {
            'vapid_configured':    bool(_get_private_pem()),   # True = push реально відправлятиметься
            'subscriptions_count': len(subs),
            'subscriptions': [
                {
                    'id':         s['id'],
                    'endpoint':   s['endpoint'][:60] + '...',  # маскуємо довгий URL
                    'created_at': s['created_at'],
                }
                for s in subs
            ],
        }})
    except Exception as exc:
        return api_error(str(exc))


@push_bp.post('/test')
@auth_required
def test_push():
    """POST /api/push/test — надіслати тестове push-сповіщення поточному користувачу.

    Використовується адміністратором або самим користувачем для перевірки
    що push-канал працює. Повертає кількість підписок, на які відправлено.
    """
    try:
        uid = g.current_user['id']
        pem = _get_private_pem()
        if not pem:
            return api_error('VAPID_PRIVATE_KEY не налаштований на сервері.')
        # Перевіряємо наявність підписок перед відправкою (send_push теж перевіряє, але краще дати чітку помилку)
        with get_connection() as conn:
            subs = conn.execute(
                'SELECT endpoint FROM push_subscriptions WHERE user_id = %s', (uid,)
            ).fetchall()
        if not subs:
            return api_error('Немає активних push-підписок. Спочатку підпишіться на сповіщення.')
        send_push(uid, '🔔 ARM Bank', 'Тест push працює коректно.', '/messenger', 'push_test')
        return jsonify({'ok': True, 'data': {'sent_to': len(subs)}})
    except Exception as exc:
        return api_error(str(exc))


@push_bp.post('/subscribe')
@auth_required
def subscribe():
    """POST /api/push/subscribe — зберегти push-підписку браузера.

    Body: { endpoint, p256dh, auth } — дані з браузерного PushSubscription.pushManager.subscribe().
    DELETE + INSERT замість INSERT OR REPLACE щоб коректно оновити підписку при
    переконфігурації (той самий endpoint з новими ключами після очищення SW).
    """
    data     = request.get_json(force=True, silent=True) or {}
    endpoint = (data.get('endpoint') or '').strip()
    p256dh   = (data.get('p256dh')   or '').strip()   # ключ шифрування payload (Diffie-Hellman)
    auth     = (data.get('auth')     or '').strip()   # ключ автентифікації (16-байтний секрет)
    if not endpoint or not p256dh or not auth:
        return api_error('Неповні дані підписки.')   # всі три поля обов'язкові
    try:
        uid = g.current_user['id']
        with get_connection() as conn:
            # DELETE спочатку: замінюємо підписку якщо endpoint уже існує (напр. ротація ключів)
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
    """DELETE /api/push/unsubscribe — видалити push-підписку.

    Body: { endpoint } — видаляє конкретний endpoint поточного користувача.
    AND user_id = ... захищає від видалення чужих підписок (якщо endpoint витік).
    Якщо endpoint не передано — нічого не робимо (idempotent).
    """
    try:
        data     = request.get_json(force=True, silent=True) or {}
        endpoint = (data.get('endpoint') or '').strip()
        if endpoint:
            with get_connection() as conn:
                # AND user_id — не можна відписати чужий endpoint
                conn.execute(
                    'DELETE FROM push_subscriptions WHERE endpoint = %s AND user_id = %s',
                    (endpoint, g.current_user['id'])
                )
        return jsonify({'ok': True})
    except Exception as exc:
        return api_error(str(exc))

"""3DS Challenge routes — EMV® 3-D Secure аналог для підтвердження переказів.

Схема роботи:
  1. Клієнт хоче зробити переказ → спочатку POST /api/3ds/challenge
     (отримує challenge_id і demo_otp — в реальному банку OTP надходить SMS-кою).
  2. Клієнт вводить OTP → POST /api/3ds/verify → отримує session_token.
  3. При переказі передає tds_session (session_token) → сервер перевіряє і
     одноразово «спалює» сесію через consume_session().

Таким чином навіть якщо Bearer-токен викрали, без OTP-сесії переказ неможливий.
"""
from __future__ import annotations

from flask import Blueprint, jsonify, request, g

from ..services.three_ds_service import ThreeDSService  # логіка OTP-генерації і верифікації
from .helpers import api_error, auth_required           # декоратор авторизації і хелпер помилок

three_ds_bp = Blueprint('three_ds', __name__, url_prefix='/api/3ds')
_svc = ThreeDSService()   # сервіс є stateless, безпечно використовувати як синглтон


# ── Крок 1: Ініціювати 3DS-виклик ────────────────────────────────────────────

@three_ds_bp.post('/challenge')
@auth_required
def create_challenge():
    """POST /api/3ds/challenge — генерує OTP-виклик для підтвердження операції.

    Body:
      amount    (float) — сума операції, яку хочемо підтвердити
      recipient (str)   — отримувач (для відображення у повідомленні)

    Response:
      challenge_id  — унікальний ідентифікатор виклику (UUID)
      demo_otp      — OTP-код (в DEMO-режимі повертається у відповіді,
                      в PROD надходить SMS на телефон з g.current_user)
      masked_phone  — останні 4 цифри телефону (для відображення: «OTP на ***1234»)
      expires_in    — секунд до протермінування (зазвичай 300 = 5 хв)
    """
    try:
        data      = request.get_json(force=True) or {}
        amount    = float(data.get('amount') or 0)            # сума потрібна для логу і SMS-тексту
        recipient = str(data.get('recipient') or '').strip()  # ім'я/рахунок отримувача
        user_id   = int(g.current_user['id'])
        result    = _svc.create_challenge(user_id, amount, recipient)
        return jsonify({'ok': True, 'data': result})
    except Exception as exc:
        return api_error(str(exc))


# ── Крок 2: Верифікувати OTP і отримати session_token ────────────────────────

@three_ds_bp.post('/verify')
@auth_required
def verify_challenge():
    """POST /api/3ds/verify — перевіряє OTP і видає одноразовий session_token.

    Body:
      challenge_id (str) — ідентифікатор виклику з /challenge
      otp_code     (str) — 6-значний OTP, введений користувачем

    Response:
      session_token — токен для передачі в тіло переказу (поле tds_session)
      valid_for     — секунд, протягом яких session_token дійсний

    Session_token можна використати лише один раз:
    consume_session() видаляє його після першого успішного переказу.
    """
    try:
        data         = request.get_json(force=True) or {}
        challenge_id = str(data.get('challenge_id') or '').strip()  # UUID виклику
        otp_code     = str(data.get('otp_code')     or '').strip()  # OTP від користувача
        user_id      = int(g.current_user['id'])
        result       = _svc.verify_challenge(user_id, challenge_id, otp_code)
        return jsonify({'ok': True, 'data': result})
    except Exception as exc:
        return api_error(str(exc))

"""3DS Challenge routes — EMV® 3-D Secure аналог."""
from __future__ import annotations

from flask import Blueprint, jsonify, request, g

from ..services.three_ds_service import ThreeDSService
from .helpers import api_error, auth_required

three_ds_bp = Blueprint('three_ds', __name__, url_prefix='/api/3ds')
_svc = ThreeDSService()


@three_ds_bp.post('/challenge')
@auth_required
def create_challenge():
    """Ініціює 3DS challenge для поточного юзера.

    Body: { amount: float, recipient: str }
    Response: { challenge_id, demo_otp, masked_phone, expires_in }
    """
    try:
        data = request.get_json(force=True) or {}
        amount = float(data.get('amount') or 0)
        recipient = str(data.get('recipient') or '').strip()
        user_id = int(g.current_user['id'])
        result = _svc.create_challenge(user_id, amount, recipient)
        return jsonify({'ok': True, 'data': result})
    except Exception as exc:
        return api_error(str(exc))


@three_ds_bp.post('/verify')
@auth_required
def verify_challenge():
    """Перевіряє OTP та видає session_token.

    Body: { challenge_id: str, otp_code: str }
    Response: { session_token, valid_for }
    """
    try:
        data = request.get_json(force=True) or {}
        challenge_id = str(data.get('challenge_id') or '').strip()
        otp_code = str(data.get('otp_code') or '').strip()
        user_id = int(g.current_user['id'])
        result = _svc.verify_challenge(user_id, challenge_id, otp_code)
        return jsonify({'ok': True, 'data': result})
    except Exception as exc:
        return api_error(str(exc))

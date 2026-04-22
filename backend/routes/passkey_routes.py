"""WebAuthn / Passkey routes — Face ID login для iOS PWA."""
from __future__ import annotations

import base64
import json
import os

from flask import Blueprint, jsonify, request, session

import webauthn
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)
from webauthn.helpers.exceptions import InvalidCBORData, InvalidAuthenticatorDataStructure

from ..repositories.passkey_repository import PasskeyRepository
from ..repositories.user_repository import UserRepository
from .helpers import api_error, auth_required

passkey_bp = Blueprint('passkey', __name__, url_prefix='/api/auth/passkey')

_passkeys = PasskeyRepository()
_users    = UserRepository()

# ── Helpers ──────────────────────────────────────────────────────────────────

def _rp_id() -> str:
    """Relying Party ID — hostname без порту."""
    origin = _origin()
    if origin.startswith('https://'):
        host = origin[8:]
    elif origin.startswith('http://'):
        host = origin[7:]
    else:
        host = origin
    return host.split(':')[0]

def _origin() -> str:
    """Detect origin from request or env."""
    env_origin = os.environ.get('WEBAUTHN_ORIGIN', '').strip()
    if env_origin:
        return env_origin
    # Derive from request
    fwd_proto = request.headers.get('X-Forwarded-Proto', request.scheme)
    host = request.headers.get('X-Forwarded-Host') or request.host
    return f"{fwd_proto}://{host}"


# ── Registration ──────────────────────────────────────────────────────────────

@passkey_bp.route('/register-options', methods=['POST'])
@auth_required
def register_options():
    """Generate registration challenge."""
    user = _users.get_by_id(g_user_id())
    if not user:
        return api_error('Користувача не знайдено', 404)

    existing = _passkeys.list_by_user(user['id'])
    exclude = []
    for pk in existing:
        exclude.append(webauthn.helpers.structs.PublicKeyCredentialDescriptor(
            id=base64.urlsafe_b64decode(pk['credential_id'] + '==')
        ))

    options = webauthn.generate_registration_options(
        rp_id=_rp_id(),
        rp_name='ARM Bank',
        user_id=str(user['id']).encode(),
        user_name=user.get('phone') or user.get('email') or str(user['id']),
        user_display_name=user.get('full_name', 'Клієнт'),
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        exclude_credentials=exclude,
    )

    # Store challenge in session for verification
    session['passkey_reg_challenge'] = base64.urlsafe_b64encode(options.challenge).decode()

    return jsonify({'ok': True, 'data': json.loads(webauthn.options_to_json(options))})


@passkey_bp.route('/register', methods=['POST'])
@auth_required
def register_verify():
    """Verify registration response and save credential."""
    challenge_b64 = session.pop('passkey_reg_challenge', None)
    if not challenge_b64:
        return api_error('Challenge не знайдено. Спробуйте ще раз.', 400)

    data = request.get_json(silent=True) or {}
    if not data:
        return api_error('Порожнє тіло запиту', 400)

    try:
        verification = webauthn.verify_registration_response(
            credential=data,
            expected_challenge=base64.urlsafe_b64decode(challenge_b64 + '=='),
            expected_rp_id=_rp_id(),
            expected_origin=_origin(),
        )
    except Exception as exc:
        return api_error(f'Помилка верифікації: {exc}', 400)

    cred_id  = base64.urlsafe_b64encode(verification.credential_id).rstrip(b'=').decode()
    pub_key  = base64.urlsafe_b64encode(verification.credential_public_key).rstrip(b'=').decode()

    user_id = g_user_id()
    _passkeys.save(user_id, cred_id, pub_key, verification.sign_count)

    return jsonify({'ok': True, 'message': 'Face ID зареєстровано'})


# ── Authentication ─────────────────────────────────────────────────────────────

@passkey_bp.route('/login-options', methods=['POST'])
def login_options():
    """Generate authentication challenge (pre-login, no token needed)."""
    options = webauthn.generate_authentication_options(
        rp_id=_rp_id(),
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    session['passkey_auth_challenge'] = base64.urlsafe_b64encode(options.challenge).decode()
    return jsonify({'ok': True, 'data': json.loads(webauthn.options_to_json(options))})


@passkey_bp.route('/login', methods=['POST'])
def login_verify():
    """Verify authentication response and return JWT."""
    challenge_b64 = session.pop('passkey_auth_challenge', None)
    if not challenge_b64:
        return api_error('Challenge не знайдено. Спробуйте ще раз.', 400)

    data = request.get_json(silent=True) or {}
    if not data:
        return api_error('Порожнє тіло запиту', 400)

    # Find credential
    raw_id = data.get('rawId') or data.get('id', '')
    # Normalize to url-safe base64 without padding
    cred_id = raw_id.rstrip('=').replace('+', '-').replace('/', '_')

    pk_row = _passkeys.get_by_credential_id(cred_id)
    if not pk_row:
        return api_error('Passkey не знайдено', 404)

    pub_key_bytes = base64.urlsafe_b64decode(pk_row['public_key'] + '==')

    try:
        verification = webauthn.verify_authentication_response(
            credential=data,
            expected_challenge=base64.urlsafe_b64decode(challenge_b64 + '=='),
            expected_rp_id=_rp_id(),
            expected_origin=_origin(),
            credential_public_key=pub_key_bytes,
            credential_current_sign_count=pk_row['sign_count'],
        )
    except Exception as exc:
        return api_error(f'Помилка верифікації: {exc}', 400)

    _passkeys.update_sign_count(cred_id, verification.new_sign_count)

    user = _users.get_by_id(pk_row['user_id'])
    if not user:
        return api_error('Користувача не знайдено', 404)

    from ..utils.security import generate_token, token_expiration_iso
    token = generate_token()
    _users.create_session(user['id'], token, token_expiration_iso())

    return jsonify({
        'ok': True,
        'data': {
            'token': token,
            'user': {
                'id': user['id'],
                'full_name': user.get('full_name'),
                'phone': user.get('phone'),
                'email': user.get('email'),
            },
        },
    })


# ── Status / remove ───────────────────────────────────────────────────────────

@passkey_bp.route('/status', methods=['GET'])
@auth_required
def status():
    user_id = g_user_id()
    return jsonify({'ok': True, 'data': {'has_passkey': _passkeys.has_passkey(user_id)}})


@passkey_bp.route('/remove', methods=['DELETE'])
@auth_required
def remove():
    user_id = g_user_id()
    _passkeys.delete_by_user(user_id)
    return jsonify({'ok': True, 'message': 'Face ID відключено'})


# ── Util ──────────────────────────────────────────────────────────────────────

def g_user_id() -> int:
    from flask import g
    return g.user_id

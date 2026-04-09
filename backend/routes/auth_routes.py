"""Маршрути автентифікації."""
from __future__ import annotations

from flask import Blueprint, jsonify, request, g

from ..config import AUTH_LOGIN_RATE_LIMIT, AUTH_RATE_WINDOW_SECONDS, AUTH_REGISTER_RATE_LIMIT
from ..services.auth_service import AuthService
from .helpers import api_error, auth_required, rate_limit

auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')
auth_service = AuthService()


def _auth_client_ip() -> str:
    xff = (request.headers.get('X-Forwarded-For') or '').strip()
    if xff:
        return xff.split(',')[0].strip()[:80]
    return (request.remote_addr or 'unknown')[:80]


def _login_rate_key() -> str:
    data = request.get_json(silent=True) or {}
    identity = (data.get('identity') or '').strip().lower()[:80]
    return f'auth:login:{_auth_client_ip()}:{identity}'


def _register_rate_key() -> str:
    return f'auth:register:{_auth_client_ip()}'


@auth_bp.post('/register')
@rate_limit(AUTH_REGISTER_RATE_LIMIT, AUTH_RATE_WINDOW_SECONDS, key_func=_register_rate_key)
def register():
    try:
        payload = auth_service.register(request.get_json(force=True))
        return jsonify({'ok': True, 'data': payload})
    except Exception as exc:
        return api_error(str(exc))


@auth_bp.post('/login')
@rate_limit(AUTH_LOGIN_RATE_LIMIT, AUTH_RATE_WINDOW_SECONDS, key_func=_login_rate_key)
def login():
    try:
        payload = auth_service.login(request.get_json(force=True))
        return jsonify({'ok': True, 'data': payload})
    except Exception as exc:
        return api_error(str(exc), 401)


@auth_bp.post('/logout')
@auth_required
def logout():
    try:
        auth_service.logout(g.current_token)
        return jsonify({'ok': True, 'message': 'Сесію завершено.'})
    except Exception as exc:
        return api_error(str(exc))


@auth_bp.get('/me')
@auth_required
def me():
    try:
        user = g.current_user
        account, auto_created = auth_service.ensure_user_bank_account(user['id'])
        return jsonify({'ok': True, 'data': {
            'id': user['id'],
            'full_name': user['full_name'],
            'phone': user['phone'],
            'email': user['email'],
            'role': user['role'],
            'military_status': user['military_status'],
            'bank_account_linked': bool(account),
            'bank_account_number': account.get('account_number') if account else None,
            'bank_notice': 'Банківський рахунок створено автоматично для синхронізації з месенджером.' if auto_created else None,
        }})
    except Exception as exc:
        return api_error(str(exc))


@auth_bp.get('/sessions')
@auth_required
def list_sessions():
    try:
        data = auth_service.list_sessions(g.current_user['id'], g.current_token)
        return jsonify({'ok': True, 'data': data})
    except Exception as exc:
        return api_error(str(exc))


@auth_bp.delete('/sessions/<int:session_id>')
@auth_required
def revoke_session(session_id: int):
    try:
        auth_service.revoke_session(session_id, g.current_user['id'])
        return jsonify({'ok': True})
    except Exception as exc:
        return api_error(str(exc), 404)


@auth_bp.put('/password')
@auth_required
def change_password():
    try:
        data = request.get_json(force=True)
        old_password = (data.get('old_password') or '').strip()
        new_password = (data.get('new_password') or '').strip()
        if not old_password or not new_password:
            return api_error('Потрібно вказати поточний та новий пароль.')
        auth_service.change_password(g.current_user['id'], old_password, new_password)
        return jsonify({'ok': True, 'message': 'Пароль успішно змінено.'})
    except Exception as exc:
        return api_error(str(exc))

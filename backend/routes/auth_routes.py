"""Маршрути автентифікації."""
from __future__ import annotations

from flask import Blueprint, jsonify, request, g

from ..services.auth_service import AuthService
from .helpers import api_error, auth_required

auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')
auth_service = AuthService()


@auth_bp.post('/register')
def register():
    try:
        payload = auth_service.register(request.get_json(force=True))
        return jsonify({'ok': True, 'data': payload})
    except Exception as exc:
        return api_error(str(exc))


@auth_bp.post('/login')
def login():
    try:
        payload = auth_service.login(request.get_json(force=True))
        return jsonify({'ok': True, 'data': payload})
    except Exception as exc:
        return api_error(str(exc), 401)


@auth_bp.post('/logout')
@auth_required
def logout():
    auth_service.logout(g.current_token)
    return jsonify({'ok': True, 'message': 'Сесію завершено.'})


@auth_bp.get('/me')
@auth_required
def me():
    user = g.current_user
    return jsonify({'ok': True, 'data': {
        'id': user['id'],
        'full_name': user['full_name'],
        'phone': user['phone'],
        'email': user['email'],
        'role': user['role'],
        'military_status': user['military_status'],
    }})


@auth_bp.get('/sessions')
@auth_required
def list_sessions():
    data = auth_service.list_sessions(g.current_user['id'], g.current_token)
    return jsonify({'ok': True, 'data': data})


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

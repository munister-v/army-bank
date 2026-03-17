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

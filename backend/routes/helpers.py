"""Допоміжні функції для маршрутів Flask."""
from __future__ import annotations

from functools import wraps
from flask import jsonify, request, g

from ..services.auth_service import AuthService

auth_service = AuthService()


def api_error(message: str, status: int = 400):
    return jsonify({'ok': False, 'error': message}), status


def auth_required(func):
    """Перевіряє Bearer-токен і передає користувача в g.current_user."""
    @wraps(func)
    def wrapper(*args, **kwargs):
        header = request.headers.get('Authorization', '')
        if not header.startswith('Bearer '):
            return api_error('Потрібна авторизація.', 401)
        token = header.replace('Bearer ', '', 1).strip()
        user = auth_service.get_user_by_token(token)
        if not user:
            return api_error('Недійсна або прострочена сесія.', 401)
        g.current_user = user
        g.current_token = token
        return func(*args, **kwargs)
    return wrapper

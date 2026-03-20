"""Допоміжні функції для маршрутів Flask."""
from __future__ import annotations

from functools import wraps
from flask import jsonify, request, g, after_this_request

from ..services.auth_service import AuthService
from ..utils.security import should_refresh_session

auth_service = AuthService()


def api_error(message: str, status: int = 400):
    return jsonify({'ok': False, 'error': message}), status


def auth_required(func):
    """Перевіряє Bearer-токен.

    - Записує g.current_user і g.current_token.
    - Якщо до закінчення сесії < 7 днів — автоматично продовжує токен
      і повертає новий у заголовку X-Refresh-Token.
    """
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

        # Автооновлення сесії якщо залишилось < 7 днів
        if should_refresh_session(user.get('expires_at', '')):
            new_token = auth_service.refresh_session(token, user['id'])
            if new_token:
                @after_this_request
                def add_refresh_header(response):
                    response.headers['X-Refresh-Token'] = new_token
                    response.headers['Access-Control-Expose-Headers'] = 'X-Refresh-Token'
                    return response

        return func(*args, **kwargs)
    return wrapper


def role_required(*allowed_roles: str):
    """Декоратор: перевіряє, що g.current_user має одну з дозволених ролей. Після auth_required."""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            user = getattr(g, 'current_user', None)
            if not user:
                return api_error('Потрібна авторизація.', 401)
            if user.get('role') not in allowed_roles:
                return api_error('Доступ заборонено.', 403)
            return func(*args, **kwargs)
        return wrapper
    return decorator

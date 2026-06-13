"""Допоміжні функції для маршрутів Flask.

Містить наскрізні (cross-cutting) механізми, що використовуються майже
в усіх роутах:
  * auth_required   — перевірка Bearer-токена + sliding session refresh
  * role_required   — перевірка ролі користувача (admin/user тощо)
  * rate_limit      — in-memory rate limiter (захист від brute-force/спаму)
  * require_idempotency_key — перевірка заголовка Idempotency-Key
                               для платіжних операцій
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from functools import wraps
from flask import jsonify, request, g, after_this_request, current_app

from ..services.auth_service import AuthService
from ..utils.security import should_refresh_session
from ..config import (
    AUTH_RATE_LIMIT_ENABLED,
    ENABLE_RATE_LIMIT_IN_TESTS,
    ENFORCE_IDEMPOTENCY_HEADERS,
    ENFORCE_IDEMPOTENCY_IN_TESTS,
)

auth_service = AuthService()

# In-memory rate limiter: лічильники зберігаються в пам'яті процесу.
# _RATE_LOCK захищає _RATE_BUCKETS від паралельних запитів (gunicorn -
# 2 worker'и означають 2 окремі набори лічильників, але кожен потоковий
# worker (gthread) ділить ці структури між потоками, тож блокування потрібне).
_RATE_LOCK = threading.Lock()
_RATE_BUCKETS: dict[str, deque[float]] = defaultdict(deque)


def api_error(message: str, status: int = 400):
    """Уніфікований формат помилки API: {'ok': False, 'error': ...}."""
    return jsonify({'ok': False, 'error': message}), status


def auth_required(func):
    """Перевіряє Bearer-токен.

    - Записує g.current_user і g.current_token.
    - Якщо до закінчення сесії < 7 днів — автоматично продовжує токен
      і повертає новий у заголовку X-Refresh-Token.
    """
    @wraps(func)
    def wrapper(*args, **kwargs):
        # Очікуваний формат: "Authorization: Bearer <token>"
        header = request.headers.get('Authorization', '')
        if not header.startswith('Bearer '):
            return api_error('Потрібна авторизація.', 401)
        token = header.replace('Bearer ', '', 1).strip()
        # get_user_by_token() звертається до таблиці sessions і одночасно
        # перевіряє, що сесія ще не прострочена (expires_at > now).
        user = auth_service.get_user_by_token(token)
        if not user:
            return api_error('Недійсна або прострочена сесія.', 401)

        g.current_user = user
        g.current_token = token
        # Зворотна сумісність: деякі (старіші) роути читають g.user_id напряму
        # замість g.current_user['id'].
        g.user_id = user.get('id')

        # Оновити users.last_seen_at — використовується, наприклад,
        # для індикації "онлайн"-статусу в адмінці/месенджері.
        # Best-effort: збій цього запиту не повинен блокувати основний роут.
        try:
            from ..database import get_connection
            from ..config import USE_PG
            with get_connection() as _lsa_conn:
                _now_sql = 'NOW()' if USE_PG else "datetime('now')"
                _lsa_conn.execute(
                    f"UPDATE users SET last_seen_at = {_now_sql} WHERE id = %s",
                    (user['id'],),
                )
        except Exception:
            pass

        # Sliding expiration: якщо до закінчення сесії залишилось менше
        # 7 днів (_REFRESH_THRESHOLD_HOURS у security.py), видаємо новий
        # токен і повертаємо його у заголовку X-Refresh-Token. Фронтенд
        # перехоплює цей заголовок і замінює збережений токен — користувач
        # лишається залогіненим без явного re-login, доки активно
        # користується застосунком.
        if should_refresh_session(user.get('expires_at', '')):
            new_token = auth_service.refresh_session(token, user['id'])
            if new_token:
                @after_this_request
                def add_refresh_header(response):
                    response.headers['X-Refresh-Token'] = new_token
                    # CORS: за замовчуванням браузер не дає JS читати кастомні
                    # заголовки відповіді, якщо вони не перелічені в
                    # Access-Control-Expose-Headers — додаємо їх явно.
                    existing = (response.headers.get('Access-Control-Expose-Headers') or '').strip()
                    parts = [p.strip() for p in existing.split(',') if p.strip()]
                    for header_name in ('X-Refresh-Token', 'X-Request-Id'):
                        if header_name not in parts:
                            parts.append(header_name)
                    response.headers['Access-Control-Expose-Headers'] = ', '.join(parts)
                    return response

        return func(*args, **kwargs)
    return wrapper


def _client_ip() -> str:
    """IP клієнта з урахуванням nginx-проксі.

    nginx додає заголовок X-Forwarded-For з реальною IP клієнта (інакше
    request.remote_addr показував би 127.0.0.1 — адресу проксі).
    Беремо ПЕРШИЙ елемент списку (оригінальний клієнт), решта — це
    проміжні проксі.
    """
    xff = (request.headers.get('X-Forwarded-For') or '').strip()
    if xff:
        return xff.split(',')[0].strip()[:80]
    return (request.remote_addr or 'unknown')[:80]


def _cfg_bool(name: str, default: bool) -> bool:
    value = current_app.config.get(name, default)
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {'1', 'true', 'yes', 'on'}


def _idempotency_enforced() -> bool:
    if not _cfg_bool('ENFORCE_IDEMPOTENCY_HEADERS', ENFORCE_IDEMPOTENCY_HEADERS):
        return False
    if current_app.testing:
        return _cfg_bool('ENFORCE_IDEMPOTENCY_IN_TESTS', ENFORCE_IDEMPOTENCY_IN_TESTS)
    return True


def require_idempotency_key(payload: dict | None = None, allow_body_fallback: bool = False):
    """Дістає ключ ідемпотентності для платіжних операцій.

    Повертає (key, None) при успіху або (None, error_response) при помилці.
    Цей ключ передається у PaymentCore.transfer() — повторний запит з тим
    же ключем не призведе до повторного списання коштів (див.
    payment_core.py: перевірка `get_by_idempotency_key`).
    """
    header_key = (request.headers.get('Idempotency-Key') or '').strip()
    if header_key:
        if len(header_key) > 128:
            return None, api_error('Idempotency-Key занадто довгий (максимум 128 символів).')
        return header_key, None

    if allow_body_fallback and isinstance(payload, dict):
        body_key = (payload.get('idempotency_key') or '').strip()
        if body_key:
            if len(body_key) > 128:
                return None, api_error('idempotency_key занадто довгий (максимум 128 символів).')
            return body_key, None

    if _idempotency_enforced():
        return None, api_error('Потрібний заголовок Idempotency-Key.', 400)
    return None, None


def actor_rate_key(scope: str = 'api') -> str:
    """Ключ rate-limit'у: по user_id якщо залогінений, інакше по IP.

    Авторизований користувач обмежується персонально (не може заблокувати
    інших спільним IP в офісі/NAT), анонімні запити обмежуються по IP.
    """
    user = getattr(g, 'current_user', None) or {}
    user_id = user.get('id')
    if user_id:
        return f'rl:{scope}:user:{int(user_id)}'
    return f'rl:{scope}:ip:{_client_ip()}'


def user_or_ip_rate_key(scope: str = 'api') -> str:
    """Псевдонім actor_rate_key — окрема назва для семантичної ясності
    у місцях, де ключ використовується для лімітів "на користувача/IP"
    (наприклад, операції з рахунком), а не суто автентифікації."""
    user = getattr(g, 'current_user', None) or {}
    user_id = user.get('id')
    if user_id:
        return f'rl:{scope}:user:{int(user_id)}'
    return f'rl:{scope}:ip:{_client_ip()}'


def rate_limit(limit: int, window_seconds: int, key_func=None):
    """Простий in-memory rate limiter за алгоритмом sliding window log.

    Для кожного ключа зберігається deque з timestamp'ами останніх запитів.
    При новому запиті старі записи (старші за window_seconds) видаляються
    зліва (вони впорядковані за часом), і якщо залишок >= limit — запит
    відхиляється з 429 і заголовком Retry-After.

    Обмеження: лічильники живуть в пам'яті процесу gunicorn — при кількох
    worker'ах кожен має свій набір лічильників (тобто фактичний ліміт
    може бути в N_WORKERS разів вищий за вказаний). Для критичних шляхів
    (логін/реєстрація) додатково є nginx limit_req_zone на рівні проксі.

    У TESTING режимі вимкнений, щоб не ламати unit/integration тести
    (якщо явно не увімкнено ENABLE_RATE_LIMIT_IN_TESTS).
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            if (
                (current_app.testing and not _cfg_bool('ENABLE_RATE_LIMIT_IN_TESTS', ENABLE_RATE_LIMIT_IN_TESTS))
                or not AUTH_RATE_LIMIT_ENABLED
                or limit <= 0
                or window_seconds <= 0
            ):
                return func(*args, **kwargs)

            key = key_func() if key_func else f'{_client_ip()}:{request.path}'
            now = time.time()
            cutoff = now - window_seconds

            with _RATE_LOCK:
                bucket = _RATE_BUCKETS[key]
                # Видаляємо застарілі записи з початку deque (вони
                # завжди впорядковані за часом додавання).
                while bucket and bucket[0] <= cutoff:
                    bucket.popleft()

                if len(bucket) >= limit:
                    # Retry-After: скільки секунд лишилось до того, як
                    # найстаріший запис у вікні "застаріє" і звільнить слот.
                    retry_after = max(1, int(window_seconds - (now - bucket[0])))
                    resp = jsonify({
                        'ok': False,
                        'error': 'Забагато запитів. Спробуйте трохи пізніше.',
                    })
                    resp.status_code = 429
                    resp.headers['Retry-After'] = str(retry_after)
                    return resp

                bucket.append(now)

            return func(*args, **kwargs)
        return wrapper
    return decorator


def role_required(*allowed_roles: str):
    """Декоратор: перевіряє, що g.current_user має одну з дозволених ролей.

    Повинен застосовуватись ПІСЛЯ @auth_required (потребує g.current_user).
    Приклад: @role_required('admin') — доступ лише для ролі 'admin'.
    """
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

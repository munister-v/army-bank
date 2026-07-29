"""Маршрути автентифікації — реєстрація, вхід, вихід, сесії, пароль.

Усі кінцеві точки знаходяться за префіксом /api/auth.
Захист від перебору: rate_limit декоратор з різними ключами для входу
(IP + identity) та реєстрації (тільки IP), щоб зловмисник не міг
підбирати пароль або масово реєструвати акаунти.
"""
from __future__ import annotations

import secrets

from flask import Blueprint, jsonify, request, g

# Ліміти з конфіга: скільки запитів за вікно, ширина вікна в секундах
from ..config import AUTH_LOGIN_RATE_LIMIT, AUTH_RATE_WINDOW_SECONDS, AUTH_REGISTER_RATE_LIMIT
from ..config import TOKEN_TTL_HOURS
from ..services.auth_service import AuthService          # вся бізнес-логіка автентифікації
from .helpers import api_error, auth_required, rate_limit  # спільні декоратори та утиліти

# Blueprint реєструє всі маршрути цього модуля під /api/auth
auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')
auth_service = AuthService()   # singleton-сервіс, безпечний для спільного використання у Flask

AUTH_COOKIE_SECURE = '__Host-arm_session'
AUTH_COOKIE_LOCAL = 'arm_session'
CSRF_COOKIE = 'arm_csrf'


def _is_secure_request() -> bool:
    return (request.headers.get('X-Forwarded-Proto') or request.scheme).split(',')[0].strip() == 'https'


def _client_context() -> dict:
    return {
        'ip_address': _auth_client_ip(),
        'user_agent': (request.headers.get('User-Agent') or '')[:500],
    }


def set_auth_cookies(response, token: str, remember: bool = True):
    """Create an HttpOnly browser session and a double-submit CSRF token."""
    secure = _is_secure_request()
    cookie_name = AUTH_COOKIE_SECURE if secure else AUTH_COOKIE_LOCAL
    max_age = TOKEN_TTL_HOURS * 3600 if remember else None
    response.set_cookie(
        cookie_name, token, max_age=max_age, secure=secure, httponly=True,
        samesite='Lax', path='/',
    )
    response.set_cookie(
        CSRF_COOKIE, secrets.token_urlsafe(32), max_age=max_age, secure=secure,
        httponly=False, samesite='Lax', path='/',
    )
    return response


def clear_auth_cookies(response):
    for name in (AUTH_COOKIE_SECURE, AUTH_COOKIE_LOCAL, CSRF_COOKIE):
        response.delete_cookie(name, path='/', secure=name.startswith('__Host-'), samesite='Lax')
    return response


def _browser_auth_response(payload: dict, *, remember: bool, use_cookie: bool):
    token = payload.get('token', '')
    public_payload = dict(payload)
    if use_cookie:
        public_payload.pop('token', None)
        public_payload['cookie_auth'] = True
    response = jsonify({'ok': True, 'data': public_payload})
    return set_auth_cookies(response, token, remember)


# ── Допоміжні функції для rate-limiting ─────────────────────────────────────

def _auth_client_ip() -> str:
    """Повертає реальний IP клієнта навіть за реверс-проксі (nginx).

    X-Forwarded-For може містити ланцюжок IP через коми (клієнт, проміжні проксі),
    беремо лише перший — це і є оригінальний клієнт. Обрізаємо до 80 символів,
    щоб захиститись від навмисно довгого заголовку.
    """
    xff = (request.headers.get('X-Forwarded-For') or '').strip()
    if xff:
        return xff.split(',')[0].strip()[:80]   # беремо крайній лівий IP зі списку
    return (request.remote_addr or 'unknown')[:80]  # прямий IP без проксі


def _login_rate_key() -> str:
    """Ключ обмеження для входу: IP + identity (телефон або email).

    Комбінований ключ дозволяє блокувати і атаку на конкретний акаунт з одного IP,
    і спред-атаку (багато різних акаунтів з одного IP блокується по IP-частині).
    """
    data = request.get_json(silent=True) or {}
    identity = (data.get('identity') or '').strip().lower()[:80]   # нормалізуємо до нижнього регістру
    return f'auth:login:{_auth_client_ip()}:{identity}'             # namespace:action:ip:identity


def _register_rate_key() -> str:
    """Ключ обмеження для реєстрації: лише IP (identity ще не відома)."""
    return f'auth:register:{_auth_client_ip()}'


# ── Реєстрація нового користувача ───────────────────────────────────────────

@auth_bp.post('/register')
@rate_limit(AUTH_REGISTER_RATE_LIMIT, AUTH_RATE_WINDOW_SECONDS, key_func=_register_rate_key)
def register():
    """POST /api/auth/register — створити новий акаунт.

    Вся валідація і хешування пароля — в auth_service.register().
    При перевищенні ліміту rate_limit поверне 429 автоматично.
    """
    try:
        data = request.get_json(force=True)
        payload = auth_service.register(data, client_info=_client_context())
        return _browser_auth_response(
            payload,
            remember=bool(data.get('remember', True)),
            use_cookie=bool(data.get('use_cookie', False)),
        )
    except Exception as exc:
        return api_error(str(exc))   # перетворює виняток на {ok: false, error: "..."} + HTTP 400


# ── Вхід (логін) ─────────────────────────────────────────────────────────────

@auth_bp.post('/login')
@rate_limit(AUTH_LOGIN_RATE_LIMIT, AUTH_RATE_WINDOW_SECONDS, key_func=_login_rate_key)
def login():
    """POST /api/auth/login — автентифікація, повертає session token.

    Помилки автентифікації повертаємо з кодом 401 (Unauthorized), а не 400,
    щоб клієнт міг розрізнити «неправильний пароль» і «некоректний запит».
    """
    try:
        data = request.get_json(force=True)
        payload = auth_service.login(data, client_info=_client_context())
        return _browser_auth_response(
            payload,
            remember=bool(data.get('remember', True)),
            use_cookie=bool(data.get('use_cookie', False)),
        )
    except Exception as exc:
        return api_error(str(exc), 401)   # 401 = невірні облікові дані


# ── Вихід (logout) ───────────────────────────────────────────────────────────

@auth_bp.post('/logout')
@auth_required   # декоратор перевіряє Bearer-токен і кладе user у g.current_user
def logout():
    """POST /api/auth/logout — знищити поточну сесію.

    Токен сесії береться із g.current_token (встановлюється декоратором auth_required).
    Після видалення сесії повторний запит з тим самим токеном дасть 401.
    """
    try:
        auth_service.logout(g.current_token)   # видаляємо рядок з таблиці sessions
        return clear_auth_cookies(jsonify({'ok': True, 'message': 'Сесію завершено.'}))
    except Exception as exc:
        return api_error(str(exc))


# ── Профіль поточного користувача ────────────────────────────────────────────

@auth_bp.get('/me')
@auth_required
def me():
    """GET /api/auth/me — дані поточного авторизованого користувача.

    Також ав-to-creates банківський рахунок, якщо він ще не існує
    (потрібно для нових солдатів, зареєстрованих через Telegram-бота).
    """
    try:
        user = g.current_user   # об'єкт вже прочитаний декоратором auth_required
        # ensure_user_bank_account повертає (account, auto_created) —
        # auto_created=True значить рахунок щойно створено автоматично
        account, auto_created = auth_service.ensure_user_bank_account(user['id'])
        return jsonify({'ok': True, 'data': {
            'id':               user['id'],
            'full_name':        user['full_name'],
            'phone':            user['phone'],
            'email':            user['email'],
            'role':             user['role'],
            'crm_owner':         user.get('crm_owner'),
            'military_status':  user['military_status'],   # soldier/veteran/contractor
            'bank_account_linked':  bool(account),         # True якщо рахунок існує
            'bank_account_number':  account.get('account_number') if account else None,
            # банківський рахунок створено автоматично — попереджаємо UI
            'bank_notice': 'Банківський рахунок створено автоматично для синхронізації з месенджером.' if auto_created else None,
        }})
    except Exception as exc:
        return api_error(str(exc))


@auth_bp.post('/browser-session')
@auth_required
def create_browser_session():
    """Migrate an existing Bearer session into an HttpOnly browser cookie."""
    data = request.get_json(silent=True) or {}
    response = jsonify({'ok': True, 'data': {'cookie_auth': True}})
    return set_auth_cookies(response, g.current_token, bool(data.get('remember', True)))


# ── Управління сесіями (список активних, відкликання) ────────────────────────

@auth_bp.get('/sessions')
@auth_required
def list_sessions():
    """GET /api/auth/sessions — список активних сесій поточного користувача.

    Корисно для UI «Де я авторизований» — показати пристрої/браузери з датою.
    Поточний токен передається, щоб позначити «активну» сесію в списку.
    """
    try:
        data = auth_service.list_sessions(g.current_user['id'], g.current_token)
        return jsonify({'ok': True, 'data': data})
    except Exception as exc:
        return api_error(str(exc))


@auth_bp.delete('/sessions/<int:session_id>')
@auth_required
def revoke_session(session_id: int):
    """DELETE /api/auth/sessions/{id} — відкликати конкретну сесію (вихід на іншому пристрої).

    Користувач може відкликати лише свої сесії — перевірка user_id відбувається
    всередині auth_service.revoke_session. Якщо сесія чужа або не знайдена — 404.
    """
    try:
        auth_service.revoke_session(session_id, g.current_user['id'])
        return jsonify({'ok': True})
    except Exception as exc:
        return api_error(str(exc), 404)   # 404: сесія не знайдена або чужа


@auth_bp.delete('/sessions')
@auth_required
def revoke_other_sessions():
    """DELETE /api/auth/sessions - keep this device, sign out everywhere else."""
    try:
        revoked = auth_service.revoke_other_sessions(g.current_user['id'], g.current_token)
        return jsonify({'ok': True, 'data': {'revoked': revoked}})
    except Exception as exc:
        return api_error(str(exc))


# ── Зміна пароля ─────────────────────────────────────────────────────────────

@auth_bp.put('/password')
@auth_required
def change_password():
    """PUT /api/auth/password — змінити пароль поточного користувача.

    Body: { old_password, new_password }
    Перевірка старого пароля захищає від зміни пароля при викраденні токена:
    зловмисник без знання старого пароля не зможе заблокувати справжнього власника.
    """
    try:
        data = request.get_json(force=True)
        old_password = (data.get('old_password') or '').strip()
        new_password = (data.get('new_password') or '').strip()
        if not old_password or not new_password:
            # обидва поля обов'язкові — відмовляємо до виклику сервісу
            return api_error('Потрібно вказати поточний та новий пароль.')
        auth_service.change_password(g.current_user['id'], old_password, new_password)
        return jsonify({'ok': True, 'message': 'Пароль успішно змінено.'})
    except Exception as exc:
        return api_error(str(exc))

@auth_bp.get('/managers')
@auth_required
def get_managers():
    """GET /api/auth/managers — список активних менеджерів (crm_owner)."""
    try:
        from backend.database import get_connection
        with get_connection() as conn:
            rows = conn.execute("SELECT id, full_name, crm_owner FROM users WHERE role = 'manager' AND crm_owner IS NOT NULL").fetchall()
            managers = [{'id': r['id'], 'full_name': r['full_name'], 'crm_owner': r['crm_owner']} for r in rows]
            return jsonify({'ok': True, 'data': managers})
    except Exception as exc:
        return api_error(str(exc))

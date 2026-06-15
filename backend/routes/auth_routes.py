"""Маршрути автентифікації — реєстрація, вхід, вихід, сесії, пароль.

Усі кінцеві точки знаходяться за префіксом /api/auth.
Захист від перебору: rate_limit декоратор з різними ключами для входу
(IP + identity) та реєстрації (тільки IP), щоб зловмисник не міг
підбирати пароль або масово реєструвати акаунти.
"""
from __future__ import annotations

from flask import Blueprint, jsonify, request, g

# Ліміти з конфіга: скільки запитів за вікно, ширина вікна в секундах
from ..config import AUTH_LOGIN_RATE_LIMIT, AUTH_RATE_WINDOW_SECONDS, AUTH_REGISTER_RATE_LIMIT
from ..services.auth_service import AuthService          # вся бізнес-логіка автентифікації
from .helpers import api_error, auth_required, rate_limit  # спільні декоратори та утиліти

# Blueprint реєструє всі маршрути цього модуля під /api/auth
auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')
auth_service = AuthService()   # singleton-сервіс, безпечний для спільного використання у Flask


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
        payload = auth_service.register(request.get_json(force=True))  # force=True: завжди парсить тіло як JSON
        return jsonify({'ok': True, 'data': payload})
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
        payload = auth_service.login(request.get_json(force=True))
        return jsonify({'ok': True, 'data': payload})
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
        return jsonify({'ok': True, 'message': 'Сесію завершено.'})
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
            'military_status':  user['military_status'],   # soldier/veteran/contractor
            'bank_account_linked':  bool(account),         # True якщо рахунок існує
            'bank_account_number':  account.get('account_number') if account else None,
            # банківський рахунок створено автоматично — попереджаємо UI
            'bank_notice': 'Банківський рахунок створено автоматично для синхронізації з месенджером.' if auto_created else None,
        }})
    except Exception as exc:
        return api_error(str(exc))


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

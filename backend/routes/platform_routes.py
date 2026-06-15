"""Маршрути для ролі platform_admin: огляд системи і генерація демо-даних.

platform_admin — найвищий рівень доступу. Може бачити всі рахунки,
всі транзакції і аудит-логи. Може також сіяти демо-дані (тільки якщо
ALLOW_PLATFORM_DEMO_SEED=True в конфізі — на прод завжди False).

Усі ендпоінти закриті @role_required('platform_admin') — будь-яка
менш привілейована роль отримає 403.
"""
from __future__ import annotations

from flask import Blueprint, jsonify, request, g, current_app

from ..repositories.platform_repository import PlatformRepository  # SQL-запити до всіх рахунків/транзакцій
from ..services.platform_service import seed_demo                  # генератор демо-даних
from .helpers import api_error, auth_required, role_required       # декоратори безпеки

platform_bp = Blueprint('platform', __name__, url_prefix='/api/platform')
platform_repo = PlatformRepository()   # репозиторій з cross-account SQL (тільки для platform_admin)


# ── Загальна статистика платформи ─────────────────────────────────────────────

@platform_bp.get('/overview')
@auth_required
@role_required('platform_admin')   # відмова з 403 для будь-якої іншої ролі
def get_overview():
    """GET /api/platform/overview — агрегована статистика по всій платформі.

    Повертає: кількість користувачів, загальний баланс, кількість транзакцій
    за сьогодні/тиждень/місяць та інші KPI. Ці дані доступні лише platform_admin,
    бо розкривають масштаби всієї фінансової активності системи.
    """
    try:
        stats = platform_repo.get_overview_stats()
        return jsonify({'ok': True, 'data': stats})
    except Exception as exc:
        return api_error(str(exc))


# ── Список усіх користувачів з балансами ─────────────────────────────────────

@platform_bp.get('/users')
@auth_required
@role_required('platform_admin')
def list_platform_users():
    """GET /api/platform/users — всі користувачі з поточними балансами.

    Query params:
      limit  (int, max 500, default 500) — сторінка
      offset (int, default 0)            — зміщення для пагінації

    Обмеження limit≤500 захищає від завантаження мільйонів рядків
    в одному запиті. При масштабуванні варто додати cursor-based pagination.
    """
    try:
        limit  = min(request.args.get('limit',  default=500, type=int), 500)  # жорстка стеля 500
        offset = request.args.get('offset', default=0, type=int)
        users  = platform_repo.list_all_users_with_balance(limit=limit, offset=offset)
        return jsonify({'ok': True, 'data': users})
    except Exception as exc:
        return api_error(str(exc))


# ── Усі транзакції по платформі ──────────────────────────────────────────────

@platform_bp.get('/transactions')
@auth_required
@role_required('platform_admin')
def list_platform_transactions():
    """GET /api/platform/transactions — транзакції по всіх рахунках.

    Query params:
      limit   (int, max 500, default 200) — кількість записів
      offset  (int, default 0)            — зміщення
      tx_type (str, optional)             — фільтр по типу (topup/transfer/payout…)

    Ці дані дозволяють platform_admin відстежувати підозрілу активність
    або перевіряти фінансову звітність по всій системі.
    """
    try:
        limit   = min(request.args.get('limit',  default=200, type=int), 500)  # дефолт менший ніж у /users
        offset  = request.args.get('offset', default=0, type=int)
        tx_type = request.args.get('tx_type')   # None якщо не передано — сервіс ігноруватиме фільтр
        rows    = platform_repo.list_all_transactions(limit=limit, offset=offset, tx_type=tx_type)
        return jsonify({'ok': True, 'data': rows})
    except Exception as exc:
        return api_error(str(exc))


# ── Аудит-логи платформи ──────────────────────────────────────────────────────

@platform_bp.get('/audit-logs')
@auth_required
@role_required('platform_admin')
def list_platform_audit_logs():
    """GET /api/platform/audit-logs — останні аудит-події по платформі.

    Query params:
      limit (int, max 500, default 100)

    Аудит-логи фіксують всі чутливі дії: зміну ролей, нарахування виплат,
    примусове закриття рахунків тощо. Читання логів — лише читання, не зміна.
    """
    try:
        limit = min(request.args.get('limit', default=100, type=int), 500)
        logs  = platform_repo.list_recent_audit_logs(limit=limit)
        return jsonify({'ok': True, 'data': logs})
    except Exception as exc:
        return api_error(str(exc))


# ── Генерація демо-даних (тільки на dev/staging) ─────────────────────────────

@platform_bp.post('/seed-demo')
@auth_required
@role_required('platform_admin')
def post_seed_demo():
    """POST /api/platform/seed-demo — наповнити БД тестовими даними.

    Body:
      users_count           (int, max 50, default 10)
      transactions_per_user (int, max 50, default 15)

    Флаг ALLOW_PLATFORM_DEMO_SEED перевіряємо через current_app.config —
    так конфіг передається через Flask-app context і не може бути підроблений
    через environment-inject під час запиту. На PROD цей флаг завжди False,
    тому ендпоінт вертає 403 і нічого не робить.
    """
    if not bool(current_app.config.get('ALLOW_PLATFORM_DEMO_SEED', False)):
        # Захист: навіть platform_admin не може сіяти дані на продакшні
        return api_error('Генерація демо-даних вимкнена на цьому середовищі.', 403)
    try:
        data                  = request.get_json(force=True) or {}
        users_count           = min(int(data.get('users_count',           10)), 50)  # стеля 50 юзерів
        transactions_per_user = min(int(data.get('transactions_per_user', 15)), 50)  # стеля 50 транзакцій
        result = seed_demo(users_count=users_count, transactions_per_user=transactions_per_user)
        return jsonify({'ok': True, 'data': result})
    except (ValueError, TypeError) as exc:
        return api_error(str(exc))   # некоректні типи параметрів (рядок замість числа тощо)

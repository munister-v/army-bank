"""Deposit routes — банківські строкові депозити.

Депозит — це заморожена сума на фіксований термін (term_months) з нарахуванням
відсотків по закінченні. Дострокове закриття (early=True) може спричинити
штраф (залежить від deposit_service). Наприкінці строку — auto_renew
автоматично продовжує депозит на той самий термін.

Звичайний користувач: list/create/get/close власних депозитів.
Адмін/оператор: admin_list_deposits, admin_close_deposit, admin_mature_deposits.
"""
from __future__ import annotations

from flask import Blueprint, jsonify, request, g

from ..services.deposit_service import DepositService  # вся бізнес-логіка строкових депозитів
from .helpers import api_error, auth_required          # авторизація і форматування помилок

deposit_bp = Blueprint('deposits', __name__, url_prefix='/api')
_svc = DepositService()   # stateless singleton


# ── Звичайний користувач ──────────────────────────────────────────────────────

@deposit_bp.get('/deposits')
@auth_required
def list_deposits():
    """GET /api/deposits — список депозитів поточного користувача.

    Повертає всі депозити (активні і закриті) для відображення в UI.
    """
    try:
        return jsonify({'ok': True, 'data': _svc.list_deposits(g.current_user['id'])})
    except Exception as exc:
        return api_error(str(exc))


@deposit_bp.post('/deposits')
@auth_required
def create_deposit():
    """POST /api/deposits — відкрити новий строковий депозит.

    Body:
      amount       (float)  — сума, яку заморожуємо (списується з рахунку)
      term_months  (int)    — термін у місяцях (1, 3, 6, 12 тощо)
      auto_renew   (bool)   — автоматично продовжувати після закінчення строку
      description  (str)    — довільна мітка (необов'язково)

    Повертає 201 Created з об'єктом новоствореного депозиту.
    """
    try:
        data         = request.get_json(force=True) or {}
        amount       = float(data.get('amount')      or 0)      # 0 -> сервіс відхилить як некоректне
        term_months  = int(data.get('term_months')   or 0)      # 0 -> сервіс відхилить
        auto_renew   = bool(data.get('auto_renew', False))      # дефолт: не продовжувати
        description  = str(data.get('description')   or '').strip()
        dep = _svc.create_deposit(
            g.current_user['id'], amount, term_months,
            auto_renew=auto_renew, description=description,
        )
        return jsonify({'ok': True, 'data': dep}), 201   # 201: ресурс створено
    except Exception as exc:
        return api_error(str(exc))


@deposit_bp.get('/deposits/<int:deposit_id>')
@auth_required
def get_deposit(deposit_id: int):
    """GET /api/deposits/{id} — деталі конкретного депозиту.

    Сервіс перевіряє, що депозит належить поточному користувачу;
    якщо ні — підніме виняток і повернемо 404.
    """
    try:
        return jsonify({'ok': True, 'data': _svc.get_deposit(deposit_id, g.current_user['id'])})
    except Exception as exc:
        return api_error(str(exc), 404)   # 404: не знайдено або чужий


@deposit_bp.post('/deposits/<int:deposit_id>/close')
@auth_required
def close_deposit(deposit_id: int):
    """POST /api/deposits/{id}/close — закрити депозит і повернути кошти на рахунок.

    Body:
      early (bool) — True = дострокове закриття (може бути штраф по відсотках)

    Сума + нараховані відсотки (або сума - штраф при достроковому закритті)
    повертаються на головний рахунок користувача.
    """
    try:
        data   = request.get_json(force=True) or {}
        early  = bool(data.get('early', False))   # дефолт: закриття по закінченні строку
        result = _svc.close_deposit(deposit_id, g.current_user['id'], early=early)
        return jsonify({'ok': True, 'data': result})
    except Exception as exc:
        return api_error(str(exc))


# ── Адмін-панель депозитів ────────────────────────────────────────────────────

@deposit_bp.get('/admin/deposits')
@auth_required
def admin_list_deposits():
    """GET /api/admin/deposits — всі депозити платформи (тільки для адмінів/операторів).

    Query params:
      status (str, optional) — фільтр: 'active'|'closed'|'matured'
      limit  (int, max 500)  — кількість записів

    Доступ: admin, platform_admin, operator.
    Перевіряємо роль вручну (не декоратором), бо три ролі мають доступ.
    """
    try:
        if g.current_user.get('role') not in ('admin', 'platform_admin', 'operator'):
            return api_error('Forbidden', 403)   # захист: лише привілейовані ролі
        status = request.args.get('status') or None   # None = всі статуси
        limit  = min(int(request.args.get('limit', 100)), 500)   # стеля 500 записів
        return jsonify({'ok': True, 'data': _svc.admin_list_deposits(status, limit)})
    except Exception as exc:
        return api_error(str(exc))


@deposit_bp.post('/admin/deposits/<int:deposit_id>/close')
@auth_required
def admin_close_deposit(deposit_id: int):
    """POST /api/admin/deposits/{id}/close — адмін примусово закриває будь-який депозит.

    Використовується при вирішенні суперечок або блокуванні підозрілих коштів.
    Доступ: тільки admin або platform_admin (оператор не може).
    """
    try:
        if g.current_user.get('role') not in ('admin', 'platform_admin'):
            return api_error('Forbidden', 403)
        # Знаходимо депозит через admin_list щоб отримати user_id для сервісу
        deps = _svc.admin_list_deposits()
        dep  = next((d for d in deps if d['id'] == deposit_id), None)
        if not dep:
            return api_error('Депозит не знайдено.', 404)
        # Закриваємо від імені власника депозиту (user_id з знайденого рядка)
        result = _svc.close_deposit(deposit_id, dep['user_id'])
        return jsonify({'ok': True, 'data': result})
    except Exception as exc:
        return api_error(str(exc))


@deposit_bp.post('/admin/deposits/mature')
@auth_required
def admin_mature_deposits():
    """POST /api/admin/deposits/mature — EOD-задача: нарахування по депозитах, термін яких завершився.

    End-of-Day (EOD) задача: перевіряє всі депозити з expired_at <= now()
    і нараховує відсотки, а при auto_renew=True — продовжує на новий строк.
    Зазвичай викликається планувальником раз на добу (cron або APScheduler).
    Доступ: тільки admin або platform_admin.
    """
    try:
        if g.current_user.get('role') not in ('admin', 'platform_admin'):
            return api_error('Forbidden', 403)
        return jsonify({'ok': True, 'data': _svc.admin_mature_deposits()})
    except Exception as exc:
        return api_error(str(exc))

"""Маршрути управління картками Army Bank.

Картки прив'язані до банківського рахунку користувача. Підтримуються
типи: virtual (одразу готова) та physical (потребує доставки). Дизайни:
gold, black, camo тощо. Одна картка може бути «primary» — її баланс
=  балансу рахунку (решта — підкартки з окремим лімітом).

Усі маршрути потребують авторизації (@auth_required).
"""
from __future__ import annotations

from flask import Blueprint, jsonify, request, g

from ..services.card_service import CardService   # сервіс з усіма операціями над картками
from .helpers import api_error, auth_required     # декоратор авторизації та утиліта помилок

# url_prefix='/api' — картки є частиною загального API, не окремого підпростору
card_bp = Blueprint('cards', __name__, url_prefix='/api')
service = CardService()   # singleton-сервіс, безпечний для всіх Flask-потоків


# ── Список карток ─────────────────────────────────────────────────────────────

@card_bp.get('/cards')
@auth_required
def list_cards():
    """GET /api/cards — список усіх карток поточного користувача.

    Повертає масив карток з номером (маскованим), статусом, балансом і дизайном.
    Сервіс сам обмежує вибірку рахунком поточного користувача (не можна побачити чужі).
    """
    try:
        return jsonify({'ok': True, 'data': service.list_cards(g.current_user['id'])})
    except Exception as exc:
        return api_error(str(exc))


# ── Випуск нової картки ────────────────────────────────────────────────────────

@card_bp.post('/cards')
@auth_required
def issue_card():
    """POST /api/cards — випустити нову картку.

    Body: { card_type?: 'virtual'|'physical', design?: 'gold'|'black'|... }
    Defaults: card_type='virtual', design='gold'.
    Повертає 201 Created з даними нової картки (номер, CVV — зашифровані в БД).
    """
    try:
        data = request.get_json(force=True) or {}
        card_type = (data.get('card_type') or 'virtual').strip()   # дефолт: віртуальна
        design    = (data.get('design')    or 'gold'   ).strip()   # дефолт: золота
        return jsonify({'ok': True, 'data': service.issue_card(g.current_user['id'], card_type, design)}), 201
    except Exception as exc:
        return api_error(str(exc))


# ── Розкриття повних реквізитів картки ───────────────────────────────────────

@card_bp.get('/cards/<int:card_id>/reveal')
@auth_required
def reveal_card(card_id: int):
    """GET /api/cards/{id}/reveal — повний номер і CVV для flip-анімації в UI.

    Сервіс перевіряє, що картка належить поточному користувачу; якщо ні — 403.
    CVV зберігається зашифрованим і розшифровується тут лише для показу власнику.
    Цей ендпоінт не кешується клієнтом (реквізити не мають зберігатися в кеші браузера).
    """
    try:
        return jsonify({'ok': True, 'data': service.reveal_card(g.current_user['id'], card_id)})
    except Exception as exc:
        return api_error(str(exc))


# ── Блокування / розблокування картки ────────────────────────────────────────

@card_bp.patch('/cards/<int:card_id>/block')
@auth_required
def block_card(card_id: int):
    """PATCH /api/cards/{id}/block — перемикач: заблокувати↔розблокувати картку.

    Заблокована картка не може виконувати транзакції. Сервіс перевертає
    поле is_blocked і повертає новий стан картки. Сама назва /block
    є перемикачем (toggle), а не однобічною дією.
    """
    try:
        return jsonify({'ok': True, 'data': service.block_card(g.current_user['id'], card_id)})
    except Exception as exc:
        return api_error(str(exc))


# ── Закриття картки ───────────────────────────────────────────────────────────

@card_bp.patch('/cards/<int:card_id>/close')
@auth_required
def close_card(card_id: int):
    """PATCH /api/cards/{id}/close — назавжди закрити картку.

    Закрита картка залишається в БД (для аудиту), але більше не активна.
    Дія незворотна на відміну від блокування.
    """
    try:
        return jsonify({'ok': True, 'data': service.close_card(g.current_user['id'], card_id)})
    except Exception as exc:
        return api_error(str(exc))


# ── Зміна дизайну картки ──────────────────────────────────────────────────────

@card_bp.patch('/cards/<int:card_id>/design')
@auth_required
def update_card_design(card_id: int):
    """PATCH /api/cards/{id}/design — змінити візуальний дизайн картки.

    Body: { design: 'gold'|'black'|'camo'|... }
    Лише косметична зміна — реквізити і баланс не змінюються.
    """
    try:
        data   = request.get_json(force=True) or {}
        design = (data.get('design') or '').strip()   # порожній рядок -> сервіс поверне помилку
        return jsonify({'ok': True, 'data': service.update_design(g.current_user['id'], card_id, design)})
    except Exception as exc:
        return api_error(str(exc))


# ── Встановлення основної (primary) картки ────────────────────────────────────

@card_bp.patch('/cards/<int:card_id>/set_primary')
@auth_required
def set_primary_card(card_id: int):
    """PATCH /api/cards/{id}/set_primary — зробити картку головною.

    Головна картка відображає повний баланс рахунку. Попередня primary
    автоматично стає «додатковою». Тільки одна картка може бути primary.
    """
    try:
        return jsonify({'ok': True, 'data': service.set_primary_card(g.current_user['id'], card_id)})
    except Exception as exc:
        return api_error(str(exc))


# ── Поповнення картки з рахунку ───────────────────────────────────────────────

@card_bp.post('/cards/<int:card_id>/topup')
@auth_required
def topup_card(card_id: int):
    """POST /api/cards/{id}/topup — перенести кошти з рахунку на картку.

    Body: { amount: float }
    Внутрішня операція: списує з балансу рахунку, зараховує на картку.
    Не плутати з поповненням рахунку ззовні (POST /api/transactions/topup).
    ValueError/TypeError ловимо окремо — некоректний amount (рядок замість числа).
    """
    try:
        data   = request.get_json(force=True) or {}
        amount = float(data.get('amount') or 0)   # 0 -> сервіс відхилить як "сума <= 0"
        return jsonify({'ok': True, 'data': service.topup_card(g.current_user['id'], card_id, amount)})
    except (ValueError, TypeError) as exc:
        return api_error(str(exc))   # некоректний тип amount
    except Exception as exc:
        return api_error(str(exc))   # інші помилки (картка не знайдена, недостатньо коштів)

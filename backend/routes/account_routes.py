"""Маршрути рахунків та транзакцій.

Ключові ендпоінти:
  GET  /api/dashboard               — batch-завантаження всіх даних для PWA
  GET  /api/accounts/main           — основний рахунок
  POST /api/transactions/topup      — поповнення рахунку
  POST /api/transactions/transfer   — переказ по номеру рахунку (вимагає 3DS)
  POST /api/transactions/transfer-by-card — переказ по номеру картки (вимагає 3DS)
  GET  /api/transactions/history    — фільтрована історія транзакцій
  GET  /api/transactions/statement  — PDF-виписка
  GET  /api/transactions/export     — CSV-виписка
  GET  /api/analytics/*             — аналітика витрат

Грошові операції (topup, transfer) захищені:
  - rate_limit: не більше N операцій за вікно (захист від flood)
  - idempotency: той самий запит не виконується двічі
  - 3DS: переказ можливий лише після OTP-підтвердження
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from urllib.parse import quote   # для RFC 5987-кодування імені файлу у Content-Disposition

from flask import Blueprint, Response, jsonify, request, g

from ..config import CRITICAL_MONEY_RATE_LIMIT, CRITICAL_RATE_LIMIT_WINDOW_SECONDS
from ..services.account_service import AccountService      # основний фінансовий сервіс
from ..services.card_service import CardService            # для пошуку рахунку за номером картки
from ..services.feature_service import FeatureService      # виплати, цілі, контакти, шаблони
from ..services.idempotency_service import IdempotencyService  # захист від подвійних операцій
from ..services.three_ds_service import ThreeDSService     # споживання 3DS session_token
from .helpers import (
    api_error,                # { ok: false, error: "..." } + HTTP 4xx
    auth_required,            # перевіряє Bearer-токен, кладе user у g
    actor_rate_key,           # ключ rate-limit по user_id (захист від flood з одного акаунта)
    rate_limit,               # декоратор обмеження кількості запитів
    require_idempotency_key,  # витягує ключ з X-Idempotency-Key або body
)

account_bp = Blueprint('account', __name__, url_prefix='/api')
service             = AccountService()
card_service        = CardService()
feature_service     = FeatureService()
idempotency_service = IdempotencyService()
three_ds_service    = ThreeDSService()


def _to_json_safe(value):
    """Рекурсивно конвертує типи БД у JSON-сумісні примітиви.

    PostgreSQL повертає Decimal для числових полів і datetime-об'єкти для дат.
    json.dumps не вміє серіалізувати їх без конвертації.
    """
    if isinstance(value, Decimal):
        return float(value)                          # Decimal(9.99) -> 9.99
    if isinstance(value, (datetime, date)):
        return value.isoformat()                     # datetime -> "2024-01-15T12:00:00"
    if isinstance(value, dict):
        return {k: _to_json_safe(v) for k, v in value.items()}   # рекурсія по словнику
    if isinstance(value, list):
        return [_to_json_safe(v) for v in value]    # рекурсія по списку
    return value                                     # int, str, bool, None — залишаємо як є


# ── Дашборд (batch endpoint) ──────────────────────────────────────────────────

@account_bp.get('/dashboard')
@auth_required
def dashboard():
    """GET /api/dashboard — усі дані для PWA-дашборду в одному запиті.

    Замінює 7 окремих паралельних запитів одним round-trip-ом.
    На Render free tier (холодний старт + обмежений пул з'єднань) це дає
    ~500 мс економії на першому рендері.

    Повертає: профіль, рахунок, транзакції, виплати, донації, цілі,
    контакти та шаблони платежів.
    """
    try:
        user_id = g.current_user['id']
        user    = g.current_user   # об'єкт уже завантажений декоратором auth_required

        # Усі запити до БД виконуються послідовно в одному HTTP-запиті,
        # але кожен використовує з'єднання з пулу — без холодного підключення.
        account      = service.get_main_account(user_id)
        transactions = service.list_transactions(user_id)
        payouts      = feature_service.list_payouts(user_id)
        donations    = feature_service.list_donations(user_id)
        goals        = feature_service.list_goals(user_id)
        contacts     = feature_service.list_contacts(user_id)
        templates    = feature_service.list_payment_templates(user_id)

        return jsonify({'ok': True, 'data': {
            'user': {
                'id':              user['id'],
                'full_name':       user['full_name'],
                'phone':           user['phone'],
                'email':           user['email'],
                'role':            user['role'],
                'military_status': user.get('military_status'),   # soldier/veteran/contractor
            },
            'account':      account,
            'transactions': transactions,
            'payouts':      payouts,
            'donations':    donations,
            'goals':        goals,
            'contacts':     contacts,
            'templates':    templates,
        }})
    except Exception as exc:
        return api_error(str(exc))


# ── Основний рахунок ──────────────────────────────────────────────────────────

@account_bp.get('/accounts/main')
@auth_required
def main_account():
    """GET /api/accounts/main — дані основного рахунку (баланс, номер рахунку тощо)."""
    try:
        return jsonify({'ok': True, 'data': service.get_main_account(g.current_user['id'])})
    except Exception as exc:
        return api_error(str(exc), 404)   # 404: рахунок ще не створено (новий юзер)


# ── Поповнення рахунку ────────────────────────────────────────────────────────

@account_bp.post('/transactions/topup')
@auth_required
@rate_limit(
    CRITICAL_MONEY_RATE_LIMIT,
    CRITICAL_RATE_LIMIT_WINDOW_SECONDS,
    key_func=lambda: actor_rate_key('money:topup'),   # окремий лічильник для кожного акаунта
)
def topup():
    """POST /api/transactions/topup — поповнити власний рахунок.

    Body:
      amount          (float) — сума поповнення
      description     (str)   — призначення (опціонально)
      idempotency_key (str)   — ключ ідемпотентності

    Ідемпотентність: якщо мережа розірвалась після запису, але до відповіді,
    клієнт може повторити запит — гроші зарахуються лише один раз.
    """
    idempotency_key = None
    try:
        data            = request.get_json(force=True) or {}
        idempotency_key, err = require_idempotency_key(payload=data, allow_body_fallback=True)
        if err:
            return err

        amount      = float(data.get('amount') or 0)
        description = (data.get('description') or 'Поповнення рахунку').strip()
        user_id     = int(g.current_user['id'])

        # ── Ідемпотентний резерв ──────────────────────────────────────────────
        if idempotency_key:
            reservation = idempotency_service.reserve(
                user_id=user_id,
                action='topup',
                key=idempotency_key,
                payload={'amount': amount, 'description': description},
            )
            state = reservation.get('state')
            if state == 'conflict':
                return api_error('Idempotency-Key уже використано з іншим payload.', 409)
            if state == 'replay':
                # ідентичний запит вже виконувався — повертаємо кешований результат
                return jsonify(reservation.get('payload') or {'ok': False}), int(reservation.get('response_code') or 200)
            if state == 'processing':
                return api_error('Операція вже виконується. Спробуйте пізніше.', 409)

        # _to_json_safe потрібен: service.topup повертає Decimal з PostgreSQL
        result  = _to_json_safe(service.topup(user_id, amount, description))
        payload = {'ok': True, 'data': result}

        if idempotency_key:
            idempotency_service.complete(
                user_id=user_id,
                action='topup',
                key=idempotency_key,
                response_payload=payload,
                response_code=200,
            )
        return jsonify(payload)

    except Exception as exc:
        if idempotency_key:
            idempotency_service.release_processing(   # знімаємо резерв при помилці
                user_id=int(g.current_user['id']),
                action='topup',
                key=idempotency_key,
            )
        return api_error(str(exc))


# ── Переказ за номером рахунку ────────────────────────────────────────────────

@account_bp.post('/transactions/transfer')
@auth_required
@rate_limit(
    CRITICAL_MONEY_RATE_LIMIT,
    CRITICAL_RATE_LIMIT_WINDOW_SECONDS,
    key_func=lambda: actor_rate_key('money:transfer'),
)
def transfer():
    """POST /api/transactions/transfer — переказ на інший рахунок Army Bank.

    Body:
      amount                 (float) — сума переказу
      recipient_account_number (str) — номер рахунку отримувача
      description            (str)   — призначення (опціонально)
      tds_session            (str)   — session_token з POST /api/3ds/verify
      idempotency_key        (str)   — ключ ідемпотентності

    3DS обов'язковий: переказ без tds_session або з недійсним — отримує 403.
    consume_session() одноразово «спалює» session_token після верифікації —
    повторний переказ з тим самим токеном неможливий.
    """
    try:
        data = request.get_json(force=True) or {}
        idempotency_key, err = require_idempotency_key(payload=data, allow_body_fallback=True)
        if err:
            return err

        amount      = float(data.get('amount') or 0)
        recipient   = (data.get('recipient_account_number') or '').strip()
        description = (data.get('description') or 'Швидкий переказ').strip()
        tds_session = (data.get('tds_session') or '').strip()

        # ── 3DS перевірка (обов'язкова для будь-якого переказу) ──────────────
        if not tds_session:
            # Клієнт має спочатку пройти 3DS-флоу, лише потім надсилати переказ
            return jsonify({'ok': False, 'requires_3ds': True,
                            'error': 'Потрібне підтвердження 3DS.'}), 403
        try:
            # consume_session перевіряє токен і видаляє його — одноразове використання
            three_ds_service.consume_session(int(g.current_user['id']), tds_session)
        except ValueError as e3ds:
            # Прострочений, підроблений або вже використаний session_token
            return jsonify({'ok': False, 'requires_3ds': True,
                            'error': str(e3ds)}), 403

        # ── Виконуємо переказ через сервіс ───────────────────────────────────
        return jsonify({'ok': True, 'data': service.transfer(
            g.current_user['id'], recipient, amount, description,
            idempotency_key=idempotency_key,   # сервіс сам обробляє ідемпотентність
        )})
    except Exception as exc:
        return api_error(str(exc))


# ── Переказ за номером картки ─────────────────────────────────────────────────

@account_bp.post('/transactions/transfer-by-card')
@auth_required
@rate_limit(
    CRITICAL_MONEY_RATE_LIMIT,
    CRITICAL_RATE_LIMIT_WINDOW_SECONDS,
    key_func=lambda: actor_rate_key('money:transfer_by_card'),
)
def transfer_by_card():
    """POST /api/transactions/transfer-by-card — переказ по номеру картки.

    Body:
      amount       (float) — сума
      card_number  (str)   — повний номер картки отримувача
      description  (str)   — призначення
      tds_session  (str)   — одноразовий 3DS-токен
      idempotency_key (str)

    Внутрішньо: резолвить картку -> рахунок через card_service.get_account_by_card(),
    потім виконує стандартний transfer(). Такий підхід дозволяє використовувати
    єдину логіку переказу незалежно від того, по картці чи по рахунку.
    """
    try:
        data = request.get_json(force=True) or {}
        idempotency_key, err = require_idempotency_key(payload=data, allow_body_fallback=True)
        if err:
            return err

        amount      = float(data.get('amount') or 0)
        card_number = (data.get('card_number') or '').strip()
        description = (data.get('description') or 'Переказ по картці').strip()
        tds_session = (data.get('tds_session') or '').strip()

        # ── Обов'язкова 3DS верифікація ───────────────────────────────────────
        if not tds_session:
            return jsonify({'ok': False, 'requires_3ds': True,
                            'error': 'Потрібне підтвердження 3DS.'}), 403
        try:
            three_ds_service.consume_session(int(g.current_user['id']), tds_session)
        except ValueError as e3ds:
            return jsonify({'ok': False, 'requires_3ds': True,
                            'error': str(e3ds)}), 403

        # ── Резолвимо картку -> рахунок, потім стандартний transfer ──────────
        card             = card_service.get_account_by_card(card_number)   # знаходимо рахунок власника картки
        recipient_account = card['account_number']                          # номер рахунку для transfer
        return jsonify({'ok': True, 'data': service.transfer(
            g.current_user['id'], recipient_account, amount, description,
            idempotency_key=idempotency_key,
        )})
    except Exception as exc:
        return api_error(str(exc))


# ── Історія транзакцій з фільтрами ───────────────────────────────────────────

@account_bp.get('/transactions/history')
@auth_required
def history():
    """GET /api/transactions/history — фільтрована історія транзакцій.

    Query params (усі опціональні):
      from_date  (str, ISO date) — початок діапазону
      to_date    (str, ISO date) — кінець діапазону
      tx_type    (str)           — тип: topup/transfer/payout/donation…
      direction  (str)           — 'in' або 'out'
      search     (str)           — пошук по опису/призначенню
      min_amount (float)         — нижній поріг суми
      max_amount (float)         — верхній поріг суми
    """
    try:
        from_date  = request.args.get('from_date')   or None
        to_date    = request.args.get('to_date')     or None
        tx_type    = request.args.get('tx_type')     or None
        direction  = request.args.get('direction')   or None
        search     = request.args.get('search')      or None
        # Числові фільтри: парсимо лише якщо параметр присутній у запиті
        min_amount = float(request.args['min_amount']) if request.args.get('min_amount') else None
        max_amount = float(request.args['max_amount']) if request.args.get('max_amount') else None
        data = service.list_transactions(
            g.current_user['id'],
            from_date=from_date,
            to_date=to_date,
            tx_type=tx_type,
            direction=direction,
            search=search,
            min_amount=min_amount,
            max_amount=max_amount,
        )
        return jsonify({'ok': True, 'data': data})
    except Exception as exc:
        return api_error(str(exc))


# ── Одна транзакція ───────────────────────────────────────────────────────────

@account_bp.get('/transactions/<int:transaction_id>')
@auth_required
def get_transaction(transaction_id: int):
    """GET /api/transactions/{id} — деталі конкретної транзакції.

    Сервіс перевіряє, що транзакція belongs до поточного користувача;
    чужа або неіснуюча повертає 404.
    """
    try:
        tx = service.get_transaction(g.current_user['id'], transaction_id)
        return jsonify({'ok': True, 'data': tx})
    except Exception as exc:
        return api_error(str(exc), 404)


# ── Аналітика ─────────────────────────────────────────────────────────────────

@account_bp.get('/analytics/summary')
@auth_required
def analytics():
    """GET /api/analytics/summary — зведена аналітика (всього отримано/витрачено, по категоріях)."""
    try:
        data = service.get_analytics(g.current_user['id'])
        return jsonify({'ok': True, 'data': data})
    except Exception as exc:
        return api_error(str(exc))


@account_bp.get('/analytics/balance-history')
@auth_required
def balance_history():
    """GET /api/analytics/balance-history — динаміка балансу за N днів.

    Query params:
      days (int, max 90, default 14) — кількість днів в ретроспективі

    Жорстка стеля 90 днів — захист від запиту за «увесь час» (міг би повернути тисячі рядків).
    """
    try:
        days = min(int(request.args.get('days', 14)), 90)   # не більше 90 днів
        data = service.get_balance_history(g.current_user['id'], days=days)
        return jsonify({'ok': True, 'data': data})
    except Exception as exc:
        return api_error(str(exc))


@account_bp.get('/analytics/insights')
@auth_required
def spending_insights():
    """GET /api/analytics/insights — AI-інсайти по витратах (топ категорії, аномалії тощо)."""
    try:
        data = service.get_spending_insights(g.current_user['id'])
        return jsonify({'ok': True, 'data': data})
    except Exception as exc:
        return api_error(str(exc))


# ── Нотатки до транзакцій ─────────────────────────────────────────────────────

@account_bp.patch('/transactions/<int:transaction_id>/note')
@auth_required
def update_note(transaction_id: int):
    """PATCH /api/transactions/{id}/note — додати або оновити нотатку до транзакції.

    Body: { note: str }
    Нотатки зберігаються в полі note таблиці transactions і видимі лише власнику.
    """
    try:
        data = request.get_json(force=True)
        note = (data.get('note') or '').strip()   # порожній рядок = видалити нотатку
        tx   = service.update_transaction_note(g.current_user['id'], transaction_id, note)
        return jsonify({'ok': True, 'data': tx})
    except Exception as exc:
        return api_error(str(exc), 404)


# ── Транзакції з конкретним контактом ────────────────────────────────────────

@account_bp.get('/transactions/with-contact/<string:account_number>')
@auth_required
def transactions_with_contact(account_number: str):
    """GET /api/transactions/with-contact/{account_number} — історія з конкретним контактом.

    Фільтрує транзакції де отримувач або відправник = account_number.
    Корисно для UI «Транзакції з Іваном» (натискання на контакт).
    """
    try:
        data = service.list_transactions_with_contact(g.current_user['id'], account_number)
        return jsonify({'ok': True, 'data': data})
    except Exception as exc:
        return api_error(str(exc))


# ── Досягнення ────────────────────────────────────────────────────────────────

@account_bp.get('/achievements')
@auth_required
def achievements():
    """GET /api/achievements — список розблокованих досягнень користувача (геймификація)."""
    try:
        data = service.get_achievements(g.current_user['id'])
        return jsonify({'ok': True, 'data': data})
    except Exception as exc:
        return api_error(str(exc))


# ── PDF-виписка рахунку ───────────────────────────────────────────────────────

@account_bp.get('/transactions/statement')
@auth_required
def export_statement_pdf():
    """GET /api/transactions/statement — PDF-виписка за рахунком.

    Query params:
      from_date   (str, ISO date) — початок діапазону
      to_date     (str, ISO date) — кінець діапазону
      report_type (str)           — 'detailed' або 'summary'
      order_id    (str)           — прив'язати до замовлення (опціонально)

    StatementService генерує PDF через reportlab або weasyprint.
    Content-Disposition з filename*=UTF-8'' забезпечує коректне відображення
    кирилиці в імені файлу в різних браузерах (RFC 5987).
    Cache-Control: no-store — виписка містить фінансові дані, кешування заборонено.
    """
    try:
        from ..services.statement_service import StatementService   # lazy import (важка залежність)

        from_date   = request.args.get('from_date')   or None
        to_date     = request.args.get('to_date')     or None
        report_type = (request.args.get('report_type') or 'detailed').strip().lower()
        order_id    = (request.args.get('order_id')    or '').strip() or None

        svc = StatementService()
        from_date, to_date = svc.normalize_period(from_date, to_date)   # встановлює дефолтний діапазон якщо None
        pdf_bytes = svc.generate_pdf(
            g.current_user['id'],
            from_date=from_date,
            to_date=to_date,
            report_type=report_type,
            order_id=order_id,
        )
        account = service.get_main_account(g.current_user['id'])
        fname   = svc.build_statement_filename(
            account_number=account.get('account_number') or 'ACCOUNT',
            from_date=from_date,
            to_date=to_date,
            report_type=report_type,
        )
        return Response(
            pdf_bytes,
            mimetype='application/pdf',
            headers={
                # filename*=UTF-8'' — RFC 5987: безпечна кирилиця в Content-Disposition
                'Content-Disposition': f'attachment; filename="{fname}"; filename*=UTF-8\'\'{quote(fname)}',
                'Cache-Control': 'no-store',   # фінансовий документ — заборона кешування
            },
        )
    except Exception as exc:
        return api_error(str(exc))


# ── Замовлення виписки (async-флоу) ──────────────────────────────────────────

@account_bp.post('/transactions/statement/order')
@auth_required
def order_statement_pdf():
    """POST /api/transactions/statement/order — створити замовлення на виписку.

    Асинхронний флоу: клієнт замовляє виписку, отримує order_id і download_url.
    Потім завантажує PDF за download_url (GET /api/transactions/statement?...).
    Зроблено для майбутньої async-генерації великих виписок (фоновий worker).

    Body:
      from_date   (str, ISO date)
      to_date     (str, ISO date)
      report_type (str) — 'detailed'|'summary'

    Повертає: { order_id, download_url, expires_at }
    """
    try:
        from ..services.statement_service import StatementService

        data        = request.get_json(silent=True) or {}   # silent=True: не кидати 400 при відсутності тіла
        from_date   = data.get('from_date')   or None
        to_date     = data.get('to_date')     or None
        report_type = (data.get('report_type') or 'detailed').strip().lower()

        svc   = StatementService()
        order = svc.create_statement_order(
            user_id=g.current_user['id'],
            from_date=from_date,
            to_date=to_date,
            report_type=report_type,
        )
        base  = request.script_root or ''   # враховуємо basePath якщо Flask за nginx-prefix
        order['download_url'] = f"{base}/api/transactions/statement?{order['download_query']}"
        return jsonify({'ok': True, 'data': order})
    except Exception as exc:
        return api_error(str(exc))


@account_bp.get('/transactions/statement/orders')
@auth_required
def list_statement_orders():
    """GET /api/transactions/statement/orders — останні замовлення виписок.

    Query params:
      limit (int, 1..50, default 10) — кількість записів

    Дозволяє UI показати «Мої виписки» з посиланнями на повторне завантаження.
    """
    try:
        from ..services.statement_service import StatementService

        limit = min(max(request.args.get('limit', default=10, type=int), 1), 50)   # обмежуємо 1..50
        rows  = StatementService().list_statement_orders(g.current_user['id'], limit=limit)
        return jsonify({'ok': True, 'data': rows, 'total': len(rows)})
    except Exception as exc:
        return api_error(str(exc))


# ── PDF-чек для однієї транзакції ─────────────────────────────────────────────

@account_bp.get('/transactions/<int:tx_id>/receipt')
@auth_required
def export_receipt_pdf(tx_id: int):
    """GET /api/transactions/{id}/receipt — PDF-квитанція на конкретну транзакцію.

    Генерує мінімалістичний PDF-чек з реквізитами: дата, сума, відправник,
    отримувач, призначення, QR-код (якщо є). Сервіс перевіряє право власності.
    """
    try:
        from ..services.statement_service import StatementService
        receipt   = StatementService().generate_receipt_with_meta(g.current_user['id'], tx_id)
        pdf_bytes = receipt['pdf_bytes']
        filename  = receipt['filename']
        return Response(
            pdf_bytes,
            mimetype='application/pdf',
            headers={
                'Content-Disposition': f'attachment; filename="{filename}"; filename*=UTF-8\'\'{quote(filename)}',
                'Cache-Control': 'no-store',
            },
        )
    except Exception as exc:
        return api_error(str(exc))


# ── CSV-виписка ───────────────────────────────────────────────────────────────

@account_bp.get('/transactions/export')
@auth_required
def export_csv():
    """GET /api/transactions/export — виписка транзакцій у форматі CSV.

    Query params:
      from_date (str, ISO date)
      to_date   (str, ISO date)

    BOM (﻿) на початку файлу потрібен для коректного відкриття кирилиці
    в Excel на Windows. Без BOM Excel трактує файл як ASCII і портить символи.
    Cache-Control: no-cache — дані фінансові, не кешуємо.
    """
    try:
        from_date   = request.args.get('from_date') or None
        to_date     = request.args.get('to_date')   or None
        csv_content = service.export_csv(g.current_user['id'], from_date=from_date, to_date=to_date)
        return Response(
            '﻿' + csv_content,   # BOM для Excel UTF-8 (Windows сумісність)
            mimetype='text/csv; charset=utf-8',
            headers={
                'Content-Disposition': 'attachment; filename="army_bank_transactions.csv"',
                'Cache-Control': 'no-cache',
            },
        )
    except Exception as exc:
        return api_error(str(exc))

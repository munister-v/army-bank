"""Маршрути рахунків та транзакцій."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from urllib.parse import quote

from flask import Blueprint, Response, jsonify, request, g

from ..config import CRITICAL_MONEY_RATE_LIMIT, CRITICAL_RATE_LIMIT_WINDOW_SECONDS
from ..services.account_service import AccountService
from ..services.card_service import CardService
from ..services.feature_service import FeatureService
from ..services.idempotency_service import IdempotencyService
from ..services.three_ds_service import ThreeDSService
from .helpers import (
    api_error,
    auth_required,
    actor_rate_key,
    rate_limit,
    require_idempotency_key,
)

account_bp = Blueprint('account', __name__, url_prefix='/api')
service = AccountService()
card_service = CardService()
feature_service = FeatureService()
idempotency_service = IdempotencyService()
three_ds_service = ThreeDSService()

def _to_json_safe(value):
    """Convert DB/native values (Decimal/datetime) to JSON-safe primitives."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _to_json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_to_json_safe(v) for v in value]
    return value


@account_bp.get('/dashboard')
@auth_required
def dashboard():
    """Batch endpoint: returns all data needed for the PWA dashboard in one request.

    Replaces 7 separate parallel calls with a single round-trip.
    Results in ~500ms faster first paint on Render free tier.
    """
    try:
        user_id = g.current_user['id']
        user = g.current_user          # already fetched by auth_required

        # All queries share the connection pool — no cold-connect overhead
        account     = service.get_main_account(user_id)
        transactions = service.list_transactions(user_id)
        payouts     = feature_service.list_payouts(user_id)
        donations   = feature_service.list_donations(user_id)
        goals       = feature_service.list_goals(user_id)
        contacts    = feature_service.list_contacts(user_id)
        templates   = feature_service.list_payment_templates(user_id)

        return jsonify({'ok': True, 'data': {
            'user': {
                'id':               user['id'],
                'full_name':        user['full_name'],
                'phone':            user['phone'],
                'email':            user['email'],
                'role':             user['role'],
                'military_status':  user.get('military_status'),
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


@account_bp.get('/accounts/main')
@auth_required
def main_account():
    try:
        return jsonify({'ok': True, 'data': service.get_main_account(g.current_user['id'])})
    except Exception as exc:
        return api_error(str(exc), 404)


@account_bp.post('/transactions/topup')
@auth_required
@rate_limit(
    CRITICAL_MONEY_RATE_LIMIT,
    CRITICAL_RATE_LIMIT_WINDOW_SECONDS,
    key_func=lambda: actor_rate_key('money:topup'),
)
def topup():
    idempotency_key = None
    try:
        data = request.get_json(force=True) or {}
        idempotency_key, err = require_idempotency_key(payload=data, allow_body_fallback=True)
        if err:
            return err

        amount = float(data.get('amount') or 0)
        description = (data.get('description') or 'Поповнення рахунку').strip()
        user_id = int(g.current_user['id'])

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
                return jsonify(reservation.get('payload') or {'ok': False}), int(reservation.get('response_code') or 200)
            if state == 'processing':
                return api_error('Операція вже виконується. Спробуйте пізніше.', 409)

        result = _to_json_safe(service.topup(user_id, amount, description))
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
            idempotency_service.release_processing(
                user_id=int(g.current_user['id']),
                action='topup',
                key=idempotency_key,
            )
        return api_error(str(exc))


@account_bp.post('/transactions/transfer')
@auth_required
@rate_limit(
    CRITICAL_MONEY_RATE_LIMIT,
    CRITICAL_RATE_LIMIT_WINDOW_SECONDS,
    key_func=lambda: actor_rate_key('money:transfer'),
)
def transfer():
    try:
        data = request.get_json(force=True) or {}
        idempotency_key, err = require_idempotency_key(payload=data, allow_body_fallback=True)
        if err:
            return err

        amount = float(data.get('amount') or 0)
        recipient = (data.get('recipient_account_number') or '').strip()
        description = (data.get('description') or 'Швидкий переказ').strip()
        tds_session = (data.get('tds_session') or '').strip()

        # ── 3DS session validation ──────────────────────────────────────────
        if not tds_session:
            return jsonify({'ok': False, 'requires_3ds': True,
                            'error': 'Потрібне підтвердження 3DS.'}), 403
        try:
            three_ds_service.consume_session(int(g.current_user['id']), tds_session)
        except ValueError as e3ds:
            return jsonify({'ok': False, 'requires_3ds': True,
                            'error': str(e3ds)}), 403

        return jsonify({'ok': True, 'data': service.transfer(
            g.current_user['id'], recipient, amount, description,
            idempotency_key=idempotency_key,
        )})
    except Exception as exc:
        return api_error(str(exc))


@account_bp.post('/transactions/transfer-by-card')
@auth_required
@rate_limit(
    CRITICAL_MONEY_RATE_LIMIT,
    CRITICAL_RATE_LIMIT_WINDOW_SECONDS,
    key_func=lambda: actor_rate_key('money:transfer_by_card'),
)
def transfer_by_card():
    """Transfer to another user by their card number."""
    try:
        data = request.get_json(force=True) or {}
        idempotency_key, err = require_idempotency_key(payload=data, allow_body_fallback=True)
        if err:
            return err

        amount = float(data.get('amount') or 0)
        card_number = (data.get('card_number') or '').strip()
        description = (data.get('description') or 'Переказ по картці').strip()
        tds_session = (data.get('tds_session') or '').strip()

        # ── 3DS session validation ──────────────────────────────────────────
        if not tds_session:
            return jsonify({'ok': False, 'requires_3ds': True,
                            'error': 'Потрібне підтвердження 3DS.'}), 403
        try:
            three_ds_service.consume_session(int(g.current_user['id']), tds_session)
        except ValueError as e3ds:
            return jsonify({'ok': False, 'requires_3ds': True,
                            'error': str(e3ds)}), 403

        # Resolve account number from card, then use standard transfer
        card = card_service.get_account_by_card(card_number)
        recipient_account = card['account_number']
        return jsonify({'ok': True, 'data': service.transfer(
            g.current_user['id'], recipient_account, amount, description,
            idempotency_key=idempotency_key,
        )})
    except Exception as exc:
        return api_error(str(exc))


@account_bp.get('/transactions/history')
@auth_required
def history():
    try:
        from_date = request.args.get('from_date') or None
        to_date = request.args.get('to_date') or None
        tx_type = request.args.get('tx_type') or None
        direction = request.args.get('direction') or None
        search = request.args.get('search') or None
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


@account_bp.get('/transactions/<int:transaction_id>')
@auth_required
def get_transaction(transaction_id: int):
    try:
        tx = service.get_transaction(g.current_user['id'], transaction_id)
        return jsonify({'ok': True, 'data': tx})
    except Exception as exc:
        return api_error(str(exc), 404)


@account_bp.get('/analytics/summary')
@auth_required
def analytics():
    try:
        data = service.get_analytics(g.current_user['id'])
        return jsonify({'ok': True, 'data': data})
    except Exception as exc:
        return api_error(str(exc))


@account_bp.get('/analytics/balance-history')
@auth_required
def balance_history():
    try:
        days = min(int(request.args.get('days', 14)), 90)
        data = service.get_balance_history(g.current_user['id'], days=days)
        return jsonify({'ok': True, 'data': data})
    except Exception as exc:
        return api_error(str(exc))


@account_bp.get('/analytics/insights')
@auth_required
def spending_insights():
    try:
        data = service.get_spending_insights(g.current_user['id'])
        return jsonify({'ok': True, 'data': data})
    except Exception as exc:
        return api_error(str(exc))


@account_bp.patch('/transactions/<int:transaction_id>/note')
@auth_required
def update_note(transaction_id: int):
    try:
        data = request.get_json(force=True)
        note = (data.get('note') or '').strip()
        tx = service.update_transaction_note(g.current_user['id'], transaction_id, note)
        return jsonify({'ok': True, 'data': tx})
    except Exception as exc:
        return api_error(str(exc), 404)


@account_bp.get('/transactions/with-contact/<string:account_number>')
@auth_required
def transactions_with_contact(account_number: str):
    try:
        data = service.list_transactions_with_contact(g.current_user['id'], account_number)
        return jsonify({'ok': True, 'data': data})
    except Exception as exc:
        return api_error(str(exc))


@account_bp.get('/achievements')
@auth_required
def achievements():
    try:
        data = service.get_achievements(g.current_user['id'])
        return jsonify({'ok': True, 'data': data})
    except Exception as exc:
        return api_error(str(exc))


@account_bp.get('/transactions/statement')
@auth_required
def export_statement_pdf():
    """Генерує PDF-виписку за рахунком для поточного користувача."""
    try:
        from ..services.statement_service import StatementService
        from_date = request.args.get('from_date') or None
        to_date = request.args.get('to_date') or None
        report_type = (request.args.get('report_type') or 'detailed').strip().lower()
        order_id = (request.args.get('order_id') or '').strip() or None

        svc = StatementService()
        from_date, to_date = svc.normalize_period(from_date, to_date)
        pdf_bytes = svc.generate_pdf(
            g.current_user['id'],
            from_date=from_date,
            to_date=to_date,
            report_type=report_type,
            order_id=order_id,
        )
        account = service.get_main_account(g.current_user['id'])
        fname = svc.build_statement_filename(
            account_number=account.get('account_number') or 'ACCOUNT',
            from_date=from_date,
            to_date=to_date,
            report_type=report_type,
        )
        return Response(
            pdf_bytes,
            mimetype='application/pdf',
            headers={
                'Content-Disposition': f'attachment; filename="{fname}"; filename*=UTF-8\'\'{quote(fname)}',
                'Cache-Control': 'no-store',
            },
        )
    except Exception as exc:
        return api_error(str(exc))


@account_bp.post('/transactions/statement/order')
@auth_required
def order_statement_pdf():
    """Створює замовлення на формування виписки та повертає download URL."""
    try:
        from ..services.statement_service import StatementService

        data = request.get_json(silent=True) or {}
        from_date = data.get('from_date') or None
        to_date = data.get('to_date') or None
        report_type = (data.get('report_type') or 'detailed').strip().lower()

        svc = StatementService()
        order = svc.create_statement_order(
            user_id=g.current_user['id'],
            from_date=from_date,
            to_date=to_date,
            report_type=report_type,
        )
        base = request.script_root or ''
        order['download_url'] = f"{base}/api/transactions/statement?{order['download_query']}"
        return jsonify({'ok': True, 'data': order})
    except Exception as exc:
        return api_error(str(exc))


@account_bp.get('/transactions/statement/orders')
@auth_required
def list_statement_orders():
    """Повертає останні замовлення виписок поточного користувача."""
    try:
        from ..services.statement_service import StatementService

        limit = min(max(request.args.get('limit', default=10, type=int), 1), 50)
        rows = StatementService().list_statement_orders(g.current_user['id'], limit=limit)
        return jsonify({'ok': True, 'data': rows, 'total': len(rows)})
    except Exception as exc:
        return api_error(str(exc))


@account_bp.get('/transactions/<int:tx_id>/receipt')
@auth_required
def export_receipt_pdf(tx_id: int):
    """Генерує PDF-чек для конкретної транзакції поточного користувача."""
    try:
        from ..services.statement_service import StatementService
        receipt = StatementService().generate_receipt_with_meta(g.current_user['id'], tx_id)
        pdf_bytes = receipt['pdf_bytes']
        filename = receipt['filename']
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


@account_bp.get('/transactions/export')
@auth_required
def export_csv():
    try:
        from_date = request.args.get('from_date') or None
        to_date = request.args.get('to_date') or None
        csv_content = service.export_csv(g.current_user['id'], from_date=from_date, to_date=to_date)
        return Response(
            '\ufeff' + csv_content,  # BOM for Excel UTF-8
            mimetype='text/csv; charset=utf-8',
            headers={
                'Content-Disposition': 'attachment; filename="army_bank_transactions.csv"',
                'Cache-Control': 'no-cache',
            },
        )
    except Exception as exc:
        return api_error(str(exc))

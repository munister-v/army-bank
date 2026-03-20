"""Маршрути рахунків та транзакцій."""
from __future__ import annotations

from flask import Blueprint, Response, jsonify, request, g

from ..services.account_service import AccountService
from .helpers import api_error, auth_required

account_bp = Blueprint('account', __name__, url_prefix='/api')
service = AccountService()


@account_bp.get('/accounts/main')
@auth_required
def main_account():
    try:
        return jsonify({'ok': True, 'data': service.get_main_account(g.current_user['id'])})
    except Exception as exc:
        return api_error(str(exc), 404)


@account_bp.post('/transactions/topup')
@auth_required
def topup():
    try:
        data = request.get_json(force=True)
        amount = float(data.get('amount') or 0)
        description = (data.get('description') or 'Поповнення рахунку').strip()
        return jsonify({'ok': True, 'data': service.topup(g.current_user['id'], amount, description)})
    except Exception as exc:
        return api_error(str(exc))


@account_bp.post('/transactions/transfer')
@auth_required
def transfer():
    try:
        data = request.get_json(force=True)
        amount = float(data.get('amount') or 0)
        recipient = (data.get('recipient_account_number') or '').strip()
        description = (data.get('description') or 'Швидкий переказ').strip()
        return jsonify({'ok': True, 'data': service.transfer(g.current_user['id'], recipient, amount, description)})
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
        data = service.list_transactions(
            g.current_user['id'],
            from_date=from_date,
            to_date=to_date,
            tx_type=tx_type,
            direction=direction,
            search=search,
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

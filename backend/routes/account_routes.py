"""Маршрути рахунків та транзакцій."""
from __future__ import annotations

from flask import Blueprint, Response, jsonify, request, g

from ..services.account_service import AccountService
from ..services.feature_service import FeatureService
from .helpers import api_error, auth_required

account_bp = Blueprint('account', __name__, url_prefix='/api')
service = AccountService()
feature_service = FeatureService()


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

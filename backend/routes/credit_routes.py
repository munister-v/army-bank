"""Credit routes — споживчі кредити Army Bank."""
from __future__ import annotations

from flask import Blueprint, jsonify, request, g

from ..services.credit_service import CreditService
from .helpers import api_error, auth_required

credit_bp = Blueprint('credits', __name__, url_prefix='/api')
_svc = CreditService()


@credit_bp.get('/credits')
@auth_required
def list_credits():
    try:
        return jsonify({'ok': True, 'data': _svc.list_credits(g.current_user['id'])})
    except Exception as exc:
        return api_error(str(exc))


@credit_bp.post('/credits')
@auth_required
def create_credit():
    """Body: { amount, term_months, description? }"""
    try:
        data = request.get_json(force=True) or {}
        amount = float(data.get('amount') or 0)
        term_months = int(data.get('term_months') or 0)
        description = str(data.get('description') or '').strip()
        credit = _svc.create_credit(g.current_user['id'], amount, term_months, description)
        return jsonify({'ok': True, 'data': credit}), 201
    except Exception as exc:
        return api_error(str(exc))


@credit_bp.get('/credits/<int:credit_id>')
@auth_required
def get_credit(credit_id: int):
    try:
        return jsonify({'ok': True, 'data': _svc.get_credit(credit_id, g.current_user['id'])})
    except Exception as exc:
        return api_error(str(exc), 404)


@credit_bp.post('/credits/<int:credit_id>/repay')
@auth_required
def repay_credit(credit_id: int):
    """Body (optional): { amount }"""
    try:
        data = request.get_json(force=True) or {}
        amount = data.get('amount')
        amount = float(amount) if amount else None
        result = _svc.repay(credit_id, g.current_user['id'], amount)
        return jsonify({'ok': True, 'data': result})
    except Exception as exc:
        return api_error(str(exc))


@credit_bp.get('/admin/credits')
@auth_required
def admin_list_credits():
    try:
        if g.current_user.get('role') not in ('admin', 'platform_admin', 'operator'):
            return api_error('Forbidden', 403)
        status = request.args.get('status') or None
        limit = min(int(request.args.get('limit', 100)), 500)
        return jsonify({'ok': True, 'data': _svc.admin_list_credits(status, limit)})
    except Exception as exc:
        return api_error(str(exc))

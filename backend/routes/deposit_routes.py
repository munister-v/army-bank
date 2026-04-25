"""Deposit routes — банківські строкові депозити."""
from __future__ import annotations

from flask import Blueprint, jsonify, request, g

from ..services.deposit_service import DepositService
from .helpers import api_error, auth_required

deposit_bp = Blueprint('deposits', __name__, url_prefix='/api')
_svc = DepositService()


@deposit_bp.get('/deposits')
@auth_required
def list_deposits():
    try:
        return jsonify({'ok': True, 'data': _svc.list_deposits(g.current_user['id'])})
    except Exception as exc:
        return api_error(str(exc))


@deposit_bp.post('/deposits')
@auth_required
def create_deposit():
    """
    Body: { amount, term_months, auto_renew?, description? }
    """
    try:
        data = request.get_json(force=True) or {}
        amount = float(data.get('amount') or 0)
        term_months = int(data.get('term_months') or 0)
        auto_renew = bool(data.get('auto_renew', False))
        description = str(data.get('description') or '').strip()
        dep = _svc.create_deposit(
            g.current_user['id'], amount, term_months,
            auto_renew=auto_renew, description=description,
        )
        return jsonify({'ok': True, 'data': dep}), 201
    except Exception as exc:
        return api_error(str(exc))


@deposit_bp.get('/deposits/<int:deposit_id>')
@auth_required
def get_deposit(deposit_id: int):
    try:
        return jsonify({'ok': True, 'data': _svc.get_deposit(deposit_id, g.current_user['id'])})
    except Exception as exc:
        return api_error(str(exc), 404)


@deposit_bp.post('/deposits/<int:deposit_id>/close')
@auth_required
def close_deposit(deposit_id: int):
    """Закрити депозит (достроково або по строку)."""
    try:
        data = request.get_json(force=True) or {}
        early = bool(data.get('early', False))
        result = _svc.close_deposit(deposit_id, g.current_user['id'], early=early)
        return jsonify({'ok': True, 'data': result})
    except Exception as exc:
        return api_error(str(exc))


# ── Admin deposit routes ──────────────────────────────────────────────────────

@deposit_bp.get('/admin/deposits')
@auth_required
def admin_list_deposits():
    try:
        if g.current_user.get('role') not in ('admin', 'platform_admin', 'operator'):
            return api_error('Forbidden', 403)
        status = request.args.get('status') or None
        limit = min(int(request.args.get('limit', 100)), 500)
        return jsonify({'ok': True, 'data': _svc.admin_list_deposits(status, limit)})
    except Exception as exc:
        return api_error(str(exc))


@deposit_bp.post('/admin/deposits/<int:deposit_id>/close')
@auth_required
def admin_close_deposit(deposit_id: int):
    """Адмін може примусово закрити будь-який депозит."""
    try:
        if g.current_user.get('role') not in ('admin', 'platform_admin'):
            return api_error('Forbidden', 403)
        data = request.get_json(force=True) or {}
        # Get deposit to find user_id
        deps = _svc.admin_list_deposits()
        dep = next((d for d in deps if d['id'] == deposit_id), None)
        if not dep:
            return api_error('Депозит не знайдено.', 404)
        result = _svc.close_deposit(deposit_id, dep['user_id'])
        return jsonify({'ok': True, 'data': result})
    except Exception as exc:
        return api_error(str(exc))


@deposit_bp.post('/admin/deposits/mature')
@auth_required
def admin_mature_deposits():
    """EOD: нарахувати по строкових депозитах."""
    try:
        if g.current_user.get('role') not in ('admin', 'platform_admin'):
            return api_error('Forbidden', 403)
        return jsonify({'ok': True, 'data': _svc.admin_mature_deposits()})
    except Exception as exc:
        return api_error(str(exc))

"""Маршрути аудиту платежів для адміністраторів."""
from __future__ import annotations

import json
from flask import Blueprint, jsonify, request, g

from ..repositories.payment_repository import PaymentRepository
from ..services.integrity_service import IntegrityService
from .helpers import api_error, auth_required, role_required

payment_audit_bp = Blueprint('payment_audit', __name__)

_repo      = PaymentRepository()
_integrity = IntegrityService()


@payment_audit_bp.get('/orders')
@auth_required
@role_required('admin', 'platform_admin')
def list_orders():
    limit      = min(request.args.get('limit',  default=50, type=int), 200)
    offset     = request.args.get('offset', default=0,  type=int)
    status     = request.args.get('status')
    risk_level = request.args.get('risk_level')
    user_id    = request.args.get('user_id', type=int)
    orders = _repo.list_orders(limit=limit, offset=offset,
                               status=status, risk_level=risk_level,
                               user_id=user_id)
    total = _repo.count_orders(status=status, risk_level=risk_level)
    # Parse risk_flags JSON
    for o in orders:
        try:
            o['risk_flags'] = json.loads(o.get('risk_flags') or '[]')
        except Exception:
            o['risk_flags'] = []
    return jsonify({'ok': True, 'data': orders, 'total': total})


@payment_audit_bp.get('/orders/<int:order_id>')
@auth_required
@role_required('admin', 'platform_admin')
def get_order(order_id: int):
    order = _repo.get_order(order_id)
    if not order:
        return api_error('Платіжний ордер не знайдено.', 404)
    order = dict(order)
    try:
        order['risk_flags'] = json.loads(order.get('risk_flags') or '[]')
    except Exception:
        order['risk_flags'] = []
    return jsonify({'ok': True, 'data': order})


@payment_audit_bp.get('/risk-events')
@auth_required
@role_required('admin', 'platform_admin')
def list_risk_events():
    limit     = min(request.args.get('limit',  default=50, type=int), 200)
    offset    = request.args.get('offset',   default=0,  type=int)
    severity  = request.args.get('severity')
    user_id   = request.args.get('user_id',  type=int)
    resolved_param = request.args.get('resolved')
    resolved: bool | None = None
    if resolved_param == 'true':
        resolved = True
    elif resolved_param == 'false':
        resolved = False

    events = _repo.list_risk_events(limit=limit, offset=offset,
                                    severity=severity, resolved=resolved,
                                    user_id=user_id)
    return jsonify({'ok': True, 'data': events})


@payment_audit_bp.post('/risk-events/<int:event_id>/resolve')
@auth_required
@role_required('admin', 'platform_admin')
def resolve_event(event_id: int):
    ok = _repo.resolve_risk_event(event_id, g.current_user['id'])
    if not ok:
        return api_error('Подія не знайдена або вже вирішена.', 404)
    return jsonify({'ok': True})


@payment_audit_bp.get('/fraud-stats')
@auth_required
@role_required('admin', 'platform_admin')
def fraud_stats():
    stats = _repo.fraud_stats()
    return jsonify({'ok': True, 'data': stats})


@payment_audit_bp.get('/integrity-check')
@auth_required
@role_required('admin', 'platform_admin')
def integrity_check():
    """Повна перевірка хеш-ланцюгів усіх рахунків."""
    result = _integrity.verify_all_accounts()
    return jsonify({'ok': True, 'data': result})


@payment_audit_bp.get('/integrity-check/<int:account_id>')
@auth_required
@role_required('admin', 'platform_admin')
def integrity_check_account(account_id: int):
    result = _integrity.verify_account(account_id)
    return jsonify({'ok': True, 'data': result})

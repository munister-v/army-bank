"""Маршрути аудиту платежів для адміністраторів."""
from __future__ import annotations

import json
from flask import Blueprint, jsonify, request, g

from ..repositories.payment_repository import PaymentRepository
from ..repositories.feature_repository import FeatureRepository
from ..repositories.user_repository import UserRepository
from ..services.integrity_service import IntegrityService
from .helpers import api_error, auth_required, role_required

payment_audit_bp = Blueprint('payment_audit', __name__)

_repo      = PaymentRepository()
_integrity = IntegrityService()
_features  = FeatureRepository()
_users     = UserRepository()


@payment_audit_bp.get('/orders')
@auth_required
@role_required('admin', 'platform_admin')
def list_orders():
    limit             = min(request.args.get('limit',  default=50, type=int), 200)
    offset            = request.args.get('offset', default=0,  type=int)
    status            = request.args.get('status')
    risk_level        = request.args.get('risk_level')
    user_id           = request.args.get('user_id', type=int)
    review_state      = request.args.get('review_state')
    assigned_admin_id = request.args.get('assigned_admin_id', type=int)
    assigned_mode     = request.args.get('assigned_mode')
    search            = (request.args.get('search') or '').strip()

    orders = _repo.list_orders(limit=limit, offset=offset,
                               status=status, risk_level=risk_level,
                               user_id=user_id,
                               review_state=review_state,
                               assigned_admin_id=assigned_admin_id,
                               assigned_mode=assigned_mode,
                               search=search or None)
    total = _repo.count_orders(status=status, risk_level=risk_level,
                               user_id=user_id,
                               review_state=review_state,
                               assigned_admin_id=assigned_admin_id,
                               assigned_mode=assigned_mode,
                               search=search or None)
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
    try:
        order['risk_flags'] = json.loads(order.get('risk_flags') or '[]')
    except Exception:
        order['risk_flags'] = []
    if (request.args.get('include_timeline') or '').strip().lower() == 'true':
        order['timeline'] = _repo.list_order_events(order_id, limit=200)
    return jsonify({'ok': True, 'data': order})


@payment_audit_bp.patch('/orders/<int:order_id>/assign')
@auth_required
@role_required('admin', 'platform_admin')
def assign_order(order_id: int):
    data = request.get_json(silent=True) or {}
    admin_user_id = data.get('admin_user_id')
    note = (data.get('note') or '').strip()
    if admin_user_id is None:
        admin_user_id = int(g.current_user['id'])
    try:
        admin_user_id = int(admin_user_id)
    except Exception:
        return api_error('Некоректний admin_user_id.')
    if admin_user_id <= 0:
        return api_error('Некоректний admin_user_id.')
    assignee = _users.get_by_id(admin_user_id)
    if not assignee:
        return api_error('Адміністратора не знайдено.', 404)
    if assignee.get('role') not in {'operator', 'admin', 'platform_admin'}:
        return api_error('Призначати можна лише користувачам з роллю operator/admin/platform_admin.')

    order = _repo.assign_order(
        order_id=order_id,
        assigned_admin_id=admin_user_id,
        actor_user_id=g.current_user['id'],
        note=note,
    )
    if not order:
        return api_error('Платіжний ордер не знайдено.', 404)
    try:
        order['risk_flags'] = json.loads(order.get('risk_flags') or '[]')
    except Exception:
        order['risk_flags'] = []
    return jsonify({'ok': True, 'data': order})


@payment_audit_bp.patch('/orders/<int:order_id>/decision')
@auth_required
@role_required('admin', 'platform_admin')
def decide_order(order_id: int):
    data = request.get_json(silent=True) or {}
    decision = (data.get('decision') or '').strip().lower()
    note = (data.get('note') or '').strip()
    if decision not in {'approve', 'reject', 'escalate', 'clear'}:
        return api_error('Недійсне рішення. Дозволено: approve, reject, escalate, clear.')

    order = _repo.set_manual_decision(
        order_id=order_id,
        decision=decision,
        actor_user_id=g.current_user['id'],
        note=note,
    )
    if not order:
        return api_error('Платіжний ордер не знайдено.', 404)
    try:
        order['risk_flags'] = json.loads(order.get('risk_flags') or '[]')
    except Exception:
        order['risk_flags'] = []
    return jsonify({'ok': True, 'data': order})


@payment_audit_bp.post('/orders/<int:order_id>/notes')
@auth_required
@role_required('admin', 'platform_admin')
def add_order_note(order_id: int):
    data = request.get_json(silent=True) or {}
    note = (data.get('note') or '').strip()
    if not note:
        return api_error('Порожня нотатка.')
    ok = _repo.add_order_note(order_id, g.current_user['id'], note)
    if not ok:
        return api_error('Платіжний ордер не знайдено.', 404)
    return jsonify({'ok': True})


@payment_audit_bp.get('/orders/<int:order_id>/timeline')
@auth_required
@role_required('admin', 'platform_admin')
def order_timeline(order_id: int):
    limit = min(request.args.get('limit', default=200, type=int), 500)
    order = _repo.get_order(order_id)
    if not order:
        return api_error('Платіжний ордер не знайдено.', 404)
    items = _repo.list_order_events(order_id, limit=limit)
    return jsonify({'ok': True, 'data': items, 'total': len(items)})


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


@payment_audit_bp.get('/statements')
@auth_required
@role_required('admin', 'platform_admin')
def list_statement_downloads():
    """Список усіх подій завантаження PDF-виписок."""
    limit   = min(request.args.get('limit', default=100, type=int), 500)
    user_id = request.args.get('user_id', type=int)
    logs = _features.list_audit_logs(user_id=user_id, limit=limit)
    statement_logs = [l for l in logs if (l.get('action') or '') == 'statement_pdf']
    return jsonify({'ok': True, 'data': statement_logs, 'total': len(statement_logs)})

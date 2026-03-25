"""Маршрути аудиту платежів для адміністраторів."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
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

_SLA_MINUTES_BY_RISK = {
    'critical': 15,
    'high': 60,
    'medium': 240,
    'low': 720,
}
_QUEUE_RISK_WEIGHT = {'critical': 4, 'high': 3, 'medium': 2, 'low': 1}
_QUEUE_PRIORITY_WEIGHT = {'critical': 4, 'high': 3, 'medium': 2, 'normal': 1}
_OPEN_ORDER_STATUSES = {'pending', 'processing', 'blocked'}
_OPEN_REVIEW_STATES = {'none', 'pending', 'escalated'}


def _parse_dt(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        raw = str(value).strip()
        if not raw:
            return None
        if raw.endswith('Z'):
            raw = raw[:-1] + '+00:00'
        try:
            dt = datetime.fromisoformat(raw)
        except Exception:
            try:
                dt = datetime.strptime(raw, '%Y-%m-%d %H:%M:%S')
            except Exception:
                return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _order_is_open(order: dict) -> bool:
    status = str(order.get('status') or '').lower()
    review_state = str(order.get('review_state') or 'none').lower()
    return status in _OPEN_ORDER_STATUSES and review_state in _OPEN_REVIEW_STATES


def _apply_sla(order: dict, now_utc: datetime | None = None) -> dict:
    now = now_utc or datetime.now(timezone.utc)
    created_at = _parse_dt(order.get('created_at')) or _parse_dt(order.get('updated_at'))
    risk_level = str(order.get('risk_level') or 'low').lower()
    sla_minutes = int(_SLA_MINUTES_BY_RISK.get(risk_level, _SLA_MINUTES_BY_RISK['low']))

    age_minutes = 0
    due_at_iso = None
    remaining_minutes = None
    overdue = False
    due_soon = False

    if created_at:
        age_minutes = max(0, int((now - created_at).total_seconds() // 60))
        due_at = created_at + timedelta(minutes=sla_minutes)
        due_at_iso = due_at.isoformat()
        remaining_minutes = int((due_at - now).total_seconds() // 60)
        overdue = remaining_minutes < 0
        due_soon = (not overdue) and remaining_minutes <= 30

    if overdue and risk_level in {'critical', 'high'}:
        priority = 'critical'
    elif overdue:
        priority = 'high'
    elif risk_level == 'critical':
        priority = 'high'
    elif due_soon:
        priority = 'medium'
    else:
        priority = 'normal'

    order['sla_minutes'] = sla_minutes
    order['sla_age_minutes'] = age_minutes
    order['sla_due_at'] = due_at_iso
    order['sla_remaining_minutes'] = remaining_minutes
    order['sla_overdue'] = overdue
    order['sla_due_soon'] = due_soon
    order['sla_priority'] = priority
    return order


def _decorate_order(order: dict, now_utc: datetime | None = None) -> dict:
    try:
        order['risk_flags'] = json.loads(order.get('risk_flags') or '[]')
    except Exception:
        order['risk_flags'] = []
    return _apply_sla(order, now_utc=now_utc)


def _queue_sort_key(order: dict) -> tuple:
    priority = str(order.get('sla_priority') or 'normal').lower()
    risk = str(order.get('risk_level') or 'low').lower()
    return (
        0 if order.get('sla_overdue') else 1,
        -_QUEUE_PRIORITY_WEIGHT.get(priority, 1),
        -_QUEUE_RISK_WEIGHT.get(risk, 1),
        -int(order.get('sla_age_minutes') or 0),
        -float(order.get('amount') or 0),
        -int(order.get('id') or 0),
    )


def _as_bool(value, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in {'1', 'true', 'yes', 'on'}:
        return True
    if text in {'0', 'false', 'no', 'off'}:
        return False
    return default


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
    overdue_param     = (request.args.get('overdue') or '').strip().lower()
    search            = (request.args.get('search') or '').strip()

    overdue_filter: bool | None = None
    if overdue_param == 'true':
        overdue_filter = True
    elif overdue_param == 'false':
        overdue_filter = False

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

    now = datetime.now(timezone.utc)
    orders = [_decorate_order(dict(o), now_utc=now) for o in orders]
    if overdue_filter is not None:
        orders = [o for o in orders if bool(o.get('sla_overdue')) is overdue_filter]
        total = len(orders)
    return jsonify({'ok': True, 'data': orders, 'total': total})


@payment_audit_bp.get('/orders/<int:order_id>')
@auth_required
@role_required('admin', 'platform_admin')
def get_order(order_id: int):
    order = _repo.get_order(order_id)
    if not order:
        return api_error('Платіжний ордер не знайдено.', 404)
    order = _decorate_order(dict(order))
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


@payment_audit_bp.get('/sla-queue')
@auth_required
@role_required('admin', 'platform_admin')
def sla_queue():
    limit             = min(request.args.get('limit', default=30, type=int), 200)
    offset            = max(request.args.get('offset', default=0, type=int), 0)
    status            = request.args.get('status')
    risk_level        = request.args.get('risk_level')
    review_state      = request.args.get('review_state')
    user_id           = request.args.get('user_id', type=int)
    assigned_admin_id = request.args.get('assigned_admin_id', type=int)
    assigned_mode     = request.args.get('assigned_mode')
    search            = (request.args.get('search') or '').strip()
    open_only         = _as_bool(request.args.get('open_only'), default=True)
    overdue_param     = (request.args.get('overdue') or '').strip().lower()
    due_soon_param    = (request.args.get('due_soon') or '').strip().lower()
    scan_limit        = min(max(request.args.get('scan_limit', default=1000, type=int), 100), 5000)

    overdue_filter: bool | None = None
    due_soon_filter: bool | None = None
    if overdue_param == 'true':
        overdue_filter = True
    elif overdue_param == 'false':
        overdue_filter = False
    if due_soon_param == 'true':
        due_soon_filter = True
    elif due_soon_param == 'false':
        due_soon_filter = False

    candidates = _repo.list_orders(
        limit=scan_limit,
        offset=0,
        status=status,
        risk_level=risk_level,
        user_id=user_id,
        review_state=review_state,
        assigned_admin_id=assigned_admin_id,
        assigned_mode=assigned_mode,
        search=search or None,
    )
    now = datetime.now(timezone.utc)
    rows = [_decorate_order(dict(row), now_utc=now) for row in candidates]

    if open_only:
        rows = [row for row in rows if _order_is_open(row)]
    if overdue_filter is not None:
        rows = [row for row in rows if bool(row.get('sla_overdue')) is overdue_filter]
    if due_soon_filter is not None:
        rows = [row for row in rows if bool(row.get('sla_due_soon')) is due_soon_filter]

    rows.sort(key=_queue_sort_key)
    total = len(rows)
    page = rows[offset: offset + limit]

    overdue_total = sum(1 for row in rows if row.get('sla_overdue'))
    due_soon_total = sum(1 for row in rows if row.get('sla_due_soon'))
    unassigned_total = sum(1 for row in rows if not row.get('assigned_admin_id'))
    escalated_total = sum(1 for row in rows if str(row.get('review_state') or '').lower() == 'escalated')
    avg_age = int(sum(int(row.get('sla_age_minutes') or 0) for row in rows) / max(1, len(rows)))
    by_priority = {'critical': 0, 'high': 0, 'medium': 0, 'normal': 0}
    for row in rows:
        key = str(row.get('sla_priority') or 'normal').lower()
        by_priority[key] = by_priority.get(key, 0) + 1

    return jsonify({
        'ok': True,
        'data': page,
        'total': total,
        'summary': {
            'total': total,
            'overdue_total': overdue_total,
            'due_soon_total': due_soon_total,
            'unassigned_total': unassigned_total,
            'escalated_total': escalated_total,
            'avg_age_minutes': avg_age,
            'by_priority': by_priority,
        },
    })


@payment_audit_bp.post('/sla-auto-escalate')
@auth_required
@role_required('admin', 'platform_admin')
def sla_auto_escalate():
    data = request.get_json(silent=True) or {}
    dry_run = _as_bool(data.get('dry_run'), default=False)
    only_unassigned = _as_bool(data.get('only_unassigned'), default=False)
    scan_limit = min(max(int(data.get('scan_limit') or 1000), 100), 5000)

    candidates = _repo.list_orders(limit=scan_limit, offset=0)
    now = datetime.now(timezone.utc)
    rows = [_decorate_order(dict(row), now_utc=now) for row in candidates]

    eligible = []
    for row in rows:
        if not _order_is_open(row):
            continue
        if not row.get('sla_overdue'):
            continue
        if only_unassigned and row.get('assigned_admin_id'):
            continue
        if str(row.get('review_state') or '').lower() == 'escalated':
            continue
        eligible.append(row)

    escalated_ids: list[int] = []
    if not dry_run:
        note = 'Auto SLA escalation: order overdue in processing queue.'
        for row in eligible:
            updated = _repo.set_manual_decision(
                order_id=int(row['id']),
                decision='escalate',
                actor_user_id=int(g.current_user['id']),
                note=note,
            )
            if updated:
                escalated_ids.append(int(row['id']))

    return jsonify({
        'ok': True,
        'data': {
            'dry_run': dry_run,
            'checked': len(rows),
            'eligible': len(eligible),
            'escalated_count': len(escalated_ids) if not dry_run else len(eligible),
            'ids': escalated_ids if not dry_run else [int(r['id']) for r in eligible],
        }
    })


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

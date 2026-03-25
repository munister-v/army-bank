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
    approval_state = str(order.get('approval_state') or 'none').lower()
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
    order['approval_required'] = risk_level in {'high', 'critical'}
    order['awaiting_approval'] = approval_state == 'requested'
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


def _validate_assignee_user(user_id_raw) -> tuple[int | None, str | None]:
    try:
        assignee_id = int(user_id_raw)
    except Exception:
        return None, 'Некоректний admin_user_id.'
    if assignee_id <= 0:
        return None, 'Некоректний admin_user_id.'
    assignee = _users.get_by_id(assignee_id)
    if not assignee:
        return None, 'Адміністратора не знайдено.'
    if assignee.get('role') not in {'operator', 'admin', 'platform_admin'}:
        return None, 'Призначати можна лише користувачам з роллю operator/admin/platform_admin.'
    return assignee_id, None


@payment_audit_bp.get('/orders')
@auth_required
@role_required('operator', 'admin', 'platform_admin')
def list_orders():
    limit             = min(request.args.get('limit',  default=50, type=int), 200)
    offset            = request.args.get('offset', default=0,  type=int)
    status            = request.args.get('status')
    risk_level        = request.args.get('risk_level')
    user_id           = request.args.get('user_id', type=int)
    review_state      = request.args.get('review_state')
    approval_state    = request.args.get('approval_state')
    assigned_admin_id = request.args.get('assigned_admin_id', type=int)
    assigned_mode     = request.args.get('assigned_mode')
    overdue_param     = (request.args.get('overdue') or '').strip().lower()
    search            = (request.args.get('search') or '').strip()
    open_only         = _as_bool(request.args.get('open_only'), default=False)

    overdue_filter: bool | None = None
    if overdue_param == 'true':
        overdue_filter = True
    elif overdue_param == 'false':
        overdue_filter = False

    orders = _repo.list_orders(limit=limit, offset=offset,
                               status=status, risk_level=risk_level,
                               user_id=user_id,
                               review_state=review_state,
                               approval_state=approval_state,
                               assigned_admin_id=assigned_admin_id,
                               assigned_mode=assigned_mode,
                               search=search or None,
                               open_only=open_only)
    total = _repo.count_orders(status=status, risk_level=risk_level,
                               user_id=user_id,
                               review_state=review_state,
                               approval_state=approval_state,
                               assigned_admin_id=assigned_admin_id,
                               assigned_mode=assigned_mode,
                               search=search or None,
                               open_only=open_only)

    now = datetime.now(timezone.utc)
    orders = [_decorate_order(dict(o), now_utc=now) for o in orders]
    if overdue_filter is not None:
        orders = [o for o in orders if bool(o.get('sla_overdue')) is overdue_filter]
        total = len(orders)
    return jsonify({'ok': True, 'data': orders, 'total': total})


@payment_audit_bp.get('/orders/<int:order_id>')
@auth_required
@role_required('operator', 'admin', 'platform_admin')
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
@role_required('operator', 'admin', 'platform_admin')
def assign_order(order_id: int):
    data = request.get_json(silent=True) or {}
    admin_user_id = data.get('admin_user_id')
    note = (data.get('note') or '').strip()
    if admin_user_id is None:
        admin_user_id = int(g.current_user['id'])
    assignee_id, err = _validate_assignee_user(admin_user_id)
    if err:
        return api_error(err, 404 if 'не знайдено' in err else 400)
    if str(g.current_user.get('role') or '') == 'operator' and int(assignee_id) != int(g.current_user['id']):
        return api_error('Оператор може призначати кейс лише на себе.', 403)

    order = _repo.assign_order(
        order_id=order_id,
        assigned_admin_id=assignee_id,
        actor_user_id=g.current_user['id'],
        note=note,
    )
    if not order:
        return api_error('Платіжний ордер не знайдено.', 404)
    try:
        order['risk_flags'] = json.loads(order.get('risk_flags') or '[]')
    except Exception:
        order['risk_flags'] = []
    order = _apply_sla(dict(order))
    return jsonify({'ok': True, 'data': order})


@payment_audit_bp.patch('/orders/<int:order_id>/decision')
@auth_required
@role_required('operator', 'admin', 'platform_admin')
def decide_order(order_id: int):
    data = request.get_json(silent=True) or {}
    decision = (data.get('decision') or '').strip().lower()
    note = (data.get('note') or '').strip()
    if decision not in {'approve', 'reject', 'escalate', 'clear'}:
        return api_error('Недійсне рішення. Дозволено: approve, reject, escalate, clear.')
    actor_role = str(g.current_user.get('role') or '')
    if actor_role == 'operator' and decision in {'approve', 'reject', 'clear'}:
        return api_error('Оператору дозволено лише escalate.', 403)
    if decision in {'reject', 'escalate'} and len(note) < 5:
        return api_error('Для reject/escalate потрібен коментар (мінімум 5 символів).')

    current = _repo.get_order(order_id)
    if not current:
        return api_error('Платіжний ордер не знайдено.', 404)
    risk_level = str(current.get('risk_level') or '').lower()
    approval_state = str(current.get('approval_state') or 'none').lower()

    mode = 'direct'
    if decision in {'approve', 'reject'} and risk_level in {'high', 'critical'}:
        if actor_role not in {'admin', 'platform_admin'}:
            return api_error('Approve/reject high/critical доступні лише admin/platform_admin.', 403)
        requested_action = str(current.get('approval_requested_action') or '').lower()
        requested_by = current.get('approval_requested_by')
        if approval_state == 'requested':
            if requested_by and int(requested_by) == int(g.current_user['id']):
                return api_error('Maker-checker: не можна фіналізувати власний approval request.', 403)
            if requested_action and requested_action != decision:
                return api_error(f'Очікується фіналізація дії "{requested_action}".', 400)
            order = _repo.finalize_approval(
                order_id=order_id,
                approver_id=int(g.current_user['id']),
                approve_request=True,
                note=note,
            )
            mode = 'approval_finalized'
        else:
            order = _repo.request_approval(
                order_id=order_id,
                requested_action=decision,
                requested_by=int(g.current_user['id']),
                note=note,
            )
            mode = 'approval_requested'
    else:
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
    order = _apply_sla(dict(order))
    return jsonify({'ok': True, 'data': order, 'meta': {'mode': mode}})


@payment_audit_bp.post('/orders/<int:order_id>/approval/request')
@auth_required
@role_required('admin', 'platform_admin')
def request_order_approval(order_id: int):
    data = request.get_json(silent=True) or {}
    action = (data.get('action') or '').strip().lower()
    note = (data.get('note') or '').strip()
    if action not in {'approve', 'reject'}:
        return api_error('Недійсний action. Дозволено: approve, reject.')
    if action == 'reject' and len(note) < 5:
        return api_error('Для reject approval request потрібен коментар (мінімум 5 символів).')

    current = _repo.get_order(order_id)
    if not current:
        return api_error('Платіжний ордер не знайдено.', 404)
    if str(current.get('risk_level') or '').lower() not in {'high', 'critical'}:
        return api_error('Approval request потрібен лише для high/critical ордерів.')

    order = _repo.request_approval(
        order_id=order_id,
        requested_action=action,
        requested_by=int(g.current_user['id']),
        note=note,
    )
    if not order:
        return api_error('Не вдалося створити approval request.', 400)
    order = _apply_sla(dict(order))
    try:
        order['risk_flags'] = json.loads(order.get('risk_flags') or '[]')
    except Exception:
        order['risk_flags'] = []
    return jsonify({'ok': True, 'data': order, 'meta': {'mode': 'approval_requested'}})


@payment_audit_bp.post('/orders/<int:order_id>/approval/finalize')
@auth_required
@role_required('admin', 'platform_admin')
def finalize_order_approval(order_id: int):
    data = request.get_json(silent=True) or {}
    approve = _as_bool(data.get('approve'), default=True)
    note = (data.get('note') or '').strip()

    current = _repo.get_order(order_id)
    if not current:
        return api_error('Платіжний ордер не знайдено.', 404)
    if str(current.get('approval_state') or '').lower() != 'requested':
        return api_error('Для цього ордера немає активного approval request.', 400)
    requested_by = current.get('approval_requested_by')
    if requested_by and int(requested_by) == int(g.current_user['id']):
        return api_error('Maker-checker: не можна фіналізувати власний approval request.', 403)
    if (not approve) and len(note) < 5:
        return api_error('Для deny потрібен коментар (мінімум 5 символів).')

    order = _repo.finalize_approval(
        order_id=order_id,
        approver_id=int(g.current_user['id']),
        approve_request=approve,
        note=note,
    )
    if not order:
        return api_error('Не вдалося фіналізувати approval request.', 400)
    order = _apply_sla(dict(order))
    try:
        order['risk_flags'] = json.loads(order.get('risk_flags') or '[]')
    except Exception:
        order['risk_flags'] = []
    return jsonify({'ok': True, 'data': order, 'meta': {'mode': 'approval_finalized', 'approve': approve}})


@payment_audit_bp.post('/orders/<int:order_id>/notes')
@auth_required
@role_required('operator', 'admin', 'platform_admin')
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
@role_required('operator', 'admin', 'platform_admin')
def order_timeline(order_id: int):
    limit = min(request.args.get('limit', default=200, type=int), 500)
    order = _repo.get_order(order_id)
    if not order:
        return api_error('Платіжний ордер не знайдено.', 404)
    items = _repo.list_order_events(order_id, limit=limit)
    return jsonify({'ok': True, 'data': items, 'total': len(items)})


@payment_audit_bp.get('/sla-queue')
@auth_required
@role_required('operator', 'admin', 'platform_admin')
def sla_queue():
    limit             = min(request.args.get('limit', default=30, type=int), 200)
    offset            = max(request.args.get('offset', default=0, type=int), 0)
    status            = request.args.get('status')
    risk_level        = request.args.get('risk_level')
    review_state      = request.args.get('review_state')
    approval_state    = request.args.get('approval_state')
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
        approval_state=approval_state,
        assigned_admin_id=assigned_admin_id,
        assigned_mode=assigned_mode,
        search=search or None,
        open_only=open_only,
    )
    now = datetime.now(timezone.utc)
    rows = [_decorate_order(dict(row), now_utc=now) for row in candidates]

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
    awaiting_approval_total = sum(1 for row in rows if str(row.get('approval_state') or '').lower() == 'requested')
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
            'awaiting_approval_total': awaiting_approval_total,
            'avg_age_minutes': avg_age,
            'by_priority': by_priority,
        },
    })


@payment_audit_bp.get('/approval-inbox')
@auth_required
@role_required('operator', 'admin', 'platform_admin')
def approval_inbox():
    limit             = min(request.args.get('limit', default=20, type=int), 100)
    offset            = max(request.args.get('offset', default=0, type=int), 0)
    risk_level        = request.args.get('risk_level')
    user_id           = request.args.get('user_id', type=int)
    assigned_admin_id = request.args.get('assigned_admin_id', type=int)
    assigned_mode     = request.args.get('assigned_mode')
    search            = (request.args.get('search') or '').strip()
    open_only         = _as_bool(request.args.get('open_only'), default=True)

    rows = _repo.list_orders(
        limit=limit,
        offset=offset,
        risk_level=risk_level,
        user_id=user_id,
        approval_state='requested',
        assigned_admin_id=assigned_admin_id,
        assigned_mode=assigned_mode,
        search=search or None,
        open_only=open_only,
    )
    total = _repo.count_orders(
        risk_level=risk_level,
        user_id=user_id,
        approval_state='requested',
        assigned_admin_id=assigned_admin_id,
        assigned_mode=assigned_mode,
        search=search or None,
        open_only=open_only,
    )
    now = datetime.now(timezone.utc)
    data = [_decorate_order(dict(row), now_utc=now) for row in rows]

    return jsonify({
        'ok': True,
        'data': data,
        'total': total,
        'summary': {
            'awaiting_approval_total': total,
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
                include_order=False,
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


@payment_audit_bp.get('/workload')
@auth_required
@role_required('operator', 'admin', 'platform_admin')
def workload():
    scan_limit = min(max(request.args.get('scan_limit', default=1500, type=int), 200), 6000)
    open_only = _as_bool(request.args.get('open_only'), default=True)

    candidates = _repo.list_orders(limit=scan_limit, offset=0)
    now = datetime.now(timezone.utc)
    rows = [_decorate_order(dict(row), now_utc=now) for row in candidates]
    if open_only:
        rows = [row for row in rows if _order_is_open(row)]

    buckets: dict[str, dict] = {}
    for row in rows:
        assigned_id = row.get('assigned_admin_id')
        key = str(assigned_id) if assigned_id else 'unassigned'
        if key not in buckets:
            buckets[key] = {
                'admin_user_id': assigned_id,
                'admin_name': row.get('assigned_admin_name') if assigned_id else 'Unassigned',
                'total': 0,
                'overdue': 0,
                'critical': 0,
                'escalated': 0,
                'awaiting_approval': 0,
                'age_sum': 0,
                'avg_age_minutes': 0,
                'by_priority': {'critical': 0, 'high': 0, 'medium': 0, 'normal': 0},
            }
        slot = buckets[key]
        slot['total'] += 1
        slot['age_sum'] += int(row.get('sla_age_minutes') or 0)
        if row.get('sla_overdue'):
            slot['overdue'] += 1
        if str(row.get('risk_level') or '').lower() == 'critical':
            slot['critical'] += 1
        if str(row.get('review_state') or '').lower() == 'escalated':
            slot['escalated'] += 1
        if str(row.get('approval_state') or '').lower() == 'requested':
            slot['awaiting_approval'] += 1
        priority = str(row.get('sla_priority') or 'normal').lower()
        slot['by_priority'][priority] = slot['by_priority'].get(priority, 0) + 1

    workload_rows = []
    for entry in buckets.values():
        entry['avg_age_minutes'] = int(entry['age_sum'] / max(1, entry['total']))
        entry.pop('age_sum', None)
        workload_rows.append(entry)

    workload_rows.sort(
        key=lambda x: (
            0 if x['admin_user_id'] is None else 1,
            -int(x['overdue']),
            -int(x['total']),
            str(x.get('admin_name') or ''),
        )
    )

    summary = {
        'open_total': len(rows),
        'assignees_total': len([r for r in workload_rows if r['admin_user_id'] is not None]),
        'unassigned_total': sum(1 for r in rows if not r.get('assigned_admin_id')),
        'overdue_total': sum(1 for r in rows if r.get('sla_overdue')),
        'critical_total': sum(1 for r in rows if str(r.get('risk_level') or '').lower() == 'critical'),
        'awaiting_approval_total': sum(1 for r in rows if str(r.get('approval_state') or '').lower() == 'requested'),
    }
    return jsonify({'ok': True, 'data': workload_rows, 'summary': summary})


@payment_audit_bp.post('/sla-bulk-action')
@auth_required
@role_required('operator', 'admin', 'platform_admin')
def sla_bulk_action():
    data = request.get_json(silent=True) or {}
    ids_raw = data.get('ids') or []
    action = (data.get('action') or '').strip().lower()
    note = (data.get('note') or '').strip()
    admin_user_id = data.get('admin_user_id')
    only_overdue = _as_bool(data.get('only_overdue'), default=False)

    if not isinstance(ids_raw, list):
        return api_error('Поле ids має бути масивом.')
    if len(ids_raw) > 300:
        return api_error('За один bulk-запит дозволено до 300 ордерів.')

    ids: list[int] = []
    for raw in ids_raw:
        try:
            oid = int(raw)
            if oid > 0:
                ids.append(oid)
        except Exception:
            continue
    ids = list(dict.fromkeys(ids))
    if not ids:
        return api_error('Не вказано жодного ордера для bulk-операції.')

    allowed_actions = {'assign', 'escalate', 'approve', 'reject', 'clear_review', 'note'}
    if action not in allowed_actions:
        return api_error('Недійсний action. Дозволено: assign, escalate, approve, reject, clear_review, note.')
    actor_role = str(g.current_user.get('role') or '')
    if actor_role == 'operator' and action not in {'assign', 'escalate', 'note'}:
        return api_error('Оператору доступні лише bulk-дії: assign, escalate, note.', 403)

    assignee_id = None
    if action == 'assign':
        if admin_user_id is None:
            admin_user_id = g.current_user['id']
        assignee_id, err = _validate_assignee_user(admin_user_id)
        if err:
            return api_error(err, 404 if 'не знайдено' in err else 400)
        if actor_role == 'operator' and int(assignee_id) != int(g.current_user['id']):
            return api_error('Оператор може призначати bulk-кейси лише на себе.', 403)

    if action in {'reject', 'escalate'} and len(note) < 5:
        return api_error('Для reject/escalate потрібен коментар (мінімум 5 символів).')
    if action == 'note' and len(note) < 2:
        return api_error('Для note потрібен текст нотатки.')

    now = datetime.now(timezone.utc)
    success_ids: list[int] = []
    failed: list[dict] = []
    orders_map = _repo.get_orders_brief_map(ids)

    for order_id in ids:
        order = orders_map.get(order_id)
        if not order:
            failed.append({'id': order_id, 'error': 'order_not_found'})
            continue
        order = _decorate_order(dict(order), now_utc=now)
        if only_overdue and not order.get('sla_overdue'):
            failed.append({'id': order_id, 'error': 'not_overdue'})
            continue

        try:
            ok = False
            if action == 'assign':
                ok = bool(_repo.assign_order(
                    order_id, assignee_id, g.current_user['id'], note,
                    include_order=False,
                ))
            elif action == 'note':
                ok = _repo.add_order_note(order_id, g.current_user['id'], note)
            else:
                if action == 'escalate' and str(order.get('review_state') or '').lower() == 'escalated':
                    failed.append({'id': order_id, 'error': 'already_escalated'})
                    continue
                decision_map = {
                    'escalate': 'escalate',
                    'approve': 'approve',
                    'reject': 'reject',
                    'clear_review': 'clear',
                }
                decision = decision_map[action]
                risk_level = str(order.get('risk_level') or '').lower()
                if decision in {'approve', 'reject'} and risk_level in {'high', 'critical'}:
                    approval_state = str(order.get('approval_state') or 'none').lower()
                    requested_action = str(order.get('approval_requested_action') or '').lower()
                    requested_by = order.get('approval_requested_by')
                    if approval_state == 'requested':
                        if requested_by and int(requested_by) == int(g.current_user['id']):
                            failed.append({'id': order_id, 'error': 'maker_checker_self_approval'})
                            continue
                        if requested_action and requested_action != decision:
                            failed.append({'id': order_id, 'error': 'approval_action_mismatch'})
                            continue
                        ok = bool(_repo.finalize_approval(
                            order_id=order_id,
                            approver_id=int(g.current_user['id']),
                            approve_request=True,
                            note=note,
                            include_order=False,
                        ))
                    else:
                        ok = bool(_repo.request_approval(
                            order_id=order_id,
                            requested_action=decision,
                            requested_by=int(g.current_user['id']),
                            note=note,
                            include_order=False,
                        ))
                else:
                    ok = bool(_repo.set_manual_decision(
                        order_id, decision, g.current_user['id'], note,
                        include_order=False,
                    ))

            if ok:
                success_ids.append(order_id)
            else:
                failed.append({'id': order_id, 'error': 'action_failed'})
        except Exception as exc:
            failed.append({'id': order_id, 'error': str(exc)})

    return jsonify({
        'ok': True,
        'data': {
            'action': action,
            'requested': len(ids),
            'success_count': len(success_ids),
            'failed_count': len(failed),
            'success_ids': success_ids,
            'failed': failed,
        }
    })


@payment_audit_bp.get('/risk-events')
@auth_required
@role_required('operator', 'admin', 'platform_admin')
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
@role_required('operator', 'admin', 'platform_admin')
def resolve_event(event_id: int):
    ok = _repo.resolve_risk_event(event_id, g.current_user['id'])
    if not ok:
        return api_error('Подія не знайдена або вже вирішена.', 404)
    return jsonify({'ok': True})


@payment_audit_bp.get('/fraud-stats')
@auth_required
@role_required('operator', 'admin', 'platform_admin')
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

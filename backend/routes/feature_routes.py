"""Маршрути додаткових функцій Army Bank."""
from __future__ import annotations

from flask import Blueprint, jsonify, request, g

from ..services.feature_service import FeatureService
from .helpers import api_error, auth_required

feature_bp = Blueprint('feature', __name__, url_prefix='/api')
service = FeatureService()


@feature_bp.get('/family-contacts')
@auth_required
def list_contacts():
    return jsonify({'ok': True, 'data': service.list_contacts(g.current_user['id'])})


@feature_bp.post('/family-contacts')
@auth_required
def add_contact():
    try:
        return jsonify({'ok': True, 'data': service.add_contact(g.current_user['id'], request.get_json(force=True))})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.delete('/family-contacts/<int:contact_id>')
@auth_required
def delete_contact(contact_id: int):
    try:
        return jsonify({'ok': True, 'data': service.delete_contact(g.current_user['id'], contact_id)})
    except Exception as exc:
        return api_error(str(exc), 404)


@feature_bp.get('/savings-goals')
@auth_required
def list_goals():
    return jsonify({'ok': True, 'data': service.list_goals(g.current_user['id'])})


@feature_bp.post('/savings-goals')
@auth_required
def create_goal():
    try:
        return jsonify({'ok': True, 'data': service.create_goal(g.current_user['id'], request.get_json(force=True))})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.post('/savings-goals/<int:goal_id>/contribute')
@auth_required
def contribute_goal(goal_id: int):
    try:
        data = request.get_json(force=True)
        amount = float(data.get('amount') or 0)
        return jsonify({'ok': True, 'data': service.contribute_goal(g.current_user['id'], goal_id, amount)})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.delete('/savings-goals/<int:goal_id>')
@auth_required
def delete_goal(goal_id: int):
    try:
        return jsonify({'ok': True, 'data': service.delete_goal(g.current_user['id'], goal_id)})
    except Exception as exc:
        return api_error(str(exc), 404)


@feature_bp.get('/donations')
@auth_required
def list_donations():
    return jsonify({'ok': True, 'data': service.list_donations(g.current_user['id'])})


@feature_bp.post('/donations')
@auth_required
def create_donation():
    try:
        return jsonify({'ok': True, 'data': service.create_donation(g.current_user['id'], request.get_json(force=True))})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.get('/payouts')
@auth_required
def list_payouts():
    return jsonify({'ok': True, 'data': service.list_payouts(g.current_user['id'])})


@feature_bp.post('/payouts/demo-accrual')
@auth_required
def demo_payout():
    try:
        return jsonify({'ok': True, 'data': service.create_demo_payout(g.current_user['id'], request.get_json(force=True))})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.get('/payment-templates')
@auth_required
def list_payment_templates():
    return jsonify({'ok': True, 'data': service.list_payment_templates(g.current_user['id'])})


@feature_bp.post('/payment-templates')
@auth_required
def create_payment_template():
    try:
        return jsonify({'ok': True, 'data': service.create_payment_template(g.current_user['id'], request.get_json(force=True))})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.delete('/payment-templates/<int:template_id>')
@auth_required
def delete_payment_template(template_id: int):
    try:
        return jsonify({'ok': True, 'data': service.delete_payment_template(g.current_user['id'], template_id)})
    except Exception as exc:
        return api_error(str(exc), 404)


@feature_bp.get('/audit-logs')
@auth_required
def list_my_audit_logs():
    return jsonify({'ok': True, 'data': service.list_audit_logs(g.current_user['id'])})


@feature_bp.get('/payment-templates/<int:template_id>')
@auth_required
def get_payment_template(template_id: int):
    try:
        t = service.get_payment_template(template_id, g.current_user['id'])
        if not t:
            return api_error('Шаблон не знайдено.', 404)
        return jsonify({'ok': True, 'data': t})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.get('/budget-limits')
@auth_required
def list_budget_limits():
    return jsonify({'ok': True, 'data': service.list_budget_limits(g.current_user['id'])})


@feature_bp.post('/budget-limits')
@auth_required
def set_budget_limit():
    try:
        data = request.get_json(force=True)
        tx_type = (data.get('tx_type') or '').strip()
        monthly_limit = float(data.get('monthly_limit') or 0)
        return jsonify({'ok': True, 'data': service.set_budget_limit(g.current_user['id'], tx_type, monthly_limit)})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.delete('/budget-limits/<string:tx_type>')
@auth_required
def delete_budget_limit(tx_type: str):
    try:
        return jsonify({'ok': True, 'data': service.delete_budget_limit(g.current_user['id'], tx_type)})
    except Exception as exc:
        return api_error(str(exc))


# ── Recurring Transactions ─────────────────────────────────

@feature_bp.get('/recurring-transactions')
@auth_required
def list_recurring():
    return jsonify({'ok': True, 'data': service.list_recurring(g.current_user['id'])})


@feature_bp.post('/recurring-transactions')
@auth_required
def create_recurring():
    try:
        rec_id = service.create_recurring(g.current_user['id'], request.get_json(force=True))
        return jsonify({'ok': True, 'data': {'id': rec_id}})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.delete('/recurring-transactions/<int:recurring_id>')
@auth_required
def delete_recurring(recurring_id: int):
    try:
        return jsonify({'ok': True, 'data': service.delete_recurring(g.current_user['id'], recurring_id)})
    except Exception as exc:
        return api_error(str(exc), 404)


@feature_bp.patch('/recurring-transactions/<int:recurring_id>/toggle')
@auth_required
def toggle_recurring(recurring_id: int):
    try:
        data = request.get_json(force=True)
        is_active = bool(data.get('is_active', True))
        ok = service.toggle_recurring(g.current_user['id'], recurring_id, is_active)
        return jsonify({'ok': True, 'data': ok})
    except Exception as exc:
        return api_error(str(exc))


# ── Debts ──────────────────────────────────────────────────

@feature_bp.get('/debts')
@auth_required
def list_debts():
    return jsonify({'ok': True, 'data': service.list_debts(g.current_user['id'])})


@feature_bp.post('/debts')
@auth_required
def create_debt():
    try:
        debt_id = service.create_debt(g.current_user['id'], request.get_json(force=True))
        return jsonify({'ok': True, 'data': {'id': debt_id}})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.post('/debts/<int:debt_id>/settle')
@auth_required
def settle_debt(debt_id: int):
    try:
        return jsonify({'ok': True, 'data': service.settle_debt(g.current_user['id'], debt_id)})
    except Exception as exc:
        return api_error(str(exc), 404)


@feature_bp.delete('/debts/<int:debt_id>')
@auth_required
def delete_debt(debt_id: int):
    try:
        return jsonify({'ok': True, 'data': service.delete_debt(g.current_user['id'], debt_id)})
    except Exception as exc:
        return api_error(str(exc), 404)


# ── PIN ────────────────────────────────────────────────────

@feature_bp.put('/auth/pin')
@auth_required
def set_pin():
    try:
        data = request.get_json(force=True)
        pin = str(data.get('pin') or '')
        return jsonify({'ok': True, 'data': service.set_pin(g.current_user['id'], pin)})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.post('/auth/pin/verify')
@auth_required
def verify_pin():
    try:
        data = request.get_json(force=True)
        pin = str(data.get('pin') or '')
        ok = service.verify_pin(g.current_user['id'], pin)
        if not ok:
            return api_error('Невірний PIN.', 401)
        return jsonify({'ok': True, 'data': True})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.delete('/auth/pin')
@auth_required
def clear_pin():
    try:
        return jsonify({'ok': True, 'data': service.clear_pin(g.current_user['id'])})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.get('/auth/pin/status')
@auth_required
def pin_status():
    return jsonify({'ok': True, 'data': {'has_pin': service.has_pin(g.current_user['id'])}})


# ── Tags ───────────────────────────────────────────────────

@feature_bp.get('/transactions/tags')
@auth_required
def list_tags():
    try:
        from ..services.account_service import AccountService
        account = AccountService().get_main_account(g.current_user['id'])
        tags = service.list_tags(account['id'])
        return jsonify({'ok': True, 'data': tags})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.patch('/transactions/<int:transaction_id>/tags')
@auth_required
def update_tags(transaction_id: int):
    try:
        from ..services.account_service import AccountService
        account = AccountService().get_main_account(g.current_user['id'])
        data = request.get_json(force=True)
        tags = str(data.get('tags') or '')
        ok = service.update_tags(account['id'], transaction_id, tags)
        return jsonify({'ok': True, 'data': ok})
    except Exception as exc:
        return api_error(str(exc))


# ── Velocity & Top Recipients ───────────────────────────────

@feature_bp.get('/analytics/velocity')
@auth_required
def spending_velocity():
    try:
        from ..services.account_service import AccountService
        account = AccountService().get_main_account(g.current_user['id'])
        data = service.get_velocity(account['id'])
        return jsonify({'ok': True, 'data': data})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.get('/analytics/top-recipients')
@auth_required
def top_recipients():
    try:
        from ..services.account_service import AccountService
        account = AccountService().get_main_account(g.current_user['id'])
        data = service.get_top_recipients(account['id'])
        return jsonify({'ok': True, 'data': data})
    except Exception as exc:
        return api_error(str(exc))

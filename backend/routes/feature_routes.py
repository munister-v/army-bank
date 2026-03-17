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

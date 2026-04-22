"""Маршрути управління картками Army Bank."""
from __future__ import annotations

from flask import Blueprint, jsonify, request, g

from ..services.card_service import CardService
from .helpers import api_error, auth_required

card_bp = Blueprint('cards', __name__, url_prefix='/api')
service = CardService()


@card_bp.get('/cards')
@auth_required
def list_cards():
    try:
        return jsonify({'ok': True, 'data': service.list_cards(g.current_user['id'])})
    except Exception as exc:
        return api_error(str(exc))


@card_bp.post('/cards')
@auth_required
def issue_card():
    try:
        data = request.get_json(force=True) or {}
        card_type = (data.get('card_type') or 'virtual').strip()
        design = (data.get('design') or 'gold').strip()
        return jsonify({'ok': True, 'data': service.issue_card(g.current_user['id'], card_type, design)}), 201
    except Exception as exc:
        return api_error(str(exc))


@card_bp.get('/cards/<int:card_id>/reveal')
@auth_required
def reveal_card(card_id: int):
    """Return full card number + CVV for authenticated card owner (used for card flip)."""
    try:
        return jsonify({'ok': True, 'data': service.reveal_card(g.current_user['id'], card_id)})
    except Exception as exc:
        return api_error(str(exc))


@card_bp.patch('/cards/<int:card_id>/block')
@auth_required
def block_card(card_id: int):
    """Toggle block/unblock."""
    try:
        return jsonify({'ok': True, 'data': service.block_card(g.current_user['id'], card_id)})
    except Exception as exc:
        return api_error(str(exc))


@card_bp.patch('/cards/<int:card_id>/close')
@auth_required
def close_card(card_id: int):
    try:
        return jsonify({'ok': True, 'data': service.close_card(g.current_user['id'], card_id)})
    except Exception as exc:
        return api_error(str(exc))


@card_bp.patch('/cards/<int:card_id>/design')
@auth_required
def update_card_design(card_id: int):
    try:
        data = request.get_json(force=True) or {}
        design = (data.get('design') or '').strip()
        return jsonify({'ok': True, 'data': service.update_design(g.current_user['id'], card_id, design)})
    except Exception as exc:
        return api_error(str(exc))

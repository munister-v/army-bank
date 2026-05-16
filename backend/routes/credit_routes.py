"""Credit routes — споживчі кредити Army Bank."""
from __future__ import annotations

from flask import Blueprint, jsonify, request, g

from ..services.credit_service import CreditService
from ..services.idempotency_service import IdempotencyService
from .helpers import api_error, auth_required, require_idempotency_key

credit_bp = Blueprint('credits', __name__, url_prefix='/api')
_svc = CreditService()
_idem = IdempotencyService()


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
    idempotency_key = None
    try:
        data = request.get_json(force=True) or {}
        idempotency_key, err = require_idempotency_key(payload=data, allow_body_fallback=True)
        if err:
            return err
        amount = float(data.get('amount') or 0)
        term_months = int(data.get('term_months') or 0)
        description = str(data.get('description') or '').strip()
        user_id = int(g.current_user['id'])
        if idempotency_key:
            reservation = _idem.reserve(
                user_id=user_id,
                action='credit_create',
                key=idempotency_key,
                payload={
                    'amount': amount,
                    'term_months': term_months,
                    'description': description,
                },
            )
            state = reservation.get('state')
            if state == 'conflict':
                return api_error('Idempotency-Key уже використано з іншим payload.', 409)
            if state == 'replay':
                return jsonify(reservation.get('payload') or {'ok': False}), int(reservation.get('response_code') or 200)
            if state == 'processing':
                return api_error('Операція вже виконується. Спробуйте пізніше.', 409)
        credit = _svc.create_credit(user_id, amount, term_months, description)
        payload = {'ok': True, 'data': credit}
        if idempotency_key:
            _idem.complete(
                user_id=user_id,
                action='credit_create',
                key=idempotency_key,
                response_payload=payload,
                response_code=201,
            )
        return jsonify(payload), 201
    except Exception as exc:
        if idempotency_key:
            _idem.release_processing(
                user_id=int(g.current_user['id']),
                action='credit_create',
                key=idempotency_key,
            )
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
    idempotency_key = None
    try:
        data = request.get_json(force=True) or {}
        idempotency_key, err = require_idempotency_key(payload=data, allow_body_fallback=True)
        if err:
            return err
        amount = data.get('amount')
        amount = float(amount) if amount else None
        user_id = int(g.current_user['id'])
        if idempotency_key:
            reservation = _idem.reserve(
                user_id=user_id,
                action='credit_repay',
                key=idempotency_key,
                payload={
                    'credit_id': credit_id,
                    'amount': amount,
                },
            )
            state = reservation.get('state')
            if state == 'conflict':
                return api_error('Idempotency-Key уже використано з іншим payload.', 409)
            if state == 'replay':
                return jsonify(reservation.get('payload') or {'ok': False}), int(reservation.get('response_code') or 200)
            if state == 'processing':
                return api_error('Операція вже виконується. Спробуйте пізніше.', 409)
        result = _svc.repay(credit_id, user_id, amount)
        payload = {'ok': True, 'data': result}
        if idempotency_key:
            _idem.complete(
                user_id=user_id,
                action='credit_repay',
                key=idempotency_key,
                response_payload=payload,
                response_code=200,
            )
        return jsonify(payload)
    except Exception as exc:
        if idempotency_key:
            _idem.release_processing(
                user_id=int(g.current_user['id']),
                action='credit_repay',
                key=idempotency_key,
            )
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

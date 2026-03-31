"""Admin card management routes for Army Bank."""
from __future__ import annotations

from flask import Blueprint, jsonify, request, g

from ..database import get_connection
from ..repositories.feature_repository import FeatureRepository
from ..services.card_service import CardService
from .helpers import api_error, auth_required, role_required

admin_cards_bp = Blueprint('admin_cards', __name__)

feature_repo = FeatureRepository()
card_service = CardService()

_CARD_SELECT = """
    SELECT
        c.id,
        c.account_id,
        c.card_number,
        c.card_type,
        c.status,
        c.holder_name,
        c.issued_at,
        c.expires_at,
        c.design,
        u.id          AS user_id,
        u.full_name,
        u.phone,
        u.email,
        u.role,
        a.account_number,
        a.balance
    FROM cards c
    JOIN accounts a ON a.id = c.account_id
    JOIN users u    ON u.id = a.user_id
"""


def _mask_card_number(card_number: str | None) -> str:
    if not card_number:
        return '**** **** **** ????'
    last4 = str(card_number)[-4:]
    return f'**** **** **** {last4}'


def _row_to_dict(row) -> dict:
    """Convert a sqlite3.Row or psycopg2 RealDictRow to a plain dict."""
    try:
        return dict(row)
    except Exception:
        return {k: row[k] for k in row.keys()}


def _card_row_to_resp(row) -> dict:
    d = _row_to_dict(row)
    d['card_number_masked'] = _mask_card_number(d.get('card_number'))
    return d


# ── List all cards ────────────────────────────────────────────────────────────

@admin_cards_bp.get('/cards')
@auth_required
@role_required('admin', 'platform_admin')
def list_cards():
    try:
        status_filter = (request.args.get('status') or '').strip() or None
        user_id_str   = (request.args.get('user_id') or '').strip()
        search        = (request.args.get('search') or '').strip() or None

        try:
            limit = min(int(request.args.get('limit', 100)), 500)
        except (TypeError, ValueError):
            limit = 100
        try:
            offset = max(int(request.args.get('offset', 0)), 0)
        except (TypeError, ValueError):
            offset = 0

        user_id_filter: int | None = None
        if user_id_str:
            try:
                user_id_filter = int(user_id_str)
            except ValueError:
                return api_error('user_id must be an integer.')

        where_clauses: list[str] = []
        params: list = []

        if status_filter:
            where_clauses.append('c.status = ?')
            params.append(status_filter)

        if user_id_filter is not None:
            where_clauses.append('u.id = ?')
            params.append(user_id_filter)

        if search:
            where_clauses.append(
                '(u.full_name LIKE ? OR u.phone LIKE ? OR c.card_number LIKE ?)'
            )
            like = f'%{search}%'
            params.extend([like, like, like])

        where_sql = ('WHERE ' + ' AND '.join(where_clauses)) if where_clauses else ''

        count_sql  = f'SELECT COUNT(*) AS cnt FROM cards c JOIN accounts a ON a.id = c.account_id JOIN users u ON u.id = a.user_id {where_sql}'
        select_sql = f'{_CARD_SELECT} {where_sql} ORDER BY c.id DESC LIMIT ? OFFSET ?'

        with get_connection() as conn:
            total = _row_to_dict(conn.execute(count_sql, params).fetchone())['cnt']
            rows  = conn.execute(select_sql, params + [limit, offset]).fetchall()

        data = [_card_row_to_resp(r) for r in rows]
        return jsonify({'ok': True, 'data': data, 'total': total, 'offset': offset, 'limit': limit})
    except Exception as exc:
        return api_error(str(exc))


# ── Single card detail ────────────────────────────────────────────────────────

@admin_cards_bp.get('/cards/<int:card_id>')
@auth_required
@role_required('admin', 'platform_admin')
def get_card(card_id: int):
    try:
        sql = f'{_CARD_SELECT} WHERE c.id = ?'
        with get_connection() as conn:
            row = conn.execute(sql, (card_id,)).fetchone()
        if not row:
            return api_error('Card not found.', 404)
        return jsonify({'ok': True, 'data': _card_row_to_resp(row)})
    except Exception as exc:
        return api_error(str(exc))


# ── Block card ────────────────────────────────────────────────────────────────

@admin_cards_bp.patch('/cards/<int:card_id>/block')
@auth_required
@role_required('admin', 'platform_admin')
def block_card(card_id: int):
    try:
        actor_id = g.current_user['id']
        with get_connection() as conn:
            row = conn.execute('SELECT status FROM cards WHERE id = ?', (card_id,)).fetchone()
            if not row:
                return api_error('Card not found.', 404)
            current_status = _row_to_dict(row)['status']
            if current_status == 'closed':
                return api_error('Cannot block a closed card.')
            conn.execute("UPDATE cards SET status = 'blocked' WHERE id = ?", (card_id,))
        feature_repo.add_audit_log(actor_id, 'admin_card_block', f'card_id={card_id}')
        return jsonify({'ok': True, 'data': {'card_id': card_id, 'status': 'blocked'}})
    except Exception as exc:
        return api_error(str(exc))


# ── Unblock card ──────────────────────────────────────────────────────────────

@admin_cards_bp.patch('/cards/<int:card_id>/unblock')
@auth_required
@role_required('admin', 'platform_admin')
def unblock_card(card_id: int):
    try:
        actor_id = g.current_user['id']
        with get_connection() as conn:
            row = conn.execute('SELECT status FROM cards WHERE id = ?', (card_id,)).fetchone()
            if not row:
                return api_error('Card not found.', 404)
            current_status = _row_to_dict(row)['status']
            if current_status == 'closed':
                return api_error('Cannot unblock a closed card.')
            conn.execute("UPDATE cards SET status = 'active' WHERE id = ?", (card_id,))
        feature_repo.add_audit_log(actor_id, 'admin_card_unblock', f'card_id={card_id}')
        return jsonify({'ok': True, 'data': {'card_id': card_id, 'status': 'active'}})
    except Exception as exc:
        return api_error(str(exc))


# ── Close card ────────────────────────────────────────────────────────────────

@admin_cards_bp.patch('/cards/<int:card_id>/close')
@auth_required
@role_required('admin', 'platform_admin')
def close_card(card_id: int):
    try:
        actor_id = g.current_user['id']
        with get_connection() as conn:
            row = conn.execute('SELECT status FROM cards WHERE id = ?', (card_id,)).fetchone()
            if not row:
                return api_error('Card not found.', 404)
            current_status = _row_to_dict(row)['status']
            if current_status == 'closed':
                return api_error('Card is already closed.')
            conn.execute("UPDATE cards SET status = 'closed' WHERE id = ?", (card_id,))
        feature_repo.add_audit_log(actor_id, 'admin_card_close', f'card_id={card_id}')
        return jsonify({'ok': True, 'data': {'card_id': card_id, 'status': 'closed'}})
    except Exception as exc:
        return api_error(str(exc))


# ── Issue card for user ───────────────────────────────────────────────────────

@admin_cards_bp.post('/users/<int:user_id>/cards')
@auth_required
@role_required('admin', 'platform_admin')
def issue_card_for_user(user_id: int):
    try:
        actor_id = g.current_user['id']
        body      = request.get_json(force=True) or {}
        card_type = (body.get('card_type') or 'virtual').strip()
        design    = (body.get('design') or 'gold').strip()

        card = card_service.issue_card(user_id, card_type, design)
        feature_repo.add_audit_log(
            actor_id,
            'admin_card_issue',
            f'user_id={user_id} card_type={card_type} design={design}',
        )
        return jsonify({'ok': True, 'data': card}), 201
    except Exception as exc:
        return api_error(str(exc))

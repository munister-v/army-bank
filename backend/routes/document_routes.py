"""Маршрути документообігу для адміністраторів."""
from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..database import get_connection
from ..services.auth_service import AuthService

doc_bp = Blueprint('doc', __name__)
_svc = AuthService()


def _require_admin():
    header = request.headers.get('Authorization', '')
    if not header.startswith('Bearer '):
        return None
    user = _svc.get_user_by_token(header[7:].strip())
    if not user or user.get('role') not in ('admin', 'platform_admin'):
        return None
    return user


# ── Templates ────────────────────────────────────────────────────────────────

@doc_bp.get('/doc-templates')
def list_templates():
    admin = _require_admin()
    if not admin:
        return jsonify({'ok': False, 'error': 'Доступ заборонено.'}), 403
    with get_connection() as conn:
        rows = conn.execute(
            'SELECT * FROM document_templates ORDER BY created_at DESC'
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@doc_bp.post('/doc-templates')
def create_template():
    admin = _require_admin()
    if not admin:
        return jsonify({'ok': False, 'error': 'Доступ заборонено.'}), 403
    data = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    body  = (data.get('body')  or '').strip()
    category = (data.get('category') or 'general').strip()
    if not title:
        return jsonify({'ok': False, 'error': 'Назва обов\'язкова.'}), 400
    from ..database import get_returning_id_suffix, insert_last_id
    suffix = get_returning_id_suffix()
    with get_connection() as conn:
        cur = conn.execute(
            'INSERT INTO document_templates (title, body, category, created_by) VALUES (%s, %s, %s, %s)' + suffix,
            (title, body, category, admin['id'])
        )
        new_id = insert_last_id(cur)
    return jsonify({'ok': True, 'id': new_id}), 201


@doc_bp.delete('/doc-templates/<int:template_id>')
def delete_template(template_id: int):
    admin = _require_admin()
    if not admin:
        return jsonify({'ok': False, 'error': 'Доступ заборонено.'}), 403
    with get_connection() as conn:
        conn.execute('DELETE FROM document_templates WHERE id = %s', (template_id,))
    return jsonify({'ok': True})


# ── Send to users ─────────────────────────────────────────────────────────────

@doc_bp.post('/doc-templates/<int:template_id>/send')
def send_template(template_id: int):
    admin = _require_admin()
    if not admin:
        return jsonify({'ok': False, 'error': 'Доступ заборонено.'}), 403
    data = request.get_json(silent=True) or {}
    user_ids = data.get('user_ids') or []
    notes    = (data.get('notes') or '').strip()
    if not isinstance(user_ids, list) or not user_ids:
        return jsonify({'ok': False, 'error': 'user_ids обов\'язковий.'}), 400
    with get_connection() as conn:
        tmpl = conn.execute(
            'SELECT id FROM document_templates WHERE id = %s', (template_id,)
        ).fetchone()
        if not tmpl:
            return jsonify({'ok': False, 'error': 'Шаблон не знайдено.'}), 404
        count = 0
        for uid in user_ids:
            try:
                conn.execute(
                    'INSERT INTO user_documents (template_id, user_id, sent_by, notes) VALUES (%s, %s, %s, %s)',
                    (template_id, int(uid), admin['id'], notes)
                )
                count += 1
            except Exception:
                pass
    return jsonify({'ok': True, 'sent': count})


# ── Assignments list ──────────────────────────────────────────────────────────

@doc_bp.get('/doc-assignments')
def list_assignments():
    admin = _require_admin()
    if not admin:
        return jsonify({'ok': False, 'error': 'Доступ заборонено.'}), 403
    with get_connection() as conn:
        rows = conn.execute(
            """SELECT ud.id, ud.template_id, dt.title AS template_title,
                      ud.user_id, u.full_name AS recipient_name,
                      ud.notes, ud.sent_at
               FROM user_documents ud
               JOIN document_templates dt ON dt.id = ud.template_id
               JOIN users u ON u.id = ud.user_id
               ORDER BY ud.sent_at DESC
               LIMIT 200"""
        ).fetchall()
    return jsonify([dict(r) for r in rows])

"""Admin compliance management routes for Army Bank."""
from __future__ import annotations

from datetime import datetime, timezone

from flask import Blueprint, jsonify, request, g

from ..database import get_connection
from ..repositories.feature_repository import FeatureRepository
from .helpers import api_error, auth_required, role_required

admin_compliance_bp = Blueprint('admin_compliance', __name__)

feature_repo = FeatureRepository()

_KYC_STATUSES  = ('not_started', 'pending', 'in_review', 'verified', 'rejected')
_RISK_LEVELS   = ('low', 'medium', 'high', 'critical')


def _row_to_dict(row) -> dict:
    try:
        return dict(row)
    except Exception:
        return {k: row[k] for k in row.keys()}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_profile(conn, user_id: int) -> dict:
    """Return existing compliance profile or insert a default one."""
    row = conn.execute(
        'SELECT * FROM compliance_profiles WHERE user_id = %s', (user_id,)
    ).fetchone()
    if row:
        return _row_to_dict(row)
    conn.execute(
        """INSERT INTO compliance_profiles
               (user_id, kyc_status, aml_flag, risk_level, notes, updated_at, updated_by)
           VALUES (%s, 'pending', 0, 'low', NULL, NULL, NULL)""",
        (user_id,),
    )
    row = conn.execute(
        'SELECT * FROM compliance_profiles WHERE user_id = %s', (user_id,)
    ).fetchone()
    return _row_to_dict(row)


# ── Stats ─────────────────────────────────────────────────────────────────────

@admin_compliance_bp.get('/stats')
@auth_required
@role_required('admin', 'platform_admin')
def compliance_stats():
    try:
        with get_connection() as conn:
            total_users = _row_to_dict(
                conn.execute('SELECT COUNT(*) AS cnt FROM users').fetchone()
            )['cnt']

            profiled = _row_to_dict(
                conn.execute('SELECT COUNT(*) AS cnt FROM compliance_profiles').fetchone()
            )['cnt']

            kyc_rows = conn.execute(
                'SELECT kyc_status, COUNT(*) AS cnt FROM compliance_profiles GROUP BY kyc_status'
            ).fetchall()
            kyc = {r['kyc_status']: r['cnt'] for r in (_row_to_dict(r) for r in kyc_rows)}

            aml_flagged = _row_to_dict(
                conn.execute(
                    'SELECT COUNT(*) AS cnt FROM compliance_profiles WHERE aml_flag = 1'
                ).fetchone()
            )['cnt']

            risk_rows = conn.execute(
                'SELECT risk_level, COUNT(*) AS cnt FROM compliance_profiles GROUP BY risk_level'
            ).fetchall()
            risk = {r['risk_level']: r['cnt'] for r in (_row_to_dict(r) for r in risk_rows)}

        return jsonify({
            'ok': True,
            'data': {
                'total_users': total_users,
                'profiled': profiled,
                'untracked': total_users - profiled,
                'kyc': kyc,
                'aml_flagged': aml_flagged,
                'risk': risk,
            },
        })
    except Exception as exc:
        return api_error(str(exc))


# ── List users with compliance ────────────────────────────────────────────────

@admin_compliance_bp.get('/users')
@auth_required
@role_required('admin', 'platform_admin')
def list_compliance_users():
    try:
        kyc_filter  = (request.args.get('kyc_status') or '').strip() or None
        aml_str     = (request.args.get('aml_flag')   or '').strip()
        risk_filter = (request.args.get('risk_level')  or '').strip() or None
        search      = (request.args.get('search')      or '').strip() or None

        try:
            limit = max(1, min(int(request.args.get('limit', 50)), 500))
        except (TypeError, ValueError):
            limit = 50
        try:
            offset = max(0, int(request.args.get('offset', 0)))
        except (TypeError, ValueError):
            offset = 0

        aml_filter: int | None = None
        if aml_str in ('0', '1'):
            aml_filter = int(aml_str)

        # Build WHERE conditions for the outer query over an inner subquery.
        # Using sub.* keeps filtering/sorting valid for both count + data SQL.
        where_clauses: list[str] = []
        params: list = []

        if kyc_filter:
            where_clauses.append('sub.kyc_status_eff = %s')
            params.append(kyc_filter)
        if aml_filter is not None:
            where_clauses.append('sub.aml_flag_eff = %s')
            params.append(aml_filter)
        if risk_filter:
            where_clauses.append('sub.risk_level_eff = %s')
            params.append(risk_filter)
        if search:
            where_clauses.append(
                '(sub.full_name ILIKE %s OR sub.phone ILIKE %s OR sub.email ILIKE %s)'
            )
            like = f'%{search}%'
            params.extend([like, like, like])

        where_sql = ('WHERE ' + ' AND '.join(where_clauses)) if where_clauses else ''

        # Sort in the outer query where aliased fields are real columns of sub.
        order_sql = """
            ORDER BY
                CASE sub.kyc_status_eff
                    WHEN 'rejected'    THEN 0
                    WHEN 'in_review'   THEN 1
                    WHEN 'pending'     THEN 2
                    WHEN 'not_started' THEN 3
                    ELSE 4
                END ASC,
                sub.aml_flag_eff DESC,
                sub.created_at DESC
        """

        # Inner SELECT provides normalized/aliased compliance fields.
        inner_sql = """
            SELECT
                u.id,
                u.full_name,
                u.phone,
                u.email,
                u.role,
                u.created_at,
                cp.id                              AS profile_id,
                COALESCE(cp.kyc_status, 'pending') AS kyc_status_eff,
                COALESCE(cp.aml_flag,   0)         AS aml_flag_eff,
                COALESCE(cp.risk_level, 'low')     AS risk_level_eff,
                cp.notes,
                cp.updated_at,
                cp.updated_by
            FROM users u
            LEFT JOIN compliance_profiles cp ON cp.user_id = u.id
        """

        # Both count and select operate on the same subquery shape.
        count_sql  = f'SELECT COUNT(*) AS cnt FROM ({inner_sql}) sub {where_sql}'
        select_sql = f'SELECT * FROM ({inner_sql}) sub {where_sql} {order_sql} LIMIT %s OFFSET %s'

        with get_connection() as conn:
            total = _row_to_dict(conn.execute(count_sql, params).fetchone())['cnt']
            rows  = conn.execute(select_sql, params + [limit, offset]).fetchall()

        data = [_row_to_dict(r) for r in rows]
        return jsonify({'ok': True, 'data': data, 'total': total})
    except Exception as exc:
        return api_error(str(exc))


# ── Single user compliance detail ─────────────────────────────────────────────

@admin_compliance_bp.get('/users/<int:user_id>')
@auth_required
@role_required('admin', 'platform_admin')
def get_compliance_user(user_id: int):
    try:
        with get_connection() as conn:
            user_row = conn.execute(
                'SELECT id, full_name, phone, email, role, created_at FROM users WHERE id = %s',
                (user_id,),
            ).fetchone()
            if not user_row:
                return api_error('User not found.', 404)
            user = _row_to_dict(user_row)

            profile = _ensure_profile(conn, user_id)

            updated_by_name: str | None = None
            if profile.get('updated_by'):
                upd_row = conn.execute(
                    'SELECT full_name FROM users WHERE id = %s', (profile['updated_by'],)
                ).fetchone()
                if upd_row:
                    updated_by_name = _row_to_dict(upd_row).get('full_name')
            profile['updated_by_name'] = updated_by_name

        return jsonify({'ok': True, 'data': {**user, 'compliance': profile}})
    except Exception as exc:
        return api_error(str(exc))


# ── Update compliance profile ─────────────────────────────────────────────────

@admin_compliance_bp.patch('/users/<int:user_id>')
@auth_required
@role_required('admin', 'platform_admin')
def update_compliance_user(user_id: int):
    try:
        actor_id = g.current_user['id']
        body     = request.get_json(force=True) or {}

        kyc_status = body.get('kyc_status')
        aml_flag   = body.get('aml_flag')
        risk_level = body.get('risk_level')
        notes      = body.get('notes')

        if kyc_status is not None and kyc_status not in _KYC_STATUSES:
            return api_error(
                f'Invalid kyc_status. Allowed: {", ".join(_KYC_STATUSES)}.'
            )
        if risk_level is not None and risk_level not in _RISK_LEVELS:
            return api_error(
                f'Invalid risk_level. Allowed: {", ".join(_RISK_LEVELS)}.'
            )
        if aml_flag is not None:
            try:
                aml_flag = int(aml_flag)
                if aml_flag not in (0, 1):
                    raise ValueError
            except (TypeError, ValueError):
                return api_error('aml_flag must be 0 or 1.')

        set_clauses: list[str] = ['updated_at = %s', 'updated_by = %s']
        set_params: list       = [_now_iso(), actor_id]

        if kyc_status is not None:
            set_clauses.append('kyc_status = %s')
            set_params.append(kyc_status)
        if aml_flag is not None:
            set_clauses.append('aml_flag = %s')
            set_params.append(aml_flag)
        if risk_level is not None:
            set_clauses.append('risk_level = %s')
            set_params.append(risk_level)
        if notes is not None:
            set_clauses.append('notes = %s')
            set_params.append(notes)

        with get_connection() as conn:
            user_row = conn.execute(
                'SELECT id FROM users WHERE id = %s', (user_id,)
            ).fetchone()
            if not user_row:
                return api_error('User not found.', 404)

            _ensure_profile(conn, user_id)

            update_sql = (
                f'UPDATE compliance_profiles SET {", ".join(set_clauses)} WHERE user_id = %s'
            )
            conn.execute(update_sql, set_params + [user_id])

            profile = _row_to_dict(
                conn.execute(
                    'SELECT * FROM compliance_profiles WHERE user_id = %s', (user_id,)
                ).fetchone()
            )

            updated_by_name: str | None = None
            if profile.get('updated_by'):
                upd_row = conn.execute(
                    'SELECT full_name FROM users WHERE id = %s', (profile['updated_by'],)
                ).fetchone()
                if upd_row:
                    updated_by_name = _row_to_dict(upd_row).get('full_name')
            profile['updated_by_name'] = updated_by_name

        feature_repo.add_audit_log(
            actor_id,
            'admin_compliance_update',
            f'user_id={user_id}',
        )
        return jsonify({'ok': True, 'data': profile})
    except Exception as exc:
        return api_error(str(exc))

"""Репозиторій для payment_orders та risk_events."""
from __future__ import annotations

import json
from ..database import get_connection, get_returning_id_suffix, insert_last_id


class PaymentRepository:

    # ── Payment Orders ────────────────────────────────────────────────────────

    def create_order(self, idempotency_key: str, initiator_user_id: int,
                     sender_account_id: int, recipient_account_id: int,
                     amount: float, description: str,
                     risk_score: int, risk_level: str,
                     risk_flags: list) -> int:
        flags_json = json.dumps(risk_flags, ensure_ascii=False)
        with get_connection() as conn:
            cur = conn.execute(
                """INSERT INTO payment_orders
                   (idempotency_key, initiator_user_id, sender_account_id,
                    recipient_account_id, amount, description,
                    risk_score, risk_level, risk_flags, status)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'pending')
                """ + get_returning_id_suffix(),
                (idempotency_key, initiator_user_id, sender_account_id,
                 recipient_account_id, amount, description,
                 risk_score, risk_level, flags_json)
            )
            order_id = insert_last_id(cur)
            conn.execute(
                """INSERT INTO payment_order_events
                   (payment_order_id, actor_user_id, event_type, details)
                   VALUES (%s,%s,'created',%s)""",
                (order_id, initiator_user_id, f'risk={risk_level}:{risk_score}')
            )
            return order_id

    def get_order(self, order_id: int) -> dict | None:
        with get_connection() as conn:
            row = conn.execute(
                """SELECT po.*,
                          u.full_name AS initiator_name,
                          sa.account_number AS sender_number,
                          ra.account_number AS recipient_number,
                          aa.full_name AS assigned_admin_name,
                          du.full_name AS decision_by_name,
                          aru.full_name AS approval_requested_by_name,
                          adu.full_name AS approval_decided_by_name
                   FROM payment_orders po
                   LEFT JOIN users u ON u.id = po.initiator_user_id
                   LEFT JOIN accounts sa ON sa.id = po.sender_account_id
                   LEFT JOIN accounts ra ON ra.id = po.recipient_account_id
                   LEFT JOIN users aa ON aa.id = po.assigned_admin_id
                   LEFT JOIN users du ON du.id = po.decision_by
                   LEFT JOIN users aru ON aru.id = po.approval_requested_by
                   LEFT JOIN users adu ON adu.id = po.approval_decided_by
                   WHERE po.id = %s""",
                (order_id,)
            ).fetchone()
        return dict(row) if row else None

    def get_by_idempotency_key(self, key: str) -> dict | None:
        with get_connection() as conn:
            return conn.execute(
                "SELECT * FROM payment_orders WHERE idempotency_key = %s",
                (key,)
            ).fetchone()

    def set_status(self, order_id: int, status: str,
                   tx_id_out: int | None = None, tx_id_in: int | None = None,
                   failure_reason: str | None = None) -> None:
        with get_connection() as conn:
            prev = conn.execute(
                'SELECT status FROM payment_orders WHERE id = %s',
                (order_id,)
            ).fetchone()
            if status == 'blocked':
                conn.execute(
                    """UPDATE payment_orders
                       SET status = %s, tx_id_out = %s, tx_id_in = %s,
                           failure_reason = %s,
                           review_state = CASE WHEN review_state = 'none' THEN 'pending' ELSE review_state END,
                           updated_at = CURRENT_TIMESTAMP
                       WHERE id = %s""",
                    (status, tx_id_out, tx_id_in, failure_reason, order_id)
                )
            if prev and str(prev.get('status') or '') != str(status):
                conn.execute(
                    """INSERT INTO payment_order_events
                       (payment_order_id, actor_user_id, event_type, details)
                       VALUES (%s,NULL,'status_changed',%s)""",
                    (order_id, f'{prev.get("status")}->{status}')
                )
            else:
                conn.execute(
                    """UPDATE payment_orders
                       SET status = %s, tx_id_out = %s, tx_id_in = %s,
                           failure_reason = %s, updated_at = CURRENT_TIMESTAMP
                       WHERE id = %s""",
                    (status, tx_id_out, tx_id_in, failure_reason, order_id)
                )

    def list_orders(self, limit: int = 100, offset: int = 0,
                    status: str | None = None,
                    risk_level: str | None = None,
                    user_id: int | None = None,
                    review_state: str | None = None,
                    approval_state: str | None = None,
                    assigned_admin_id: int | None = None,
                    assigned_mode: str | None = None,
                    search: str | None = None) -> list:
        with get_connection() as conn:
            sql = """
                SELECT po.*,
                       u.full_name AS initiator_name,
                       sa.account_number AS sender_number,
                       ra.account_number AS recipient_number,
                       aa.full_name AS assigned_admin_name,
                       du.full_name AS decision_by_name,
                       aru.full_name AS approval_requested_by_name,
                       adu.full_name AS approval_decided_by_name
                FROM payment_orders po
                LEFT JOIN users u ON u.id = po.initiator_user_id
                LEFT JOIN accounts sa ON sa.id = po.sender_account_id
                LEFT JOIN accounts ra ON ra.id = po.recipient_account_id
                LEFT JOIN users aa ON aa.id = po.assigned_admin_id
                LEFT JOIN users du ON du.id = po.decision_by
                LEFT JOIN users aru ON aru.id = po.approval_requested_by
                LEFT JOIN users adu ON adu.id = po.approval_decided_by
                WHERE 1=1
            """
            params: list = []
            if status:
                sql += " AND po.status = %s"; params.append(status)
            if risk_level:
                sql += " AND po.risk_level = %s"; params.append(risk_level)
            if user_id:
                sql += " AND po.initiator_user_id = %s"; params.append(user_id)
            if review_state:
                sql += " AND po.review_state = %s"; params.append(review_state)
            if approval_state:
                sql += " AND po.approval_state = %s"; params.append(approval_state)
            if assigned_admin_id:
                sql += " AND po.assigned_admin_id = %s"; params.append(assigned_admin_id)
            elif assigned_mode == 'unassigned':
                sql += " AND po.assigned_admin_id IS NULL"
            if search:
                term = f"%{search.lower()}%"
                sql += " AND (LOWER(po.description) LIKE %s OR LOWER(u.full_name) LIKE %s OR sa.account_number LIKE %s OR ra.account_number LIKE %s)"
                params.extend([term, term, f"%{search}%", f"%{search}%"])
            sql += " ORDER BY po.created_at DESC, po.id DESC LIMIT %s OFFSET %s"
            params += [limit, offset]
            rows = conn.execute(sql, tuple(params)).fetchall()
        return [dict(r) for r in rows]

    def count_orders(self, status: str | None = None,
                     risk_level: str | None = None,
                     user_id: int | None = None,
                     review_state: str | None = None,
                     approval_state: str | None = None,
                     assigned_admin_id: int | None = None,
                     assigned_mode: str | None = None,
                     search: str | None = None) -> int:
        with get_connection() as conn:
            sql = """
                SELECT COUNT(*) AS n
                FROM payment_orders po
                LEFT JOIN users u ON u.id = po.initiator_user_id
                LEFT JOIN accounts sa ON sa.id = po.sender_account_id
                LEFT JOIN accounts ra ON ra.id = po.recipient_account_id
                WHERE 1=1
            """
            params: list = []
            if status:
                sql += " AND po.status = %s"; params.append(status)
            if risk_level:
                sql += " AND po.risk_level = %s"; params.append(risk_level)
            if user_id:
                sql += " AND po.initiator_user_id = %s"; params.append(user_id)
            if review_state:
                sql += " AND po.review_state = %s"; params.append(review_state)
            if approval_state:
                sql += " AND po.approval_state = %s"; params.append(approval_state)
            if assigned_admin_id:
                sql += " AND po.assigned_admin_id = %s"; params.append(assigned_admin_id)
            elif assigned_mode == 'unassigned':
                sql += " AND po.assigned_admin_id IS NULL"
            if search:
                term = f"%{search.lower()}%"
                sql += " AND (LOWER(po.description) LIKE %s OR LOWER(u.full_name) LIKE %s OR sa.account_number LIKE %s OR ra.account_number LIKE %s)"
                params.extend([term, term, f"%{search}%", f"%{search}%"])
            row = conn.execute(sql, tuple(params)).fetchone()
            return int(row['n']) if row else 0

    def create_order_event(self, payment_order_id: int, actor_user_id: int | None,
                           event_type: str, details: str = '') -> int:
        with get_connection() as conn:
            cur = conn.execute(
                """INSERT INTO payment_order_events
                   (payment_order_id, actor_user_id, event_type, details)
                   VALUES (%s,%s,%s,%s)
                """ + get_returning_id_suffix(),
                (payment_order_id, actor_user_id, event_type, details)
            )
            return insert_last_id(cur)

    def list_order_events(self, payment_order_id: int, limit: int = 200) -> list:
        with get_connection() as conn:
            rows = conn.execute(
                """SELECT poe.*,
                          u.full_name AS actor_name,
                          u.role AS actor_role
                   FROM payment_order_events poe
                   LEFT JOIN users u ON u.id = poe.actor_user_id
                   WHERE poe.payment_order_id = %s
                   ORDER BY poe.created_at ASC, poe.id ASC
                   LIMIT %s""",
                (payment_order_id, limit)
            ).fetchall()
        return [dict(r) for r in rows]

    def assign_order(self, order_id: int, assigned_admin_id: int,
                     actor_user_id: int, note: str = '') -> dict | None:
        with get_connection() as conn:
            updated = conn.execute(
                """UPDATE payment_orders
                   SET assigned_admin_id = %s,
                       assigned_at = CURRENT_TIMESTAMP,
                       review_state = CASE WHEN review_state = 'none' THEN 'pending' ELSE review_state END,
                       updated_at = CURRENT_TIMESTAMP
                   WHERE id = %s""",
                (assigned_admin_id, order_id)
            )
            if (updated.rowcount or 0) == 0:
                return None
            conn.execute(
                """INSERT INTO payment_order_events
                   (payment_order_id, actor_user_id, event_type, details)
                   VALUES (%s,%s,'assigned',%s)""",
                (order_id, actor_user_id, f'assigned_to={assigned_admin_id}')
            )
            if note:
                conn.execute(
                    """INSERT INTO payment_order_events
                       (payment_order_id, actor_user_id, event_type, details)
                       VALUES (%s,%s,'note',%s)""",
                    (order_id, actor_user_id, note[:500])
                )
        return self.get_order(order_id)

    def set_manual_decision(self, order_id: int, decision: str,
                            actor_user_id: int, note: str = '') -> dict | None:
        normalized = (decision or '').strip().lower()
        if normalized not in {'approve', 'reject', 'escalate', 'clear'}:
            return None

        with get_connection() as conn:
            if normalized == 'clear':
                updated = conn.execute(
                    """UPDATE payment_orders
                       SET review_state = 'none',
                           decision_by = NULL,
                           decision_note = NULL,
                           decided_at = NULL,
                           approval_state = 'none',
                           approval_requested_action = NULL,
                           approval_requested_by = NULL,
                           approval_requested_at = NULL,
                           approval_decided_by = NULL,
                           approval_decided_at = NULL,
                           approval_note = NULL,
                           updated_at = CURRENT_TIMESTAMP
                       WHERE id = %s""",
                    (order_id,)
                )
                event_type = 'decision_cleared'
                event_details = note[:500]
            elif normalized == 'escalate':
                updated = conn.execute(
                    """UPDATE payment_orders
                       SET review_state = 'escalated',
                           decision_by = %s,
                           decision_note = %s,
                           decided_at = CURRENT_TIMESTAMP,
                           escalation_level = COALESCE(escalation_level, 0) + 1,
                           approval_state = 'none',
                           approval_requested_action = NULL,
                           approval_requested_by = NULL,
                           approval_requested_at = NULL,
                           approval_decided_by = NULL,
                           approval_decided_at = NULL,
                           approval_note = NULL,
                           updated_at = CURRENT_TIMESTAMP
                       WHERE id = %s""",
                    (actor_user_id, note[:500], order_id)
                )
                event_type = 'decision_escalated'
                event_details = note[:500]
            else:
                review_state = 'approved' if normalized == 'approve' else 'rejected'
                updated = conn.execute(
                    """UPDATE payment_orders
                       SET review_state = %s,
                           decision_by = %s,
                           decision_note = %s,
                           decided_at = CURRENT_TIMESTAMP,
                           approval_state = 'none',
                           approval_requested_action = NULL,
                           approval_requested_by = NULL,
                           approval_requested_at = NULL,
                           approval_decided_by = NULL,
                           approval_decided_at = NULL,
                           approval_note = NULL,
                           updated_at = CURRENT_TIMESTAMP
                       WHERE id = %s""",
                    (review_state, actor_user_id, note[:500], order_id)
                )
                event_type = f'decision_{review_state}'
                event_details = note[:500]

            if (updated.rowcount or 0) == 0:
                return None

            conn.execute(
                """INSERT INTO payment_order_events
                   (payment_order_id, actor_user_id, event_type, details)
                   VALUES (%s,%s,%s,%s)""",
                (order_id, actor_user_id, event_type, event_details)
            )
        return self.get_order(order_id)

    def add_order_note(self, order_id: int, actor_user_id: int, note: str) -> bool:
        safe_note = (note or '').strip()[:500]
        if not safe_note:
            return False
        with get_connection() as conn:
            exists = conn.execute(
                'SELECT id FROM payment_orders WHERE id = %s',
                (order_id,)
            ).fetchone()
            if not exists:
                return False
            conn.execute(
                """INSERT INTO payment_order_events
                   (payment_order_id, actor_user_id, event_type, details)
                   VALUES (%s,%s,'note',%s)""",
                (order_id, actor_user_id, safe_note)
            )
            conn.execute(
                'UPDATE payment_orders SET updated_at = CURRENT_TIMESTAMP WHERE id = %s',
                (order_id,)
            )
        return True

    def request_approval(self, order_id: int, requested_action: str,
                         requested_by: int, note: str = '') -> dict | None:
        action = (requested_action or '').strip().lower()
        if action not in {'approve', 'reject'}:
            return None
        safe_note = (note or '').strip()[:500]
        with get_connection() as conn:
            updated = conn.execute(
                """UPDATE payment_orders
                   SET approval_state = 'requested',
                       approval_requested_action = %s,
                       approval_requested_by = %s,
                       approval_requested_at = CURRENT_TIMESTAMP,
                       approval_decided_by = NULL,
                       approval_decided_at = NULL,
                       approval_note = %s,
                       review_state = 'pending',
                       decision_by = %s,
                       decision_note = %s,
                       decided_at = CURRENT_TIMESTAMP,
                       updated_at = CURRENT_TIMESTAMP
                   WHERE id = %s""",
                (action, requested_by, safe_note, requested_by, safe_note, order_id)
            )
            if (updated.rowcount or 0) == 0:
                return None
            conn.execute(
                """INSERT INTO payment_order_events
                   (payment_order_id, actor_user_id, event_type, details)
                   VALUES (%s,%s,'approval_requested',%s)""",
                (order_id, requested_by, f'action={action}; note={safe_note}')
            )
        return self.get_order(order_id)

    def finalize_approval(self, order_id: int, approver_id: int,
                          approve_request: bool, note: str = '') -> dict | None:
        safe_note = (note or '').strip()[:500]
        with get_connection() as conn:
            row = conn.execute(
                """SELECT approval_state, approval_requested_action, approval_requested_by
                   FROM payment_orders
                   WHERE id = %s""",
                (order_id,)
            ).fetchone()
            if not row:
                return None
            approval_state = str(row.get('approval_state') or '').lower()
            requested_action = str(row.get('approval_requested_action') or '').lower()
            requested_by = row.get('approval_requested_by')
            if approval_state != 'requested' or requested_action not in {'approve', 'reject'}:
                return None
            if requested_by and int(requested_by) == int(approver_id):
                return None

            if approve_request:
                review_state = 'approved' if requested_action == 'approve' else 'rejected'
                approval_state_next = 'approved'
            else:
                review_state = 'escalated'
                approval_state_next = 'declined'

            updated = conn.execute(
                """UPDATE payment_orders
                   SET review_state = %s,
                       approval_state = %s,
                       approval_decided_by = %s,
                       approval_decided_at = CURRENT_TIMESTAMP,
                       approval_note = %s,
                       decision_by = %s,
                       decision_note = %s,
                       decided_at = CURRENT_TIMESTAMP,
                       updated_at = CURRENT_TIMESTAMP
                   WHERE id = %s""",
                (review_state, approval_state_next, approver_id, safe_note,
                 approver_id, safe_note, order_id)
            )
            if (updated.rowcount or 0) == 0:
                return None
            conn.execute(
                """INSERT INTO payment_order_events
                   (payment_order_id, actor_user_id, event_type, details)
                   VALUES (%s,%s,'approval_finalized',%s)""",
                (order_id, approver_id,
                 f'approved={approve_request}; requested_action={requested_action}; note={safe_note}')
            )
        return self.get_order(order_id)

    # ── Risk Events ───────────────────────────────────────────────────────────

    def create_risk_event(self, payment_order_id: int, user_id: int,
                          event_type: str, severity: str,
                          score_delta: int, details: str) -> int:
        with get_connection() as conn:
            cur = conn.execute(
                """INSERT INTO risk_events
                   (payment_order_id, user_id, event_type, severity,
                    score_delta, details)
                   VALUES (%s,%s,%s,%s,%s,%s)
                """ + get_returning_id_suffix(),
                (payment_order_id, user_id, event_type, severity,
                 score_delta, details)
            )
            return insert_last_id(cur)

    def list_risk_events(self, limit: int = 100, offset: int = 0,
                         severity: str | None = None,
                         resolved: bool | None = None,
                         user_id: int | None = None) -> list:
        with get_connection() as conn:
            sql = """
                SELECT re.*,
                       u.full_name AS user_name,
                       po.amount AS order_amount,
                       po.status AS order_status
                FROM risk_events re
                LEFT JOIN users u ON u.id = re.user_id
                LEFT JOIN payment_orders po ON po.id = re.payment_order_id
                WHERE 1=1
            """
            params: list = []
            if severity:
                sql += " AND re.severity = %s"; params.append(severity)
            if resolved is True:
                sql += " AND re.resolved_at IS NOT NULL"
            elif resolved is False:
                sql += " AND re.resolved_at IS NULL"
            if user_id:
                sql += " AND re.user_id = %s"; params.append(user_id)
            sql += " ORDER BY re.created_at DESC LIMIT %s OFFSET %s"
            params += [limit, offset]
            rows = conn.execute(sql, tuple(params)).fetchall()
        return [dict(r) for r in rows]

    def resolve_risk_event(self, event_id: int, resolved_by: int) -> bool:
        with get_connection() as conn:
            result = conn.execute(
                """UPDATE risk_events
                   SET resolved_at = CURRENT_TIMESTAMP, resolved_by = %s
                   WHERE id = %s AND resolved_at IS NULL""",
                (resolved_by, event_id)
            )
            return (result.rowcount or 0) > 0

    def fraud_stats(self) -> dict:
        with get_connection() as conn:
            by_level = conn.execute(
                """SELECT risk_level, COUNT(*) AS cnt,
                          COALESCE(SUM(amount),0) AS total_amount
                   FROM payment_orders
                   GROUP BY risk_level"""
            ).fetchall()
            by_status = conn.execute(
                """SELECT status, COUNT(*) AS cnt
                   FROM payment_orders GROUP BY status"""
            ).fetchall()
            by_review_state = conn.execute(
                """SELECT review_state, COUNT(*) AS cnt
                   FROM payment_orders GROUP BY review_state"""
            ).fetchall()
            by_approval_state = conn.execute(
                """SELECT approval_state, COUNT(*) AS cnt
                   FROM payment_orders GROUP BY approval_state"""
            ).fetchall()
            blocked = conn.execute(
                """SELECT COUNT(*) AS n FROM payment_orders
                   WHERE status = 'blocked'"""
            ).fetchone()
            assigned_total = conn.execute(
                """SELECT COUNT(*) AS n FROM payment_orders
                   WHERE assigned_admin_id IS NOT NULL"""
            ).fetchone()
            review_pending = conn.execute(
                """SELECT COUNT(*) AS n FROM payment_orders
                   WHERE review_state IN ('pending', 'escalated')"""
            ).fetchone()
            awaiting_approval = conn.execute(
                """SELECT COUNT(*) AS n FROM payment_orders
                   WHERE approval_state = 'requested'"""
            ).fetchone()
            unresolved_events = conn.execute(
                """SELECT severity, COUNT(*) AS cnt
                   FROM risk_events WHERE resolved_at IS NULL
                   GROUP BY severity"""
            ).fetchall()
            recent_critical = conn.execute(
                """SELECT po.id, po.amount, po.created_at,
                          u.full_name, sa.account_number AS sender
                   FROM payment_orders po
                   JOIN users u ON u.id = po.initiator_user_id
                   JOIN accounts sa ON sa.id = po.sender_account_id
                   WHERE po.risk_level = 'critical'
                   ORDER BY po.created_at DESC LIMIT 5"""
            ).fetchall()
        return {
            'by_level': [dict(r) for r in by_level],
            'by_status': [dict(r) for r in by_status],
            'by_review_state': [dict(r) for r in by_review_state],
            'by_approval_state': [dict(r) for r in by_approval_state],
            'blocked_total': int(blocked['n']) if blocked else 0,
            'assigned_total': int(assigned_total['n']) if assigned_total else 0,
            'review_pending_total': int(review_pending['n']) if review_pending else 0,
            'awaiting_approval_total': int(awaiting_approval['n']) if awaiting_approval else 0,
            'unresolved_events': [dict(r) for r in unresolved_events],
            'recent_critical': [dict(r) for r in recent_critical],
        }

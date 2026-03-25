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
            return insert_last_id(cur)

    def get_order(self, order_id: int) -> dict | None:
        with get_connection() as conn:
            return conn.execute(
                "SELECT * FROM payment_orders WHERE id = %s",
                (order_id,)
            ).fetchone()

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
            conn.execute(
                """UPDATE payment_orders
                   SET status = %s, tx_id_out = %s, tx_id_in = %s,
                       failure_reason = %s, updated_at = NOW()
                   WHERE id = %s""",
                (status, tx_id_out, tx_id_in, failure_reason, order_id)
            )

    def list_orders(self, limit: int = 100, offset: int = 0,
                    status: str | None = None,
                    risk_level: str | None = None,
                    user_id: int | None = None) -> list:
        with get_connection() as conn:
            sql = """
                SELECT po.*,
                       u.full_name AS initiator_name,
                       sa.account_number AS sender_number,
                       ra.account_number AS recipient_number
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
            sql += " ORDER BY po.created_at DESC, po.id DESC LIMIT %s OFFSET %s"
            params += [limit, offset]
            rows = conn.execute(sql, tuple(params)).fetchall()
        return [dict(r) for r in rows]

    def count_orders(self, status: str | None = None,
                     risk_level: str | None = None) -> int:
        with get_connection() as conn:
            sql = "SELECT COUNT(*) AS n FROM payment_orders WHERE 1=1"
            params: list = []
            if status:
                sql += " AND status = %s"; params.append(status)
            if risk_level:
                sql += " AND risk_level = %s"; params.append(risk_level)
            row = conn.execute(sql, tuple(params)).fetchone()
            return int(row['n']) if row else 0

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
                   SET resolved_at = NOW(), resolved_by = %s
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
            blocked = conn.execute(
                """SELECT COUNT(*) AS n FROM payment_orders
                   WHERE status = 'blocked'"""
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
            'blocked_total': int(blocked['n']) if blocked else 0,
            'unresolved_events': [dict(r) for r in unresolved_events],
            'recent_critical': [dict(r) for r in recent_critical],
        }

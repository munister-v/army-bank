"""План з понеділка: розклад не має починатися днем, коли його склали."""
from __future__ import annotations

from datetime import date, timedelta


def _seed(app, owners=('Alpha', 'Beta'), leads=20):
    with app.app_context():
        from backend.database import get_connection
        from backend.routes.leads_routes import _ensure_schema, _ensure_schedule_schema
        _ensure_schema()
        _ensure_schedule_schema()
        with get_connection() as conn:
            # Тести ділять одну базу, тож посів має бути повторюваним.
            conn.execute("DELETE FROM lead_schedule")
            conn.execute("DELETE FROM leads WHERE lead_id LIKE 'T-%'")
            conn.execute("UPDATE users SET crm_owner = NULL WHERE crm_owner IS NOT NULL")
            conn.execute("DELETE FROM users WHERE id >= 900")
            for i, owner in enumerate(owners, start=1):
                conn.execute(
                    "INSERT INTO users (id, full_name, phone, email, password_hash, role, crm_owner) "
                    "VALUES (?, ?, ?, ?, 'x', ?, ?)",
                    (900 + i, owner, f'+3800000000{i}', f'{owner}@example.com',
                     'admin' if i == 1 else 'manager', owner),
                )
            for n in range(leads):
                conn.execute(
                    "INSERT INTO leads (lead_id, business_name, owner, stage, outreach_status, priority) "
                    "VALUES (?, ?, '', 'New', 'Not contacted', 'Medium')",
                    (f'T-{n:04d}', f'Business {n}'),
                )


def _run(app, **kwargs):
    with app.app_context():
        from backend.database import get_connection
        from backend.routes.leads_routes import (
            _assign_unowned_leads_for_schedule, _generate_for_owner, _get_active_managers,
        )
        with get_connection() as conn:
            owners = _get_active_managers(conn)
            _assign_unowned_leads_for_schedule(conn, owners)
            for owner in owners:
                _generate_for_owner(conn, owner, **kwargs)
            return owners, [dict(r) for r in conn.execute(
                "SELECT owner, scheduled_date, COUNT(*) n FROM lead_schedule "
                "GROUP BY owner, scheduled_date ORDER BY scheduled_date, owner"
            ).fetchall()]


def test_owner_list_includes_an_admin_who_carries_leads(app):
    _seed(app)
    with app.app_context():
        from backend.database import get_connection
        from backend.routes.leads_routes import _get_active_managers
        with get_connection() as conn:
            assert _get_active_managers(conn) == ['Alpha', 'Beta']


def test_plan_starts_on_the_requested_day_with_the_requested_quota(app):
    _seed(app)
    start = (date.today() + timedelta(days=7)).isoformat()
    owners, rows = _run(app, daily_quota=4, start_date=start)
    assert owners == ['Alpha', 'Beta']
    assert rows, 'schedule is empty'
    assert min(r['scheduled_date'] for r in rows) >= start
    assert all(r['n'] <= 4 for r in rows)
    for owner in owners:
        first_days = [r for r in rows if r['owner'] == owner][:2]
        assert [d['n'] for d in first_days] == [4, 4]


def test_a_past_start_date_never_backdates_the_plan(app):
    _seed(app)
    _, rows = _run(app, daily_quota=4, start_date='2020-01-06')
    assert min(r['scheduled_date'] for r in rows) >= date.today().isoformat()

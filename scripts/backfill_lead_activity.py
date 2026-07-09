#!/usr/bin/env python3
"""Одноразовий бекфіл: переносить наявне поле leads.notes у lead_activity
як перший системний запис треду (щоб не втратити дані при переході на
чатовий формат). Idempotent — пропускає лідів, у яких вже є активність.

Usage:
    python3 scripts/backfill_lead_activity.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def main() -> None:
    from backend.app import create_app
    from backend.routes.leads_routes import _ensure_schema, _log_activity
    from backend.database import get_connection

    app = create_app()
    with app.app_context():
        _ensure_schema()
        migrated = 0
        skipped = 0
        with get_connection() as conn:
            leads = conn.execute(
                "SELECT id, notes FROM leads WHERE notes IS NOT NULL AND notes != ''"
            ).fetchall()
            for lead in leads:
                lead_id = int(lead['id'])
                existing = conn.execute(
                    'SELECT id FROM lead_activity WHERE lead_id = %s LIMIT 1', (lead_id,)
                ).fetchone()
                if existing:
                    skipped += 1
                    continue
                _log_activity(conn, lead_id, 'Імпорт', 'note', str(lead['notes']))
                migrated += 1

    print(f'Backfilled: {migrated} leads, skipped (already had activity): {skipped}.')


if __name__ == '__main__':
    main()

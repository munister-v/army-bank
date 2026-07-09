#!/usr/bin/env python3
"""Імпорт лідів з database/seed/leads_europe_opening.json у таблицю leads.

Idempotent: матчиться по lead_id, повторний запуск оновлює існуючі записи
замість дублювання. Working directory-незалежний.

Usage:
    python3 scripts/import_leads.py [path/to/leads.json]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

DEFAULT_SEED = ROOT / 'database' / 'seed' / 'leads_europe_opening.json'


def main() -> None:
    seed_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SEED
    with open(seed_path, encoding='utf-8') as f:
        rows = json.load(f)

    for row in rows:
        if 'priority_crm' in row:
            row['priority'] = row.pop('priority_crm')

    from backend.app import create_app
    from backend.routes.leads_routes import _ensure_schema, insertable_cols_for_import
    from backend.database import get_connection, get_returning_id_suffix

    app = create_app()
    with app.app_context():
        _ensure_schema()
        cols = insertable_cols_for_import()
        created = 0
        updated = 0
        with get_connection() as conn:
            for item in rows:
                lead_id = item.get('lead_id')
                if not lead_id:
                    continue
                existing = conn.execute(
                    'SELECT id FROM leads WHERE lead_id = %s', (lead_id,)
                ).fetchone()
                values = [item.get(c) for c in cols]
                if existing:
                    set_sql = ', '.join(f'{c} = %s' for c in cols)
                    conn.execute(
                        f'UPDATE leads SET {set_sql}, updated_at = CURRENT_TIMESTAMP WHERE lead_id = %s',
                        values + [lead_id],
                    )
                    updated += 1
                else:
                    cols_sql = ', '.join(cols)
                    placeholders = ', '.join(['%s'] * len(cols))
                    conn.execute(
                        f'INSERT INTO leads ({cols_sql}) VALUES ({placeholders})' + get_returning_id_suffix(),
                        values,
                    )
                    created += 1

    print(f'Imported: {created} created, {updated} updated, {len(rows)} total rows in file.')


if __name__ == '__main__':
    main()

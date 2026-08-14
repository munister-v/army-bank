"""Етап 0–2: чистка бази лідів, схема під докази, і прогін діагностики.

Запускається на сервері як звичайний скрипт, а не через веб — прогін довгий
(мережеві запити з тротлінгом), і йому нема чого робити всередині gunicorn з
його таймаутом.

    python3 backend/scripts/leads_diagnose.py --db database/army_bank.db --stats
    python3 backend/scripts/leads_diagnose.py --db ... --purge --keep-worked
    python3 backend/scripts/leads_diagnose.py --db ... --diagnose --limit 50

Чистка НІКОЛИ не зносить картки, з якими працювали (стадія не New, або є
листування, або є активність), якщо не сказано --purge-all. Це не ввічливість,
а те, що в базі лежить робота двох менеджерів.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.services import lead_prospector as lp  # noqa: E402

# «З лідом працювали» — це прогрес у воронці або жива нотатка людини.
#
# Перша версія рахувала будь-який рядок у lead_activity і тому визнала
# «опрацьованими» всі 1183 картки: 1149 записів там — kind='system', сліди
# імпорту та автодослідження, а не робота менеджера. Автори 'Імпорт' і 'Codex…'
# з тієї ж причини не рахуються. За чесним визначенням зберігається 51 картка.
WORKED_SQL = """
    stage <> 'New'
    OR outreach_status <> 'Not contacted'
    OR reply_status NOT IN ('No reply yet', '')
    OR (last_touch_date IS NOT NULL AND last_touch_date <> '')
    OR id IN (
        SELECT lead_id FROM lead_activity
        WHERE kind = 'note' AND author <> '' AND author <> 'Імпорт' AND author NOT LIKE 'Codex%'
    )
"""


def migrate(conn: sqlite3.Connection) -> None:
    """Докази окремою таблицею, діагноз — полем на ліді."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS lead_signals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
            signal VARCHAR(40) NOT NULL,
            value TEXT NOT NULL DEFAULT '',
            evidence TEXT NOT NULL DEFAULT '',
            checked_at TIMESTAMP NOT NULL,
            checker_version INTEGER NOT NULL DEFAULT 1
        )
    """)
    conn.execute('CREATE INDEX IF NOT EXISTS idx_lead_signals_lead ON lead_signals(lead_id)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_lead_signals_signal ON lead_signals(signal)')
    existing = {row[1] for row in conn.execute('PRAGMA table_info(leads)')}
    for column, ddl in (
        ('domain', "ALTER TABLE leads ADD COLUMN domain VARCHAR(200) NOT NULL DEFAULT ''"),
        ('domain_source', "ALTER TABLE leads ADD COLUMN domain_source VARCHAR(30) NOT NULL DEFAULT ''"),
        ('diagnosis', "ALTER TABLE leads ADD COLUMN diagnosis VARCHAR(30) NOT NULL DEFAULT ''"),
        ('diagnosis_evidence', "ALTER TABLE leads ADD COLUMN diagnosis_evidence TEXT NOT NULL DEFAULT ''"),
        ('has_whatsapp', 'ALTER TABLE leads ADD COLUMN has_whatsapp INTEGER NOT NULL DEFAULT 0'),
        ('score_why', "ALTER TABLE leads ADD COLUMN score_why TEXT NOT NULL DEFAULT ''"),
        ('checked_at', "ALTER TABLE leads ADD COLUMN checked_at TIMESTAMP"),
    ):
        if column not in existing:
            conn.execute(ddl)
    conn.commit()


def stats(conn: sqlite3.Connection) -> None:
    one = lambda sql: conn.execute(sql).fetchone()[0]  # noqa: E731
    print(f"лідів усього       {one('SELECT COUNT(*) FROM leads')}")
    print(f"з ними працювали   {one(f'SELECT COUNT(*) FROM leads WHERE {WORKED_SQL}')}")
    print('домен відомий      ' + str(one("SELECT COUNT(*) FROM leads WHERE domain <> ''")))
    print('продіагностовано   ' + str(one("SELECT COUNT(*) FROM leads WHERE diagnosis <> ''")))
    print(f"з WhatsApp         {one('SELECT COUNT(*) FROM leads WHERE has_whatsapp = 1')}")
    rows = conn.execute(
        "SELECT diagnosis, COUNT(*) FROM leads WHERE diagnosis <> '' GROUP BY diagnosis ORDER BY 2 DESC"
    ).fetchall()
    for diagnosis, count in rows:
        print(f"   {diagnosis:14} {count}")


def purge(conn: sqlite3.Connection, keep_worked: bool) -> None:
    condition = f'NOT ({WORKED_SQL})' if keep_worked else '1=1'
    doomed = conn.execute(f'SELECT COUNT(*) FROM leads WHERE {condition}').fetchone()[0]
    kept = conn.execute('SELECT COUNT(*) FROM leads').fetchone()[0] - doomed
    conn.execute(f'DELETE FROM lead_activity WHERE lead_id IN (SELECT id FROM leads WHERE {condition})')
    try:
        conn.execute(f'DELETE FROM lead_schedule WHERE lead_id IN (SELECT id FROM leads WHERE {condition})')
    except sqlite3.OperationalError:
        pass
    conn.execute(f'DELETE FROM lead_signals WHERE lead_id IN (SELECT id FROM leads WHERE {condition})')
    conn.execute(f'DELETE FROM leads WHERE {condition}')
    conn.commit()
    print(f'видалено {doomed}, залишено {kept}')


def google_creds(conn: sqlite3.Connection, user_id: int) -> tuple[str, str]:
    """Ключ конкретного менеджера з /prospecting/google-key.

    Ключ лежить зашифрованим тим самим messenger_crypto, що й токени каналів,
    тож розшифровуємо через нього, а не читаємо стовпець напряму.
    """
    if not user_id:
        return ('', '')
    try:
        row = conn.execute(
            'SELECT api_key, cx FROM prospecting_api_keys WHERE user_id = ?', (user_id,)
        ).fetchone()
    except sqlite3.OperationalError:
        return ('', '')
    if not row:
        return ('', '')
    from backend.services.messenger_crypto import decrypt_message
    return (decrypt_message(row[0], fallback=''), row[1] or '')


def diagnose(conn: sqlite3.Connection, limit: int, only_new: bool, creds: tuple[str, str] = ('', '')) -> None:
    conn.row_factory = sqlite3.Row
    where = "WHERE diagnosis = ''" if only_new else ''
    leads = conn.execute(f'SELECT * FROM leads {where} ORDER BY id LIMIT ?', (limit,)).fetchall()
    print(f'на перевірку: {len(leads)}')
    done = 0
    for row in leads:
        lead = dict(row)
        domain, source = lp.resolve_domain(lead, creds)
        result = None
        if domain:
            try:
                result = lp.probe(domain)
            except Exception as exc:  # мережа є мережа: один лід не має валити прогін
                result = {'diagnosis': 'unreachable', 'evidence': f'{type(exc).__name__}: {exc}',
                          'signals': [], 'checked_at': datetime.now(timezone.utc).isoformat(),
                          'checker_version': lp.CHECKER_VERSION}
        signals = (result or {}).get('signals', [])
        has_whatsapp = bool((lead.get('whatsapp_viber') or '').strip()) or any(s[0] == 'whatsapp' for s in signals)
        diagnosis = (result or {}).get('diagnosis') or 'domain_unknown'
        points, why = lp.score(lead, result, has_whatsapp)

        conn.execute(
            'UPDATE leads SET domain=?, domain_source=?, diagnosis=?, diagnosis_evidence=?, '
            'has_whatsapp=?, lead_score=?, score_why=?, checked_at=? WHERE id=?',
            (domain, source, diagnosis, (result or {}).get('evidence') or 'Домен не знайдено серед відомих контактів',
             1 if has_whatsapp else 0, points, json.dumps(why, ensure_ascii=False),
             datetime.now(timezone.utc).isoformat(), lead['id']),
        )
        conn.execute('DELETE FROM lead_signals WHERE lead_id=?', (lead['id'],))
        for name, value, evidence in signals:
            conn.execute(
                'INSERT INTO lead_signals (lead_id, signal, value, evidence, checked_at, checker_version) '
                'VALUES (?,?,?,?,?,?)',
                (lead['id'], name, str(value), evidence,
                 (result or {}).get('checked_at'), lp.CHECKER_VERSION),
            )
        done += 1
        if done % 10 == 0:
            conn.commit()
            print(f'  {done}/{len(leads)}…', flush=True)
    conn.commit()
    print(f'готово: {done}')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', required=True)
    parser.add_argument('--stats', action='store_true')
    parser.add_argument('--purge', action='store_true', help='чистка з --keep-worked за замовчуванням')
    parser.add_argument('--purge-all', action='store_true', help='знести ВСЕ, разом з опрацьованими')
    parser.add_argument('--diagnose', action='store_true')
    parser.add_argument('--limit', type=int, default=50)
    parser.add_argument('--all', action='store_true', help='діагностувати й ті, що вже мають діагноз')
    parser.add_argument('--user', type=int, default=0,
                        help='id менеджера, чиїм ключем Google шукати домени (0 — без пошуку)')
    args = parser.parse_args()

    conn = sqlite3.connect(args.db)
    conn.execute('PRAGMA foreign_keys = ON')
    migrate(conn)
    if args.purge or args.purge_all:
        purge(conn, keep_worked=not args.purge_all)
    if args.diagnose:
        creds = google_creds(conn, args.user)
        print('пошук доменів через Google: ' + ('увімкнено' if creds[0] and creds[1] else 'вимкнено (ключ не заданий)'))
        diagnose(conn, args.limit, only_new=not args.all, creds=creds)
    if args.stats or not (args.purge or args.purge_all or args.diagnose):
        stats(conn)
    conn.close()


if __name__ == '__main__':
    main()

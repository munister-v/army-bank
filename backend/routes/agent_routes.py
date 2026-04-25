"""Admin agent task-runner — SSE streaming endpoint."""
from __future__ import annotations

import json

from flask import Blueprint, Response, jsonify, stream_with_context

from ..config import USE_PG
from ..database import get_connection
from .helpers import auth_required, role_required

agent_bp = Blueprint('agent', __name__)

# ── Task catalogue ─────────────────────────────────────────────────────────────

TASKS = [
    {
        'id': 'daily_summary',
        'name': 'Денний підсумок',
        'desc': 'Нові юзери, транзакції та обсяги за сьогодні',
        'icon': '📊',
        'danger': False,
    },
    {
        'id': 'suspicious_tx',
        'name': 'Підозрілі операції',
        'desc': 'Транзакції > 50 000 ₴ за 24 год і акаунти з > 10 операціями за день',
        'icon': '🔍',
        'danger': False,
    },
    {
        'id': 'balance_audit',
        'name': 'Аудит балансів',
        'desc': 'Рахунки з від\'ємним або нульовим балансом',
        'icon': '⚖️',
        'danger': False,
    },
    {
        'id': 'inactive_users',
        'name': 'Неактивні користувачі',
        'desc': 'Юзери без операцій за останні 30 днів',
        'icon': '😴',
        'danger': False,
    },
    {
        'id': 'large_transfers',
        'name': 'Великі перекази',
        'desc': 'Топ-20 переказів за останні 7 днів за сумою',
        'icon': '💸',
        'danger': False,
    },
    {
        'id': 'role_report',
        'name': 'Звіт по ролях',
        'desc': 'Розподіл користувачів за ролями та активність кожної групи',
        'icon': '👥',
        'danger': False,
    },
]

# ── SSE helpers ────────────────────────────────────────────────────────────────

def _sse(event_type: str, **data) -> str:
    return f'data: {json.dumps({"type": event_type, **data}, ensure_ascii=False)}\n\n'

def _log(text: str, level: str = 'info') -> str:
    return _sse('log', level=level, text=text)

# ── Task implementations ───────────────────────────────────────────────────────

def _run_daily_summary():
    yield _log('Збираю статистику за сьогодні...')

    today = 'CURRENT_DATE' if USE_PG else "DATE('now')"
    week_ago = "NOW() - INTERVAL '7 days'" if USE_PG else "datetime('now', '-7 days')"

    with get_connection() as conn:
        new_users = conn.execute(
            f"SELECT COUNT(*) as n FROM users WHERE DATE(created_at) = {today}"
        ).fetchone()['n']

        tx_row = conn.execute(
            f"SELECT COUNT(*) as n, COALESCE(SUM(amount),0) as vol FROM transactions WHERE DATE(created_at) = {today}"
        ).fetchone()

        active = conn.execute(
            f"""SELECT COUNT(DISTINCT a.user_id) as n
                FROM transactions t JOIN accounts a ON a.id = t.account_id
                WHERE DATE(t.created_at) = {today}"""
        ).fetchone()['n']

        total_bal = float(conn.execute(
            "SELECT COALESCE(SUM(balance),0) as s FROM accounts"
        ).fetchone()['s'])

        tx_week = int(conn.execute(
            f"SELECT COUNT(*) as n FROM transactions WHERE created_at >= {week_ago}"
        ).fetchone()['n'])

    yield _log(f'Нові користувачі сьогодні: {int(new_users)}', 'ok' if new_users else 'info')
    yield _log(f'Транзакцій сьогодні: {int(tx_row["n"])}  |  Обсяг: {float(tx_row["vol"]):,.0f} ₴')
    yield _log(f'Активних акаунтів сьогодні: {int(active)}')
    yield _log(f'Транзакцій за тиждень: {tx_week}')
    yield _log(f'Загальний баланс системи: {total_bal:,.2f} ₴', 'ok')
    yield _sse('done', summary=f'{int(tx_row["n"])} операцій сьогодні, баланс системи {total_bal:,.0f} ₴')


def _run_suspicious_tx():
    yield _log('Аналізую підозрілі операції за 24 год...')

    day_ago = "NOW() - INTERVAL '24 hours'" if USE_PG else "datetime('now', '-1 day')"

    with get_connection() as conn:
        large = conn.execute(
            f"""SELECT t.id, t.amount, t.description, a.account_number, t.created_at
                FROM transactions t JOIN accounts a ON a.id = t.account_id
                WHERE t.amount > 50000 AND t.created_at >= {day_ago}
                ORDER BY t.amount DESC LIMIT 20"""
        ).fetchall()

        heavy = conn.execute(
            f"""SELECT a.account_number, COUNT(*) as cnt, COALESCE(SUM(t.amount),0) as vol
                FROM transactions t JOIN accounts a ON a.id = t.account_id
                WHERE t.created_at >= {day_ago}
                GROUP BY a.account_number HAVING COUNT(*) > 10
                ORDER BY cnt DESC LIMIT 10"""
        ).fetchall()

    if large:
        yield _log(f'⚠ Знайдено {len(large)} транзакцій > 50 000 ₴:', 'warn')
        for tx in large:
            desc = str(tx['description'] or '')[:40]
            yield _log(f'  #{tx["id"]}  {float(tx["amount"]):>12,.0f} ₴  {tx["account_number"]}  {desc}')
    else:
        yield _log('Великих транзакцій не знайдено.', 'ok')

    if heavy:
        yield _log(f'⚠ Акаунти з > 10 операцій за добу:', 'warn')
        for row in heavy:
            yield _log(f'  {row["account_number"]}  —  {row["cnt"]} операцій  /  {float(row["vol"]):,.0f} ₴')
    else:
        yield _log('Надмірно активних акаунтів не знайдено.', 'ok')

    yield _sse('done', summary=f'{len(large)} великих tx, {len(heavy)} активних акаунтів.')


def _run_balance_audit():
    yield _log('Перевіряю стан балансів...')

    with get_connection() as conn:
        total = int(conn.execute("SELECT COUNT(*) as n FROM accounts").fetchone()['n'])
        zero = int(conn.execute("SELECT COUNT(*) as n FROM accounts WHERE balance = 0").fetchone()['n'])
        negative = conn.execute(
            """SELECT a.account_number, a.balance, u.name
               FROM accounts a JOIN users u ON u.id = a.user_id
               WHERE a.balance < 0 ORDER BY a.balance ASC LIMIT 50"""
        ).fetchall()

    yield _log(f'Всього рахунків: {total}')
    yield _log(f'Нульовий баланс: {zero}')

    if negative:
        yield _log(f'❗ Від\'ємний баланс у {len(negative)} рахунків:', 'error')
        for row in negative:
            yield _log(f'  {row["account_number"]}  ({row["name"]})  —  {float(row["balance"]):,.2f} ₴', 'error')
    else:
        yield _log('Від\'ємних балансів немає. ✓', 'ok')

    yield _sse('done', summary=f'Від\'ємних: {len(negative)} / {total} рахунків.')


def _run_inactive_users():
    yield _log('Шукаю неактивних користувачів (30+ днів)...')

    cutoff = "NOW() - INTERVAL '30 days'" if USE_PG else "datetime('now', '-30 days')"
    nulls_last = 'NULLS FIRST' if USE_PG else ''

    with get_connection() as conn:
        rows = conn.execute(
            f"""SELECT u.id, u.name, u.role, MAX(t.created_at) as last_tx
                FROM users u
                LEFT JOIN accounts a ON a.user_id = u.id
                LEFT JOIN transactions t ON t.account_id = a.id
                WHERE u.role NOT IN ('admin', 'platform_admin')
                GROUP BY u.id, u.name, u.role
                HAVING MAX(t.created_at) < {cutoff} OR MAX(t.created_at) IS NULL
                ORDER BY last_tx ASC {nulls_last}
                LIMIT 50"""
        ).fetchall()

    yield _log(f'Знайдено {len(rows)} неактивних:', 'warn' if rows else 'ok')
    for u in rows[:25]:
        last = u['last_tx']
        last_str = str(last)[:10] if last else 'ніколи'
        yield _log(f'  [{u["role"]:>10}]  {u["name"]}  —  {last_str}')
    if len(rows) > 25:
        yield _log(f'  ... і ще {len(rows) - 25}')

    yield _sse('done', summary=f'{len(rows)} неактивних користувачів.')


def _run_large_transfers():
    yield _log('Топ-20 переказів за останні 7 днів...')

    week_ago = "NOW() - INTERVAL '7 days'" if USE_PG else "datetime('now', '-7 days')"

    with get_connection() as conn:
        rows = conn.execute(
            f"""SELECT t.id, t.amount, t.direction, t.description, a.account_number, t.created_at
                FROM transactions t JOIN accounts a ON a.id = t.account_id
                WHERE t.created_at >= {week_ago}
                ORDER BY t.amount DESC LIMIT 20"""
        ).fetchall()

    total_vol = sum(float(r['amount']) for r in rows)
    yield _log(f'Показую {len(rows)} транзакцій (загалом {total_vol:,.0f} ₴):')
    for i, row in enumerate(rows, 1):
        arrow = '↑' if row['direction'] == 'in' else '↓'
        desc = str(row['description'] or '')[:35]
        ts = str(row['created_at'])[:10]
        yield _log(f'  {i:>2}. {arrow} {float(row["amount"]):>12,.0f} ₴  {row["account_number"]}  {ts}  {desc}')

    yield _sse('done', summary=f'Топ-{len(rows)}, загальний обсяг {total_vol:,.0f} ₴.')


def _run_role_report():
    yield _log('Збираю звіт по ролях...')

    with get_connection() as conn:
        by_role = conn.execute(
            "SELECT role, COUNT(*) as cnt FROM users GROUP BY role ORDER BY cnt DESC"
        ).fetchall()

        active_30d = conn.execute(
            """SELECT u.role, COUNT(DISTINCT u.id) as cnt
               FROM users u
               JOIN accounts a ON a.user_id = u.id
               JOIN transactions t ON t.account_id = a.id
               WHERE t.created_at >= (
                   CASE WHEN %(pg)s THEN NOW() - INTERVAL '30 days'
                        ELSE datetime('now', '-30 days') END
               )
               GROUP BY u.role""" if False else
            f"""SELECT u.role, COUNT(DISTINCT u.id) as cnt
               FROM users u
               JOIN accounts a ON a.user_id = u.id
               JOIN transactions t ON t.account_id = a.id
               WHERE t.created_at >= {'NOW() - INTERVAL \'30 days\'' if USE_PG else "datetime('now', '-30 days')"}
               GROUP BY u.role"""
        ).fetchall()

    active_map = {r['role']: int(r['cnt']) for r in active_30d}
    total_users = sum(int(r['cnt']) for r in by_role)

    yield _log(f'Всього користувачів: {total_users}')
    yield _log('')
    for row in by_role:
        role = row['role']
        cnt = int(row['cnt'])
        act = active_map.get(role, 0)
        pct = round(cnt / total_users * 100) if total_users else 0
        yield _log(f'  {role:>16}  —  {cnt:>4} юзерів ({pct}%)  |  активних 30д: {act}')

    yield _sse('done', summary=f'{total_users} юзерів у {len(by_role)} ролях.')


TASK_RUNNERS = {
    'daily_summary':  _run_daily_summary,
    'suspicious_tx':  _run_suspicious_tx,
    'balance_audit':  _run_balance_audit,
    'inactive_users': _run_inactive_users,
    'large_transfers': _run_large_transfers,
    'role_report':    _run_role_report,
}

# ── Routes ─────────────────────────────────────────────────────────────────────

@agent_bp.get('/tasks')
@auth_required
@role_required('admin', 'platform_admin')
def list_tasks():
    return jsonify({'ok': True, 'data': TASKS})


@agent_bp.post('/run/<task_id>')
@auth_required
@role_required('admin', 'platform_admin')
def run_task(task_id: str):
    runner = TASK_RUNNERS.get(task_id)
    if not runner:
        return jsonify({'ok': False, 'error': 'Невідомий агент.'}), 404

    def generate():
        try:
            yield _log(f'▶ {task_id}', 'dim')
            yield from runner()
        except Exception as exc:
            yield _log(f'Помилка виконання: {exc}', 'error')
            yield _sse('done', summary=f'Помилка: {exc}')

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )

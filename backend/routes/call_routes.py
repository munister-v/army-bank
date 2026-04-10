"""Сигналінг для WebRTC дзвінків — Army Bank Messenger."""
from __future__ import annotations
import json
import os
import urllib.request
from flask import Blueprint, jsonify, request, g
from ..database import get_connection
from ..config import USE_PG, MESSENGER_CALL_PENDING_TIMEOUT_SECONDS, MESSENGER_ICE_SERVERS
from .helpers import api_error, auth_required
from .push_routes import send_push

_METERED_API_KEY = os.getenv('METERED_API_KEY', '7c67a9a42814a9d646b83f6b3f805d0a84f4')
_METERED_APP_DOMAIN = os.getenv('METERED_APP_DOMAIN', 'army')

def _get_metered_ice_servers():
    """Fetch fresh ICE servers from Metered.ca API."""
    try:
        url = f'https://{_METERED_APP_DOMAIN}.metered.live/api/v1/turn/credentials?apiKey={_METERED_API_KEY}'
        with urllib.request.urlopen(url, timeout=3) as resp:
            data = json.loads(resp.read())
            if isinstance(data, list) and data:
                return data
    except Exception:
        pass
    return None

call_bp = Blueprint('calls', __name__, url_prefix='/api/messenger/calls')

_TRUE  = True  if USE_PG else 1
_FALSE = False if USE_PG else 0


def _now_sql():
    return 'NOW()' if USE_PG else "datetime('now')"


def _insert_call_message(conn, call_id: int, status: str) -> None:
    """Insert a call record as a system message in the conversation."""
    try:
        call = conn.execute(
            "SELECT conversation_id, caller_id, started_at, ended_at FROM calls WHERE id = %s",
            (call_id,),
        ).fetchone()
        if not call:
            return
        conv_id = call['conversation_id']
        caller_id = call['caller_id']
        duration = None
        if call.get('started_at') and call.get('ended_at'):
            try:
                if USE_PG:
                    dur_row = conn.execute(
                        "SELECT EXTRACT(EPOCH FROM (ended_at - started_at))::int AS dur FROM calls WHERE id = %s",
                        (call_id,),
                    ).fetchone()
                    duration = dur_row['dur'] if dur_row else None
                else:
                    dur_row = conn.execute(
                        "SELECT CAST((strftime('%s', ended_at) - strftime('%s', started_at)) AS INTEGER) as dur FROM calls WHERE id = %s",
                        (call_id,),
                    ).fetchone()
                    duration = dur_row['dur'] if dur_row else None
            except Exception:
                pass
        content = {'call_status': status, 'duration': duration, 'caller_id': caller_id}
        import json as _json
        conn.execute(
            f"INSERT INTO messages (conversation_id, sender_id, msg_type, text, created_at) VALUES (%s, %s, 'call', %s, {_now_sql()})",
            (conv_id, caller_id, _json.dumps(content)),
        )
    except Exception:
        pass


def _conv_participant_ids(conn, conv_id: int) -> list[int]:
    rows = conn.execute(
        'SELECT user_id FROM conversation_participants WHERE conversation_id = %s',
        (conv_id,),
    ).fetchall()
    out: list[int] = []
    for row in rows:
        try:
            uid = int(row['user_id'])
        except Exception:
            continue
        if uid not in out:
            out.append(uid)
    return out


def _user_name(conn, user_id: int) -> str:
    row = conn.execute('SELECT full_name FROM users WHERE id = %s', (user_id,)).fetchone()
    name = (row or {}).get('full_name') if row else None
    return str(name or 'Користувач')


def _notify_call_participants(conn, conv_id: int, sender_id: int, title: str, body: str, push_type: str) -> None:
    participants = _conv_participant_ids(conn, conv_id)
    for uid in participants:
        if uid == sender_id:
            continue
        try:
            send_push(uid, title, body, '/messenger', push_type)
        except Exception:
            pass


def _is_participant(conn, conv_id: int, user_id: int) -> bool:
    row = conn.execute(
        'SELECT id FROM conversation_participants WHERE conversation_id = %s AND user_id = %s',
        (conv_id, user_id),
    ).fetchone()
    return bool(row)


def _expire_stale_pending_calls(conn, conv_id: int | None = None) -> int:
    timeout_sec = max(15, int(MESSENGER_CALL_PENDING_TIMEOUT_SECONDS or 45))
    conv_sql = ''
    params = [timeout_sec]
    if conv_id is not None:
        conv_sql = ' AND conversation_id = %s'
        params.append(conv_id)

    if USE_PG:
        rows = conn.execute(
            f"""
            SELECT id
            FROM calls
            WHERE status = 'pending'
              AND EXTRACT(EPOCH FROM (NOW() - created_at)) > %s
              {conv_sql}
            """,
            tuple(params),
        ).fetchall()
    else:
        rows = conn.execute(
            f"""
            SELECT id
            FROM calls
            WHERE status = 'pending'
              AND (strftime('%s', 'now') - strftime('%s', created_at)) > %s
              {conv_sql}
            """,
            tuple(params),
        ).fetchall()

    stale_ids = [int(r['id']) for r in rows if r and r.get('id') is not None]
    if not stale_ids:
        return 0

    placeholders = ','.join(['%s'] * len(stale_ids))
    conn.execute(
        f"UPDATE calls SET status='missed', ended_at={_now_sql()} WHERE id IN ({placeholders})",
        tuple(stale_ids),
    )
    try:
        for sid in stale_ids:
            row = conn.execute(
                'SELECT conversation_id, caller_id FROM calls WHERE id = %s',
                (sid,),
            ).fetchone()
            if not row:
                continue
            caller_id = int(row['caller_id'])
            send_push(
                caller_id,
                'Пропущений дзвінок',
                'Абонент не відповів у заданий час.',
                '/messenger',
                'call_missed',
            )
    except Exception:
        pass
    return len(stale_ids)


@call_bp.get('/config')
@auth_required
def call_config():
    # Try Metered.ca dynamic credentials first, fall back to static config
    ice_servers = _get_metered_ice_servers() or MESSENGER_ICE_SERVERS
    return jsonify({
        'ok': True,
        'data': {
            'pending_timeout_seconds': max(15, int(MESSENGER_CALL_PENDING_TIMEOUT_SECONDS or 45)),
            'ice_servers': ice_servers,
        },
    })


# ── Ініціювати дзвінок ────────────────────────────────────────────────────────
@call_bp.post('')
@auth_required
def start_call():
    """Caller надсилає SDP offer, зберігаємо запис в calls."""
    me_id = g.current_user['id']
    data  = request.get_json(force=True) or {}
    raw_conv_id = data.get('conversation_id')
    sdp_offer = data.get('sdp_offer')

    if raw_conv_id is None or not sdp_offer:
        return api_error('conversation_id і sdp_offer обов\'язкові.')
    try:
        conv_id = int(raw_conv_id)
    except (TypeError, ValueError):
        return api_error('conversation_id має бути числом.', 400)
    sdp_offer = str(sdp_offer).strip()
    if not sdp_offer:
        return api_error('sdp_offer порожній.', 400)
    if len(sdp_offer) > 120_000:
        return api_error('sdp_offer занадто великий.', 400)

    with get_connection() as conn:
        if not _is_participant(conn, conv_id, me_id):
            return api_error('Доступ заборонено.', 403)
        _expire_stale_pending_calls(conn, conv_id)

        # Відхиляємо якщо вже є активний дзвінок у цій розмові
        active = conn.execute(
            "SELECT id FROM calls WHERE conversation_id = %s AND status IN ('pending','active')",
            (conv_id,),
        ).fetchone()
        if active:
            return api_error('Вже є активний дзвінок у цій розмові.', 409)

        if USE_PG:
            cur = conn.execute(
                'INSERT INTO calls(conversation_id, caller_id, sdp_offer) VALUES(%s,%s,%s) RETURNING id',
                (conv_id, me_id, sdp_offer),
            )
            call_id = cur.fetchone()['id']
        else:
            conn.execute(
                'INSERT INTO calls(conversation_id, caller_id, sdp_offer) VALUES(%s,%s,%s)',
                (conv_id, me_id, sdp_offer),
            )
            call_id = conn.execute('SELECT last_insert_rowid() AS id').fetchone()['id']
        caller_name = _user_name(conn, me_id)
        _notify_call_participants(
            conn,
            conv_id,
            me_id,
            'Вхідний дзвінок',
            f'{caller_name} телефонує вам у Messenger.',
            'call_incoming',
        )

    return jsonify({'ok': True, 'data': {'call_id': call_id}})


# ── Список вхідних/активних дзвінків ─────────────────────────────────────────
@call_bp.get('/incoming')
@auth_required
def incoming_calls():
    """Повертає pending дзвінки де я є учасником (не caller)."""
    me_id = g.current_user['id']
    with get_connection() as conn:
        _expire_stale_pending_calls(conn)
        rows = conn.execute(
            """
            SELECT c.id, c.conversation_id, c.caller_id, c.status,
                   c.sdp_offer, c.sdp_answer, c.created_at,
                   u.full_name AS caller_name
            FROM calls c
            JOIN users u ON u.id = c.caller_id
            JOIN conversation_participants cp ON cp.conversation_id = c.conversation_id
            WHERE cp.user_id = %s
              AND c.caller_id != %s
              AND c.status = 'pending'
            ORDER BY c.created_at DESC
            LIMIT 5
            """,
            (me_id, me_id),
        ).fetchall()
    return jsonify({'ok': True, 'data': [dict(r) for r in rows]})


# ── Отримати стан дзвінка (polling) ──────────────────────────────────────────
@call_bp.get('/<int:call_id>')
@auth_required
def get_call(call_id: int):
    me_id = g.current_user['id']
    with get_connection() as conn:
        _expire_stale_pending_calls(conn)
        row = conn.execute(
            """
            SELECT c.id, c.conversation_id, c.caller_id, c.status,
                   c.sdp_offer, c.sdp_answer, c.created_at, c.started_at, c.ended_at,
                   u.full_name AS caller_name
            FROM calls c
            JOIN users u ON u.id = c.caller_id
            WHERE c.id = %s
            """,
            (call_id,),
        ).fetchone()
        if not row:
            return api_error('Дзвінок не знайдено.', 404)
        if not _is_participant(conn, row['conversation_id'], me_id):
            return api_error('Доступ заборонено.', 403)
    return jsonify({'ok': True, 'data': dict(row)})


# ── Прийняти дзвінок (callee надсилає SDP answer) ────────────────────────────
@call_bp.put('/<int:call_id>/answer')
@auth_required
def answer_call(call_id: int):
    me_id = g.current_user['id']
    data  = request.get_json(force=True) or {}
    sdp_answer = str(data.get('sdp_answer') or '').strip()
    if not sdp_answer:
        return api_error('sdp_answer обов\'язковий.')
    if len(sdp_answer) > 120_000:
        return api_error('sdp_answer занадто великий.', 400)

    with get_connection() as conn:
        _expire_stale_pending_calls(conn)
        row = conn.execute('SELECT * FROM calls WHERE id = %s', (call_id,)).fetchone()
        if not row:
            return api_error('Дзвінок не знайдено.', 404)
        if row['caller_id'] == me_id:
            return api_error('Caller не може відповідати на власний дзвінок.')
        if row['status'] == 'missed':
            return api_error('Дзвінок прострочено.', 410)
        if row['status'] not in ('pending', 'active'):
            return api_error('Дзвінок вже не очікує відповіді.')
        if not _is_participant(conn, row['conversation_id'], me_id):
            return api_error('Доступ заборонено.', 403)

        conn.execute(
            f"UPDATE calls SET status='active', sdp_answer=%s, started_at={_now_sql()} WHERE id=%s",
            (sdp_answer, call_id),
        )
        callee_name = _user_name(conn, me_id)
        try:
            send_push(
                int(row['caller_id']),
                'Дзвінок прийнято',
                f'{callee_name} приєднався до дзвінка.',
                '/messenger',
                'call_answered',
            )
        except Exception:
            pass
    return jsonify({'ok': True})


# ── Оновлений offer (ICE restart) ──────────────────────────────────────────────
@call_bp.put('/<int:call_id>/offer')
@auth_required
def update_offer(call_id: int):
    """Caller надсилає новий offer при ICE restart."""
    me_id = g.current_user['id']
    data  = request.get_json(force=True) or {}
    sdp_offer = str(data.get('sdp_offer') or '').strip()
    if not sdp_offer:
        return api_error('sdp_offer обов\'язковий.')
    if len(sdp_offer) > 120_000:
        return api_error('sdp_offer занадто великий.', 400)

    with get_connection() as conn:
        row = conn.execute('SELECT * FROM calls WHERE id = %s', (call_id,)).fetchone()
        if not row:
            return api_error('Дзвінок не знайдено.', 404)
        if row['caller_id'] != me_id:
            return api_error('Тільки caller може надсилати новий offer.', 403)
        if row['status'] != 'active':
            return api_error('Дзвінок не активний.', 400)
        if not _is_participant(conn, row['conversation_id'], me_id):
            return api_error('Доступ заборонено.', 403)

        # Clear answer so callee knows there's a new offer (ICE restart)
        conn.execute(
            f"UPDATE calls SET sdp_offer=%s, sdp_answer=NULL WHERE id=%s",
            (sdp_offer, call_id),
        )
    return jsonify({'ok': True})


# ── Відхилити дзвінок ─────────────────────────────────────────────────────────
@call_bp.put('/<int:call_id>/reject')
@auth_required
def reject_call(call_id: int):
    me_id = g.current_user['id']
    with get_connection() as conn:
        row = conn.execute('SELECT * FROM calls WHERE id = %s', (call_id,)).fetchone()
        if not row or row['status'] not in ('pending',):
            return api_error('Дзвінок не знайдено або не активний.', 404)
        if not _is_participant(conn, row['conversation_id'], me_id):
            return api_error('Доступ заборонено.', 403)
        conn.execute(
            f"UPDATE calls SET status='rejected', ended_at={_now_sql()} WHERE id=%s", (call_id,)
        )
        _insert_call_message(conn, call_id, 'rejected')
        rejecter = _user_name(conn, me_id)
        try:
            send_push(
                int(row['caller_id']),
                'Дзвінок відхилено',
                f'{rejecter} відхилив(ла) виклик.',
                '/messenger',
                'call_rejected',
            )
        except Exception:
            pass
    return jsonify({'ok': True})


# ── Завершити дзвінок ─────────────────────────────────────────────────────────
@call_bp.put('/<int:call_id>/end')
@auth_required
def end_call(call_id: int):
    me_id = g.current_user['id']
    with get_connection() as conn:
        row = conn.execute('SELECT * FROM calls WHERE id = %s', (call_id,)).fetchone()
        if not row:
            return api_error('Дзвінок не знайдено.', 404)
        if not _is_participant(conn, row['conversation_id'], me_id):
            return api_error('Доступ заборонено.', 403)
        conn.execute(
            f"UPDATE calls SET status='ended', ended_at={_now_sql()} WHERE id=%s", (call_id,)
        )
        _insert_call_message(conn, call_id, 'ended')
        ender = _user_name(conn, me_id)
        _notify_call_participants(
            conn,
            int(row['conversation_id']),
            me_id,
            'Дзвінок завершено',
            f'{ender} завершив(ла) дзвінок.',
            'call_ended',
        )
    return jsonify({'ok': True})


# ── ICE candidates ────────────────────────────────────────────────────────────
@call_bp.post('/<int:call_id>/ice')
@auth_required
def add_ice(call_id: int):
    me_id    = g.current_user['id']
    data     = request.get_json(force=True) or {}
    candidate = data.get('candidate')
    if not candidate:
        return api_error('candidate обов\'язковий.')

    # Accept string or object
    if isinstance(candidate, dict):
        candidate = json.dumps(candidate)
    candidate = str(candidate)
    if len(candidate) > 20_000:
        return api_error('candidate занадто великий.', 400)

    with get_connection() as conn:
        row = conn.execute('SELECT conversation_id FROM calls WHERE id = %s', (call_id,)).fetchone()
        if not row:
            return api_error('Дзвінок не знайдено.', 404)
        if not _is_participant(conn, row['conversation_id'], me_id):
            return api_error('Доступ заборонено.', 403)
        conn.execute(
            'INSERT INTO call_ice(call_id, user_id, candidate) VALUES(%s,%s,%s)',
            (call_id, me_id, candidate),
        )
    return jsonify({'ok': True})


@call_bp.get('/<int:call_id>/ice')
@auth_required
def get_ice(call_id: int):
    """Повертає ICE кандидатів від співрозмовника після after_id."""
    me_id    = g.current_user['id']
    after_id = request.args.get('after_id', 0, type=int)

    with get_connection() as conn:
        row = conn.execute('SELECT conversation_id FROM calls WHERE id = %s', (call_id,)).fetchone()
        if not row:
            return api_error('Дзвінок не знайдено.', 404)
        if not _is_participant(conn, row['conversation_id'], me_id):
            return api_error('Доступ заборонено.', 403)

        # Return all candidates for this call after after_id
        # Client will add them to peer connection - browser handles duplicates gracefully
        rows = conn.execute(
            """
            SELECT id, user_id, candidate
            FROM call_ice
            WHERE call_id = %s AND id > %s
            ORDER BY id ASC
            LIMIT 50
            """,
            (call_id, after_id),
        ).fetchall()

    return jsonify({'ok': True, 'data': [dict(r) for r in rows]})

"""Сигналінг для WebRTC дзвінків — ARM CRM Messenger."""
from __future__ import annotations

import json
import os
import urllib.request
from typing import Any

from flask import Blueprint, g, jsonify, request

from ..config import MESSENGER_CALL_PENDING_TIMEOUT_SECONDS, MESSENGER_ICE_SERVERS, USE_PG
from ..database import get_connection
from .helpers import api_error, auth_required
from .push_routes import send_push

_METERED_API_KEY = os.getenv('METERED_API_KEY', '7c67a9a42814a9d646b83f6b3f805d0a84f4')
_METERED_APP_DOMAIN = os.getenv('METERED_APP_DOMAIN', 'army')

call_bp = Blueprint('calls', __name__, url_prefix='/api/messenger/calls')

_TRUE = True if USE_PG else 1
_FALSE = False if USE_PG else 0


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


def _now_sql() -> str:
    return 'NOW()' if USE_PG else "datetime('now')"


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


def _notify_call_participants(
    conn,
    conv_id: int,
    sender_id: int,
    title: str,
    body: str,
    push_type: str,
    call_id: int | None = None,
) -> None:
    participants = _conv_participant_ids(conn, conv_id)
    for uid in participants:
        if uid == sender_id:
            continue
        try:
            send_push(
                uid,
                title,
                body,
                f'/messenger?conv={conv_id}',
                push_type,
                meta={'conversation_id': int(conv_id), 'call_id': int(call_id or 0)},
            )
        except Exception:
            pass


def _is_participant(conn, conv_id: int, user_id: int) -> bool:
    row = conn.execute(
        'SELECT id FROM conversation_participants WHERE conversation_id = %s AND user_id = %s',
        (conv_id, user_id),
    ).fetchone()
    return bool(row)


def _conversation_meta(conn, conv_id: int) -> dict[str, Any] | None:
    row = conn.execute(
        'SELECT id, COALESCE(is_group, %s) AS is_group, group_name FROM conversations WHERE id = %s',
        (_FALSE, conv_id),
    ).fetchone()
    if not row:
        return None
    return {
        'id': int(row['id']),
        'is_group': bool(row.get('is_group')),
        'group_name': str(row.get('group_name') or '').strip(),
    }


def _call_with_meta(conn, call_id: int) -> dict[str, Any] | None:
    row = conn.execute(
        """
        SELECT c.*,
               COALESCE(conv.is_group, %s) AS is_group,
               conv.group_name
        FROM calls c
        JOIN conversations conv ON conv.id = c.conversation_id
        WHERE c.id = %s
        """,
        (_FALSE, call_id),
    ).fetchone()
    if not row:
        return None
    payload = dict(row)
    payload['is_group'] = bool(payload.get('is_group'))
    payload['group_name'] = str(payload.get('group_name') or '').strip()
    return payload


def _set_call_member_state(
    conn,
    call_id: int,
    user_id: int,
    state: str,
    *,
    mark_joined: bool = False,
    mark_left: bool = False,
) -> None:
    existing = conn.execute(
        'SELECT id FROM call_members WHERE call_id = %s AND user_id = %s',
        (call_id, user_id),
    ).fetchone()
    if existing:
        sql = f"UPDATE call_members SET state=%s, updated_at={_now_sql()}"
        params: list[Any] = [state]
        if mark_joined:
            sql += f", joined_at=COALESCE(joined_at, {_now_sql()})"
        if mark_left:
            sql += f", left_at={_now_sql()}"
        sql += ' WHERE call_id = %s AND user_id = %s'
        params.extend([call_id, user_id])
        conn.execute(sql, tuple(params))
        return

    joined_sql = _now_sql() if mark_joined else 'NULL'
    left_sql = _now_sql() if mark_left else 'NULL'
    conn.execute(
        f"""
        INSERT INTO call_members(call_id, user_id, state, joined_at, left_at, created_at, updated_at)
        VALUES(%s, %s, %s, {joined_sql}, {left_sql}, {_now_sql()}, {_now_sql()})
        """,
        (call_id, user_id, state),
    )


def _member_state_for(conn, call_id: int, user_id: int) -> str | None:
    row = conn.execute(
        'SELECT state FROM call_members WHERE call_id = %s AND user_id = %s',
        (call_id, user_id),
    ).fetchone()
    if not row:
        return None
    return str(row.get('state') or '')


def _get_call_members(conn, call_id: int) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT cm.user_id, cm.state, cm.joined_at, cm.left_at, cm.updated_at,
               u.full_name
        FROM call_members cm
        JOIN users u ON u.id = cm.user_id
        WHERE cm.call_id = %s
        ORDER BY cm.updated_at DESC, cm.user_id ASC
        """,
        (call_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def _is_group_call(call_row: dict[str, Any]) -> bool:
    return bool(call_row.get('is_group'))


def _count_group_members(conn, call_id: int, states: tuple[str, ...], *, exclude_user_id: int | None = None) -> int:
    if not states:
        return 0
    placeholders = ','.join(['%s'] * len(states))
    params: list[Any] = [call_id, *states]
    sql = f"SELECT COUNT(*) AS cnt FROM call_members WHERE call_id = %s AND state IN ({placeholders})"
    if exclude_user_id is not None:
        sql += ' AND user_id != %s'
        params.append(exclude_user_id)
    row = conn.execute(sql, tuple(params)).fetchone()
    return int((row or {}).get('cnt') or 0)


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
                        "SELECT CAST((strftime('%s', ended_at) - strftime('%s', started_at)) AS INTEGER) AS dur FROM calls WHERE id = %s",
                        (call_id,),
                    ).fetchone()
                    duration = dur_row['dur'] if dur_row else None
            except Exception:
                pass
        content = {'call_status': status, 'duration': duration, 'caller_id': caller_id}
        conn.execute(
            f"INSERT INTO messages (conversation_id, sender_id, msg_type, text, created_at) VALUES (%s, %s, 'call', %s, {_now_sql()})",
            (conv_id, caller_id, json.dumps(content)),
        )
    except Exception:
        pass


def _expire_stale_pending_calls(conn, conv_id: int | None = None) -> int:
    timeout_sec = max(15, int(MESSENGER_CALL_PENDING_TIMEOUT_SECONDS or 45))
    conv_sql = ''
    params: list[Any] = [timeout_sec]
    if conv_id is not None:
        conv_sql = ' AND c.conversation_id = %s'
        params.append(conv_id)

    if USE_PG:
        rows = conn.execute(
            f"""
            SELECT c.id
            FROM calls c
            WHERE c.status = 'pending'
              AND EXTRACT(EPOCH FROM (NOW() - c.created_at)) > %s
              {conv_sql}
            """,
            tuple(params),
        ).fetchall()
    else:
        rows = conn.execute(
            f"""
            SELECT c.id
            FROM calls c
            WHERE c.status = 'pending'
              AND (strftime('%s', 'now') - strftime('%s', c.created_at)) > %s
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
    for sid in stale_ids:
        row = _call_with_meta(conn, sid)
        if not row:
            continue
        if _is_group_call(row):
            conn.execute(
                f"""
                UPDATE call_members
                SET state = CASE WHEN state IN ('invited','ringing') THEN 'missed' ELSE state END,
                    left_at = CASE WHEN state IN ('invited','ringing') THEN {_now_sql()} ELSE left_at END,
                    updated_at = {_now_sql()}
                WHERE call_id = %s
                """,
                (sid,),
            )
        try:
            send_push(
                int(row['caller_id']),
                'Пропущений дзвінок',
                'Абонент не відповів у заданий час.',
                f'/messenger?conv={int(row["conversation_id"])}',
                'call_missed',
                meta={'conversation_id': int(row['conversation_id']), 'call_id': int(sid)},
            )
        except Exception:
            pass
    return len(stale_ids)


@call_bp.get('/config')
@auth_required
def call_config():
    ice_servers = _get_metered_ice_servers() or MESSENGER_ICE_SERVERS
    return jsonify({
        'ok': True,
        'data': {
            'pending_timeout_seconds': max(15, int(MESSENGER_CALL_PENDING_TIMEOUT_SECONDS or 45)),
            'ice_servers': ice_servers,
        },
    })


@call_bp.post('')
@auth_required
def start_call():
    """Старт дзвінка: 1:1 (sdp_offer) або груповий (без offer, mesh-сигналінг)."""
    me_id = int(g.current_user['id'])
    data = request.get_json(force=True) or {}
    raw_conv_id = data.get('conversation_id')

    if raw_conv_id is None:
        return api_error('conversation_id обов\'язковий.')
    try:
        conv_id = int(raw_conv_id)
    except (TypeError, ValueError):
        return api_error('conversation_id має бути числом.', 400)

    with get_connection() as conn:
        if not _is_participant(conn, conv_id, me_id):
            return api_error('Доступ заборонено.', 403)

        conv_meta = _conversation_meta(conn, conv_id)
        if not conv_meta:
            return api_error('Розмову не знайдено.', 404)

        _expire_stale_pending_calls(conn, conv_id)
        active = conn.execute(
            "SELECT id, caller_id, status FROM calls WHERE conversation_id = %s AND status IN ('pending','active') ORDER BY id DESC LIMIT 1",
            (conv_id,),
        ).fetchone()
        if active:
            active_id = int(active['id'])
            active_caller = int(active['caller_id'])
            active_status = str(active.get('status') or '')
            if active_status == 'pending' and active_caller == me_id:
                conn.execute(
                    f"UPDATE calls SET status='missed', ended_at={_now_sql()} WHERE id = %s",
                    (active_id,),
                )
            elif active_status == 'pending':
                return api_error('У розмові вже є дзвінок у стані очікування відповіді.', 409)
            else:
                return api_error('Вже є активний дзвінок у цій розмові.', 409)

        is_group_call = bool(conv_meta.get('is_group'))
        sdp_offer = str(data.get('sdp_offer') or '').strip()
        if not is_group_call:
            if not sdp_offer:
                return api_error('conversation_id і sdp_offer обов\'язкові.')
            if len(sdp_offer) > 120_000:
                return api_error('sdp_offer занадто великий.', 400)

        if USE_PG:
            cur = conn.execute(
                'INSERT INTO calls(conversation_id, caller_id, sdp_offer) VALUES(%s,%s,%s) RETURNING id',
                (conv_id, me_id, sdp_offer if not is_group_call else None),
            )
            call_id = int(cur.fetchone()['id'])
        else:
            conn.execute(
                'INSERT INTO calls(conversation_id, caller_id, sdp_offer) VALUES(%s,%s,%s)',
                (conv_id, me_id, sdp_offer if not is_group_call else None),
            )
            call_id = int(conn.execute('SELECT last_insert_rowid() AS id').fetchone()['id'])

        caller_name = _user_name(conn, me_id)

        if is_group_call:
            participants = _conv_participant_ids(conn, conv_id)
            for uid in participants:
                _set_call_member_state(
                    conn,
                    call_id,
                    int(uid),
                    'joined' if int(uid) == me_id else 'invited',
                    mark_joined=int(uid) == me_id,
                    mark_left=False,
                )
            group_name = conv_meta.get('group_name') or 'Група'
            _notify_call_participants(
                conn,
                conv_id,
                me_id,
                'Вхідний груповий дзвінок',
                f'{caller_name} запрошує у дзвінок «{group_name}».',
                'call_group_incoming',
                call_id=call_id,
            )
            return jsonify({
                'ok': True,
                'data': {
                    'call_id': call_id,
                    'is_group_call': True,
                    'group_name': group_name,
                    'participant_count': len(participants),
                },
            })

        _notify_call_participants(
            conn,
            conv_id,
            me_id,
            'Вхідний дзвінок',
            f'{caller_name} телефонує вам у Messenger.',
            'call_incoming',
            call_id=call_id,
        )
        return jsonify({'ok': True, 'data': {'call_id': call_id, 'is_group_call': False}})


@call_bp.get('/incoming')
@auth_required
def incoming_calls():
    """Pending дзвінки для поточного користувача."""
    me_id = int(g.current_user['id'])
    with get_connection() as conn:
        _expire_stale_pending_calls(conn)
        rows = conn.execute(
            """
            SELECT c.id, c.conversation_id, c.caller_id, c.status,
                   c.sdp_offer, c.sdp_answer, c.created_at,
                   u.full_name AS caller_name,
                   COALESCE(conv.is_group, %s) AS is_group_call,
                   conv.group_name,
                   cm.state AS my_group_state,
                   (
                     SELECT COUNT(*)
                     FROM call_members cm2
                     WHERE cm2.call_id = c.id AND cm2.state = 'joined'
                   ) AS joined_count
            FROM calls c
            JOIN users u ON u.id = c.caller_id
            JOIN conversations conv ON conv.id = c.conversation_id
            JOIN conversation_participants cp ON cp.conversation_id = c.conversation_id
            LEFT JOIN call_members cm ON cm.call_id = c.id AND cm.user_id = %s
            WHERE cp.user_id = %s
              AND c.caller_id != %s
              AND (
                (COALESCE(conv.is_group, %s) = %s AND c.status = 'pending')
                OR (
                  COALESCE(conv.is_group, %s) = %s
                  AND c.status IN ('pending', 'active')
                  AND COALESCE(cm.state, 'invited') IN ('invited', 'ringing')
                )
              )
            ORDER BY c.created_at DESC
            LIMIT 8
            """,
            (_FALSE, me_id, me_id, me_id, _FALSE, _FALSE, _FALSE, _TRUE),
        ).fetchall()
        out = []
        for row in rows:
            item = dict(row)
            item['is_group_call'] = bool(item.get('is_group_call'))
            item['participant_count'] = int(item.get('joined_count') or 0)
            out.append(item)
    return jsonify({'ok': True, 'data': out})


@call_bp.get('/<int:call_id>')
@auth_required
def get_call(call_id: int):
    me_id = int(g.current_user['id'])
    with get_connection() as conn:
        _expire_stale_pending_calls(conn)
        row = conn.execute(
            """
            SELECT c.id, c.conversation_id, c.caller_id, c.status,
                   c.sdp_offer, c.sdp_answer, c.created_at, c.started_at, c.ended_at,
                   u.full_name AS caller_name,
                   COALESCE(conv.is_group, %s) AS is_group_call,
                   conv.group_name
            FROM calls c
            JOIN users u ON u.id = c.caller_id
            JOIN conversations conv ON conv.id = c.conversation_id
            WHERE c.id = %s
            """,
            (_FALSE, call_id),
        ).fetchone()
        if not row:
            return api_error('Дзвінок не знайдено.', 404)
        if not _is_participant(conn, int(row['conversation_id']), me_id):
            return api_error('Доступ заборонено.', 403)

        payload = dict(row)
        payload['is_group_call'] = bool(payload.get('is_group_call'))
        if payload['is_group_call']:
            payload['members'] = _get_call_members(conn, call_id)
            payload['my_member_state'] = _member_state_for(conn, call_id, me_id)
            payload['participant_count'] = sum(1 for m in payload['members'] if m.get('state') == 'joined')
        return jsonify({'ok': True, 'data': payload})


@call_bp.put('/<int:call_id>/answer')
@auth_required
def answer_call(call_id: int):
    me_id = int(g.current_user['id'])
    data = request.get_json(force=True) or {}
    sdp_answer = str(data.get('sdp_answer') or '').strip()

    with get_connection() as conn:
        _expire_stale_pending_calls(conn)
        row = _call_with_meta(conn, call_id)
        if not row:
            return api_error('Дзвінок не знайдено.', 404)
        if not _is_participant(conn, int(row['conversation_id']), me_id):
            return api_error('Доступ заборонено.', 403)
        if row['status'] == 'missed':
            return api_error('Дзвінок прострочено.', 410)
        if row['status'] not in ('pending', 'active'):
            return api_error('Дзвінок вже не очікує відповіді.')
        if int(row['caller_id']) == me_id and not _is_group_call(row):
            return api_error('Caller не може відповідати на власний дзвінок.')

        if _is_group_call(row):
            _set_call_member_state(conn, call_id, me_id, 'joined', mark_joined=True, mark_left=False)
            if row['status'] == 'pending':
                conn.execute(
                    f"UPDATE calls SET status='active', started_at={_now_sql()} WHERE id=%s",
                    (call_id,),
                )
            joiner_name = _user_name(conn, me_id)
            _notify_call_participants(
                conn,
                int(row['conversation_id']),
                me_id,
                'Учасник приєднався',
                f'{joiner_name} приєднався(лась) до групового дзвінка.',
                'call_group_joined',
                call_id=call_id,
            )
            return jsonify({'ok': True, 'data': {'group_joined': True}})

        if not sdp_answer:
            return api_error('sdp_answer обов\'язковий.')
        if len(sdp_answer) > 120_000:
            return api_error('sdp_answer занадто великий.', 400)

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
                f'/messenger?conv={int(row["conversation_id"])}',
                'call_answered',
                meta={'conversation_id': int(row['conversation_id']), 'call_id': int(call_id)},
            )
        except Exception:
            pass
    return jsonify({'ok': True})


@call_bp.put('/<int:call_id>/offer')
@auth_required
def update_offer(call_id: int):
    """Caller надсилає новий offer при ICE restart для 1:1 дзвінка."""
    me_id = int(g.current_user['id'])
    data = request.get_json(force=True) or {}
    sdp_offer = str(data.get('sdp_offer') or '').strip()
    if not sdp_offer:
        return api_error('sdp_offer обов\'язковий.')
    if len(sdp_offer) > 120_000:
        return api_error('sdp_offer занадто великий.', 400)

    with get_connection() as conn:
        row = _call_with_meta(conn, call_id)
        if not row:
            return api_error('Дзвінок не знайдено.', 404)
        if _is_group_call(row):
            return api_error('Для групового дзвінка використовуйте /signals.', 400)
        if int(row['caller_id']) != me_id:
            return api_error('Тільки caller може надсилати новий offer.', 403)
        if row['status'] != 'active':
            return api_error('Дзвінок не активний.', 400)
        if not _is_participant(conn, int(row['conversation_id']), me_id):
            return api_error('Доступ заборонено.', 403)

        conn.execute(
            "UPDATE calls SET sdp_offer=%s, sdp_answer=NULL WHERE id=%s",
            (sdp_offer, call_id),
        )
    return jsonify({'ok': True})


@call_bp.put('/<int:call_id>/reject')
@auth_required
def reject_call(call_id: int):
    me_id = int(g.current_user['id'])
    with get_connection() as conn:
        row = _call_with_meta(conn, call_id)
        if not row:
            return api_error('Дзвінок не знайдено або не активний.', 404)
        if _is_group_call(row):
            if row['status'] not in ('pending', 'active'):
                return api_error('Дзвінок не знайдено або не активний.', 404)
        elif row['status'] not in ('pending',):
            return api_error('Дзвінок не знайдено або не активний.', 404)
        if not _is_participant(conn, int(row['conversation_id']), me_id):
            return api_error('Доступ заборонено.', 403)

        if _is_group_call(row):
            caller_id = int(row['caller_id'])
            if me_id == caller_id:
                conn.execute(
                    f"UPDATE calls SET status='rejected', ended_at={_now_sql()} WHERE id=%s",
                    (call_id,),
                )
                conn.execute(
                    f"UPDATE call_members SET state='missed', left_at={_now_sql()}, updated_at={_now_sql()} "
                    "WHERE call_id=%s AND user_id != %s AND state IN ('invited','ringing')",
                    (call_id, me_id),
                )
                _insert_call_message(conn, call_id, 'rejected')
                _notify_call_participants(
                    conn,
                    int(row['conversation_id']),
                    me_id,
                    'Груповий дзвінок скасовано',
                    'Ініціатор скасував виклик.',
                    'call_group_cancelled',
                    call_id=call_id,
                )
                return jsonify({'ok': True})

            _set_call_member_state(conn, call_id, me_id, 'rejected', mark_joined=False, mark_left=True)
            waiting = _count_group_members(conn, call_id, ('invited', 'ringing'), exclude_user_id=caller_id)
            joined = _count_group_members(conn, call_id, ('joined',), exclude_user_id=caller_id)
            if waiting == 0 and joined == 0:
                conn.execute(
                    f"UPDATE calls SET status='rejected', ended_at={_now_sql()} WHERE id=%s AND status='pending'",
                    (call_id,),
                )
                _insert_call_message(conn, call_id, 'rejected')
            rejecter = _user_name(conn, me_id)
            try:
                send_push(
                    caller_id,
                    'Запрошення відхилено',
                    f'{rejecter} відхилив(ла) запрошення у груповий дзвінок.',
                    f'/messenger?conv={int(row["conversation_id"])}',
                    'call_rejected',
                    meta={'conversation_id': int(row['conversation_id']), 'call_id': int(call_id)},
                )
            except Exception:
                pass
            return jsonify({'ok': True})

        conn.execute(
            f"UPDATE calls SET status='rejected', ended_at={_now_sql()} WHERE id=%s",
            (call_id,),
        )
        _insert_call_message(conn, call_id, 'rejected')
        rejecter = _user_name(conn, me_id)
        try:
            send_push(
                int(row['caller_id']),
                'Дзвінок відхилено',
                f'{rejecter} відхилив(ла) виклик.',
                f'/messenger?conv={int(row["conversation_id"])}',
                'call_rejected',
                meta={'conversation_id': int(row['conversation_id']), 'call_id': int(call_id)},
            )
        except Exception:
            pass
    return jsonify({'ok': True})


@call_bp.put('/<int:call_id>/end')
@auth_required
def end_call(call_id: int):
    me_id = int(g.current_user['id'])
    with get_connection() as conn:
        row = _call_with_meta(conn, call_id)
        if not row:
            return api_error('Дзвінок не знайдено.', 404)
        if not _is_participant(conn, int(row['conversation_id']), me_id):
            return api_error('Доступ заборонено.', 403)

        if _is_group_call(row):
            caller_id = int(row['caller_id'])
            if me_id == caller_id:
                conn.execute(
                    f"UPDATE calls SET status='ended', ended_at={_now_sql()} WHERE id=%s",
                    (call_id,),
                )
                conn.execute(
                    f"""
                    UPDATE call_members
                    SET state = CASE WHEN state IN ('joined','invited','ringing') THEN 'left' ELSE state END,
                        left_at = CASE WHEN state IN ('joined','invited','ringing') THEN {_now_sql()} ELSE left_at END,
                        updated_at = {_now_sql()}
                    WHERE call_id = %s
                    """,
                    (call_id,),
                )
                _insert_call_message(conn, call_id, 'ended')
                ender = _user_name(conn, me_id)
                _notify_call_participants(
                    conn,
                    int(row['conversation_id']),
                    me_id,
                    'Дзвінок завершено',
                    f'{ender} завершив(ла) груповий дзвінок.',
                    'call_ended',
                    call_id=call_id,
                )
                return jsonify({'ok': True})

            _set_call_member_state(conn, call_id, me_id, 'left', mark_joined=False, mark_left=True)
            joined_others = _count_group_members(conn, call_id, ('joined',), exclude_user_id=caller_id)
            if joined_others == 0:
                conn.execute(
                    f"UPDATE calls SET status='ended', ended_at={_now_sql()} WHERE id=%s AND status IN ('active','pending')",
                    (call_id,),
                )
                _insert_call_message(conn, call_id, 'ended')
            ender = _user_name(conn, me_id)
            _notify_call_participants(
                conn,
                int(row['conversation_id']),
                me_id,
                'Учасник вийшов',
                f'{ender} вийшов(ла) із групового дзвінка.',
                'call_group_left',
                call_id=call_id,
            )
            return jsonify({'ok': True})

        conn.execute(
            f"UPDATE calls SET status='ended', ended_at={_now_sql()} WHERE id=%s",
            (call_id,),
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
            call_id=call_id,
        )
    return jsonify({'ok': True})


@call_bp.post('/<int:call_id>/ice')
@auth_required
def add_ice(call_id: int):
    me_id = int(g.current_user['id'])
    data = request.get_json(force=True) or {}
    candidate = data.get('candidate')
    if not candidate:
        return api_error('candidate обов\'язковий.')

    if isinstance(candidate, dict):
        candidate = json.dumps(candidate)
    candidate = str(candidate)
    if len(candidate) > 20_000:
        return api_error('candidate занадто великий.', 400)

    with get_connection() as conn:
        row = _call_with_meta(conn, call_id)
        if not row:
            return api_error('Дзвінок не знайдено.', 404)
        if _is_group_call(row):
            return api_error('Для групового дзвінка використовуйте /signals.', 400)
        if not _is_participant(conn, int(row['conversation_id']), me_id):
            return api_error('Доступ заборонено.', 403)
        conn.execute(
            'INSERT INTO call_ice(call_id, user_id, candidate) VALUES(%s,%s,%s)',
            (call_id, me_id, candidate),
        )
    return jsonify({'ok': True})


@call_bp.get('/<int:call_id>/ice')
@auth_required
def get_ice(call_id: int):
    me_id = int(g.current_user['id'])
    after_id = request.args.get('after_id', 0, type=int)

    with get_connection() as conn:
        row = _call_with_meta(conn, call_id)
        if not row:
            return api_error('Дзвінок не знайдено.', 404)
        if _is_group_call(row):
            return api_error('Для групового дзвінка використовуйте /signals.', 400)
        if not _is_participant(conn, int(row['conversation_id']), me_id):
            return api_error('Доступ заборонено.', 403)

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


@call_bp.get('/<int:call_id>/members')
@auth_required
def call_members(call_id: int):
    me_id = int(g.current_user['id'])
    with get_connection() as conn:
        row = _call_with_meta(conn, call_id)
        if not row:
            return api_error('Дзвінок не знайдено.', 404)
        if not _is_participant(conn, int(row['conversation_id']), me_id):
            return api_error('Доступ заборонено.', 403)
        if not _is_group_call(row):
            return jsonify({'ok': True, 'data': []})
        members = _get_call_members(conn, call_id)
    return jsonify({'ok': True, 'data': members})


@call_bp.post('/<int:call_id>/signals')
@auth_required
def add_signal(call_id: int):
    me_id = int(g.current_user['id'])
    data = request.get_json(force=True) or {}
    signal_type = str(data.get('signal_type') or '').strip().lower()
    to_user_id_raw = data.get('to_user_id')
    payload = data.get('payload')

    if signal_type not in ('offer', 'answer', 'ice', 'bye'):
        return api_error('signal_type має бути offer|answer|ice|bye', 400)

    if isinstance(payload, (dict, list)):
        payload = json.dumps(payload, ensure_ascii=False)
    payload = str(payload or '').strip()
    if not payload:
        return api_error('payload обов\'язковий.', 400)

    max_len = 160_000 if signal_type in ('offer', 'answer') else (22_000 if signal_type == 'ice' else 4_000)
    if len(payload) > max_len:
        return api_error('payload занадто великий.', 400)

    to_user_id: int | None = None
    if to_user_id_raw is not None:
        try:
            to_user_id = int(to_user_id_raw)
        except (TypeError, ValueError):
            return api_error('to_user_id має бути числом.', 400)
    if signal_type in ('offer', 'answer', 'ice') and not to_user_id:
        return api_error('to_user_id обов\'язковий для offer/answer/ice.', 400)

    with get_connection() as conn:
        row = _call_with_meta(conn, call_id)
        if not row:
            return api_error('Дзвінок не знайдено.', 404)
        if not _is_group_call(row):
            return api_error('signals доступний лише для групового дзвінка.', 400)
        if not _is_participant(conn, int(row['conversation_id']), me_id):
            return api_error('Доступ заборонено.', 403)
        my_state = _member_state_for(conn, call_id, me_id) or ''
        if my_state in ('rejected', 'left', 'missed'):
            return api_error('Ви не в активній сесії дзвінка.', 403)
        if to_user_id is not None and not _is_participant(conn, int(row['conversation_id']), to_user_id):
            return api_error('Цільовий учасник не знайдений у групі.', 404)

        if USE_PG:
            cur = conn.execute(
                """
                INSERT INTO call_signals(call_id, from_user_id, to_user_id, signal_type, payload)
                VALUES(%s,%s,%s,%s,%s)
                RETURNING id
                """,
                (call_id, me_id, to_user_id, signal_type, payload),
            )
            signal_id = int(cur.fetchone()['id'])
        else:
            conn.execute(
                """
                INSERT INTO call_signals(call_id, from_user_id, to_user_id, signal_type, payload)
                VALUES(%s,%s,%s,%s,%s)
                """,
                (call_id, me_id, to_user_id, signal_type, payload),
            )
            signal_id = int(conn.execute('SELECT last_insert_rowid() AS id').fetchone()['id'])

    return jsonify({'ok': True, 'data': {'id': signal_id}})


@call_bp.get('/<int:call_id>/signals')
@auth_required
def get_signals(call_id: int):
    me_id = int(g.current_user['id'])
    after_id = max(0, int(request.args.get('after_id', 0) or 0))

    with get_connection() as conn:
        row = _call_with_meta(conn, call_id)
        if not row:
            return api_error('Дзвінок не знайдено.', 404)
        if not _is_group_call(row):
            return api_error('signals доступний лише для групового дзвінка.', 400)
        if not _is_participant(conn, int(row['conversation_id']), me_id):
            return api_error('Доступ заборонено.', 403)

        rows = conn.execute(
            """
            SELECT id, from_user_id, to_user_id, signal_type, payload, created_at
            FROM call_signals
            WHERE call_id = %s
              AND id > %s
              AND (to_user_id IS NULL OR to_user_id = %s)
              AND from_user_id != %s
            ORDER BY id ASC
            LIMIT 200
            """,
            (call_id, after_id, me_id, me_id),
        ).fetchall()

    return jsonify({'ok': True, 'data': [dict(r) for r in rows]})

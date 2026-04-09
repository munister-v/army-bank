"""Маршрути месенджера Army Bank."""
from __future__ import annotations

import json
import re

from flask import Blueprint, jsonify, request, g

from ..database import get_connection
from ..config import USE_PG
from ..services.messenger_crypto import (
    decrypt_message,
    deleted_message_text,
    encrypt_message,
)
from .helpers import api_error, auth_required

messenger_bp = Blueprint('messenger', __name__, url_prefix='/api/messenger')

_FALSE = False if USE_PG else 0  # boolean compatibility
_B64_RE = re.compile(r'^[A-Za-z0-9+/=]+$')


# ── Допоміжні функції ────────────────────────────────────────────────────────

def _now_sql():
    return 'NOW()' if USE_PG else "datetime('now')"


def _like_op():
    return 'ILIKE' if USE_PG else 'LIKE'


def _get_or_create_conversation(user_a: int, user_b: int) -> int:
    """Знаходить або створює чат між двома користувачами."""
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT cp1.conversation_id
            FROM conversation_participants cp1
            JOIN conversation_participants cp2
              ON cp1.conversation_id = cp2.conversation_id
            WHERE cp1.user_id = %s AND cp2.user_id = %s
            GROUP BY cp1.conversation_id
            HAVING COUNT(*) = 2
            ORDER BY cp1.conversation_id ASC
            LIMIT 1
            """,
            (user_a, user_b),
        ).fetchone()

        if row:
            return row['conversation_id']

        # Створюємо новий чат
        if USE_PG:
            cur = conn.execute('INSERT INTO conversations(created_at) VALUES(NOW()) RETURNING id')
            conv_id = cur.fetchone()['id']
        else:
            conn.execute("INSERT INTO conversations(created_at) VALUES(datetime('now'))")
            conv_id = conn.execute('SELECT last_insert_rowid() AS id').fetchone()['id']

        conn.execute(
            'INSERT INTO conversation_participants (conversation_id, user_id) VALUES (%s, %s)',
            (conv_id, user_a),
        )
        conn.execute(
            'INSERT INTO conversation_participants (conversation_id, user_id) VALUES (%s, %s)',
            (conv_id, user_b),
        )
        return conv_id


def _conv_summary(conv_id: int, me_id: int) -> dict:
    """Повертає summary діалогу для списку розмов."""
    with get_connection() as conn:
        conv = conn.execute(
            'SELECT id, last_message_at, last_message_text, is_group, group_name FROM conversations WHERE id = %s',
            (conv_id,),
        ).fetchone()
        if not conv:
            return {}

        is_group = bool(conv.get('is_group'))
        partner = None
        if not is_group:
            partner = conn.execute(
                """
                SELECT u.id, u.full_name, u.phone, u.role
                FROM conversation_participants cp
                JOIN users u ON u.id = cp.user_id
                WHERE cp.conversation_id = %s AND cp.user_id != %s
                LIMIT 1
                """,
                (conv_id, me_id),
            ).fetchone()

        me_part = conn.execute(
            'SELECT last_read_at FROM conversation_participants WHERE conversation_id = %s AND user_id = %s',
            (conv_id, me_id),
        ).fetchone()
        last_read = (me_part or {}).get('last_read_at')

        if last_read:
            unread = conn.execute(
                'SELECT COUNT(*) AS n FROM messages WHERE conversation_id = %s AND created_at > %s AND sender_id != %s AND is_deleted = %s',
                (conv_id, last_read, me_id, _FALSE),
            ).fetchone()['n']
        else:
            unread = conn.execute(
                'SELECT COUNT(*) AS n FROM messages WHERE conversation_id = %s AND sender_id != %s AND is_deleted = %s',
                (conv_id, me_id, _FALSE),
            ).fetchone()['n']

    preview = decrypt_message(conv.get('last_message_text') if conv else '', fallback='')
    if not preview:
        preview = conv.get('last_message_text') if conv else ''

    return {
        'id': conv['id'],
        'is_group': is_group,
        'group_name': conv.get('group_name'),
        'last_message_at': conv['last_message_at'],
        'last_message_text': preview,
        'partner': dict(partner) if partner else None,
        'unread': unread,
    }


def _serialize_message_row(row: dict) -> dict:
    item = dict(row)
    is_deleted = bool(item.get('is_deleted'))
    msg_type = item.get('msg_type', 'text') or 'text'
    if is_deleted:
        item['text'] = deleted_message_text()
    elif msg_type == 'voice':
        pass  # base64 audio stored as-is
    else:
        item['text'] = decrypt_message(item.get('text', ''), fallback='')
    return item


# ── Пошук користувачів ───────────────────────────────────────────────────────

@messenger_bp.get('/users/search')
@auth_required
def search_users():
    q = (request.args.get('q') or '').strip()
    if len(q) < 2:
        return api_error('Запит занадто короткий.', 400)

    me_id = g.current_user['id']
    like = f'%{q}%'
    op = _like_op()

    with get_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT u.id, u.full_name, u.phone, u.role, a.account_number
            FROM users u
            LEFT JOIN accounts a ON a.user_id = u.id
            WHERE u.id != %s
              AND (u.full_name {op} %s OR u.phone LIKE %s OR a.account_number LIKE %s)
            LIMIT 20
            """,
            (me_id, like, like, like),
        ).fetchall()

    return jsonify({'ok': True, 'data': [dict(r) for r in rows]})


# ── Список розмов ────────────────────────────────────────────────────────────

@messenger_bp.get('/conversations')
@auth_required
def list_conversations():
    me_id = g.current_user['id']
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT cp.conversation_id
            FROM conversation_participants cp
            JOIN conversations c ON c.id = cp.conversation_id
            WHERE cp.user_id = %s
            ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
            """,
            (me_id,),
        ).fetchall()

    result = []
    for row in rows:
        summary = _conv_summary(row['conversation_id'], me_id)
        if summary:
            result.append(summary)

    return jsonify({'ok': True, 'data': result})


# ── Розпочати або знайти чат ──────────────────────────────────────────────────

@messenger_bp.post('/conversations')
@auth_required
def open_conversation():
    data = request.get_json(force=True) or {}
    raw_partner_id = data.get('user_id')
    if raw_partner_id is None:
        return api_error("user_id обов'язковий.")
    try:
        partner_id = int(raw_partner_id)
    except (TypeError, ValueError):
        return api_error('user_id має бути числом.', 400)

    me_id = g.current_user['id']
    if partner_id == me_id:
        return api_error('Не можна писати самому собі.')

    with get_connection() as conn:
        partner = conn.execute('SELECT id FROM users WHERE id = %s', (partner_id,)).fetchone()
    if not partner:
        return api_error('Користувача не знайдено.', 404)

    conv_id = _get_or_create_conversation(me_id, partner_id)
    summary = _conv_summary(conv_id, me_id)
    return jsonify({'ok': True, 'data': summary})


# ── Повідомлення ─────────────────────────────────────────────────────────────

@messenger_bp.get('/conversations/<int:conv_id>/messages')
@auth_required
def get_messages(conv_id: int):
    me_id = g.current_user['id']
    before_id = request.args.get('before_id', type=int)
    limit = request.args.get('limit', default=50, type=int)
    if limit is None or limit < 1:
        limit = 50
    limit = min(limit, 100)

    with get_connection() as conn:
        part = conn.execute(
            'SELECT id FROM conversation_participants WHERE conversation_id = %s AND user_id = %s',
            (conv_id, me_id),
        ).fetchone()
        if not part:
            return api_error('Доступ заборонено.', 403)

        if before_id:
            rows = conn.execute(
                """
                SELECT m.id, m.sender_id, m.text, m.msg_type, m.created_at, m.is_deleted,
                       u.full_name AS sender_name
                FROM messages m
                JOIN users u ON u.id = m.sender_id
                WHERE m.conversation_id = %s AND m.id < %s
                ORDER BY m.id DESC
                LIMIT %s
                """,
                (conv_id, before_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT m.id, m.sender_id, m.text, m.msg_type, m.created_at, m.is_deleted,
                       u.full_name AS sender_name
                FROM messages m
                JOIN users u ON u.id = m.sender_id
                WHERE m.conversation_id = %s
                ORDER BY m.id DESC
                LIMIT %s
                """,
                (conv_id, limit),
            ).fetchall()

        _mark_read(conn, conv_id, me_id)

    msgs = [_serialize_message_row(dict(r)) for r in rows]
    msgs.reverse()
    return jsonify({'ok': True, 'data': msgs})


@messenger_bp.post('/conversations/<int:conv_id>/messages')
@auth_required
def send_message(conv_id: int):
    me_id = g.current_user['id']
    data = request.get_json(force=True) or {}
    msg_type = (data.get('msg_type') or 'text').strip()
    if msg_type not in ('text', 'voice', 'image'):
        msg_type = 'text'

    if msg_type == 'voice':
        text = (data.get('text') or '').strip()
        if not text:
            return api_error('Голосове повідомлення порожнє.')
        if len(text) > 800_000:
            return api_error('Голосове повідомлення занадто велике.')
        stored_text = text  # base64 audio, store as-is (no encryption)
    elif msg_type == 'image':
        raw_text = (data.get('text') or '').strip()
        if not raw_text:
            return api_error('Фото-повідомлення порожнє.')
        if len(raw_text) > 2_300_000:
            return api_error('Фото занадто велике.')
        try:
            payload = json.loads(raw_text)
        except Exception:
            return api_error('Некоректний формат фото-повідомлення.')

        src_items = payload.get('items') if isinstance(payload, dict) else None
        if not isinstance(src_items, list) or not src_items:
            return api_error('Фото-повідомлення не містить зображень.')

        normalized = []
        allowed_mimes = {'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/avif'}
        for item in src_items[:12]:
            if not isinstance(item, dict):
                continue
            mime = str(item.get('mime') or '').strip().lower()
            b64 = str(item.get('data') or '').strip()
            if mime not in allowed_mimes:
                continue
            if mime == 'image/jpg':
                mime = 'image/jpeg'
            if not b64 or len(b64) > 1_500_000:
                continue
            if not _B64_RE.fullmatch(b64):
                continue
            record = {'mime': mime, 'data': b64}
            try:
                w = int(item.get('w') or 0)
                h = int(item.get('h') or 0)
            except (TypeError, ValueError):
                w, h = 0, 0
            if 0 < w <= 5000 and 0 < h <= 5000:
                record['w'] = w
                record['h'] = h
            normalized.append(record)

        if not normalized:
            return api_error('Не вдалося обробити фото-повідомлення.')

        text = json.dumps({'v': 1, 'items': normalized}, ensure_ascii=False, separators=(',', ':'))
        stored_text = encrypt_message(text)
    else:
        text = (data.get('text') or '').strip()
        if not text:
            return api_error('Повідомлення порожнє.')
        if len(text) > 4000:
            return api_error('Повідомлення занадто довге (макс. 4000 символів).')
        stored_text = encrypt_message(text)

    with get_connection() as conn:
        part = conn.execute(
            'SELECT id FROM conversation_participants WHERE conversation_id = %s AND user_id = %s',
            (conv_id, me_id),
        ).fetchone()
        if not part:
            return api_error('Доступ заборонено.', 403)

        if USE_PG:
            cur = conn.execute(
                'INSERT INTO messages (conversation_id, sender_id, text, msg_type) VALUES (%s, %s, %s, %s) RETURNING id, created_at',
                (conv_id, me_id, stored_text, msg_type),
            )
            msg_row = cur.fetchone()
            msg_id = msg_row['id']
            created_at = msg_row['created_at']
        else:
            conn.execute(
                'INSERT INTO messages (conversation_id, sender_id, text, msg_type) VALUES (%s, %s, %s, %s)',
                (conv_id, me_id, stored_text, msg_type),
            )
            msg_id = conn.execute('SELECT last_insert_rowid() AS id').fetchone()['id']
            created_at = conn.execute(
                'SELECT created_at FROM messages WHERE id = %s', (msg_id,)
            ).fetchone()['created_at']

        if msg_type == 'voice':
            preview = '🎤 Голосове повідомлення'
        elif msg_type == 'image':
            preview = '🖼️ Фото'
        else:
            preview = text[:180]
        conn.execute(
            f'UPDATE conversations SET last_message_at = {_now_sql()}, last_message_text = %s WHERE id = %s',
            (preview, conv_id),
        )
        _mark_read(conn, conv_id, me_id)

    return jsonify({'ok': True, 'data': {
        'id': msg_id,
        'conversation_id': conv_id,
        'sender_id': me_id,
        'sender_name': g.current_user['full_name'],
        'text': text,
        'msg_type': msg_type,
        'created_at': str(created_at),
        'is_deleted': False,
    }})


# ── Polling ────────────────────────────────────────────────────────────────

@messenger_bp.get('/conversations/<int:conv_id>/poll')
@auth_required
def poll_messages(conv_id: int):
    me_id = g.current_user['id']
    after_id = request.args.get('after_id', 0, type=int)

    with get_connection() as conn:
        part = conn.execute(
            'SELECT id FROM conversation_participants WHERE conversation_id = %s AND user_id = %s',
            (conv_id, me_id),
        ).fetchone()
        if not part:
            return api_error('Доступ заборонено.', 403)

        rows = conn.execute(
            """
            SELECT m.id, m.sender_id, m.text, m.msg_type, m.created_at, m.is_deleted,
                   u.full_name AS sender_name
            FROM messages m
            JOIN users u ON u.id = m.sender_id
            WHERE m.conversation_id = %s AND m.id > %s
            ORDER BY m.id ASC
            LIMIT 50
            """,
            (conv_id, after_id),
        ).fetchall()

        if rows:
            _mark_read(conn, conv_id, me_id)

    return jsonify({'ok': True, 'data': [_serialize_message_row(dict(r)) for r in rows]})


# ── Загальний unread count ────────────────────────────────────────────────────

@messenger_bp.get('/unread')
@auth_required
def unread_count():
    me_id = g.current_user['id']
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT COUNT(*) AS n
            FROM messages m
            JOIN conversation_participants cp
              ON cp.conversation_id = m.conversation_id AND cp.user_id = %s
            WHERE m.sender_id != %s
              AND m.is_deleted = %s
              AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
            """,
            (me_id, me_id, _FALSE),
        ).fetchone()
    return jsonify({'ok': True, 'data': {'unread': row['n'] if row else 0}})


# ── Видалення повідомлення ───────────────────────────────────────────────────

@messenger_bp.delete('/messages/<int:msg_id>')
@auth_required
def delete_message(msg_id: int):
    me_id = g.current_user['id']
    _true = True if USE_PG else 1
    with get_connection() as conn:
        msg = conn.execute(
            'SELECT id, sender_id FROM messages WHERE id = %s', (msg_id,)
        ).fetchone()
        if not msg:
            return api_error('Повідомлення не знайдено.', 404)
        if msg['sender_id'] != me_id:
            return api_error('Можна видаляти лише свої повідомлення.', 403)
        conn.execute(
            'UPDATE messages SET is_deleted = %s, text = %s WHERE id = %s',
            (_true, encrypt_message(deleted_message_text()), msg_id),
        )
    return jsonify({'ok': True})


# ── Групи ────────────────────────────────────────────────────────────────────

@messenger_bp.post('/groups')
@auth_required
def create_group():
    """Створити груповий чат."""
    me_id = g.current_user['id']
    data  = request.get_json(force=True) or {}
    name  = (data.get('name') or '').strip()
    member_ids = data.get('member_ids') or []

    if not name:
        return api_error("Назва групи обов'язкова.")
    if len(name) > 60:
        return api_error('Назва групи занадто довга.')

    _true = True if USE_PG else 1

    normalized_ids: list[int] = []
    for uid in member_ids:
        try:
            user_id = int(uid)
        except (TypeError, ValueError):
            continue
        if user_id != me_id and user_id not in normalized_ids:
            normalized_ids.append(user_id)
    normalized_ids = normalized_ids[:50]

    with get_connection() as conn:
        if USE_PG:
            cur = conn.execute(
                'INSERT INTO conversations(is_group, group_name) VALUES(%s,%s) RETURNING id',
                (_true, name),
            )
            conv_id = cur.fetchone()['id']
        else:
            conn.execute(
                'INSERT INTO conversations(is_group, group_name) VALUES(%s,%s)',
                (1, name),
            )
            conv_id = conn.execute('SELECT last_insert_rowid() AS id').fetchone()['id']

        # Add creator
        conn.execute(
            'INSERT INTO conversation_participants(conversation_id, user_id) VALUES(%s,%s)',
            (conv_id, me_id),
        )
        # Add members (skip missing users and duplicates)
        for uid in normalized_ids:
            user_exists = conn.execute('SELECT id FROM users WHERE id = %s', (uid,)).fetchone()
            if not user_exists:
                continue
            try:
                conn.execute(
                    'INSERT INTO conversation_participants(conversation_id, user_id) VALUES(%s,%s)',
                    (conv_id, uid),
                )
            except Exception:
                pass

    summary = _conv_summary(conv_id, me_id)
    if not summary:
        return api_error('Не вдалося створити групу.', 500)
    return jsonify({'ok': True, 'data': summary})


@messenger_bp.post('/conversations/<int:conv_id>/members')
@auth_required
def add_member(conv_id: int):
    me_id  = g.current_user['id']
    data   = request.get_json(force=True) or {}
    new_uid = data.get('user_id')
    if not new_uid:
        return api_error("user_id обов'язковий.")

    with get_connection() as conn:
        conv = conn.execute(
            'SELECT is_group FROM conversations WHERE id = %s',
            (conv_id,),
        ).fetchone()
        if not conv:
            return api_error('Розмову не знайдено.', 404)
        if not bool(conv.get('is_group')):
            return api_error('Учасників можна додавати лише в групові чати.', 400)
        part = conn.execute(
            'SELECT id FROM conversation_participants WHERE conversation_id=%s AND user_id=%s',
            (conv_id, me_id),
        ).fetchone()
        if not part:
            return api_error('Доступ заборонено.', 403)
        user_exists = conn.execute('SELECT id FROM users WHERE id = %s', (int(new_uid),)).fetchone()
        if not user_exists:
            return api_error('Користувача не знайдено.', 404)
        try:
            conn.execute(
                'INSERT INTO conversation_participants(conversation_id, user_id) VALUES(%s,%s)',
                (conv_id, int(new_uid)),
            )
        except Exception:
            return api_error('Учасник вже є в групі.')

    return jsonify({'ok': True})


@messenger_bp.delete('/conversations/<int:conv_id>/members/<int:uid>')
@auth_required
def remove_member(conv_id: int, uid: int):
    me_id = g.current_user['id']
    with get_connection() as conn:
        conv = conn.execute(
            'SELECT is_group FROM conversations WHERE id = %s',
            (conv_id,),
        ).fetchone()
        if not conv:
            return api_error('Розмову не знайдено.', 404)
        if not bool(conv.get('is_group')):
            return api_error('Учасників можна видаляти лише з групового чату.', 400)
        part = conn.execute(
            'SELECT id FROM conversation_participants WHERE conversation_id=%s AND user_id=%s',
            (conv_id, me_id),
        ).fetchone()
        if not part:
            return api_error('Доступ заборонено.', 403)
        member = conn.execute(
            'SELECT id FROM conversation_participants WHERE conversation_id = %s AND user_id = %s',
            (conv_id, uid),
        ).fetchone()
        if not member:
            return api_error('Учасника не знайдено.', 404)
        conn.execute(
            'DELETE FROM conversation_participants WHERE conversation_id=%s AND user_id=%s',
            (conv_id, uid),
        )
    return jsonify({'ok': True})


@messenger_bp.get('/conversations/<int:conv_id>/members')
@auth_required
def list_members(conv_id: int):
    me_id = g.current_user['id']
    with get_connection() as conn:
        part = conn.execute(
            'SELECT id FROM conversation_participants WHERE conversation_id=%s AND user_id=%s',
            (conv_id, me_id),
        ).fetchone()
        if not part:
            return api_error('Доступ заборонено.', 403)
        rows = conn.execute(
            """
            SELECT u.id, u.full_name, u.phone, u.role
            FROM conversation_participants cp
            JOIN users u ON u.id = cp.user_id
            WHERE cp.conversation_id = %s
            ORDER BY u.full_name
            """,
            (conv_id,),
        ).fetchall()
    return jsonify({'ok': True, 'data': [dict(r) for r in rows]})


# ── helpers ───────────────────────────────────────────────────────────────────

def _mark_read(conn, conv_id: int, user_id: int) -> None:
    conn.execute(
        f'UPDATE conversation_participants SET last_read_at = {_now_sql()} WHERE conversation_id = %s AND user_id = %s',
        (conv_id, user_id),
    )

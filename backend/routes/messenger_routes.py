"""Маршрути месенджера Army Bank."""
from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import date, timedelta
from urllib.parse import urlencode

from flask import Blueprint, jsonify, request, g

from ..database import get_connection
from ..config import USE_PG
from ..services.account_service import AccountService
from ..services.auth_service import AuthService
from ..services.card_service import CardService
from ..services.feature_service import FeatureService
from ..services.statement_service import StatementService
from ..services.messenger_crypto import (
    decrypt_message,
    deleted_message_text,
    encrypt_message,
)
from ..services.meta_api import MetaApiError, send_instagram_text, send_whatsapp_text
from ..utils.security import hash_password
from .helpers import api_error, auth_required
from .integrations_routes import get_integration
from .leads_routes import _log_activity as _log_lead_activity
from .push_routes import send_push

messenger_bp = Blueprint('messenger', __name__, url_prefix='/api/messenger')
_auth_service = AuthService()
_account_service = AccountService()
_card_service = CardService()
_feature_service = FeatureService()

_FALSE = False if USE_PG else 0  # boolean compatibility
_B64_RE = re.compile(r'^[A-Za-z0-9+/=]+$')
_ASSISTANT_ROLE = 'assistant_bot'
_ASSISTANT_NAME = 'Army Bank Assistant'
_ASSISTANT_PHONE = '+380990000001'
_ASSISTANT_EMAIL = 'assistant@army-bank.bot'
_ASSISTANT_PASSWORD = 'army-bank-assistant-system-only'

# Тимчасово прибрано з UI (не видалено): жодних нових розмов з асистентом не
# створюється, і вже наявні розмови з ним фільтруються зі списку. Щоб
# повернути — досить виставити True.
_ASSISTANT_FEATURE_ENABLED = False

# Загальний чат: єдина групова розмова, до якої автоматично приєднується
# кожен зареєстрований користувач. Розпізнається за фіксованою назвою
# (з емодзі-префіксом, щоб не перетнутись зі звичайною групою користувача).
_GENERAL_CHAT_NAME = '📢 Загальний чат'


def _ensure_general_conversation(me_id: int) -> int:
    """Повертає id системного загального чату, створює й приєднує поточного
    користувача за потреби (ідемпотентно)."""
    _true = True if USE_PG else 1
    with get_connection() as conn:
        row = conn.execute(
            'SELECT id FROM conversations WHERE is_group = %s AND group_name = %s LIMIT 1',
            (_true, _GENERAL_CHAT_NAME),
        ).fetchone()
        if row:
            conv_id = int(row['id'])
        else:
            if USE_PG:
                cur = conn.execute(
                    'INSERT INTO conversations(is_group, group_name) VALUES(%s,%s) RETURNING id',
                    (_true, _GENERAL_CHAT_NAME),
                )
                conv_id = int(cur.fetchone()['id'])
            else:
                conn.execute(
                    'INSERT INTO conversations(is_group, group_name) VALUES(%s,%s)',
                    (1, _GENERAL_CHAT_NAME),
                )
                conv_id = int(conn.execute('SELECT last_insert_rowid() AS id').fetchone()['id'])

        already_joined = conn.execute(
            'SELECT id FROM conversation_participants WHERE conversation_id = %s AND user_id = %s',
            (conv_id, me_id),
        ).fetchone()
        if not already_joined:
            conn.execute(
                'INSERT INTO conversation_participants(conversation_id, user_id) VALUES(%s,%s)',
                (conv_id, me_id),
            )
    return conv_id


# Особисті "чати-нотатники": лише сам користувач як учасник. Один і той самий
# механізм використовується і для "Збережених повідомлень" (як Saved Messages
# у Telegram), і для "Планувальника" — розпізнаються за назвою групи + рівно
# одним учасником, щоб не перетнутись з якоюсь чужою групою з такою ж назвою.
_SAVED_MESSAGES_NAME = '🔖 Збережені повідомлення'
_SCHEDULER_NAME = '📅 Планувальник'
_SCHEDULER_DIGEST_TAG = '📋 Нагадування на '


def _ensure_self_conversation(me_id: int, name: str) -> int:
    _true = True if USE_PG else 1
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT c.id FROM conversations c
            JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = %s
            WHERE c.is_group = %s AND c.group_name = %s
              AND (SELECT COUNT(*) FROM conversation_participants cp2 WHERE cp2.conversation_id = c.id) = 1
            LIMIT 1
            """,
            (me_id, _true, name),
        ).fetchone()
        if row:
            return int(row['id'])

        if USE_PG:
            cur = conn.execute(
                'INSERT INTO conversations(is_group, group_name) VALUES(%s,%s) RETURNING id',
                (_true, name),
            )
            conv_id = int(cur.fetchone()['id'])
        else:
            conn.execute(
                'INSERT INTO conversations(is_group, group_name) VALUES(%s,%s)',
                (1, name),
            )
            conv_id = int(conn.execute('SELECT last_insert_rowid() AS id').fetchone()['id'])
        conn.execute(
            'INSERT INTO conversation_participants(conversation_id, user_id) VALUES(%s,%s)',
            (conv_id, me_id),
        )
    return conv_id


# list_conversations() опитується фронтендом кожні ~20-30с; без цього кешу
# _maybe_post_scheduler_digest бив би в БД (messages + leads) щоразу, хоча
# реально постити треба один раз на день. gunicorn тут піднято з -w 1
# (один воркер), тому простий процесний dict безпечний.
_scheduler_digest_checked_on: dict[int, str] = {}


def _maybe_post_scheduler_digest(me_id: int, conv_id: int, role: str) -> None:
    """Раз на день підкидає в 'Планувальник' нагадування про прострочені
    фоллоу-апи лідів. Лише для admin/platform_admin — у інших немає доступу
    до CRM-лідів. Ідемпотентно: перевіряє, чи вже постили сьогодні."""
    if role not in ('admin', 'platform_admin'):
        return
    from datetime import date
    today_iso = date.today().isoformat()
    if _scheduler_digest_checked_on.get(me_id) == today_iso:
        return
    from .leads_routes import _ensure_schema as _ensure_leads_schema
    _ensure_leads_schema()
    with get_connection() as conn:
        # Дивимось на останні N повідомлень, а не лише останнє — інакше якщо
        # менеджер щось напише в Планувальнику ПІСЛЯ дайджесту, наступне
        # відкриття месенджера того ж дня продублює дайджест.
        recent = conn.execute(
            'SELECT text, created_at FROM messages WHERE conversation_id = %s ORDER BY id DESC LIMIT 20',
            (conv_id,),
        ).fetchall()
        already_posted_today = any(
            str(r.get('created_at') or '')[:10] == today_iso
            and str(r.get('text') or '').startswith(_SCHEDULER_DIGEST_TAG)
            for r in (recent or [])
        )
        if already_posted_today:
            _scheduler_digest_checked_on[me_id] = today_iso
            return

        due = conn.execute(
            "SELECT business_name, next_followup_date FROM leads "
            "WHERE next_followup_date IS NOT NULL AND next_followup_date != '' AND next_followup_date <= %s "
            "ORDER BY next_followup_date ASC LIMIT 25",
            (today_iso,),
        ).fetchall()
        if due:
            lines = [f'{_SCHEDULER_DIGEST_TAG}{today_iso}:'] + [
                f"• {d['business_name']} — фоллоу-ап {d['next_followup_date']}" for d in due
            ]
        else:
            lines = [f'{_SCHEDULER_DIGEST_TAG}{today_iso}: прострочених фоллоу-апів немає 🎉']
        digest_text = '\n'.join(lines)

        conn.execute(
            'INSERT INTO messages (conversation_id, sender_id, text, msg_type) VALUES (%s, %s, %s, %s)',
            (conv_id, me_id, digest_text, 'text'),
        )
        conn.execute(
            f'UPDATE conversations SET last_message_at = {_now_sql()}, last_message_text = %s WHERE id = %s',
            (lines[0][:180], conv_id),
        )
    _scheduler_digest_checked_on[me_id] = today_iso


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


def _normalize_conversation_preview(raw_text: str, compact: bool = False) -> str:
    preview = str(raw_text or '').strip()
    if not preview:
        return ''

    # Legacy rows might still contain full encrypted/json blobs. Normalize to lightweight labels.
    if preview.startswith('{') and '"items"' in preview and ('"mime":"image' in preview or '"mime":"image/' in preview):
        return '🖼️ Фото'
    if preview.startswith('{') and ('"mime":"audio' in preview or '"audio/' in preview):
        return '🎤 Голосове повідомлення'
    if len(preview) > 300 and _B64_RE.fullmatch(preview):
        return '🎤 Голосове повідомлення'

    max_len = 96 if compact else 180
    if len(preview) > max_len:
        preview = f"{preview[: max_len - 1].rstrip()}…"
    return preview


def _conv_summary(conv_id: int, me_id: int, compact: bool = False) -> dict:
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
                SELECT u.id, u.full_name, u.role, u.last_seen_at
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
    preview = _normalize_conversation_preview(preview, compact=compact)

    partner_payload = dict(partner) if partner else None
    if partner_payload and str(partner_payload.get('role') or '').lower() == _ASSISTANT_ROLE:
        partner_payload['verified'] = True

    partner_last_seen = None
    if partner_payload:
        lsa = partner_payload.get('last_seen_at')
        partner_last_seen = lsa.isoformat() if hasattr(lsa, 'isoformat') else lsa

    return {
        'id': conv['id'],
        'is_group': is_group,
        'group_name': conv.get('group_name'),
        'last_message_at': conv['last_message_at'],
        'last_message_text': preview,
        'partner': partner_payload,
        'partner_last_seen': partner_last_seen,
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


def _ensure_bank_account_context(user_id: int) -> tuple[dict, bool]:
    account, auto_created = _auth_service.ensure_user_bank_account(user_id)
    if not account:
        raise ValueError('Банківський рахунок не знайдено. Зверніться до підтримки.')
    return account, auto_created


def _money_fmt(amount: float) -> str:
    return f"₴{float(amount or 0):,.2f}".replace(',', ' ')


def _period_label(from_date: str, to_date: str) -> str:
    return f'{from_date} → {to_date}'


def _try_send_via_channel(conn, lead_id: int, text: str) -> None:
    """Якщо лід прийшов через WhatsApp/Instagram і менеджер-власник ліда
    підключив свій канал у «Інтеграції» — реально надсилає відповідь через
    Meta Graph API від його імені. Best-effort: збій відправки не повинен
    ламати сам чат, лише лишає слід у лог ліда."""
    lead = conn.execute(
        'SELECT owner, primary_channel, phone, whatsapp_viber, instagram FROM leads WHERE id = %s',
        (lead_id,),
    ).fetchone()
    if not lead:
        return
    lead = dict(lead)
    channel = (lead.get('primary_channel') or '').strip().lower()
    owner = lead.get('owner') or ''

    if channel == 'whatsapp':
        to = (lead.get('whatsapp_viber') or lead.get('phone') or '').strip()
        if not to:
            return
        integration = get_integration(conn, owner, 'whatsapp')
        if not integration:
            return
        token = decrypt_message(integration['access_token'], fallback='')
        try:
            send_whatsapp_text(integration['external_id'], token, to, text)
        except MetaApiError as exc:
            _log_lead_activity(conn, lead_id, 'ARM CRM', 'system', f'Не вдалося надіслати у WhatsApp: {exc.message}')
    elif channel == 'instagram':
        to = (lead.get('instagram') or '').strip()
        if not to:
            return
        integration = get_integration(conn, owner, 'instagram')
        if not integration:
            return
        token = decrypt_message(integration['access_token'], fallback='')
        try:
            send_instagram_text(integration['external_id'], token, to, text)
        except MetaApiError as exc:
            _log_lead_activity(conn, lead_id, 'ARM CRM', 'system', f'Не вдалося надіслати в Instagram: {exc.message}')


def _get_or_create_assistant_user(conn) -> int:
    existing = conn.execute(
        'SELECT id FROM users WHERE role = %s OR phone = %s OR LOWER(email) = LOWER(%s) ORDER BY id ASC LIMIT 1',
        (_ASSISTANT_ROLE, _ASSISTANT_PHONE, _ASSISTANT_EMAIL),
    ).fetchone()
    if existing:
        uid = int(existing['id'])
        conn.execute(
            'UPDATE users SET role = %s, full_name = %s WHERE id = %s',
            (_ASSISTANT_ROLE, _ASSISTANT_NAME, uid),
        )
        return uid

    pwd_hash = hash_password(_ASSISTANT_PASSWORD)
    if USE_PG:
        row = conn.execute(
            """
            INSERT INTO users(full_name, phone, email, password_hash, role)
            VALUES(%s, %s, %s, %s, %s)
            RETURNING id
            """,
            (_ASSISTANT_NAME, _ASSISTANT_PHONE, _ASSISTANT_EMAIL, pwd_hash, _ASSISTANT_ROLE),
        ).fetchone()
        return int(row['id'])

    conn.execute(
        'INSERT INTO users(full_name, phone, email, password_hash, role) VALUES(%s, %s, %s, %s, %s)',
        (_ASSISTANT_NAME, _ASSISTANT_PHONE, _ASSISTANT_EMAIL, pwd_hash, _ASSISTANT_ROLE),
    )
    row = conn.execute('SELECT last_insert_rowid() AS id').fetchone()
    return int(row['id'])


def _default_assistant_welcome() -> str:
    return (
        "Вітаю! Я Army Bank Assistant ✅\n"
        "Я верифікований канал Army Bank і допомагаю з банківськими задачами прямо в чаті.\n\n"
        "Спробуйте відразу:\n"
        "• /меню\n"
        "• /баланс\n"
        "• /операції 7\n"
        "• /аналітика\n"
        "• /виписка pdf\n"
        "• /маркет\n"
        "• /карти\n"
        "• /безпека"
    )


def _ensure_default_assistant_conversation(user_id: int) -> tuple[int, int]:
    with get_connection() as conn:
        assistant_id = _get_or_create_assistant_user(conn)

        row = conn.execute(
            """
            SELECT c.id
            FROM conversations c
            JOIN conversation_participants cp1 ON cp1.conversation_id = c.id
            JOIN conversation_participants cp2 ON cp2.conversation_id = c.id
            WHERE COALESCE(c.is_group, %s) = %s
              AND cp1.user_id = %s
              AND cp2.user_id = %s
            ORDER BY c.id ASC
            LIMIT 1
            """,
            (_FALSE, _FALSE, user_id, assistant_id),
        ).fetchone()

        if row:
            conv_id = int(row['id'])
        else:
            if USE_PG:
                inserted = conn.execute(
                    'INSERT INTO conversations(created_at, is_group) VALUES(NOW(), %s) RETURNING id',
                    (_FALSE,),
                ).fetchone()
                conv_id = int(inserted['id'])
            else:
                conn.execute('INSERT INTO conversations(created_at, is_group) VALUES(datetime(\'now\'), %s)', (_FALSE,))
                conv_id = int(conn.execute('SELECT last_insert_rowid() AS id').fetchone()['id'])

            conn.execute(
                'INSERT INTO conversation_participants (conversation_id, user_id) VALUES (%s, %s)',
                (conv_id, user_id),
            )
            conn.execute(
                'INSERT INTO conversation_participants (conversation_id, user_id) VALUES (%s, %s)',
                (conv_id, assistant_id),
            )

        msg_row = conn.execute(
            'SELECT id FROM messages WHERE conversation_id = %s ORDER BY id ASC LIMIT 1',
            (conv_id,),
        ).fetchone()
        if not msg_row:
            welcome = _default_assistant_welcome()
            encrypted = encrypt_message(welcome)
            conn.execute(
                'INSERT INTO messages (conversation_id, sender_id, text, msg_type) VALUES (%s, %s, %s, %s)',
                (conv_id, assistant_id, encrypted, 'text'),
            )
            conn.execute(
                f'UPDATE conversations SET last_message_at = {_now_sql()}, last_message_text = %s WHERE id = %s',
                (welcome[:180], conv_id),
            )

        return conv_id, assistant_id


def _assistant_id_for_conversation(conn, conv_id: int) -> int | None:
    row = conn.execute(
        """
        SELECT u.id
        FROM conversation_participants cp
        JOIN users u ON u.id = cp.user_id
        WHERE cp.conversation_id = %s AND u.role = %s
        LIMIT 1
        """,
        (conv_id, _ASSISTANT_ROLE),
    ).fetchone()
    if not row:
        return None
    return int(row['id'])


def _extract_dates(text: str) -> tuple[str | None, str | None]:
    matches = re.findall(r'\b\d{4}-\d{2}-\d{2}\b', text or '')
    if len(matches) >= 2:
        return matches[0], matches[1]
    if len(matches) == 1:
        return matches[0], matches[0]
    return None, None


def _extract_count(text: str, default: int = 5, min_v: int = 1, max_v: int = 20) -> int:
    match = re.search(r'(?<!\d)(\d{1,2})(?!\d)', text or '')
    if not match:
        return default
    value = int(match.group(1))
    return max(min_v, min(max_v, value))


def _fmt_tx_datetime(raw: str) -> str:
    value = str(raw or '').replace('T', ' ').strip()
    return value[:16] if len(value) >= 16 else value


def _safe_float(value) -> float:
    try:
        return float(value or 0)
    except Exception:
        return 0.0


def _assistant_commands_guide() -> str:
    return (
        "Army Bank Assistant · верифікований канал ✅\n"
        "Доступні команди:\n"
        "• /меню — повний список можливостей\n"
        "• /баланс — рахунок + баланс + 3 останні операції\n"
        "• /операції 7 — останні N операцій (1..20)\n"
        "• /аналітика — підсумки за поточний та попередній місяць\n"
        "• /інсайти — фінансові патерни та рекомендації\n"
        "• /виписка pdf 2026-01-01 2026-01-31\n"
        "• /виписка csv 2026-01-01 2026-01-31\n"
        "• /маркет — відкрити ARM Marketplace (оплата через ваш рахунок)\n"
        "• /карти — статус карток (active/blocked/closed)\n"
        "• /реквізити — номер рахунку + IBAN-підказка\n"
        "• /цілі — прогрес накопичень\n"
        "• /шаблони — платіжні шаблони\n"
        "• /контакти — сімейні/часті контакти\n"
        "• /бюджет — ліміти та фактичні витрати\n"
        "• /борги — контроль боргів\n"
        "• /регулярні — регулярні платежі\n"
        "• /досягнення — прогрес гейміфікації\n"
        "• /безпека — чекліст захисту акаунта\n"
        "• /переказ — інструкція безпечного переказу"
    )


def _assistant_recent_ops(user_id: int, count: int = 5) -> str:
    txs = _account_service.list_transactions(user_id)[:count]
    if not txs:
        return 'Операцій поки немає.'
    lines = [f"Останні операції ({len(txs)}):"]
    for tx in txs:
        direction = str(tx.get('direction') or '').lower()
        sign = '+' if direction == 'in' else '-'
        lines.append(
            f"• {_fmt_tx_datetime(tx.get('created_at'))} · {sign}{_money_fmt(tx.get('amount'))} · {tx.get('description') or 'Операція'}"
        )
    return '\n'.join(lines)


def _assistant_analytics(user_id: int) -> str:
    analytics = _account_service.get_analytics(user_id) or {}
    current = analytics.get('current_month') or {}
    previous = analytics.get('prev_month') or {}
    by_type_rows = analytics.get('by_type') or []
    expense_by_type: dict[str, float] = defaultdict(float)
    for row in by_type_rows:
        if str(row.get('direction') or '').lower() != 'out':
            continue
        tx_type = str(row.get('tx_type') or 'other')
        expense_by_type[tx_type] += _safe_float(row.get('total'))
    top_expense = sorted(expense_by_type.items(), key=lambda item: item[1], reverse=True)[:3]

    cur_in = _safe_float(current.get('total_in'))
    cur_out = _safe_float(current.get('total_out'))
    prev_in = _safe_float(previous.get('total_in'))
    prev_out = _safe_float(previous.get('total_out'))
    cur_net = cur_in - cur_out
    prev_net = prev_in - prev_out
    delta = cur_net - prev_net
    trend = 'зростання' if delta > 0 else ('спад' if delta < 0 else 'без змін')
    lines = [
        'Аналітика рахунку:',
        f"• Поточний місяць: прихід {_money_fmt(cur_in)}, витрати {_money_fmt(cur_out)}, чистий результат {_money_fmt(cur_net)}",
        f"• Попередній місяць: прихід {_money_fmt(prev_in)}, витрати {_money_fmt(prev_out)}, чистий результат {_money_fmt(prev_net)}",
        f"• Динаміка до попереднього місяця: {_money_fmt(delta)} ({trend})",
    ]
    if top_expense:
        lines.append('Топ витрат за типом:')
        type_labels = {
            'transfer': 'Перекази',
            'donation': 'Донати',
            'savings': 'Накопичення',
            'topup': 'Поповнення',
            'payout': 'Виплати',
        }
        for tx_type, amount in top_expense:
            lines.append(f"• {type_labels.get(tx_type, tx_type)}: {_money_fmt(amount)}")
    lines.append('Порада: для деталей по днях використайте /інсайти.')
    return '\n'.join(lines)


def _assistant_cards(user_id: int) -> str:
    cards = _card_service.list_cards(user_id)
    if not cards:
        return 'Карток поки немає. Ви можете випустити нову у розділі «Картки».'
    total = len(cards)
    active = sum(1 for c in cards if str(c.get('status')) == 'active')
    blocked = sum(1 for c in cards if str(c.get('status')) == 'blocked')
    closed = sum(1 for c in cards if str(c.get('status')) == 'closed')
    lines = [
        f"Картки: всього {total} · активні {active} · заблоковані {blocked} · закриті {closed}",
    ]
    for c in cards[:5]:
        lines.append(
            f"• {c.get('masked_number') or '••••'} · {c.get('card_type') or 'card'} · {c.get('status') or 'unknown'} · до {c.get('expiry_display') or '--/--'}"
        )
    lines.append('Керування картками: розділ «Картки» → блокування/розблокування/закриття.')
    return '\n'.join(lines)


def _assistant_goals(user_id: int) -> str:
    goals = _feature_service.list_goals(user_id)
    if not goals:
        return 'Цілей накопичення поки немає. Додайте першу ціль у розділі «Накопичення».'
    lines = [f'Цілі накопичення: {len(goals)}']
    for goal in goals[:5]:
        target = _safe_float(goal.get('target_amount'))
        current = _safe_float(goal.get('current_amount'))
        pct = min(100.0, round((current / target * 100), 1)) if target > 0 else 0.0
        lines.append(
            f"• {goal.get('title') or 'Ціль'}: {_money_fmt(current)} / {_money_fmt(target)} ({pct}%)"
        )
    lines.append('Порада: регулярні внески у цілі допомагають згладити великі витрати.')
    return '\n'.join(lines)


def _assistant_contacts(user_id: int) -> str:
    contacts = _feature_service.list_contacts(user_id)
    if not contacts:
        return 'Сімейні/часті контакти ще не додані.'
    lines = [f'Контакти: {len(contacts)}']
    for item in contacts[:8]:
        name = item.get('contact_name') or 'Контакт'
        relation = item.get('relation_type') or 'контакт'
        account = item.get('account_number') or 'без рахунку'
        lines.append(f"• {name} ({relation}) · {account}")
    return '\n'.join(lines)


def _assistant_templates(user_id: int) -> str:
    templates = _feature_service.list_payment_templates(user_id)
    if not templates:
        return 'Шаблонів платежів поки немає.'
    lines = [f'Платіжні шаблони: {len(templates)}']
    for tpl in templates[:8]:
        amount = tpl.get('amount')
        amount_label = _money_fmt(amount) if amount is not None else 'сума не задана'
        lines.append(
            f"• {tpl.get('name') or 'Шаблон'} → {tpl.get('recipient_account') or '—'} · {amount_label}"
        )
    lines.append('Шаблони прискорюють регулярні перекази в 1–2 кліки.')
    return '\n'.join(lines)


def _assistant_budget(user_id: int) -> str:
    limits = _feature_service.list_budget_limits(user_id)
    if not limits:
        return (
            "Лімітів бюджету поки немає.\n"
            "Доступні категорії лімітів: transfer, donation, savings, topup."
        )
    labels = {
        'transfer': 'Перекази',
        'donation': 'Донати',
        'savings': 'Накопичення',
        'topup': 'Поповнення',
    }
    lines = ['Бюджетні ліміти (поточний місяць):']
    for lim in limits:
        tx_type = str(lim.get('tx_type') or 'other')
        spent = _safe_float(lim.get('spent'))
        monthly = _safe_float(lim.get('monthly_limit'))
        pct = _safe_float(lim.get('pct'))
        lines.append(
            f"• {labels.get(tx_type, tx_type)}: {_money_fmt(spent)} / {_money_fmt(monthly)} ({pct:.1f}%)"
        )
    return '\n'.join(lines)


def _assistant_debts(user_id: int) -> str:
    debts = _feature_service.list_debts(user_id)
    if not debts:
        return 'Активних боргів немає.'
    active = [d for d in debts if not d.get('is_settled')]
    owed_to_me = sum(_safe_float(d.get('amount')) for d in active if d.get('direction') == 'owed_to_me')
    i_owe = sum(_safe_float(d.get('amount')) for d in active if d.get('direction') == 'i_owe')
    lines = [
        f"Борги: активних {len(active)} (всього записів {len(debts)})",
        f"• Мені винні: {_money_fmt(owed_to_me)}",
        f"• Я винен: {_money_fmt(i_owe)}",
    ]
    for debt in active[:6]:
        direction = 'мені винні' if debt.get('direction') == 'owed_to_me' else 'я винен'
        lines.append(f"• {debt.get('contact_name') or 'Контакт'} · {_money_fmt(debt.get('amount'))} · {direction}")
    return '\n'.join(lines)


def _assistant_recurring(user_id: int) -> str:
    recurring = _feature_service.list_recurring(user_id)
    if not recurring:
        return 'Регулярних платежів поки немає.'
    active = [r for r in recurring if bool(r.get('is_active'))]
    lines = [f'Регулярні платежі: активні {len(active)} з {len(recurring)}']
    for item in active[:6]:
        lines.append(
            f"• {item.get('title') or 'Платіж'} · {_money_fmt(item.get('amount'))} · {item.get('frequency') or 'monthly'} · наступний {item.get('next_run_date') or '—'}"
        )
    return '\n'.join(lines)


def _assistant_achievements(user_id: int) -> str:
    payload = _account_service.get_achievements(user_id)
    done = int(payload.get('done') or 0)
    total = int(payload.get('total') or 0)
    pending = [a for a in (payload.get('achievements') or []) if not a.get('done')]
    lines = [f'Досягнення: виконано {done} з {total}']
    if pending:
        lines.append('Найближчі цілі:')
        for ach in pending[:4]:
            lines.append(f"• {ach.get('title')}: {ach.get('desc')}")
    else:
        lines.append('Усі досягнення відкриті. Відмінний результат!')
    return '\n'.join(lines)


def _assistant_security_tip(account_number: str) -> str:
    return (
        "Чекліст безпеки Army Bank:\n"
        "• Нікому не повідомляйте OTP, CVV, PIN та паролі.\n"
        "• Перевіряйте домен перед входом: army-bank.onrender.com.\n"
        "• Для підозрілих операцій негайно блокуйте картку.\n"
        "• Не переходьте за посиланнями з невідомих чатів.\n"
        "• Для підтримки використовуйте тільки верифікований Assistant ✅.\n"
        f"Ваш рахунок для перевірки: {account_number}."
    )


def _assistant_reply_text(user_id: int, user_text: str, script_root: str = '', request_origin: str = '') -> str:
    account, _ = _ensure_bank_account_context(user_id)
    text = (user_text or '').strip()
    low = text.lower()
    account_number = account.get('account_number') or '—'
    base = script_root or ''
    origin = str(request_origin or '').rstrip('/')

    def _absolute(link: str) -> str:
        raw = str(link or '')
        if raw.startswith('http://') or raw.startswith('https://'):
            return raw
        if raw.startswith('/') and origin:
            return f'{origin}{raw}'
        return raw

    def period_default() -> tuple[str, str]:
        to_d = date.today()
        from_d = to_d - timedelta(days=30)
        return from_d.isoformat(), to_d.isoformat()

    if not low:
        return _assistant_commands_guide()

    if any(k in low for k in (
        'прив', 'hello', 'help', 'допом', '/help', '/start',
        '/меню', '/команд', 'команд', 'можливост', 'що вмієш', 'what can you do',
    )):
        return _assistant_commands_guide()

    if any(k in low for k in ('реквіз', '/iban', 'iban', 'номер рахунку', 'account number')):
        return (
            "Реквізити рахунку:\n"
            f"• Номер рахунку: {account_number}\n"
            f"• Баланс: {_money_fmt(account.get('balance'))}\n\n"
            "Для переказів використовуйте номер рахунку отримувача або карту.\n"
            "Порада: перед відправкою перевіряйте останні 4 символи рахунку."
        )

    if any(k in low for k in ('баланс', '/баланс', 'balance', 'скільки на рахунку')):
        lines = [
            f"Ваш рахунок: {account_number}",
            f"Поточний баланс: {_money_fmt(account.get('balance'))}",
            '',
        ]
        lines.append(_assistant_recent_ops(user_id, 3))
        return '\n'.join(lines)

    if any(k in low for k in ('/операції', '/history', '/recent', 'останні операц', 'історі', 'history', 'recent')):
        count = _extract_count(low, default=7, min_v=1, max_v=20)
        return _assistant_recent_ops(user_id, count)

    if any(k in low for k in ('/аналітика', '/analytics', 'аналіт', 'доход', 'витрат', 'cashflow', 'грошовий потік')):
        try:
            return _assistant_analytics(user_id)
        except Exception:
            return 'Аналітика тимчасово недоступна. Спробуйте пізніше.'

    if any(k in low for k in ('/інсайти', 'інсайт', 'insight', 'звички', 'патерн', 'тренд')):
        try:
            payload = _account_service.get_spending_insights(user_id) or {}
            insights = payload.get('insights') or []
            if not insights:
                return 'Поки недостатньо даних для інсайтів. Виконайте кілька операцій.'
            lines = ['Фінансові інсайти:']
            for item in insights[:6]:
                icon = item.get('icon') or '•'
                txt = item.get('text') or ''
                lines.append(f'{icon} {txt}')
            lines.append('Рекомендація: перевіряйте /аналітика щотижня для контролю динаміки.')
            return '\n'.join(lines)
        except Exception:
            return 'Інсайти тимчасово недоступні.'

    if any(k in low for k in ('випис', 'statement', '/виписка', 'pdf', 'csv')):
        fmt = 'csv' if 'csv' in low else 'pdf'
        from_date, to_date = _extract_dates(low)
        if not from_date or not to_date:
            from_date, to_date = period_default()
        svc = StatementService()
        from_date, to_date = svc.normalize_period(from_date, to_date)

        if fmt == 'pdf':
            order = svc.create_statement_order(
                user_id=user_id,
                from_date=from_date,
                to_date=to_date,
                report_type='detailed',
            )
            download = _absolute(f"{base}/api/transactions/statement?{order['download_query']}")
            return (
                "✅ PDF-виписка підготовлена.\n"
                f"Період: {_period_label(from_date, to_date)}\n"
                f"Завантажити: {download}\n"
                "Також можна натиснути Bank Tools → «Завантажити PDF».\n"
                "Порада: для короткої виписки виберіть report_type=summary у Bank Tools."
            )
        query = urlencode({'from_date': from_date, 'to_date': to_date})
        download = _absolute(f"{base}/api/transactions/export?{query}")
        return (
            "✅ CSV-виписка підготовлена.\n"
            f"Період: {_period_label(from_date, to_date)}\n"
            f"Завантажити: {download}\n"
            "Також можна натиснути Bank Tools → «Завантажити CSV».\n"
            "CSV зручно для Excel, Power BI та бухгалтерського звіту."
        )

    if any(k in low for k in ('/карти', 'карт', 'card', 'заблок', 'block')):
        try:
            return _assistant_cards(user_id)
        except Exception:
            return (
                "По картках:\n"
                "• Блокування/розблокування — у розділі «Картки».\n"
                "• Випуск нової — кнопка «+ Випустити».\n"
                "• Якщо підозра на шахрайство — одразу блокуйте картку і змінюйте пароль."
            )

    if any(k in low for k in ('/цілі', 'накопич', 'goal', 'заощадж')):
        try:
            return _assistant_goals(user_id)
        except Exception:
            return 'Не вдалося отримати цілі накопичень.'

    if any(k in low for k in ('/шаблони', 'шаблон', 'template')):
        try:
            return _assistant_templates(user_id)
        except Exception:
            return 'Не вдалося отримати шаблони платежів.'

    if any(k in low for k in ('/контакти', 'контакт', 'family', 'родин')):
        try:
            return _assistant_contacts(user_id)
        except Exception:
            return 'Не вдалося отримати список контактів.'

    if any(k in low for k in ('/бюджет', 'ліміт', 'budget')):
        try:
            return _assistant_budget(user_id)
        except Exception:
            return 'Не вдалося отримати бюджетні ліміти.'

    if any(k in low for k in ('/борги', 'борг', 'debt')):
        try:
            return _assistant_debts(user_id)
        except Exception:
            return 'Не вдалося отримати інформацію по боргах.'

    if any(k in low for k in ('/регулярні', 'регулярн', 'recurring', 'автоплатіж')):
        try:
            return _assistant_recurring(user_id)
        except Exception:
            return 'Не вдалося отримати регулярні платежі.'

    if any(k in low for k in ('/досягнення', 'досягнен', 'achievement')):
        try:
            return _assistant_achievements(user_id)
        except Exception:
            return 'Не вдалося отримати прогрес досягнень.'

    if any(k in low for k in ('/безпека', 'безпек', 'security', 'фішинг', 'шахрай')):
        return _assistant_security_tip(account_number)

    if any(k in low for k in ('/маркет', '/market', '/marketplace', 'маркет', 'marketplace', 'магазин')):
        market_link = _absolute(f"{base}/marketplace")
        return (
            "ARM Marketplace готовий ✅\n"
            f"Відкрити: {market_link}\n\n"
            "Оплата відбувається безпосередньо через ваш рахунок ARM Bank.\n"
            "Після оплати транзакція зʼявиться в історії операцій автоматично."
        )

    if any(k in low for k in ('переказ', 'перевод', 'transfer', 'на карт', 'iban')):
        return (
            "Переказ можна зробити так:\n"
            "1) Відкрийте розділ «Операції» у банку.\n"
            "2) Вкажіть рахунок/картку отримувача.\n"
            "3) Введіть суму та підтвердьте.\n\n"
            "Для безпеки: перевіряйте номер рахунку двічі перед підтвердженням.\n"
            "Порада: спершу зробіть тестовий переказ на невелику суму."
        )

    return (
        "Я можу допомогти з банкінгом: баланс, операції, аналітика, виписки, картки, бюджет, безпека.\n"
        "Спробуйте /меню або /баланс."
    )


# ── Банківські інструменти в месенджері ─────────────────────────────────────

@messenger_bp.get('/bank/status')
@auth_required
def messenger_bank_status():
    user_id = int(g.current_user['id'])
    try:
        account, auto_created = _ensure_bank_account_context(user_id)
    except Exception as exc:
        return api_error(str(exc), 409)
    return jsonify({'ok': True, 'data': {
        'linked': bool(account),
        'auto_linked': bool(auto_created),
        'account_number': account.get('account_number'),
        'balance': float(account.get('balance') or 0),
        'currency': account.get('currency') or 'UAH',
        'notice': (
            'Банківський рахунок створено автоматично. '
            'Тепер Bank і Messenger працюють як єдиний акаунт.'
        ) if auto_created else None,
    }})


@messenger_bp.get('/bank/summary')
@auth_required
def messenger_bank_summary():
    user_id = int(g.current_user['id'])
    try:
        account, auto_created = _ensure_bank_account_context(user_id)
        recent = _account_service.list_transactions(user_id)[:5]
        quick_text_lines = [
            f"Рахунок: {account.get('account_number')}",
            f"Баланс: {_money_fmt(account.get('balance'))}",
        ]
        if recent:
            quick_text_lines.append('Останні операції:')
            for tx in recent[:3]:
                sign = '+' if (tx.get('direction') == 'in') else '-'
                quick_text_lines.append(
                    f"• {tx.get('created_at', '')[:16]} · {sign}{_money_fmt(tx.get('amount'))} · {tx.get('description') or 'Операція'}"
                )
        else:
            quick_text_lines.append('Операцій поки немає.')
        return jsonify({'ok': True, 'data': {
            'linked': True,
            'auto_linked': bool(auto_created),
            'account': {
                'id': account.get('id'),
                'account_number': account.get('account_number'),
                'balance': float(account.get('balance') or 0),
                'currency': account.get('currency') or 'UAH',
            },
            'recent_transactions': recent,
            'share_text': '\n'.join(quick_text_lines),
        }})
    except Exception as exc:
        return api_error(str(exc), 409)


@messenger_bp.post('/bank/statement/order')
@auth_required
def messenger_bank_statement_order():
    user_id = int(g.current_user['id'])
    data = request.get_json(silent=True) or {}
    fmt = (data.get('format') or 'pdf').strip().lower()
    report_type = (data.get('report_type') or 'detailed').strip().lower()
    from_date = data.get('from_date') or None
    to_date = data.get('to_date') or None

    if fmt not in ('pdf', 'csv'):
        return api_error("format має бути 'pdf' або 'csv'.")
    try:
        account, auto_created = _ensure_bank_account_context(user_id)
        svc = StatementService()
        norm_from, norm_to = svc.normalize_period(from_date, to_date)
        base = request.script_root or ''

        if fmt == 'pdf':
            order = svc.create_statement_order(
                user_id=user_id,
                from_date=norm_from,
                to_date=norm_to,
                report_type=report_type,
            )
            download_path = f"{base}/api/transactions/statement?{order['download_query']}"
            share_text = (
                f"Сформовано запит на PDF-виписку ({_period_label(norm_from, norm_to)}). "
                "Завантаження доступне в розділі Bank Tools."
            )
            return jsonify({'ok': True, 'data': {
                'linked': True,
                'auto_linked': bool(auto_created),
                'format': 'pdf',
                'period': {'from_date': norm_from, 'to_date': norm_to},
                'report_type': report_type,
                'order': order,
                'download_path': download_path,
                'share_text': share_text,
                'account_number': account.get('account_number'),
            }})

        # CSV
        qs = urlencode({'from_date': norm_from, 'to_date': norm_to})
        download_path = f"{base}/api/transactions/export?{qs}"
        share_text = (
            f"Підготовлено CSV-виписку ({_period_label(norm_from, norm_to)}). "
            "Завантаження доступне в розділі Bank Tools."
        )
        return jsonify({'ok': True, 'data': {
            'linked': True,
            'auto_linked': bool(auto_created),
            'format': 'csv',
            'period': {'from_date': norm_from, 'to_date': norm_to},
            'report_type': report_type,
            'download_path': download_path,
            'share_text': share_text,
            'account_number': account.get('account_number'),
        }})
    except Exception as exc:
        return api_error(str(exc), 409)


@messenger_bp.get('/assistant/capabilities')
@auth_required
def assistant_capabilities():
    account, _auto_created = _ensure_bank_account_context(int(g.current_user['id']))
    actions = [
        {'id': 'menu', 'label': 'Усі команди', 'command': '/меню'},
        {'id': 'balance', 'label': 'Баланс', 'command': '/баланс'},
        {'id': 'recent', 'label': 'Останні операції', 'command': '/операції 7'},
        {'id': 'analytics', 'label': 'Аналітика', 'command': '/аналітика'},
        {'id': 'insights', 'label': 'Інсайти', 'command': '/інсайти'},
        {'id': 'statement_pdf', 'label': 'Виписка PDF', 'command': '/виписка pdf'},
        {'id': 'statement_csv', 'label': 'Виписка CSV', 'command': '/виписка csv'},
        {'id': 'marketplace', 'label': 'Маркетплейс', 'command': '/маркет'},
        {'id': 'cards', 'label': 'Картки', 'command': '/карти'},
        {'id': 'requisites', 'label': 'Реквізити', 'command': '/реквізити'},
        {'id': 'goals', 'label': 'Цілі', 'command': '/цілі'},
        {'id': 'templates', 'label': 'Шаблони', 'command': '/шаблони'},
        {'id': 'contacts', 'label': 'Контакти', 'command': '/контакти'},
        {'id': 'budget', 'label': 'Бюджет', 'command': '/бюджет'},
        {'id': 'debts', 'label': 'Борги', 'command': '/борги'},
        {'id': 'recurring', 'label': 'Регулярні', 'command': '/регулярні'},
        {'id': 'achievements', 'label': 'Досягнення', 'command': '/досягнення'},
        {'id': 'security', 'label': 'Безпека', 'command': '/безпека'},
        {'id': 'transfer_help', 'label': 'Перекази', 'command': '/переказ'},
    ]
    return jsonify({'ok': True, 'data': {
        'assistant': {
            'name': _ASSISTANT_NAME,
            'verified': True,
            'role': _ASSISTANT_ROLE,
        },
        'account_number': account.get('account_number'),
        'actions': actions,
        'help': _assistant_commands_guide(),
    }})


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
              AND u.role != %s
              AND (u.full_name {op} %s OR u.phone LIKE %s OR a.account_number LIKE %s)
            LIMIT 20
            """,
            (me_id, _ASSISTANT_ROLE, like, like, like),
        ).fetchall()

    return jsonify({'ok': True, 'data': [dict(r) for r in rows]})


# ── Список розмов ────────────────────────────────────────────────────────────

@messenger_bp.get('/conversations')
@auth_required
def list_conversations():
    me_id = g.current_user['id']
    compact = (
        (request.args.get('compact') in ('1', 'true', 'yes'))
        or ((request.headers.get('X-Data-Saver') or '').strip() == '1')
    )
    try:
        _ensure_bank_account_context(int(me_id))
        assistant_conv_id = None
        if _ASSISTANT_FEATURE_ENABLED:
            assistant_conv_id, _assistant_id = _ensure_default_assistant_conversation(int(me_id))
        general_conv_id = _ensure_general_conversation(int(me_id))
        saved_conv_id = _ensure_self_conversation(int(me_id), _SAVED_MESSAGES_NAME)
        scheduler_conv_id = _ensure_self_conversation(int(me_id), _SCHEDULER_NAME)
        _maybe_post_scheduler_digest(int(me_id), scheduler_conv_id, str(g.current_user.get('role') or '').lower())
    except Exception as exc:
        return api_error(str(exc), 409)
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT cp.conversation_id
            FROM conversation_participants cp
            JOIN conversations c ON c.id = cp.conversation_id
            WHERE cp.user_id = %s AND c.lead_id IS NULL
            ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
            """,
            (me_id,),
        ).fetchall()

    result = []
    general_summary = None
    saved_summary = None
    scheduler_summary = None
    seen: set[int] = set()
    for row in rows:
        conv_id = int(row['conversation_id'])
        if conv_id in seen:
            continue
        seen.add(conv_id)
        summary = _conv_summary(conv_id, me_id, compact=compact)
        if not summary:
            continue
        partner_role = str((summary.get('partner') or {}).get('role') or '').lower()
        if not _ASSISTANT_FEATURE_ENABLED and partner_role == _ASSISTANT_ROLE:
            continue
        if conv_id == general_conv_id:
            general_summary = summary
            continue
        if conv_id == saved_conv_id:
            saved_summary = summary
            continue
        if conv_id == scheduler_conv_id:
            scheduler_summary = summary
            continue
        result.append(summary)

    if _ASSISTANT_FEATURE_ENABLED and assistant_conv_id and assistant_conv_id not in seen:
        summary = _conv_summary(assistant_conv_id, me_id, compact=compact)
        if summary:
            result.append(summary)

    # Фіксований порядок закріплених системних чатів: Загальний чат, Збережені
    # повідомлення, Планувальник — решта за часом останнього повідомлення.
    if scheduler_summary:
        result.insert(0, scheduler_summary)
    if saved_summary:
        result.insert(0, saved_summary)
    if general_summary:
        result.insert(0, general_summary)

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
        partner = conn.execute('SELECT id, role FROM users WHERE id = %s', (partner_id,)).fetchone()
    if not partner:
        return api_error('Користувача не знайдено.', 404)
    if not _ASSISTANT_FEATURE_ENABLED and str(partner.get('role') or '').lower() == _ASSISTANT_ROLE:
        return api_error('Асистент тимчасово недоступний.', 404)

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

    push_events: list[tuple[int, str, str, str, str, dict]] = []

    with get_connection() as conn:
        part = conn.execute(
            'SELECT id FROM conversation_participants WHERE conversation_id = %s AND user_id = %s',
            (conv_id, me_id),
        ).fetchone()
        if not part:
            return api_error('Доступ заборонено.', 403)

        conv_row = conn.execute(
            'SELECT COALESCE(is_group, %s) AS is_group, group_name FROM conversations WHERE id = %s',
            (_FALSE, conv_id),
        ).fetchone()
        is_group = bool((conv_row or {}).get('is_group'))
        group_name = str((conv_row or {}).get('group_name') or '').strip()
        sender_name = str(g.current_user.get('full_name') or 'Користувач')

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

        # Lead-linked conversation: mirror the message into the CRM activity log
        # so lead_activity (used by stats/CSV export) stays in sync with the real chat.
        lead_row = conn.execute('SELECT lead_id FROM conversations WHERE id = %s', (conv_id,)).fetchone()
        lead_id = (lead_row or {}).get('lead_id')
        if lead_id:
            _log_lead_activity(conn, int(lead_id), sender_name, 'note', preview)
            conn.execute(
                f'UPDATE leads SET last_touch_date = %s, updated_at = {_now_sql()} WHERE id = %s',
                (date.today().isoformat(), int(lead_id)),
            )
            if msg_type == 'text':
                _try_send_via_channel(conn, int(lead_id), text)

        participant_rows = conn.execute(
            """
            SELECT u.id, u.role
            FROM conversation_participants cp
            JOIN users u ON u.id = cp.user_id
            WHERE cp.conversation_id = %s AND cp.user_id != %s
            """,
            (conv_id, me_id),
        ).fetchall()

        msg_push_type = 'message_text'
        msg_push_body = text[:140]
        if msg_type == 'voice':
            msg_push_type = 'message_voice'
            msg_push_body = '🎤 Голосове повідомлення'
        elif msg_type == 'image':
            msg_push_type = 'message_image'
            msg_push_body = '🖼️ Фото'

        msg_push_title = f'ARM CRM · {group_name}' if (is_group and group_name) else sender_name
        msg_push_meta = {
            'conversation_id': int(conv_id),
            'sender_id': int(me_id),
            'sender_name': sender_name,
            'msg_type': msg_type,
        }
        for row in participant_rows:
            try:
                uid = int(row['id'])
            except Exception:
                continue
            role = str(row.get('role') or '').lower()
            if role == _ASSISTANT_ROLE:
                continue
            push_events.append((
                uid,
                msg_push_title,
                msg_push_body,
                f'/messenger?conv={conv_id}',
                msg_push_type,
                msg_push_meta,
            ))

        # Assistant auto-reply for default banking dialogue.
        assistant_id = _assistant_id_for_conversation(conn, conv_id)
        if assistant_id and int(assistant_id) != int(me_id) and msg_type == 'text':
            try:
                reply_text = _assistant_reply_text(
                    user_id=int(me_id),
                    user_text=text,
                    script_root=(request.script_root or ''),
                    request_origin=(request.url_root or ''),
                ).strip()
            except Exception:
                reply_text = (
                    'Не вдалося обробити запит. Спробуйте ще раз або відкрийте Bank Tools.'
                )
            if reply_text:
                encrypted_reply = encrypt_message(reply_text)
                conn.execute(
                    'INSERT INTO messages (conversation_id, sender_id, text, msg_type) VALUES (%s, %s, %s, %s)',
                    (conv_id, assistant_id, encrypted_reply, 'text'),
                )
                conn.execute(
                    f'UPDATE conversations SET last_message_at = {_now_sql()}, last_message_text = %s WHERE id = %s',
                    (reply_text[:180], conv_id),
                )
                push_events.append((
                    int(me_id),
                    'ARM Bank Assistant',
                    reply_text[:150],
                    f'/messenger?conv={conv_id}',
                    'assistant_reply',
                    {'conversation_id': int(conv_id), 'sender_id': int(assistant_id), 'sender_name': _ASSISTANT_NAME},
                ))

    for uid, title, body, push_url, push_type, meta in push_events:
        try:
            send_push(uid, title, body, push_url, push_type, meta=meta)
        except Exception:
            pass

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

        # Add creator (as admin)
        _TRUE = True if USE_PG else 1
        conn.execute(
            'INSERT INTO conversation_participants(conversation_id, user_id, is_admin) VALUES(%s,%s,%s)',
            (conv_id, me_id, _TRUE),
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
        # Check if current user is admin
        admin_check = conn.execute(
            'SELECT is_admin FROM conversation_participants WHERE conversation_id = %s AND user_id = %s',
            (conv_id, me_id),
        ).fetchone()
        if not admin_check or not admin_check['is_admin']:
            return api_error('Тільки адмін може видаляти учасників.', 403)
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
            SELECT u.id, u.full_name, u.last_seen_at, cp.is_admin, cp.joined_at
            FROM conversation_participants cp
            JOIN users u ON u.id = cp.user_id
            WHERE cp.conversation_id = %s
            ORDER BY cp.is_admin DESC, cp.joined_at ASC
            """,
            (conv_id,),
        ).fetchall()
    return jsonify([
        {
            'id': row['id'],
            'full_name': row['full_name'],
            'last_seen_at': row['last_seen_at'].isoformat() if hasattr(row['last_seen_at'], 'isoformat') else row['last_seen_at'],
            'is_admin': bool(row['is_admin']),
            'joined_at': row['joined_at'].isoformat() if hasattr(row['joined_at'], 'isoformat') else row['joined_at'],
        }
        for row in rows
    ])


@messenger_bp.put('/conversations/<int:conv_id>/group-name')
@auth_required
def rename_group(conv_id):
    data = request.get_json(silent=True) or {}
    new_name = str(data.get('group_name', '')).strip()[:100]
    if not new_name:
        return api_error('Назва не може бути порожньою.', 400)
    with get_connection() as conn:
        # Check admin
        row = conn.execute(
            'SELECT is_admin FROM conversation_participants WHERE conversation_id = %s AND user_id = %s',
            (conv_id, g.current_user['id']),
        ).fetchone()
        if not row or not row['is_admin']:
            return api_error('Тільки адмін може перейменовувати групу.', 403)
        conn.execute(
            'UPDATE conversations SET group_name = %s WHERE id = %s AND is_group = %s',
            (new_name, conv_id, True if USE_PG else 1),
        )
    return jsonify({'ok': True})


@messenger_bp.delete('/conversations/<int:conv_id>/leave')
@auth_required
def leave_group(conv_id):
    me_id = g.current_user['id']
    with get_connection() as conn:
        # Check participation
        row = conn.execute(
            'SELECT is_admin FROM conversation_participants WHERE conversation_id = %s AND user_id = %s',
            (conv_id, me_id),
        ).fetchone()
        if not row:
            return api_error('Ви не учасник цієї групи.', 403)
        # If last admin, transfer admin to oldest member
        if row['is_admin']:
            others = conn.execute(
                'SELECT user_id FROM conversation_participants WHERE conversation_id = %s AND user_id != %s ORDER BY joined_at ASC LIMIT 1',
                (conv_id, me_id),
            ).fetchone()
            if others:
                _TRUE = True if USE_PG else 1
                conn.execute(
                    'UPDATE conversation_participants SET is_admin = %s WHERE conversation_id = %s AND user_id = %s',
                    (_TRUE, conv_id, others['user_id']),
                )
        conn.execute(
            'DELETE FROM conversation_participants WHERE conversation_id = %s AND user_id = %s',
            (conv_id, me_id),
        )
    return jsonify({'ok': True})


# ── Presence ─────────────────────────────────────────────────────────────────

@messenger_bp.get('/presence')
@auth_required
def get_presence():
    """Return last_seen_at for given user IDs."""
    ids_param = request.args.get('ids', '')
    if not ids_param:
        return jsonify({'ok': True, 'data': {}})
    ids = [int(x) for x in ids_param.split(',') if x.strip().isdigit()]
    if not ids or len(ids) > 50:
        return jsonify({'ok': True, 'data': {}})
    with get_connection() as conn:
        placeholders = ','.join(['%s'] * len(ids))
        rows = conn.execute(
            f"SELECT id, last_seen_at FROM users WHERE id IN ({placeholders})",
            tuple(ids),
        ).fetchall()
    result = {}
    for row in rows:
        lsa = row['last_seen_at']
        result[str(row['id'])] = lsa.isoformat() if hasattr(lsa, 'isoformat') else lsa
    return jsonify({'ok': True, 'data': result})


# ── helpers ───────────────────────────────────────────────────────────────────

def _mark_read(conn, conv_id: int, user_id: int) -> None:
    conn.execute(
        f'UPDATE conversation_participants SET last_read_at = {_now_sql()} WHERE conversation_id = %s AND user_id = %s',
        (conv_id, user_id),
    )

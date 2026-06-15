"""Маршрути додаткових функцій Army Bank.

Цей модуль об'єднує всі «фічі» поза основними грошовими операціями:
  - Сімейні контакти       (/api/family-contacts)
  - Цілі накопичень        (/api/savings-goals)
  - Донації                (/api/donations)
  - Виплати                (/api/payouts)
  - Шаблони платежів       (/api/payment-templates)
  - Аудит-лог              (/api/audit-logs)
  - Бюджетні ліміти        (/api/budget-limits)
  - Повторювані транзакції  (/api/recurring-transactions)
  - Борги                  (/api/debts)
  - PIN-код                (/api/auth/pin)
  - Теги транзакцій        (/api/transactions/tags)
  - Аналітика витрат       (/api/analytics/velocity, /top-recipients)
  - Сповіщення             (/api/notifications)
"""
from __future__ import annotations

from flask import Blueprint, jsonify, request, g, current_app

from ..services.feature_service import FeatureService  # вся логіка додаткових функцій
from .helpers import api_error, auth_required

feature_bp = Blueprint('feature', __name__, url_prefix='/api')
service = FeatureService()   # один сервіс-синглтон для всіх фіч


# ── Сімейні контакти (швидкий переказ по книзі) ──────────────────────────────

@feature_bp.get('/family-contacts')
@auth_required
def list_contacts():
    """GET /api/family-contacts — список збережених контактів для швидкого переказу."""
    try:
        return jsonify({'ok': True, 'data': service.list_contacts(g.current_user['id'])})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.post('/family-contacts')
@auth_required
def add_contact():
    """POST /api/family-contacts — додати контакт.

    Body: { name, account_number, phone? } — зберігається для автопідстановки при переказах.
    """
    try:
        return jsonify({'ok': True, 'data': service.add_contact(g.current_user['id'], request.get_json(force=True))})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.delete('/family-contacts/<int:contact_id>')
@auth_required
def delete_contact(contact_id: int):
    """DELETE /api/family-contacts/{id} — видалити контакт.

    404 якщо контакт не знайдено або не належить поточному користувачу.
    """
    try:
        return jsonify({'ok': True, 'data': service.delete_contact(g.current_user['id'], contact_id)})
    except Exception as exc:
        return api_error(str(exc), 404)


# ── Цілі накопичень ───────────────────────────────────────────────────────────

@feature_bp.get('/savings-goals')
@auth_required
def list_goals():
    """GET /api/savings-goals — всі активні цілі накопичень користувача.

    Ціль — назва, цільова сума і поточний прогрес (accumulated_amount).
    """
    try:
        return jsonify({'ok': True, 'data': service.list_goals(g.current_user['id'])})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.post('/savings-goals')
@auth_required
def create_goal():
    """POST /api/savings-goals — створити нову ціль.

    Body: { name, target_amount, description? }
    """
    try:
        return jsonify({'ok': True, 'data': service.create_goal(g.current_user['id'], request.get_json(force=True))})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.post('/savings-goals/<int:goal_id>/contribute')
@auth_required
def contribute_goal(goal_id: int):
    """POST /api/savings-goals/{id}/contribute — поповнити ціль.

    Body: { amount: float } — сума списується з рахунку на накопичення.
    """
    try:
        data   = request.get_json(force=True)
        amount = float(data.get('amount') or 0)   # 0 -> сервіс відхилить
        return jsonify({'ok': True, 'data': service.contribute_goal(g.current_user['id'], goal_id, amount)})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.delete('/savings-goals/<int:goal_id>')
@auth_required
def delete_goal(goal_id: int):
    """DELETE /api/savings-goals/{id} — видалити/закрити ціль накопичення."""
    try:
        return jsonify({'ok': True, 'data': service.delete_goal(g.current_user['id'], goal_id)})
    except Exception as exc:
        return api_error(str(exc), 404)


# ── Донації (збір на ЗСУ, благодійність) ─────────────────────────────────────

@feature_bp.get('/donations')
@auth_required
def list_donations():
    """GET /api/donations — список донацій поточного користувача."""
    try:
        return jsonify({'ok': True, 'data': service.list_donations(g.current_user['id'])})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.post('/donations')
@auth_required
def create_donation():
    """POST /api/donations — зробити донацію.

    Body: { amount, recipient, description? } — списує з рахунку і фіксує як донацію.
    """
    try:
        return jsonify({'ok': True, 'data': service.create_donation(g.current_user['id'], request.get_json(force=True))})
    except Exception as exc:
        return api_error(str(exc))


# ── Виплати (перегляд нарахованих від оператора) ─────────────────────────────

@feature_bp.get('/payouts')
@auth_required
def list_payouts():
    """GET /api/payouts — список всіх нарахованих виплат (salary, бойові тощо)."""
    try:
        return jsonify({'ok': True, 'data': service.list_payouts(g.current_user['id'])})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.post('/payouts/demo-accrual')
@auth_required
def demo_payout():
    """POST /api/payouts/demo-accrual — демо-нарахування (тільки на dev).

    Аналогічно ALLOW_PLATFORM_DEMO_SEED: флаг ALLOW_DEMO_PAYOUT_ACCRUAL
    захищає від виконання на PROD. Корисно для тестування UI виплат без оператора.
    """
    if not bool(current_app.config.get('ALLOW_DEMO_PAYOUT_ACCRUAL', False)):
        return api_error('Демо-нарахування вимкнено на цьому середовищі.', 403)
    try:
        return jsonify({'ok': True, 'data': service.create_demo_payout(g.current_user['id'], request.get_json(force=True))})
    except Exception as exc:
        return api_error(str(exc))


# ── Шаблони платежів (збережені одержувачі + суми) ───────────────────────────

@feature_bp.get('/payment-templates')
@auth_required
def list_payment_templates():
    """GET /api/payment-templates — збережені шаблони для повторюваних переказів."""
    try:
        return jsonify({'ok': True, 'data': service.list_payment_templates(g.current_user['id'])})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.post('/payment-templates')
@auth_required
def create_payment_template():
    """POST /api/payment-templates — зберегти шаблон платежу.

    Body: { name, recipient_account, amount?, description? }
    """
    try:
        return jsonify({'ok': True, 'data': service.create_payment_template(g.current_user['id'], request.get_json(force=True))})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.delete('/payment-templates/<int:template_id>')
@auth_required
def delete_payment_template(template_id: int):
    """DELETE /api/payment-templates/{id} — видалити шаблон."""
    try:
        return jsonify({'ok': True, 'data': service.delete_payment_template(g.current_user['id'], template_id)})
    except Exception as exc:
        return api_error(str(exc), 404)


@feature_bp.get('/payment-templates/<int:template_id>')
@auth_required
def get_payment_template(template_id: int):
    """GET /api/payment-templates/{id} — деталі конкретного шаблону."""
    try:
        t = service.get_payment_template(template_id, g.current_user['id'])
        if not t:
            return api_error('Шаблон не знайдено.', 404)
        return jsonify({'ok': True, 'data': t})
    except Exception as exc:
        return api_error(str(exc))


# ── Аудит-лог (власний, не адмінський) ───────────────────────────────────────

@feature_bp.get('/audit-logs')
@auth_required
def list_my_audit_logs():
    """GET /api/audit-logs — аудит-лог дій поточного користувача.

    Відображає: зміни пароля, виплати, KYC-верифікацію тощо.
    Не плутати з /api/platform/audit-logs (там всі користувачі, тільки для platform_admin).
    """
    try:
        return jsonify({'ok': True, 'data': service.list_audit_logs(g.current_user['id'])})
    except Exception as exc:
        return api_error(str(exc))


# ── Бюджетні ліміти (щомісячні ліміти по категоріях витрат) ──────────────────

@feature_bp.get('/budget-limits')
@auth_required
def list_budget_limits():
    """GET /api/budget-limits — щомісячні ліміти витрат по категоріях (tx_type)."""
    try:
        return jsonify({'ok': True, 'data': service.list_budget_limits(g.current_user['id'])})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.post('/budget-limits')
@auth_required
def set_budget_limit():
    """POST /api/budget-limits — встановити або оновити ліміт для категорії.

    Body: { tx_type: str, monthly_limit: float }
    tx_type — тип транзакції: 'transfer', 'donation', 'marketplace' тощо.
    """
    try:
        data          = request.get_json(force=True)
        tx_type       = (data.get('tx_type') or '').strip()
        monthly_limit = float(data.get('monthly_limit') or 0)
        return jsonify({'ok': True, 'data': service.set_budget_limit(g.current_user['id'], tx_type, monthly_limit)})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.delete('/budget-limits/<string:tx_type>')
@auth_required
def delete_budget_limit(tx_type: str):
    """DELETE /api/budget-limits/{tx_type} — зняти ліміт для категорії."""
    try:
        return jsonify({'ok': True, 'data': service.delete_budget_limit(g.current_user['id'], tx_type)})
    except Exception as exc:
        return api_error(str(exc))


# ── Повторювані транзакції (регулярні платежі) ────────────────────────────────

@feature_bp.get('/recurring-transactions')
@auth_required
def list_recurring():
    """GET /api/recurring-transactions — список запланованих регулярних платежів.

    Регулярний платіж — автоматичний переказ з певною частотою (weekly/monthly).
    Виконання контролює APScheduler або cron-ендпоінт.
    """
    try:
        return jsonify({'ok': True, 'data': service.list_recurring(g.current_user['id'])})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.post('/recurring-transactions')
@auth_required
def create_recurring():
    """POST /api/recurring-transactions — створити регулярний платіж.

    Body: { recipient_account, amount, frequency, description? }
    """
    try:
        rec_id = service.create_recurring(g.current_user['id'], request.get_json(force=True))
        return jsonify({'ok': True, 'data': {'id': rec_id}})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.delete('/recurring-transactions/<int:recurring_id>')
@auth_required
def delete_recurring(recurring_id: int):
    """DELETE /api/recurring-transactions/{id} — видалити регулярний платіж."""
    try:
        return jsonify({'ok': True, 'data': service.delete_recurring(g.current_user['id'], recurring_id)})
    except Exception as exc:
        return api_error(str(exc), 404)


@feature_bp.patch('/recurring-transactions/<int:recurring_id>/toggle')
@auth_required
def toggle_recurring(recurring_id: int):
    """PATCH /api/recurring-transactions/{id}/toggle — увімкнути/вимкнути платіж.

    Body: { is_active: bool } — True = активний, False = призупинений.
    """
    try:
        data      = request.get_json(force=True)
        is_active = bool(data.get('is_active', True))
        ok        = service.toggle_recurring(g.current_user['id'], recurring_id, is_active)
        return jsonify({'ok': True, 'data': ok})
    except Exception as exc:
        return api_error(str(exc))


# ── Борги (позики між солдатами) ─────────────────────────────────────────────

@feature_bp.get('/debts')
@auth_required
def list_debts():
    """GET /api/debts — борги поточного користувача (виданні і отримані позики)."""
    try:
        return jsonify({'ok': True, 'data': service.list_debts(g.current_user['id'])})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.post('/debts')
@auth_required
def create_debt():
    """POST /api/debts — зафіксувати борг.

    Body: { debtor_account, amount, description, due_date? }
    Не списує гроші — лише фіксує факт боргу для відстеження.
    """
    try:
        debt_id = service.create_debt(g.current_user['id'], request.get_json(force=True))
        return jsonify({'ok': True, 'data': {'id': debt_id}})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.post('/debts/<int:debt_id>/settle')
@auth_required
def settle_debt(debt_id: int):
    """POST /api/debts/{id}/settle — позначити борг як погашений.

    Не виконує переказ — лише змінює статус боргу на 'settled'.
    Реальний переказ (якщо потрібен) клієнт робить окремо через /api/transactions/transfer.
    """
    try:
        return jsonify({'ok': True, 'data': service.settle_debt(g.current_user['id'], debt_id)})
    except Exception as exc:
        return api_error(str(exc), 404)


@feature_bp.delete('/debts/<int:debt_id>')
@auth_required
def delete_debt(debt_id: int):
    """DELETE /api/debts/{id} — видалити запис боргу (скасувати)."""
    try:
        return jsonify({'ok': True, 'data': service.delete_debt(g.current_user['id'], debt_id)})
    except Exception as exc:
        return api_error(str(exc), 404)


# ── PIN-код (додатковий захист у мобільному PWA) ─────────────────────────────

@feature_bp.put('/auth/pin')
@auth_required
def set_pin():
    """PUT /api/auth/pin — встановити або змінити PIN.

    Body: { pin: str } — 4-6 цифровий код, зберігається як хеш.
    PIN — опціональний другий фактор всередині PWA (не замінює Bearer-токен).
    """
    try:
        data = request.get_json(force=True)
        pin  = str(data.get('pin') or '')
        return jsonify({'ok': True, 'data': service.set_pin(g.current_user['id'], pin)})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.post('/auth/pin/verify')
@auth_required
def verify_pin():
    """POST /api/auth/pin/verify — перевірити PIN.

    Body: { pin: str } — повертає 401 якщо PIN неправильний.
    Використовується для підтвердження чутливих дій у PWA без повного logout/login.
    """
    try:
        data = request.get_json(force=True)
        pin  = str(data.get('pin') or '')
        ok   = service.verify_pin(g.current_user['id'], pin)
        if not ok:
            return api_error('Невірний PIN.', 401)   # 401 = невірний PIN
        return jsonify({'ok': True, 'data': True})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.delete('/auth/pin')
@auth_required
def clear_pin():
    """DELETE /api/auth/pin — видалити PIN (вимкнути PIN-захист)."""
    try:
        return jsonify({'ok': True, 'data': service.clear_pin(g.current_user['id'])})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.get('/auth/pin/status')
@auth_required
def pin_status():
    """GET /api/auth/pin/status — чи встановлений PIN у поточного користувача.

    Повертає { has_pin: bool } — UI показує різний екран залежно від наявності PIN.
    """
    try:
        return jsonify({'ok': True, 'data': {'has_pin': service.has_pin(g.current_user['id'])}})
    except Exception as exc:
        return api_error(str(exc))


# ── Теги транзакцій (власні мітки для сортування) ────────────────────────────

@feature_bp.get('/transactions/tags')
@auth_required
def list_tags():
    """GET /api/transactions/tags — всі унікальні теги по транзакціях рахунку.

    Lazy import AccountService: уникаємо кругової залежності між feature і account.
    """
    try:
        from ..services.account_service import AccountService
        account = AccountService().get_main_account(g.current_user['id'])   # потрібен account_id
        tags    = service.list_tags(account['id'])
        return jsonify({'ok': True, 'data': tags})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.patch('/transactions/<int:transaction_id>/tags')
@auth_required
def update_tags(transaction_id: int):
    """PATCH /api/transactions/{id}/tags — оновити теги транзакції.

    Body: { tags: str } — теги через кому (напр. "їжа,ресторан").
    Перевіряємо через account['id'] що транзакція належить поточному рахунку.
    """
    try:
        from ..services.account_service import AccountService
        account = AccountService().get_main_account(g.current_user['id'])
        data    = request.get_json(force=True)
        tags    = str(data.get('tags') or '')
        ok      = service.update_tags(account['id'], transaction_id, tags)
        return jsonify({'ok': True, 'data': ok})
    except Exception as exc:
        return api_error(str(exc))


# ── Velocity і топ отримувачів (аналітика для PWA) ───────────────────────────

@feature_bp.get('/analytics/velocity')
@auth_required
def spending_velocity():
    """GET /api/analytics/velocity — швидкість витрат (порівняння поточного тижня з попереднім).

    Показує тренд: більше чи менше витрачаємо ніж зазвичай.
    """
    try:
        from ..services.account_service import AccountService
        account = AccountService().get_main_account(g.current_user['id'])
        data    = service.get_velocity(account['id'])
        return jsonify({'ok': True, 'data': data})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.get('/analytics/top-recipients')
@auth_required
def top_recipients():
    """GET /api/analytics/top-recipients — топ-отримувачів переказів (за частотою і сумою).

    Використовується у PWA для швидкого вибору «кому відправити» на основі
    реальних даних попередніх переказів.
    """
    try:
        from ..services.account_service import AccountService
        account = AccountService().get_main_account(g.current_user['id'])
        data    = service.get_top_recipients(account['id'])
        return jsonify({'ok': True, 'data': data})
    except Exception as exc:
        return api_error(str(exc))


# ── Сповіщення в додатку (in-app notifications) ───────────────────────────────

@feature_bp.get('/notifications')
@auth_required
def list_notifications():
    """GET /api/notifications — список in-app сповіщень (останні 50).

    Відрізняється від Web Push: це сповіщення всередині застосунку (дзвіночок),
    а не push на пристрій. Зберігаються в БД, видимі поки не прочитані.
    """
    try:
        return jsonify({'ok': True, 'data': service.list_notifications(g.current_user['id'])})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.get('/notifications/unread-count')
@auth_required
def unread_count():
    """GET /api/notifications/unread-count — кількість непрочитаних сповіщень.

    Повертає { count: int } — UI показує badge на дзвіночку.
    Окремий легкий ендпоінт (без тіла сповіщень) для polling або SSE.
    """
    try:
        return jsonify({'ok': True, 'data': {'count': service.count_unread(g.current_user['id'])}})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.post('/notifications/read-all')
@auth_required
def mark_all_read():
    """POST /api/notifications/read-all — позначити всі сповіщення як прочитані.

    Масова операція: скидає badge до 0.
    """
    try:
        service.mark_all_read(g.current_user['id'])
        return jsonify({'ok': True, 'data': True})
    except Exception as exc:
        return api_error(str(exc))


@feature_bp.post('/notifications/<int:notification_id>/read')
@auth_required
def mark_one_read(notification_id: int):
    """POST /api/notifications/{id}/read — позначити одне сповіщення прочитаним.

    Сервіс перевіряє власність (g.current_user['id'] == notification.user_id).
    """
    try:
        service.mark_one_read(notification_id, g.current_user['id'])
        return jsonify({'ok': True, 'data': True})
    except Exception as exc:
        return api_error(str(exc))

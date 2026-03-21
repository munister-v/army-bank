"""Сервіс спеціалізованих функцій Army Bank."""
from __future__ import annotations

from ..repositories.account_repository import AccountRepository
from ..repositories.feature_repository import FeatureRepository
from ..utils.validators import validate_positive_amount


class FeatureService:
    def __init__(self) -> None:
        self.repo = FeatureRepository()
        self.account_repo = AccountRepository()

    def list_contacts(self, user_id: int):
        return self.repo.list_family_contacts(user_id)

    def add_contact(self, user_id: int, data: dict):
        contact_name = (data.get('contact_name') or '').strip()
        relation_type = (data.get('relation_type') or '').strip()
        phone = (data.get('phone') or '').strip()
        account_number = (data.get('account_number') or '').strip() or None
        if not contact_name or not relation_type:
            raise ValueError('Потрібно вказати імʼя контакту та тип звʼязку.')
        self.repo.add_family_contact(user_id, contact_name, relation_type, phone, account_number)
        self.repo.add_audit_log(user_id, 'add_family_contact', f'Додано контакт {contact_name}.')
        return self.repo.list_family_contacts(user_id)

    def delete_contact(self, user_id: int, contact_id: int):
        deleted = self.repo.delete_family_contact(contact_id, user_id)
        if not deleted:
            raise ValueError('Контакт не знайдено або немає прав для видалення.')
        self.repo.add_audit_log(user_id, 'delete_family_contact', f'Видалено контакт #{contact_id}.')
        return self.repo.list_family_contacts(user_id)

    def list_goals(self, user_id: int):
        return self.repo.list_savings_goals(user_id)

    def create_goal(self, user_id: int, data: dict):
        title = (data.get('title') or '').strip()
        target_amount = float(data.get('target_amount') or 0)
        deadline = (data.get('deadline') or '').strip() or None
        if not title:
            raise ValueError('Потрібно вказати назву цілі.')
        validate_positive_amount(target_amount)
        self.repo.create_savings_goal(user_id, title, target_amount, deadline)
        self.repo.add_audit_log(user_id, 'create_goal', f'Створено ціль: {title}.')
        return self.repo.list_savings_goals(user_id)

    def contribute_goal(self, user_id: int, goal_id: int, amount: float):
        validate_positive_amount(amount)
        goal = self.repo.get_savings_goal(goal_id, user_id)
        if not goal:
            raise ValueError('Ціль накопичення не знайдено.')
        account = self.account_repo.get_account_by_user_id(user_id)
        if account['balance'] < amount:
            raise ValueError('Недостатньо коштів для внеску в накопичення.')

        new_balance = round(account['balance'] - amount, 2)
        new_goal_amount = round(goal['current_amount'] + amount, 2)
        self.account_repo.update_balance(account['id'], new_balance)
        self.account_repo.add_transaction(account['id'], 'savings', 'out', amount, f"Внесок у накопичення: {goal['title']}")
        self.repo.update_goal_amount(goal_id, new_goal_amount)
        self.repo.add_audit_log(user_id, 'goal_contribution', f"Поповнення цілі '{goal['title']}' на {amount:.2f} грн.")
        return self.repo.list_savings_goals(user_id)

    def delete_goal(self, user_id: int, goal_id: int):
        deleted = self.repo.delete_savings_goal(goal_id, user_id)
        if not deleted:
            raise ValueError('Ціль не знайдено або немає прав для видалення.')
        self.repo.add_audit_log(user_id, 'delete_goal', f'Видалено ціль #{goal_id}.')
        return self.repo.list_savings_goals(user_id)

    def list_donations(self, user_id: int):
        return self.repo.list_donations(user_id)

    def create_donation(self, user_id: int, data: dict):
        fund_name = (data.get('fund_name') or '').strip()
        comment = (data.get('comment') or '').strip() or None
        amount = float(data.get('amount') or 0)
        if not fund_name:
            raise ValueError('Потрібно вказати назву фонду або напрям донату.')
        validate_positive_amount(amount)
        account = self.account_repo.get_account_by_user_id(user_id)
        if account['balance'] < amount:
            raise ValueError('Недостатньо коштів для донату.')
        new_balance = round(account['balance'] - amount, 2)
        self.account_repo.update_balance(account['id'], new_balance)
        self.account_repo.add_transaction(account['id'], 'donation', 'out', amount, f'Донат: {fund_name}')
        self.repo.create_donation(user_id, fund_name, amount, comment)
        self.repo.add_audit_log(user_id, 'donation', f'Донат {amount:.2f} грн у напрямі {fund_name}.')
        return self.repo.list_donations(user_id)

    def list_payouts(self, user_id: int):
        return self.repo.list_payouts(user_id)

    def create_demo_payout(self, user_id: int, data: dict):
        title = (data.get('title') or 'Бойова виплата').strip()
        payout_type = (data.get('payout_type') or 'combat').strip()
        amount = float(data.get('amount') or 0)
        validate_positive_amount(amount)

        account = self.account_repo.get_account_by_user_id(user_id)
        new_balance = round(account['balance'] + amount, 2)
        self.account_repo.update_balance(account['id'], new_balance)
        self.account_repo.add_transaction(account['id'], 'payout', 'in', amount, title)
        self.repo.create_payout(user_id, title, amount, payout_type)
        self.repo.add_audit_log(user_id, 'demo_payout', f'Нараховано виплату {amount:.2f} грн.')
        return self.repo.list_payouts(user_id)

    def list_payment_templates(self, user_id: int):
        return self.repo.list_payment_templates(user_id)

    def create_payment_template(self, user_id: int, data: dict):
        name = (data.get('name') or '').strip()
        recipient_account = (data.get('recipient_account') or '').strip()
        amount = data.get('amount')
        amount = float(amount) if amount is not None and amount != '' else None
        description = (data.get('description') or '').strip()
        if not name or not recipient_account:
            raise ValueError('Потрібно вказати назву та рахунок отримувача.')
        self.repo.create_payment_template(user_id, name, recipient_account, amount, description, is_system=False)
        return self.repo.list_payment_templates(user_id)

    def delete_payment_template(self, user_id: int, template_id: int):
        deleted = self.repo.delete_payment_template(template_id, user_id)
        if not deleted:
            raise ValueError('Шаблон не знайдено або немає прав для видалення.')
        self.repo.add_audit_log(user_id, 'delete_template', f'Видалено шаблон #{template_id}.')
        return self.repo.list_payment_templates(user_id)

    def get_payment_template(self, template_id: int, user_id: int):
        return self.repo.get_payment_template(template_id, user_id)

    def list_audit_logs(self, user_id: int):
        return self.repo.list_audit_logs(user_id, limit=50)

    def list_budget_limits(self, user_id):
        limits = self.repo.list_budget_limits(user_id)
        account = self.account_repo.get_account_by_user_id(user_id)
        spending = self.repo.get_monthly_spending(account['id']) if account else {}
        result = []
        for lim in limits:
            spent = spending.get(lim['tx_type'], 0)
            pct = round(spent / float(lim['monthly_limit']) * 100, 1) if lim['monthly_limit'] else 0
            result.append({**dict(lim), 'spent': spent, 'pct': min(pct, 100)})
        return result

    def set_budget_limit(self, user_id, tx_type, monthly_limit):
        validate_positive_amount(monthly_limit)
        valid_types = ['transfer', 'donation', 'savings', 'topup']
        if tx_type not in valid_types:
            raise ValueError('Невідомий тип транзакції.')
        self.repo.set_budget_limit(user_id, tx_type, monthly_limit)
        return self.list_budget_limits(user_id)

    def delete_budget_limit(self, user_id, tx_type):
        self.repo.delete_budget_limit(user_id, tx_type)
        return self.list_budget_limits(user_id)

    # ── Recurring ──────────────────────────────────────────
    def list_recurring(self, user_id: int) -> list:
        return self.repo.list_recurring(user_id)

    def create_recurring(self, user_id: int, data: dict) -> int:
        title = (data.get('title') or '').strip()
        if not title:
            raise ValueError('Назва обов\'язкова.')
        amount = float(data.get('amount') or 0)
        validate_positive_amount(amount)
        tx_type = (data.get('tx_type') or 'transfer').strip()
        recipient = (data.get('recipient_account') or '').strip() or None
        description = (data.get('description') or '').strip()
        frequency = (data.get('frequency') or 'monthly').strip()
        next_run = (data.get('next_run_date') or '').strip()
        if not next_run:
            raise ValueError('Дата наступного виконання обов\'язкова.')
        return self.repo.create_recurring(user_id, title, amount, tx_type, recipient, description, frequency, next_run)

    def delete_recurring(self, user_id: int, recurring_id: int) -> bool:
        ok = self.repo.delete_recurring(recurring_id, user_id)
        if not ok:
            raise ValueError('Запис не знайдено.')
        return True

    def toggle_recurring(self, user_id: int, recurring_id: int, is_active: bool) -> bool:
        return self.repo.toggle_recurring(recurring_id, user_id, is_active)

    # ── Debts ──────────────────────────────────────────────
    def list_debts(self, user_id: int) -> list:
        return self.repo.list_debts(user_id)

    def create_debt(self, user_id: int, data: dict) -> int:
        contact_name = (data.get('contact_name') or '').strip()
        if not contact_name:
            raise ValueError('Ім\'я контакту обов\'язкове.')
        amount = float(data.get('amount') or 0)
        if amount <= 0:
            raise ValueError('Сума повинна бути більше 0.')
        direction = (data.get('direction') or 'owed_to_me').strip()
        if direction not in ('owed_to_me', 'i_owe'):
            raise ValueError('Недійсний напрям боргу.')
        description = (data.get('description') or '').strip() or None
        return self.repo.create_debt(user_id, contact_name, amount, direction, description)

    def settle_debt(self, user_id: int, debt_id: int) -> bool:
        ok = self.repo.settle_debt(debt_id, user_id)
        if not ok:
            raise ValueError('Борг не знайдено або вже закрито.')
        return True

    def delete_debt(self, user_id: int, debt_id: int) -> bool:
        ok = self.repo.delete_debt(debt_id, user_id)
        if not ok:
            raise ValueError('Борг не знайдено.')
        return True

    # ── PIN ────────────────────────────────────────────────
    def set_pin(self, user_id: int, pin: str) -> bool:
        if not pin or len(pin) != 4 or not pin.isdigit():
            raise ValueError('PIN повинен містити рівно 4 цифри.')
        try:
            import bcrypt
            pin_hash = bcrypt.hashpw(pin.encode(), bcrypt.gensalt()).decode()
        except ImportError:
            import hashlib
            pin_hash = hashlib.sha256(pin.encode()).hexdigest()
        self.repo.set_pin_hash(user_id, pin_hash)
        return True

    def verify_pin(self, user_id: int, pin: str) -> bool:
        pin_hash = self.repo.get_pin_hash(user_id)
        if not pin_hash:
            return True
        if not pin or not pin.isdigit():
            return False
        try:
            import bcrypt
            return bcrypt.checkpw(pin.encode(), pin_hash.encode())
        except ImportError:
            import hashlib
            return hashlib.sha256(pin.encode()).hexdigest() == pin_hash

    def clear_pin(self, user_id: int) -> bool:
        self.repo.clear_pin(user_id)
        return True

    def has_pin(self, user_id: int) -> bool:
        return bool(self.repo.get_pin_hash(user_id))

    # ── Tags ───────────────────────────────────────────────
    def update_tags(self, account_id: int, transaction_id: int, tags: str) -> bool:
        tags_clean = ','.join(t.strip() for t in (tags or '').split(',') if t.strip())
        return self.repo.update_transaction_tags(transaction_id, account_id, tags_clean)

    def list_tags(self, account_id: int) -> list:
        return self.repo.get_all_tags(account_id)

    # ── Spending Velocity ──────────────────────────────────
    def get_velocity(self, account_id: int) -> dict:
        return self.repo.get_spending_velocity(account_id)

    # ── Top Recipients ─────────────────────────────────────
    def get_top_recipients(self, account_id: int) -> list:
        return self.repo.get_top_recipients(account_id)

    # ── Notifications ──────────────────────────────────────
    def create_notification(self, user_id: int, type: str, title: str, body: str = '', icon: str = '🔔') -> int:
        return self.repo.create_notification(user_id, type, title, body, icon)

    def list_notifications(self, user_id: int) -> list:
        rows = self.repo.list_notifications(user_id)
        result = []
        for r in rows:
            d = dict(r)
            # Normalize boolean is_read for SQLite (0/1) and PG (True/False)
            d['is_read'] = bool(d.get('is_read'))
            result.append(d)
        return result

    def count_unread(self, user_id: int) -> int:
        return self.repo.count_unread(user_id)

    def mark_all_read(self, user_id: int) -> None:
        self.repo.mark_all_read(user_id)

    def mark_one_read(self, notification_id: int, user_id: int) -> None:
        self.repo.mark_one_read(notification_id, user_id)

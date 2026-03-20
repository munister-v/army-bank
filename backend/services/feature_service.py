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

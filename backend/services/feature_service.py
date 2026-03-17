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

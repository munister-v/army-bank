"""Сервіс рахунків і транзакцій."""
from __future__ import annotations

from ..repositories.account_repository import AccountRepository
from ..repositories.feature_repository import FeatureRepository
from ..repositories.user_repository import UserRepository
from ..utils.validators import validate_positive_amount


class AccountService:
    def __init__(self) -> None:
        self.accounts = AccountRepository()
        self.users = UserRepository()
        self.features = FeatureRepository()

    def get_main_account(self, user_id: int) -> dict:
        account = self.accounts.get_account_by_user_id(user_id)
        if not account:
            raise ValueError('Рахунок користувача не знайдено.')
        return account

    def topup(self, user_id: int, amount: float, description: str = 'Поповнення рахунку') -> dict:
        validate_positive_amount(amount)
        account = self.get_main_account(user_id)
        new_balance = round(account['balance'] + amount, 2)
        self.accounts.update_balance(account['id'], new_balance)
        self.accounts.add_transaction(account['id'], 'topup', 'in', amount, description)
        self.features.add_audit_log(user_id, 'topup', f'Поповнення на {amount:.2f} грн.')
        return self.get_main_account(user_id)

    def transfer(self, user_id: int, recipient_account_number: str, amount: float, description: str) -> dict:
        validate_positive_amount(amount)
        sender = self.get_main_account(user_id)
        recipient = self.accounts.get_account_by_number(recipient_account_number.strip())
        if not recipient:
            raise ValueError('Рахунок отримувача не знайдено.')
        if recipient['id'] == sender['id']:
            raise ValueError('Неможливо переказати кошти на власний рахунок.')
        if sender['balance'] < amount:
            raise ValueError('Недостатньо коштів на рахунку.')

        sender_balance = round(sender['balance'] - amount, 2)
        recipient_balance = round(recipient['balance'] + amount, 2)
        self.accounts.update_balance(sender['id'], sender_balance)
        self.accounts.update_balance(recipient['id'], recipient_balance)
        self.accounts.add_transaction(sender['id'], 'transfer', 'out', amount, description, recipient['account_number'])
        self.accounts.add_transaction(recipient['id'], 'transfer', 'in', amount, f'Надходження: {description}', sender['account_number'])
        self.features.add_audit_log(user_id, 'transfer', f'Переказ {amount:.2f} грн на {recipient_account_number}.')
        return self.get_main_account(user_id)

    def list_transactions(self, user_id: int, from_date: str | None = None, to_date: str | None = None, tx_type: str | None = None, direction: str | None = None, search: str | None = None) -> list[dict]:
        account = self.get_main_account(user_id)
        return self.accounts.list_transactions(account['id'], from_date=from_date, to_date=to_date, tx_type=tx_type, direction=direction, search=search)

    def get_transaction(self, user_id: int, transaction_id: int) -> dict:
        account = self.get_main_account(user_id)
        tx = self.accounts.get_transaction(transaction_id, account['id'])
        if not tx:
            raise ValueError('Транзакцію не знайдено.')
        return tx

    def get_analytics(self, user_id: int) -> dict:
        account = self.get_main_account(user_id)
        return self.accounts.get_analytics(account['id'])

    def export_csv(self, user_id: int, from_date: str | None = None, to_date: str | None = None) -> str:
        account = self.get_main_account(user_id)
        return self.accounts.export_transactions_csv(account['id'], from_date=from_date, to_date=to_date)

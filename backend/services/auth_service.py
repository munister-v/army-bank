"""Сервіс автентифікації та реєстрації."""
from __future__ import annotations

from datetime import datetime, timezone

from ..repositories.account_repository import AccountRepository
from ..repositories.feature_repository import FeatureRepository
from ..repositories.user_repository import UserRepository
from ..utils.security import generate_token, hash_password, token_expiration_iso, verify_password
from ..utils.validators import require_fields, validate_email, validate_password, validate_phone


class AuthService:
    def __init__(self) -> None:
        self.users = UserRepository()
        self.accounts = AccountRepository()
        self.features = FeatureRepository()

    def register(self, data: dict) -> dict:
        require_fields(data, ['full_name', 'phone', 'email', 'password'])
        validate_phone(data['phone'])
        validate_email(data['email'])
        validate_password(data['password'])

        if self.users.get_by_phone_or_email(data['phone']) or self.users.get_by_phone_or_email(data['email']):
            raise ValueError('Користувач з таким телефоном або email вже існує.')

        user_id = self.users.create_user(
            full_name=data['full_name'].strip(),
            phone=data['phone'].strip(),
            email=data['email'].strip().lower(),
            password_hash=hash_password(data['password']),
        )
        account_number = f"AB-{100000 + user_id}"
        self.accounts.create_account(user_id, account_number)
        self.features.add_audit_log(user_id, 'register', 'Створено обліковий запис та основний рахунок.')
        return self.login({'identity': data['phone'], 'password': data['password']})

    def login(self, data: dict) -> dict:
        require_fields(data, ['identity', 'password'])
        user = self.users.get_by_phone_or_email(data['identity'].strip())
        if not user or not verify_password(data['password'], user['password_hash']):
            raise ValueError('Невірні облікові дані.')

        token = generate_token()
        self.users.create_session(user['id'], token, token_expiration_iso())
        self.features.add_audit_log(user['id'], 'login', 'Успішний вхід у систему.')
        return {
            'token': token,
            'user': {
                'id': user['id'],
                'full_name': user['full_name'],
                'phone': user['phone'],
                'email': user['email'],
                'role': user['role'],
            },
        }

    def get_user_by_token(self, token: str):
        user = self.users.get_user_by_token(token)
        if not user:
            return None
        expires_at = datetime.fromisoformat(user['expires_at'])
        if expires_at < datetime.now(timezone.utc):
            self.users.delete_session(token)
            return None
        return user

    def logout(self, token: str) -> None:
        self.users.delete_session(token)

    def change_password(self, user_id: int, old_password: str, new_password: str) -> None:
        validate_password(new_password)
        user = self.users.get_by_id(user_id)
        if not user:
            raise ValueError('Користувача не знайдено.')
        if not verify_password(old_password, user['password_hash']):
            raise ValueError('Поточний пароль невірний.')
        new_hash = hash_password(new_password)
        self.users.update_password(user_id, new_hash)
        self.features.add_audit_log(user_id, 'change_password', 'Пароль змінено.')

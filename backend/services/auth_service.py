"""Сервіс автентифікації та реєстрації."""
from __future__ import annotations

from datetime import datetime, timezone

from ..repositories.account_repository import AccountRepository
from ..repositories.feature_repository import FeatureRepository
from ..repositories.user_repository import UserRepository
from ..utils.security import (
    generate_token, hash_password, token_expiration_iso, verify_password
)
from ..utils.validators import require_fields, validate_email, validate_password, validate_phone


class AuthService:
    def __init__(self) -> None:
        self.users = UserRepository()
        self.accounts = AccountRepository()
        self.features = FeatureRepository()

    # ── Реєстрація ────────────────────────────────────────────────────────────
    def register(self, data: dict) -> dict:
        require_fields(data, ['full_name', 'phone', 'email', 'password'])
        validate_phone(data['phone'])
        validate_email(data['email'])
        validate_password(data['password'])

        phone = data['phone'].strip()
        email = data['email'].strip().lower()

        if self.users.get_by_phone_or_email(phone) or self.users.get_by_phone_or_email(email):
            raise ValueError('Користувач з таким телефоном або email вже існує.')

        user_id = self.users.create_user(
            full_name=data['full_name'].strip(),
            phone=phone,
            email=email,
            password_hash=hash_password(data['password']),
        )
        account_number = f"AB-{100000 + user_id}"
        self.accounts.create_account(user_id, account_number)
        self.features.add_audit_log(user_id, 'register', 'Створено обліковий запис та основний рахунок.')
        return self.login({'identity': phone, 'password': data['password']})

    # ── Вхід ──────────────────────────────────────────────────────────────────
    def login(self, data: dict) -> dict:
        require_fields(data, ['identity', 'password'])
        identity = data['identity'].strip()
        user = self.users.get_by_phone_or_email(identity)
        if not user or not verify_password(data['password'], user['password_hash']):
            raise ValueError('Невірні облікові дані.')

        # Видаляємо прострочені сесії цього користувача (cleanup)
        self.users.delete_expired_sessions(user['id'])

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

    # ── Перевірка токену ──────────────────────────────────────────────────────
    def get_user_by_token(self, token: str):
        user = self.users.get_user_by_token(token)
        if not user:
            return None
        expires_at_raw = user.get('expires_at', '')
        try:
            expires_at = datetime.fromisoformat(expires_at_raw)
        except (ValueError, TypeError):
            self.users.delete_session(token)
            return None
        if expires_at < datetime.now(timezone.utc):
            self.users.delete_session(token)
            return None
        return user

    # ── Автооновлення сесії ───────────────────────────────────────────────────
    def refresh_session(self, old_token: str, user_id: int) -> str | None:
        """Видаляє стару сесію і видає новий токен з повним TTL.
        Повертає новий токен або None при помилці.
        """
        try:
            new_token = generate_token()
            self.users.create_session(user_id, new_token, token_expiration_iso())
            self.users.delete_session(old_token)
            return new_token
        except Exception:
            return None

    # ── Вихід ─────────────────────────────────────────────────────────────────
    def logout(self, token: str) -> None:
        self.users.delete_session(token)

"""Сервіс управління картками Army Bank."""
from __future__ import annotations

import random
import string
from datetime import date, timedelta

from ..repositories.card_repository import CardRepository
from ..repositories.account_repository import AccountRepository
from ..repositories.feature_repository import FeatureRepository

_MAX_CARDS_PER_ACCOUNT = 8
# Virtual card BIN prefix (Army Bank virtual cards start with 4721)
_BIN_PREFIX = '4721'


def _luhn_checksum(number: str) -> int:
    digits = [int(d) for d in number]
    odd = digits[-1::-2]
    even = digits[-2::-2]
    even_sum = sum(d * 2 - 9 if d * 2 > 9 else d * 2 for d in even)
    return (sum(odd) + even_sum) % 10


def _generate_card_number() -> str:
    """Generate a 16-digit Luhn-valid card number with _BIN_PREFIX."""
    core = ''.join(random.choices(string.digits, k=11))
    partial = _BIN_PREFIX + core
    check = (10 - _luhn_checksum(partial + '0')) % 10
    raw = partial + str(check)
    return f'{raw[:4]} {raw[4:8]} {raw[8:12]} {raw[12:16]}'


def _generate_cvv() -> str:
    return ''.join(random.choices(string.digits, k=3))


def _card_expires_at() -> str:
    """3 years from today, first day of that month."""
    future = date.today().replace(day=1) + timedelta(days=3 * 365)
    return future.strftime('%Y-%m-%d')


class CardService:
    def __init__(self) -> None:
        self.cards = CardRepository()
        self.accounts = AccountRepository()
        self.features = FeatureRepository()

    def _get_account(self, user_id: int) -> dict:
        account = self.accounts.get_account_by_user_id(user_id)
        if not account:
            raise ValueError('Рахунок користувача не знайдено.')
        return account

    def list_cards(self, user_id: int) -> list[dict]:
        account = self._get_account(user_id)
        cards = self.cards.list_cards(account['id'])
        for c in cards:
            c['masked_number'] = self._mask(c['card_number'])
            c['expiry_display'] = self._expiry_display(c['expires_at'])
            c.pop('cvv', None)          # never expose CVV in list
            c.pop('card_number', None)  # never expose full number in list
        return cards

    def reveal_card(self, user_id: int, card_id: int) -> dict:
        """Return full card number + CVV for the card owner (used for flip reveal)."""
        account = self._get_account(user_id)
        card = self.cards.get_card(card_id, account['id'])
        if not card:
            raise ValueError('Картку не знайдено.')
        if card['status'] == 'closed':
            raise ValueError('Закрита картка.')
        return {
            'id': card['id'],
            'card_number': card['card_number'],
            'cvv': card.get('cvv') or '000',
            'expiry_display': self._expiry_display(card['expires_at']),
        }

    _VALID_DESIGNS = {'gold', 'navy', 'forest', 'rose', 'slate', 'camo', 'dark'}

    def issue_card(self, user_id: int, card_type: str = 'virtual', design: str = 'gold') -> dict:
        if card_type not in ('virtual', 'physical'):
            raise ValueError('Невідомий тип картки.')
        if design not in self._VALID_DESIGNS:
            design = 'gold'
        account = self._get_account(user_id)

        active_count = self.cards.count_active(account['id'])
        if active_count >= _MAX_CARDS_PER_ACCOUNT:
            raise ValueError(f'Максимальна кількість карток ({_MAX_CARDS_PER_ACCOUNT}) вже досягнута.')

        # generate unique card number
        for _ in range(20):
            number = _generate_card_number()
            if not self.cards.get_card_by_number(number):
                break
        else:
            raise RuntimeError('Не вдалося згенерувати унікальний номер картки.')

        holder = self._format_holder(account.get('holder_name') or '')
        expires_at = _card_expires_at()
        cvv = _generate_cvv()
        card_id = self.cards.issue_card(account['id'], number, holder, expires_at, card_type, design, cvv)

        self.features.add_audit_log(
            user_id, 'card_issued',
            f'Випущено картку {self._mask(number)} тип={card_type}.',
        )
        try:
            self.features.create_notification(
                user_id, 'card_issued',
                'Картку випущено',
                f'Ваша нова {card_type} картка {self._mask(number)} готова.',
                '💳',
            )
        except Exception:
            pass

        card = self.cards.get_card(card_id, account['id'])
        card['masked_number'] = self._mask(card['card_number'])
        card['expiry_display'] = self._expiry_display(card['expires_at'])
        card.pop('cvv', None)
        card.pop('card_number', None)
        return card

    def block_card(self, user_id: int, card_id: int) -> dict:
        account = self._get_account(user_id)
        card = self.cards.get_card(card_id, account['id'])
        if not card:
            raise ValueError('Картку не знайдено.')
        if card['status'] == 'closed':
            raise ValueError('Закрита картка не може бути заблокована.')
        if card['status'] == 'blocked':
            # Unblock
            self.cards.set_status(card_id, account['id'], 'active')
            action = 'card_unblocked'
            msg = f'Картку {self._mask(card["card_number"])} розблоковано.'
            notif_title = 'Картку розблоковано'
        else:
            self.cards.set_status(card_id, account['id'], 'blocked')
            action = 'card_blocked'
            msg = f'Картку {self._mask(card["card_number"])} заблоковано.'
            notif_title = 'Картку заблоковано'

        self.features.add_audit_log(user_id, action, msg)
        try:
            self.features.create_notification(user_id, action, notif_title, msg, '🔒')
        except Exception:
            pass

        updated = self.cards.get_card(card_id, account['id'])
        updated['masked_number'] = self._mask(updated['card_number'])
        updated['expiry_display'] = self._expiry_display(updated['expires_at'])
        return updated

    def close_card(self, user_id: int, card_id: int) -> dict:
        account = self._get_account(user_id)
        card = self.cards.get_card(card_id, account['id'])
        if not card:
            raise ValueError('Картку не знайдено.')
        if card['status'] == 'closed':
            raise ValueError('Картку вже закрито.')

        self.cards.set_status(card_id, account['id'], 'closed')
        self.features.add_audit_log(
            user_id, 'card_closed',
            f'Картку {self._mask(card["card_number"])} закрито.',
        )
        try:
            self.features.create_notification(
                user_id, 'card_closed',
                'Картку закрито',
                f'Картку {self._mask(card["card_number"])} успішно закрито.',
                '❌',
            )
        except Exception:
            pass

        updated = self.cards.get_card(card_id, account['id'])
        updated['masked_number'] = self._mask(updated['card_number'])
        updated['expiry_display'] = self._expiry_display(updated['expires_at'])
        return updated

    def update_design(self, user_id: int, card_id: int, design: str) -> dict:
        account = self._get_account(user_id)
        card = self.cards.get_card(card_id, account['id'])
        if not card:
            raise ValueError('Картку не знайдено.')
        if card['status'] == 'closed':
            raise ValueError('Закрита картка не може змінювати дизайн.')

        normalized = (design or '').strip().lower()
        if normalized not in self._VALID_DESIGNS:
            raise ValueError('Непідтримуваний дизайн картки.')

        self.cards.set_design(card_id, account['id'], normalized)
        self.features.add_audit_log(
            user_id,
            'card_design_updated',
            f'Оновлено дизайн картки {self._mask(card["card_number"])} на {normalized}.',
        )

        updated = self.cards.get_card(card_id, account['id'])
        updated['masked_number'] = self._mask(updated['card_number'])
        updated['expiry_display'] = self._expiry_display(updated['expires_at'])
        updated.pop('cvv', None)
        updated.pop('card_number', None)
        return updated

    def get_account_by_card(self, card_number: str) -> dict:
        """Resolve account from card number for transfers."""
        stripped = card_number.replace(' ', '')
        if len(stripped) == 16:
            formatted = f'{stripped[:4]} {stripped[4:8]} {stripped[8:12]} {stripped[12:16]}'
            card = self.cards.get_card_by_number(formatted) or self.cards.get_card_by_number(card_number)
        else:
            card = self.cards.get_card_by_number(card_number)
        if not card:
            raise ValueError('Картку з таким номером не знайдено.')
        if card['status'] == 'closed':
            raise ValueError('Картку закрито — переказ неможливий.')
        if card['status'] == 'blocked':
            raise ValueError('Картку заблоковано — переказ неможливий.')
        return card

    # ── helpers ──────────────────────────────────────────────────────────────

    @staticmethod
    def _mask(number: str) -> str:
        """•••• •••• •••• 1234"""
        clean = number.replace(' ', '')
        return f'•••• •••• •••• {clean[-4:]}' if len(clean) >= 4 else number

    @staticmethod
    def _expiry_display(expires_at: str) -> str:
        """2028-01-01 → 01/28"""
        try:
            parts = str(expires_at).split('-')
            return f'{parts[1]}/{parts[0][2:]}'
        except Exception:
            return ''

    @staticmethod
    def _format_holder(name: str) -> str:
        return name.upper()[:26] if name else 'ARMY BANK'

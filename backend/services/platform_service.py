"""Сервіс платформенного адміна: генерація демо-даних, агрегати."""
from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone

from ..repositories.account_repository import AccountRepository
from ..repositories.feature_repository import FeatureRepository
from ..repositories.platform_repository import PlatformRepository
from ..repositories.user_repository import UserRepository
from ..utils.security import hash_password

user_repo = UserRepository()
account_repo = AccountRepository()
feature_repo = FeatureRepository()
platform_repo = PlatformRepository()

FIRST_NAMES = (
    'Олександр', 'Дмитро', 'Андрій', 'Михайло', 'Сергій', 'Іван', 'Олег', 'Віктор',
    'Марія', 'Олена', 'Анна', 'Наталія', 'Ірина', 'Тетяна', 'Юлія', 'Катерина',
)
LAST_NAMES = (
    'Коваленко', 'Бондаренко', 'Ткаченко', 'Кравченко', 'Шевченко', 'Мельник',
    'Бойко', 'Коваль', 'Шевчук', 'Петренко', 'Савченко', 'Іваненко', 'Гончаренко',
)
FUND_NAMES = ('Фонд підтримки підрозділу', 'Волонтерський фонд', 'Допомога родинам', 'Спорядження')
PAYOUT_TITLES = ('Бойова виплата', 'Службова виплата', 'Компенсація', 'Доплата')


def _random_phone() -> str:
    return f'+380{random.randint(50, 99)}{random.randint(1000000, 9999999)}'


def _random_email(name: str, i: int) -> str:
    base = name.lower().replace(' ', '').replace("'", '')[:12]
    return f'{base}{i}@demo.army-bank.ua'


def seed_demo(users_count: int = 10, transactions_per_user: int = 15) -> dict:
    """
    Генерує реалістичні демо-дані: користувачі, рахунки, транзакції, донати, виплати, накопичення.
    """
    created_users = []
    created_accounts = []
    base_id = 100000

    for i in range(users_count):
        first = random.choice(FIRST_NAMES)
        last = random.choice(LAST_NAMES)
        full_name = f'{first} {last}'
        phone = _random_phone()
        email = _random_email(full_name, i + 1)
        if user_repo.get_by_phone_or_email(phone) or user_repo.get_by_phone_or_email(email):
            continue
        user_id = user_repo.create_user(
            full_name=full_name,
            phone=phone,
            email=email,
            password_hash=hash_password('demo123'),
            role='soldier',
        )
        acc_num = f'AB-{base_id + user_id}'
        account_repo.create_account(user_id, acc_num)
        feature_repo.add_audit_log(user_id, 'register', 'Демо-користувач створено seed.')
        account = account_repo.get_account_by_user_id(user_id)
        created_users.append({'id': user_id, 'full_name': full_name, 'account_number': acc_num})
        created_accounts.append(account)

    if not created_accounts:
        return {'ok': True, 'created': 0, 'message': 'Немає нових користувачів для створення.'}

    now = datetime.now(timezone.utc)
    tx_types = ['topup', 'transfer', 'payout', 'donation', 'savings']
    total_txs = 0

    for acc in created_accounts:
        acc_fresh = account_repo.get_account_by_user_id(acc['user_id'])
        balance = float(acc_fresh.get('balance', 0) or 0)
        for _ in range(transactions_per_user):
            tx_type = random.choice(tx_types)
            amount = round(random.uniform(100, 15000), 2)
            created = now - timedelta(days=random.randint(0, 90), hours=random.randint(0, 23))

            if tx_type == 'topup':
                balance += amount
                account_repo.add_transaction(
                    acc['id'], 'topup', 'in', amount,
                    f'Поповнення рахунку (демо)',
                )
                total_txs += 1
            elif tx_type == 'payout':
                balance += amount
                account_repo.add_transaction(
                    acc['id'], 'payout', 'in', amount,
                    random.choice(PAYOUT_TITLES),
                )
                feature_repo.create_payout(
                    acc['user_id'], random.choice(PAYOUT_TITLES), amount, 'combat'
                )
                total_txs += 1
            elif tx_type == 'transfer' and len(created_accounts) > 1:
                other = random.choice([a for a in created_accounts if a['id'] != acc['id']])
                if balance >= amount:
                    balance -= amount
                    account_repo.add_transaction(
                        acc['id'], 'transfer', 'out', amount,
                        f'Переказ на {other["account_number"]}', other['account_number']
                    )
                    other_balance = account_repo.get_account_by_user_id(other['user_id'])['balance']
                    account_repo.update_balance(other['id'], round(other_balance + amount, 2))
                    account_repo.add_transaction(
                        other['id'], 'transfer', 'in', amount,
                        f'Надходження від {acc["account_number"]}', acc['account_number']
                    )
                    total_txs += 2
            elif tx_type == 'donation' and balance >= amount:
                balance -= amount
                account_repo.add_transaction(
                    acc['id'], 'donation', 'out', amount,
                    f'Донат: {random.choice(FUND_NAMES)}',
                )
                feature_repo.create_donation(
                    acc['user_id'], random.choice(FUND_NAMES), amount, 'Демо-донат'
                )
                total_txs += 1
            elif tx_type == 'savings' and balance >= amount:
                balance -= amount
                goal_id = feature_repo.create_savings_goal(
                    acc['user_id'], 'Спорядження (демо)', amount * 2, None
                )
                goal = feature_repo.get_savings_goal(goal_id, acc['user_id'])
                feature_repo.update_goal_amount(goal_id, amount)
                account_repo.add_transaction(
                    acc['id'], 'savings', 'out', amount,
                    f'Внесок у накопичення: {goal["title"]}',
                )
                total_txs += 1

        account_repo.update_balance(acc['id'], round(balance, 2))

    feature_repo.add_audit_log(
        None, 'platform_seed',
        f'Згенеровано {len(created_users)} користувачів, ~{total_txs} транзакцій.',
    )

    return {
        'ok': True,
        'created': len(created_users),
        'transactions': total_txs,
        'users': created_users,
    }

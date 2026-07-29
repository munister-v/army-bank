"""Shared CRM exclusions for markets and enterprise hospitality chains."""
from __future__ import annotations

import re
import unicodedata


_BLOCKED_COUNTRY_CODES = {'RU', 'RUS', 'RF'}
_BLOCKED_COUNTRIES = {
    'russia', 'russian federation', 'rossiya', 'rossiyskaya federatsiya',
    'rossijskaya federacija', 'rossiia', 'ru', 'rus', 'rf',
}

# Україна виключена з таргетингу як ринок (продаємо за кордон) — окремо від
# russia-блоку, бо це рішення по фокусу продажів, а не політика.
_EXCLUDED_MARKET_CODES = {'UA', 'UKR'}
_EXCLUDED_MARKETS_RAW = (
    'ukraine', 'ukraina', 'ukrayina', 'україна', 'украина', 'ukr',
)
_BLOCKED_BRANDS = (
    "mcdonald's", 'mcdonalds', 'kfc', 'burger king', 'starbucks', 'subway',
    'tim hortons', 'dunkin', 'five guys', 'shake shack', 'olive garden',
    'taco bell', "domino's", 'dominos', 'pizza hut', "wendy's", 'wendys',
    'popeyes', 'chick-fil-a', 'chipotle', 'raising canes', "raising cane's",
)


def _fold(value: object) -> str:
    text = unicodedata.normalize('NFKD', str(value or '')).casefold()
    text = text.replace('\u2019', "'").replace('\u2018', "'")
    return re.sub(r'[^a-z0-9\u0400-\u04ff]+', ' ', text).strip()


_EXCLUDED_MARKETS = frozenset(_fold(name) for name in _EXCLUDED_MARKETS_RAW)


def exclusion_reason(item: dict) -> str:
    """Return a stable policy reason or an empty string when the lead is allowed."""
    code = str(item.get('country_code') or '').strip().upper()
    country = _fold(item.get('country'))
    if code in _BLOCKED_COUNTRY_CODES or country in _BLOCKED_COUNTRIES:
        return 'blocked_market_russia'
    if re.search(r'(^|\s)(россия|российская федерация|рф)(\s|$)', country):
        return 'blocked_market_russia'

    if code in _EXCLUDED_MARKET_CODES or country in _EXCLUDED_MARKETS:
        return 'blocked_market_ukraine'

    name = f" {_fold(item.get('business_name'))} "
    for brand in _BLOCKED_BRANDS:
        if f" {_fold(brand)} " in name:
            return 'blocked_enterprise_chain'
    return ''


def is_allowed_lead(item: dict) -> bool:
    return not exclusion_reason(item)

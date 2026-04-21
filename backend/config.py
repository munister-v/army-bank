"""Конфігурація застосунку WeeGo Army Bank (з .env)."""
from pathlib import Path
import json
import os

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
_default_db_path = BASE_DIR / 'database' / 'army_bank.db'
DATABASE_PATH = Path(os.getenv('ARMY_BANK_DATABASE_PATH', _default_db_path))
SCHEMA_PATH = BASE_DIR / 'database' / 'schema.sql'
SCHEMA_PG_PATH = BASE_DIR / 'database' / 'schema_pg.sql'

DATABASE_URL = os.getenv('DATABASE_URL', '').strip()
USE_PG = bool(DATABASE_URL)

SECRET_KEY = os.getenv('SECRET_KEY') or os.getenv('ARMY_BANK_SECRET') or 'army-bank-demo-secret-key'
TOKEN_TTL_HOURS = int(os.getenv('TOKEN_TTL_HOURS') or os.getenv('ARMY_BANK_TOKEN_TTL_HOURS') or '720')  # 30 днів за замовчуванням
DEBUG = (os.getenv('DEBUG') or os.getenv('ARMY_BANK_DEBUG') or '0') == '1'

# Базовий шлях при розміщенні на сайті (наприклад /bank для munister.com.ua/bank)
BASE_PATH = (os.getenv('BASE_PATH') or os.getenv('ARMY_BANK_BASE_PATH') or '').rstrip('/')

# Seed-адмін: якщо задано — автоматично створюється platform_admin при старті
ADMIN_EMAIL    = os.getenv('ADMIN_EMAIL', '').strip()
ADMIN_PHONE    = os.getenv('ADMIN_PHONE', '+380000000000').strip()
ADMIN_NAME     = os.getenv('ADMIN_NAME', 'System Admin').strip()
ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD', '').strip()

# One-time bootstrap hardening: якщо задано, /api/bootstrap вимагає X-Bootstrap-Token
BOOTSTRAP_TOKEN = os.getenv('BOOTSTRAP_TOKEN', '').strip()

# Messenger at-rest encryption keys (Fernet, base64 urlsafe, 32-byte).
# Multiple keys allowed for rotation: "new_key,old_key".
MESSENGER_ENCRYPTION_KEYS = os.getenv('MESSENGER_ENCRYPTION_KEYS', '').strip()
MESSENGER_CALL_PENDING_TIMEOUT_SECONDS = int(os.getenv('MESSENGER_CALL_PENDING_TIMEOUT_SECONDS', '45'))
MESSENGER_CALL_ACTIVE_STALE_SECONDS = int(os.getenv('MESSENGER_CALL_ACTIVE_STALE_SECONDS', '21600'))
MESSENGER_CALL_FORCE_RELAY = (os.getenv('MESSENGER_CALL_FORCE_RELAY', '1') == '1')
_default_ice_servers = [
    {'urls': 'stun:stun.l.google.com:19302'},
    {'urls': 'stun:stun1.l.google.com:19302'},
]
_ice_json = os.getenv('MESSENGER_ICE_SERVERS', '').strip()
_turn_urls_raw = os.getenv('MESSENGER_TURN_URLS', '').strip()
_turn_username = os.getenv('MESSENGER_TURN_USERNAME', '').strip()
_turn_credential = os.getenv('MESSENGER_TURN_CREDENTIAL', '').strip()
if _ice_json:
    try:
        _parsed_ice = json.loads(_ice_json)
        if isinstance(_parsed_ice, list):
            MESSENGER_ICE_SERVERS = _parsed_ice
        else:
            MESSENGER_ICE_SERVERS = _default_ice_servers
    except Exception:
        MESSENGER_ICE_SERVERS = _default_ice_servers
else:
    _turn_urls = [u.strip() for u in _turn_urls_raw.split(',') if u.strip()]
    if _turn_urls and _turn_username and _turn_credential:
        MESSENGER_ICE_SERVERS = [
            *_default_ice_servers,
            {
                'urls': _turn_urls,
                'username': _turn_username,
                'credential': _turn_credential,
            },
        ]
    else:
        MESSENGER_ICE_SERVERS = _default_ice_servers

# Примітивний anti-bruteforce rate-limit для auth endpoints
AUTH_RATE_LIMIT_ENABLED = (os.getenv('AUTH_RATE_LIMIT_ENABLED', '1') == '1')
AUTH_RATE_WINDOW_SECONDS = int(os.getenv('AUTH_RATE_WINDOW_SECONDS', '60'))
AUTH_LOGIN_RATE_LIMIT = int(os.getenv('AUTH_LOGIN_RATE_LIMIT', '12'))
AUTH_REGISTER_RATE_LIMIT = int(os.getenv('AUTH_REGISTER_RATE_LIMIT', '8'))
ENABLE_RATE_LIMIT_IN_TESTS = (os.getenv('ENABLE_RATE_LIMIT_IN_TESTS', '0') == '1')

# Rate-limit для критичних фінансових/процесингових mutation endpoint'ів
CRITICAL_RATE_LIMIT_WINDOW_SECONDS = int(os.getenv('CRITICAL_RATE_LIMIT_WINDOW_SECONDS', '60'))
CRITICAL_MONEY_RATE_LIMIT = int(os.getenv('CRITICAL_MONEY_RATE_LIMIT', '30'))
CRITICAL_ADMIN_MUTATION_RATE_LIMIT = int(os.getenv('CRITICAL_ADMIN_MUTATION_RATE_LIMIT', '40'))
CRITICAL_PROCESSING_RATE_LIMIT = int(os.getenv('CRITICAL_PROCESSING_RATE_LIMIT', '80'))

# Обов'язковий заголовок Idempotency-Key для monetary endpoint'ів
ENFORCE_IDEMPOTENCY_HEADERS = (os.getenv('ENFORCE_IDEMPOTENCY_HEADERS', '1') == '1')
ENFORCE_IDEMPOTENCY_IN_TESTS = (os.getenv('ENFORCE_IDEMPOTENCY_IN_TESTS', '0') == '1')

# Demo endpoints should be explicitly enabled per environment.
ALLOW_PLATFORM_DEMO_SEED = (os.getenv('ALLOW_PLATFORM_DEMO_SEED', '0') == '1')
ALLOW_DEMO_PAYOUT_ACCRUAL = (os.getenv('ALLOW_DEMO_PAYOUT_ACCRUAL', '0') == '1')

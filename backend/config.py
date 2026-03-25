"""Конфігурація застосунку WeeGo Army Bank (з .env)."""
from pathlib import Path
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

# Примітивний anti-bruteforce rate-limit для auth endpoints
AUTH_RATE_LIMIT_ENABLED = (os.getenv('AUTH_RATE_LIMIT_ENABLED', '1') == '1')
AUTH_RATE_WINDOW_SECONDS = int(os.getenv('AUTH_RATE_WINDOW_SECONDS', '60'))
AUTH_LOGIN_RATE_LIMIT = int(os.getenv('AUTH_LOGIN_RATE_LIMIT', '12'))
AUTH_REGISTER_RATE_LIMIT = int(os.getenv('AUTH_REGISTER_RATE_LIMIT', '8'))

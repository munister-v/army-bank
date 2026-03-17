"""Конфігурація застосунку WeeGo Army Bank."""
from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent
DATABASE_PATH = BASE_DIR / 'database' / 'army_bank.db'
SCHEMA_PATH = BASE_DIR / 'database' / 'schema.sql'
SECRET_KEY = os.getenv('ARMY_BANK_SECRET', 'army-bank-demo-secret-key')
TOKEN_TTL_HOURS = int(os.getenv('ARMY_BANK_TOKEN_TTL_HOURS', '24'))
DEBUG = os.getenv('ARMY_BANK_DEBUG', '1') == '1'

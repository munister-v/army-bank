"""Pytest конфігурація та фікстури для Army Bank."""
from __future__ import annotations

import os
import sys
import tempfile

import pytest

# Додати корінь проєкту до PYTHONPATH для імпортів backend
_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _root not in sys.path:
    sys.path.insert(0, _root)

# Ізольована тестова БД та SQLite
_test_db_dir = tempfile.mkdtemp()
os.environ['ARMY_BANK_DATABASE_PATH'] = os.path.join(_test_db_dir, 'test.db')
os.environ['DATABASE_URL'] = ''
os.environ['SECRET_KEY'] = 'test-secret-key'


@pytest.fixture
def app():
    from backend.app import create_app
    app = create_app()
    app.config['TESTING'] = True
    return app


@pytest.fixture
def client(app):
    return app.test_client()

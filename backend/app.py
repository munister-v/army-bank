"""Головний Flask-застосунок WeeGo Army Bank."""
from __future__ import annotations

import re
from pathlib import Path
from flask import Flask, Response, send_from_directory

from .config import BASE_PATH, DEBUG
from .database import init_db
from .routes.account_routes import account_bp
from .routes.admin_routes import admin_bp
from .routes.auth_routes import auth_bp
from .routes.feature_routes import feature_bp
from .routes.operator_routes import operator_bp


FRONTEND_DIR = Path(__file__).resolve().parent.parent / 'frontend'


def create_app() -> Flask:
    """Створює та налаштовує Flask-застосунок."""
    init_db()
    app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path=BASE_PATH or '')
    prefix = BASE_PATH or ''

    app.register_blueprint(auth_bp, url_prefix=prefix + '/api/auth')
    app.register_blueprint(account_bp, url_prefix=prefix + '/api')
    app.register_blueprint(feature_bp, url_prefix=prefix + '/api')
    app.register_blueprint(admin_bp, url_prefix=prefix + '/api/admin')
    app.register_blueprint(operator_bp, url_prefix=prefix + '/api/operator')

    def send_html(name: str):
        path = FRONTEND_DIR / name
        if not prefix:
            return send_from_directory(FRONTEND_DIR, name)
        content = path.read_text(encoding='utf-8')
        # Підставляємо базовий шлях лише для відносних посилань (не // та не https:)
        content = re.sub(r'(href|src)="/(?!/)', rf'\1="{prefix}/', content)
        content = content.replace('</head>', f'<script>window.ARMY_BANK_BASE="{prefix}";</script>\n</head>')
        return Response(content, mimetype='text/html')

    def send_index():
        return send_html('index.html')

    @app.get(prefix + '/' if prefix else '/')
    def index():
        return send_index()

    for path in ('/dashboard', '/transactions', '/payouts', '/donations', '/savings', '/contacts'):
        @app.get(prefix + path, endpoint=f'app_page_{path.strip("/")}')
        def _page():
            return send_index()

    @app.get(prefix + '/admin')
    def admin_page():
        return send_html('admin.html')

    @app.get(prefix + '/operator')
    def operator_page():
        return send_html('operator.html')

    @app.get(prefix + '/health')
    def health():
        return {'ok': True, 'service': 'WeeGo Army Bank'}

    return app


app = create_app()

if __name__ == '__main__':
    app.run(debug=DEBUG)

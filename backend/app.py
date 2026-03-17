"""Головний Flask-застосунок WeeGo Army Bank."""
from __future__ import annotations

from pathlib import Path
from flask import Flask, send_from_directory

from .config import DEBUG
from .database import init_db
from .routes.account_routes import account_bp
from .routes.auth_routes import auth_bp
from .routes.feature_routes import feature_bp


FRONTEND_DIR = Path(__file__).resolve().parent.parent / 'frontend'


def create_app() -> Flask:
    """Створює та налаштовує Flask-застосунок."""
    init_db()
    app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path='')
    app.register_blueprint(auth_bp)
    app.register_blueprint(account_bp)
    app.register_blueprint(feature_bp)

    @app.get('/')
    def index():
        return send_from_directory(FRONTEND_DIR, 'index.html')

    @app.get('/health')
    def health():
        return {'ok': True, 'service': 'WeeGo Army Bank'}

    return app


app = create_app()

if __name__ == '__main__':
    app.run(debug=DEBUG)

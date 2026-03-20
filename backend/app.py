"""Головний Flask-застосунок WeeGo Army Bank."""
from __future__ import annotations

import re
from pathlib import Path
from flask import Flask, Response, jsonify, send_from_directory

from .config import BASE_PATH, DEBUG
from .database import init_db, init_admin
from .routes.account_routes import account_bp
from .routes.admin_routes import admin_bp
from .routes.auth_routes import auth_bp
from .routes.feature_routes import feature_bp
from .routes.operator_routes import operator_bp
from .routes.platform_routes import platform_bp
from .routes.push_routes import push_bp


FRONTEND_DIR = Path(__file__).resolve().parent.parent / 'frontend'


def create_app() -> Flask:
    """Створює та налаштовує Flask-застосунок."""
    init_db()
    init_admin()
    app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path=BASE_PATH or '')
    prefix = BASE_PATH or ''

    _ALLOWED_ORIGINS = {
        'https://munister.com.ua',
        'https://www.munister.com.ua',
        'http://localhost:9099',
        'http://localhost:5173',
        'http://127.0.0.1:5500',
    }

    @app.after_request
    def add_headers(resp):
        resp.headers['X-Content-Type-Options'] = 'nosniff'
        from flask import request as _req
        origin = _req.headers.get('Origin', '')
        if origin in _ALLOWED_ORIGINS:
            resp.headers['Access-Control-Allow-Origin'] = origin
            resp.headers['Access-Control-Allow-Credentials'] = 'true'
            resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, PUT, DELETE, OPTIONS'
            resp.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
            resp.headers['Access-Control-Expose-Headers'] = 'X-Refresh-Token'
        return resp

    @app.route('/api/<path:p>', methods=['OPTIONS'])
    @app.route(prefix + '/api/<path:p>', methods=['OPTIONS'])
    def cors_preflight(p=''):
        from flask import request as _req
        origin = _req.headers.get('Origin', '')
        r = app.make_default_options_response()
        if origin in _ALLOWED_ORIGINS:
            r.headers['Access-Control-Allow-Origin'] = origin
            r.headers['Access-Control-Allow-Credentials'] = 'true'
            r.headers['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, PUT, DELETE, OPTIONS'
            r.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
            r.headers['Access-Control-Max-Age'] = '86400'
        return r

    @app.errorhandler(400)
    def bad_request(e):
        return jsonify({'ok': False, 'error': getattr(e, 'description', None) or 'Невірний запит.'}), 400

    @app.errorhandler(404)
    def not_found(_e):
        return jsonify({'ok': False, 'error': 'Не знайдено.'}), 404

    @app.errorhandler(500)
    def server_error(_e):
        return jsonify({'ok': False, 'error': 'Внутрішня помилка сервера.'}), 500

    app.register_blueprint(auth_bp, url_prefix=prefix + '/api/auth')
    app.register_blueprint(account_bp, url_prefix=prefix + '/api')
    app.register_blueprint(feature_bp, url_prefix=prefix + '/api')
    app.register_blueprint(admin_bp, url_prefix=prefix + '/api/admin')
    app.register_blueprint(operator_bp, url_prefix=prefix + '/api/operator')
    app.register_blueprint(platform_bp, url_prefix=prefix + '/api/platform')
    app.register_blueprint(push_bp,     url_prefix=prefix + '/api/push')

    # ── Bootstrap: одноразове підняття першого користувача до platform_admin ──
    @app.route('/api/bootstrap', methods=['POST'])
    def bootstrap():
        """One-time setup: promotes first registered user to platform_admin.
        Only works when no platform_admin exists yet.
        Requires valid Bearer token of user id=1.
        """
        from flask import request as _req
        from .database import get_connection
        from .services.auth_service import AuthService as _AS

        header = _req.headers.get('Authorization', '')
        if not header.startswith('Bearer '):
            return jsonify({'ok': False, 'error': 'Потрібна авторизація.'}), 401
        token = header.replace('Bearer ', '', 1).strip()

        svc = _AS()
        user = svc.get_user_by_token(token)
        if not user:
            return jsonify({'ok': False, 'error': 'Недійсний токен.'}), 401

        try:
            with get_connection() as conn:
                admin_cnt = conn.execute(
                    "SELECT COUNT(*) as n FROM users WHERE role IN ('admin','platform_admin')"
                ).fetchone()['n']
                if admin_cnt > 0:
                    return jsonify({'ok': False, 'error': 'platform_admin вже існує.'}), 409
                # Promote this user
                conn.execute(
                    "UPDATE users SET role = 'platform_admin' WHERE id = %s",
                    (user['id'],)
                )
            return jsonify({'ok': True, 'message': f'Користувача id={user["id"]} підвищено до platform_admin.'})
        except Exception as exc:
            return jsonify({'ok': False, 'error': str(exc)}), 500

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
        return send_html('landing.html')

    @app.get(prefix + '/app' if prefix else '/app')
    def app_root():
        return send_index()

    for path in ('/dashboard', '/transactions', '/payouts', '/donations', '/savings',
                 '/contacts', '/analytics', '/profile', '/calendar', '/recurring', '/debts'):
        @app.get(prefix + path, endpoint=f'app_page_{path.strip("/")}')
        def _page():
            return send_index()

    @app.get(prefix + '/admin')
    def admin_page():
        return send_html('admin.html')

    @app.get(prefix + '/operator')
    def operator_page():
        return send_html('operator.html')

    @app.get(prefix + '/platform')
    def platform_page():
        return send_html('platform.html')

    @app.get(prefix + '/health')
    def health():
        return {'ok': True, 'service': 'WeeGo Army Bank'}

    return app


app = create_app()

if __name__ == '__main__':
    app.run(debug=DEBUG)

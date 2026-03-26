"""Головний Flask-застосунок Army Bank — v7."""
from __future__ import annotations

import hmac
import os
import re
import threading
import time
import uuid
from pathlib import Path
from flask import Flask, Response, abort, jsonify, redirect, send_from_directory, g
from flask_compress import Compress

from .api_docs import (
    build_api_catalog,
    build_api_version,
    build_docs_html,
    build_openapi_schema,
    build_postman_collection,
    build_postman_environment,
)
from .config import (
    BASE_PATH,
    BOOTSTRAP_TOKEN,
    DEBUG,
    ENABLE_RATE_LIMIT_IN_TESTS,
    ENFORCE_IDEMPOTENCY_HEADERS,
    ENFORCE_IDEMPOTENCY_IN_TESTS,
)
from .database import init_db, init_admin
from .routes.account_routes import account_bp
from .routes.admin_routes import admin_bp
from .routes.auth_routes import auth_bp
from .routes.card_routes import card_bp
from .routes.feature_routes import feature_bp
from .routes.operator_routes import operator_bp
from .routes.platform_routes import platform_bp
from .routes.push_routes import push_bp
from .routes.payment_audit_routes import payment_audit_bp


FRONTEND_DIR = Path(__file__).resolve().parent.parent / 'frontend'
MARKETING_DIR = Path(__file__).resolve().parent.parent / 'marketing'
ARMY_ADMIN_MARKETING = MARKETING_DIR / 'munister-army-admin'
ARMY_BANK_MARKETING = MARKETING_DIR / 'munister-army-bank'


def create_app() -> Flask:
    """Створює та налаштовує Flask-застосунок."""
    db_boot_ok = True
    try:
        init_db()
        init_admin()
    except Exception as exc:
        db_boot_ok = False
        print(f'[Army Bank] DB bootstrap warning: {exc}')
    app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path=BASE_PATH or '')
    app.config['DB_BOOT_OK'] = db_boot_ok
    app.config.setdefault('ENABLE_RATE_LIMIT_IN_TESTS', ENABLE_RATE_LIMIT_IN_TESTS)
    app.config.setdefault('ENFORCE_IDEMPOTENCY_HEADERS', ENFORCE_IDEMPOTENCY_HEADERS)
    app.config.setdefault('ENFORCE_IDEMPOTENCY_IN_TESTS', ENFORCE_IDEMPOTENCY_IN_TESTS)

    # ── Gzip compression for all text responses (JSON, HTML, CSS, JS) ──
    app.config['COMPRESS_REGISTER'] = False   # manual init below
    app.config['COMPRESS_MIMETYPES'] = [
        'application/json', 'text/html', 'text/css',
        'application/javascript', 'text/javascript', 'image/svg+xml',
    ]
    app.config['COMPRESS_MIN_SIZE'] = 500     # don't compress tiny responses
    app.config['COMPRESS_LEVEL'] = 6          # balanced speed/ratio
    Compress(app)
    prefix = BASE_PATH or ''

    _ALLOWED_ORIGINS = {
        'https://munister.com.ua',
        'https://www.munister.com.ua',
        'http://localhost:9099',
        'http://localhost:5173',
        'http://127.0.0.1:5500',
    }

    def _append_vary(resp, value: str):
        existing = (resp.headers.get('Vary') or '').strip()
        if not existing:
            resp.headers['Vary'] = value
            return
        parts = [p.strip() for p in existing.split(',') if p.strip()]
        if value not in parts:
            parts.append(value)
            resp.headers['Vary'] = ', '.join(parts)

    def _append_expose_header(resp, *header_names: str):
        existing = (resp.headers.get('Access-Control-Expose-Headers') or '').strip()
        parts = [p.strip() for p in existing.split(',') if p.strip()]
        for name in header_names:
            if name and name not in parts:
                parts.append(name)
        if parts:
            resp.headers['Access-Control-Expose-Headers'] = ', '.join(parts)

    @app.before_request
    def set_request_id():
        from flask import request as _req

        incoming = (_req.headers.get('X-Request-Id') or '').strip()
        if incoming:
            incoming = re.sub(r'[^a-zA-Z0-9._:-]', '', incoming)[:120]
        g.request_id = incoming or uuid.uuid4().hex

    @app.after_request
    def add_headers(resp):
        resp.headers['X-Content-Type-Options'] = 'nosniff'
        resp.headers.setdefault('X-Frame-Options', 'DENY')
        resp.headers.setdefault('Referrer-Policy', 'strict-origin-when-cross-origin')
        resp.headers.setdefault('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
        resp.headers.setdefault('Cross-Origin-Opener-Policy', 'same-origin')
        resp.headers.setdefault('Cross-Origin-Resource-Policy', 'same-origin')
        req_id = str(getattr(g, 'request_id', '') or '').strip()
        if req_id:
            resp.headers['X-Request-Id'] = req_id
        from flask import request as _req
        origin = _req.headers.get('Origin', '')
        if origin in _ALLOWED_ORIGINS:
            resp.headers['Access-Control-Allow-Origin'] = origin
            resp.headers['Access-Control-Allow-Credentials'] = 'true'
            resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, PUT, DELETE, OPTIONS'
            resp.headers['Access-Control-Allow-Headers'] = (
                'Content-Type, Authorization, X-Bootstrap-Token, Idempotency-Key, X-Request-Id'
            )
            _append_expose_header(resp, 'X-Refresh-Token', 'X-Request-Id')
            _append_vary(resp, 'Origin')
        else:
            _append_expose_header(resp, 'X-Request-Id')
        if _req.is_secure:
            resp.headers.setdefault('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
        # Cache-Control for static assets (CSS, JS, fonts, images)
        path = _req.path
        if path.endswith(('.woff2', '.woff', '.ttf', '.png', '.jpg', '.ico', '.webp')):
            resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
        elif path.endswith(('.css', '.js', '.svg')):
            resp.headers['Cache-Control'] = 'public, max-age=3600, must-revalidate'
        elif path == '/manifest.json':
            resp.headers['Cache-Control'] = 'public, max-age=86400'
        elif path.startswith('/api/'):
            resp.headers['Cache-Control'] = 'no-store'
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
            r.headers['Access-Control-Allow-Headers'] = (
                'Content-Type, Authorization, X-Bootstrap-Token, Idempotency-Key, X-Request-Id'
            )
            r.headers['Access-Control-Max-Age'] = '86400'
            _append_vary(r, 'Origin')
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
    app.register_blueprint(card_bp,    url_prefix=prefix + '/api')
    app.register_blueprint(feature_bp, url_prefix=prefix + '/api')
    app.register_blueprint(admin_bp, url_prefix=prefix + '/api/admin')
    app.register_blueprint(operator_bp, url_prefix=prefix + '/api/operator')
    app.register_blueprint(platform_bp, url_prefix=prefix + '/api/platform')
    app.register_blueprint(push_bp,     url_prefix=prefix + '/api/push')
    app.register_blueprint(payment_audit_bp, url_prefix=prefix + '/api/admin/payments')

    @app.get(prefix + '/api' if prefix else '/api')
    @app.get(prefix + '/api/' if prefix else '/api/')
    def api_catalog():
        return jsonify(build_api_catalog(prefix))

    @app.get(prefix + '/api/version' if prefix else '/api/version')
    def api_version():
        payload = build_api_version()
        payload['ok'] = True
        payload['base_path'] = prefix or '/'
        return jsonify(payload)

    @app.get(prefix + '/api/openapi.json' if prefix else '/api/openapi.json')
    def api_openapi():
        return jsonify(build_openapi_schema(prefix))

    @app.get(prefix + '/api/postman/collection' if prefix else '/api/postman/collection')
    def api_postman_collection():
        return jsonify(build_postman_collection(prefix))

    @app.get(prefix + '/api/postman/environment' if prefix else '/api/postman/environment')
    def api_postman_environment():
        return jsonify(build_postman_environment(prefix))

    @app.get(prefix + '/api/docs' if prefix else '/api/docs')
    def api_docs():
        return Response(build_docs_html(prefix), mimetype='text/html')

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

        if not DEBUG and not BOOTSTRAP_TOKEN:
            return jsonify({'ok': False, 'error': 'Bootstrap endpoint вимкнено на цьому середовищі.'}), 403
        if BOOTSTRAP_TOKEN:
            provided = (_req.headers.get('X-Bootstrap-Token') or '').strip()
            if not provided or not hmac.compare_digest(provided, BOOTSTRAP_TOKEN):
                return jsonify({'ok': False, 'error': 'Невірний bootstrap token.'}), 403

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
        # Без BASE_PATH (Render): корінь = той самий PWA що й /app (вхід), без дубля портфоліо.
        # Портфоліо лише на /army-bank/ (як на munister.com.ua/army-bank/).
        if not prefix:
            return send_index()
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
        return {
            'ok': True,
            'service': 'WeeGo Army Bank',
            'db_boot_ok': bool(app.config.get('DB_BOOT_OK', True)),
        }

    # ── Статичні маркетингові сайти (munister.com.ua/army-admin/, /army-bank/) ──
    # Шляхи без BASE_PATH: Nginx проксує сюди окремо від /bank. Один git pull + restart — усе оновлено.
    def _send_marketing(root: Path, filepath: str | None):
        if not root.is_dir():
            abort(404)
        if not filepath or filepath.endswith('/'):
            resp = send_from_directory(root, 'index.html')
            resp.headers['Cache-Control'] = 'no-cache, must-revalidate'
            return resp
        target = (root / filepath).resolve()
        try:
            target.relative_to(root.resolve())
        except ValueError:
            abort(404)
        if target.is_file():
            resp = send_from_directory(root, filepath)
            # HTML лендінгу часто кешують CDN/браузер — без цього не видно оновлень після git pull
            if filepath.lower().endswith('.html'):
                resp.headers['Cache-Control'] = 'no-cache, must-revalidate'
            elif filepath.lower().endswith(('.css', '.js')):
                resp.headers['Cache-Control'] = 'public, max-age=3600'
            return resp
        abort(404)

    @app.get('/army-admin')
    def marketing_army_admin_slash():
        return redirect('/army-admin/', 308)

    @app.get('/army-admin/')
    def marketing_army_admin_index():
        return _send_marketing(ARMY_ADMIN_MARKETING, None)

    @app.get('/army-admin/<path:filepath>')
    def marketing_army_admin_file(filepath: str):
        return _send_marketing(ARMY_ADMIN_MARKETING, filepath)

    @app.get('/army-bank')
    def marketing_army_bank_slash():
        return redirect('/army-bank/', 308)

    @app.get('/army-bank/')
    def marketing_army_bank_index():
        return _send_marketing(ARMY_BANK_MARKETING, None)

    @app.get('/army-bank/<path:filepath>')
    def marketing_army_bank_file(filepath: str):
        return _send_marketing(ARMY_BANK_MARKETING, filepath)

    return app


app = create_app()


def _start_keepalive() -> None:
    """Пінгує /health кожні 14 хв щоб Render free tier не засипав.
    Запускається тільки якщо встановлена RENDER_EXTERNAL_URL (Render середовище).
    """
    base_url = os.environ.get('RENDER_EXTERNAL_URL', '').rstrip('/')
    if not base_url:
        return  # не на Render — нічого не робимо

    ping_url = f'{base_url}/health'
    interval = 14 * 60  # 14 хвилин

    def _loop():
        # Перший пінг через 2 хв після старту (даємо час на прогрів)
        time.sleep(120)
        while True:
            try:
                import urllib.request
                with urllib.request.urlopen(ping_url, timeout=10) as r:
                    print(f'[keepalive] {r.status} {ping_url}', flush=True)
            except Exception as exc:
                print(f'[keepalive] error: {exc}', flush=True)
            time.sleep(interval)

    t = threading.Thread(target=_loop, daemon=True, name='keepalive')
    t.start()
    print(f'[keepalive] started → {ping_url} every {interval//60} min', flush=True)


_start_keepalive()

if __name__ == '__main__':
    app.run(debug=DEBUG)

"""Маршрути маркетплейсу ARM Bank."""
from __future__ import annotations

from typing import Any

from flask import Blueprint, g, jsonify, request

from ..database import get_connection, get_returning_id_suffix, insert_last_id
from .helpers import api_error, auth_required

marketplace_bp = Blueprint('marketplace', __name__, url_prefix='/api/marketplace')


def _now_sql() -> str:
    from ..config import USE_PG
    return 'NOW()' if USE_PG else "datetime('now')"


def _ensure_schema() -> None:
    now_sql = _now_sql()
    with get_connection() as conn:
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS marketplace_products (
                id INTEGER PRIMARY KEY,
                slug VARCHAR(80) UNIQUE NOT NULL,
                title VARCHAR(160) NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                price NUMERIC(14,2) NOT NULL CHECK(price >= 0),
                currency VARCHAR(6) NOT NULL DEFAULT 'UAH',
                image_emoji VARCHAR(16) NOT NULL DEFAULT '🛍️',
                badge VARCHAR(40),
                stock INTEGER NOT NULL DEFAULT 0,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP NOT NULL DEFAULT {now_sql},
                updated_at TIMESTAMP NOT NULL DEFAULT {now_sql}
            )
            """
        )
        conn.execute('CREATE INDEX IF NOT EXISTS idx_marketplace_products_active ON marketplace_products(is_active)')
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS marketplace_orders (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                total_amount NUMERIC(14,2) NOT NULL CHECK(total_amount >= 0),
                currency VARCHAR(6) NOT NULL DEFAULT 'UAH',
                status VARCHAR(20) NOT NULL DEFAULT 'paid',
                payment_tx_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
                shipping_name VARCHAR(160) NOT NULL DEFAULT '',
                shipping_phone VARCHAR(40) NOT NULL DEFAULT '',
                shipping_address TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMP NOT NULL DEFAULT {now_sql}
            )
            """
        )
        conn.execute('CREATE INDEX IF NOT EXISTS idx_marketplace_orders_user ON marketplace_orders(user_id, created_at)')
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS marketplace_order_items (
                id INTEGER PRIMARY KEY,
                order_id INTEGER NOT NULL REFERENCES marketplace_orders(id) ON DELETE CASCADE,
                product_id INTEGER REFERENCES marketplace_products(id) ON DELETE SET NULL,
                title VARCHAR(160) NOT NULL,
                price NUMERIC(14,2) NOT NULL,
                qty INTEGER NOT NULL CHECK(qty > 0),
                line_total NUMERIC(14,2) NOT NULL
            )
            """
        )
        conn.execute('CREATE INDEX IF NOT EXISTS idx_marketplace_items_order ON marketplace_order_items(order_id)')

        seeded = conn.execute('SELECT COUNT(*) AS n FROM marketplace_products').fetchone()
        if int((seeded or {}).get('n') or 0) > 0:
            return

        products = [
            ('arm-hoodie', 'ARM Hoodie', 'Преміум худі зі щільної бавовни', 2499.00, '🧥', 'NEW', 40),
            ('arm-mug', 'ARM Mug', 'Термочашка з подвійною стінкою 450 мл', 699.00, '☕', 'HOT', 120),
            ('arm-powerbank', 'ARM PowerBank', 'Powerbank 20 000 mAh, швидка зарядка', 1899.00, '🔋', 'TOP', 25),
            ('arm-card-holder', 'ARM Card Holder', 'Шкіряний кардхолдер для банківських карт', 899.00, '💳', None, 65),
            ('arm-wireless-earbuds', 'ARM Earbuds', 'Бездротові навушники з шумозаглушенням', 3299.00, '🎧', 'PRO', 18),
            ('arm-smart-lamp', 'ARM Smart Lamp', 'Розумна настільна лампа з керуванням зі смартфона', 1599.00, '💡', None, 32),
        ]
        suffix = get_returning_id_suffix()
        for slug, title, description, price, emoji, badge, stock in products:
            conn.execute(
                """
                INSERT INTO marketplace_products
                (slug, title, description, price, currency, image_emoji, badge, stock, is_active, created_at, updated_at)
                VALUES (%s, %s, %s, %s, 'UAH', %s, %s, %s, TRUE, """
                + now_sql
                + ", "
                + now_sql
                + ")"
                + suffix,
                (slug, title, description, float(price), emoji, badge, int(stock)),
            )


def _to_payload_product(row: dict[str, Any]) -> dict[str, Any]:
    return {
        'id': int(row['id']),
        'slug': row['slug'],
        'title': row['title'],
        'description': row['description'],
        'price': float(row['price'] or 0),
        'currency': row.get('currency') or 'UAH',
        'image_emoji': row.get('image_emoji') or '🛍️',
        'badge': row.get('badge'),
        'stock': int(row.get('stock') or 0),
    }


@marketplace_bp.get('/catalog')
def catalog():
    _ensure_schema()
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, slug, title, description, price, currency, image_emoji, badge, stock
            FROM marketplace_products
            WHERE is_active = TRUE
            ORDER BY id ASC
            """
        ).fetchall()
    return jsonify({'ok': True, 'data': {'items': [_to_payload_product(dict(r)) for r in (rows or [])]}})


@marketplace_bp.get('/orders')
@auth_required
def list_orders():
    _ensure_schema()
    user_id = int(g.current_user['id'])
    limit = min(max(int(request.args.get('limit') or 20), 1), 50)
    with get_connection() as conn:
        orders = conn.execute(
            """
            SELECT
                o.id,
                o.total_amount,
                o.currency,
                o.status,
                o.created_at,
                COALESCE(COUNT(i.id), 0) AS items_count
            FROM marketplace_orders o
            LEFT JOIN marketplace_order_items i ON i.order_id = o.id
            WHERE o.user_id = %s
            GROUP BY o.id
            ORDER BY o.created_at DESC, o.id DESC
            LIMIT %s
            """,
            (user_id, limit),
        ).fetchall()
    payload = []
    for row in orders or []:
        r = dict(row)
        payload.append({
            'id': int(r['id']),
            'total_amount': float(r.get('total_amount') or 0),
            'currency': r.get('currency') or 'UAH',
            'status': r.get('status') or 'paid',
            'created_at': r.get('created_at'),
            'items_count': int(r.get('items_count') or 0),
        })
    return jsonify({'ok': True, 'data': {'orders': payload}})


@marketplace_bp.post('/checkout')
@auth_required
def checkout():
    _ensure_schema()
    user_id = int(g.current_user['id'])
    payload = request.get_json(force=True) or {}
    cart_items = payload.get('items') or []
    if not isinstance(cart_items, list) or not cart_items:
        return api_error('Кошик порожній.')

    shipping_name = str(payload.get('shipping_name') or '').strip()
    shipping_phone = str(payload.get('shipping_phone') or '').strip()
    shipping_address = str(payload.get('shipping_address') or '').strip()
    note = str(payload.get('note') or '').strip()

    if len(shipping_name) < 2 or len(shipping_address) < 8:
        return api_error('Заповніть дані доставки (ПІБ та адресу).')

    requested: dict[int, int] = {}
    for item in cart_items:
        try:
            pid = int(item.get('product_id'))
            qty = int(item.get('qty') or 1)
        except Exception:
            return api_error('Некоректний склад кошика.')
        if pid <= 0 or qty <= 0 or qty > 50:
            return api_error('Некоректна кількість товару.')
        requested[pid] = requested.get(pid, 0) + qty

    product_ids = sorted(requested.keys())
    placeholders = ', '.join(['%s'] * len(product_ids))
    suffix = get_returning_id_suffix()

    with get_connection() as conn:
        account = conn.execute(
            'SELECT id, account_number, balance, currency FROM accounts WHERE user_id = %s',
            (user_id,),
        ).fetchone()
        if not account:
            return api_error('Банківський рахунок не знайдено.', 404)

        prod_rows = conn.execute(
            f"""
            SELECT id, title, price, currency, stock
            FROM marketplace_products
            WHERE is_active = TRUE AND id IN ({placeholders})
            """,
            tuple(product_ids),
        ).fetchall()
        by_id = {int(r['id']): dict(r) for r in (prod_rows or [])}
        if len(by_id) != len(product_ids):
            return api_error('Один або кілька товарів недоступні.')

        normalized_items: list[dict[str, Any]] = []
        total_amount = 0.0
        for pid in product_ids:
            row = by_id[pid]
            qty = requested[pid]
            stock = int(row.get('stock') or 0)
            if stock < qty:
                return api_error(f"Товар «{row.get('title') or 'позиція'}» закінчився на складі.")
            price = float(row.get('price') or 0)
            line_total = round(price * qty, 2)
            total_amount = round(total_amount + line_total, 2)
            normalized_items.append({
                'product_id': pid,
                'title': row.get('title') or f'Товар #{pid}',
                'price': price,
                'qty': qty,
                'line_total': line_total,
            })

        account_balance = float(account.get('balance') or 0)
        if account_balance < total_amount:
            return api_error('Недостатньо коштів на рахунку.', 409)

        new_balance = round(account_balance - total_amount, 2)
        conn.execute('UPDATE accounts SET balance = %s WHERE id = %s', (new_balance, account['id']))

        tx_cur = conn.execute(
            """
            INSERT INTO transactions(account_id, tx_type, direction, amount, description, related_account)
            VALUES (%s, %s, %s, %s, %s, %s)
            """
            + suffix,
            (
                account['id'],
                'marketplace',
                'out',
                total_amount,
                'Оплата у ARM Marketplace',
                'ARM-MARKETPLACE',
            ),
        )
        payment_tx_id = insert_last_id(tx_cur)

        order_cur = conn.execute(
            """
            INSERT INTO marketplace_orders
            (user_id, account_id, total_amount, currency, status, payment_tx_id, shipping_name, shipping_phone, shipping_address, note)
            VALUES (%s, %s, %s, %s, 'paid', %s, %s, %s, %s, %s)
            """
            + suffix,
            (
                user_id,
                account['id'],
                total_amount,
                str(account.get('currency') or 'UAH'),
                payment_tx_id,
                shipping_name,
                shipping_phone,
                shipping_address,
                note,
            ),
        )
        order_id = insert_last_id(order_cur)

        for row in normalized_items:
            conn.execute(
                """
                INSERT INTO marketplace_order_items(order_id, product_id, title, price, qty, line_total)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (order_id, row['product_id'], row['title'], row['price'], row['qty'], row['line_total']),
            )
            conn.execute(
                'UPDATE marketplace_products SET stock = stock - %s, updated_at = ' + _now_sql() + ' WHERE id = %s',
                (row['qty'], row['product_id']),
            )

    return jsonify({
        'ok': True,
        'data': {
            'order_id': int(order_id or 0),
            'payment_tx_id': int(payment_tx_id or 0),
            'total_amount': float(total_amount),
            'currency': str(account.get('currency') or 'UAH'),
            'account_number': account.get('account_number'),
            'new_balance': float(new_balance),
            'status': 'paid',
            'items': normalized_items,
        },
    })


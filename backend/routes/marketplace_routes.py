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

        products = [
            ('arm-hoodie', 'ARM Hoodie', 'Преміум худі зі щільної бавовни', 2499.00, '🧥', 'NEW', 40),
            ('arm-mug', 'ARM Mug', 'Термочашка з подвійною стінкою 450 мл', 699.00, '☕', 'HOT', 120),
            ('arm-powerbank', 'ARM PowerBank', 'Powerbank 20 000 mAh, швидка зарядка', 1899.00, '🔋', 'TOP', 25),
            ('arm-card-holder', 'ARM Card Holder', 'Шкіряний кардхолдер для банківських карт', 899.00, '💳', None, 65),
            ('arm-wireless-earbuds', 'ARM Earbuds', 'Бездротові навушники з шумозаглушенням', 3299.00, '🎧', 'PRO', 18),
            ('arm-smart-lamp', 'ARM Smart Lamp', 'Розумна настільна лампа з керуванням зі смартфона', 1599.00, '💡', None, 32),
            ('arm-iphone-lite', 'ARM Phone Lite 128GB', 'Смартфон 6.5" OLED, NFC, швидка зарядка', 11999.00, '📱', 'SALE', 54),
            ('arm-phone-pro', 'ARM Phone Pro 256GB', 'Флагманський смартфон, 5G, камера 50MP', 21999.00, '📱', 'TOP', 36),
            ('arm-tablet-11', 'ARM Tablet 11"', 'Планшет 11" з підтримкою стилуса', 15499.00, '📲', None, 22),
            ('arm-laptop-air', 'ARM Book Air 14', 'Ультрабук 14", 16GB RAM, 512GB SSD', 32999.00, '💻', 'NEW', 17),
            ('arm-laptop-pro', 'ARM Book Pro 15', 'Ноутбук для роботи та монтажу', 45999.00, '💻', 'PRO', 9),
            ('arm-monitor-24', 'ARM Monitor 24" IPS', 'Монітор 24", 100Hz, тонкі рамки', 6999.00, '🖥️', None, 40),
            ('arm-monitor-27', 'ARM Monitor 27" QHD', 'Монітор 27", QHD, HDR ready', 11999.00, '🖥️', 'HOT', 28),
            ('arm-keyboard-mech', 'ARM Mechanical Keyboard', 'Механічна клавіатура RGB', 2899.00, '⌨️', None, 75),
            ('arm-mouse-pro', 'ARM Wireless Mouse', 'Ергономічна бездротова миша', 1399.00, '🖱️', None, 90),
            ('arm-webcam-2k', 'ARM Webcam 2K', 'Вебкамера 2K з автофокусом', 2499.00, '📷', None, 33),
            ('arm-router-ax', 'ARM Router AX3000', 'Wi‑Fi 6 роутер для дому та офісу', 3599.00, '📡', 'TOP', 41),
            ('arm-speaker-mini', 'ARM Speaker Mini', 'Портативна Bluetooth колонка', 1299.00, '🔊', None, 70),
            ('arm-speaker-max', 'ARM Speaker Max', 'Стереоколонка з басом та автономністю 20 год', 3999.00, '🔊', 'SALE', 29),
            ('arm-vacuum-robot', 'ARM Robot Vacuum', 'Робот-пилосос з вологим прибиранням', 12499.00, '🤖', 'HOT', 16),
            ('arm-vacuum-stick', 'ARM Stick Vacuum', 'Вертикальний пилосос 2-в-1', 6999.00, '🧹', None, 31),
            ('arm-air-fryer', 'ARM Air Fryer XL', 'Аерофритюрниця 5.5л з 8 режимами', 4699.00, '🍟', None, 24),
            ('arm-kettle-smart', 'ARM Smart Kettle', 'Електрочайник з керуванням зі смартфона', 1899.00, '🫖', None, 43),
            ('arm-coffee-pro', 'ARM Coffee Pro', 'Кавоварка еспресо з капучинатором', 8499.00, '☕', 'PRO', 12),
            ('arm-blender-max', 'ARM Blender Max', 'Блендер 1200W з 3 насадками', 2199.00, '🥤', None, 57),
            ('arm-smart-bulb', 'ARM Smart Bulb Set', 'Набір із 3 розумних ламп RGB', 1199.00, '💡', None, 101),
            ('arm-bedside-light', 'ARM Bedside Night Lamp', 'Нічник з сенсорним керуванням', 999.00, '🌙', 'SALE', 67),
            ('arm-baby-night-light', 'ARM Baby Night Light', 'Нічник для дитячої кімнати', 749.00, '🌜', None, 79),
            ('arm-security-cam', 'ARM Security Cam', 'IP-камера 2K для дому', 2799.00, '📹', None, 26),
            ('arm-door-sensor', 'ARM Door Sensor Kit', 'Набір датчиків дверей/вікон', 1499.00, '🚪', None, 64),
            ('arm-watch-fit', 'ARM Watch Fit', 'Смарт-годинник з пульсометром', 4999.00, '⌚', 'NEW', 34),
            ('arm-band-lite', 'ARM Fitness Band', 'Фітнес-браслет з AMOLED екраном', 1999.00, '⌚', None, 60),
            ('arm-charger-gan', 'ARM GaN Charger 65W', 'Компактна зарядка 65W USB-C', 1299.00, '🔌', None, 110),
            ('arm-cable-pack', 'ARM USB-C Cable Pack', 'Набір кабелів USB-C (3 шт.)', 599.00, '🔗', None, 140),
            ('arm-backpack-city', 'ARM City Backpack', 'Міський рюкзак для ноутбука 15.6"', 1799.00, '🎒', None, 48),
            ('arm-travel-case', 'ARM Travel Organizer', 'Органайзер для кабелів та ґаджетів', 899.00, '🧳', None, 72),
            ('arm-home-hub', 'ARM Smart Home Hub', 'Центр керування smart-пристроями', 3199.00, '🏠', 'TOP', 21),
            ('arm-tv-box', 'ARM TV Box 4K', 'Медіаприставка 4K з голосовим керуванням', 2699.00, '📺', None, 39),
            ('arm-headphones-over', 'ARM Over-Ear ANC', 'Повнорозмірні навушники з ANC', 5299.00, '🎧', 'HOT', 19),
            ('arm-gaming-chair', 'ARM Gaming Chair', 'Ергономічне крісло з підтримкою спини', 7999.00, '🪑', None, 14),
            ('arm-desk-lift', 'ARM Lift Desk', 'Підйомний стіл для робочого місця', 14999.00, '🪵', 'PRO', 8),
            ('arm-mini-pc', 'ARM Mini PC i7', 'Компактний ПК для дому та офісу, 16GB/1TB SSD', 28499.00, '🖥️', 'NEW', 12),
            ('arm-gaming-laptop-16', 'ARM Gaming Laptop 16', 'Ігровий ноутбук 16", RTX класу, 32GB RAM', 69999.00, '🎮', 'TOP', 6),
            ('arm-office-laptop-14', 'ARM Office Laptop 14', 'Легкий ноутбук 14" для роботи та навчання', 26999.00, '💻', 'ARM DEAL', 22),
            ('arm-aio-desktop-24', 'ARM All-in-One 24', 'Моноблок 24" Full HD для домашнього офісу', 31999.00, '🖥️', None, 11),
            ('arm-phone-lite-5g', 'ARM Phone Lite 5G 256GB', 'Смартфон 120Hz, 5G, NFC, батарея 5000mAh', 13999.00, '📱', 'ARM DEAL', 44),
            ('arm-phone-max-512', 'ARM Phone Max 512GB', 'Топова камера, AMOLED 6.8", 120W fast charge', 29999.00, '📱', 'TOP', 18),
            ('arm-fold-smart', 'ARM Fold Smart', 'Складаний смартфон нового покоління', 51999.00, '📲', 'NEW', 7),
            ('arm-smartwatch-pro', 'ARM Smartwatch Pro', 'Годинник з eSIM, GPS і датчиками здоровʼя', 8999.00, '⌚', 'HOT', 30),
            ('arm-tv-50-4k', 'ARM Smart TV 50" 4K', 'Телевізор 50" з Dolby Vision та голосовим керуванням', 18999.00, '📺', 'SALE', 20),
            ('arm-tv-65-qled', 'ARM QLED TV 65"', 'Преміальний QLED 65", 120Hz, HDMI 2.1', 39999.00, '📺', 'PRO', 9),
            ('arm-washer-ai', 'ARM Washer AI 8kg', 'Пральна машина з AI-програмами та тихим режимом', 21499.00, '🧺', None, 13),
            ('arm-dryer-heatpump', 'ARM Dryer HeatPump', 'Сушильна машина з тепловим насосом', 23999.00, '🌬️', 'ARM DEAL', 10),
            ('arm-dishwasher-60', 'ARM Dishwasher 60cm', 'Посудомийна машина, 14 комплектів', 19999.00, '🍽️', None, 15),
            ('arm-fridge-smart', 'ARM Smart Fridge', 'Холодильник No Frost із smart керуванням', 35999.00, '🧊', 'TOP', 8),
            ('arm-multicooker-x', 'ARM Multicooker X', 'Мультиварка з 28 автопрограмами', 3299.00, '🍲', 'SALE', 42),
            ('arm-air-purifier', 'ARM Air Purifier', 'Очищувач повітря з HEPA H13', 6499.00, '🌫️', None, 24),
            ('arm-dehumidifier', 'ARM Dehumidifier', 'Осушувач повітря для квартири', 5899.00, '💧', None, 21),
            ('arm-electric-grill', 'ARM Electric Grill', 'Контактний гриль зі змінними панелями', 4199.00, '🍖', 'HOT', 27),
            ('arm-knife-set', 'ARM Kitchen Knife Set', 'Набір кухонних ножів з підставкою', 1599.00, '🔪', None, 66),
            ('arm-robot-mop-pro', 'ARM Robot Mop Pro', 'Робот для сухого і вологого прибирання', 14999.00, '🧽', 'ARM DEAL', 12),
            ('arm-bedding-premium', 'ARM Bedding Premium', 'Набір постільної білизни з сатину', 2299.00, '🛏️', None, 53),
            ('arm-home-textile-set', 'ARM Home Textile Set', 'Комплект рушників та пледів', 1799.00, '🧶', None, 58),
            ('arm-smart-plug-kit', 'ARM Smart Plug Kit', 'Набір розумних розеток (4 шт.)', 1399.00, '🔌', 'SALE', 75),
            ('arm-video-doorbell', 'ARM Video Doorbell', 'Смарт-дзвінок з камерою та детекцією руху', 4999.00, '🚪', 'NEW', 19),
            ('arm-security-starter', 'ARM Home Security Starter', 'Базовий комплект безпеки для дому', 7299.00, '🛡️', 'TOP', 17),
            ('arm-cookware-pro', 'ARM Cookware Pro', 'Набір посуду з антипригарним покриттям', 3899.00, '🍳', 'ARM DEAL', 37),
            ('arm-sofa-cleaner', 'ARM Sofa Cleaner', 'Портативний миючий пилосос для меблів', 7999.00, '🛋️', None, 16),
            ('arm-water-filter', 'ARM Water Filter Max', 'Система фільтрації води для кухні', 2699.00, '🚰', None, 46),
        ]
        suffix = get_returning_id_suffix()
        existing_rows = conn.execute('SELECT slug FROM marketplace_products').fetchall()
        existing_slugs = {str(row.get('slug') or '') for row in (existing_rows or [])}
        for slug, title, description, price, emoji, badge, stock in products:
            if slug in existing_slugs:
                continue
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

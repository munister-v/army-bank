"""Маршрути маркетплейсу ARM Bank."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from flask import Blueprint, g, jsonify, request

from ..database import get_connection, get_returning_id_suffix, insert_last_id
from ..services.idempotency_service import IdempotencyService
from .helpers import api_error, auth_required, require_idempotency_key

marketplace_bp = Blueprint('marketplace', __name__, url_prefix='/api/marketplace')
idempotency_service = IdempotencyService()


APPROVED_CODE = '00'
INSUFFICIENT_FUNDS_CODE = '51'
INVALID_ACCOUNT_CODE = '14'
PROCESSING_ERROR_CODE = '96'


def _now_sql() -> str:
    from ..config import USE_PG
    return 'NOW()' if USE_PG else 'CURRENT_TIMESTAMP'


def _due_at_sql(hours: int = 24) -> str:
    from ..config import USE_PG
    if USE_PG:
        return f"NOW() + INTERVAL '{int(hours)} hours'"
    return f"datetime('now', '+{int(hours)} hours')"


def _safe_add_column(conn: Any, table: str, ddl: str) -> None:
    try:
        conn.execute(f'ALTER TABLE {table} ADD COLUMN {ddl}')
    except Exception:
        pass


def _generate_invoice_number() -> str:
    stamp = datetime.utcnow().strftime('%Y%m%d%H%M')
    return f"INV-{stamp}-{uuid4().hex[:6].upper()}"


def _generate_auth_code() -> str:
    return f"AUTH-{uuid4().hex[:10].upper()}"


def _complete_idempotency_in_conn(
    conn: Any,
    *,
    user_id: int,
    action: str,
    key: str | None,
    response_payload: dict[str, Any],
    response_code: int,
) -> None:
    if not key:
        return
    conn.execute(
        """
        UPDATE api_idempotency
        SET status = 'completed',
            response_code = %s,
            response_payload = %s,
            updated_at = %s
        WHERE user_id = %s AND action = %s AND idempotency_key = %s
        """,
        (
            int(response_code),
            json.dumps(response_payload, ensure_ascii=False),
            datetime.now(timezone.utc).isoformat(),
            user_id,
            action,
            key,
        ),
    )


def _generate_unique_invoice_number(conn: Any) -> str:
    for _ in range(10):
        candidate = _generate_invoice_number()
        row = conn.execute(
            'SELECT id FROM marketplace_invoices WHERE invoice_number = %s LIMIT 1',
            (candidate,),
        ).fetchone()
        if not row:
            return candidate
    return f"INV-{datetime.utcnow().strftime('%Y%m%d%H%M')}-{uuid4().hex[:10].upper()}"


def _ensure_schema() -> None:
    now_sql = _now_sql()
    from ..config import USE_PG
    pk_sql = 'SERIAL PRIMARY KEY' if USE_PG else 'INTEGER PRIMARY KEY'
    due_sql = _due_at_sql(24) if USE_PG else 'CURRENT_TIMESTAMP'
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
                payment_mode VARCHAR(20) NOT NULL DEFAULT 'pay_now',
                invoice_number VARCHAR(40),
                invoice_status VARCHAR(20) NOT NULL DEFAULT 'paid',
                invoice_due_at TIMESTAMP,
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
        conn.execute('CREATE INDEX IF NOT EXISTS idx_marketplace_orders_invoice_number ON marketplace_orders(invoice_number)')
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

        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS marketplace_invoices (
                id INTEGER PRIMARY KEY,
                invoice_number VARCHAR(40) UNIQUE NOT NULL,
                order_id INTEGER NOT NULL UNIQUE REFERENCES marketplace_orders(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                amount NUMERIC(14,2) NOT NULL CHECK(amount >= 0),
                currency VARCHAR(6) NOT NULL DEFAULT 'UAH',
                status VARCHAR(20) NOT NULL DEFAULT 'issued',
                due_at TIMESTAMP NOT NULL DEFAULT {due_sql},
                paid_at TIMESTAMP,
                payment_tx_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
                created_at TIMESTAMP NOT NULL DEFAULT {now_sql}
            )
            """
        )
        conn.execute('CREATE INDEX IF NOT EXISTS idx_marketplace_invoices_user ON marketplace_invoices(user_id, created_at)')
        conn.execute('CREATE INDEX IF NOT EXISTS idx_marketplace_invoices_status ON marketplace_invoices(status, due_at)')

        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS marketplace_payment_authorizations (
                id {pk_sql},
                authorization_code VARCHAR(40) UNIQUE NOT NULL,
                idempotency_key VARCHAR(128),
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                order_id INTEGER REFERENCES marketplace_orders(id) ON DELETE SET NULL,
                invoice_number VARCHAR(40),
                amount NUMERIC(14,2) NOT NULL CHECK(amount >= 0),
                currency VARCHAR(6) NOT NULL DEFAULT 'UAH',
                payment_network VARCHAR(20) NOT NULL DEFAULT 'ARM_PAY',
                merchant_id VARCHAR(40) NOT NULL DEFAULT 'ARM-MARKETPLACE',
                merchant_name VARCHAR(80) NOT NULL DEFAULT 'ARM Marketplace',
                status VARCHAR(20) NOT NULL DEFAULT 'authorized',
                response_code VARCHAR(8) NOT NULL DEFAULT '00',
                decline_reason TEXT,
                balance_before NUMERIC(14,2) NOT NULL DEFAULT 0,
                balance_after NUMERIC(14,2),
                payment_tx_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
                created_at TIMESTAMP NOT NULL DEFAULT {now_sql},
                captured_at TIMESTAMP,
                reversed_at TIMESTAMP
            )
            """
        )
        conn.execute(
            'CREATE INDEX IF NOT EXISTS idx_marketplace_payment_auth_user '
            'ON marketplace_payment_authorizations(user_id, created_at)'
        )
        conn.execute(
            'CREATE INDEX IF NOT EXISTS idx_marketplace_payment_auth_invoice '
            'ON marketplace_payment_authorizations(invoice_number)'
        )
        conn.execute(
            'CREATE INDEX IF NOT EXISTS idx_marketplace_payment_auth_status '
            'ON marketplace_payment_authorizations(status)'
        )

        # Backward-compatible migrations for old DBs
        _safe_add_column(conn, 'marketplace_orders', "payment_mode VARCHAR(20) NOT NULL DEFAULT 'pay_now'")
        _safe_add_column(conn, 'marketplace_orders', 'invoice_number VARCHAR(40)')
        _safe_add_column(conn, 'marketplace_orders', "invoice_status VARCHAR(20) NOT NULL DEFAULT 'paid'")
        _safe_add_column(conn, 'marketplace_orders', 'invoice_due_at TIMESTAMP')
        _safe_add_column(conn, 'marketplace_orders', 'payment_auth_id INTEGER')
        _safe_add_column(conn, 'marketplace_invoices', 'payment_auth_id INTEGER')

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
            # New large catalog block
            ('arm-iphone-15', 'ARM iPhone 15 Pro 256GB', 'Преміум смартфон з ProMotion і потужною камерою', 57999.00, '📱', 'TOP', 11),
            ('arm-iphone-14', 'ARM iPhone 14 128GB', 'Надійний смартфон з чудовою автономністю', 34999.00, '📱', 'SALE', 19),
            ('arm-galaxy-s24', 'ARM Galaxy S24 256GB', 'Флагман Android з AI-функціями', 42999.00, '📱', 'HOT', 21),
            ('arm-pixel-9', 'ARM Pixel 9 128GB', 'Смартфон з еталонною камерою та чистим Android', 38999.00, '📱', 'NEW', 14),
            ('arm-oneplus-13', 'ARM OnePlus 13', 'Швидкий смартфон із зарядкою 100W', 31999.00, '📱', 'ARM DEAL', 16),
            ('arm-redmi-note', 'ARM Redmi Note Pro', 'Доступний смартфон для щоденних задач', 12499.00, '📱', None, 39),
            ('arm-laptop-ryzen', 'ARM RyzenBook 15', 'Ноутбук Ryzen 7, 32GB RAM, 1TB SSD', 48999.00, '💻', 'HOT', 13),
            ('arm-laptop-ultra', 'ARM UltraBook 13', 'Тонкий та легкий ноутбук для подорожей', 35999.00, '💻', None, 18),
            ('arm-gaming-pc-r7', 'ARM Gaming PC R7', 'Стаціонарний ПК для 2K-геймінгу', 73999.00, '🖥️', 'TOP', 7),
            ('arm-gaming-pc-r9', 'ARM Gaming PC R9', 'Потужний ПК для 4K і стрімінгу', 108999.00, '🖥️', 'PRO', 4),
            ('arm-ssd-2tb', 'ARM SSD 2TB NVMe', 'Швидкий NVMe накопичувач Gen4', 4999.00, '💾', None, 62),
            ('arm-ram-32', 'ARM RAM Kit 32GB DDR5', 'Комплект памʼяті для апгрейду ПК', 4299.00, '🧠', None, 58),
            ('arm-monitor-34-ultra', 'ARM Monitor 34" Ultrawide', 'Монітор 34" 144Hz для роботи та ігор', 19999.00, '🖥️', 'NEW', 12),
            ('arm-monitor-32-4k', 'ARM Monitor 32" 4K', 'Професійний дисплей для дизайну', 22999.00, '🖥️', 'PRO', 10),
            ('arm-projector-4k', 'ARM Projector 4K Home', 'Домашній проектор з автофокусом', 27999.00, '📽️', 'HOT', 8),
            ('arm-soundbar', 'ARM Soundbar Cinema', 'Саундбар 5.1 з підтримкою Dolby', 11999.00, '🔊', 'SALE', 17),
            ('arm-subwoofer', 'ARM Subwoofer X', 'Сабвуфер для глибокого басу', 6999.00, '🔊', None, 15),
            ('arm-fridge-mini', 'ARM Mini Fridge 90L', 'Компактний холодильник для квартири', 8999.00, '🧊', None, 20),
            ('arm-fridge-xl', 'ARM Fridge XL 500L', 'Холодильник side-by-side з інвертором', 52999.00, '🧊', 'TOP', 6),
            ('arm-microwave-plus', 'ARM Microwave Plus', 'Мікрохвильова піч з грилем', 4999.00, '🍲', None, 34),
            ('arm-oven-smart', 'ARM Smart Oven', 'Електрична духова шафа з Wi-Fi', 22999.00, '🔥', 'NEW', 9),
            ('arm-induction-plate', 'ARM Induction Plate', 'Індукційна плита 4 конфорки', 18999.00, '🍳', None, 11),
            ('arm-toaster-pro', 'ARM Toaster Pro', 'Тостер на 4 відсіки', 2499.00, '🍞', None, 33),
            ('arm-juicer-max', 'ARM Juicer Max', 'Соковижималка повільного віджиму', 5299.00, '🍊', 'HOT', 18),
            ('arm-cleaner-robot-s8', 'ARM Robot Cleaner S8', 'Робот-пилосос з LiDAR навігацією', 18999.00, '🤖', 'TOP', 14),
            ('arm-cleaner-window', 'ARM Window Cleaner Bot', 'Робот-мийник вікон', 9999.00, '🪟', None, 13),
            ('arm-iron-steam', 'ARM Steam Iron', 'Парова праска з керамічною підошвою', 1899.00, '🧺', None, 46),
            ('arm-garment-steamer', 'ARM Garment Steamer', 'Вертикальний відпарювач одягу', 3299.00, '👔', 'SALE', 26),
            ('arm-aircon-12k', 'ARM AirCon 12K', 'Кондиціонер інверторний до 35 м²', 24999.00, '❄️', 'HOT', 10),
            ('arm-aircon-18k', 'ARM AirCon 18K', 'Кондиціонер інверторний до 50 м²', 32999.00, '❄️', None, 8),
            ('arm-bed-linen-premium', 'ARM Bed Linen Premium XL', 'Комплект білизни преміум якості', 2899.00, '🛏️', None, 40),
            ('arm-pillows-set', 'ARM Pillow Set Memory', 'Набір ортопедичних подушок', 3199.00, '🛌', 'ARM DEAL', 29),
            ('arm-home-decor-set', 'ARM Home Decor Set', 'Декор для вітальні у мінімал стилі', 1699.00, '🏡', None, 47),
            ('arm-desk-lamp-led', 'ARM LED Desk Lamp Pro', 'Світлодіодна лампа з регулюванням температури', 1299.00, '💡', None, 54),
            ('arm-floor-lamp', 'ARM Floor Lamp Arc', 'Торшер із дистанційним керуванням', 3499.00, '💡', 'SALE', 21),
            ('arm-curtains-smart', 'ARM Smart Curtains Kit', 'Автоматичний комплект для штор', 7999.00, '🪟', 'NEW', 15),
            ('arm-camera-outdoor', 'ARM Outdoor Camera 4MP', 'Зовнішня камера з нічним баченням', 4499.00, '📹', None, 27),
            ('arm-doorlock-smart', 'ARM Smart Door Lock', 'Розумний замок із біометрією', 10999.00, '🔐', 'TOP', 12),
            ('arm-sensor-pack-10', 'ARM Sensor Pack 10', 'Пакет датчиків для smart home', 3999.00, '📡', None, 38),
            ('arm-water-leak-sensor', 'ARM Water Leak Sensor', 'Датчик протікання з push-сповіщенням', 999.00, '💧', None, 85),
            ('arm-baby-monitor', 'ARM Baby Monitor Pro', 'Відеоняня з двостороннім звуком', 5999.00, '👶', 'HOT', 17),
            ('arm-ebook-reader', 'ARM eBook Reader', 'Рідер з підсвіткою та Wi-Fi', 7499.00, '📚', None, 23),
            ('arm-console-lite', 'ARM Game Console Lite', 'Портативна ігрова консоль', 10999.00, '🎮', 'ARM DEAL', 19),
            ('arm-console-pro', 'ARM Game Console Pro', 'Стаціонарна консоль нового покоління', 22999.00, '🎮', 'TOP', 9),
            # Extra catalog expansion
            ('arm-router-mesh-2pack', 'ARM Mesh Wi-Fi 2-Pack', 'Двоточкова mesh-система для великої квартири', 7999.00, '📡', 'NEW', 18),
            ('arm-router-mesh-3pack', 'ARM Mesh Wi-Fi 3-Pack', 'Триточкова mesh-система з централізованим керуванням', 10999.00, '📡', 'TOP', 12),
            ('arm-keyboard-wireless', 'ARM Wireless Keyboard Slim', 'Тиха бездротова клавіатура для офісу', 1899.00, '⌨️', None, 62),
            ('arm-mouse-gaming', 'ARM Gaming Mouse 26000 DPI', 'Ігрова миша з оптичним сенсором і RGB', 2199.00, '🖱️', 'HOT', 31),
            ('arm-webcam-4k', 'ARM Webcam 4K Pro', '4K вебкамера з шумозаглушенням мікрофона', 4299.00, '📷', 'PRO', 24),
            ('arm-mic-usb', 'ARM USB Studio Mic', 'Конденсаторний мікрофон для стрімів і подкастів', 3599.00, '🎙️', 'ARM DEAL', 20),
            ('arm-laptop-stand', 'ARM Laptop Stand Aluminum', 'Підставка для ноутбука з регулюванням висоти', 999.00, '💻', None, 75),
            ('arm-docking-station', 'ARM Docking Station 11-in-1', 'Док-станція USB-C для підключення периферії', 2799.00, '🔌', 'SALE', 37),
            ('arm-projector-portable', 'ARM Portable Projector', 'Портативний проектор для подорожей та презентацій', 14999.00, '📽️', None, 13),
            ('arm-phone-gimbal', 'ARM Smartphone Gimbal', 'Стабілізатор для відеозйомки зі смартфона', 4999.00, '📱', 'NEW', 16),
            ('arm-phone-tripod', 'ARM Tripod Pro 170cm', 'Штатив із Bluetooth-кнопкою для контенту', 1499.00, '📱', None, 43),
            ('arm-smart-ring', 'ARM Smart Ring', 'Смарт-кільце для трекінгу активності і сну', 6999.00, '⌚', 'HOT', 14),
            ('arm-tablet-13-pro', 'ARM Tablet 13 Pro', 'Планшет 13" з клавіатурним чохлом', 28999.00, '📲', 'PRO', 10),
            ('arm-eink-tablet', 'ARM eInk Note Tablet', 'E-Ink планшет для нотаток і читання', 12999.00, '📚', None, 18),
            ('arm-tv-43', 'ARM Smart TV 43"', '4K телевізор з HDR10 та голосовим пошуком', 15999.00, '📺', None, 22),
            ('arm-tv-75', 'ARM Smart TV 75"', 'Великий 75" TV для домашнього кінотеатру', 69999.00, '📺', 'TOP', 6),
            ('arm-vacuum-upright-pro', 'ARM Upright Vacuum Pro', 'Потужний вертикальний пилосос для всіх покриттів', 9999.00, '🧹', 'ARM DEAL', 19),
            ('arm-vacuum-handy', 'ARM Handy Vacuum', 'Ручний пилосос для авто та меблів', 2699.00, '🧹', None, 41),
            ('arm-kettle-glass', 'ARM Glass Kettle', 'Скляний електрочайник з підсвіткою', 1499.00, '🫖', 'SALE', 52),
            ('arm-kitchen-machine', 'ARM Kitchen Machine', 'Кухонна машина з металевою чашею 5л', 8999.00, '🍳', 'PRO', 11),
            ('arm-food-processor', 'ARM Food Processor X', 'Кухонний комбайн з 12 насадками', 6299.00, '🍲', 'HOT', 17),
            ('arm-pressure-cooker', 'ARM Pressure Cooker', 'Скороварка-мультиварка для швидкого готування', 4599.00, '🍲', None, 26),
            ('arm-coffee-grinder', 'ARM Coffee Grinder', 'Жорновий млинок для кави з 40 режимами', 3399.00, '☕', None, 29),
            ('arm-air-humidifier', 'ARM Humidifier 5L', 'Зволожувач повітря з нічним режимом', 2799.00, '💧', 'SALE', 34),
            ('arm-heater-ceramic', 'ARM Ceramic Heater', 'Керамічний обігрівач з термостатом', 3199.00, '🔥', None, 22),
            ('arm-fan-tower', 'ARM Tower Fan', 'Безлопатевий баштовий вентилятор', 4299.00, '🌬️', 'NEW', 15),
            ('arm-mattress-topper', 'ARM Mattress Topper', 'Ортопедичний топер для комфортного сну', 2399.00, '🛏️', None, 28),
            ('arm-office-chair', 'ARM Ergonomic Office Chair', 'Офісне крісло з підтримкою попереку', 9999.00, '🪑', 'HOT', 12),
            ('arm-gaming-desk-rgb', 'ARM Gaming Desk RGB', 'Стіл для геймінгу з RGB-підсвіткою', 11999.00, '🪵', 'ARM DEAL', 9),
            ('arm-home-safe', 'ARM Home Safe Box', 'Сейф для документів і цінностей з PIN-кодом', 3999.00, '🔐', None, 17),
            ('arm-doorbell-2cam', 'ARM Doorbell Dual Cam', 'Смарт-дзвінок з двома камерами', 6999.00, '🚪', 'TOP', 11),
            ('arm-sensor-motion', 'ARM Motion Sensor Pro', 'Датчик руху з регулюванням чутливості', 1199.00, '📡', None, 66),
            ('arm-smart-switch-pack', 'ARM Smart Switch Pack', 'Набір смарт-вимикачів (3 шт.)', 1899.00, '🔌', None, 54),
            ('arm-led-strip-5m', 'ARM LED Strip 5m', 'Світлодіодна стрічка RGBIC з Wi-Fi', 1299.00, '💡', 'SALE', 74),
            ('arm-floor-cleaner', 'ARM Floor Cleaner', 'Миючий пилосос для твердих підлог', 15999.00, '🧽', 'PRO', 8),
            ('arm-blinds-motor', 'ARM Smart Blinds Motor', 'Мотор для автоматизації жалюзі', 2499.00, '🪟', None, 30),
            ('arm-worklight', 'ARM Work Light Pro', 'Потужний робочий світильник для майстерні', 1799.00, '💡', None, 27),
            ('arm-bike-holder', 'ARM Bike Phone Holder', 'Тримач смартфона для велосипеда', 799.00, '📱', None, 58),
            ('arm-car-charger', 'ARM Car Charger 75W', 'Автозарядка USB-C + USB-A з PD', 899.00, '🔌', 'HOT', 63),
            ('arm-travel-adapter', 'ARM Travel Adapter', 'Універсальний адаптер для подорожей', 1299.00, '🔌', None, 47),
            ('arm-nas-home-2bay', 'ARM Home NAS 2-Bay', 'Домашнє сховище даних для резервних копій', 18999.00, '💾', 'NEW', 7),
            ('arm-ssd-portable-1tb', 'ARM Portable SSD 1TB', 'Зовнішній SSD з USB 3.2 Gen2', 4499.00, '💾', None, 35),
            ('arm-surveillance-kit-4', 'ARM CCTV Kit 4 Cam', 'Комплект відеоспостереження на 4 камери', 17999.00, '📹', 'TOP', 9),
            ('arm-light-bulb-e27', 'ARM Smart Bulb E27', 'Окрема smart-лампа з підтримкою сцен', 499.00, '💡', None, 110),
            ('arm-rice-cooker', 'ARM Rice Cooker', 'Рисоварка з антипригарною чашею', 2699.00, '🍚', None, 33),
            ('arm-electric-kettle-pro', 'ARM Kettle Pro Temp', 'Чайник з точним контролем температури', 2299.00, '🫖', 'ARM DEAL', 25),
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


def _expire_overdue_invoices(conn: Any) -> None:
    expired = conn.execute(
        """
        SELECT i.id, i.order_id
        FROM marketplace_invoices i
        JOIN marketplace_orders o ON o.id = i.order_id
        WHERE i.status = 'issued'
          AND o.status = 'awaiting_payment'
          AND i.due_at < """
        + _now_sql() +
        """
        """
    ).fetchall()
    if not expired:
        return

    for row in expired:
        order_id = int(row['order_id'])
        items = conn.execute(
            'SELECT product_id, qty FROM marketplace_order_items WHERE order_id = %s',
            (order_id,),
        ).fetchall()
        for item in items or []:
            pid = int(item.get('product_id') or 0)
            qty = int(item.get('qty') or 0)
            if pid > 0 and qty > 0:
                conn.execute(
                    'UPDATE marketplace_products SET stock = stock + %s, updated_at = ' + _now_sql() + ' WHERE id = %s',
                    (qty, pid),
                )

        conn.execute(
            "UPDATE marketplace_orders SET status = 'invoice_expired', invoice_status = 'expired' WHERE id = %s",
            (order_id,),
        )
        conn.execute(
            "UPDATE marketplace_invoices SET status = 'expired' WHERE id = %s",
            (int(row['id']),),
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


def _to_payload_order(row: dict[str, Any]) -> dict[str, Any]:
    return {
        'id': int(row['id']),
        'total_amount': float(row.get('total_amount') or 0),
        'currency': row.get('currency') or 'UAH',
        'status': row.get('status') or 'paid',
        'payment_mode': row.get('payment_mode') or 'pay_now',
        'invoice_number': row.get('invoice_number'),
        'invoice_status': row.get('invoice_status') or 'paid',
        'invoice_due_at': row.get('invoice_due_at'),
        'created_at': row.get('created_at'),
        'items_count': int(row.get('items_count') or 0),
    }


def _auth_payload(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        'id': int(row.get('id') or 0),
        'authorization_code': row.get('authorization_code'),
        'payment_network': row.get('payment_network') or 'ARM_PAY',
        'merchant_id': row.get('merchant_id') or 'ARM-MARKETPLACE',
        'merchant_name': row.get('merchant_name') or 'ARM Marketplace',
        'status': row.get('status') or 'authorized',
        'response_code': row.get('response_code') or APPROVED_CODE,
        'decline_reason': row.get('decline_reason'),
        'amount': float(row.get('amount') or 0),
        'currency': row.get('currency') or 'UAH',
        'balance_before': float(row.get('balance_before') or 0),
        'balance_after': (
            None if row.get('balance_after') is None else float(row.get('balance_after') or 0)
        ),
        'payment_tx_id': int(row.get('payment_tx_id') or 0),
        'created_at': row.get('created_at'),
        'captured_at': row.get('captured_at'),
        'reversed_at': row.get('reversed_at'),
    }


def _select_authorization(conn: Any, auth_id: int | None = None, auth_code: str | None = None) -> dict[str, Any] | None:
    if auth_id:
        row = conn.execute(
            'SELECT * FROM marketplace_payment_authorizations WHERE id = %s LIMIT 1',
            (int(auth_id),),
        ).fetchone()
    elif auth_code:
        row = conn.execute(
            'SELECT * FROM marketplace_payment_authorizations WHERE authorization_code = %s LIMIT 1',
            (str(auth_code),),
        ).fetchone()
    else:
        row = None
    return dict(row) if row else None


def _create_declined_authorization(
    conn: Any,
    *,
    user_id: int,
    account: dict[str, Any],
    amount: float,
    invoice_number: str,
    response_code: str,
    decline_reason: str,
    idempotency_key: str | None = None,
    payment_network: str = 'ARM_PAY',
) -> dict[str, Any]:
    suffix = get_returning_id_suffix()
    auth_code = _generate_auth_code()
    cur = conn.execute(
        """
        INSERT INTO marketplace_payment_authorizations
        (authorization_code, idempotency_key, user_id, account_id, invoice_number, amount, currency,
         payment_network, status, response_code, decline_reason, balance_before)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'declined', %s, %s, %s)
        """
        + suffix,
        (
            auth_code,
            idempotency_key,
            user_id,
            int(account.get('id') or 0),
            invoice_number,
            float(amount),
            str(account.get('currency') or 'UAH'),
            payment_network,
            response_code,
            decline_reason,
            float(account.get('balance') or 0),
        ),
    )
    auth_id = insert_last_id(cur)
    return _select_authorization(conn, auth_id=int(auth_id or 0)) or {'id': auth_id, 'authorization_code': auth_code}


def _authorize_and_capture_payment(
    conn: Any,
    *,
    user_id: int,
    account: dict[str, Any],
    amount: float,
    invoice_number: str,
    tx_type: str,
    description: str,
    order_id: int | None = None,
    idempotency_key: str | None = None,
    payment_network: str = 'ARM_PAY',
) -> dict[str, Any]:
    """Authorize and capture one marketplace payment.

    Mirrors card processing semantics:
    1. authorization record gets approved/declined response code;
    2. approved authorization is captured by atomic account debit;
    3. failed capture reverses the authorization instead of leaving a paid order.
    """
    if amount <= 0:
        auth = _create_declined_authorization(
            conn,
            user_id=user_id,
            account=account,
            amount=amount,
            invoice_number=invoice_number,
            response_code=PROCESSING_ERROR_CODE,
            decline_reason='Некоректна сума платежу.',
            idempotency_key=idempotency_key,
            payment_network=payment_network,
        )
        return {'approved': False, 'status_code': 400, 'error': 'Некоректна сума платежу.', 'authorization': auth}

    account_id = int(account.get('id') or 0)
    balance_before = float(account.get('balance') or 0)
    if account_id <= 0:
        auth = _create_declined_authorization(
            conn,
            user_id=user_id,
            account=account,
            amount=amount,
            invoice_number=invoice_number,
            response_code=INVALID_ACCOUNT_CODE,
            decline_reason='Банківський рахунок не знайдено.',
            idempotency_key=idempotency_key,
            payment_network=payment_network,
        )
        return {'approved': False, 'status_code': 404, 'error': 'Банківський рахунок не знайдено.', 'authorization': auth}

    if balance_before < amount:
        auth = _create_declined_authorization(
            conn,
            user_id=user_id,
            account=account,
            amount=amount,
            invoice_number=invoice_number,
            response_code=INSUFFICIENT_FUNDS_CODE,
            decline_reason='Недостатньо коштів на рахунку.',
            idempotency_key=idempotency_key,
            payment_network=payment_network,
        )
        return {'approved': False, 'status_code': 409, 'error': 'Недостатньо коштів на рахунку.', 'authorization': auth}

    suffix = get_returning_id_suffix()
    auth_code = _generate_auth_code()
    auth_cur = conn.execute(
        """
        INSERT INTO marketplace_payment_authorizations
        (authorization_code, idempotency_key, user_id, account_id, order_id, invoice_number, amount, currency,
         payment_network, status, response_code, balance_before)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'authorized', %s, %s)
        """
        + suffix,
        (
            auth_code,
            idempotency_key,
            user_id,
            account_id,
            order_id,
            invoice_number,
            float(amount),
            str(account.get('currency') or 'UAH'),
            payment_network,
            APPROVED_CODE,
            balance_before,
        ),
    )
    auth_id = int(insert_last_id(auth_cur) or 0)

    cur_debit = conn.execute(
        "UPDATE accounts SET balance = balance - %s "
        "WHERE id = %s AND user_id = %s AND status = 'active' AND balance >= %s",
        (float(amount), account_id, user_id, float(amount)),
    )
    if getattr(cur_debit, 'rowcount', 0) == 0:
        conn.execute(
            "UPDATE marketplace_payment_authorizations "
            "SET status = 'reversed', response_code = %s, decline_reason = %s, reversed_at = "
            + _now_sql()
            + " WHERE id = %s",
            (INSUFFICIENT_FUNDS_CODE, 'Баланс змінився до capture.', auth_id),
        )
        auth = _select_authorization(conn, auth_id=auth_id)
        return {'approved': False, 'status_code': 409, 'error': 'Недостатньо коштів на рахунку.', 'authorization': auth}

    updated = conn.execute(
        'SELECT balance FROM accounts WHERE id = %s LIMIT 1',
        (account_id,),
    ).fetchone()
    new_balance = float((updated or {}).get('balance') or 0)

    tx_cur = conn.execute(
        """
        INSERT INTO transactions(account_id, tx_type, direction, amount, description, related_account)
        VALUES (%s, %s, %s, %s, %s, %s)
        """
        + suffix,
        (account_id, tx_type, 'out', float(amount), description, 'ARM-MARKETPLACE'),
    )
    payment_tx_id = int(insert_last_id(tx_cur) or 0)

    conn.execute(
        "UPDATE marketplace_payment_authorizations "
        "SET status = 'captured', balance_after = %s, payment_tx_id = %s, captured_at = "
        + _now_sql()
        + " WHERE id = %s",
        (new_balance, payment_tx_id, auth_id),
    )
    auth = _select_authorization(conn, auth_id=auth_id)
    return {
        'approved': True,
        'authorization': auth,
        'payment_tx_id': payment_tx_id,
        'new_balance': new_balance,
        'authorization_code': auth_code,
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
        _expire_overdue_invoices(conn)
        orders = conn.execute(
            """
            SELECT
                o.id,
                o.total_amount,
                o.currency,
                o.status,
                o.payment_mode,
                o.invoice_number,
                o.invoice_status,
                o.invoice_due_at,
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
    payload = [_to_payload_order(dict(r)) for r in (orders or [])]
    return jsonify({'ok': True, 'data': {'orders': payload}})


@marketplace_bp.get('/invoices')
@auth_required
def list_invoices():
    _ensure_schema()
    user_id = int(g.current_user['id'])
    limit = min(max(int(request.args.get('limit') or 20), 1), 100)
    with get_connection() as conn:
        _expire_overdue_invoices(conn)
        rows = conn.execute(
            """
            SELECT invoice_number, amount, currency, status, due_at, paid_at, created_at, order_id
            FROM marketplace_invoices
            WHERE user_id = %s
            ORDER BY created_at DESC, id DESC
            LIMIT %s
            """,
            (user_id, limit),
        ).fetchall()
    invoices = []
    for row in rows or []:
        r = dict(row)
        invoices.append({
            'invoice_number': r.get('invoice_number'),
            'amount': float(r.get('amount') or 0),
            'currency': r.get('currency') or 'UAH',
            'status': r.get('status') or 'issued',
            'due_at': r.get('due_at'),
            'paid_at': r.get('paid_at'),
            'created_at': r.get('created_at'),
            'order_id': int(r.get('order_id') or 0),
        })
    return jsonify({'ok': True, 'data': {'invoices': invoices}})


@marketplace_bp.get('/invoice/<invoice_number>')
@auth_required
def get_invoice(invoice_number: str):
    _ensure_schema()
    user_id = int(g.current_user['id'])
    invoice_key = str(invoice_number or '').strip()
    if not invoice_key:
        return api_error('Не вказано номер інвойсу.')

    with get_connection() as conn:
        _expire_overdue_invoices(conn)
        inv = conn.execute(
            """
            SELECT
                i.id,
                i.invoice_number,
                i.order_id,
                i.amount,
                i.currency,
                i.status,
                i.due_at,
                i.paid_at,
                i.created_at,
                i.payment_tx_id,
                i.payment_auth_id,
                o.shipping_name,
                o.shipping_phone,
                o.shipping_address,
                o.note,
                o.status AS order_status,
                o.payment_mode
            FROM marketplace_invoices i
            JOIN marketplace_orders o ON o.id = i.order_id
            WHERE i.user_id = %s AND i.invoice_number = %s
            LIMIT 1
            """,
            (user_id, invoice_key),
        ).fetchone()
        if not inv:
            return api_error('Інвойс не знайдено.', 404)

        items = conn.execute(
            """
            SELECT product_id, title, price, qty, line_total
            FROM marketplace_order_items
            WHERE order_id = %s
            ORDER BY id ASC
            """,
            (int(inv['order_id']),),
        ).fetchall()
        auth_row = _select_authorization(conn, auth_id=int(inv.get('payment_auth_id') or 0))

    inv_d = dict(inv)
    payload_items = []
    for item in items or []:
        row = dict(item)
        payload_items.append({
            'product_id': int(row.get('product_id') or 0),
            'title': row.get('title') or 'Товар',
            'price': float(row.get('price') or 0),
            'qty': int(row.get('qty') or 0),
            'line_total': float(row.get('line_total') or 0),
        })

    can_pay = (inv_d.get('status') == 'issued')
    return jsonify({'ok': True, 'data': {
        'invoice_number': inv_d.get('invoice_number'),
        'order_id': int(inv_d.get('order_id') or 0),
        'status': inv_d.get('status') or 'issued',
        'amount': float(inv_d.get('amount') or 0),
        'currency': inv_d.get('currency') or 'UAH',
        'due_at': inv_d.get('due_at'),
        'paid_at': inv_d.get('paid_at'),
        'created_at': inv_d.get('created_at'),
        'payment_tx_id': int(inv_d.get('payment_tx_id') or 0),
        'payment_authorization': _auth_payload(auth_row),
        'order_status': inv_d.get('order_status') or 'awaiting_payment',
        'payment_mode': inv_d.get('payment_mode') or 'invoice',
        'shipping': {
            'name': inv_d.get('shipping_name') or '',
            'phone': inv_d.get('shipping_phone') or '',
            'address': inv_d.get('shipping_address') or '',
            'note': inv_d.get('note') or '',
        },
        'can_pay': bool(can_pay),
        'pay_endpoint': f"/api/marketplace/invoice/{inv_d.get('invoice_number')}/pay",
        'items': payload_items,
    }})


@marketplace_bp.post('/invoice/<invoice_number>/pay')
@auth_required
def pay_invoice(invoice_number: str):
    _ensure_schema()
    user_id = int(g.current_user['id'])
    payload = request.get_json(silent=True) or {}
    idempotency_key, idem_err = require_idempotency_key(payload=payload, allow_body_fallback=True)
    if idem_err:
        return idem_err
    idem_action = 'marketplace_invoice_pay'
    if idempotency_key:
        reservation = idempotency_service.reserve(
            user_id=user_id,
            action=idem_action,
            key=idempotency_key,
            payload={'invoice_number': invoice_number},
        )
        state = reservation.get('state')
        if state == 'conflict':
            return api_error('Idempotency-Key уже використано з іншим payload.', 409)
        if state == 'replay':
            return jsonify(reservation.get('payload') or {'ok': False}), int(reservation.get('response_code') or 200)
        if state == 'processing':
            return api_error('Операція вже виконується. Спробуйте пізніше.', 409)

    invoice_key = str(invoice_number or '').strip()
    if not invoice_key:
        return api_error('Не вказано номер інвойсу.')

    with get_connection() as conn:
        _expire_overdue_invoices(conn)
        inv = conn.execute(
            """
            SELECT id, invoice_number, order_id, account_id, amount, currency, status, payment_tx_id, payment_auth_id
            FROM marketplace_invoices
            WHERE user_id = %s AND invoice_number = %s
            LIMIT 1
            """,
            (user_id, invoice_key),
        ).fetchone()
        if not inv:
            return api_error('Інвойс не знайдено.', 404)

        status = str(inv.get('status') or 'issued')
        if status == 'paid':
            account = conn.execute(
                'SELECT account_number, balance FROM accounts WHERE id = %s LIMIT 1',
                (int(inv['account_id']),),
            ).fetchone()
            auth = _select_authorization(conn, auth_id=int(inv.get('payment_auth_id') or 0))
            response_payload = {'ok': True, 'data': {
                'invoice_number': inv.get('invoice_number'),
                'order_id': int(inv.get('order_id') or 0),
                'status': 'paid',
                'payment_tx_id': int(inv.get('payment_tx_id') or 0),
                'new_balance': float((account or {}).get('balance') or 0),
                'account_number': (account or {}).get('account_number'),
                'payment_authorization': _auth_payload(auth),
            }}
            if idempotency_key:
                _complete_idempotency_in_conn(
                    conn,
                    user_id=user_id,
                    action=idem_action,
                    key=idempotency_key,
                    response_payload=response_payload,
                    response_code=200,
                )
            return jsonify(response_payload)
        if status in ('cancelled', 'expired'):
            return api_error('Інвойс недійсний або прострочений.', 409)

        account = conn.execute(
            'SELECT id, account_number, balance, currency FROM accounts WHERE id = %s AND user_id = %s LIMIT 1',
            (int(inv['account_id']), user_id),
        ).fetchone()
        if not account:
            return api_error('Банківський рахунок не знайдено.', 404)

        amount = float(inv.get('amount') or 0)
        payment = _authorize_and_capture_payment(
            conn,
            user_id=user_id,
            account=dict(account),
            amount=amount,
            invoice_number=str(inv.get('invoice_number') or invoice_key),
            order_id=int(inv.get('order_id') or 0),
            tx_type='marketplace_invoice',
            description=f"Оплата інвойсу {inv.get('invoice_number')} у ARM Marketplace",
            idempotency_key=idempotency_key,
            payment_network=str(payload.get('payment_network') or 'ARM_PAY').strip().upper()[:20] or 'ARM_PAY',
        )
        if not payment.get('approved'):
            response_payload = {
                'ok': False,
                'error': payment.get('error') or 'Платіж відхилено.',
                'data': {'payment_authorization': _auth_payload(payment.get('authorization'))},
            }
            if idempotency_key:
                _complete_idempotency_in_conn(
                    conn,
                    user_id=user_id,
                    action=idem_action,
                    key=idempotency_key,
                    response_payload=response_payload,
                    response_code=int(payment.get('status_code') or 409),
                )
            return jsonify(response_payload), int(payment.get('status_code') or 409)

        payment_tx_id = int(payment.get('payment_tx_id') or 0)
        new_balance = float(payment.get('new_balance') or 0)
        auth_id = int((payment.get('authorization') or {}).get('id') or 0)

        conn.execute(
            "UPDATE marketplace_invoices "
            "SET status = 'paid', paid_at = " + _now_sql() + ", payment_tx_id = %s, payment_auth_id = %s "
            "WHERE id = %s",
            (payment_tx_id, auth_id, int(inv['id'])),
        )
        conn.execute(
            """
            UPDATE marketplace_orders
            SET status = 'paid', invoice_status = 'paid', payment_tx_id = %s, payment_auth_id = %s
            WHERE id = %s
            """,
            (payment_tx_id, auth_id, int(inv['order_id'])),
        )

    response_payload = {'ok': True, 'data': {
        'invoice_number': inv.get('invoice_number'),
        'order_id': int(inv.get('order_id') or 0),
        'status': 'paid',
        'payment_tx_id': int(payment_tx_id or 0),
        'new_balance': float(new_balance),
        'account_number': account.get('account_number'),
        'payment_authorization': _auth_payload(payment.get('authorization')),
    }}
    if idempotency_key:
        idempotency_service.complete(user_id, idem_action, idempotency_key, response_payload, 200)
    return jsonify(response_payload)


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
    payment_mode = str(payload.get('payment_mode') or 'pay_now').strip().lower()

    if payment_mode not in ('pay_now', 'invoice'):
        return api_error('Некоректний режим оплати.')

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

    idempotency_key, idem_err = require_idempotency_key(payload=payload, allow_body_fallback=True)
    if idem_err:
        return idem_err
    idem_action = 'marketplace_checkout'
    if idempotency_key:
        reservation = idempotency_service.reserve(
            user_id=user_id,
            action=idem_action,
            key=idempotency_key,
            payload={
                'items': sorted(
                    [{'product_id': int(pid), 'qty': int(qty)} for pid, qty in requested.items()],
                    key=lambda item: item['product_id'],
                ),
                'shipping_name': shipping_name,
                'shipping_phone': shipping_phone,
                'shipping_address': shipping_address,
                'note': note,
                'payment_mode': payment_mode,
            },
        )
        state = reservation.get('state')
        if state == 'conflict':
            return api_error('Idempotency-Key уже використано з іншим payload.', 409)
        if state == 'replay':
            return jsonify(reservation.get('payload') or {'ok': False}), int(reservation.get('response_code') or 200)
        if state == 'processing':
            return api_error('Операція вже виконується. Спробуйте пізніше.', 409)

    product_ids = sorted(requested.keys())
    placeholders = ', '.join(['%s'] * len(product_ids))
    suffix = get_returning_id_suffix()

    with get_connection() as conn:
        _expire_overdue_invoices(conn)
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
        payment_tx_id = None
        payment_auth_id = None
        payment_authorization = None
        new_balance = account_balance
        order_status = 'awaiting_payment' if payment_mode == 'invoice' else 'paid'
        invoice_status = 'issued' if payment_mode == 'invoice' else 'paid'
        invoice_due_at = None
        invoice_number = _generate_unique_invoice_number(conn)

        if payment_mode == 'pay_now':
            payment = _authorize_and_capture_payment(
                conn,
                user_id=user_id,
                account=dict(account),
                amount=total_amount,
                invoice_number=invoice_number,
                tx_type='marketplace',
                description='Оплата у ARM Marketplace',
                idempotency_key=idempotency_key,
                payment_network=str(payload.get('payment_network') or 'ARM_PAY').strip().upper()[:20] or 'ARM_PAY',
            )
            payment_authorization = payment.get('authorization')
            if not payment.get('approved'):
                response_payload = {
                    'ok': False,
                    'error': payment.get('error') or 'Платіж відхилено.',
                    'data': {'payment_authorization': _auth_payload(payment_authorization)},
                }
                if idempotency_key:
                    _complete_idempotency_in_conn(
                        conn,
                        user_id=user_id,
                        action=idem_action,
                        key=idempotency_key,
                        response_payload=response_payload,
                        response_code=int(payment.get('status_code') or 409),
                    )
                return jsonify(response_payload), int(payment.get('status_code') or 409)
            payment_tx_id = int(payment.get('payment_tx_id') or 0)
            payment_auth_id = int((payment_authorization or {}).get('id') or 0)
            new_balance = float(payment.get('new_balance') or account_balance)

        order_cur = conn.execute(
            """
            INSERT INTO marketplace_orders
            (user_id, account_id, total_amount, currency, status, payment_mode, invoice_number, invoice_status, invoice_due_at, payment_tx_id, payment_auth_id, shipping_name, shipping_phone, shipping_address, note)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, """
            + (_due_at_sql(24) if payment_mode == 'invoice' else 'NULL')
            + ", %s, %s, %s, %s, %s, %s)"
            + suffix,
            (
                user_id,
                account['id'],
                total_amount,
                str(account.get('currency') or 'UAH'),
                order_status,
                payment_mode,
                invoice_number,
                invoice_status,
                payment_tx_id,
                payment_auth_id,
                shipping_name,
                shipping_phone,
                shipping_address,
                note,
            ),
        )
        order_id = insert_last_id(order_cur)

        if payment_auth_id:
            conn.execute(
                'UPDATE marketplace_payment_authorizations SET order_id = %s WHERE id = %s',
                (order_id, payment_auth_id),
            )

        # Reserve/consume stock immediately when order is created.
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

        inv_cur = conn.execute(
            """
            INSERT INTO marketplace_invoices
            (invoice_number, order_id, user_id, account_id, amount, currency, status, due_at, paid_at, payment_tx_id, payment_auth_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, """
            + (_due_at_sql(24) if payment_mode == 'invoice' else _now_sql())
            + ", "
            + (_now_sql() if payment_mode == 'pay_now' else 'NULL')
            + ", %s, %s)"
            + suffix,
            (
                invoice_number,
                order_id,
                user_id,
                account['id'],
                total_amount,
                str(account.get('currency') or 'UAH'),
                invoice_status,
                payment_tx_id,
                payment_auth_id,
            ),
        )
        invoice_id = insert_last_id(inv_cur)

        if payment_mode == 'invoice':
            row_due = conn.execute(
                'SELECT due_at FROM marketplace_invoices WHERE id = %s LIMIT 1',
                (invoice_id,),
            ).fetchone()
            invoice_due_at = (row_due or {}).get('due_at')

    response_payload = {
        'ok': True,
        'data': {
            'order_id': int(order_id or 0),
            'invoice_id': int(invoice_id or 0),
            'invoice_number': invoice_number,
            'invoice_status': invoice_status,
            'invoice_due_at': invoice_due_at,
            'payment_tx_id': int(payment_tx_id or 0),
            'total_amount': float(total_amount),
            'currency': str(account.get('currency') or 'UAH'),
            'account_number': account.get('account_number'),
            'new_balance': float(new_balance),
            'status': order_status,
            'payment_mode': payment_mode,
            'items': normalized_items,
            'invoice_link': f"/api/marketplace/invoice/{invoice_number}",
            'pay_link': f"/api/marketplace/invoice/{invoice_number}/pay",
            'payment_authorization': _auth_payload(payment_authorization),
        },
    }
    if idempotency_key:
        idempotency_service.complete(user_id, idem_action, idempotency_key, response_payload, 200)
    return jsonify(response_payload)

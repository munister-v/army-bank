# WeeGo Army Bank — базовий робочий кістяк

Це стартова версія проєкту Army Bank з такими частинами:

- backend на **Python + Flask**;
- база даних **PostgreSQL** (опційно SQLite через `.env`);
- фронтенд для ПК на **HTML + CSS + JavaScript**;
- реалізовані сценарії: реєстрація, вхід, баланс, поповнення, переказ, бойові виплати (демо), донати, накопичення, контакти родини, історія транзакцій.

## Структура

- `backend/` — API, сервіси, репозиторії, валідація, безпека;
- `frontend/` — desktop-first інтерфейс;
- `database/` — SQL-схема і файл БД після запуску;
- `start.py` — головна точка запуску.

## Запуск

Скопіюйте `.env.example` в `.env` і заповніть змінні (зокрема `DATABASE_URL` для PostgreSQL).

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python start.py
```

Після цього відкрийте в браузері:

```text
http://127.0.0.1:5050
```

### Розміщення на сайті під підшляхом (наприклад munister.com.ua/bank)

Встановіть у `.env` змінну **BASE_PATH=/bank**. Усі маршрути та статика будуть під префіксом `/bank`. На основному сайті налаштуйте проксування: усі запити на `https://munister.com.ua/bank` та `https://munister.com.ua/bank/*` передавати на ваш Flask-сервер (наприклад Gunicorn). Приклад для Nginx:

```nginx
location /bank {
    proxy_pass http://127.0.0.1:5000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Після цього застосунок буде доступний за адресою **https://munister.com.ua/bank** із тією самою базою даних та логікою.

## Що вже працює

1. Реєстрація нового користувача.
2. Автоматичне створення основного рахунку.
3. Авторизація через токен сесії.
4. Поповнення рахунку.
5. Переказ на інший рахунок.
6. Історія транзакцій.
7. Демо-нарахування бойових виплат.
8. Донати.
9. Цілі накопичення та внески в них.
10. Список довірених сімейних контактів.

## Тести

```bash
source .venv/bin/activate
pytest tests/ -v
```

## Ролі та перший адмін

- За замовчуванням реєстрація створює користувача з роллю **soldier**.
- Інтерфейс **оператора** (`/operator`) — нарахування виплат військовим.
- Інтерфейс **адміна** (`/admin`) — користувачі, зміна ролей, аудит-логи.
- Щоб зробити першого адміна: зареєструйтеся, потім у БД виконайте  
  `UPDATE users SET role = 'admin' WHERE id = 1;` (або відповідний id).
- Щоб зробити платформенного адміна (перегляд усієї системи, генерація демо‑даних):  
  `UPDATE users SET role = 'platform_admin' WHERE id = 1;`

## Додатково реалізовано

- Ролі **адміністратор** та **оператор** з окремими інтерфейсами.
- Конфігурація через `.env`.
- База даних **PostgreSQL** (підтримка SQLite через змінну оточення).
- Unit-тести (pytest).
- Окремі сторінки замість одного dashboard.
- Система прав доступу за ролями.
- Шаблони платежів та фільтри історії транзакцій.

## Деплой на Render (army-bank.onrender.com)

Див. **RENDER.md** — покрокова інструкція для https://army-bank.onrender.com.

## API для сторонніх розробників

- API catalog: `GET /api`
- API version: `GET /api/version`
- Людинозрозумілі docs: `GET /api/docs`
- OpenAPI schema (3.0.3): `GET /api/openapi.json`
- Postman collection: `GET /api/postman/collection`
- Postman environment: `GET /api/postman/environment`
- Healthcheck: `GET /health`
- Correlation header: `X-Request-Id` (опційно, повертається у відповіді)
- Monetary safety header: `Idempotency-Key` (обов'язково для грошових mutation endpoint'ів)

Локальні файли в репозиторії:

- `postman/army-bank.postman_collection.json`
- `postman/army-bank.postman_environment.json`

Продакшн-приклади:

- https://army-bank.onrender.com/api
- https://army-bank.onrender.com/api/version
- https://army-bank.onrender.com/api/docs
- https://army-bank.onrender.com/api/openapi.json
- https://army-bank.onrender.com/api/postman/collection
- https://army-bank.onrender.com/api/postman/environment
- https://army-bank.onrender.com/health

Детальний handoff-док для інтеграцій: **API_HANDOFF.md**.

## Покращення (останні зміни)

- **Валідація:** мінімум 6 символів для пароля; верхня межа суми операцій; обмеження довжини телефону/email.
- **Безпека:** заголовок `X-Content-Type-Options: nosniff`; єдиний обробник помилок API (400/404/500) з JSON-відповіддю.
- **Frontend:** індикатори завантаження для списків і кнопок; покращені порожні стани; `aria-live` для повідомлень; `focus-visible` для клавіатурної навігації; коректна обробка не-JSON відповіді від сервера.

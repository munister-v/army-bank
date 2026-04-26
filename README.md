# ARM Bank

> Повнофункціональний мобільний банкінг — dark glass UI, React PWA + Flask API + PostgreSQL

[![Live](https://img.shields.io/badge/live-army--bank.onrender.com-c9a964?style=flat-square&logo=render)](https://army-bank.onrender.com)
[![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://typescriptlang.org)

---

## Що це

ARM Bank — приватний банківський застосунок. Написаний як єдиний React SPA поверх Flask REST API. Розгорнутий на Render.com, підтримує iOS PWA зі збереженням Safe Area та Dynamic Island.

---

## Стек

### Frontend
| Технологія | Призначення |
|---|---|
| React 19 + TypeScript | SPA, хуки, контексти |
| Vite 6 | Збірка, HMR |
| Inter (Google Fonts) | Типографіка з variable opsz |
| CSS-in-JS (inline styles) | Design tokens, glass-morphism |

### Backend
| Технологія | Призначення |
|---|---|
| Python 3.11 + Flask | REST API (`/api/*`) |
| PostgreSQL / SQLite | Основна БД (Render Postgres) |
| JWT (Bearer token) | Аутентифікація |
| Gunicorn | Production WSGI |

---

## Функціонал

### Банкінг
- **Огляд** — поточний баланс, картки (carousel), швидкі дії, остання активність
- **Операції** — повна історія транзакцій, пошук, групування по датах, графік витрат (тиждень / місяць / рік), CSV-експорт, PDF-виписка, чеки
- **Картки** — кілька карток (Gold · Emerald · Platinum · Obsidian), заморозка, закриття, зміна PIN, випуск нових
- **Переказ** — поповнення рахунку, переказ на картку, переказ за IBAN
- **Профіль** — персональні дані, Face ID / Push / 2FA toggles, зміна пароля

### Маркетплейс
- Каталог товарів із пошуком, бейджами (HOT / NEW / TOP / SALE)
- Кошик з persistence через `localStorage`, 2-кроковий флоу оформлення
- Замовлення та інвойси з PDF-чеками

### UX / PWA
- Адаптивний layout: мобільний (TabBar + bottom sheet) і десктоп (Sidebar 252px)
- iOS Dynamic Island / notch — `env(safe-area-inset-*)`, `viewport-fit=cover`
- Блокування масштабування: `user-scalable=no, maximum-scale=1.0`
- Toast-сповіщення, liquid glass модалки, `backdrop-filter: blur`

### Адмін-синхронізація
- Авто-оновлення даних кожні 30 с (поки вкладка активна)
- Сумісний із [army-admin](https://github.com/munister-v/army-admin)

---

## Структура репозиторію

```
army-bank/
├── src/
│   └── App.tsx          # весь фронтенд — один файл (~2700 рядків)
├── backend/
│   ├── app.py           # Flask application factory
│   ├── routes/          # Blueprint-и: auth, transactions, cards, marketplace…
│   ├── models/          # SQLAlchemy моделі
│   └── services/        # бізнес-логіка
├── frontend/bank/       # Vite build output (комітиться для Render)
├── index.html           # PWA shell
├── vite.config.ts
├── requirements.txt
└── render.yaml          # Render deploy spec
```

---

## Локальний запуск

### 1. Backend

```bash
git clone https://github.com/munister-v/army-bank
cd army-bank

python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env        # заповніть DATABASE_URL, SECRET_KEY, JWT_SECRET
python start.py
# → http://127.0.0.1:5050
```

### 2. Frontend dev-сервер

```bash
npm install
npm run dev    # → http://localhost:5173
```

### 3. Frontend production build

```bash
npm run build  # → frontend/bank/
```

Render підхоплює статику автоматично — окремий Node.js-сервер не потрібен.

---

## Змінні середовища

| Змінна | Приклад | Опис |
|---|---|---|
| `DATABASE_URL` | `postgresql://…` | PostgreSQL або `sqlite:///db.sqlite3` |
| `SECRET_KEY` | `rand-string` | Flask secret |
| `JWT_SECRET` | `rand-string` | JWT підпис |
| `BASE_PATH` | *(порожньо)* | Префікс маршрутів (наприклад `/bank`) |
| `FLASK_ENV` | `production` | Режим Flask |

---

## Деплой на Render

`render.yaml` вже налаштований:

```yaml
services:
  - type: web
    name: army-bank
    runtime: python
    buildCommand: pip install -r requirements.txt
    startCommand: gunicorn start:app --workers 2 --bind 0.0.0.0:$PORT
    staticPublishPath: frontend/bank
```

Кожен `git push` → автоматичний деплой.

---

## API — короткий довідник

| Метод | Ендпоінт | Опис |
|---|---|---|
| `POST` | `/api/auth/login` | Вхід → JWT |
| `POST` | `/api/auth/register` | Реєстрація |
| `GET` | `/api/account/me` | Профіль + рахунок |
| `GET` | `/api/transactions` | Список транзакцій |
| `POST` | `/api/transactions/topup` | Поповнення |
| `POST` | `/api/transactions/transfer` | Переказ за IBAN |
| `POST` | `/api/transactions/transfer-by-card` | Переказ на картку |
| `GET` | `/api/cards` | Список карток |
| `PUT` | `/api/cards/:id/pin` | Зміна PIN |
| `PATCH` | `/api/cards/:id/block` | Заморозити / розморозити |
| `POST` | `/api/marketplace/checkout` | Оформити замовлення |
| `GET` | `/api/marketplace/orders` | Замовлення |

Повна документація — [postman/](postman/).

---

## Дизайн-система

```
gold        = #c9a964   goldDark = #8a6a2f   goldLight = #f0cc70
bg gradient = radial-gradient(…#1a3a2c … #07150f)
glass card  = rgba(255,255,255,0.05) + backdrop-filter: blur(20px)
border      = rgba(200,170,100,0.11)

Type scale:
  hero 36/700  h1 28/700  h2 22/600  h3 17/600
  body 14/400  sm 13/400  caption 11/600/uppercase
```

---

## Суміжні проєкти

| | |
|---|---|
| [army-admin](https://github.com/munister-v/army-admin) | Адмін-панель (той самий бекенд) |
| [messenger](https://army-bank.onrender.com/messenger) | Захищений месенджер + казино |

---

## Ліцензія

MIT © [munister-v](https://github.com/munister-v)

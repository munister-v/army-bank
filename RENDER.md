# Як отримати https://army-bank.onrender.com

Покроково: виставлення застосунку на Render безкоштовно. Ім'я сервісу **army-bank** дасть посилання **https://army-bank.onrender.com**.

---

## 1. Код на GitHub

Якщо проєкт ще не в репо:

```bash
cd /Users/vyacheslawmunister/Desktop/army_bank_project
git init
git add .
git commit -m "Army Bank for Render"
git remote add origin https://github.com/munister-v/army-bank.git
git branch -M main
git push -u origin main
```

(Якщо репо вже є — просто `git push`.)

---

## 2. Реєстрація на Render

1. Відкрий **https://render.com**
2. Натисни **Get Started for Free**
3. Увійди через **GitHub** (Sign in with GitHub)
4. Дозволь Render доступ до репозиторіїв (хоча б до **army-bank**)

---

## 3. Створення Web Service

1. У Dashboard натисни **New +** → **Web Service**
2. Підключи репо:
   - якщо бачиш **army-bank** — вибери його і натисни **Connect**;
   - якщо немає — **Configure account** і дозволь доступ до потрібного репо, потім знову вибери **army-bank** і **Connect**

---

## 4. Налаштування сервісу

Заповни поля так:

| Поле | Значення |
|------|----------|
| **Name** | `army-bank` (буде URL: army-bank.onrender.com) |
| **Region** | Frankfurt (або найближчий) |
| **Branch** | `main` |
| **Runtime** | `Python 3` |
| **Build Command** | `pip install -r requirements.txt` |
| **Start Command** | `gunicorn -c deploy/gunicorn.conf.py backend.app:app` |

---

## 5. Змінні оточення (Environment)

У секції **Environment** додай:

| Key | Value |
|-----|--------|
| `SECRET_KEY` | натисни **Generate** (або введи довгий випадковий рядок) |
| `ARMY_BANK_DATABASE_PATH` | `/tmp/army_bank.db` |

(База буде SQLite у тимчасовій папці; на безкоштовному тарифі дані можуть скидатися після простою. Для постійних даних потім можна додати PostgreSQL в Render.)

**DATABASE_URL** не потрібно — залишаємо SQLite.

---

## 6. Деплой

1. Натисни **Create Web Service**
2. Render почне збірку і деплой (1–3 хв)
3. У логах має з’явитися щось на кшталт: `Listening on 0.0.0.0:10000`
4. Коли статус стане **Live**, відкрий **https://army-bank.onrender.com**

Там має бути екран входу Digital Army Bank.

---

## 7. Якщо назва зайнята

Якщо **army-bank** вже хтось використовує, Render запропонує, наприклад, **army-bank-abc1**. Тоді URL буде **https://army-bank-abc1.onrender.com**. Можна змінити **Name** на інший (наприклад **army-bank-munister**) перед створенням сервісу.

---

## Підсумок

- Репо на GitHub → Render → New Web Service → підключити **army-bank** → вказати Build/Start команди та env → **Create Web Service**.
- Після деплою застосунок буде доступний за посиланням типу **https://army-bank.onrender.com** (або з суфіксом, якщо ім'я зайняте).

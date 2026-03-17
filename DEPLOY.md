# Розгортання Army Bank на munister.com.ua/bank

## Швидко (один скрипт на сервері)

На машині, де вже працює **munister.com.ua** (SSH на сервер):

```bash
cd /home/ubuntu   # або інший каталог
git clone https://github.com/munister-v/army-bank.git army_bank_project
cd army_bank_project
chmod +x deploy/install-on-server.sh
./deploy/install-on-server.sh
```

Скрипт: venv, pip, .env (SECRET_KEY згенерує сам), systemd, запуск сервісу. Далі додай у конфіг Nginx для munister.com.ua блок з `deploy/nginx-bank.conf` і зроби `sudo nginx -t && sudo systemctl reload nginx`. Після цього **https://munister.com.ua/bank** буде відкривати застосунок.

---

## Якщо немає свого сервера (тільки GitHub)

Можна виставити застосунок на **Render.com** (безкоштовний тариф):

1. Залей проєкт на GitHub (якщо ще не залито): `git push origin main`.
2. Зайди на [render.com](https://render.com), Sign up → New → Web Service.
3. Підключи репозиторій **army-bank** (munister-v/army-bank).
4. Налаштуй:
   - Build: `pip install -r requirements.txt`
   - Start: `gunicorn -c deploy/gunicorn.conf.py backend.app:app`
   - Env: `SECRET_KEY` — натисни Generate; `ARMY_BANK_DATABASE_PATH` = `/tmp/army_bank.db` (SQLite у тимчасовій папці).
5. Deploy. Render дасть URL, наприклад **https://army-bank-xxxx.onrender.com**.

Щоб відкривати з сайту: на munister.com.ua додай посилання або редірект:

- Посилання: `<a href="https://army-bank-xxxx.onrender.com">Army Bank</a>`, або
- Редірект `/bank`: у налаштуваннях хостингу (або в HTML) перенаправляй на цей URL.

---

## Покрокова інструкція (якщо потрібно вручну)

### 1. Сервер

На машині, де крутиться munister.com.ua (або окремий VPS), має бути:

- Python 3.10+
- Nginx (або інший reverse proxy)
- Опційно: PostgreSQL (або залишити SQLite)

---

## 2. Код проєкту

Клонуйте або завантажте проєкт у каталог, наприклад:

```bash
cd /home/ubuntu
git clone https://github.com/munister-v/army-bank.git army_bank_project
cd army_bank_project
```

(або замість `ubuntu` — ваш користувач; шлях далі позначимо як `PROJECT_DIR`.)

---

## 3. Python-оточення та залежності

```bash
cd PROJECT_DIR
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

---

## 4. Конфігурація .env

```bash
cp deploy/.env.production.example .env
nano .env   # або vim
```

Обов’язково встановіть:

- `BASE_PATH=/bank` — вже є в прикладі.
- `SECRET_KEY` — довгий випадковий рядок (наприклад `openssl rand -hex 32`).
- `DATABASE_URL` — рядок підключення до PostgreSQL або залиште порожнім для SQLite.

Збережіть файл.

---

## 5. База даних (якщо PostgreSQL)

```bash
sudo -u postgres createuser -P army_bank_user
sudo -u postgres createdb -O army_bank_user army_bank
```

У `.env` вкажіть ці ж логін/пароль/базу в `DATABASE_URL`.

Якщо використовуєте SQLite — нічого не робіть; база створиться у `database/army_bank.db` при першому запуску.

---

## 6. Запуск через Gunicorn

Переконайтесь, що в `deploy/gunicorn.conf.py` змінна `chdir` вказує на корінь проєкту (за замовчуванням це автоматично).

Запуск вручну (для перевірки):

```bash
cd PROJECT_DIR
chmod +x deploy/run.sh
./deploy/run.sh
```

Або вручну з завантаженням `.env`:

```bash
cd PROJECT_DIR
source .venv/bin/activate
export $(grep -v '^#' .env | xargs)
gunicorn -c deploy/gunicorn.conf.py backend.app:app
```

У браузері перевірте: `http://SERVER_IP:5000/bank/` — має відкритись сторінка входу. Потім зупиніть (Ctrl+C).

---

## 7. Systemd (автозапуск)

```bash
sudo cp deploy/army-bank.service /etc/systemd/system/
```

Відредагуйте шляхи під свій сервер (замініть `/home/USER/army_bank_project` на `PROJECT_DIR` і користувача на того, під ким буде крутитись сервіс, наприклад `www-data` або `ubuntu`):

```bash
sudo nano /etc/systemd/system/army-bank.service
```

У секції `[Service]` вкажіть:

- `User=` та `Group=` — користувач, під яким запускати (наприклад `www-data`).
- `WorkingDirectory=` та `EnvironmentFile=` — повний шлях до проєкту та до `.env`.
- У `ExecStart=` та `Environment=` шлях до `.venv` у вашому проєкті.

Потім:

```bash
sudo systemctl daemon-reload
sudo systemctl enable army-bank
sudo systemctl start army-bank
sudo systemctl status army-bank
```

---

## 8. Nginx (munister.com.ua)

Відкрийте конфіг сайту munister.com.ua (наприклад `/etc/nginx/sites-available/munister.com.ua` або включений з нього `sites-enabled`). Всередині блоку `server { ... }` для цього домену додайте вміст файла `deploy/nginx-bank.conf`:

```nginx
    location /bank {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_redirect off;
        proxy_buffering off;
    }
```

Перевірка та перезавантаження:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## 9. Перевірка

- Відкрийте: **https://munister.com.ua/bank**
- Має з’явитись сторінка входу Army Bank.
- Зареєструйте користувача, увійдіть — все має працювати з тією самою базою.

---

## 10. Посилання з головної сторінки

На сайті munister.com.ua додайте посилання на застосунок, наприклад:

```html
<a href="https://munister.com.ua/bank">Army Bank</a>
```

---

## Підсумок файлів у проєкті

| Файл | Призначення |
|------|-------------|
| `deploy/gunicorn.conf.py` | Конфіг Gunicorn, уже з BASE_PATH=/bank |
| `deploy/nginx-bank.conf` | Фрагмент Nginx для location /bank |
| `deploy/army-bank.service` | Юніт systemd (потрібно підставити шляхи) |
| `deploy/.env.production.example` | Приклад .env для production (BASE_PATH=/bank) |
| `deploy/run.sh` | Скрипт запуску Gunicorn з поточного проєкту (завантажує .env) |

Усе необхідне вже прописано; достатньо виконати кроки вище під свій сервер і домен.

# Gunicorn — конфігурація для Army Bank (production під /bank)
# Запуск: gunicorn -c deploy/gunicorn.conf.py

import os

# Порт: на Render/Heroku використовується PORT з оточення
chdir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
port = int(os.environ.get("PORT", "5000"))
bind = f"0.0.0.0:{port}"
workers = 2
worker_class = "sync"
threads = 2
timeout = 60
keepalive = 5

# BASE_PATH задається в .env на сервері (/bank для munister.com.ua/bank). На Render не встановлюй.

# Логи
accesslog = "-"
errorlog = "-"
loglevel = "info"

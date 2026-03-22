#!/bin/bash
# Один скрипт для виставлення Army Bank на сайт (munister.com.ua/bank).
# Запускати на СЕРВЕРІ, де вже крутиться Nginx для munister.com.ua.
#
# На сервері:
#   git clone https://github.com/munister-v/army-bank.git army_bank_project
#   cd army_bank_project
#   chmod +x deploy/install-on-server.sh
#   ./deploy/install-on-server.sh

set -e
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "=== Army Bank → munister.com.ua/bank ==="
echo "Проєкт: $PROJECT_DIR"
echo ""

# 1. Venv та залежності
if [ ! -d ".venv" ]; then
  echo "[1/5] Створення venv та встановлення залежностей..."
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements.txt
else
  echo "[1/5] venv є, оновлюю залежності..."
  .venv/bin/pip install -q -r requirements.txt
fi

# 2. .env
if [ ! -f ".env" ]; then
  echo "[2/5] Створення .env..."
  cp deploy/.env.production.example .env
  SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | base64)
  sed -i.bak "s/змініть-на-довгий-випадковий-рядок-32-символи/$SECRET/" .env 2>/dev/null || \
    sed -i '' "s/змініть-на-довгий-випадковий-рядок-32-символи/$SECRET/" .env
  echo "    SECRET_KEY згенеровано автоматично."
else
  echo "[2/5] .env вже існує."
fi

# 3. Systemd unit
echo "[3/5] Встановлення systemd-сервісу..."
SVC_FILE="/etc/systemd/system/army-bank.service"
RUN_USER="${SUDO_USER:-$USER}"
if [ -z "$RUN_USER" ] || [ "$RUN_USER" = root ]; then
  RUN_USER=www-data
fi

sudo tee "$SVC_FILE" > /dev/null << EOF
[Unit]
Description=Digital Army Bank (Gunicorn) — munister.com.ua/bank
After=network.target

[Service]
Type=notify
User=$RUN_USER
Group=$RUN_USER
WorkingDirectory=$PROJECT_DIR
Environment="PATH=$PROJECT_DIR/.venv/bin"
EnvironmentFile=$PROJECT_DIR/.env
ExecStart=$PROJECT_DIR/.venv/bin/gunicorn -c deploy/gunicorn.conf.py backend.app:app
ExecReload=/bin/kill -s HUP \$MAINPID
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Права на .env та каталог database
sudo chown -R "$RUN_USER:$RUN_USER" "$PROJECT_DIR" 2>/dev/null || true
sudo systemctl daemon-reload
sudo systemctl enable army-bank
sudo systemctl restart army-bank

echo "[4/5] Сервіс army-bank запущено."
sleep 1
sudo systemctl status army-bank --no-pager -l || true

echo ""
echo "[5/5] Nginx"
echo "---------"
echo "Додай у конфіг сайту munister.com.ua (всередині server { ... }):"
echo ""
echo "— Банк (/bank):"
cat deploy/nginx-bank.conf
echo ""
echo "— Маркетинг army-admin та army-bank (той самий Gunicorn, файли з git):"
cat deploy/nginx-munister-marketing.conf
echo ""
echo "Потім: sudo nginx -t && sudo systemctl reload nginx"
echo ""
echo "Готово."
echo "  https://munister.com.ua/bank"
echo "  https://munister.com.ua/army-admin/"
echo "  https://munister.com.ua/army-bank/"
echo ""

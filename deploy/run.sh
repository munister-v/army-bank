#!/bin/bash
# Запуск Army Bank (Gunicorn) з поточного проєкту. Використовуйте для перевірки перед systemd.
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi
exec .venv/bin/gunicorn -c deploy/gunicorn.conf.py backend.app:app

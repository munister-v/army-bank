#!/usr/bin/env bash
# Синхронізація статики marketing/ → каталоги на сервері (munister.com.ua).
# Запуск: з кореня репозиторію після git pull, з заданими шляхами.
#
# Приклад:
#   ARMY_ADMIN_TARGET=/var/www/munister.com.ua/army-admin \
#   ARMY_BANK_TARGET=/var/www/munister.com.ua/army-bank \
#   ./deploy/sync-munister-marketing.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

: "${ARMY_ADMIN_TARGET:=}"
: "${ARMY_BANK_TARGET:=}"

usage() {
  echo "Задайте абсолютні шляхи до каталогів на сервері:"
  echo "  ARMY_ADMIN_TARGET — корінь https://munister.com.ua/army-admin/"
  echo "  ARMY_BANK_TARGET  — корінь https://munister.com.ua/army-bank/"
  echo ""
  echo "Приклад:"
  echo "  ARMY_ADMIN_TARGET=/var/www/.../army-admin ARMY_BANK_TARGET=/var/www/.../army-bank $0"
  exit 1
}

[[ -n "$ARMY_ADMIN_TARGET" && -n "$ARMY_BANK_TARGET" ]] || usage

for d in "$ARMY_ADMIN_TARGET" "$ARMY_BANK_TARGET"; do
  if [[ ! -d "$d" ]]; then
    echo "Помилка: каталог не існує: $d"
    exit 1
  fi
done

[[ -d "$ROOT/marketing/munister-army-admin" ]] || { echo "Немає $ROOT/marketing/munister-army-admin"; exit 1; }
[[ -d "$ROOT/marketing/munister-army-bank" ]] || { echo "Немає $ROOT/marketing/munister-army-bank"; exit 1; }

echo "→ rsync army-admin → $ARMY_ADMIN_TARGET"
rsync -av --delete "$ROOT/marketing/munister-army-admin/" "$ARMY_ADMIN_TARGET/"

echo "→ rsync army-bank → $ARMY_BANK_TARGET"
rsync -av --delete "$ROOT/marketing/munister-army-bank/" "$ARMY_BANK_TARGET/"

echo "Готово."

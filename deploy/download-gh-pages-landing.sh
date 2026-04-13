#!/usr/bin/env bash
# Завантажити актуальний лендінг з гілки gh-pages (без git clone) — зручно НА СЕРВЕРІ munister.
# Приклад:
#   TARGET=/var/www/munister.com.ua/army-bank ./deploy/download-gh-pages-landing.sh
#
set -euo pipefail
: "${TARGET:=}"
if [[ -z "$TARGET" ]]; then
  echo "Задайте TARGET — абсолютний шлях до каталогу army-bank на сервері."
  echo "  TARGET=/var/www/munister.com.ua/army-bank $0"
  exit 1
fi
if [[ ! -d "$TARGET" ]]; then
  echo "Каталог не існує: $TARGET"
  exit 1
fi

ZIP_URL="https://codeload.github.com/munister-v/army-bank/zip/refs/heads/gh-pages"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "→ Завантаження gh-pages…"
curl -fsSL "$ZIP_URL" -o "$TMP/repo.zip"
unzip -q "$TMP/repo.zip" -d "$TMP"
# архів розпаковується в army-bank-gh-pages/ або подібно — один верхній каталог
SRC="$(find "$TMP" -maxdepth 1 -mindepth 1 -type d | head -1)"
echo "→ rsync → $TARGET"
rsync -av --delete "$SRC/" "$TARGET/"
echo "Готово. Перевір https://munister.com.ua/army-bank/ (Ctrl+Shift+R)."

#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   sudo bash scripts/setup_docs_dir.sh
#   sudo APP_DIR=/opt/bitnami/AppFormUPSIEC APP_USER=bitnami APP_GROUP=bitnami bash scripts/setup_docs_dir.sh

APP_DIR="${APP_DIR:-/opt/bitnami/AppFormUPSIEC}"
APP_USER="${APP_USER:-bitnami}"
APP_GROUP="${APP_GROUP:-bitnami}"
DOCS_DIR="${DOCS_DIR:-$APP_DIR/dados/docs}"

echo "==> App dir:   $APP_DIR"
echo "==> Docs dir:  $DOCS_DIR"
echo "==> Owner:     $APP_USER:$APP_GROUP"

mkdir -p "$DOCS_DIR"
chown -R "$APP_USER:$APP_GROUP" "$APP_DIR/dados"
chmod -R 775 "$APP_DIR/dados"

# Validate write permission as target user when possible
if command -v sudo >/dev/null 2>&1; then
  sudo -u "$APP_USER" bash -c "touch '$DOCS_DIR/.perm_test' && rm -f '$DOCS_DIR/.perm_test'"
else
  touch "$DOCS_DIR/.perm_test" && rm -f "$DOCS_DIR/.perm_test"
fi

echo "OK: directory ready."
echo "Set this in .env:"
echo "DOCS_DIR=$DOCS_DIR"
